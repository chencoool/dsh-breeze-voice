// dsh-breeze-voice —— 宿主半端
// ============================================================================
// 把 Breeze TTS 2 封装成「通用语音输出插件」，两种工作模式：
//   1) 连接模式（connect）：连接本机已运行的「Breeze TTS 2 桌面版」后端
//      （默认 http://127.0.0.1:18099），合成走 /v1/audio/speech（multipart），
//      音色走 /v1/voices，模型/下载/显存全交给桌面版 UI。
//   2) 自管模式（local）：插件自己 spawn breeze-server、读 breeze-runtime.json，
//      合成走 engine/*.mjs（用装在本机的 Breeze 引擎，不依赖桌面版）。
//   默认 mode='auto'：探测到 18099 活着就自动用连接模式，否则退回自管模式。
// 把音色注册进「语音输出端」注册表：
//   - 首选 dsh-pet 的 petApi7340.voice.register（dsh-pet 的下拉直接认出）
//   - 同时以 breezeVoice 服务暴露给其它插件，谁愿意接都能接
// 只碰输出端（TTS/Voice），不碰任何语音输入识别（STT/Speech）。
// ============================================================================

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, isAbsolute, relative } from 'node:path'
import { homedir } from 'node:os'
import { execSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'

import { readRuntime, loadPresets, PRESETS, validateText, wavBuffer, createService } from './engine/service.mjs'
import { inferEmotion, composeInstruction, tuneEmotion, TONE_SYSTEM, buildTonePrompt, cleanTone } from './engine/emotion.mjs'

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

// 自管模式下 root 没填时，扫描本机各插件数据目录里的配置，探测 Breeze 安装目录。
// 任何语音插件只要按 { voice: { breeze: { root } } } 记过目录都能被发现；
// 命中后校验：<root>/breeze-runtime.json 存在，或桌面版布局（resources/runtime 下有
// breeze-server.exe）——后者由 engine() 自动补写配置，所以这里也认。
function looksLikeBreezeRoot(r) {
  if (typeof r !== 'string' || !isAbsolute(r)) return false
  if (existsSync(join(r, 'breeze-runtime.json'))) return true
  if (existsSync(join(r, 'resources', 'runtime', 'breeze-server.exe'))) return true
  if (existsSync(join(r, 'breeze-server.exe'))) return true
  return false
}
function discoverRoot() {
  const bases = [
    join(homedir(), '.dsh', 'plugins-data'),
    join(profileDir(), 'plugins-data'),
    join(homedir(), '.dsh', 'profiles', 'desktop', 'plugins-data'),
  ]
  const seen = new Set()
  for (const base of bases) {
    let entries = []
    try { entries = readdirSync(base, { withFileTypes: true }) } catch { continue }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      const f = join(base, ent.name, 'config.json')
      try {
        const j = JSON.parse(readFileSync(f, 'utf8'))
        const r = j && j.voice && j.voice.breeze && j.voice.breeze.root
        if (typeof r === 'string' && isAbsolute(r) && !seen.has(r) && looksLikeBreezeRoot(r)) {
          seen.add(r)
          log('自动发现安装目录（自管模式）：', r, '（来自', f + '）')
          return r
        }
      } catch { /* 这份配置没有 / 读不动，试下一份 */ }
    }
  }
  return ''
}

// ---- 桌面版安装检测（查 Windows 卸载注册表） -------------------------------
// 桌面版安装包会写卸载项，DisplayName 精确为 "Breeze TTS 2"。从 UninstallString
// 里提引号内的卸载器路径、去掉末段文件名，就是安装目录。三个 hive 依次查。
// 不持久化任何"装没装"标记：卸载后注册表项消失，重启 DSH 自然回到待安装态。
const DESKTOP_UNINSTALL_HIVES = [
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
]
function dirFromUninstallString(s) {
  if (!s) return ''
  const quoted = s.match(/"([^"]+)"/)
  const p = (quoted ? quoted[1] : s.trim().split(/\s+\//)[0]).trim()
  return p.replace(/[\\/][^\\/]+$/, '') || ''
}
function detectDesktopInstall() {
  for (const hive of DESKTOP_UNINSTALL_HIVES) {
    let txt = ''
    try {
      txt = execSync(`reg query "${hive}" /s /f "Breeze TTS 2"`, {
        encoding: 'utf8', timeout: 6000, windowsHide: true,
      })
    } catch { continue }   // 这个 hive 没找到 / reg 不可用，试下一个
    const blocks = txt.split(/HKEY_/).slice(1)
    for (const block of blocks) {
      if (!/DisplayName\s+REG_SZ\s+Breeze TTS 2\b/i.test(block)) continue
      const un = block.match(/UninstallString\s+REG_SZ\s+(.+)/i)
      const ic = block.match(/DisplayIcon\s+REG_SZ\s+(.+)/i)
      const ver = block.match(/DisplayVersion\s+REG_SZ\s+(.+)/i)
      const uninstall = un ? un[1].trim() : ''
      const icon = ic ? ic[1].trim() : ''
      const dir = dirFromUninstallString(uninstall) || dirFromUninstallString(icon)
      return {
        installed: true,
        version: ver ? ver[1].trim() : '',
        dir,
        uninstall,
      }
    }
  }
  return { installed: false, version: '', dir: '', uninstall: '' }
}

const DEFAULTS = {
  mode: 'auto',                        // auto | connect | local
  endpoint: DEFAULT_ENDPOINT,          // 桌面版后端地址（connect/auto 用）
  root: '',                            // 自管模式安装目录（含 breeze-server.exe；缺配置时自动补写）
  voice: 'qinglan',                    // 当前音色 id
  toneMode: 'keyword',                 // 情绪处理方式：off(关) | keyword(关键词推断,0token) | model(关键词+模型润色语气)
  unloadIdle: true,                    // 空闲自动卸载模型释放显存（仅自管模式）
  unloadIdleMinutes: 5,               // 空闲多久卸载
  rate: 1,                             // 语速（契约保留）
}
const BOOL_KEYS = new Set(['unloadIdle'])
const NUM_KEYS = new Set(['unloadIdleMinutes', 'rate'])
function normMode(v) { return ['auto', 'connect', 'local'].includes(v) ? v : 'auto' }
function normEndpoint(v) { return typeof v === 'string' && v.trim() ? v.trim().replace(/\/+$/, '') : DEFAULT_ENDPOINT }
function normTone(v) { return ['off', 'keyword', 'model'].includes(v) ? v : 'keyword' }
// 旧三开关（autoEmotion/emotionBackbone/emotionModel）→ 单一 toneMode 的迁移。
function migrateTone(file, fallback) {
  if ('toneMode' in file) return normTone(file.toneMode)
  if (file.autoEmotion === false) return 'off'
  if (file.emotionModel === true) return 'model'
  return fallback
}

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
  cfg.toneMode = migrateTone(file, cfg.toneMode)   // 兼容旧三开关配置
  if (![1, 3, 5, 10, 15, 30].includes(cfg.unloadIdleMinutes)) cfg.unloadIdleMinutes = 5
  if (!cfg.root) {
    // 先扫各插件配置里记过的目录；没有再从 Windows 卸载注册表认桌面版安装目录。
    // 这样桌面版装好后重启 DSH，链路零点击自动配好（仅在用户没手填 root 时补）。
    cfg.root = discoverRoot()
    if (!cfg.root) {
      try {
        const inst = detectDesktopInstall()
        if (inst.installed && looksLikeBreezeRoot(inst.dir)) cfg.root = inst.dir
      } catch { /* reg 不可用则跳过 */ }
    }
  }
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
  next.toneMode = migrateTone(patch, next.toneMode)
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
  ensureDesktopRuntime(cfg.root)          // 桌面版布局缺配置时自动补一份（已有则不动）
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

// ---- 桌面版布局 → 自动补写 breeze-runtime.json ------------------------------
// 桌面版（含图形界面的安装包）本身不带 breeze-runtime.json：它靠 model-path.txt
// + 命令行参数启动后端。自管模式需要这份 json 才能拿到 exe/model 路径，所以在
// 发现是桌面版布局时按真实结构补一份，让用户不必手写。只补缺失的，绝不覆盖已有。
// 只返回 root 目录内的模型绝对路径（引擎的 file() 不允许模型跑到根目录之外）。
function desktopModel(root) {
  const inside = (p) => {
    const r = relative(root, p)
    return !!r && !r.startsWith('..') && !isAbsolute(r)
  }
  // 1) model-path.txt 第一行（桌面版切换模型时写的绝对路径），仅当它就在安装目录内
  try {
    const m = readFileSync(join(root, 'model-path.txt'), 'utf8').split(/\r?\n/)[0].trim()
    if (m && isAbsolute(m) && inside(m) && existsSync(m) && /\.gguf$/i.test(m)) return m
  } catch { /* 没有标记文件 */ }
  // 2) 扫安装目录里常见模型位置，优先推荐档 q4_k
  const dirs = [join(root, 'models'), join(root, 'resources', 'runtime'), root]
  const found = []
  for (const d of dirs) {
    try {
      for (const name of readdirSync(d)) {
        const full = join(d, name)
        if (/\.gguf$/i.test(name) && inside(full) && existsSync(full)) found.push(full)
      }
    } catch { /* 目录不存在 */ }
  }
  if (!found.length) return ''
  found.sort((a, b) => {
    const pa = /q4_k\.gguf$/i.test(a) ? 0 : 1
    const pb = /q4_k\.gguf$/i.test(b) ? 0 : 1
    return pa - pb
  })
  return found[0]
}
function ensureDesktopRuntime(root) {
  if (!root) return false
  if (existsSync(join(root, 'breeze-runtime.json'))) return true   // 已有，绝不覆盖
  // 桌面版引擎在 resources/runtime 下；也兼容引擎就在根目录的旧布局
  const exe = existsSync(join(root, 'resources', 'runtime', 'breeze-server.exe'))
    ? join(root, 'resources', 'runtime', 'breeze-server.exe')
    : (existsSync(join(root, 'breeze-server.exe')) ? join(root, 'breeze-server.exe') : '')
  if (!exe) return false                                          // 不是 Breeze 安装目录
  const model = desktopModel(root)
  if (!model) { log('桌面版安装未找到模型，无法自动补写配置：', root); return false }
  const json = {
    root,
    port: 18370,                                                  // 自管用自己的端口，避开桌面版 18099
    exe: relative(root, exe).replace(/\\/g, '/'),
    model: relative(root, model).replace(/\\/g, '/'),
    disableCoopmat: false,
  }
  try {
    writeFileSync(join(root, 'breeze-runtime.json'), JSON.stringify(json, null, 2), 'utf8')
    log('已按桌面版布局自动补写 breeze-runtime.json：', root)
    return true
  } catch (e) {
    log('自动补写配置失败：', e && e.message ? e.message : e)
    return false
  }
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

// ---- 情绪（L0 关 / L1 关键词 / L2 关键词+模型润色语气） --------------------
// 人设/性格不在这里——那属于聊天插件那层。本模块只把「这句怎么念」交给你选的音色。
let currentCtx = null                 // apply() 注入，L2 用它取宿主 llm 服务
const instructionCache = new Map()    // key=sha1(text+心情档+音色) → {t, text}，10 分钟 / 200 条 FIFO
const TONE_TTL = 10 * 60_000

// 心情来自聊天插件（Aurabot）落盘的 mood.json：{ value, reason, ... }。
// 路径与 Aurabot 的 dataDir() 对齐：AURABOT_DATA_DIR 优先，其次 DSH_HOME/plugins-data/aurabot。
function moodFile() {
  if (process.env.AURABOT_DATA_DIR && isAbsolute(process.env.AURABOT_DATA_DIR)) {
    return join(process.env.AURABOT_DATA_DIR, 'mood.json')
  }
  const dshHome = (process.env.DSH_HOME && isAbsolute(process.env.DSH_HOME))
    ? process.env.DSH_HOME : join(homedir(), '.dsh')
  return join(dshHome, 'plugins-data', 'aurabot', 'mood.json')
}
function moodLabelOf(value) {
  const v = Number(value)
  if (!Number.isFinite(v)) return ''
  if (v >= 85) return '超开心'
  if (v >= 70) return '心情不错'
  if (v >= 50) return '平平常常'
  if (v >= 35) return '有点低落'
  return '不太开心'
}
function readMood() {
  try {
    const j = JSON.parse(readFileSync(moodFile(), 'utf8'))
    const value = Number(j && j.value)
    if (!Number.isFinite(value)) return null
    return { value, label: moodLabelOf(value), reason: String(j.reason || '') }
  } catch { return null }   // 没装 / 没写 / 读不动都当没有心情，退回纯文本线索
}

// L2：只让模型把已知心情+文字翻成一句语气提示，绝不让它重判情绪、绝不输出 JSON。
async function askTone(prompt) {
  const ctx = currentCtx
  if (!ctx || typeof ctx.get !== 'function') return ''
  const llm = ctx.get('llm', true) || ctx.llm
  if (!llm || typeof llm.stream !== 'function') return ''
  let sel = null
  try {
    const svc = ctx.get('agentDefaultModel', true)
    if (svc && typeof svc.currentSelection === 'function') sel = svc.currentSelection()
  } catch { /* 拿不到默认模型就放弃润色 */ }
  if (!sel || !sel.provider || !sel.model) return ''
  const messages = [{
    role: 'user', id: randomUUID(),
    content: [{ type: 'text', text: prompt }],
    source: { kind: 'plugin', plugin: 'breeze-voice' },
  }]
  let out = ''
  // 不传 reasoningEffort：本地/无推理元数据的模型收到它会整轮报错。
  for await (const chunk of llm.stream({
    provider: sel.provider, model: sel.model,
    system: TONE_SYSTEM, messages, maxTokens: 120, temperature: 0.5,
  })) {
    if (!chunk) continue
    if (chunk.type === 'text-delta') out += chunk.text || ''
    if (chunk.type === 'finish' && chunk.reason && chunk.reason.kind === 'error') throw new Error('模型报错')
  }
  return cleanTone(out)
}

async function emotionFor(textValue, opts = {}) {
  if (cfg.toneMode === 'off') return null
  const mood = (cfg.toneMode === 'model') ? readMood() : null
  const picked = inferEmotion(textValue, mood ? mood.label : '')
  if (!picked || !picked.key) return null
  let instruct = composeInstruction(picked)   // L1：档位语气（离线、零 token）
  const cfgScale = tuneEmotion(picked.key, picked.intensity || 3).cfg

  if (cfg.toneMode === 'model') {
    const voice = opts.voice || null
    const key = createHash('sha1')
      .update([textValue, mood ? mood.label : '', String(voice && voice.id || '')].join('|'))
      .digest('hex')
    const hit = instructionCache.get(key)
    if (hit && Date.now() - hit.t < TONE_TTL) {
      instruct = hit.text                       // 缓存命中：0 token、0 延迟
    } else {
      try {
        const prompt = buildTonePrompt(textValue, mood, voice)
        const tone = await askTone(prompt)
        if (tone) {
          instruct = tone                       // 模型现写的自然语言语气提示
          instructionCache.set(key, { t: Date.now(), text: tone })
          if (instructionCache.size > 200) instructionCache.delete(instructionCache.keys().next().value)
        }
      } catch (e) {
        log('语气润色失败，退回关键词档位：', e && e.message ? e.message : e)
      }
    }
  }
  return { instruction: instruct, cfg: cfgScale, name: picked.key }
}

// ---- 合成 -----------------------------------------------------------------
// 连接模式的合成队列：桌面版后端同一时刻适合只跑一个合成任务。先触发的先合成，
// 后触发的排队，前一个完成（成功或失败）再接续下一个。行为与自管模式
// engine/service.mjs 的 queue promise 链一致；两种模式互斥、各用各的队列，互不影响。
let connectQueue = Promise.resolve()
async function speak(text, voiceId, opts = {}) {
  const m = await activeMode()
  const textValue = validateText(text)
  const id = String(voiceId || cfg.voice)
  const v = (voiceCache || []).find((x) => x.id === id) || null
  const emo = await emotionFor(textValue, { ...opts, voice: v })
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

  // 挂到连接模式队列：先触发的先合成，后面的在链上排队，前一个完成/失败再接续下一个。
  // 超时计时从排到队、真正开始合成时才启动——排队等待不消耗 200 秒预算。
  // 若调用方自带 signal（如取消），排队阶段也监听它，取消后轮到自己时立即放弃。
  const job = connectQueue.then(async () => {
    if (opts.signal && opts.signal.aborted) throw new Error('合成已取消。')
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
  })
  // 无论成功失败都让队列继续，前一个失败不影响后一个（与自管模式 queue.catch 一致）。
  connectQueue = job.catch(() => {})
  return job
}

// ---- 音色库管理 ------------------------------------------------------------
// 「添加音色」本质是桌面版后端的参考音频克隆能力（POST /v1/voices）。插件把
// 客户端的 multipart 原样转发给桌面版，音色文件由桌面版自己写进它的 voices\ 库——
// 这样桌面版界面和本插件看到的是同一份音色，换音色两边都认。无论工作模式，
// 添加/删除音色都需要桌面版后端在线（local 旧布局没有这个服务会明确报错）。
async function addVoice(req) {
  const ep = cfg.endpoint || DEFAULT_ENDPOINT
  const buf = await readBodyBuffer(req)
  const ct = (req.headers && req.headers['content-type']) || 'multipart/form-data'
  let res
  try {
    res = await fetch(ep + '/v1/voices', {
      method: 'POST',
      headers: { 'content-type': ct },
      body: buf,
      signal: AbortSignal.timeout(120_000),
    })
  } catch (e) {
    throw new Error('连不上桌面版后端（' + ep + '），请先启动 Breeze TTS 2 桌面版：' + (e && e.message ? e.message : e))
  }
  let text = ''
  try { text = await res.text() } catch { /* 忽略 */ }
  if (!res.ok) throw new Error('桌面版创建音色失败 HTTP ' + res.status + (text ? '：' + text.slice(0, 200) : ''))
  try { await voices() } catch { /* 忽略：下次访问会再刷 */ }
  return text || '{"ok":true}'
}

async function deleteVoice(id) {
  const ep = cfg.endpoint || DEFAULT_ENDPOINT
  if (!id) throw new Error('缺少音色 id')
  let res
  try {
    res = await fetch(ep + '/v1/voices/' + encodeURIComponent(id), {
      method: 'DELETE',
      signal: AbortSignal.timeout(30_000),
    })
  } catch (e) {
    throw new Error('连不上桌面版后端（' + ep + '）：' + (e && e.message ? e.message : e))
  }
  let text = ''
  try { text = await res.text() } catch { /* 忽略 */ }
  if (!res.ok) throw new Error('桌面版删除音色失败 HTTP ' + res.status + (text ? '：' + text.slice(0, 200) : ''))
  try { await voices() } catch { /* 忽略 */ }
  return text || '{"ok":true}'
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
// 读二进制请求体（添加音色的 multipart 参考音频用），上限 12MB。
function readBodyBuffer(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolveP, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const settle = (fn) => { if (settled) return; settled = true; fn() }
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { settle(() => reject(Object.assign(new Error('音频太大（上限 12MB）'), { code: 'body-too-large' }))); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => settle(() => resolveP(Buffer.concat(chunks))))
    req.on('error', (e) => settle(() => reject(e)))
  })
}

// ---- 接入其它本地语音插件（只检测 + 给手动接入指引，绝不写别人插件目录） ------
// 已收录的私有接口才自动接：dsh-pet 的 petApi7340.voice.register 是它自己的私有服务，
// 本插件主动适配、接好了（并非 DSH 核心通用标准，核心层根本没有 TTS 注册 seam）。
// 其它插件（如 Aurabot）用它自带的「其他 HTTP 接口」手动接入：本插件给出参数，
// 用户自己填。绝不往别人插件目录写脚本——那会绕开它原来的音色/情绪设置，把
// "那个人"念成另一个味儿。云端 TTS 插件不在范围（本插件只做本地语音）。

// 运行中宿主进程里 profileDir()/DSH_PROFILE_DIR 未必指向真正装包的目录：
// 桌面端常见情况是宿主 profileDir()=~/.dsh，而包实际装在 ~/.dsh/profiles/<name>/node_modules。
// 所以把所有可能的 node_modules 根都扫一遍，去重，别赌单一路径。
function nodeModulesBases() {
  const bases = []
  const add = (p) => { if (p && isAbsolute(p) && existsSync(p) && !bases.includes(p)) bases.push(p) }
  add(join(profileDir(), 'node_modules'))
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  add(join(dshHome, 'node_modules'))
  const profilesDir = join(dshHome, 'profiles')
  try {
    for (const ent of readdirSync(profilesDir, { withFileTypes: true })) {
      if (ent.isDirectory()) add(join(profilesDir, ent.name, 'node_modules'))
    }
  } catch { /* 没有 profiles 目录 */ }
  return bases
}

/** 扫描 node_modules 里的本地语音相关插件，返回检测清单。 */
function scanVoicePlugins() {
  const dirs = []
  for (const base of nodeModulesBases()) {
    let top = []
    try { top = readdirSync(base, { withFileTypes: true }) } catch { continue }
    for (const ent of top) {
      if (!ent.isDirectory()) continue
      if (ent.name.startsWith('@')) {
        let subs = []
        try { subs = readdirSync(join(base, ent.name), { withFileTypes: true }) } catch { continue }
        for (const s of subs) if (s.isDirectory()) dirs.push(join(base, ent.name, s.name))
      } else dirs.push(join(base, ent.name))
    }
  }
  const out = []
  const seen = new Set()
  for (const dir of dirs) {
    let pkg = {}
    try { pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) || {} } catch { continue }
    const name = String(pkg.name || '')
    if (!name || name === '@local/dsh-breeze-voice' || name === 'dsh-breeze-voice') continue
    if (seen.has(name)) continue
    seen.add(name)
    // 只列"本地语音、且有接入抓手"的插件：云端 TTS（edge / breeze 云 API）一律不算。
    // 抓手有两类：dsh-pet 已收录的私有 voice 注册表；aurabot 那种 src/local/local.js 本地接口。
    const hasLocalApi = existsSync(join(dir, 'src', 'local', 'local.js'))
    const isPet = /dsh-pet/i.test(name)
    if (!isPet && !hasLocalApi) continue
    const item = {
      id: name, packageName: name,
      name: String(pkg.description || name).slice(0, 48),
      kind: 'manual', status: 'manual',
      detail: '未发现对外注册口，需该插件作者接入 breezeVoice 服务',
      dataDir: '',
    }
    if (isPet) {
      item.kind = 'pet'
      item.status = 'auto'
      item.detail = '已自动接入（petApi7340.voice.register）'
    } else if (hasLocalApi) {
      // 有「本地接口」机制的插件（如 Aurabot）：不写它的目录，只给手动接入指引。
      // 用它自带的「其他 HTTP 接口」指向本插件 /preview，音色/情绪仍归本插件设置页管。
      item.kind = 'manual-http'
      item.status = 'manual'
      item.detail = '用它面板里的「其他 HTTP 接口」手动接入，参数见下方（本插件不改动它的任何文件）'
    }
    out.push(item)
  }
  return out
}

// ---- 端口自动同步 --------------------------------------------------------
// DSH 每次重启 web 端口都变（OS 随机分配），aurabot「其他 HTTP 接口」里手填的
// urlTemplate 是死字符串，重启即失效。这里在以下条件**全部满足**时才改它：
//   ① aurabot 的 voice.engine === 'http'（用户自己选了「其他 HTTP 接口」）
//   ② 它的 urlTemplate 已经指向本插件 /api/breeze-voice/preview（说明用户接过）
//   ③ urlTemplate 里的端口确实和当前端口不同
// 只改 voice.http.urlTemplate 这一个字段，engine/音色/情绪/请求体一概不碰。
// 走 aurabot 官方 POST /aurabot/api/save（同一 web 端口），同时更新它的内存配置
// 和 config.json——直接改文件没用，它配置只在启动时读一次。
function aurabotConfigFile() {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const dir = process.env.AURABOT_DATA_DIR || join(dshHome, 'plugins-data', 'aurabot')
  return join(dir, 'config.json')
}

function readAurabotJson() {
  try { return JSON.parse(readFileSync(aurabotConfigFile(), 'utf8')) || null } catch { return null }
}

const URL_FEATURE = ROUTE_SEGMENT + '/preview'   // /api/breeze-voice/preview

async function syncAurabotPort(webBase) {
  const cfgA = readAurabotJson()
  if (!cfgA || !cfgA.voice) return { ok: false, skipped: true, reason: '没检测到 aurabot 配置' }
  const v = cfgA.voice
  if (String(v.engine || '').toLowerCase() !== 'http') {
    return { ok: false, skipped: true, reason: 'aurabot 没选「其他 HTTP 接口」，没动它' }
  }
  const url = String((v.http || {}).urlTemplate || '')
  if (!url.includes(URL_FEATURE)) {
    return { ok: false, skipped: true, reason: '接口地址没指向本插件，没动它' }
  }
  const base = String(webBase || '').replace(/\/+$/, '')
  if (!base) return { ok: false, skipped: true, reason: '拿不到当前端口' }
  // 只换 origin（协议 + 主机 + 端口），后面的路径 / query / {text} 占位符原样保留。
  const m = url.match(/^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)(.*)$/i)
  if (!m) return { ok: false, skipped: true, reason: '接口地址格式不认识，没动它' }
  const desired = base + m[2]
  if (url === desired) return { ok: true, unchanged: true, url }
  // 只回传 voice 对象：把它的 http 子字段原样带着、仅替换 urlTemplate，
  // 这样 deepMerge 之后 method/headers/body 和音色/情绪都不会丢。
  const newVoice = JSON.parse(JSON.stringify(v))
  newVoice.http = { ...(v.http || {}), urlTemplate: desired }
  try {
    const r = await fetch(base + '/aurabot/api/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ voice: newVoice }),
      signal: AbortSignal.timeout(8000),
    })
    if (!r.ok) return { ok: false, message: 'aurabot 保存接口返回 HTTP ' + r.status }
    return { ok: true, updated: true, url: desired, from: url }
  } catch (e) { return { ok: false, message: e && e.message ? e.message : String(e) } }
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
  currentCtx = ctx                    // L2 语气润色用它取宿主 llm / agentDefaultModel 服务
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

        // GET /integrations —— 检测本机装了哪些本地语音插件，并给出手动 HTTP 接入参数。
        // 只检测 + 给参数，不写任何其它插件的目录（那是强行接管，会搞乱人家原来的音色）。
        if (method === 'GET' && path === '/integrations') {
          const web = process.env.DSH_WEB_URL || ('http://' + (req.headers.host || '127.0.0.1'))
          const previewUrl = web.replace(/\/+$/, '') + ROUTE_SEGMENT + '/preview'
          const httpGuide = {
            url: previewUrl,
            method: 'POST',
            headers: 'Content-Type: application/json',
            body: '{"text":"{text}"}',
            note: '请求体故意不带 voice：念的时候用「本地语音」页当前选中的音色，换音色只改本页。DSH 重启后端口会变：点「复制给 agent」按钮，把指令粘到 agent 对话窗口，让 agent 读那个插件源码现场适配，让插件 HTTP 端口获取自动同步，免去重复适配。',
            // 一键复制给 agent 的指令：主张动态地址填好，让 agent 现场适配其它插件的配置。
            agentPrompt: [
              '请帮我让【目标插件名】里填的「Breeze 语音 HTTP 接口地址」在 DSH 每次重启、web 端口变化后自动同步，我不用手动改。',
              '',
              '背景：DSH web 端口每次重启随机变，当前地址见环境变量 DSH_WEB_URL。本地语音插件 dsh-breeze-voice 的合成接口是 POST ' + previewUrl + '，请求体 {"text":"要念的话"}，返回带 RIFF 头的 WAV，无需认证。请求体故意不带 voice，音色由 dsh-breeze-voice 设置页决定，同步时别给目标插件塞 voice 字段。',
              '',
              '第一步（只调查、先别改文件）：读目标插件源码（<profile>/node_modules/ 下）和数据目录（一般 ~/.dsh/plugins-data/ 下），回答：①接口地址存在哪个配置文件、哪个字段路径，贴出字段名和示例值；②该配置是启动时读一次还是运行时重载，有没有官方保存 API 能改完立即生效，没有的话要不要重启；③地址字段能否原地替换主机/端口而不破坏路径、查询参数、{text} 占位符。',
              '',
              '第二步（按调查结果做，说明理由）：有运行时保存 API 就优先用它；只在启动时读就写个 DSH 启动时执行一次的同步脚本，并说明需重启。只改「接口地址」这一个字段——目标插件的音色/情绪/人格/请求方式/请求头/请求体及其它配置一律不许改。加护栏：仅当目标插件当前用 HTTP 语音引擎、且地址指向 dsh-breeze-voice 的 /api/breeze-voice/preview 时才同步，否则一个字都别写。改前先备份配置文件。',
              '',
              '第三步（验证）：①已接本插件+端口变了→只更新端口，其它字段逐一比对不变；②没用 HTTP 引擎→跳过不写；③地址不指向本插件→跳过不写。把三种结果贴给我。',
              '',
              '完整背景与验收清单见本插件 docs/AGENT-PORT-SYNC.md。不要改 dsh-breeze-voice 本身，也不要动任何插件安装目录的源码。',
            ].join('\n'),
            // 一键复制给 agent 的「判断目标插件能不能接本地语音」检测指令：只检测 + 出方案，接不接由用户拍板。
            agentDetectPrompt: [
              '请帮我判断插件【目标插件名】能不能用上我本机的 Breeze 语音音色，并按决策树给我结论和接法。',
              '',
              '最重要的前提：你只负责「检测 + 出方案」，接不接、走哪条路，全部由我（用户）拍板。我没点头之前，不要写任何文件、不要改任何配置。',
              '',
              '背景（务必先理解）：这是 DeepSeek Harness（DSH），插件在 <profile>/node_modules/，数据在 ~/.dsh/plugins-data/。本地语音插件 dsh-breeze-voice 只做本地语音输出端（TTS），开放了一个服务供任何插件主动接：',
              '  const bv = ctx.get(\'breezeVoice\', true)',
              '  bv.listVoices()                                        // 同步：音色数组 [{id,name,description,ready,kind,refId?}]',
              '  await bv.status()',
              '  const {bytes} = await bv.speak(text, voiceId, {signal}) // 合成，bytes 是 WAV Buffer',
              '  bv.refreshRegistration()',
              '它也有 HTTP 接口 POST ' + previewUrl + '，请求体 {"text":"要念的话"}，返回带 RIFF 头的 WAV，无需认证，故意不带 voice。DSH 核心没有统一 TTS 注册机制，别指望装了就自动出现在所有插件里。本插件不会自动接别的插件（dsh-pet 是唯一例外）。',
              '',
              '第一步（只调查、先别改文件）：读目标插件源码和数据目录，回答：①它有没有开放的语音注册服务接口（类似 petApi7340 的 voice.register / 音色注册表 / registerVoiceProvider）？②有没有能让外部注册音色和合成函数的入口（某个 Map/注册表或 register 方法）？③有没有内置的「其他 HTTP 接口」语音引擎（能填 地址/请求方式/请求头/请求体）？④有没有现成的接第三方 TTS 示例/文档，把字段名和代码片段贴出来。',
              '',
              '第二步（按决策树从上到下对号入座给结论）：',
              '【路径1｜有开放注册接口】→ 说"能接"，给针对它实际 API 的接法（不要只给模板）：用 ctx.get(\'breezeVoice\', true) 拿服务、ctx.inject([\'breezeVoice\'], fn) 处理加载顺序；把 bv.listVoices() 转成它注册表要的格式调 register；synthesize 回调里写 (await bv.speak(text, voice, {signal})).bytes；音色 id 用裸 id、format 填 wav、timeoutMs 给足。然后问我要不要按这个接，我点头再动手，改前先备份。',
              '【路径2｜没有注册接口但有「其他 HTTP 接口」】→ 说"可以用 HTTP 接，不用等作者更新"，给四项参数：接口地址 ' + previewUrl + '（端口用当前 DSH_WEB_URL）、请求方式 POST、请求头 Content-Type: application/json、请求体 {"text":"{text}"}（{text} 由它替换成要念的话）。强调三点：请求体故意不带 voice（音色由本插件设置页决定）；本插件不写它任何文件；DSH 重启后端口会变，要自动同步另用一份「端口同步」说明。然后问我要不要帮我把参数填进去，我点头再做。',
              '【路径3｜两条都没有】→ 明说"这个插件目前没有对外的语音接口，也不能填 HTTP 地址，接不了"。不要硬改它源码、不要往它数据目录塞脚本（那会绕开它原来的音色/情绪设置）、也别动 DSH 核心。给一句建设性建议：把本插件的 bv 服务签名发给该插件作者，请对方加几行适配。',
              '',
              '第三步：把结论贴给我，由我拍板走哪条路。我没同意前，一个字都别写。',
              '',
              '全程护栏：只碰「语音」相关的接口和配置，其它一律不看不改；接不接由我决定，你只负责检测 + 出方案；不要反过来改 dsh-breeze-voice 本身；改任何配置前先备份；不改任何插件安装目录源码。',
              '',
              '完整背景、决策树与验收清单见本插件 docs/AGENT-VOICE-INTEGRATION.md。',
            ].join('\n'),
          }
          // 端口自动同步：打开本页就把当前端口写回 aurabot（仅当用户已接本插件时）。
          let sync = { ok: false, skipped: true, reason: '未同步' }
          try { sync = await syncAurabotPort(web) } catch (e) { sync = { ok: false, message: e.message } }
          try { return sendJson(res, 200, { ok: true, plugins: scanVoicePlugins(), httpGuide, sync }) }
          catch (e) { return sendJson(res, 200, { ok: false, plugins: [], httpGuide, sync, message: e.message }) }
        }

        // GET /install/status —— 检测桌面版装没装/装哪了 + 后端在不在跑。
        // 实时查卸载注册表，不缓存"装没装"，卸载后重启自然回到待安装态。
        if (method === 'GET' && path === '/install/status') {
          const inst = detectDesktopInstall()
          let backendRunning = false
          try { backendRunning = await endpointAlive() } catch { /* 忽略 */ }
          const linkedDir = cfg.root && inst.dir && relative(cfg.root, inst.dir) === ''
          return sendJson(res, 200, {
            ok: true,
            installed: inst.installed,
            version: inst.version,
            dir: inst.dir,
            uninstall: inst.uninstall,
            backendRunning,
            linked: Boolean(linkedDir),
            downloadUrl: 'https://github.com/dkvkvk/breeze-tts-2-desktop/releases',
          })
        }

        // POST /install/link —— 把检测到的桌面版安装目录写进配置并刷新链路。
        // body 可带 { dir } 指定；不带则现场从注册表检测。
        if (method === 'POST' && path === '/install/link') {
          let body = {}
          try { body = JSON.parse(await readBody(req) || '{}') } catch { /* 空 body */ }
          let dir = typeof body.dir === 'string' ? body.dir.trim() : ''
          if (!dir || !looksLikeBreezeRoot(dir)) {
            const inst = detectDesktopInstall()
            if (inst.installed && looksLikeBreezeRoot(inst.dir)) dir = inst.dir
          }
          if (!dir || !looksLikeBreezeRoot(dir)) {
            return sendJson(res, 200, { ok: false, message: '没找到有效的桌面版安装目录，请确认桌面版已装好。' })
          }
          writeConfig({ root: dir, mode: 'auto' })
          probeCache = { t: 0, ep: '', ok: false }
          if (service && serviceRoot !== cfg.root) { service = null; serviceRoot = '' }
          await registerToPet(ctx)
          log('已把安装目录写入配置并刷新链路：', dir)
          return sendJson(res, 200, { ok: true, root: dir, config: cfg })
        }

        // POST /voice/add —— 添加音色：multipart 原样转发到桌面版 /v1/voices，
        // 音色文件由桌面版写进它的 voices\ 库（转发请求头保留 boundary）。
        if (method === 'POST' && path === '/voice/add') {
          try {
            const txt = await addVoice(req)
            let data = {}
            try { data = JSON.parse(txt) } catch { data = { message: txt } }
            return sendJson(res, 200, { ok: true, ...data })
          } catch (e) { return sendJson(res, 200, { ok: false, message: e.message }) }
        }

        // POST /voice/delete —— 删除音色：{ id } → 桌面版 DELETE /v1/voices/<id>
        if (method === 'POST' && path === '/voice/delete') {
          try {
            const body = JSON.parse(await readBody(req) || '{}')
            const txt = await deleteVoice(String(body.id || ''))
            let data = {}
            try { data = JSON.parse(txt) } catch { data = { message: txt } }
            return sendJson(res, 200, { ok: true, ...data })
          } catch (e) { return sendJson(res, 200, { ok: false, message: e.message }) }
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

  // 启动时也试着同步一次端口（面板打开时 GET /integrations 还会再同步一次，双保险）。
  // 延迟几秒等 web 服务和 aurabot 都就绪；拿不到当前地址就跳过，不报错。
  setTimeout(() => {
    const web = process.env.DSH_WEB_URL || ''
    if (!web) return
    syncAurabotPort(web).then((r) => {
      if (r && r.updated) log('已把新端口自动写回 aurabot：' + r.url)
    }).catch(() => { /* 启动同步失败不影响插件 */ })
  }, 3000)
}
