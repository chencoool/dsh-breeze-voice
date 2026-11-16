# 本地语音 · Breeze TTS 2（dsh-breeze-voice）

把 Aurabot 里那套**本机 Breeze TTS 2** 做成一个独立的 DSH 插件：在「设置 → 本地语音」里用和 Aurabot 一样的结构选音色、情绪和显存策略；合成出的本地音色会注册进语音输出端注册表，让支持语音输出的插件（如 dsh-pet）在下拉里直接认出来。

> 只做**语音输出端（TTS）**，不碰任何语音输入识别（STT）。

## 它做什么

- **设置页主界面**照搬 Aurabot「语音 → 本机 Breeze TTS 2」的八行结构：
  音色 / 自动情绪 / 傲娇底色 / 模型判断情绪 / 空闲卸载 / 空闲多久卸载 / 安装目录 / 显存（卸载·加载），外加一个试听按钮和状态栏。
- **本机合成**：复用 Aurabot 的 breeze 引擎（`engine/*.mjs`），走本机 `breeze-server`，返回 24 kHz 单声道 16 bit WAV；不联网、不调用在线 TTS。
- **情绪**：按文字关键词 + 大肥鱼人设骨架离线挑语气，音色身份始终保留在最前。
- **通用注册**：把音色以 `breeze/音色id` 的形式注册进 `petApi7340.voice`（dsh-pet 的下拉直接显示），并以 `breezeVoice` 服务暴露 `listVoices / status / speak / refreshRegistration` 给其它插件。

## 配置

设置存在 `<DSH_PROFILE_DIR>/plugins-data/breeze-voice/config.json`，字段：

| 字段 | 默认 | 说明 |
|---|---|---|
| `root` | `''` | Breeze 安装目录（要含 `breeze-runtime.json` 和 `voices/`） |
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

## 前提

- 本机已装好 Breeze TTS 2（有 `breeze-runtime.json`、模型、音色 `.breeze` 文件）。安装目录会在启动时**自动从 Aurabot 配置继承**（`voice.breeze.root`），也可以在设置页手动改；没自动发现到时手动填一次即可。
- 想让 dsh-pet 的下拉直接出现这些音色，需要装了 dsh-pet；没装也不影响面板试听和 `breezeVoice` 服务。

## 安装

用 DSH 的 bundle 安装（或把本目录作为 `@local/dsh-breeze-voice` 放进 profile 的 `dsh.profile.bundles`）。安装后重启 DSH，设置侧栏出现「本地语音」页。

## 版权

MIT。引擎文件复用了 Aurabot 的 breeze 模块实现，版权归各自作者所有。
