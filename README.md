# 本地语音 · Breeze TTS 2（dsh-breeze-voice）

一个独立的 DSH 本地语音输出插件：把本机的 **Breeze TTS 2** 封装成统一服务，在「设置 → 本地语音」里选择音色、情绪和显存策略；其它语音插件可按需接入这些音色。

> 只做**语音输出端（TTS）**，不碰任何语音输入识别（STT）。
> 设置页的交互结构参考了同类语音设置的做法，但本插件是独立实现，不依赖任何其它插件运行。

## 它做什么

- **设置页主界面**：音色 / 自动情绪 / 傲娇底色 / 模型判断情绪 / 空闲卸载 / 空闲多久卸载 / 安装目录 / 显存（卸载·加载），外加一个试听按钮和状态栏。
- **本机合成**：调用本机 `breeze-server`，返回 24 kHz 单声道 16 bit WAV；不联网、不调用在线 TTS。
- **情绪**：按文字关键词 + 大肥鱼人设骨架离线挑语气，音色身份始终保留在最前。
- **通用注册**：把音色以 `breeze/音色id` 注册进 dsh-pet 的语音注册表（仅当 dsh-pet 启用时），并以 `breezeVoice` 服务暴露 `listVoices / status / speak / refreshRegistration` 给任何愿意接入的插件。

## 配置

设置存在 `<DSH_PROFILE_DIR>/plugins-data/breeze-voice/config.json`，字段：

| 字段 | 默认 | 说明 |
|---|---|---|
| `root` | `''` | Breeze 安装目录（要含 `breeze-runtime.json` 和 `voices/`）。留空时会自动从本机常见配置里探测 |
| `voice` | `qinglan` | 当前音色 id |
| `autoEmotion` | `true` | 按文字自动挑情绪 |
| `emotionBackbone` | `true` | 傲娇底色作为情绪主干 |
| `emotionModel` | `false` | 预留：当前版本仍用离线关键词推断，不额外调模型 |
| `unloadIdle` | `true` | 空闲自动卸载模型释放显存 |
| `unloadIdleMinutes` | `5` | 空闲多久卸载（1/3/5/10/15/30） |
| `rate` | `1` | 语速（引擎暂不消费，保留给契约） |

改设置后会自动重新注册音色清单到语音输出端注册表。

## HTTP 接口（宿主半端，前缀 `/api/breeze-voice`）

- `GET /config` — 配置 + 音色清单 + 加载状态
- `POST /config` — 写配置（白名单）
- `GET /voices` — 音色清单
- `GET /status` — 显存/加载状态
- `POST /preview` — `{text, voice}` → WAV 字节（面板试听）
- `POST /unload` / `POST /load` — 手动卸载/加载模型

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

本插件只负责「把本地 Breeze 音色提供给 DSH 使用」，**不自带**语音引擎和模型。Breeze TTS 2 桌面版需自行从仓库下载安装：

| 资源 | 地址 |
|---|---|
| **Breeze TTS 2 桌面版（安装包从这里下）** | https://github.com/dkvkvk/breeze-tts-2-desktop |
| 桌面版安装包（Releases 页的 `BreezeTTS2-Setup-*.exe`，约 131 MB） | https://github.com/dkvkvk/breeze-tts-2-desktop/releases |
| 上游后端项目（HoppouAI，非官方 C++ 实现） | https://github.com/HoppouAI/Breeze-TTS-2.cpp |
| 原模型（BreezeBlue） | https://huggingface.co/BreezeBlue/Breeze-TTS-2 |
| GGUF 量化模型 | https://huggingface.co/HoppouAI/Breeze-TTS-2.cpp |

**国内镜像（原始站连不上时用）**：

- Hugging Face 模型：桌面版首次启动会内置 `HuggingFace → hf-mirror → hf-mirror.net` 自动回退下载；手动下可设 `HF_ENDPOINT=https://hf-mirror.com`，或把 `huggingface.co/...` 域名换成 `hf-mirror.com` 打开。
- GitHub Release 下载加速：把 release 资产链接贴到 https://ghproxy.net/ 加速（如 `https://ghproxy.net/https://github.com/dkvkvk/breeze-tts-2-desktop/releases/download/...`）。

> 许可提醒：桌面版代码 Apache-2.0；Breeze TTS 2 模型权重为 **BreezeBlue Research and Non-Commercial License，仅限非商业研究**。商用前请核对模型和各音色的许可条款。

## 下载安装 Breeze TTS 2（安装路径你自己选）

1. 到桌面版 [Releases](https://github.com/dkvkvk/breeze-tts-2-desktop/releases/latest) 下载 `BreezeTTS2-Setup-*.exe`（约 131 MB，自带运行时，不用另装 WebView2 / .NET）。
2. 双击安装，**安装目录完全由你决定**：默认是 `D:\Breeze TTS 2`，安装向导的目录输入框可以直接键入或粘贴任意路径；只填盘符（如 `D:\`）会自动补成 `D:\Breeze TTS 2`。
3. 首次启动会**自动下载** `breeze-tts-2-q4_k.gguf`（约 2.4 GB），断点续传 + 镜像回退，界面有进度；模型放在安装目录 `models\`，音色放在 `voices\`。
4. 装好后打开本插件设置页「本地语音 → 安装目录」，填**你刚才选的那个安装目录**（要含 `breeze-runtime.json`、`voices\`、`models\`）。填一次即可，之后插件会自动记住；没填对的话音色下拉只会显示几个默认项。

> 文档不写死任何本机路径——以你实际安装时选的目录为准，在设置页告诉本插件即可。若桌面版没有自动生成 `breeze-runtime.json`，需按 `engine/service.mjs` 里的字段格式（`exe` / `model` / `port` 等）补一份到安装目录。

## 版权

本插件 MIT。Breeze TTS 2 的引擎、模型与音色的版权归各自上游作者所有，使用时遵守其许可条款。
