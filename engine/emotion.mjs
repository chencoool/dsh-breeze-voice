// 按语境挑一条情绪指令；只影响语气，不改音色身份。
// 合成时把这条追加到音色本身的 direction 后面，所以永远是同一个声音在演不同情绪。
//
// 三层结构（1.8.0 起）：
//   0. 人设主干（PERSONA）：傲娇底色永远是主干，任何情绪都是在这层上「演」出来的。
//   1. 档位（EMOTIONS）是骨架：16 个高频档覆盖日常，每档还有 asTsun 说明「傲娇怎么演它」。
//   2. note 是血肉：模型给的自由语气补充（语速、尾音、气息、笑意），拼在最后。
// 判断顺序：模型判断（api.ask）→ 关键词线索 → 心情标签 → 平静；模型不可用时整条链路照旧能跑。
// 组合顺序：音色 identity → PERSONA → asTsun(档位) → note，音色始终不变。

export const EMOTIONS = {
  calm: {
    name: '平静',
    cfg: 4,
    instruction: '此刻情绪平稳：语速自然、语气放松，不大起大落，像平常聊天。',
  },
  happy: {
    name: '开心',
    cfg: 4,
    instruction: '此刻心情很好：语调轻快上扬，带明显笑意，节奏跳脱一点，语气活泼真诚，可以有一点点雀跃。',
  },
  excited: {
    name: '兴奋',
    cfg: 4.2,
    instruction: '此刻很兴奋：音量比平时大一点，语速快、连成一串，音调高，带压不住的雀跃和笑声，别喊破音。',
  },
  sajiao: {
    name: '撒娇',
    cfg: 4.2,
    instruction: '此刻在撒娇：声音软糯往上飘，尾音拖着发嗲、轻轻上扬，带鼻音和气声，语速慢，像在央求对方答应。',
  },
  tsun: {
    name: '傲娇',
    cfg: 4,
    instruction: '此刻在嘴硬撒娇（傲娇）：开头语气倔强、带点不服气的上扬，好像在辩解；句尾却悄悄软下来、带一点笑意和鼻音，声音清亮有弹性，尾音轻轻发软、略拖一点，但绝不是真的生气。',
  },
  shy: {
    name: '害羞',
    cfg: 4,
    instruction: '此刻有点害羞：声音稍微放轻、放软，语速略慢，句尾轻轻收住，带一点不好意思和心跳的感觉，不要刻意撒娇。',
  },
  gentle: {
    name: '温柔',
    cfg: 3.8,
    instruction: '此刻很温柔：声音放软放近，语速偏慢而稳，气息柔，句尾轻轻落下，像在耐心照顾和安慰对方。',
  },
  tease: {
    name: '戏谑',
    cfg: 4,
    instruction: '此刻在打趣：语气轻快带调侃的笑意，尾音上扬，咬字俏皮，有点坏心眼但不刺人，像在逗对方玩。',
  },
  sad: {
    name: '委屈',
    cfg: 4,
    instruction: '此刻很委屈：声音发颤、带鼻音，像快要哭出来，语速偏慢，句尾轻轻往上飘，带一点哽咽，但字仍要说清楚。',
  },
  angry: {
    name: '赌气',
    cfg: 4,
    instruction: '此刻在赌气：压着情绪说话，音色偏紧绷，咬字用力，语速略快，句尾下沉，前半句不服气、后半句会悄悄软下来。',
  },
  helpless: {
    name: '无奈',
    cfg: 3.9,
    instruction: '此刻很无奈：轻轻叹气的感觉，语速慢，句尾往下泄气，带一点自嘲的笑意，像在说「算了随你吧」。',
  },
  guilty: {
    name: '心虚',
    cfg: 4,
    instruction: '此刻有点心虚：语速忽快忽慢，音量偏小，句尾吞掉半截，带一点讨好的笑和干笑，像被抓到小辫子在掩饰。',
  },
  confused: {
    name: '困惑',
    cfg: 4,
    instruction: '此刻在疑惑：语调往上扬，语速略慢，句中带停顿，尾音挑起来像在发问，带一点茫然。',
  },
  proud: {
    name: '得意',
    cfg: 4.1,
    instruction: '此刻很得意：声音明亮、底气足，语速从容，尾音得意地上扬，带一点炫耀的笑，不吵不冲。',
  },
  scared: {
    name: '害怕',
    cfg: 4.1,
    instruction: '此刻有点害怕：声音发紧、偏轻偏尖，气息浅而快，语速略快，句尾抖着收住，像在缩起来小声说话。',
  },
  tired: {
    name: '低落',
    cfg: 4,
    instruction: '此刻有点低落疲惫：声音放低放淡，语速慢，句子短，气息轻，没什么起伏，像没什么力气说话。',
  },
};

// 性格主干：不是「其中一档情绪」，而是她所有语气的底色。
// 先有这层，再谈情境情绪，所以哪怕在难过、在害怕，也还是那个嘴硬心软的胖鱼。
export const PERSONA =
  '她是一条傲娇的胖鱼：嘴上永远先嘴硬、爱反驳、不服输，说完才发现自己其实很在意对方。'
  + '不管此刻是哪种情绪，都要在这层别扭的傲娇上演出来，不能变成顺从的乖乖女，也不能变成标准播音腔。';

// 每一档「在她身上演出来」是什么样：情境情绪只是表层，这层才是她会说的话。
const AS_TSUNDERE = {
  calm: '语气淡得有点不耐烦：像懒得搭理，其实一直在听，尾音带一点不情愿的软。',
  happy: '开心也不肯直说：先哼一声装作无所谓，尾音却藏不住笑，越说越轻快。',
  excited: '兴奋也要嘴硬：先说「也不是很想要啦」，语速却快起来，越说越雀跃。',
  sajiao: '撒娇前先别扭一句，然后才软下来央求，尾音拖长发嗲。',
  tsun: '标准傲娇：开头倔强上扬像在辩解，句尾悄悄软下来，带笑意和鼻音。',
  shy: '害羞先否认：嘴上说「才没有」，声音却越来越小，句尾轻轻收住。',
  gentle: '温柔藏在嫌弃里：嘴上说「就这一次啊」，语气却放软放轻。',
  tease: '打趣带点坏心眼：笑着怼一句，尾音上扬，等着看对方反应。',
  sad: '委屈也嘴硬：别过脸说「才不关你的事」，尾音却发抖带哽咽。',
  angry: '赌气是明着生气、暗着等哄：前半句冲，后半句悄悄软下来。',
  helpless: '无奈会自嘲地认输：叹口气说「随便你吧」，语气其实舍不得。',
  guilty: '心虚先嘴硬掩饰：声音忽快忽慢，干笑一下，把后半句吞掉。',
  confused: '困惑也带不服气：语调挑起来反问，像不肯承认自己没懂。',
  proud: '得意却装淡定：轻描淡写地说，尾音藏不住炫耀。',
  scared: '害怕也不肯认：嘴上说「本鱼才不怕」，声音发紧发抖。',
  tired: '低落时嘴硬：说「没事」，声音却淡淡的没什么力气。',
};
for (const [key, text] of Object.entries(AS_TSUNDERE)) {
  if (EMOTIONS[key]) EMOTIONS[key].asTsun = text;
}

/**
 * 拼最终语气指令：人设主干 → 这一档怎么演 → 模型的自由补充。
 * backbone 关掉时退回 1.7 的中性档位描述，方便对比。
 */
export function composeInstruction(picked, options = {}) {
  const backbone = options.backbone !== false;
  const emo = emotionOf(picked?.key);
  const parts = [];
  if (backbone) {
    parts.push(PERSONA);
    parts.push(`这一刻她把情绪演成「${emo.name}」：${emo.asTsun || emo.instruction}`);
  } else {
    parts.push(emo.instruction);
  }
  const note = String(picked?.note || '').trim();
  if (note) parts.push(`再补这些细节：${note}。`);
  return parts.join('');
}

// 文本线索：命中越多越靠前。权重高的是更强的上下文证据。
// 顺序只在同分时起作用；靠前的排更容易被当作招牌解读。
const CUES = [
  ['sad', 3, /(骂你|凶你|欺负|笨蛋|傻鱼|讨厌你|烦死了|滚开|滚|闭嘴|废物|没用|哭了|想哭|哭|呜[…….、,，]|哽咽)/],
  // 「哼」「才不是」「谁要」是傲娇的标志性开场，排在害羞前面，避免被吞成害羞。
  ['tsun', 3, /(才(、?才)?(不是|没有)|才不[是理管会想]|谁(、?谁)?要|谁稀罕|别误会|不要误会|勉强|顺手|嘴硬|讨厌啦)/],
  // 单独的「哼」也是最常见的嘴硬开场，权重低一点，让更强的证据（骂、哭）能压过它。
  ['tsun', 2.5, /(哼)/],
  ['sajiao', 3, /(好不好嘛|求求你|拜托嘛|要嘛|陪我|人家|贴贴|蹭蹭|撒娇|^嘛[～~]|[～~]{2,})/],
  ['shy', 3, /(脸红|害羞|不好意思|尴尬|羞|别说了|不许说|不许看|心跳)/],
  ['happy', 3, /(夸|好可爱|真可爱|可爱|厉害|喜欢你|爱你|好棒|最棒|真乖|好厉害|心疼你|宠你|摸摸|抱抱|亲亲|奖励)/],
  ['angry', 3, /(不理你|气死|可恶|过分|凭什么|你才|不稀罕)/],
  ['excited', 2.8, /(太好了|太棒了|终于|好耶|等不及|激动|兴奋|马上就好|快点|冲|awsl)/],
  ['guilty', 2.6, /(糟糕|完了|被发现|忘了|对不起|抱歉|心虚|其实我|也不是|好像|确实)/],
  ['helpless', 2.6, /(无语|算了|随你|服了|没办法|你赢了|真是的|随便吧|唉)/],
  ['proud', 2.6, /(当然|那可不|不愧|小意思|必须的|厉害吧|羡慕吧|本来就)/],
  ['confused', 2.5, /(啊？|咦|诶|什么叫|是什么意思|为啥|为什么|不懂|真的吗|奇怪|搞不懂)/],
  ['scared', 2.5, /(我怕|吓死|好可怕|恐怖|不要过来|怕怕|好吓人)/],
  ['gentle', 2.2, /(没事的|别怕|我在呢|慢慢来|辛苦|早点睡|不着急|陪着你|乖)/],
  ['tease', 2, /(哈哈|笑死|逗你|开个玩笑|骗你的|嘿嘿|哟[，,]?|好家伙|这波)/],
  ['tired', 2.5, /(累了|好累|困了|困|睡了|晚安|不想动|没力气|疲惫)/],
];

// 组合修正：同时命中两类证据时，往往是复合情绪。
function reconcile(scores) {
  // 夸 + 不好意思 = 被夸到害羞，不是单纯开心。
  if (scores.shy && scores.happy && scores.shy >= scores.happy - 1) {
    scores.shy += 2;
  }
  // 嘴硬 + 任何外显情绪 = 傲娇在演（被夸了嘴硬、被说破了嘴硬、赌气时装强硬）。
  if (scores.tsun) {
    if (scores.happy) scores.tsun += 1.5;
    if (scores.shy) scores.tsun += 1;
    if (scores.angry) scores.tsun += 1;
  }
  // 想哭但还在嘴硬，仍按委屈处理（哭腔比傲娇更该被听见）。
  if (scores.sad && scores.tsun && scores.sad >= 6) {
    scores.tsun = 0;
  }
  // 撒娇夹着笑意时更软；撒娇夹着赌气时先按撒娇。
  if (scores.sajiao && scores.happy) scores.sajiao += 1;
  return scores;
}

// 心情标签 → 基础情绪（心情是背景色，文本线索优先）
const MOOD_BASE = {
  超开心: 'happy',
  心情不错: 'happy',
  平平常常: 'calm',
  有点低落: 'tired',
  不太开心: 'sad',
};

/** 从这句话本身推断情绪；没线索时返回空 key，交给调用方决定。 */
export function inferEmotion(text, moodLabel) {
  const value = String(text || '');
  const scores = {};
  for (const [key, weight, re] of CUES) {
    const hits = (value.match(new RegExp(re.source, 'g')) || []).length;
    if (hits) scores[key] = (scores[key] || weight) + Math.min(hits - 1, 2) * 0.5;
  }
  reconcile(scores);
  const ranked = Object.entries(scores).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (ranked.length) return { key: ranked[0][0], source: 'text' };
  if (moodLabel === '') return { key: '', source: 'none' };
  const fromMood = MOOD_BASE[moodLabel];
  if (fromMood) return { key: fromMood, source: 'mood' };
  return { key: 'calm', source: 'default' };
}

export function emotionOf(key) {
  return EMOTIONS[key] || EMOTIONS.calm;
}

// ---- 模型判断层 ----------------------------------------------------------
// 档位是骨架，note 是血肉：模型只要给「哪一档 + 强度 + 一句语气补充」。
// 解析失败、超时、模型抽风，一律返回 null，让调用方退回关键词，绝不因为模型出错就不说话。

const KEYS = Object.keys(EMOTIONS);

export const EMOTION_SYSTEM = [
  '你在给「大肥鱼」的语音挑语气。她是大肥鱼，一条圆滚滚的胖鱼 AI。',
  PERSONA,
  '',
  '判断请按这个顺序，不要跳步，也不要看到一两个词就下结论：',
  '1. 先立住她的底色：傲娇。她不会顺从地、毫无保留地表达情绪，也不会用标准播音腔。',
  '2. 看对方这句话是什么性质：夸她、凶她、求她、逗她、问她、吃饭相关、还是平淡闲聊。',
  '3. 看她这句回复在干什么：嘴硬否认、让步、讨好、反击、撒娇、解释、安慰对方、主动找话。',
  '4. 然后才挑一档情境情绪。挑的时候反着想一遍：「她这么嘴硬的人，会不会这样说话？」不像就换一档。',
  '5. 证据不足、看不出明显情绪时，选 tsun 或者 calm。不要硬编兴奋、委屈、害怕这类强情绪，判错比判平更糟。',
  '6. 但傲娇是底色，不是万能答案：如果这一句本身有明确、强烈的情境情绪（真被骂到难受、真在害怕、真的在央求、被夸到不知怎么办），就要给对应的强档，傲娇只体现在 note 里她怎么嘴硬。不要所有句子都判 tsun。',
  '',
  '可选档位（key: 名称 — 中性描述）：',
  ...KEYS.map((k) => `${k}: ${EMOTIONS[k].name} — ${EMOTIONS[k].instruction}`),
  '',
  '各档在她身上实际演出来的样子（挑档后按这个核对，对不上就换）：',
  ...KEYS.map((k) => `${k}: ${EMOTIONS[k].asTsun || ''}`),
  '',
  '容易混的几组这样分：',
  '- tsun 只在「她自己」嘴硬、辩解、别扭时用；如果是对方赌气说不管她了，她在应付、叹气、让步（「算了随你吧」），那是 helpless（无奈）。',
  '- tease（戏谑）是在逗对方玩、带笑意；happy（开心）是她自己单纯高兴。',
  '- guilty（心虚）是怕被发现、在掩饰；shy（害羞）是被夸、被看穿而不太好意思。',
  '- sajiao（撒娇）是在央求对方答应，声音软、拖尾音；不要写成 tsun。',
  '- gentle（温柔）只在她主动哄对方、照顾对方时用，而且必须带着嫌弃的包装，不是温柔姐姐腔。',
  '- 对方在夸她、示好时，别判成 excited；她的第一反应通常是嘴硬（tsun）或者害羞再否认（shy）。',
  '复合情绪取最主要那一档，次要的写进 why 或 note。',
  '',
  'note 要写清两件事：一、她的傲娇在这句话里落在哪（哪句嘴硬、哪里软下来）；二、具体语气（语速、尾音、气息、笑意、鼻音）。不超过 24 个字，不描述剧情，不重复档位名。',
  'why 用一句话说明你为什么这么判，不超过 12 个字。',
  '只输出一个 JSON 对象，不要任何解释或代码块：',
  '{"key":"档位","intensity":1到5的整数,"why":"判断理由","note":"语气补充"}',
].join('\n');

export function buildEmotionPrompt(text, userText, extra = {}) {
  const trim = (s, n = 300) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const mine = trim(text);
  const theirs = trim(userText);
  const lines = [];
  const ctx = Array.isArray(extra.context) ? extra.context.filter(Boolean).slice(-6) : [];
  if (ctx.length) {
    lines.push('前几句的对话（越靠后越近，用来判断她现在的状态）：');
    for (const line of ctx) lines.push('  ' + trim(line, 120));
  }
  lines.push(theirs ? `对方刚说：「${theirs}」` : '对方刚说：（没有这句，可能是她主动开口）');
  lines.push(`她要回：「${mine}」`);
  if (extra.mood) lines.push(`她此刻的背景心情：${extra.mood}`);
  lines.push('她回这句话时，傲娇底色怎么落，情境情绪是哪一档？先想清楚再输出 JSON。');
  return lines.join('\n');
}

/** 解析模型回复；不合法就返回 null。 */
export function parseEmotionReply(answer) {
  const raw = String(answer || '').trim();
  if (!raw) return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    let data;
    try {
      data = JSON.parse(raw.slice(start, end + 1));
    } catch (error) {
      data = null;
    }
    const picked = normalizePicked(data);
    if (picked) return picked;
  }
  // 模型偶尔不按格式吐 JSON，会写成「应该是 tsun（傲娇），强度 4」这种散文。
  // 只在能唯一定位到一个档位时才采信，宁可退回关键词也不要瞎猜。
  const found = new Set();
  const jsonKey = raw.match(/key["'\s:：]*([a-z_]+)/i);
  if (jsonKey && KEYS.includes(jsonKey[1].toLowerCase())) found.add(jsonKey[1].toLowerCase());
  for (const [k, v] of Object.entries(EMOTIONS)) {
    if (new RegExp(`(^|[^a-z_])${k}([^a-z_]|$)`, 'i').test(raw)) found.add(k);
    if (raw.includes(v.name)) found.add(k);
  }
  if (found.size !== 1) return null;
  const key = [...found][0];
  const n = raw.match(/(?:intensity|强度)["'\s:：]*([1-5])/i);
  return normalizePicked({ key, intensity: n ? Number(n[1]) : 3, note: extractNote(raw) });
}

function extractNote(raw) {
  const m = raw.match(/(?:note|语气补充|补充)["'\s:：]*(?:是|为)?\s*["'「]?([^"'」}\n]{2,24})/i);
  return m ? m[1] : '';
}

// 按标点截断，避免把「尾音拖一点鼻」这种半截话喂给 TTS。
function clipSentence(value, max) {
  const s = String(value || '').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastBreak = Math.max(cut.lastIndexOf('，'), cut.lastIndexOf('、'), cut.lastIndexOf('；'), cut.lastIndexOf('。'));
  return lastBreak >= Math.floor(max * 0.5) ? cut.slice(0, lastBreak) : cut;
}

function normalizePicked(data) {
  const key = typeof data?.key === 'string' ? data.key.trim().toLowerCase() : '';
  if (!KEYS.includes(key)) return null;
  const n = Number(data?.intensity);
  const intensity = Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : 3;
  const note = clipSentence(String(data?.note ?? '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/["'「」『』【】{}<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim(), 32);
  const why = clipSentence(String(data?.why ?? data?.理由 ?? '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/["'「」『』【】{}<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim(), 18);
  return { key, intensity, note, why };
}

/** 强度只是轻微调 cfg 和指令力度；不要因为它把语气推到失控。 */
export function tuneEmotion(base, intensity) {
  const emo = emotionOf(base);
  const n = Number.isFinite(intensity) ? Math.min(5, Math.max(1, intensity)) : 3;
  const cfg = Math.round(Math.min(5, Math.max(3.2, Number(emo.cfg || 4) + (n - 3) * 0.35)) * 100) / 100;
  return { cfg, intensity: n };
}
