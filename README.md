# 本地语音 · Breeze TTS 2（dsh-breeze-voice）

一个独立的 DSH 本地语音输出插件：把本机的 **Breeze TTS 2** 封装成统一服务，在「设置 → 本地语音」里选择音色、情绪；其它语音插件可按需接入这些音色。

> 只做**语音输出端（TTS）**，不碰任何语音输入识别（STT）。
> 设置页的交互结构参考了同类语音设置的做法，但本插件是独立实现，不依赖任何其它插件运行。

## 两种工作方式

插件会自动在两种模式间切换（设置页「连接方式」可选「自动 / 连桌面版 / 本机自管」）：

| 模式 | 用什么时候 | 谁在跑语音引擎 | 你要做的事 |
|---|---|---|---|
| **连接模式**（默认自动探测） | 你装了 [Breeze TTS 2 桌面版](#相关资源breeze-tts-2-本体) | 桌面版后端（固定 `127.0.0.1:18099`） | 装好桌面版即可，插件自动连上；音色、模型、显存都在桌面版里管 |
| **自管模式**（兼容旧环境） | 你用的是早先 Aurabot 那套本机引擎、没跑桌面版 | 插件自己 spawn `breeze-server` | 在设置页填一次安装目录（含 `breeze-runtime.json`） |

- **自动（推荐）**：插件启动时探测 `http://127.0.0.1:18099/health`，桌面版开着就走连接模式，否则退回自管模式。装了桌面版的用户什么都不用配。
- **连桌面版**：强制走连接模式，接口地址默认 `http://127.0.0.1:18099`（可在设置页改）。
- **本机自管**：强制走插件自己管理引擎，需填安装目录。

## 它做什么

- **设置页主界面**：连接方式 / 接口地址 / 音色 / 自动情绪 / 傲娇底色 / 模型判断情绪 / 空闲卸载 / 空闲多久卸载 / 安装目录 / 显存，外加试听按钮和状态栏。
- **连接模式合成**：用 `multipart/form-data` 把文字/音色发给桌面版（字段 `text` / `instruction` / `voice_id`），把返回的 24 kHz 单声道 16 bit 裸 PCM 封成 WAV；不联网、不调用在线 TTS。
- **音色来源**：连接模式下，音色来自桌面版的克隆音色库（`voices\`，靠 `voice_id` 驱动）+ 内置描述式预设（靠 `instruction` 驱动）；自管模式下音色来自安装目录的 `custom-presets.json`。
- **情绪**：按文字关键词 + 大肥鱼人设骨架离线挑语气，音色身份始终保留在最前。
- **通用注册**：把音色以 `breeze/音色id` 注册进 dsh-pet 的语音注册表（仅当 dsh-pet 启用时），并以 `breezeVoice` 服务暴露 `listVoices / status / speak / refreshRegistration` 给任何愿意接入的插件。

## 配置

设置存在 `<DSH_PROFILE_DIR>/plugins-data/breeze-voice/config.json`，字段：

| 字段 | 默认 | 说明 |
|---|---|---|
| `mode` | `auto` | 连接方式：`auto`（自动探测）/ `connect`（连桌面版）/ `local`（本机自管） |
| `endpoint` | `http://127.0.0.1:18099` | 桌面版后端接口地址（连接模式用） |
| `root` | `''` | 自管模式的 Breeze 安装目录（含 `breeze-runtime.json` 和 `voices/`）；留空会自动探测 |
| `voice` | `qinglan` | 当前音色 id |
| `autoEmotion` | `true` | 按文字自动挑情绪 |
| `emotionBackbone` | `true` | 傲娇底色作为情绪主干 |
| `emotionModel` | `false` | 预留：当前版本仍用离线关键词推断，不额外调模型 |
| `unloadIdle` | `true` | 自管模式空闲自动卸载模型释放显存 |
| `unloadIdleMinutes` | `5` | 自管模式空闲多久卸载（1/3/5/10/15/30） |
| `rate` | `1` | 语速（引擎暂不消费，保留给契约） |

改设置后会自动重新注册音色清单到语音输出端注册表。连接模式下模型加载/卸载、下载、显存档位由桌面版自己管理，插件的「卸载/加载」按钮会提示交给桌面版。

## HTTP 接口（宿主半端，前缀 `/api/breeze-voice`）

- `GET /config` — 配置 + 音色清单 + 加载状态
- `POST /config` — 写配置（白名单）
- `GET /voices` — 音色清单（连接模式含桌面版克隆音色）
- `GET /status` — 当前模式 / 加载状态
- `POST /preview` — `{text, voice}` → WAV 字节（面板试听）
- `POST /unload` / `POST /load` — 自管模式手动卸载/加载；连接模式提示交给桌面版

## 让其它插件也用上这些音色

本插件不会让所有语音插件**自动**出现音色（DSH 核心没有统一 TTS 注册表）。这里以 **dsh-pet** 为例说明两种接法：

- **例：dsh-pet** 已经读它自己的语音注册表，本插件启动时会把音色注册进去，于是 dsh-pet 的下拉直接出现「本机 Breeze TTS 2」这一组——这是「零改动自动生效」的例子。
- **其它插件** 可主动接入本插件暴露的 `breezeVoice` 服务，或直接调 `/api/breeze-voice` HTTP 接口。

完整的接入方式、接口签名和示例见 [集成说明](docs/INTEGRATION.md)。

## 安装本插件（线上仓库）

本插件托管在 GitHub 仓库 `chencoool/dsh-breeze-voice`。用 DSH 自带的插件命令，从仓库安装到你正在用的 profile：

```powershell
dsh plugin --profile <你的profile名> add github:chencoool/dsh-breeze-voice
```

桌面端用的一般是 `desktop` profile：

```powershell
dsh plugin --profile desktop add github:chencoool/dsh-breeze-voice
```

装完**重启 DSH**，设置侧栏出现「本地语音」页。

> 当前仓库为私有，安装前需确保本机已登录有该仓库权限的账号（`gh auth login`）；仓库公开后任何人都能直接装。
> 开发调试时也可以走本地目录安装：DSH「插件 → 添加插件」选本插件目录即可。

## 相关资源（Breeze TTS 2 本体）

本插件只负责「把本地 Breeze 音色提供给 DSH 使用」，**不自带**语音引擎和模型。**推荐用桌面版**：装好后插件自动连上，模型和显存都不用你管。

| 资源 | 地址 |
|---|---|
| **Breeze TTS 2 桌面版（推荐，安装包从这里下）** | https://github.com/dkvkvk/breeze-tts-2-desktop |
| 桌面版安装包（Releases 页的 `BreezeTTS2-Setup-*.exe`，约 131 MB） | https://github.com/dkvkvk/breeze-tts-2-desktop/releases |
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

> 连接模式不需要你填安装目录、也不需要 `breeze-runtime.json`——那是自管模式才用的。文档不写死任何本机路径，以你实际安装时选的目录为准。

## 版权

本插件 MIT。Breeze TTS 2 的引擎、模型与音色的版权归各自上游作者所有，使用时遵守其许可条款。
