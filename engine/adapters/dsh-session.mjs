// DSH 会话窗口适配器：直接读 DSH 自己的会话日志（聊天插件跑在 DSH 会话里，对话都在那）。
//
// 为什么要这个：Aurabot 之类的聊天插件把每轮对话放进一个 DSH 会话，会话日志里既有她说的话、
// 也有对方的原话，比插件自己写的流水更全。代价是格式特殊：session.v4.jsonl.zstd 不是普通
// zstd 文件，而是**多个 zstd frame 首尾拼在一起**（一次 append 一个 frame），
// 用 createZstdDecompress() 流式解会报 ZSTD_error_prefix_unknown，必须按魔数切帧逐帧解。
//
// 会话目录按 DSH 的命名规则从 cwd 推出来：把工作目录里的 ":" 去掉、"\"/"/" 换成 "-"，
// 外面再包一层 "--"，例如 D:\Aurabot\qq-chats → ~/.dsh/sessions/--D-Aurabot-qq-chats--/
//
// 会话日志只保留最近的对话，且按文件 mtime 做缓存——4MB 的会话解一次约 100ms，
// 每次合成语音都解一遍太浪费。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** 工作目录 → DSH 会话目录名。 */
export function sessionFolderName(dir) {
  const s = String(dir || '').trim().replace(/[/\\]+$/, '')
  if (!s) return ''
  return `--${s.replace(/:/g, '').replace(/[/\\]/g, '-')}--`
}

/** 会话根目录：环境变量 DSH_HOME 优先，否则 ~/.dsh。 */
export function sessionsRoot() {
  const env = String(process.env.DSH_SESSIONS_DIR || '').trim()
  if (env) return env
  const home = String(process.env.DSH_HOME || '').trim() || join(homedir(), '.dsh')
  return join(home, 'sessions')
}

/** 从会话日志里抽出文字（跳过 reasoning/工具调用等噪音）。 */
function textOfContent(content) {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const b of content) {
    if (!b || typeof b !== 'object') continue
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
    // reasoning 是她的内心活动，不是她说出口的话，故意不要；tool-call/tool-result 同理跳过。
  }
  return parts.join('\n').trim()
}

// 这些不是「人说的话」，是宿主/插件注进对话里的系统文本（记忆备注、定时提醒、时间戳、
// 后台任务提示词、JSON 载荷等）。当成对话会把语气判断带偏，必须挡掉。
const SYSTEM_TEXT = [
  /^（刚才聊到的/,
  /^（你记得这些事/,
  /^【系统提醒/,
  /^【系统/,
  /^【空间图文日记/,   // 后台写日记/发动态的任务提示词，不是聊天
  /^Time sampled/,
  /^Browser time zone/,
  /^Current runtime context/,  // 每轮注入的运行时环境快照
  /^\[model changed/,  // 换模型的系统通告
  /^\{\s*"/,           // 整个气泡是段 JSON（工具载荷/写日记的返回），不是念出来的话
  /^<\/?[a-z][\w-]*>$/i, // 纯标签残片，如 </cc>
  /^<\/?(system-reminder|system|developer)/,
]

function isSystemText(text) {
  return SYSTEM_TEXT.some((re) => re.test(text))
}

// 群聊整段模板：「【群聊 …】刚才新说的（N 条）… [1] 昵称(号码)：正文 [2] 昵称(号码)@了你：正文
// 这是宿主拼给 AI 的提示词，一整个气泡里套着好几条群友发言。要按行拆出来，
// 否则整段（含操作说明）会被当成「对方说的一句话」，语气判断直接跑偏。
const GROUP_MARK = /【群聊[^】]*】/
// 逐行匹配：行首 [编号] 昵称(号码)[@了你]：正文。正文只取同一行（不跨行），
// 免得把后面的「把这一段当成整体来回…」这类操作说明也吃进来。
const GROUP_LINE = /^\[(\d+)\]\s*(.+?)\s*(?:@了你)?\s*[：:]\s*(.*)$/

/** 从群聊模板里拆出每条群友发言；不是群聊模板返回 null。 */
function splitGroupText(text) {
  if (!GROUP_MARK.test(text) && !/^\[\d+\]\s/m.test(text)) return null
  const out = []
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(GROUP_LINE)
    if (!m) continue
    const label = m[2].trim()
    const body = m[3].trim()
    if (!body) continue
    // 「昵称(号码)」→ 昵称；号码丢掉，不进上下文
    const nick = label.replace(/[（(][^）)]*[）)]/g, '').trim() || '群友'
    out.push({ name: nick, text: body.slice(0, 500) })
  }
  return out.length ? out : null
}

/** 解一个多 frame 拼接的 zstd 文件 → 行数组。 */
function readFrames(file) {
  let buf
  try { buf = readFileSync(file) } catch { return [] }
  const pos = []
  let i = buf.indexOf(ZSTD_MAGIC, 0)
  while (i !== -1) { pos.push(i); i = buf.indexOf(ZSTD_MAGIC, i + 4) }
  if (!pos.length) return []
  const lines = []
  for (let k = 0; k < pos.length; k++) {
    const end = pos[k + 1] ?? buf.length
    try {
      const out = zstdDecompressSync(buf.subarray(pos[k], end)).toString('utf8')
      for (const l of out.split('\n')) if (l.trim()) lines.push(l)
    } catch { /* frame 边界噪音，跳过 */ }
  }
  return lines
}

/** mtime 缓存：文件没变就不重复解压。 */
const cache = new Map() // file → { mtimeMs, size, records }

function recordsOf(file) {
  let st
  try { st = statSync(file) } catch { return [] }
  const hit = cache.get(file)
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.records

  const records = []
  for (const line of readFrames(file)) {
    let j
    try { j = JSON.parse(line) } catch { continue }

    let who = ''
    let text = ''
    if (j.type === 'user/message' || j.type === 'assistant/message') {
      const msg = (j.data && j.data.message) || j.data || {}
      // 群聊/私聊的对方原话，Aurabot 会带前缀【私聊】昵称(QQ)：……
      text = textOfContent(msg.content)
      who = j.type === 'assistant/message' ? 'she' : 'other'
    } else {
      continue // 其它事件（turn/step/tool/request…）都不是聊天气泡
    }
    if (!text) continue
    // 系统注入的内容（记忆备注、定时提醒、时间戳）不算任何一方说的话
    if (isSystemText(text)) continue

    let name = who === 'she' ? '她' : '对方'
    if (who === 'other') {
      // 群聊气泡里套着好几条群友发言，先按行拆开。
      const group = splitGroupText(text)
      if (group) {
        for (const g of group) {
          records.push({
            t: Number(j.time) || 0,
            chatId: '',
            who: 'other',
            name: g.name,
            text: g.text,
          })
        }
        continue
      }
      // 私聊气泡：形如【私聊】昵称(1234567890)：正文 —— 取昵称、去号码、留正文
      const m = text.match(/^【[^】]*】\s*([^（(：:]{1,24})\s*[（(][^）)]*[）)]\s*[：:]\s*([\s\S]*)$/)
      if (m) {
        name = m[1].trim()
        text = m[2].trim()
      }
    }
    if (!text) continue
    records.push({
      t: Number(j.time) || 0,
      chatId: '',       // 一个会话文件就是一个聊天窗口，不用再分
      who,
      name,
      text: text.slice(0, 500),
    })
  }
  cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, records })
  return records
}

export default {
  id: 'dsh',
  name: 'DSH 会话窗口',
  describe: '读聊天插件所跑的那个 DSH 会话的对话记录；填插件的工作目录即可。',
  configurable: true,

  /** 目录里没有聊天记录文件，但它能映射到一个存在的 DSH 会话目录就算认得。 */
  detect(dir) {
    try {
      if (!dir) return false
      const folder = join(sessionsRoot(), sessionFolderName(dir))
      return existsSync(folder) && statSync(folder).isDirectory()
    } catch {
      return false
    }
  },

  /** 不走「读文件再 parse」那套，直接给已翻好的记录。 */
  read(dir, now = new Date()) {
    const folder = join(sessionsRoot(), sessionFolderName(dir))

    // 结构是：<工作区映射目录>/session-<id>/session.v4.jsonl.zstd
    // 一个工作区下可能有好几个会话（每次新开聊天窗口就是一个新会话）。按 mtime 从新到旧试，
    // 取第一个「过滤完还剩真对话」的会话——最近那个有可能刚好只写了系统注入内容（记忆备注、
    // 时间采样之类），过滤完一条不剩，这时要往回找上一个有内容的窗口，而不是直接放弃。
    const files = []
    let entries = []
    try { entries = readdirSync(folder, { withFileTypes: true }) } catch { return [] }
    for (const e of entries) {
      const sub = join(folder, e.name)
      if (!e.isDirectory()) {
        if (e.name.endsWith('.zstd')) files.push(sub) // 也兼容 .zstd 直接放在目录下的布局
        continue
      }
      let inner = []
      try { inner = readdirSync(sub) } catch { continue }
      for (const n of inner) if (n.endsWith('.zstd')) files.push(join(sub, n))
    }

    const ranked = []
    for (const f of files) {
      let st
      try { st = statSync(f) } catch { continue }
      if (st.size < 64) continue
      ranked.push({ f, ms: st.mtimeMs })
    }
    ranked.sort((a, b) => b.ms - a.ms)

    const MAX_TRIES = 3 // 往回找最多试几个，够用了，别把整个目录都解一遍
    for (let i = 0; i < ranked.length && i < MAX_TRIES; i++) {
      const recs = recordsOf(ranked[i].f)
      if (recs.length) return recs
    }
    return []
  },
}
