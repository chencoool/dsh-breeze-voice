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

## 相关资源（Breeze TTS 2 本体）

本插件只负责「把本地 Breeze 音色提供给 DSH 使用」，**不自带**语音引擎和模型，需自行安装 Breeze TTS 2：

| 资源 | 地址 |
|---|---|
| 原模型（BreezeBlue） | https://huggingface.co/BreezeBlue/Breeze-TTS-2 |
| C++ 实现项目（HoppouAI，第三方、非官方发行版） | https://github.com/HoppouAI/Breeze-TTS-2.cpp |
| C++ 项目发行包（预编译程序） | https://github.com/HoppouAI/Breeze-TTS-2.cpp/releases |
| GGUF 量化模型 | https://huggingface.co/HoppouAI/Breeze-TTS-2.cpp |

**国内镜像（原始站连不上时用）**：

- Hugging Face 模型下载：设置环境变量 `HF_ENDPOINT=https://hf-mirror.com`，再用 `huggingface-cli download` / `hf download` 下载；也可直接把上面 `huggingface.co/...` 的域名替换成 `hf-mirror.com` 在浏览器打开。
- GitHub Release 下载加速：把 release 资产链接贴到 https://ghproxy.net/ 加速（例如 `https://ghproxy.net/https://github.com/HoppouAI/Breeze-TTS-2.cpp/releases/download/...`）。

> 注意：软件代码许可 ≠ 模型/声音的商用许可。商用前请核对模型和各音色的许可条款；引擎、Tokenizer、GGUF 模型是分开的文件，光下 GGUF 跑不起来。

## 本机安装包（给你手上的那份）

如果这台机器已经装过，直接从这里复用即可，不用重新下载：

| 项目 | 路径 / 值 |
|---|---|
| 安装包（可直接双击安装） | `J:\BreezeTTS2-Setup-2.2.0.exe` |
| 已安装目录 | `J:\BreezeTTS2` |
| 安装版本 | Breeze TTS 2 · 2.2.0 |
| 当前模型 | `J:\BreezeTTS2\models\breeze-tts-2-q6_k.gguf`（另有 q4_k 可选） |
| 运行配置 | `J:\BreezeTTS2\breeze-runtime.json` |

> 上面是**本机实测路径**：换一台机器时把 `J:\BreezeTTS2` 换成你自己的安装目录，在设置页「本地语音 → 安装目录」填一次即可（或让插件自动探测）。

## 安装

用 DSH 的 bundle 安装（或把本目录作为 `@local/dsh-breeze-voice` 放进 profile 的 `dsh.profile.bundles`）。安装后重启 DSH，设置侧栏出现「本地语音」页。

## 版权

本插件 MIT。Breeze TTS 2 的引擎、模型与音色的版权归各自上游作者所有，使用时遵守其许可条款。
