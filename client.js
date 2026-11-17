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
      root: '', voice: 'qinglan', autoEmotion: true, emotionBackbone: true,
      emotionModel: false, unloadIdle: true, unloadIdleMinutes: 5, rate: 1,
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

          h(Row, { key: 'autoEmotion', label: '自动情绪', hint: '按文字内容自动挑语气（傲娇、开心、撒娇…），只改语气不改音色。' },
            h(Switch, { on: Boolean(draft.autoEmotion), onChange: (v) => set('autoEmotion', v) }),
          ),

          h(Row, { key: 'emotionBackbone', label: '傲娇底色', hint: '把大肥鱼的傲娇人设作为情绪主干；关掉则用中性档位描述。' },
            h(Switch, { on: Boolean(draft.emotionBackbone), onChange: (v) => set('emotionBackbone', v) }),
          ),

          h(Row, { key: 'emotionModel', label: '模型判断情绪', hint: '预留开关：当前版本用关键词＋人设骨架离线推断，不额外调模型，保证断网也能说话。' },
            h(Switch, { on: Boolean(draft.emotionModel), onChange: (v) => set('emotionModel', v) }),
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
      },
    }
  },
})
