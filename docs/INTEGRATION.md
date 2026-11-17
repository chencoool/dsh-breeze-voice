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
2. 本机装好 Breeze TTS 2：从 [dkvkvk/breeze-tts-2-desktop 的 Releases](https://github.com/dkvkvk/breeze-tts-2-desktop/releases) 下载 `BreezeTTS2-Setup-*.exe`，安装目录自己选。装好后应有 `breeze-runtime.json`、模型、`.breeze` 音色文件；本插件会自动探测安装目录，也可在设置页「本地语音 → 安装目录」手动填。详见 README 的「下载安装 Breeze TTS 2」章节。
3. 确认音色已就绪：设置页音色下拉里标着「本机」的项就是能直接用的；标「还没建好」的要先设计生成 `.breeze` 文件。

---

## 方式 A（举例）：dsh-pet 是怎么接上的

这里用 **dsh-pet** 当一个具体例子——它维护自己的语音注册表 `petApi7340.voice`，下拉就从这里读。本插件启动时会把全部音色注册进去，于是 dsh-pet 的下拉里直接出现「本机 Breeze TTS 2」这一组：

- 音色 id 形如 `breeze/dafeiyu_mihuban`、`breeze/aojiao_daxiaojie`；
- 播放时走 dsh-pet 正常的 `voice.speak` 流程，底层会调到本插件的合成函数；
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
    tag: (v.ready ? '本机' : '未建好') + (v.description ? ' · ' + v.description : ''),
  })),
  synthesize: async ({ text, voice }) => (await bv.speak(text, voice)).bytes,
}

myVoiceRegister(def)                  // 换成你自己的注册函数
```

要点：
- `synthesize` 收到的 `voice` 是**裸 id**（不带 `breeze/` 前缀），直接传给 `bv.speak` 即可；
- `format` 填 `'wav'`，`timeoutMs` 建议 ≥ 200000，否则本机合成慢时会被超时掐断；
- `bv.listVoices()` 里 `ready === false` 的音色还没生成 `.breeze` 文件，点了会合成失败，建议在下拉里标注出来；
- 如果 dsh-pet 被 `disabled`，它的注册表不存在，本插件的自动注册会静默跳过——这只影响「dsh-pet 这个例子」，不影响其它接入方式。

---

## 方式 B：直接调用 `breezeVoice` 服务（最通用）

在**宿主半端**（插件的 `index.js`，cordis 插件）通过 `ctx.get` 获取，建议用 `inject` 处理加载顺序（本插件可能比你的插件晚就绪）。

### 服务接口签名

```js
const bv = ctx.get('breezeVoice', true)   // 第二个参数 true = 软取，没装也不抛错
if (!bv) return                            // 本插件没装 / 还没就绪

// 1) 音色清单：返回数组，每项 { id, name, description, instruction, seed, ready }
const voices = bv.listVoices()

// 2) 运行状态：{ root, configured, loaded, lastLoadedAt, lastUsedAt, voice }
const status = await bv.status()

// 3) 合成语音：speak(text, voiceId, opts?) -> { bytes, voice, emotion }
//    bytes 是 WAV（24kHz 单声道 16bit）的 Buffer；voiceId 用不带前缀的裸 id
const { bytes, voice, emotion } = await bv.speak('你好呀', 'dafeiyu_mihuban')

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

```js
const r = await fetch('/api/breeze-voice/voices', { credentials: 'same-origin' })
const { voices } = await r.json()
```

---

## 常见问题

**Q：装了本插件，我的插件下拉还是没出现音色？**
A：DSH 没有全局 TTS 注册表，不会自动出现在任何插件里。需要你的插件主动接入——照上面的方式 A（有自己注册表时）或方式 B（直接调服务）加几行代码。dsh-pet 只是已经接好的一个例子。

**Q：拿到服务时是 `null`？**
A：加载顺序问题。用 `ctx.inject(['breezeVoice'], fn)` 等它就绪后再注册，别在 `apply` 里假设它一定已经存在。

**Q：合成报「请先填写安装目录」？**
A：本插件没自动探测到 Breeze 目录。去设置页「本地语音 → 安装目录」手动填（要含 `breeze-runtime.json`），保存后重试。

**Q：音色标着「还没建好」能用吗？**
A：不能。那是预设/自定义项还没生成对应的 `.breeze` 文件，需要先在 Breeze 侧设计生成。

**Q：多个 TTS 插件都想注册，ID 撞了怎么办？**
A：provider id 用 kebab-case 且保证唯一（本插件固定用 `breeze`）。注册表遇到重复 id 通常会直接抛错，注册前先确认没占用。
