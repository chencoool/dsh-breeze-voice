/**
 * dsh-breeze-voice —— 浏览器半端（设置里的一页）
 * ============================================================================
 * 主界面参考同类语音设置的设计结构：
 *   音色 / 自动情绪 / 傲娇底色 / 模型判断情绪 / 空闲卸载 / 空闲多久卸载 /
 *   安装目录 / 显存(卸载·加载)。另加一个试听按钮和状态栏。
 *
 * client bundle 是自注册脚本（不是 ESM）：
 *   window.__ModuleLoader__.load({ id:'<包名>', factory:(require)=>({inject,apply}) })
 * 进「设置」用 settings.section 插槽，label 就是左侧导航那一项。
 * 控件全部自写，颜色只取 --dsw-alias-* 主题 token（不 require 宿主 UI 包）。
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
      root: '', voice: 'qinglan', autoEmotion: true, emotionBackbone: true,
      emotionModel: false, unloadIdle: true, unloadIdleMinutes: 5, rate: 1,
    }

    const CSS = `
[data-bv-page]{display:flex;flex-direction:column;gap:16px;padding:2px 2px 10px;max-width:680px;}
[data-bv-h]{font-size:15px;font-weight:650;color:var(--dsw-alias-label-primary,inherit);margin:0;}
[data-bv-sub]{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#9aa0a6);margin:-8px 0 0;}
[data-bv-card]{display:flex;flex-direction:column;gap:2px;border-radius:12px;padding:6px 14px;
  background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06));
  border:1px solid var(--dsw-alias-bg-layer-3,rgba(127,127,127,.22));}
[data-bv-row]{display:flex;align-items:center;gap:12px;min-height:46px;padding:8px 0;
  border-bottom:1px solid var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14));}
[data-bv-row]:last-child{border-bottom:0;}
[data-bv-msg]{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}
[data-bv-label]{font-size:13px;color:var(--dsw-alias-label-primary,inherit);}
[data-bv-hint]{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-bv-ctl]{flex:none;display:flex;align-items:center;gap:8px;}
[data-bv-sw]{flex:none;width:38px;height:22px;border-radius:11px;border:0;cursor:pointer;position:relative;padding:0;
  background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.35));transition:background .15s;}
[data-bv-sw][data-on]{background:#3b82f6;}
[data-bv-sw] i{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s;display:block;}
[data-bv-sw][data-on] i{left:19px;}
[data-bv-input]{padding:7px 9px;border-radius:8px;font-size:12px;font-family:inherit;color:inherit;
  border:1px solid var(--dsw-alias-bg-layer-3,rgba(255,255,255,.14));
  background:var(--dsw-alias-bg-layer-4,rgba(128,128,128,.12));}
[data-bv-input]:focus{outline:none;border-color:#3b82f6;}
[data-bv-input][data-wide]{flex:1;min-width:220px;}
select[data-bv-input]{color-scheme:light dark;}
select[data-bv-input] option,select[data-bv-input] optgroup{
  background-color:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);}
[data-bv-btn]{padding:7px 11px;border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap;
  color:inherit;border:1px solid var(--dsw-alias-bg-layer-3,rgba(255,255,255,.16));
  background:var(--dsw-alias-bg-layer-4,rgba(128,128,128,.14));}
[data-bv-btn]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.24));}
[data-bv-btn][data-primary]{background:#3b82f6;border-color:#3b82f6;color:#fff;}
[data-bv-btn][disabled]{opacity:.5;cursor:default;}
[data-bv-status]{font-size:12px;line-height:18px;padding:9px 11px;border-radius:9px;word-break:break-all;
  background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06));color:var(--dsw-alias-label-secondary,#c9ccd1);}
[data-bv-dot]{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:#9aa0a6;}
[data-bv-dot][data-on]{background:#22c55e;}
[data-bv-toast]{font-size:12px;line-height:18px;min-height:18px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-bv-toast][data-err]{color:#f59e0b;}
audio[data-bv-audio]{height:34px;max-width:100%;}
`

    const Switch = ({ on, onChange }) => h('button', {
      'data-bv-sw': '', 'data-on': on ? '' : undefined,
      role: 'switch', 'aria-checked': on ? 'true' : 'false',
      onClick: () => onChange(!on), type: 'button',
    }, h('i', {}))

    const Row = ({ label, hint, children }) => h('div', { 'data-bv-row': '' },
      h('div', { 'data-bv-msg': '' },
        h('div', { 'data-bv-label': '' }, label),
        hint ? h('div', { 'data-bv-hint': '' }, hint) : null,
      ),
      h('div', { 'data-bv-ctl': '' }, children),
    )

    // 试听音频：挂在组件里，用 blob URL 播放。
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

      // 改动即存（debounce 400ms，整份 draft 一起写，最后一次为准，无竞态）。
      const saveTimer = useRef(null)
      const save = useCallback((next) => {
        setDraft(next)
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(async () => {
          try {
            const r = await jpost('/config', next)
            if (!mounted.current) return
            // root 改了要重新读音色清单和状态
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

      const voiceOptions = voices.length
        ? voices.map((v) => ({ value: v.id, label: v.name + (v.ready === false ? '（还没建好）' : '') + (v.description ? ' · ' + v.description : '') }))
        : [{ value: draft.voice || '', label: voices.length ? '正在读音色…' : '（先在下面填安装目录）' }]

      return h('div', { 'data-bv-page': '' },
        h('h2', { 'data-bv-h': '' }, '本地语音 · Breeze TTS 2'),
        h('p', { 'data-bv-sub': '' }, '本机跑，音色和情绪在下面选；装好后所有需要语音的插件都能认出这些音色。'),

        h('div', { 'data-bv-card': '' },
          // b1 音色
          h(Row, { key: 'voice', label: '音色', hint: '选一个本机音色；标「还没建好」的要先现场设计生成 .breeze 文件。' },
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

          // b2 自动情绪
          h(Row, { key: 'autoEmotion', label: '自动情绪', hint: '按文字内容自动挑语气（傲娇、开心、撒娇…），只改语气不改音色。' },
            h(Switch, { on: Boolean(draft.autoEmotion), onChange: (v) => set('autoEmotion', v) }),
          ),

          // b3 傲娇底色
          h(Row, { key: 'emotionBackbone', label: '傲娇底色', hint: '把大肥鱼的傲娇人设作为情绪主干；关掉则用中性档位描述。' },
            h(Switch, { on: Boolean(draft.emotionBackbone), onChange: (v) => set('emotionBackbone', v) }),
          ),

          // b4 模型判断情绪
          h(Row, { key: 'emotionModel', label: '模型判断情绪', hint: '预留开关：当前版本用关键词＋人设骨架离线推断，不额外调模型，保证断网也能说话。' },
            h(Switch, { on: Boolean(draft.emotionModel), onChange: (v) => set('emotionModel', v) }),
          ),

          // b5 空闲卸载
          h(Row, { key: 'unloadIdle', label: '空闲卸载', hint: '一段时间没人说话就结束模型进程，释放显存；下次说话会自动重新加载。' },
            h(Switch, { on: Boolean(draft.unloadIdle), onChange: (v) => set('unloadIdle', v) }),
          ),

          // b6 空闲多久卸载
          h(Row, { key: 'unloadIdleMinutes', label: '空闲多久卸载', hint: '无活动达到这个时长后卸载模型。' },
            h('select', {
              'data-bv-input': '', value: draft.unloadIdleMinutes,
              onChange: (e) => set('unloadIdleMinutes', Number(e.target.value)),
              style: { width: 120 },
            }, [1, 3, 5, 10, 15, 30].map((n) => h('option', { key: n, value: n }, n + ' 分钟'))),
          ),

          // b7 安装目录
          h(Row, { key: 'root', label: '安装目录', hint: 'Breeze TTS 2 的实际安装目录（里面要有 breeze-runtime.json 和 voices 文件夹）。' },
            h('input', {
              'data-bv-input': '', 'data-wide': '', type: 'text',
              value: draft.root, placeholder: 'D:\\Breeze TTS 2',
              onChange: (e) => set('root', e.target.value),
            }),
          ),

          // b8 显存
          h(Row, { key: 'gpu', label: '显存', hint: '手动加载/卸载模型进程；卸载只结束进程，模型和音色文件都不动。' },
            h('button', { 'data-bv-btn': '', type: 'button', disabled: busy, onClick: () => act('unload') }, '卸载'),
            h('button', { 'data-bv-btn': '', 'data-primary': '', type: 'button', disabled: busy, onClick: () => act('load') }, '加载'),
          ),
        ),

        // 试听播放器（生成后出现）
        preview.url ? h('audio', { 'data-bv-audio': '', controls: true, ref: preview.audioRef, src: preview.url }) : null,

        // 状态栏
        h('div', { 'data-bv-status': '' },
          h('span', { 'data-bv-dot': '', 'data-on': stat.loaded ? '' : undefined }),
          stat.loaded ? '模型已加载' : '模型未加载',
          ' · 安装目录：' + (stat.configured ? (stat.root || '—') : '未设置'),
          ' · 当前音色：' + (draft.voice || '—'),
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
