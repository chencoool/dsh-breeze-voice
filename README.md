# 本地语音 · Breeze TTS 2（dsh-breeze-voice）

一个独立的 DSH 本地语音输出插件：把本机的 **Breeze TTS 2** 封装成统一服务，在「设置 → 本地语音」里选择音色、情绪；其它语音插件可按需接入这些音色。

> 只做**语音输出端（TTS）**，不碰任何语音输入识别（STT）。
> 设置页的交互结构参考了同类语音设置的做法，但本插件是独立实现，不依赖任何其它插件运行。

## 两种工作方式

插件会自动在两种模式间切换（设置页「连接方式」可选「自动 / 连桌面版 / 本机自管」）：

| 模式 | 用什么时候 | 谁在跑语音引擎 | 你要做的事 |
|---|---|---|---|
| **桌面模式**（默认自动探测） | 你装了 [Breeze TTS 2 桌面版](#相关资源breeze-tts-2-本体) | 桌面版后端（固定 `127.0.0.1:18099`） | 装好桌面版即可，插件自动连上；音色、模型、显存都在桌面版里管 |
| **自管模式**（本机引擎） | 你在本机装了 Breeze 引擎、但没跑桌面版 | 插件自己 spawn `breeze-server` | 在设置页填一次安装目录（或让插件自动探测）即可 |

- **自动（推荐）**：插件启动时探测 `http://127.0.0.1:18099/health`，桌面版开着就走桌面模式，否则退回自管模式。装了桌面版的用户什么都不用配。
- **连桌面版**：强制走桌面模式，接口地址默认 `http://127.0.0.1:18099`（可在设置页改）。
- **本机自管**：强制走插件自己管理引擎，需填安装目录。

> 自管模式用的是安装目录里的 `breeze-server.exe`（程序）和 `breeze-runtime.json`（记着程序/模型/端口路径）。桌面版本身**不带** `breeze-runtime.json`——如果插件发现你填的目录是桌面版布局（`resources/runtime/breeze-server.exe` + `models/*.gguf`），会**自动补写一份** `breeze-runtime.json`（只补缺失的，绝不覆盖已有文件），模型默认挑 `q4_k` 档、端口用 `18370`（避开桌面版的 `18099`）。已有完整配置的安装则直接读取使用。桌面模式完全不需要这些，直接连桌面版后端即可。

## 它做什么

- **桌面版安装入口**：设置页「本地语音」顶部有一张「桌面版安装」卡片。未检测到桌面版时给下载页链接（第三方开源桌面端 VoiceTrackStudio，安装路径你自己选）；检测到后显示安装目录与「自动配置链路」按钮，一键把安装目录写进配置并刷新音色。要卸载时提示去安装目录运行卸载器。装没装实时查 Windows 卸载注册表，不记标记——卸载后重启 DSH 会自动回到待安装态；若你从没手填过安装目录，桌面版装好后重启 DSH 会自动认出并配好链路。
- **设置页主界面**：连接方式 / 接口地址 / 音色 / 情绪语气 / 空闲卸载 / 空闲多久卸载 / 安装目录 / 显存，外加试听按钮和状态栏。
- **桌面模式合成**：用 `multipart/form-data` 把文字/音色发给桌面版（字段 `text` / `instruction` / `voice_id`），把返回的 24 kHz 单声道 16 bit 裸 PCM 封成 WAV；不联网、不调用在线 TTS。
- **音色来源**：桌面模式下，音色来自桌面版的克隆音色库（`voices\`，靠 `voice_id` 驱动）+ 内置描述式预设（靠 `instruction` 驱动）；自管模式下音色来自安装目录的 `custom-presets.json`。
- **添加音色（桌面模式）**：在设置页「音色库 · 添加克隆音色」里上传一段参考音频（自动统一成 24 kHz 单声道 16 bit WAV，最长 30 秒）+ 填逐字稿和名字，插件把它透传到桌面版的 `/v1/voices`，**音色文件直接存进桌面版的 `voices\` 库**。这样桌面版和 DSH 两边看到的是同一份音色，换音色不用两头折腾；克隆音色还能在列表里一键删除。
- **情绪语气**：`toneMode` 三档——`off` 不加情绪；`keyword`（默认）按文字关键词挑语气，0 token、离线可用；`model` **关键词定档 + 模型写念法**：先用关键词（含括号动作/口头语气词）判出情绪档和强度，再读聊天插件（Aurabot）落盘的心情值 `mood.json` 和最近几句对话，让 DSH 当前默认模型把这句该怎么念写成一句 ≤40 字的提示（语速、音调、气息、尾音、笑意/鼻音/哽咽），替换掉档位骨架里的念法描述——档位和强度仍以关键词为准。单句比关键词档多几十 token（约百来 token），同一句+同心情+同音色+同上下文缓存 10 分钟；模型失败或输出不合规就退回关键词骨架，绝不因此不说话。音色身份始终排最前；**人设/性格不在这里**——那由聊天插件决定，本插件只管情绪化的念法。28 个纯情绪档 + 撒娇/戏谑/温柔 3 个社交语气档。情绪档的「怎么念」描述统一使用 Breeze 官方 34 种声音事件的词汇（抽泣、哼鼻子、轻笑、啧嘴、耳语、清嗓、打哈欠……），31 档全覆盖；只是借官方**用词**写 instructions，不在正文里插 `[叹气]` 这类标记。关键词表同时识别括号动作（尾巴翘起来/鼓起腮帮子/尾巴拍地）和句首口头语气词（哼/啧/切）。
- **参考聊天上下文**：聊天插件的 HTTP 语音接口只把要念的这一句发过来，拿不到前因后果；本插件会读它落盘的聊天记录（不需要额外开关，选了「模型润色语气」就自动读），在 `model` 档把最近几句一起交给模型，好判断这句的口气。格式差异由适配层处理（`engine/adapters/`）：自带 `aurabot`（自动识别，读 `chatlog/<日期>.jsonl`）、`dsh`（读 DSH 会话窗口，填聊天插件的工作目录即可）和 `jsonl`（通用兜底，一行一条 JSON，字段名在设置页配）。这三条对任何聊天插件都适用，不绑定某一家：`dsh` 只要那个插件是跑在 DSH 会话里就行，`jsonl` 只要它的记录是一行一条 JSON 就行。换别的聊天插件时，要么写一个约 20 行的适配器，要么在设置页把「聊天记录来源」选成「通用 JSONL」再填目录和字段名。判档本身仍只看这句话——对方的情绪和她的回应不同源。读不到就当没有；`keyword` 档不读文件，仍零 IO、零 token。
- **通用注册**：把音色以 `breeze/音色id` 注册进 dsh-pet 的语音注册表（仅当 dsh-pet 启用时），并以 `breezeVoice` 服务暴露 `listVoices / status / speak / refreshRegistration` 给任何愿意接入的插件。
- **接入其它本地语音插件**：设置页「接入其它本地语音插件」卡片会检测本机装了哪些**本地**语音插件。dsh-pet 的私有接口 `petApi7340.voice` 已收录、自动接好（DSH 核心层并没有通用 TTS 标准接口，这是 dsh-pet 自己的服务）；其它插件（如 Aurabot）本插件**绝不往它目录里塞脚本、不绕开它原来的音色/情绪设置**——只在卡片里给出「其他 HTTP 接口」的手动接入参数（地址/方式/请求头/请求体），你自己去那个插件面板填一次。DSH 重启后 web 端口会变：**只要你已经用「其他 HTTP 接口」接过本插件**，本插件会在启动和打开设置页时走它的官方保存接口，把地址里的端口自动更新成当前端口（只改端口，音色/情绪/请求方式/请求体一律不动；没接过本插件时一个字都不写）。音色/情绪/连接方式仍全在本插件设置页管；本插件只做本地语音，云端 TTS 不在范围。

## 配置

设置存在 `<DSH_PROFILE_DIR>/plugins-data/breeze-voice/config.json`，字段：

| 字段 | 默认 | 说明 |
|---|---|---|
| `mode` | `auto` | 连接方式：`auto`（自动探测）/ `connect`（连桌面版）/ `local`（本机自管） |
| `endpoint` | `http://127.0.0.1:18099` | 桌面版后端接口地址（桌面模式用） |
| `root` | `''` | 自管模式的 Breeze 安装目录（含 `breeze-server.exe` 和 `voices/`）；桌面版布局缺 `breeze-runtime.json` 时插件会自动补写；留空会自动探测 |
| `voice` | `qinglan` | 当前音色 id |
| `toneMode` | `keyword` | 情绪语气：`off`（关）/ `keyword`（关键词推断，0 token，默认）/ `model`（模型润色语气：关键词先定档，再读聊天插件心情值 + 最近对话，让模型写一句 ≤40 字念法，单句约百来 token，带缓存）。旧配置里的 `autoEmotion`/`emotionBackbone`/`emotionModel` 三开关会自动迁移到这一项 |
| `contextAdapter` | `auto` | 聊天记录来源适配器：`auto`（自动识别）/ `aurabot`（Aurabot QQ）/ `dsh`（DSH 会话窗口，配下一项）/ `jsonl`（通用 JSONL，配下面两项） |
| `contextDir` | `''` | `dsh` 填聊天插件在 DSH 里跑会话用的工作目录（该目录本身空着也没关系，它只用来定位会话窗口：`<工作目录>` 会映射到 `~/.dsh/sessions/--<盘符与路径>--/`）；`jsonl` 填含 `.jsonl` 记录的目录 |
| `contextFields` | `''` | 通用 JSONL 的字段映射（JSON 字符串），如 `{"t":"time","who":"sender","text":"content"}` |
| `moodFile` | `''` | 聊天插件写心情的 json 文件。可填完整路径，也可只填它保存数据的目录（自动找里面的 `mood.json`）。目前只适配了 Aurabot——用 Aurabot 时留空即可，会自动读它的默认位置。别的聊天插件有心情文件就填；没有心情设定也留空，插件只看这句话本身判断语气。只在 `model` 档使用 |
| `useContext` | `true` | （兼容项）`model` 档默认就读聊天记录；显式写 `false` 可关掉 |
| `unloadIdle` | `true` | 自管模式空闲自动卸载模型释放显存 |
| `unloadIdleMinutes` | `5` | 自管模式空闲多久卸载（1/3/5/10/15/30） |
| `rate` | `1` | 语速（引擎暂不消费，保留给契约） |

改设置后会自动重新注册音色清单到语音输出端注册表。桌面模式下模型加载/卸载、下载、显存档位由桌面版自己管理，插件的「卸载/加载」按钮会提示交给桌面版。

## HTTP 接口（宿主半端，前缀 `/api/breeze-voice`）

- `GET /config` — 配置 + 音色清单 + 加载状态
- `POST /config` — 写配置（白名单）
- `GET /voices` — 音色清单（桌面模式含桌面版克隆音色）
- `GET /status` — 当前模式 / 加载状态
- `POST /preview` — `{text, voice}` → WAV 字节（面板试听）
- `POST /voice/add` — multipart/form-data（`ref_audio` 参考 WAV + `ref_text` 逐字稿 + `name` 名字 + 可选 `description`）→ 透传到桌面版 `/v1/voices`，把音色存进桌面版音色库；需桌面版在跑
- `POST /voice/delete` — `{id}` → 删除桌面版音色库里的一个克隆音色
- `GET /install/status` — 检测桌面版装没装/装哪了（`installed` / `dir` / `uninstall` / `backendRunning` / `linked` / `downloadUrl`）
- `POST /install/link` — 把检测到的安装目录写进配置并刷新链路；可带 `{dir}` 指定，不带则现场从卸载注册表检测
- `GET /integrations` — 检测本机有哪些**本地**语音插件，给出手动接入参数，并顺带做一次端口同步：`{ok, plugins:[{id, kind, status, detail, dataDir}], httpGuide:{url, method, headers, body, note}, sync}`（`kind:'pet'` 自动接入；`kind:'manual-http'` 需手动接入。`httpGuide` 就是填进其它插件「其他 HTTP 接口」的参数；请求体不带 voice，念的时候跟随本页当前音色。`sync` 是本次端口同步结果：updated/unchanged/skipped）
- `POST /unload` / `POST /load` — 自管模式手动卸载/加载；桌面模式提示交给桌面版

## 让其它插件也用上这些音色

本插件不会让所有语音插件**自动**出现音色（DSH 核心没有统一 TTS 注册表）。这里以 **dsh-pet** 为例说明两种接法：

- **例：dsh-pet** 已经读它自己的语音注册表，本插件启动时会把音色注册进去，于是 dsh-pet 的下拉直接出现「本机 Breeze TTS 2」这一组——这是「零改动自动生效」的例子。
- **有「其他 HTTP 接口」的插件（如 Aurabot）**：在设置页「接入其它本地语音插件」卡片复制手动接入参数，去那个插件的语音设置里选「其他 HTTP 接口」，填：接口地址=卡片给的 `url`、请求方式=`POST`、请求头=`Content-Type: application/json`、请求体=`{"text":"{text}"}`。保存即可。**本插件不写它的任何文件**，所以不会动它原来的音色/情绪设置；音色、情绪、连接方式仍全在本页管。注意 DSH 重启后 web 端口可能变，地址要跟着更新。具体见 [集成说明](docs/INTEGRATION.md)。**别的插件也要端口自动同步？** 内置同步只覆盖了 Aurabot；其它插件可以点卡片里的「复制给 agent」按钮，把一段指令粘到 agent 对话窗口，让 agent 现场读那个插件源码、适配它的配置（插件本体不硬记各家格式），详见 [让 Agent 帮你同步端口](docs/AGENT-PORT-SYNC.md)。
- **其它插件** 可主动接入本插件暴露的 `breezeVoice` 服务，或直接调 `/api/breeze-voice` HTTP 接口。

**拿不准某个插件能不能接？** 把 [让 Agent 判断能不能接本地语音](docs/AGENT-VOICE-INTEGRATION.md) 整段发给 agent 对话窗口——它会检测目标插件有没有开放语音接口：有就给针对性接法并把选择权交给你，没有就建议走「其他 HTTP 接口」，两条都没有就明说放弃。本插件只把自己的开放服务摆在那儿，探测到也不会自动接，接不接全由你决定。

完整的接入方式、接口签名和示例见 [集成说明](docs/INTEGRATION.md)。本插件只管**本地**语音，云端 TTS 插件不在支持范围。

## 安装本插件（线上仓库）

本插件托管在 GitHub 仓库 `chencoool/dsh-breeze-voice`。

**最省事的装法**：把下面这句话复制给 DSH 的会话框，让它帮你装：

```
帮我安装这个插件https://github.com/chencoool/dsh-breeze-voice
```

它会自己识别你的 profile、拉仓库、装好并告诉你重启。

也可以手动用 DSH 自带的插件命令，从仓库安装到你正在用的 profile：

```powershell
dsh plugin --profile <你的profile名> add github:chencoool/dsh-breeze-voice
```

桌面端用的一般是 `desktop` profile：

```powershell
dsh plugin --profile desktop add github:chencoool/dsh-breeze-voice
```

装完**重启 DSH**，设置侧栏出现「本地语音」页。

> 开发调试时也可以走本地目录安装：DSH「插件 → 添加插件」选本插件目录即可。

## 相关资源（Breeze TTS 2 本体）

本插件只负责「把本地 Breeze 音色提供给 DSH 使用」，**不自带**语音引擎和模型。**推荐用桌面版**：装好后插件自动连上，模型和显存都不用你管。

| 资源 | 地址 |
|---|---|
| **Breeze TTS 2 桌面版（推荐，安装包从这里下）** | https://github.com/dkvkvk/breeze-tts-2-desktop |
| 桌面版安装包（Releases 页的 `BreezeTTS2-Setup-*.exe`，约 131 MB） | https://github.com/dkvkvk/breeze-tts-2-desktop/releases |
| 官方音色库（BreezeBlue，可挑现成音色） | https://breezeblue.ai/zh/app/voice-library |
| 官方 PyTorch 实现（源码，非安装包，需 Linux + Python + CUDA） | https://github.com/breezeblue-ai/breeze-tts |
| 上游后端项目（HoppouAI，非官方 C++ 实现） | https://github.com/HoppouAI/Breeze-TTS-2.cpp |
| 原模型（BreezeBlue） | https://huggingface.co/BreezeBlue/Breeze-TTS-2 |
| GGUF 量化模型 | https://huggingface.co/HoppouAI/Breeze-TTS-2.cpp |

**国内镜像（原始站连不上时用）**：

- Hugging Face 模型：桌面版首次启动会内置 `HuggingFace → hf-mirror → hf-mirror.net` 自动回退下载；手动下可设 `HF_ENDPOINT=https://hf-mirror.com`，或把 `huggingface.co/...` 域名换成 `hf-mirror.com` 打开。
- GitHub Release 下载加速：把 release 资产链接贴到 https://ghproxy.net/ 加速（如 `https://ghproxy.net/https://github.com/dkvkvk/breeze-tts-2-desktop/releases/download/...`）。

> 许可提醒：桌面版代码 Apache-2.0；Breeze TTS 2 模型权重为 **BreezeBlue Research and Non-Commercial License，仅限非商业研究**。商用前请核对模型和各音色的许可条款。

## 下载安装 Breeze TTS 2 桌面版（安装路径你自己选）

1. 到桌面版 [Releases](https://github.com/dkvkvk/breeze-tts-2-desktop/releases/latest) 下载 `BreezeTTS2-Setup-*.exe`（约 131 MB，自带运行时，不用另装 WebView2 / .NET）。
2. 双击安装，**安装目录完全由你决定**：默认是 `D:\Breeze TTS 2`，安装向导的目录输入框可以直接键入或粘贴任意路径；只填盘符（如 `D:\`）会自动补成 `D:\Breeze TTS 2`。
3. 首次启动会**自动下载**模型（默认 `breeze-tts-2-q4_k.gguf`，约 2.4 GB），断点续传 + 镜像回退，界面有进度；量化档位（q4_k / q6_k / q8_0 / f16 等）在桌面版界面里切换，它会按你的显存给推荐。模型放在安装目录 `models\`，音色放在 `voices\`。
4. **启动桌面版**，然后回到 DSH：本插件的「连接方式」保持「自动」即可，它探测到桌面版后端就会自动连上，音色下拉里会出现桌面版的克隆音色。
5. **想加自己的音色**：在设置页「本地语音 → 音色库 · 添加克隆音色」，上传一段参考音频（≤30 秒，自动转成 24 kHz 单声道 WAV）、填逐字稿和名字，点添加。音色会直接存进桌面版的 `voices\` 库，桌面版和 DSH 共用；在下面的克隆音色列表里还能一键删除。

> 桌面模式不需要你填安装目录、也不需要 `breeze-runtime.json`——那是自管模式才用的。文档不写死任何本机路径，以你实际安装时选的目录为准。

## 版权

本插件 MIT。Breeze TTS 2 的引擎、模型与音色的版权归各自上游作者所有，使用时遵守其许可条款。
