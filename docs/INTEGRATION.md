# 让其它插件接入本机 Breeze 音色（集成说明）

> 适用对象：想让**自己的语音插件**也能用上本机 Breeze 音色的插件作者 / 有改造能力的用户。
> 本文只讲「怎么接」，不改动 DSH 核心、也不改动本插件本身。

## 这个插件是什么

本插件是一个**通用的本地语音输出（TTS）服务**：它把本机 Breeze TTS 2 的音色封装成统一接口，任何需要「念文字出来」的插件都可以按需接入。它**不是**为某一个特定插件定制的。

DSH 核心目前**没有统一的语音输出（TTS）服务 seam**——只有语音输入（STT）的服务接口。所以不存在「装一个插件，所有插件的语音下拉就自动出现音色」的机制（这点和大模型 API 不一样，llm 服务有 `registerAdapter / listModels / registerModelDiscovery` 那一套，TTS 没有）。因此接入需要双方各走一小步。

本插件提供**两个接入点**，其它插件按需择一：

| 接入点 | 服务对象 | 适合谁 |
|---|---|---|
| A. 插件自己的 voice 注册表 | 各插件自维护的语音注册表 | 插件有类似 dsh-pet 那样的音色注册表时，照下面的例子接 |
| B. `breezeVoice` 服务 | 本插件 `ctx.provide` 暴露 | 任何愿意主动调几行代码来接的插件 |

## 前提

1. 装好本插件：`dsh plugin --profile <你的profile名> add github:chencoool/dsh-breeze-voice`，装完重启 DSH。
2. **推荐**装好 Breeze TTS 2 桌面版：从 [dkvkvk/breeze-tts-2-desktop 的 Releases](https://github.com/dkvkvk/breeze-tts-2-desktop/releases) 下载 `BreezeTTS2-Setup-*.exe`，安装目录自己选，**启动桌面版**。本插件「连接方式」保持「自动」，探测到桌面版后端（`127.0.0.1:18099`）就自动连上——连接模式不用填安装目录、不用 `breeze-runtime.json`，音色来自桌面版克隆库（`voices\`）和内置描述式预设。若你没有桌面版、用的是本机自管引擎，才需要在设置页填安装目录（桌面版布局缺 `breeze-runtime.json` 时插件会自动补写一份）。详见 README。
3. 确认音色已就绪：连接模式下，音色标「（桌面版）」的是桌面版克隆音色（直接可用），其余是内置描述式预设；自管模式下标「本机」的可直接用，标「还没建好」的要先生成 `.breeze` 文件。

---

## 方式 A（举例）：dsh-pet 是怎么接上的

这里用 **dsh-pet** 当一个具体例子——它维护自己的私有语音注册表 `petApi7340.voice`（**这是 dsh-pet 自己的服务，不是 DSH 核心的通用标准接口**，核心层没有 TTS 注册 seam），下拉就从这里读。本插件已收录它、启动时会把全部音色注册进去，于是 dsh-pet 的下拉里直接出现「本机 Breeze TTS 2」这一组：

- 音色 id 形如 `breeze/qinglan`、`breeze/<桌面版克隆音色>`；
- 播放时走 dsh-pet 正常的 `voice.speak` 流程，底层会调到本插件的合成函数（连接模式下自动转成桌面版 multipart 请求）；
- 注册契约（dsh-pet 的 `voice.register`）如下，如果你的插件也有类似的注册表，照这个格式注册即可：

```js
const bv = ctx.get('breezeVoice', true)
if (!bv) return

const def = {
  id: 'breeze',                       // kebab-case，别和别的 provider 撞
  name: '本机 Breeze TTS 2',
  format: 'wav',
  timeoutMs: 200_000,                 // 本机合成可能几十秒，别用默认 15s
  voices: bv.listVoices().map(v => ({
    id: v.id,
    name: v.name,
    tag: (v.kind === 'reference' ? '桌面版' : (v.ready ? '本机' : '未建好'))
       + (v.description ? ' · ' + v.description : ''),
  })),
  synthesize: async ({ text, voice, signal }) => (await bv.speak(text, voice, { signal })).bytes,
}

myVoiceRegister(def)                  // 换成你自己的注册函数
```

要点：
- `synthesize` 收到的 `voice` 是**裸 id**（不带 `breeze/` 前缀），直接传给 `bv.speak` 即可；有 `signal` 就透传，便于上游取消。
- `format` 填 `'wav'`，`timeoutMs` 建议 ≥ 200000，否则本机合成慢时会被超时掐断；
- `bv.listVoices()` 每项结构见方式 B，连接模式下 `kind === 'reference'` 表示桌面版克隆音色、`ready` 恒为 true；自管模式 `ready === false` 的项还没生成 `.breeze` 文件，点了会失败，建议在下拉里标注；
- 音色清单可能延迟刷新（连接模式首次合成前会主动拉一次桌面版音色），可在音色变更时调 `bv.refreshRegistration()` 重注册；
- 如果 dsh-pet 被 `disabled`，它的注册表不存在，本插件的自动注册会静默跳过——这只影响「dsh-pet 这个例子」，不影响其它接入方式。

---

## 方式 A'：通过「其他 HTTP 接口」手动接入（不写对方任何文件）

有些插件（如 **Aurabot**）内置了通用的「其他 HTTP 接口」语音引擎：填一个地址 + 请求方式 + 请求头 + 请求体，它就把要念的话 POST 过去、拿回音频播放。这是官方支持的接法，**不用改对方源码、也不用往它数据目录塞脚本**。

本插件的设置页「接入其它本地语音插件」卡片会检测本机装了哪些**本地**语音插件，并给出手动接入参数（`GET /integrations` 的 `httpGuide`）：

- 接口地址：`http://<DSH 地址>/api/breeze-voice/preview`（卡片里已填好当前地址，可一键复制）
- 请求方式：`POST`
- 请求头：`Content-Type: application/json`
- 请求体：`{"text":"{text}"}`（`{text}` 由对方插件替换成要念的文字）

填法：去目标插件的语音设置里选「其他 HTTP 接口」，把上面四项抄进去，保存即可。

要点：

- **请求体故意不带 `voice`**：念的时候用本插件「本地语音」页当前选中的音色，以后换音色、调情绪、改连接方式都只改本页，对方那边一个字不用动；
- **本插件不写对方任何文件**：不会像"往 local/tts.mjs 塞脚本"那样绕开人家原来的音色/情绪设置——那种做法会把"那个人"念成另一个味儿，已弃用；
- **端口会自动同步**：DSH web 端口每次重启可能不同。只要你已经用「其他 HTTP 接口」接过本插件（对方 `voice.engine='http'` 且地址指向本插件的 `/api/breeze-voice/preview`），本插件会在启动几秒后、以及你打开设置页时，走对方官方的 `POST /aurabot/api/save` 把地址里的端口更新成当前端口（保留路径/`{text}` 占位符）。**只改这一个字段**——对方的音色、情绪、请求方式、请求体、其它顶层配置一律不动；没接过本插件、或用的不是 http 引擎时，一个字都不写。同步结果会显示在接入卡片底部；
- **接不接由你决定**：本插件只检测 + 给参数，第一次接入要你自己去对方面板填；之后端口变化才自动同步，不会替你启用接口。

> 这解决的是「等插件作者更新太慢」的问题：只要目标插件自己留了「其他 HTTP 接口」这种通用扩展点，你就能自己接，不必依赖作者适配。
>
> **上面的内置端口同步只对 Aurabot 生效**（它的配置结构已内置适配）。其它插件也要自动同步的话，点设置页卡片里的「复制给 agent」按钮，把指令粘到 agent 对话窗口——让 agent 现场读那个插件的源码、查明配置存哪/怎么改能生效，再按给定护栏写入。插件本体不硬记各家格式，所以这一步交给 agent 现场适配。完整指令与验收清单见 [让 Agent 帮你同步端口](AGENT-PORT-SYNC.md)。

> **还不确定某插件能不能接？** 先用 [让 Agent 判断能不能接本地语音](AGENT-VOICE-INTEGRATION.md)：它会检测目标插件有没有开放语音接口，有就给针对性接法、没有就建议走 HTTP、两条都没有就明说放弃。agent 只出方案，接不接由你拍板；本插件探测到也不会自动接。

---

## 方式 B：直接调用 `breezeVoice` 服务（最通用）

在**宿主半端**（插件的 `index.js`，cordis 插件）通过 `ctx.get` 获取，建议用 `inject` 处理加载顺序（本插件可能比你的插件晚就绪）。

### 服务接口签名

```js
const bv = ctx.get('breezeVoice', true)   // 第二个参数 true = 软取，没装也不抛错
if (!bv) return                            // 本插件没装 / 还没就绪

// 1) 音色清单：返回数组（同步，取缓存），每项：
//    { id, name, description, instruction, seed, ready, kind, refId? }
//    kind='reference' 表示桌面版克隆音色（合成走 voice_id=refId，ready 恒 true）；
//    kind='instruction' 表示描述式音色（合成走 instruction，注意可能未建好）。
const voices = bv.listVoices()

// 2) 运行状态：
//    连接模式 { mode:'connect', endpoint, configured, loaded, message, voice }
//    自管模式 { mode:'local', root, configured, loaded, lastLoadedAt, lastUsedAt, voice }
const status = await bv.status()

// 3) 合成语音：speak(text, voiceId, opts?) -> { bytes, voice, emotion }
//    bytes 是 WAV（24kHz 单声道 16bit）的 Buffer；voiceId 用不带前缀的裸 id；
//    opts 可传 { signal } 便于取消。两种模式对外接口一致，内部自动分流。
const { bytes, voice, emotion } = await bv.speak('你好呀', 'dafeiyu_mihuban', { signal })

// 4) 音色清单变了（比如用户改了配置）时，刷新注册：
bv.refreshRegistration()
```

### 最小可用接入示例

```js
export const name = 'my-voice-plugin'
export const inject = ['breezeVoice']   // 声明依赖，宿主会等你拿不到时再注入

let dispose = null

export function apply(ctx) {
  const register = () => {
    const bv = ctx.get('breezeVoice', true)
    if (!bv) return
    dispose?.()

    // 把 breeze 的音色转成你自己下拉需要的格式，注册进你自己的语音注册表
    const items = bv.listVoices().map(v => ({
      id: v.id,
      name: v.name,
      ready: v.ready,
    }))

    // ↓↓↓ 换成你自己的注册表 API ↓↓↓
    myVoiceRegistry.register({
      id: 'breeze',
      name: '本机 Breeze TTS 2',
      voices: items,
      synthesize: async ({ text, voice }) => {
        const r = await bv.speak(text, voice)   // 直接借用本插件合成
        return r.bytes                          // 返回 WAV 字节
      },
    })
  }

  register()
  ctx.inject(['breezeVoice'], register)   // 本插件晚就绪时补一次
  ctx.effect(() => () => dispose?.())
}
```

---

## 也可以走纯 HTTP（不写 cordis 插件）

本插件在宿主注册了 `/api/breeze-voice` 前缀路由，如果你的插件（或前端页面）不方便拿服务，可以直接发 HTTP 请求：

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/api/breeze-voice/config` | 配置 + 音色清单 + 状态 |
| `GET` | `/api/breeze-voice/voices` | 音色清单 |
| `GET` | `/api/breeze-voice/status` | 加载状态 |
| `POST` | `/api/breeze-voice/preview` | `{text, voice}` → 直接返回 WAV 字节流（浏览器可直接 `<audio src>`） |
| `POST` | `/api/breeze-voice/voice/add` | multipart：`ref_audio`(WAV) + `ref_text` + `name` + 可选 `description` → 添加克隆音色到桌面版音色库（需桌面版在跑，连接模式） |
| `POST` | `/api/breeze-voice/voice/delete` | `{id}` → 删除桌面版音色库里的克隆音色 |
| `GET` | `/api/breeze-voice/install/status` | 检测桌面版装没装/装哪了：`installed`/`dir`/`uninstall`/`backendRunning`/`linked`/`downloadUrl` |
| `POST` | `/api/breeze-voice/install/link` | 把检测到的安装目录写进配置并刷新链路；可带 `{dir}`，不带则现场从卸载注册表检测 |
| `GET` | `/api/breeze-voice/integrations` | 检测本机有哪些**本地**语音插件 + 给手动接入参数 + 做一次端口同步：`{ok, plugins:[{id, kind, status, detail, dataDir}], httpGuide:{url, method, headers, body, note}, sync}`（`kind:'pet'` 自动接入；`kind:'manual-http'` 需手动接入。`httpGuide` 抄进对方「其他 HTTP 接口」即可；`sync` 为端口同步结果） |

```js
const r = await fetch('/api/breeze-voice/voices', { credentials: 'same-origin' })
const { voices } = await r.json()
```

> 添加音色走 `FormData` 原样透传到桌面版 `/v1/voices`，参考音频会被规范化为 24 kHz 单声道 16 bit WAV（最长 30 秒），音色文件由桌面版写进它安装目录的 `voices\` 库——插件自己不另存一份，两边共用同一份音色。

---

## 常见问题

**Q：装了本插件，我的插件下拉还是没出现音色？**
A：DSH 没有全局 TTS 注册表，不会自动出现在任何插件里。三条路：①dsh-pet 已自动接好（方式 A）；②目标插件有「其他 HTTP 接口」（如 Aurabot），在设置页「接入其它本地语音插件」复制参数、去对方面板粘贴，不用等作者更新，本插件不写它任何文件（方式 A'）；③你的插件愿意主动接，照方式 B 调 `breezeVoice` 服务加几行代码。

**Q：拿到服务时是 `null`？**
A：加载顺序问题。用 `ctx.inject(['breezeVoice'], fn)` 等它就绪后再注册，别在 `apply` 里假设它一定已经存在。

**Q：合成报「请先填写安装目录」？**
A：这是**自管模式**才有的提示——本插件没自动探测到旧版 Breeze 目录。两个解法：①推荐装 Breeze 桌面版并保持「连接方式=自动」，连接模式不需要安装目录；②确实要用自管模式，就去设置页「本地语音 → 安装目录」手动填（含 breeze-server.exe 和 voices 文件夹；桌面版布局缺配置时插件会自动补写），保存后重试。

**Q：音色标着「还没建好」能用吗？**
A：不能。那是自管模式下预设/自定义项还没生成对应的 `.breeze` 文件，需要先在 Breeze 侧设计生成。连接模式的桌面版克隆音色标「（桌面版）」，可直接用。

**Q：连接模式和自管模式怎么选？装了桌面版还要填目录吗？**
A：「连接方式=自动」即可：桌面版后端开着就走连接模式（不填目录、不碰 `breeze-runtime.json`，模型和显存交给桌面版），没开就退回自管模式。也可手动锁定为「连桌面版」或「本机自管」。

**Q：多个 TTS 插件都想注册，ID 撞了怎么办？**
A：provider id 用 kebab-case 且保证唯一（本插件固定用 `breeze`）。注册表遇到重复 id 通常会直接抛错，注册前先确认没占用。

**Q：怎么添加自己的音色？音色存在哪里？**
A：连接模式下，设置页「本地语音 → 音色库 · 添加克隆音色」上传参考音频（≤30 秒）、填逐字稿和名字即可。插件把请求透传给桌面版 `/v1/voices`，音色文件由桌面版存进它安装目录的 `voices\` 库——桌面版和 DSH 共用同一份，不用两头各建一次。添加需要桌面版正在运行；克隆音色可在列表里一键删除（走 `POST /voice/delete`）。自管模式没有这个图形化添加入口（音色来自安装目录的 `custom-presets.json`，`.breeze` 文件要在 Breeze 侧生成）。

**Q：情绪语气怎么工作？会叠人设吗？**
A：不叠人设——性格/人设由聊天插件（那一层已经决定了这句话是什么性格说出来的），本插件只把「这句怎么念」的情绪提示交给 TTS。设置页「情绪语气」三档：`off` 不加；`keyword`（默认）按文字关键词挑，0 token、离线可用；`model` 会读聊天插件落盘的心情值（`~/.dsh/plugins-data/aurabot/mood.json`，`value` 五档 + `reason`），再用 DSH 当前默认模型把这句该怎么念写成一句自然语言提示（约百来 token，同句+同心情+同音色缓存 10 分钟，模型出错或没装聊天插件自动退回关键词）。接入方无需改代码：`bv.speak()` 返回的 `emotion` 字段是当前情绪档名。
