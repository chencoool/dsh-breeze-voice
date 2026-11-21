// 通用 JSONL 适配器：别的聊天插件字段名不一样时，靠配置对上号，不用改代码。
//
// 用法：设置页把「上下文来源」选成「通用 JSONL」，填数据目录 + 字段名（可留空用默认）。
// 默认假设一行一条 JSON，字段 t/who/text/chatId；who 里出现 bot/assistant/self 之一算「她自己」。
//
// 时间字段兼容三种写法：毫秒数、秒数（<1e12 时自动 ×1000）、ISO 字符串。
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DEFAULTS = {
  t: 't',
  who: 'who',
  text: 'text',
  chatId: 'chatId',
  selfValues: ['bot', 'assistant', 'self', '她', 'AI'],
  systemValues: ['system', '系统'],
  name: '',   // 可选：单独存昵称的字段；没填就用 who 的值
}

/** 秒/毫秒/ISO 串 → 毫秒时间戳；认不出返回 NaN。 */
export function normTime(v) {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v < 1e12 ? Math.round(v * 1000) : Math.round(v)
  }
  const s = String(v ?? '').trim()
  if (!s) return NaN
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s)
    return n < 1e12 ? Math.round(n * 1000) : Math.round(n)
  }
  const ms = Date.parse(s)
  return Number.isFinite(ms) ? ms : NaN
}

const lower = (v) => String(v ?? '').trim().toLowerCase()

export default {
  id: 'jsonl',
  name: '通用 JSONL',
  describe: '一行一条 JSON 的聊天记录；字段名和目录在设置页里填，适配别的聊天插件用。',
  configurable: true,

  /** 需要用户在设置页填目录，所以这里只校验目录里确实有 .jsonl。 */
  detect(dir) {
    try {
      if (!dir || !existsSync(dir)) return false
      return readdirSync(dir).some((n) => n.toLowerCase().endsWith('.jsonl'))
    } catch {
      return false
    }
  },

  /** 该目录下所有 .jsonl，按修改时间升序（老的先读）。 */
  files(dir) {
    try {
      return readdirSync(dir)
        .filter((n) => n.toLowerCase().endsWith('.jsonl'))
        .map((n) => join(dir, n))
    } catch {
      return []
    }
  },

  /**
   * @param {string} line 一行原文
   * @param {object} [fields] 用户配置的字段映射（见上方 DEFAULTS）
   */
  parse(line, fields) {
    const f = { ...DEFAULTS, ...(fields || {}) }
    const j = JSON.parse(line)

    const t = normTime(j[f.t])
    const text = String(j[f.text] ?? '').trim()
    if (!Number.isFinite(t) || !text) return null

    const rawWho = String(j[f.who] ?? '').trim()
    const selfAt = (f.selfValues || DEFAULTS.selfValues).map(lower).includes(lower(rawWho))
    const sysAt = (f.systemValues || DEFAULTS.systemValues).map(lower).includes(lower(rawWho))
    if (sysAt) return null   // 系统消息不当成对方说话

    const nameField = f.name ? String(j[f.name] ?? '').trim() : ''
    return {
      t,
      chatId: String(j[f.chatId] ?? ''),
      who: selfAt ? 'she' : 'other',
      name: selfAt ? '她' : (nameField || rawWho || '对方'),
      text: text.slice(0, 500),
    }
  },
}
