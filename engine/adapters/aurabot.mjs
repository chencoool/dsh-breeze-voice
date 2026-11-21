// Aurabot（dsh-aurabot-qq）聊天记录适配器。
//
// Aurabot 把每条收发消息落在 <数据目录>/chatlog/<年-月-日>.jsonl，一行一条：
//   {"t":毫秒,"chatId":"private:123","who":"bot"|昵称|"系统","uid":"...","text":"..."}
// 字段：t 毫秒时间戳；chatId private:QQ号 / group:群号；who=bot 是她自己，否则是对方昵称；
// 系统消息 who="系统"；uid 对方 QQ 号；text 正文（Aurabot 侧已截到 500 字）。
//
// 适配器只干一件事：把这些行翻成插件内部统一的记录格式
//   { t, chatId, who:'she'|'other', name, text }
// 后面的取窗口、排自己这句、限条数，全由 context.mjs 统一处理。
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const pad = (n) => String(n).padStart(2, '0')
const dayName = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// 不当成「对方在跟我说话」的 who 值（系统通知、自己、机器人）。
const SYSTEM_WHO = new Set(['系统', 'system', 'System', 'SYSTEM'])

export default {
  id: 'aurabot',
  name: 'Aurabot QQ',
  describe: '读 <数据目录>/chatlog/<日期>.jsonl（每个聊天插件一种格式，这是 Aurabot 的）。',

  /** 认目录：有 chatlog 子目录就当是 Aurabot。 */
  detect(dir) {
    try {
      return existsSync(join(dir, 'chatlog'))
    } catch {
      return false
    }
  },

  /** 最近两天的文件（跨零点也能接上），按时间升序。 */
  files(dir, now = new Date()) {
    const out = []
    for (const back of [1, 0]) {
      const file = join(dir, 'chatlog', `${dayName(new Date(now.getTime() - back * 86400000))}.jsonl`)
      if (existsSync(file)) out.push(file)
    }
    return out
  },

  /** 一行 → 统一记录；读不懂返回 null（坏行、空行、系统消息都跳过）。 */
  parse(line) {
    const j = JSON.parse(line)
    const t = Number(j.t)
    const text = String(j.text || '').trim()
    if (!Number.isFinite(t) || !text) return null

    const who = String(j.who || '').trim()
    if (!who) return null
    if (SYSTEM_WHO.has(who)) return null   // 系统通知不是「对方说的话」，别喂给模型

    const self = who === 'bot'
    return {
      t,
      chatId: String(j.chatId || ''),
      who: self ? 'she' : 'other',
      name: self ? '她' : who,
      text: text.slice(0, 500),
    }
  },
}
