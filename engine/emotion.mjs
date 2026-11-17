// 按语境挑一条「怎么念」的语气指令；只影响语气，不改音色身份。
// 合成时把这条追加到音色本身的 direction 后面，所以永远是同一个声音在演不同情绪。
//
// 结构（无独立人设层）：
//   人设/性格交给聊天插件（那一层已经决定了这句话是什么性格说出来的），本模块不叠人设。
//   1. EMOTIONS 是纯情绪骨架：28 个情绪档 + 3 个社交语气档（group 标注），每档只描述「这种情绪怎么念」。
//   2. note 是血肉：关键词微调或模型现写的语气补充（语速、尾音、气息、笑意），拼在最后。
// 判断顺序：L2 模型润色（可选）→ L1 关键词/心情推断 → 平静；模型出错一律退回关键词，绝不因为模型就不说话。

// group: 'emotion' = 纯情绪（28 档）；'social' = 社交语气（3 档，不是情绪但念法差别大，单列）。
export const EMOTIONS = {
  // —— 喜悦（5）——
  calm: {
    name: '平静', group: 'emotion', cfg: 4,
    instruction: '此刻情绪平稳：语速自然、语气放松，不大起大落，像平常聊天。',
  },
  cozy: {
    name: '惬意', group: 'emotion', cfg: 3.8,
    instruction: '此刻很惬意：声音慵懒放松，语速偏慢，带一点舒服的叹息和笑意，像窝在暖处说话。',
  },
  happy: {
    name: '开心', group: 'emotion', cfg: 4,
    instruction: '此刻心情很好：语调轻快上扬，带明显笑意，节奏跳脱一点，语气活泼真诚，有一点点雀跃。',
  },
  excited: {
    name: '兴奋', group: 'emotion', cfg: 4.2,
    instruction: '此刻很兴奋：音量比平时大一点，语速快、连成一串，音调高，带压不住的雀跃和笑声，别喊破音。',
  },
  surprised: {
    name: '惊喜', group: 'emotion', cfg: 4.1,
    instruction: '此刻又惊又喜：先愣一下、短促吸气，随后语调上扬带笑，尾音轻快跳起来。',
  },

  // —— 亲密（4）——
  affectionate: {
    name: '亲昵', group: 'emotion', cfg: 3.8,
    instruction: '此刻很亲昵：声音放软放近，带笑意和气声，尾音轻轻拖着，像贴着耳边说话。',
  },
  shy: {
    name: '害羞', group: 'emotion', cfg: 4,
    instruction: '此刻有点害羞：声音稍微放轻、放软，语速略慢，句尾轻轻收住，带一点不好意思和心跳的感觉。',
  },
  touched: {
    name: '感动', group: 'emotion', cfg: 4,
    instruction: '此刻很感动：声音微微发颤、放软，语速慢，带鼻音和哽住的一点笑意，气息暖。',
  },
  grateful: {
    name: '感激', group: 'emotion', cfg: 3.9,
    instruction: '此刻很感激：语气真诚放软，语速稳，尾音轻轻落下，带一点郑重的暖意。',
  },

  // —— 悲伤失落（6）——
  wronged: {
    name: '委屈', group: 'emotion', cfg: 4,
    instruction: '此刻很委屈：声音发颤、带鼻音，像快要哭出来，语速偏慢，句尾轻轻往上飘，带一点哽咽，但字仍要说清楚。',
  },
  sad: {
    name: '难过', group: 'emotion', cfg: 3.8,
    instruction: '此刻很难过：声音低沉、气息重，语速慢，句尾往下沉，没什么起伏，像忍着情绪说话。',
  },
  disappointed: {
    name: '失望', group: 'emotion', cfg: 3.8,
    instruction: '此刻很失望：语气往下落，语速慢，尾音泄气，带一点「算了」的黯淡，笑意很淡。',
  },
  longing: {
    name: '想念', group: 'emotion', cfg: 3.8,
    instruction: '此刻在想念：声音放轻放远，语速慢，句子间有停顿，尾音轻轻飘着，带一点怅惘的温柔。',
  },
  wistful: {
    name: '怅然', group: 'emotion', cfg: 3.8,
    instruction: '此刻有点怅然：语气淡淡的、若有所失，语速慢，尾音轻轻散开，像望着远处说话。',
  },
  tired: {
    name: '疲惫', group: 'emotion', cfg: 3.7,
    instruction: '此刻很疲惫：声音放低放淡，语速慢，句子短，气息轻，没什么起伏，像没什么力气说话。',
  },

  // —— 愤怒不满（3）——
  irritated: {
    name: '烦躁', group: 'emotion', cfg: 4,
    instruction: '此刻有点烦躁：语速偏快，咬字略重，尾音不耐烦地往下压，带一点压着火的气息。',
  },
  angry: {
    name: '生气', group: 'emotion', cfg: 4.2,
    instruction: '此刻在生气：音色紧绷、咬字用力，语速快，句尾下沉，音量比平时大但克制着不喊。',
  },
  resentful: {
    name: '怨怼', group: 'emotion', cfg: 4,
    instruction: '此刻有点怨怼：语气冷下来，语速慢而顿挫，尾音带着委屈和不服，像憋着一口气。',
  },

  // —— 恐惧不安（4）——
  scared: {
    name: '害怕', group: 'emotion', cfg: 4.1,
    instruction: '此刻有点害怕：声音发紧、偏轻偏尖，气息浅而快，语速略快，句尾抖着收住，像缩起来小声说话。',
  },
  worried: {
    name: '担心', group: 'emotion', cfg: 4,
    instruction: '此刻很担心：声音放轻，语速略快，句中带迟疑的停顿，尾音往下沉，像反复确认对方安好。',
  },
  nervous: {
    name: '紧张', group: 'emotion', cfg: 4.1,
    instruction: '此刻有点紧张：声音发紧、语速忽快忽慢，偶有吞咽和短促吸气，尾音轻飘不太稳。',
  },
  startled: {
    name: '惊讶', group: 'emotion', cfg: 4.2,
    instruction: '此刻吃了一惊：先短促吸气、声音拔高，语速快，尾音上扬没落稳，带一点没回过神。',
  },

  // —— 自我意识（4）——
  guilty: {
    name: '心虚', group: 'emotion', cfg: 4,
    instruction: '此刻有点心虚：语速忽快忽慢，音量偏小，句尾吞掉半截，带一点讨好的笑和干笑，像在掩饰。',
  },
  awkward: {
    name: '尴尬', group: 'emotion', cfg: 4,
    instruction: '此刻有点尴尬：语速放慢，句子里有多余的停顿，尾音干笑一下收住，声音想把场面糊过去。',
  },
  jealous: {
    name: '吃醋', group: 'emotion', cfg: 4,
    instruction: '此刻有点吃醋：语气酸酸的，语速略快，尾音上扬带点不服和撒娇似的抱怨，不是真生气。',
  },
  proud: {
    name: '得意', group: 'emotion', cfg: 4.1,
    instruction: '此刻很得意：声音明亮、底气足，语速从容，尾音得意地上扬，带一点炫耀的笑，不吵不冲。',
  },

  // —— 无奈困惑（2）——
  helpless: {
    name: '无奈', group: 'emotion', cfg: 3.9,
    instruction: '此刻很无奈：轻轻叹气的感觉，语速慢，句尾往下泄气，带一点自嘲的笑意，像在说「算了随你吧」。',
  },
  confused: {
    name: '困惑', group: 'emotion', cfg: 4,
    instruction: '此刻在疑惑：语调往上扬，语速略慢，句中带停顿，尾音挑起来像在发问，带一点茫然。',
  },

  // —— 社交语气（3，非纯情绪，但念法差异大，单列）——
  sajiao: {
    name: '撒娇', group: 'social', cfg: 4.2,
    instruction: '此刻在撒娇：声音软糯往上飘，尾音拖着发嗲、轻轻上扬，带鼻音和气声，语速慢，像在央求对方答应。',
  },
  tease: {
    name: '戏谑', group: 'social', cfg: 4,
    instruction: '此刻在打趣：语气轻快带调侃的笑意，尾音上扬，咬字俏皮，有点坏心眼但不刺人，像在逗对方玩。',
  },
  gentle: {
    name: '温柔', group: 'social', cfg: 3.8,
    instruction: '此刻很温柔：声音放软放近，语速偏慢而稳，气息柔，句尾轻轻落下，像在耐心照顾和安慰对方。',
  },
};

/**
 * 拼语气指令：档位描述 + 模型的自由补充。
 * 不叠任何「人设/性格主干」——性格属于聊天插件那层，这里只管情绪化的念法。
 * options 仅为兼容旧调用保留，backbone 字段已被忽略。
 */
export function composeInstruction(picked, _options = {}) {
  const emo = emotionOf(picked?.key)
  const parts = [emo.instruction]
  const note = String(picked?.note || '').trim()
  if (note) parts.push(`再补这些细节：${note}。`)
  return parts.join('')
}

// 文本线索：命中越多越靠前。权重高的是更强的上下文证据。
// 已彻底移除「傲娇/嘴硬」类关键词——那是人设，不是情绪，交给聊天插件去演。
const CUES = [
  ['wronged', 3, /(骂你|凶你|欺负|笨蛋|傻鱼|讨厌你|烦死了|滚开|闭嘴|废物|没用|想哭|哭了|呜[…….、,，]|哽咽|冤枉|委屈)/],
  ['sad', 3, /(难过|伤心|心碎|失落|掉泪|流泪|哭|呜咽|不开心|闷闷|难受)/],
  ['disappointed', 2.8, /(失望|白费|白等|没想到|居然|竟然|算了|就这|不过如此|辜负)/],
  ['longing', 2.6, /(想你|想念|思念|惦记|好想|怀念|盼望|等你回来)/],
  ['wistful', 2.4, /(怅然|若有所失|可惜|遗憾|往事|回头看|过去了|唉)/],
  ['tired', 2.5, /(累了|好累|困了|困|睡了|晚安|不想动|没力气|疲惫|倦)/],
  ['affectionate', 2.8, /(亲亲|抱抱|贴贴|蹭蹭|喜欢你|爱你|想黏着|腻在一起|宝贝|乖乖)/],
  ['shy', 3, /(脸红|害羞|不好意思|羞|别说了|不许说|不许看|心跳|脸烫)/],
  ['touched', 2.8, /(感动|哭了吗|眼眶|暖到|戳中|破防|谢谢你这样)/],
  ['grateful', 2.6, /(谢谢|感谢|多亏|幸好|承蒙|麻烦你了|费心)/],
  ['happy', 3, /(夸|好可爱|真可爱|可爱|厉害|好棒|最棒|真乖|好厉害|心疼你|宠你|摸摸|奖励|开心|高兴|嘿嘿)/],
  ['excited', 2.8, /(太好了|太棒了|终于|好耶|等不及|激动|兴奋|马上就好|快点|冲|awsl)/],
  ['surprised', 2.6, /(居然!|竟然!|哇|天哪|我天|没想到|吓我一跳|真的假的|居然这么)/],
  ['irritated', 2.6, /(烦|烦人|烦死|吵死了|够了|啰嗦|别烦|焦躁|急死了)/],
  ['angry', 3, /(不理你|气死|可恶|过分|凭什么|你才|不稀罕|发火|怒|讨厌)/],
  ['resentful', 2.6, /(凭什么|不公平|偏心|记着|怀恨|咽不下|冷战)/],
  ['scared', 2.5, /(我怕|吓死|好可怕|恐怖|不要过来|怕怕|好吓人|救命)/],
  ['worried', 2.6, /(担心|别出事|注意安全|小心|会不会|万一|牵挂|放心不下)/],
  ['nervous', 2.5, /(紧张|忐忑|手心|心跳加速|结巴|不知道说啥|局促)/],
  ['startled', 2.4, /(啊[!！]|呀[!！]|诶[?？]|咦[?？]|嗯[?？]|愣住|怔住|惊到|突然|吓一跳)/],
  ['guilty', 2.6, /(糟糕|完了|被发现|忘了|对不起|抱歉|心虚|其实我|好像|确实|露馅)/],
  ['awkward', 2.5, /(尴尬|冷场|无话可说|讪讪|气氛|不知道看哪|哈哈。|咳)/],
  ['jealous', 2.6, /(吃醋|嫉妒|你和她|你们俩|不许|凭她对你好|酸)/],
  ['proud', 2.6, /(当然|那可不|不愧|小意思|必须的|厉害吧|羡慕吧|本来就|本鱼厉害)/],
  ['helpless', 2.6, /(无语|算了|随你|服了|没办法|你赢了|真是的|随便吧|唉)/],
  ['confused', 2.5, /(啊？|咦|诶|什么叫|是什么意思|为啥|为什么|不懂|真的吗|奇怪|搞不懂)/],
  ['sajiao', 3, /(好不好嘛|求求你|拜托嘛|要嘛|陪我|人家|嘛[～~]|[～~]{2,}|撒娇)/],
  ['tease', 2, /(哈哈|笑死|逗你|开个玩笑|骗你的|嘿嘿|哟[，,]?|好家伙|这波|调侃)/],
  ['gentle', 2.2, /(没事的|别怕|我在呢|慢慢来|辛苦|早点睡|不着急|陪着你|乖|照顾)/],
  ['cozy', 2.2, /(舒服|惬意|暖和|懒洋洋|晒太阳|窝着|享受|慢悠悠)/],
];

// 组合修正：同时命中两类证据时，往往是复合情绪（不再有傲娇相关规则）。
function reconcile(scores) {
  // 被夸 + 不好意思 = 被夸到害羞，不是单纯开心。
  if (scores.shy && scores.happy && scores.shy >= scores.happy - 1) scores.shy += 2
  // 委屈比难过更该被听见：委屈分高时压过泛化的难过，避免一律念成低落。
  if (scores.wronged && scores.sad && scores.wronged >= scores.sad) scores.sad = 0
  // 撒娇夹着笑意时更软；撒娇夹着赌气时先按撒娇。
  if (scores.sajiao && scores.happy) scores.sajiao += 1
  // 担心 + 害怕：怕得更具体时抬高害怕。
  if (scores.scared && scores.worried && scores.scared >= scores.worried) scores.scared += 1
  // 想念 + 怅然：想念更主动，优先。
  if (scores.longing && scores.wistful) scores.longing += 1
  return scores
}

// 心情标签（Aurabot 五档）→ 基础情绪（心情是背景色，文本线索优先）
const MOOD_BASE = {
  超开心: 'excited',
  心情不错: 'happy',
  平平常常: 'calm',
  有点低落: 'tired',
  不太开心: 'sad',
}

/** 从这句话本身推断情绪；没线索时返回空 key，交给调用方决定。 */
export function inferEmotion(text, moodLabel) {
  const value = String(text || '')
  const scores = {}
  for (const [key, weight, re] of CUES) {
    const hits = (value.match(new RegExp(re.source, 'gi')) || []).length
    if (hits) scores[key] = (scores[key] || weight) + Math.min(hits - 1, 2) * 0.5
  }
  reconcile(scores)
  const ranked = Object.entries(scores).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  if (ranked.length) return { key: ranked[0][0], source: 'text' }
  if (moodLabel === '') return { key: '', source: 'none' }
  const fromMood = MOOD_BASE[moodLabel]
  if (fromMood) return { key: fromMood, source: 'mood' }
  return { key: 'calm', source: 'default' }
}

export function emotionOf(key) {
  return EMOTIONS[key] || EMOTIONS.calm
}

// ---- L2 模型润色层 --------------------------------------------------------
// 模型不负责「判哪一档」（那由 L1 关键词做，零 token），只负责把已知的
// 心情 + 这句要念的文字，翻译成一句自然语言语气提示。只翻译不重判。
// 绝不让模型输出 JSON——少一次解析失败，也省 token。

export const TONE_SYSTEM = [
  '你在给一段即将合成语音的中文写「念法提示」。',
  '只写这一句该怎么念：语速、音调、气息、尾音、笑意或鼻音、哪里停顿。',
  '硬性要求：',
  '- 不要写人设、性格、角色设定，不要出现「傲娇」「胖鱼」「她」这类词。',
  '- 不要复述原文情节，不要输出 JSON、编号或解释，只输出一句自然语言。',
  '- 不超过 40 个字，直接告诉语音模型用什么语气念。',
  '',
  '例子（只学格式，不要照抄内容）：',
  '- 语速稍快、尾音上扬，带压不住的笑意和一点雀跃。',
  '- 声音放轻放软，句尾轻轻收住，带点鼻音和哽咽。',
  '- 语速不快，尾音往下沉，气息重一点，像忍着情绪。',
].join('\n')

/** 组 L2 的用户提示：已知心情 + 音色 + 要念的文字。 */
export function buildTonePrompt(text, mood, voice) {
  const trim = (s, n = 300) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n)
  const lines = []
  if (mood && mood.label) {
    lines.push('此刻的心情：' + trim(mood.label, 40) + (mood.reason ? '，因为' + trim(mood.reason, 60) : ''))
  }
  if (voice && voice.name) {
    lines.push('选中的音色：' + trim(voice.name, 40) + (voice.description ? '（' + trim(voice.description, 50) + '）' : ''))
  }
  lines.push('要念的这句：「' + trim(text, 240) + '」')
  lines.push('写出这句该怎么念（只输出一句不超过 40 字的自然语言提示）：')
  return lines.join('\n')
}

/** 把模型输出收敛成一句干净的 instruction；太长/空/带 JSON 就当失败。 */
export function cleanTone(answer) {
  const raw = String(answer || '').trim()
  if (!raw || raw.startsWith('{') || raw.startsWith('```')) return ''
  const first = raw.split(/\n/)[0].replace(/^["'「]|["」']$/g, '').trim()
  if (!first || first.length < 4) return ''
  return first.slice(0, 60)
}

/** 强度只是轻微调 cfg 和指令力度；不要因为它把语气推到失控。 */
export function tuneEmotion(base, intensity) {
  const emo = emotionOf(base)
  const n = Number.isFinite(intensity) ? Math.min(5, Math.max(1, intensity)) : 3
  const cfg = Math.round(Math.min(5, Math.max(3.2, Number(emo.cfg || 4) + (n - 3) * 0.35)) * 100) / 100
  return { cfg, intensity: n }
}
