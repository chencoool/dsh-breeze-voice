// 从聊天插件的落盘记录里取「最近的上下文」，给情绪判断（模型润色档）用。
//
// 为什么要读文件：聊天插件的语音接口只会把 {text} 发过来（Aurabot 的 httpSynth 只有
// {text}/{text_raw}/{reqid} 三个占位符），没有上下文通道；但它们都把每条收发消息落在
// 自己的数据目录里。所以这边直接读记录，等价于「我看到了刚才聊了什么」——不用改对方插件。
//
// 插件之间的格式各不相同，所以中间隔一层适配器（engine/adapters/）：
//   适配器  = 认识某个插件的数据目录 + 把它的行翻成统一记录
//   本文件  = 统一记录 → 取时间窗口 → 排掉自己这句 → 交给情绪判断
// 统一记录：{ t:毫秒, chatId, who:'she'|'other', name, text }
//
// 换聊天插件时只要写一个适配器（约 20 行），或者用「通用 JSONL」适配器 + 设置页填字段名。
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import aurabot from './adapters/aurabot.mjs';
import dshSession from './adapters/dsh-session.mjs';
import genericJsonl from './adapters/generic-jsonl.mjs';

const DEFAULT_MAX = 8;          // 最多带几条
const DEFAULT_WINDOW_MS = 180000; // 只看最近 3 分钟
const USER_FRESH_MS = 45000;    // 「对方刚说的话」有效期 45 秒

/** 已注册的适配器，靠前的优先被自动识别。 */
export const ADAPTERS = [aurabot, dshSession, genericJsonl];

/** Aurabot 数据目录：环境变量优先，否则 ~/.dsh/plugins-data/aurabot。 */
export function aurabotDataDir() {
  const env = String(process.env.AURABOT_DATA_DIR || '').trim();
  if (env) return env;
  return join(homedir(), '.dsh', 'plugins-data', 'aurabot');
}

/** 按名字找适配器；'auto' 或不填时按 detect() 自动认。 */
export function pickAdapter(dir, wanted) {
  const id = String(wanted || 'auto').trim();
  if (id && id !== 'auto') {
    return ADAPTERS.find((a) => a.id === id) || null;
  }
  return ADAPTERS.find((a) => {
    try { return a.detect(dir); } catch { return false; }
  }) || null;
}

/** 读适配器给出的记录，按时间升序。
 *  两种适配器形态：
 *    ① 有 read()  —— 自己返回翻好的记录（如 DSH 会话，格式特殊、自带缓存）
 *    ② 有 files()+parse() —— 逐文件逐行翻（如通用 JSONL）
 */
function loadLines(adapter, dir, fields, now = new Date()) {
  const out = [];
  if (typeof adapter.read === 'function') {
    let recs = [];
    try { recs = adapter.read(dir, now) || []; } catch { recs = []; }
    for (const rec of recs) {
      if (rec && Number.isFinite(rec.t) && rec.text) out.push(rec);
    }
    return out.sort((a, b) => a.t - b.t);
  }
  let files = [];
  try { files = adapter.files(dir, now) || []; } catch { files = []; }
  for (const file of files) {
    if (!existsSync(file)) continue;
    let raw = '';
    try { raw = readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of raw.split(/\r?\n/)) {
      const s = line.trim();
      if (!s) continue;
      try {
        const rec = adapter.parse(s, fields);
        if (rec && Number.isFinite(rec.t) && rec.text) out.push(rec);
      } catch { /* 坏行跳过 */ }
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * 取最近上下文。
 * @param {object} [opt]
 * @param {string} [opt.dir]        聊天插件数据目录
 * @param {string} [opt.adapter]    适配器 id；'auto' 或留空自动识别
 * @param {object} [opt.fields]     通用适配器的字段映射
 * @param {string} [opt.text]       这句要念的回复（会从上下文里排除，避免自己套自己）
 * @param {number} [opt.max]        最多几条
 * @param {number} [opt.windowMs]   时间窗口
 * @param {number} [opt.now]        当前时间（测试用）
 * @returns {{ok:boolean, adapter:string, chatId:string, userText:string, context:string[], lines:object[], reason:string}}
 */
export function recentContext(opt = {}) {
  const wanted = String(opt.adapter || 'auto').trim();
  const givenDir = String(opt.dir || '').trim();
  // 目录不给就用对应适配器的默认位置；通用 JSONL / DSH 会话没有默认位置，必须由用户在设置页填。
  const NEEDS_DIR = wanted === 'jsonl' || wanted === 'dsh';
  const dir = givenDir || (NEEDS_DIR ? '' : aurabotDataDir());
  const max = Math.max(1, Number(opt.max) || DEFAULT_MAX);
  const windowMs = Math.max(1000, Number(opt.windowMs) || DEFAULT_WINDOW_MS);
  const now = Number(opt.now) || Date.now();
  const skip = String(opt.text || '').trim();
  const fields = opt.fields || {};

  if (!dir) {
    return {
      ok: false, adapter: NEEDS_DIR ? wanted : '', chatId: '', userText: '', context: [], lines: [],
      reason: wanted === 'dsh'
        ? '还没填聊天插件的工作目录（选「DSH 会话窗口」时必须指定）'
        : '还没填聊天记录目录（「通用 JSONL」模式必须指定目录）',
    };
  }

  const adapter = pickAdapter(dir, wanted);
  const empty = { ok: false, adapter: adapter ? adapter.id : '', chatId: '', userText: '', context: [], lines: [], reason: '' };
  if (!adapter) {
    return { ...empty, reason: '没找到认识的聊天记录格式（可在设置页选「通用 JSONL」并填目录和字段名）' };
  }

  const all = loadLines(adapter, dir, fields, new Date(now));
  if (!all.length) {
    return { ...empty, reason: `在 ${dir} 没读到可用的聊天记录（${adapter.name} 适配器：文件不存在、为空，或字段对不上）` };
  }

  // 只看「最近还在聊的那个会话」，避免把别的群/私聊串进来。
  const chatId = all[all.length - 1].chatId;
  const inChat = all.filter((m) => m.chatId === chatId);

  const cut = now - windowMs;
  // 只看 now 之前的消息：真实使用时 now=此刻，天然成立；补算/回放时能还原当时的样子。
  const upToNow = inChat.filter((m) => m.t <= now);
  let recent = upToNow.filter((m) => m.t >= cut);
  // 3 分钟内一条都没有（比如她隔了很久才回），退回最近几条，别让上下文空着。
  const fellBack = recent.length === 0;
  if (fellBack) recent = upToNow.slice(-max);

  const picked = recent.filter((m) => m.text !== skip).slice(-max);
  const context = picked.map((m) => `${m.name}：${m.text}`);

  // 只看这个时间点之前的消息（真实使用时 now 就是此刻，效果一样；测试/补算时才对）。
  const lastOther = [...inChat].reverse().find((m) => m.who === 'other' && m.t <= now);
  const userText = lastOther && now - lastOther.t <= USER_FRESH_MS ? lastOther.text : '';

  return {
    ok: context.length > 0,
    adapter: adapter.id,
    chatId,
    userText,
    context,
    lines: picked,
    reason: fellBack ? '最近 3 分钟没消息，取了最近几条' : '',
  };
}
