/**
 * dsh-breeze-voice —— 浏览器半端（设置里的一页）
 * ============================================================================
 * 界面按 DSH 默认设置页风格自绘（照搬同类插件的卡片/字段/控件样式，只取
 * --dsw-alias-* 主题 token，不 require 任何宿主 UI 包）。两块内容：
 *   1) 常规设置：连接方式 / 接口 / 音色 / 情绪 / 空闲卸载 / 安装目录 / 显存 + 试听
 *   2) 音色库：上传参考音频 + 逐字稿 + 名称，添加进桌面版音色库（克隆音色），
 *      并可删除。音频统一转成 24kHz 单声道 16bit WAV 再交给桌面版。
 *
 * client bundle 是自注册脚本（不是 ESM）：
 *   window.__ModuleLoader__.load({ id:'<包名>', factory:(require)=>({inject,apply}) })
 * 进「设置」用 settings.section 插槽，label 就是左侧导航那一项。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-breeze-voice',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

    const API = '/api/breeze-voice'
    const asJson = async (res) => {
      if (res.ok) return res.json()
      let why = ''
      try { const j = await res.json(); why = j && j.message ? j.message : '' } catch { /* 忽略 */ }
      throw new Error('HTTP ' + res.status + (why ? '：' + why : ''))
    }
    const jget = async (p) => asJson(await fetch(API + p, { credentials: 'same-origin' }))
    const jpost = async (p, body) => asJson(await fetch(API + p, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    }))

    const DEFAULTS = {
      mode: 'auto', endpoint: 'http://127.0.0.1:18099',
      root: '', voice: 'qinglan', toneMode: 'keyword',
      unloadIdle: true, unloadIdleMinutes: 5, rate: 1,
    }

    // DSH 默认风格：卡片/字段/控件全部用 --dsw-alias-* token（带 fallback）。
    // 不在 listTokens 白名单里的 token 一律给回退值，保证明暗主题都能看。
    const CSS = `
[data-bv-page]{display:flex;flex-direction:column;gap:12px;padding:2px 2px 12px;max-width:720px;
  color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
[data-bv-h]{font-size:16px;font-weight:500;line-height:24px;margin:0;color:var(--dsw-alias-label-primary)}
[data-bv-sub]{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);margin:-6px 0 0}
[data-bv-card]{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border-radius:12px;
  border:1px solid var(--dsw-alias-border-l2)}
[data-bv-card__title]{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}
[data-bv-row]{display:flex;align-items:center;gap:12px;min-height:28px}
[data-bv-msg]{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
[data-bv-label]{font-size:13px;color:var(--dsw-alias-label-primary)}
[data-bv-hint]{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
[data-bv-ctl]{flex:none;display:flex;align-items:center;gap:8px}
[data-bv-input]{box-sizing:border-box;min-height:28px;padding:4px 10px;border-radius:8px;font:inherit;font-size:13px;
  color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);
  border:1px solid var(--dsw-alias-border-l2);outline:none}
[data-bv-input]:focus{border-color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary))}
[data-bv-input][data-wide]{flex:1;min-width:220px}
[data-bv-area]{min-height:56px;resize:vertical;line-height:18px}
[data-bv-btn]{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);
  border-radius:8px;padding:4px 14px;font:inherit;font-size:12px;line-height:20px;cursor:pointer;white-space:nowrap}
[data-bv-btn]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
[data-bv-btn]:disabled{opacity:.5;cursor:default}
[data-bv-btn][data-primary]{border-color:var(--dsw-alias-button-info-fill,var(--dsw-alias-brand-primary));
  background:var(--dsw-alias-button-info-fill,var(--dsw-alias-brand-primary));color:#fff}
[data-bv-btn][data-danger]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
[data-bv-btn][data-sm]{padding:2px 10px}
[data-bv-toggle]{display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;color:var(--dsw-alias-label-primary)}
[data-bv-toggle] input[type=checkbox]{width:16px;height:16px;margin:0;cursor:pointer;
  accent-color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary))}
[data-bv-status]{font-size:12px;line-height:18px;padding:8px 11px;border-radius:8px;word-break:break-all;
  border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
[data-bv-dot]{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;
  background:var(--dsw-alias-state-idle-primary)}
[data-bv-dot][data-on]{background:var(--dsw-alias-state-success-primary)}
[data-bv-toast]{font-size:12px;line-height:18px;min-height:18px;color:var(--dsw-alias-label-secondary)}
[data-bv-toast][data-err]{color:var(--dsw-alias-state-error-primary)}
[data-bv-vlist]{display:flex;flex-direction:column;gap:6px}
[data-bv-vitem]{display:flex;align-items:center;gap:8px;padding:5px 9px;border-radius:8px;
  border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
[data-bv-vitem] span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-bv-file]{font-size:12px;max-width:340px;color:var(--dsw-alias-label-secondary)}
select[data-bv-input]{color-scheme:light dark}
select[data-bv-input] option,select[data-bv-input] optgroup{
  background-color:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
audio[data-bv-audio]{height:34px;max-width:100%}
[data-bv-sync][data-ok]{color:var(--dsw-alias-state-success-primary, #4caf50)}
`

    // 把任意音频转成 24kHz / 单声道 / 16bit WAV（桌面版音色克隆的入参规格）。
    // 复刻桌面版 audio.js 的 prepare：解码 → 截到 30 秒 → 单声道重采样 → 编码 WAV。
    async function prepareWav(file, maxSec = 30) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      if (!AudioCtx) throw new Error('浏览器不支持音频解码，请直接上传 wav 文件')
      const ctx = new AudioCtx({ sampleRate: 24000 })
      try {
        const buf = await file.arrayBuffer()
        const decoded = await ctx.decodeAudioData(buf)
        const dur = Math.min(decoded.duration, maxSec)
        const frames = Math.max(1, Math.floor(dur * 24000))
        const off = new OfflineAudioContext(1, frames, 24000)
        const src = off.createBufferSource()
        src.buffer = decoded
        src.connect(off.destination)
        src.start(0, 0, dur)
        const rendered = await off.startRendering()
        const ch = rendered.getChannelData(0)
        const out = new ArrayBuffer(44 + ch.length * 2)
        const view = new DataView(out)
        const writeStr = (offset, s) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)) }
        writeStr(0, 'RIFF'); view.setUint32(4, 36 + ch.length * 2, true)
        writeStr(8, 'WAVE'); writeStr(12, 'fmt '); view.setUint32(16, 16, true)
        view.setUint16(20, 1, true); view.setUint16(22, 1, true)
        view.setUint32(24, 24000, true); view.setUint32(28, 24000 * 2, true)
        view.setUint16(32, 2, true); view.setUint16(34, 16, true)
        writeStr(36, 'data'); view.setUint32(40, ch.length * 2, true)
        let o = 44
        for (let i = 0; i < ch.length; i++, o += 2) {
          let s = Math.max(-1, Math.min(1, ch[i]))
          view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true)
        }
        return new Blob([out], { type: 'audio/wav' })
      } finally {
        try { await ctx.close() } catch { /* 忽略 */ }
      }
    }

    const Switch = ({ on, onChange }) => h('label', { 'data-bv-toggle': '' },
      h('input', {
        type: 'checkbox', checked: Boolean(on),
        onChange: (e) => onChange(e.target.checked),
      }),
    )

    const Row = ({ label, hint, children }) => h('div', { 'data-bv-row': '' },
      h('div', { 'data-bv-msg': '' },
        h('div', { 'data-bv-label': '' }, label),
        hint ? h('div', { 'data-bv-hint': '' }, hint) : null,
      ),
      h('div', { 'data-bv-ctl': '' }, children),
    )

    function usePreview(toast) {
      const [url, setUrl] = useState('')
      const [busy, setBusy] = useState(false)
      const audioRef = useRef(null)
      useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
      const play = useCallback(async (voice) => {
        setBusy(true); toast('正在合成试听…')
        try {
          const res = await fetch(API + '/preview', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: '你好呀，我是大肥鱼。今天天气不错，要不要本鱼陪你聊两句？', voice }),
          })
          if (!res.ok) throw new Error('HTTP ' + res.status)
          const blob = await res.blob()
          if (url) URL.revokeObjectURL(url)
          const u = URL.createObjectURL(blob)
          setUrl(u)
          setTimeout(() => {
            if (audioRef.current) { audioRef.current.src = u; audioRef.current.play().catch(() => {}) }
          }, 30)
          toast('试听已生成。', false)
        } catch (e) {
          toast('试听失败：' + (e && e.message ? e.message : e), true)
        } finally { setBusy(false) }
      }, [url, toast])
      return { url, busy, play, audioRef }
    }

    function Panel() {
      const [draft, setDraft] = useState(DEFAULTS)
      const [voices, setVoices] = useState([])
      const [stat, setStat] = useState({})
      const [msg, setMsg] = useState('')
      const [err, setErr] = useState(false)
      const [loading, setLoading] = useState(true)
      const [busy, setBusy] = useState(false)
      // 桌面版安装状态
      const [install, setInstall] = useState({ installed: false, dir: '', version: '', backendRunning: false, linked: false, downloadUrl: '' })
      // 其它本地语音插件检测 + 手动接入参数
      const [integrations, setIntegrations] = useState([])
      const [httpGuide, setHttpGuide] = useState(null)
      const [portSync, setPortSync] = useState(null)   // 端口自动同步结果
      // 添加音色表单
      const [addFile, setAddFile] = useState(null)
      const [addName, setAddName] = useState('')
      const [addRefText, setAddRefText] = useState('')
      const [addDesc, setAddDesc] = useState('')
      const [adding, setAdding] = useState(false)
      const fileRef = useRef(null)

      const mounted = useRef(true)
      useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
      const toast = useCallback((text, isErr = false) => {
        if (!mounted.current) return
        setMsg(text); setErr(Boolean(isErr))
      }, [])
      const preview = usePreview(toast)

      const reload = useCallback(async () => {
        try {
          const r = await jget('/config')
          if (!mounted.current) return
          setDraft({ ...DEFAULTS, ...(r.config || {}) })
          setVoices(Array.isArray(r.voices) ? r.voices : [])
          setStat(r.status || {})
        } catch (e) {
          toast('读取配置失败：' + (e && e.message ? e.message : e), true)
        } finally { if (mounted.current) setLoading(false) }
        // 安装状态与配置分开读：即使 /config 失败也尽量显示安装入口
        try {
          const s = await jget('/install/status')
          if (mounted.current && s && s.ok) setInstall(s)
        } catch { /* 安装检测失败不影响面板 */ }
        // 检测本机其它本地语音插件
        try {
          const g = await jget('/integrations')
          if (mounted.current && g && g.ok) {
            setIntegrations(Array.isArray(g.plugins) ? g.plugins : [])
            if (g.httpGuide) setHttpGuide(g.httpGuide)
            if (g.sync) setPortSync(g.sync)
          }
        } catch { /* 检测失败不影响面板 */ }
      }, [toast])

      useEffect(() => { reload() }, [reload])

      const saveTimer = useRef(null)
      const save = useCallback((next) => {
        setDraft(next)
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(async () => {
          try {
            const r = await jpost('/config', next)
            if (!mounted.current) return
            if (r && r.ok) {
              const v = await jget('/config')
              if (mounted.current) { setVoices(Array.isArray(v.voices) ? v.voices : []); setStat(v.status || {}) }
            }
            toast('设置已保存。', false)
          } catch (e) { toast('保存失败：' + (e && e.message ? e.message : e), true) }
        }, 400)
      }, [toast])
      useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])
      const set = (key, value) => save({ ...draft, [key]: value })

      const act = async (what) => {
        setBusy(true)
        toast(what === 'unload' ? '正在卸载模型…' : '正在加载模型…')
        try {
          const r = await jpost('/' + what, {})
          toast(r && r.message ? r.message : (what === 'unload' ? '已卸载。' : '已加载。'), !(r && r.ok))
          const s = await jget('/status'); if (mounted.current) setStat(s || {})
        } catch (e) { toast('操作失败：' + (e && e.message ? e.message : e), true) }
        finally { setBusy(false) }
      }

      const doAddVoice = async () => {
        if (!addFile) { toast('请先选一段参考音频。', true); return }
        if (!addName.trim()) { toast('请填音色名称。', true); return }
        if (!addRefText.trim()) { toast('请填参考音频的逐字稿。', true); return }
        setAdding(true)
        toast('正在处理音频并添加到桌面版音色库…')
        try {
          let blob = addFile
          try { blob = await prepareWav(addFile, 30) } catch (e) { toast('音频重采样失败，按原文件上传：' + (e && e.message ? e.message : e), true) }
          const form = new FormData()
          const baseName = (addFile.name || 'voice').replace(/\.[^.]+$/, '')
          form.append('ref_audio', blob, baseName + '.wav')
          form.append('ref_text', addRefText.trim())
          form.append('name', addName.trim())
          if (addDesc.trim()) form.append('description', addDesc.trim())
          const r = await asJson(await fetch(API + '/voice/add', {
            method: 'POST', credentials: 'same-origin', body: form,
          }))
          if (!r.ok) throw new Error(r.message || '添加失败')
          toast('音色已添加进桌面版音色库，可在下拉里选了。', false)
          setAddFile(null); setAddName(''); setAddRefText(''); setAddDesc('')
          if (fileRef.current) fileRef.current.value = ''
          await reload()
        } catch (e) { toast('添加音色失败：' + (e && e.message ? e.message : e), true) }
        finally { setAdding(false) }
      }

      const doDeleteVoice = async (v) => {
        setBusy(true); toast('正在删除音色「' + v.name + '」…')
        try {
          const r = await jpost('/voice/delete', { id: v.refId || v.id })
          if (!r.ok) throw new Error(r.message || '删除失败')
          toast('已删除音色「' + v.name + '」。', false)
          await reload()
        } catch (e) { toast('删除失败：' + (e && e.message ? e.message : e), true) }
        finally { setBusy(false) }
      }

      const openDownload = () => {
        const url = install.downloadUrl || 'https://github.com/dkvkvk/breeze-tts-2-desktop/releases'
        try { window.open(url, '_blank', 'noopener') } catch { /* 忽略 */ }
      }
      const doLink = async () => {
        setBusy(true); toast('正在检测桌面版并自动配置链路…')
        try {
          const r = await jpost('/install/link', install.dir ? { dir: install.dir } : {})
          if (!r.ok) throw new Error(r.message || '配置失败')
          toast('已配置好链路：' + r.root + '，音色已刷新。', false)
          await reload()
        } catch (e) { toast('自动配置失败：' + (e && e.message ? e.message : e), true) }
        finally { setBusy(false) }
      }


      const voiceOptions = voices.length
        ? voices.map((v) => ({
          value: v.id,
          label: v.name + (v.kind === 'reference' ? '（桌面版）' : (v.ready === false ? '（还没建好）' : '')) + (v.description ? ' · ' + v.description : ''),
        }))
        : [{ value: draft.voice || '', label: voices.length ? '正在读音色…' : '（先连桌面版或填安装目录）' }]

      const isConnect = stat.mode === 'connect' || (draft.mode === 'connect')
      const cloned = voices.filter((v) => v.kind === 'reference')

      return h('div', { 'data-bv-page': '' },
        h('h2', { 'data-bv-h': '' }, '本地语音 · Breeze TTS 2'),
        h('p', { 'data-bv-sub': '' }, '连接桌面版或本机自管，音色与情绪在下面选；其它语音插件接入本服务后即可共用这些音色。'),

        // —— 桌面版安装卡片 ——
        h('div', { 'data-bv-card': '' },
          h('div', { 'data-bv-card__title': '' }, '桌面版安装'),
          !install.installed
            ? h('div', {},
                h('div', { 'data-bv-row': '' },
                  h('div', { 'data-bv-msg': '' },
                    h('span', { 'data-bv-label': '' }, '尚未检测到 Breeze TTS 2 桌面版'),
                    h('span', { 'data-bv-hint': '' }, '点下面按钮去官方仓库下载安装包，安装路径由你自己选；装好后回到这里会自动识别并配好链路。')),
                  h('div', { 'data-bv-ctl': '' },
                    h('button', { 'data-bv-btn': '', 'data-primary': '', type: 'button', onClick: openDownload }, '下载安装桌面版'))))
            : h('div', {},
                h('div', { 'data-bv-row': '' },
                  h('div', { 'data-bv-msg': '' },
                    h('span', { 'data-bv-label': '' },
                      h('i', { 'data-bv-dot': '', 'data-on': install.backendRunning ? '' : null }),
                      '已安装桌面版' + (install.version ? ' · v' + install.version : '')),
                    h('span', { 'data-bv-hint': '' }, '安装目录：' + (install.dir || '（未知）'))),
                  h('div', { 'data-bv-ctl': '' },
                    h('button', {
                      'data-bv-btn': '', 'data-primary': !install.linked, type: 'button',
                      disabled: busy || install.linked, onClick: doLink,
                    }, install.linked ? '链路已配好' : '自动配置链路'))),
                h('div', { 'data-bv-hint': '' }, '合成方式由下方「连接方式」决定；装好桌面版、配置好模型即可使用。'),
                h('div', { 'data-bv-row': '' },
                  h('div', { 'data-bv-msg': '' },
                    h('span', { 'data-bv-hint': '' }, '要卸载？请到安装目录运行卸载器（不会删除本插件）：' + (install.uninstall || (install.dir + '\\Uninstall Breeze TTS 2.exe'))))))),

        // —— 常规设置卡片 ——
        h('div', { 'data-bv-card': '' },
          h('div', { 'data-bv-card__title': '' }, '常规设置'),

          h(Row, { key: 'mode', label: '连接方式', hint: '自动：桌面版后端（18099）活着就连它，否则本机自管；连接模式把模型/下载/显存交给桌面版界面。' },
            h('select', {
              'data-bv-input': '', value: draft.mode,
              onChange: (e) => set('mode', e.target.value),
              style: { width: 150 },
            },
              h('option', { value: 'auto' }, '自动（推荐）'),
              h('option', { value: 'connect' }, '连桌面版'),
              h('option', { value: 'local' }, '本机自管'),
            ),
          ),

          (draft.mode !== 'local') ? h(Row, { key: 'endpoint', label: '桌面版接口', hint: 'Breeze TTS 2 桌面版后端地址，一般不用改。' },
            h('input', {
              'data-bv-input': '', 'data-wide': '', type: 'text',
              value: draft.endpoint, placeholder: 'http://127.0.0.1:18099',
              onChange: (e) => set('endpoint', e.target.value),
            }),
          ) : null,

          (draft.mode === 'local') ? h(Row, { key: 'root', label: '安装目录', hint: '自管模式的 Breeze 安装目录（含 breeze-server.exe 和 voices 文件夹；桌面版布局缺配置时插件会自动补写）。' },
            h('input', {
              'data-bv-input': '', 'data-wide': '', type: 'text',
              value: draft.root, placeholder: 'D:\\Breeze TTS 2',
              onChange: (e) => set('root', e.target.value),
            }),
          ) : null,

          h(Row, { key: 'voice', label: '音色', hint: '选一个音色；标「还没建好」的要先设计生成 .breeze 文件，标「桌面版」的是克隆音色。' },
            h('select', {
              'data-bv-input': '', value: draft.voice, disabled: loading,
              onChange: (e) => set('voice', e.target.value),
              style: { width: 300 },
            }, voiceOptions.map((o) => h('option', { key: o.value, value: o.value }, o.label))),
            h('button', {
              'data-bv-btn': '', 'data-primary': '', type: 'button',
              disabled: preview.busy || !draft.voice,
              onClick: () => preview.play(draft.voice),
            }, preview.busy ? '合成中…' : '▶ 试听'),
          ),

          h(Row, { key: 'toneMode', label: '情绪语气', hint: '关：不加情绪；关键词：按文字挑语气（0 token，默认）；模型润色：读聊天插件的心情值，让模型把这句该怎么念写成一句提示（约百来 token，结果缓存 10 分钟）。人设/性格由聊天插件决定，这里只管情绪化的念法。' },
            h('select', {
              'data-bv-input': '', value: draft.toneMode || 'keyword',
              onChange: (e) => set('toneMode', e.target.value),
              style: { width: 150 },
            },
              h('option', { value: 'off' }, '关闭'),
              h('option', { value: 'keyword' }, '关键词推断（推荐）'),
              h('option', { value: 'model' }, '模型润色语气'),
            ),
          ),

          h(Row, { key: 'unloadIdle', label: '空闲卸载', hint: '一段时间没人说话就结束模型进程，释放显存；下次说话会自动重新加载。' },
            h(Switch, { on: Boolean(draft.unloadIdle), onChange: (v) => set('unloadIdle', v) }),
          ),

          h(Row, { key: 'unloadIdleMinutes', label: '空闲多久卸载', hint: '无活动达到这个时长后卸载模型。' },
            h('select', {
              'data-bv-input': '', value: draft.unloadIdleMinutes,
              onChange: (e) => set('unloadIdleMinutes', Number(e.target.value)),
              style: { width: 120 },
            }, [1, 3, 5, 10, 15, 30].map((n) => h('option', { key: n, value: n }, n + ' 分钟'))),
          ),

          !isConnect ? h(Row, { key: 'gpu', label: '显存', hint: '手动加载/卸载模型进程；卸载只结束进程，模型和音色文件都不动。' },
            h('button', { 'data-bv-btn': '', type: 'button', disabled: busy, onClick: () => act('unload') }, '卸载'),
            h('button', { 'data-bv-btn': '', 'data-primary': '', type: 'button', disabled: busy, onClick: () => act('load') }, '加载'),
          ) : h(Row, { key: 'gpu', label: '显存 / 模型', hint: '连接模式下由 Breeze TTS 2 桌面版界面管理（下载、切换量化档、显存）。' },
            h('span', { 'data-bv-hint': '' }, '交给桌面版 →'),
          ),
        ),

        // —— 音色库卡片（添加 / 删除克隆音色，存进桌面版音色库）——
        h('div', { 'data-bv-card': '' },
          h('div', { 'data-bv-card__title': '' }, '音色库 · 添加克隆音色'),
          h('div', { 'data-bv-hint': '' }, '上传一段 30 秒内的清晰人声 + 逐字稿，桌面版会把它做成克隆音色存进它自己的音色库，添加后在我的音色下拉里选「（桌面版）」那项即可。需要 Breeze TTS 2 桌面版正在运行。'),

          h(Row, { key: 'file', label: '参考音频', hint: '选一段干净的人声，越清晰越好；自动转成 24kHz 单声道 WAV。' },
            h('input', {
              'data-bv-file': '', ref: fileRef, type: 'file', accept: 'audio/*',
              onChange: (e) => setAddFile(e.target.files && e.target.files[0] ? e.target.files[0] : null),
            }),
          ),
          h(Row, { key: 'refText', label: '逐字稿', hint: '参考音频里说的原话，必须和音频一致。' },
            h('input', {
              'data-bv-input': '', 'data-wide': '', type: 'text',
              value: addRefText, placeholder: '例如：你好，我是大肥鱼，今天天气不错。',
              onChange: (e) => setAddRefText(e.target.value),
            }),
          ),
          h(Row, { key: 'addName', label: '音色名称', hint: '保存后在下拉里显示的名字。' },
            h('input', {
              'data-bv-input': '', 'data-wide': '', type: 'text',
              value: addName, placeholder: '例如：大肥鱼·温柔版',
              onChange: (e) => setAddName(e.target.value),
            }),
          ),
          h(Row, { key: 'addDesc', label: '描述（可选）', hint: '给这个音色写一句说明，方便区分。' },
            h('input', {
              'data-bv-input': '', 'data-wide': '', type: 'text',
              value: addDesc, placeholder: '例如：温柔清亮的女声',
              onChange: (e) => setAddDesc(e.target.value),
            }),
          ),
          h('div', { 'data-bv-row': '' },
            h('div', { 'data-bv-msg': '' }),
            h('div', { 'data-bv-ctl': '' },
              h('button', {
                'data-bv-btn': '', 'data-primary': '', type: 'button',
                disabled: adding || !addFile || !addName.trim() || !addRefText.trim(),
                onClick: doAddVoice,
              }, adding ? '添加中…' : '＋ 添加音色'),
            ),
          ),

          cloned.length ? h('div', { 'data-bv-vlist': '' },
            cloned.map((v) => h('div', { 'data-bv-vitem': '', key: v.id },
              h('span', { title: v.description || v.name }, v.name + (v.description ? ' · ' + v.description : '')),
              h('button', {
                'data-bv-btn': '', 'data-danger': '', 'data-sm': '', type: 'button',
                disabled: busy, onClick: () => doDeleteVoice(v), title: '从桌面版音色库删除',
              }, '删除'),
            )),
          ) : h('div', { 'data-bv-hint': '' }, '桌面版音色库里还没有克隆音色。'),
        ),

        // —— 接入其它本地语音插件卡片（只检测 + 给手动接入参数，不写别人目录）——
        h('div', { 'data-bv-card': '' },
          h('div', { 'data-bv-card__title': '' }, '接入其它本地语音插件'),
          h('div', { 'data-bv-hint': '' }, '检测本机已装的本地语音插件。本插件只做本地语音、且绝不改动其它插件的文件；pet 的私有接口已收录、自动接好，其余给参数由你自己填。'),
          integrations.length ? h('div', { 'data-bv-vlist': '' },
            integrations.map((p) => h('div', { 'data-bv-vitem': '', key: p.id },
              h('span', { title: p.detail }, p.name + ' · ' + p.detail),
              h('span', { 'data-bv-hint': '' }, p.status === 'auto' ? '✓ 已接入' : '需手动接入'),
            )),
          ) : h('div', { 'data-bv-hint': '' }, '没检测到其它本地语音插件。'),
          httpGuide ? h('div', { 'data-bv-manual': '' },
            h('div', { 'data-bv-card__title': '' }, '手动接入参数（在其它插件的「其他 HTTP 接口」里填）'),
            h('div', { 'data-bv-field': '' },
              h('div', { 'data-bv-flabel': '' }, '接口地址'),
              h('input', { 'data-bv-inp': '', readOnly: true, value: httpGuide.url, onFocus: (e) => e.target.select() }),
            ),
            h('div', { 'data-bv-field': '' },
              h('div', { 'data-bv-flabel': '' }, '请求方式'),
              h('input', { 'data-bv-inp': '', readOnly: true, value: httpGuide.method, onFocus: (e) => e.target.select() }),
            ),
            h('div', { 'data-bv-field': '' },
              h('div', { 'data-bv-flabel': '' }, '请求头'),
              h('input', { 'data-bv-inp': '', readOnly: true, value: httpGuide.headers, onFocus: (e) => e.target.select() }),
            ),
            h('div', { 'data-bv-field': '' },
              h('div', { 'data-bv-flabel': '' }, '请求体'),
              h('input', { 'data-bv-inp': '', readOnly: true, value: httpGuide.body, onFocus: (e) => e.target.select() }),
            ),
            h('button', {
              'data-bv-btn': '', 'data-sm': '', type: 'button',
              onClick: async () => {
                const text = [httpGuide.url, httpGuide.method, httpGuide.headers, httpGuide.body].join('\n')
                try { await navigator.clipboard.writeText(text); toast('参数已复制。', false) }
                catch { toast('复制失败，请手动选中上面的输入框复制。', true) }
              },
            }, '复制全部参数'),
            httpGuide.agentPrompt ? h('button', {
              'data-bv-btn': '', 'data-sm': '', type: 'button',
              onClick: async () => {
                try { await navigator.clipboard.writeText(httpGuide.agentPrompt); toast('给 agent 的指令已复制，粘贴到 agent 对话窗口即可。', false) }
                catch { toast('复制失败，完整说明见插件目录 docs/AGENT-PORT-SYNC.md。', true) }
              },
            }, '复制给 agent（自动适配其它插件）') : null,
            h('div', { 'data-bv-hint': '' }, httpGuide.note),
            portSync ? h('div', {
              'data-bv-hint': '',
              'data-bv-sync': '',
              'data-ok': (portSync.ok || portSync.unchanged) ? '' : undefined,
            }, portSync.updated
              ? '✓ 已把新端口自动写回 aurabot：' + portSync.url
              : portSync.unchanged
                ? '✓ aurabot 接口地址已是当前端口，无需改动。'
                : portSync.skipped
                  ? '端口同步：' + (portSync.reason || '无需同步') + '（没改动它的设置）'
                  : '端口同步失败：' + (portSync.message || '未知原因'))
              : null,
          ) : null,
        ),

        preview.url ? h('audio', { 'data-bv-audio': '', controls: true, ref: preview.audioRef, src: preview.url }) : null,

        h('div', { 'data-bv-status': '' },
          h('span', { 'data-bv-dot': '', 'data-on': stat.loaded ? '' : undefined }),
          (stat.mode === 'connect' ? '连接模式' : stat.mode === 'local' ? '自管模式' : '检测中'),
          ' · ' + (stat.loaded ? (stat.mode === 'connect' ? '桌面版已连接' : '模型已加载') : (stat.message || '服务未就绪')),
          ' · ' + (stat.mode === 'connect' ? ('接口：' + (stat.endpoint || '—')) : ('目录：' + (stat.root || '未设置'))),
          ' · 音色：' + (draft.voice || '—'),
        ),

        h('div', { 'data-bv-toast': '', 'data-err': err ? '' : undefined }, msg || ' '),
      )
    }

    // —— 设置页导航图标：盖掉默认齿轮，换成音频波形（照同类插件的做法，纯内联 SVG，不依赖宿主包）——
    const NAV_STYLE_TAG = 'dsh-breeze-voice/nav-icon.css'
    const NAV_MARK = 'data-bv-nav'
    const WAVE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M7 15v6"/><path d="M12 10v16"/><path d="M17 5v26"/><path d="M22 11v14"/><path d="M27 8v20"/><path d="M32 15v6"/></svg>'
    const PANEL_SELECTOR = '[data-shortcut-modal="settings"]'
    const LIST_SELECTOR = '[class*="navList"]'
    const CELL_SELECTOR = '[class*="navCell"]'
    const LABEL_SELECTOR = '[class*="navLabel"]'
    function navMaskUri(svg) {
      const source = String(svg || '').trim()
      if (!source) return ''
      return 'url("data:image/svg+xml,' + encodeURIComponent(source.split('currentColor').join('#000')) + '")'
    }
    function navCss(glyph) {
      return [
        '[' + NAV_MARK + '] [class*="navIcon"]{display:none}',
        '[' + NAV_MARK + ']::before{content:"";flex:none;width:16px;height:16px;background-color:currentColor;-webkit-mask:' + glyph + ' center/16px 16px no-repeat;mask:' + glyph + ' center/16px 16px no-repeat}'
      ].join('\n')
    }
    function installSectionNavIcon() {
      const doc = typeof document === 'undefined' ? void 0 : document
      const Observer = typeof MutationObserver === 'undefined' ? void 0 : MutationObserver
      if (!doc || !Observer || !doc.body) return () => {}
      const glyph = navMaskUri(WAVE_SVG)
      if (!glyph) return () => {}
      let injected = false
      const injectNavCss = () => {
        if (injected) return
        if (doc.querySelector('style[data-plugin-css="' + NAV_STYLE_TAG + '"]')) { injected = true; return }
        const tag = doc.createElement('style')
        tag.dataset.plugin = 'dsh-breeze-voice'
        tag.dataset.pluginCss = NAV_STYLE_TAG
        tag.textContent = navCss(glyph)
        doc.head.appendChild(tag)
        injected = true
      }
      const markPanel = (panel) => {
        try {
          const list = panel.querySelector(LIST_SELECTOR)
          if (!list) return
          for (const cell of list.querySelectorAll(CELL_SELECTOR)) {
            if (cell.getAttribute(NAV_MARK) !== null) continue
            const label = cell.querySelector(LABEL_SELECTOR)?.textContent || ''
            if (label.includes('本地语音')) cell.setAttribute(NAV_MARK, '')
          }
        } catch (e) { /* 下一轮再试 */ }
      }
      let watched
      let panelObserver
      const sync = () => {
        const panel = doc.querySelector(PANEL_SELECTOR)
        if (!panel) {
          panelObserver?.disconnect()
          panelObserver = void 0
          watched = void 0
          return
        }
        markPanel(panel)
        if (panel === watched) return
        injectNavCss()
        panelObserver?.disconnect()
        watched = panel
        panelObserver = new Observer(() => { markPanel(panel) })
        panelObserver.observe(panel, { childList: true, subtree: true })
      }
      sync()
      const bodyObserver = new Observer(sync)
      bodyObserver.observe(doc.body, { childList: true })
      return () => { bodyObserver.disconnect(); panelObserver?.disconnect() }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-breeze-voice')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-breeze-voice: 设置页样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'breeze-voice', order: 30, label: '本地语音' },
          () => h(Panel),
        ))

        const disposeNavIcon = installSectionNavIcon()
        if (disposeNavIcon) ctx.effect(() => disposeNavIcon, 'dsh-breeze-voice: 设置页导航图标')
      },
    }
  },
})
