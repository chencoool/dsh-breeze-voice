// dsh-breeze-voice —— 宿主半端
// ============================================================================
// 把 Breeze TTS 2 封装成「通用语音输出插件」，两种工作模式：
//   1) 连接模式（connect）：连接本机已运行的「Breeze TTS 2 桌面版」后端
//      （默认 http://127.0.0.1:18099），合成走 /v1/audio/speech（multipart），
//      音色走 /v1/voices，模型/下载/显存全交给桌面版 UI。
//   2) 自管模式（local）：插件自己 spawn breeze-server、读 breeze-runtime.json，
//      合成走 engine/*.mjs（旧行为，兼容 Aurabot 那套安装）。
//   默认 mode='auto'：探测到 18099 活着就自动用连接模式，否则退回自管模式。
// 把音色注册进「语音输出端」注册表：
//   - 首选 dsh-pet 的 petApi7340.voice.register（dsh-pet 的下拉直接认出）
//   - 同时以 breezeVoice 服务暴露给其它插件，谁愿意接都能接
// 只碰输出端（TTS/Voice），不碰任何语音输入识别（STT/Speech）。
// ============================================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { homedir } from 'node:os'

import { readRuntime, loadPresets, PRESETS, validateText, wavBuffer, createService } from './engine/service.mjs'
import { inferEmotion, composeInstruction, tuneEmotion } from './engine/emotion.mjs'

export const name = 'breeze-voice'
// webServer 是内置服务；petApi7340 由 dsh-pet 提供，用 ctx.get 软取（可能晚就绪）。
export const inject = ['webServer']

const ROUTE_SEGMENT = '/api/breeze-voice'
const PROVIDER_ID = 'breeze'
const DEFAULT_ENDPOINT = 'http://127.0.0.1:18099'   // 桌面版后端默认地址
const PROBE_TTL = 8000                              // 存活探测缓存（毫秒）
const HANDSHAKE_TIMEOUT = 1800                      // 探测超时（毫秒）

// ---- 日志 -----------------------------------------------------------------
const tag = '[breeze-voice]'
const log = (...a) => console.log(tag, ...a)

// ---- 数据目录 / 配置 -------------------------------------------------------
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

// 自管模式下 root 没填时，自动从本机已有的语音插件配置里探测 Breeze 安装目录。
// 命中后必须校验 <root>/breeze-runtime.json 存在，避免误认到失效路径。
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
        log('自动发现安装目录（自管模式）：', r, '（来自', f + '）')
        return r
      }
    } catch { /* 这份配置没有 / 读不动，试下一份 */ }
  }
  return ''
}

const DEFAULTS = {
  mode: 'auto',                        // auto | connect | local
  endpoint: DEFAULT_ENDPOINT,          // 桌面版后端地址（connect/auto 用）
  root: '',                            // 自管模式安装目录（含 breeze-runtime.json）
  voice: 'qinglan',                    // 当前音色 id
  autoEmotion: true,                   // 按文本自动挑情绪
  emotionBackbone: true,               // 傲娇底色作为情绪主干
  emotionModel: false,                 // 模型判断情绪（预留开关）
  unloadIdle: true,                    // 空闲自动卸载模型释放显存（仅自管模式）
  unloadIdleMinutes: 5,               // 空闲多久卸载
  rate: 1,                             // 语速（契约保留）
}
const BOOL_KEYS = new Set(['autoEmotion', 'emotionBackbone', 'emotionModel', 'unloadIdle'])
const NUM_KEYS = new Set(['unloadIdleMinutes', 'rate'])
function normMode(v) { return ['auto', 'connect', 'local'].includes(v) ? v : 'auto' }
function normEndpoint(v) { return typeof v === 'string' && v.trim() ? v.trim().replace(/\/+$/, '') : DEFAULT_ENDPOINT }

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
  cfg.mode = normMode(cfg.mode)
  cfg.endpoint = normEndpoint(cfg.endpoint)
  if (![1, 3, 5, 10, 15, 30].includes(cfg.unloadIdleMinutes)) cfg.unloadIdleMinutes = 5
  if (!cfg.root) cfg.root = discoverRoot()   // 内存生效，不擅自落盘
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
  next.mode = normMode(next.mode)
  next.endpoint = normEndpoint(next.endpoint)
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

// ---- 工作模式判定（auto：探测桌面版后端） ---------------------------------
let probeCache = { t: 0, ep: '', ok: false }
async function endpointAlive() {
  const ep = cfg.endpoint || DEFAULT_ENDPOINT
  if (probeCache.ep === ep && Date.now() - probeCache.t < PROBE_TTL) return probeCache.ok
  let ok = false
  try {
    const res = await fetch(ep + '/health', { signal: AbortSignal.timeout(HANDSHAKE_TIMEOUT) })
    ok = Boolean(res && res.ok)
  } catch { /* 没连上 */ }
  probeCache = { t: Date.now(), ep, ok }
  return ok
}
async function activeMode() {
  if (cfg.mode === 'connect') return 'connect'
  if (cfg.mode === 'local') return 'local'
  return (await endpointAlive()) ? 'connect' : 'local'
}

// ---- 自管模式引擎（按 root 惰性构建） --------------------------------------
let service = null
let serviceRoot = ''
function engine() {
  if (!cfg.root) throw new Error('自管模式请先填写 Breeze 安装目录。')
  if (service && serviceRoot === cfg.root) return service
  const runtime = readRuntime(cfg.root)   // 读 <root>/breeze-runtime.json 并校验
  service = null
  service = createServiceSafe(runtime)
  serviceRoot = cfg.root
  return service
}
function createServiceSafe(runtime) {
  return createService({
    runtime,
    log: { info: (m) => log(m), warn: (m) => log('[warn]', m) },
    onDispose: () => {},
  })
}

// ---- 音色清单 --------------------------------------------------------------
// 统一结构：{id, name, description, instruction, seed, ready, kind, refId?}
//   kind='instruction' → 合成时发 instruction（内置描述式音色 / 自管预设）
//   kind='reference'   → 合成时发 voice_id（桌面版参考音频克隆音色）
let voiceCache = PRESETS.map((p) => ({ ...p, ready: false, kind: 'instruction' }))

function localVoices() {
  if (!cfg.root) cfg.root = discoverRoot()
  if (!cfg.root) return PRESETS.map((p) => ({ ...p, ready: false, kind: 'instruction' }))
  try {
    return loadPresets(cfg.root).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description || '',
      instruction: p.instruction || p.direction || '',
      seed: p.seed,
      ready: existsSync(join(cfg.root, 'voices', `${p.id}.breeze`)),
      kind: 'instruction',
    }))
  } catch (e) {
    throw new Error('读取音色失败：' + (e && e.message ? e.message : e))
  }
}

async function connectVoices() {
  const ep = cfg.endpoint || DEFAULT_ENDPOINT
  const res = await fetch(ep + '/v1/voices', { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error('桌面版音色接口 HTTP ' + res.status)
  const arr = await res.json()
  // 内置描述式音色（桌面版「音色设计」就是靠 instruction 合成，无需 voice_id）
  const base = PRESETS.map((p) => ({
    id: p.id, name: p.name, description: p.description || '',
    instruction: p.instruction || '', seed: p.seed, ready: true, kind: 'instruction',
  }))
  const ids = new Set(base.map((v) => v.id))
  const refs = []
  for (const v of (Array.isArray(arr) ? arr : [])) {
    if (!v || !v.id) continue
    const id = String(v.id)
    if (ids.has(id)) continue
    ids.add(id)
    const desc = v.description
      ? String(v.description)
      : (v.ref_text ? '「' + String(v.ref_text).slice(0, 30) + '」' : '桌面版克隆音色')
    refs.push({
      id, name: String(v.name || id), description: desc,
      instruction: '', seed: 0, ready: true, kind: 'reference', refId: id,
    })
  }
  return [...base, ...refs]
}

async function voices() {
  const m = await activeMode()
  try {
    const list = (m === 'connect') ? await connectVoices() : localVoices()
    voiceCache = list
    return list
  } catch (e) {
    if (m === 'connect') {
      // 桌面版临时没起来：退回自管清单，至少下拉不空
      try { const l = localVoices(); voiceCache = l; return l } catch { /* 继续兜底 */ }
    }
    const l = PRESETS.map((p) => ({ ...p, ready: false, kind: 'instruction' }))
    voiceCache = l
    return l
  }
}

// ---- 状态 -----------------------------------------------------------------
async function status() {
  const m = await activeMode()
  if (m === 'connect') {
    const ep = cfg.endpoint || DEFAULT_ENDPOINT
    let loaded = false, message = ''
    try {
      const res = await fetch(ep + '/health', { signal: AbortSignal.timeout(3000) })
      loaded = Boolean(res && res.ok)
      message = loaded ? '已连接桌面版 Breeze 服务' : '桌面版服务未响应'
    } catch (e) {
      message = '连不上桌面版：' + (e && e.message ? e.message : e)
    }
    return { mode: 'connect', endpoint: ep, root: '', configured: true, loaded, message, voice: cfg.voice }
  }
  if (!cfg.root) return { mode: 'local', root: '', configured: false, loaded: false, message: '还没填安装目录', voice: cfg.voice }
  let loaded = false
  try { loaded = Boolean(await engine().health()) } catch { /* 引擎没起来 */ }
  let st = {}
  try { st = await engine().state() } catch { /* 忽略 */ }
  return {
    mode: 'local', root: cfg.root, configured: true, loaded,
    lastLoadedAt: st.lastLoadedAt || 0, lastUsedAt: st.lastUsedAt || 0, voice: cfg.voice,
  }
}

// ---- 情绪 -----------------------------------------------------------------
function emotionFor(textValue, opts = {}) {
  if (!cfg.autoEmotion) return null
  const picked = inferEmotion(textValue, opts.mood || '')
  if (!picked || !picked.key) return null
  const instruct = composeInstruction(picked, { backbone: cfg.emotionBackbone })
  const cfgScale = tuneEmotion(picked.key, picked.intensity || 3).cfg
  // emotionModel 是预留开关：当前版本用关键词+人设骨架推断，不额外调 LLM，
  // 保证离线也能说话。开关保留供后续接模型判断。
  return { instruction: instruct, cfg: cfgScale, name: picked.key }
}

// ---- 合成 -----------------------------------------------------------------
async function speak(text, voiceId, opts = {}) {
  const m = await activeMode()
  const textValue = validateText(text)
  const emo = emotionFor(textValue, opts)
  if (m === 'connect') return speakConnect(textValue, voiceId, emo, opts)
  return speakLocal(textValue, voiceId, emo)
}

// 自管模式：走 engine/*.mjs，读 wav 字节后删临时文件。
async function speakLocal(textValue, voiceId, emo) {
  const svc = engine()
  const id = String(voiceId || cfg.voice)
  try { mkdirSync(SAMPLES, { recursive: true }) } catch { /* 忽略 */ }
  const result = await svc.synth(textValue, id, SAMPLES, emo)
  const bytes = readFileSync(result.file)
  try { unlinkSync(result.file) } catch { /* 忽略 */ }
  return { bytes, voice: result.voice, emotion: result.emotion || null }
}

// 连接模式：multipart POST 到桌面版后端，拿裸 PCM，封成 WAV 字节。
async function speakConnect(textValue, voiceId, emo, opts = {}) {
  const ep = cfg.endpoint || DEFAULT_ENDPOINT
  const id = String(voiceId || cfg.voice)
  let list = voiceCache
  let v = (list || []).find((x) => x.id === id)
  // 缓存未命中时主动刷新一次音色目录：dsh-pet 未启用或首次合成时，voiceCache
  // 可能还是内置 PRESETS，桌面版克隆音色会被误当描述式音色、丢掉 voice_id。
  if (!v) {
    try { list = await voices() } catch { /* 保留旧缓存继续 */ }
    v = (list || []).find((x) => x.id === id)
  }

  const form = new FormData()
  form.append('text', textValue)
  if (v && v.kind === 'reference' && v.refId) {
    // 克隆音色：带 voice_id；同时把情绪指令附上（桌面版表单允许两者共存）
    form.append('voice_id', v.refId)
    if (emo) form.append('instruction', emo.instruction)
  } else {
    // 描述式音色：用预设 instruction，或自动情绪拼出的指令
    const instr = (emo && emo.instruction) || (v && v.instruction) || ''
    if (instr) form.append('instruction', instr)
  }

  const signal = opts.signal || AbortSignal.timeout(200_000)
  const res = await fetch(ep + '/v1/audio/speech', { method: 'POST', body: form, signal })
  if (!res.ok) {
    let t = ''
    try { t = await res.text() } catch { /* 忽略 */ }
    throw new Error('桌面版合成失败 HTTP ' + res.status + (t ? '：' + t.slice(0, 200) : ''))
  }
  const pcm = Buffer.from(await res.arrayBuffer())
  const bytes = wavBuffer(pcm)   // 24kHz/mono/16bit 裸 PCM → WAV（两种模式同规格）
  return { bytes, voice: id, emotion: emo ? emo.name : null }
}

// ---- 空闲卸载（仅自管模式有意义） ------------------------------------------
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
async function registerToPet(ctx) {
  try {
    const pet = ctx.get('petApi7340', true)
    if (!pet || !pet.voice || typeof pet.voice.register !== 'function') return false
    petRef = pet
    if (petDispose) { try { petDispose() } catch { /* 忽略 */ } petDispose = null }
    let list = []
    try { list = await voices() } catch { list = PRESETS.map((p) => ({ ...p, ready: false })) }
    const mode = await activeMode()
    const def = {
      id: PROVIDER_ID,
      name: '本机 Breeze TTS 2',
      format: 'wav',
      timeoutMs: 200_000,             // 本机合成可能要几十秒，别用默认 15s
      voices: list.map((v) => ({
        id: v.id,
        name: v.name,
        tag: (v.kind === 'reference' ? '桌面版' : (v.ready ? '本机' : '未建好')) + (v.description ? ' · ' + v.description : ''),
      })),
      synthesize: async ({ text, voice: voiceId, signal }) => {
        touch()
        const r = await speak(text, voiceId, { signal })
        return r.bytes
      },
    }
    petDispose = pet.voice.register(def)
    log('已把 ' + def.voices.length + ' 个音色注册进语音输出端注册表（' + mode + ' 模式）。')
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

  // 暴露自己的服务：别的插件也可以 ctx.get('breezeVoice') 直接合成语音。
  // listVoices 保持同步契约：返回最近一次刷新缓存的清单。
  const serviceApi = Object.freeze({
    listVoices: () => voiceCache,
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
          try { v = await voices() } catch { v = PRESETS.map((p) => ({ ...p, ready: false })) }
          try { s = await status() } catch { /* 忽略 */ }
          return sendJson(res, 200, { ok: true, config: cfg, voices: v, status: s, home: HOME })
        }

        // POST /config —— 面板写配置（白名单），变更后刷新注册表
        if (method === 'POST' && path === '/config') {
          const body = JSON.parse(await readBody(req) || '{}')
          const patch = {}
          for (const k of Object.keys(DEFAULTS)) if (k in body) patch[k] = body[k]
          writeConfig(patch)
          probeCache = { t: 0, ep: '', ok: false }   // 端点/模式可能变了，作废探测缓存
          if (service && serviceRoot !== cfg.root) { service = null; serviceRoot = '' }
          await registerToPet(ctx)
          return sendJson(res, 200, { ok: true, config: cfg })
        }

        // GET /voices —— 音色清单（面板下拉数据源）
        if (method === 'GET' && path === '/voices') {
          try { return sendJson(res, 200, { ok: true, voices: await voices() }) }
          catch (e) { return sendJson(res, 200, { ok: false, voices: [], message: e.message }) }
        }

        // GET /status —— 连接/加载状态
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

        // POST /unload —— 手动卸载模型释放显存（仅自管模式）
        if (method === 'POST' && path === '/unload') {
          if ((await activeMode()) === 'connect') {
            return sendJson(res, 200, { ok: true, message: '连接模式：模型由桌面版管理，请在桌面版界面卸载/切换。' })
          }
          if (!service || serviceRoot !== cfg.root) {
            try { service = engine() } catch (e) { return sendJson(res, 200, { ok: false, message: e.message }) }
          }
          const r = await service.unload({ reason: 'manual' })
          return sendJson(res, 200, { ok: true, ...r })
        }

        // POST /load —— 手动加载模型（仅自管模式）
        if (method === 'POST' && path === '/load') {
          if ((await activeMode()) === 'connect') {
            return sendJson(res, 200, { ok: true, message: '连接模式：模型由桌面版管理，请在桌面版界面加载/切换。' })
          }
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
