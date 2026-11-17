// dsh-breeze-voice —— 宿主半端
// ============================================================================
// 把本机 Breeze TTS 2 封装成「通用语音输出插件」：
//   1. 设置页主界面参考同类语音设置的设计结构（见 client.js）：
//      音色 / 自动情绪 / 傲娇底色 / 模型判断情绪 / 空闲卸载 / 卸载时长 /
//      安装目录 / 显存(卸载·加载)。
//   2. 调用本机 breeze 引擎（engine/*.mjs：service/emotion/loudness），
//      本机合成，返回 24kHz 单声道 16bit WAV。
//   3. 把本地音色注册进「语音输出端」注册表：
//      - 首选 dsh-pet 的 petApi7340.voice.register（dsh-pet 的下拉直接认出）
//      - 同时以 breezeVoice 服务暴露给其它插件，谁愿意接都能接
//   只碰输出端（TTS/Voice），不碰任何语音输入识别（STT/Speech）。
// ============================================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, statSync } from 'node:fs'
import { join, resolve, isAbsolute, dirname } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { readRuntime, loadPresets, PRESETS, presetOf, validateText, wavBuffer, createService } from './engine/service.mjs'
import { inferEmotion, composeInstruction, tuneEmotion, emotionOf } from './engine/emotion.mjs'

export const name = 'breeze-voice'
// webServer 是内置服务；petApi7340 由 dsh-pet 提供，用 ctx.get 软取（可能晚就绪）。
export const inject = ['webServer']

const ROUTE_SEGMENT = '/api/breeze-voice'
const PROVIDER_ID = 'breeze'

// ---- 日志 -----------------------------------------------------------------
const tag = '[breeze-voice]'
const log = (...a) => console.log(tag, ...a)

// ---- 数据目录 / 配置 -------------------------------------------------------
// 家庭目录：优先 DSH_PROFILE_DIR（宿主进程环境），退回 <home>/.dsh。
function profileDir() {
  const fromEnv = process.env.DSH_PROFILE_DIR
  if (fromEnv && isAbsolute(fromEnv) && existsSync(fromEnv)) return fromEnv
  return join(homedir(), '.dsh')
}
const HOME = join(profileDir(), 'plugins-data', 'breeze-voice')
try { mkdirSync(HOME, { recursive: true }) } catch { /* 只读环境：下面的写会各自降级 */ }
const CONFIG_FILE = join(HOME, 'config.json')
const SAMPLES = join(HOME, 'samples')
const CACHE = join(HOME, 'cache')

// root 没填时，自动从本机已有的语音插件配置里探测 Breeze 安装目录。
// 这里把常见配置位置都试一遍，命中后必须校验 <root>/breeze-runtime.json 存在，
// 避免误认到失效路径。
function discoverRoot() {
  const files = [
    join(homedir(), '.dsh', 'plugins-data', 'aurabot', 'config.json'),
    join(profileDir(), 'plugins-data', 'aurabot', 'config.json'),
    join(homedir(), '.dsh', 'profiles', 'desktop', 'plugins-data', 'aurabot', 'config.json'),
  ]
  for (const f of files) {
    try {
      const j = JSON.parse(readFileSync(f, 'utf8'))
      const r = j && j.voice && j.voice.breeze && j.voice.breeze.root
      if (typeof r === 'string' && isAbsolute(r) && existsSync(join(r, 'breeze-runtime.json'))) {
        log('自动发现安装目录：', r, '（来自', f + '）')
        return r
      }
    } catch { /* 这份配置没有 / 读不动，试下一份 */ }
  }
  return ''
}

const DEFAULTS = {
  root: '',                 // Breeze 安装目录（含 breeze-runtime.json）
  voice: 'qinglan',         // 当前音色 id
  autoEmotion: true,        // 按文本自动挑情绪
  emotionBackbone: true,    // 傲娇底色作为情绪主干
  emotionModel: false,      // 模型判断情绪（预留开关，见 synthesize 注释）
  unloadIdle: true,         // 空闲自动卸载模型释放显存
  unloadIdleMinutes: 5,     // 空闲多久卸载
  rate: 1,                  // 语速（Breeze 引擎暂不消费，保留给契约）
}
const BOOL_KEYS = new Set(['autoEmotion', 'emotionBackbone', 'emotionModel', 'unloadIdle'])
const NUM_KEYS = new Set(['unloadIdleMinutes', 'rate'])

function readConfig() {
  let file = {}
  try { file = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) || {} } catch { /* 没写过 */ }
  const cfg = { ...DEFAULTS }
  for (const k of Object.keys(DEFAULTS)) {
    if (!(k in file)) continue
    const v = file[k]
    if (BOOL_KEYS.has(k)) cfg[k] = Boolean(v)
    else if (NUM_KEYS.has(k)) { const n = Number(v); if (Number.isFinite(n)) cfg[k] = n }
    else cfg[k] = String(v ?? '')
  }
  if (![1, 3, 5, 10, 15, 30].includes(cfg.unloadIdleMinutes)) cfg.unloadIdleMinutes = 5
  // 没填过安装目录时，自动探测本机已有的 Breeze 目录（内存生效，不擅自落盘）。
  if (!cfg.root) cfg.root = discoverRoot()
  return cfg
}
let cfg = readConfig()
function writeConfig(patch = {}) {
  const next = { ...cfg }
  for (const k of Object.keys(DEFAULTS)) {
    if (!(k in patch)) continue
    const v = patch[k]
    if (BOOL_KEYS.has(k)) next[k] = Boolean(v)
    else if (NUM_KEYS.has(k)) { const n = Number(v); if (Number.isFinite(n)) next[k] = n }
    else next[k] = String(v ?? '')
  }
  if (![1, 3, 5, 10, 15, 30].includes(next.unloadIdleMinutes)) next.unloadIdleMinutes = 5
  try {
    mkdirSync(HOME, { recursive: true })
    writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8')
    cfg = next
  } catch (e) {
    log('写配置失败：', e && e.message ? e.message : e)
  }
  return cfg
}

// ---- Breeze 引擎（按 root 惰性构建） --------------------------------------
let service = null
let serviceRoot = ''
function engine() {
  if (!cfg.root) throw new Error('请先在设置页填写 Breeze 安装目录。')
  if (service && serviceRoot === cfg.root) return service
  const runtime = readRuntime(cfg.root)   // 读 <root>/breeze-runtime.json 并校验
  service = null
  service = createServiceSafe(runtime)
  serviceRoot = cfg.root
  return service
}
// createService 来自 service.mjs；这里包一层，日志走本插件的 tag。
function createServiceSafe(runtime) {
  return createService({
    runtime,
    log: { info: (m) => log(m), warn: (m) => log('[warn]', m) },
    onDispose: () => {},
  })
}
function voices() {
  // 兜底：模块加载那次没探测到（如配置文件当时还没写好），这里再试一次。
  if (!cfg.root) cfg.root = discoverRoot()
  if (!cfg.root) return PRESETS.map((p) => ({ ...p, ready: false }))
  try {
    return loadPresets(cfg.root).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description || '',
      instruction: p.instruction || p.direction || '',
      seed: p.seed,
      // ready = 本机是否已生成 .breeze 文件
      ready: existsSync(join(cfg.root, 'voices', `${p.id}.breeze`)),
    }))
  } catch (e) {
    throw new Error('读取音色失败：' + (e && e.message ? e.message : e))
  }
}
async function status() {
  if (!cfg.root) return { root: '', configured: false, loaded: false, message: '还没填安装目录' }
  let loaded = false
  try { loaded = Boolean(await engine().health()) } catch { /* 引擎没起来 */ }
  let st = {}
  try { st = await engine().state() } catch { /* 忽略 */ }
  return {
    root: cfg.root,
    configured: true,
    loaded,
    lastLoadedAt: st.lastLoadedAt || 0,
    lastUsedAt: st.lastUsedAt || 0,
    voice: cfg.voice,
  }
}

// ---- 合成：给面板试听 + 给语音注册表用 -----------------------------------
// 返回 WAV 字节。情绪：关键词推断 → 拼指令 → 交给 breeze 引擎。
async function speak(text, voiceId, opts = {}) {
  const svc = engine()
  const textValue = validateText(text)
  const id = String(voiceId || cfg.voice)
  let emo = null
  if (cfg.autoEmotion) {
    const picked = inferEmotion(textValue, opts.mood || '')
    if (picked && picked.key) {
      let instruct = composeInstruction(picked, { backbone: cfg.emotionBackbone })
      let cfgScale = (tuneEmotion(picked.key, picked.intensity || 3).cfg)
      // emotionModel 是预留开关：当前版本用关键词+人设骨架推断，不额外调 LLM，
      // 这样离线也能说话、不会因为模型服务不可用而卡住播报。开关保留供后续接模型判断。
      emo = { instruction: instruct, cfg: cfgScale, name: picked.key }
    }
  }
  try { mkdirSync(SAMPLES, { recursive: true }) } catch { /* 忽略 */ }
  const result = await svc.synth(textValue, id, SAMPLES, emo)
  const bytes = readFileSync(result.file)
  // 清掉引擎写的临时 wav，只留字节（语音注册表/试听都要的是字节）
  try { unlinkSync(result.file) } catch { /* 忽略 */ }
  return { bytes, voice: result.voice, emotion: result.emotion || null }
}

// ---- 空闲卸载 --------------------------------------------------------------
let lastActivity = Date.now()
let idleTimer = null
function touch() { lastActivity = Date.now() }
function startIdleTimer(ctx) {
  if (idleTimer) clearInterval(idleTimer)
  idleTimer = setInterval(async () => {
    try {
      if (!cfg.unloadIdle || !service || serviceRoot !== cfg.root) return
      const st = await service.state()
      if (!st.loaded) return
      const idleMs = Date.now() - Math.max(lastActivity, st.lastUsedAt || 0)
      if (idleMs < cfg.unloadIdleMinutes * 60_000) return
      await service.unload({ reason: 'idle' })
      log('空闲卸载完成（' + cfg.unloadIdleMinutes + ' 分钟无活动）。')
    } catch { /* 卸载失败不影响主流程 */ }
  }, 30_000)
  if (ctx && typeof ctx.effect === 'function') {
    ctx.effect(() => () => { if (idleTimer) { clearInterval(idleTimer); idleTimer = null } }, `${tag}: idle timer`)
  }
}

// ---- HTTP 辅助 -------------------------------------------------------------
function sendJson(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...headers,
  })
  res.end(body)
}
function sendAudio(res, bytes, contentType = 'audio/wav') {
  res.writeHead(200, {
    'content-type': contentType,
    'content-length': bytes.length,
    'cache-control': 'no-store',
  })
  res.end(bytes)
}
function readBody(req) {
  return new Promise((resolveP, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const settle = (fn) => { if (settled) return; settled = true; fn() }
    req.on('data', (c) => {
      size += c.length
      if (size > 2 * 1024 * 1024) { settle(() => reject(Object.assign(new Error('body too large'), { code: 'body-too-large' }))); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => settle(() => resolveP(Buffer.concat(chunks).toString('utf8'))))
    req.on('error', (e) => settle(() => reject(e)))
  })
}

// ---- 语音输出端注册表（本插件的核心价值） --------------------------------
// petApi7340.voice.register 契约：
//   { id(kebab), name, format:'mp3'|'wav', timeoutMs, voices:[{id,name,tag}],
//     synthesize({text, voice, rate, signal}) -> Uint8Array }
// synthesize 收到的 voice 是去掉 "provider/" 前缀的裸 id。
let petDispose = null
let petRef = null
function registerToPet(ctx) {
  try {
    const pet = ctx.get('petApi7340', true)
    if (!pet || !pet.voice || typeof pet.voice.register !== 'function') return false
    petRef = pet
    if (petDispose) { try { petDispose() } catch { /* 忽略 */ } petDispose = null }
    let list = []
    try { list = voices() } catch { list = PRESETS.map((p) => ({ ...p, ready: false })) }
    const def = {
      id: PROVIDER_ID,
      name: '本机 Breeze TTS 2',
      format: 'wav',
      timeoutMs: 200_000,             // 本机合成可能要几十秒，别用默认 15s
      voices: list.map((v) => ({
        id: v.id,
        name: v.name,
        tag: (v.ready ? '本机' : '未建好') + (v.description ? ' · ' + v.description : ''),
      })),
      synthesize: async ({ text, voice: voiceId }) => {
        touch()
        const r = await speak(text, voiceId)
        return r.bytes
      },
    }
    petDispose = pet.voice.register(def)
    log('已把 ' + def.voices.length + ' 个本地音色注册进语音输出端注册表。')
    return true
  } catch (e) {
    log('注册语音输出端失败（dsh-pet 可能没装或晚就绪）：', e && e.message ? e.message : e)
    return false
  }
}

// ---- apply ----------------------------------------------------------------
export function apply(ctx) {
  try { mkdirSync(SAMPLES, { recursive: true }); mkdirSync(CACHE, { recursive: true }) } catch { /* 忽略 */ }
  startIdleTimer(ctx)

  // 首次注册：dsh-pet 若已就绪立刻注册；若晚就绪，随配置变更/路由访问再补。
  registerToPet(ctx)
  if (typeof ctx.inject === 'function') {
    try { ctx.inject(['petApi7340'], () => { registerToPet(ctx) }) } catch { /* 老宿主无此服务 */ }
  }

  // 暴露自己的服务：别的插件也可以 ctx.get('breezeVoice') 直接合成本机语音。
  const serviceApi = Object.freeze({
    listVoices: () => voices(),
    status,
    speak: async (text, voiceId, opts) => { touch(); const r = await speak(text, voiceId, opts); return r },
    refreshRegistration: () => registerToPet(ctx),
  })
  if (typeof ctx.provide === 'function') {
    try { ctx.provide('breezeVoice', serviceApi) } catch (e) { log('provide 失败：', e && e.message ? e.message : e) }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_SEGMENT,
    handler: async (req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://localhost')
        const path = url.pathname.slice(ROUTE_SEGMENT.length) || '/'
        const method = req.method || 'GET'

        // GET /config —— 面板读配置 + 音色清单 + 状态
        if (method === 'GET' && path === '/config') {
          let v = [], s = {}
          try { v = voices() } catch (e) { /* 目录没填或不对 */ v = PRESETS.map((p) => ({ ...p, ready: false })) }
          try { s = await status() } catch { /* 忽略 */ }
          return sendJson(res, 200, { ok: true, config: cfg, voices: v, status: s, home: HOME })
        }

        // POST /config —— 面板写配置（白名单），变更后刷新注册表
        if (method === 'POST' && path === '/config') {
          const body = JSON.parse(await readBody(req) || '{}')
          const patch = {}
          for (const k of Object.keys(DEFAULTS)) if (k in body) patch[k] = body[k]
          writeConfig(patch)
          if (service && serviceRoot !== cfg.root) { service = null; serviceRoot = '' }
          registerToPet(ctx)
          return sendJson(res, 200, { ok: true, config: cfg })
        }

        // GET /voices —— 音色清单（面板下拉数据源）
        if (method === 'GET' && path === '/voices') {
          try { return sendJson(res, 200, { ok: true, voices: voices() }) }
          catch (e) { return sendJson(res, 200, { ok: false, voices: [], message: e.message }) }
        }

        // GET /status —— 显存/加载状态
        if (method === 'GET' && path === '/status') {
          return sendJson(res, 200, { ok: true, ...(await status()) })
        }

        // POST /preview —— 面板试听：{ text, voice } -> wav 字节
        if (method === 'POST' && path === '/preview') {
          const body = JSON.parse(await readBody(req) || '{}')
          touch()
          const r = await speak(String(body.text || '你好呀，我是大肥鱼。'), String(body.voice || cfg.voice))
          return sendAudio(res, r.bytes)
        }

        // POST /unload —— 手动卸载模型释放显存
        if (method === 'POST' && path === '/unload') {
          if (!service || serviceRoot !== cfg.root) {
            // 目录可能刚改，先建引擎（不 ensure，不占显存）
            try { service = engine() } catch (e) { return sendJson(res, 200, { ok: false, message: e.message }) }
          }
          const r = await service.unload({ reason: 'manual' })
          return sendJson(res, 200, { ok: true, ...r })
        }

        // POST /load —— 手动加载模型（ensure 会拉起 breeze-server）
        if (method === 'POST' && path === '/load') {
          try { await engine().ensure(); return sendJson(res, 200, { ok: true, message: '模型已加载。' }) }
          catch (e) { return sendJson(res, 200, { ok: false, message: e.message }) }
        }

        return sendJson(res, 404, { ok: false, message: 'unknown path' })
      } catch (e) {
        const msg = e && e.message ? e.message : String(e)
        log('路由出错：', msg)
        if (!res.writableEnded) return sendJson(res, 500, { ok: false, message: msg })
      }
    },
  }), `${tag}: settings + voice routes`)

  log('就绪。设置页在「设置 → 本地语音」；语音输出端注册表：' + (petRef ? '已接入 dsh-pet' : '等待 dsh-pet / 以 breezeVoice 服务提供'))
}
