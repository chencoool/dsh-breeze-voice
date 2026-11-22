import { spawn, execFile } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, writeFileSync, readFileSync, readdirSync, realpathSync, statSync, unlinkSync } from 'node:fs';
import { join, relative, isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {normalizeSpeech} from './loudness.mjs';

export function readRuntime(root) {
  if(!root||!isAbsolute(root))throw new Error('请先设置 Breeze 的实际安装目录。');
  return runtimeOptions({...JSON.parse(readFileSync(join(root,'breeze-runtime.json'),'utf8')),root});
}
export function runtimeOptions(value) {
  if(!value?.root||!isAbsolute(value.root))throw new Error('Breeze root 必须为绝对路径。');
  const root=resolve(value.root),port=Number(value.port??18370);
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Breeze 端口不合法。');
  const file=(name)=>{
    if(typeof name!=='string'||!name)throw new Error('请指定已核对的程序和模型文件。');
    const p=resolve(root,name),r=relative(root,p);
    if(r.startsWith('..')||isAbsolute(r))throw new Error('程序和模型须放在所选 Breeze 根目录内。');
    return p;
  };
  const ffmpeg=value.ffmpeg?(isAbsolute(value.ffmpeg)?resolve(value.ffmpeg):file(value.ffmpeg)):undefined;
  return {...value,root,port,exe:file(value.exe),model:file(value.model),ffmpeg,base:`http://127.0.0.1:${port}`,sourceRoots:Array.isArray(value.sourceRoots)?value.sourceRoots:[],disableCoopmat:value.disableCoopmat===true};
}
export const PRESETS = [
  { id: 'qinglan', name: '晴岚', description: '温柔清透女声', instruction: '一位年轻成年女性，温柔清透的中音，声音自然干净，有亲切的微笑感。标准普通话，轻松自然地聊天，不刻意撒娇，不用播音腔。', seed: 42 },
  { id: 'lingxi', name: '灵汐', description: '明亮活泼女声', instruction: '一位年轻成年女性，明亮清脆而不尖锐的声音，轻快有活力，带一点俏皮和笑意。标准普通话，像朋友聊天，咬字清晰，避免夸张表演。', seed: 314 },
  { id: 'wanning', name: '晚宁', description: '柔和偏低女声', instruction: '一位成年女性，柔和略低的中低音，温暖细腻，放松从容，带一点轻微气息感但不耳语。标准普通话，自然聊天，语速平稳，不用朗诵腔。', seed: 2718 },
  { id: 'xingzhou', name: '星舟', description: '温润清朗男声', instruction: '一位年轻成年男性，温润清朗的中低音，干净沉稳而有亲和力，不沙哑，不压低嗓子。标准普通话，像朋友一样自然聊天，语速适中。', seed: 2026 },
];
export function presetOf(value, presets=PRESETS) { return presets.find(p => p.id === value || p.name === value); }
// 解析 .breeze 音色文件的头部，取出逐字稿/描述（格式见 runtime/docs/voices.md:173-198）。
// 逐字稿是明文存在文件里的，所以读取音色不需要任何 ASR。
function readBreezeMeta(file) {
  const buf = readFileSync(file);
  if (buf.length < 24 || buf.toString('ascii', 0, 4) !== 'BRZV') throw Error('不是 Breeze 音色文件。');
  const version = buf.readUInt32LE(4);
  const transcriptLen = buf.readUInt32LE(20);
  let off = 24;
  if (!Number.isInteger(transcriptLen) || transcriptLen < 0 || off + transcriptLen > buf.length) throw Error('音色文件逐字稿长度不合法。');
  const transcript = buf.toString('utf8', off, off + transcriptLen).trim();
  off += transcriptLen;
  let description = '';
  if (version === 2) {
    const readU32 = () => { if (off + 4 > buf.length) throw Error('音色文件元数据不完整。'); const n = buf.readUInt32LE(off); off += 4; return n; };
    const descLen = readU32();
    if (descLen && off + descLen <= buf.length) { description = buf.toString('utf8', off, off + descLen); off += descLen; }
    const fieldCount = readU32();
    for (let i = 0; i < fieldCount && i < 32; i++) {
      const nameLen = readU32(); if (off + nameLen > buf.length) break;
      off += nameLen; // 字段名本插件用不到，跳过
      const valueLen = readU32(); if (off + valueLen > buf.length) break;
      off += valueLen;
    }
  }
  return { transcript, description, version };
}
// 由音色 id 生成稳定 seed，保证同一音色每次合成可复现（不随重启变化）。
function stableSeed(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 0xffffffff;
}
// 从用户填的「音色名称和说明」里拆出显示名与说明。书写约定：名称后接逗号「，
// （也认英文 ,）再写音色特点，如「温柔版大肥鱼，温柔清亮的女声」。插件把逗号转写成
// 显示分隔符「 · 」（两边各一个空格）——下拉 label 正是 name + ' · ' + description。
// 兼容历史的 · / • 分隔与无分隔符数据：按第一个句末标点拆；带括号的名字
// （如「大肥鱼（破晓版）…」）收到第一个右括号，多余部分并回说明。
// 没有用户文本时返回 null，调用方退回 id。
function describeLabel(desc, transcript) {
  const s = (desc || '').trim()
  if (!s) return { name: null, description: transcript ? '「' + transcript.slice(0, 30) + '」' : '克隆音色' }
  let name, detail
  const parts = s.split(/[，,·•]/)
  if (parts.length > 1) {
    name = parts[0]; detail = parts.slice(1).join('，')
  } else {
    const cut = s.search(/[。！？.!?]/)
    if (cut > 0) { name = s.slice(0, cut); detail = s.slice(cut).replace(/^[。！？.!?]\s*/, '') }
    else { name = s; detail = '' }
  }
  const b = name.match(/^(.{1,14}?[（(][^）)]{1,14}[）)])(.*)$/)
  if (b) { detail = (b[2].trim() + (detail.trim() ? ' ' + detail.trim() : '')).trim(); name = b[1] }
  return { name: name.trim() || null, description: detail.trim() }
}
// Read per runtime and per request: sibling ESM imports may survive a host reload.
export function loadPresets(root) {
  const voicesDir = join(root, 'voices');
  const file = join(voicesDir, 'custom-presets.json');
  const ids = new Set(PRESETS.map(p => p.id)), names = new Set(PRESETS.map(p => p.name));
  let custom = [];
  if (existsSync(file)) {
    const input = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(input) || input.length > 64) throw Error('Breeze 自定义音色列表不合法。');
    // 逐条校验、逐条容错：某一条不合法或音色文件已被删掉，只跳过这一条，
    // 不能让它连累整个列表——否则用户手动删了一个 .breeze 文件，下拉里
    // 所有自定义音色会一起消失，只剩四个内置音色。
    for (const p of input) {
      try {
        if (!p || !/^[-a-z0-9_]{1,64}$/.test(p.id) || ids.has(p.id) || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 64 || names.has(p.name) || typeof p.description !== 'string' || p.description.length > 1000 || typeof p.instruction !== 'string' || p.instruction.length > 2000 || !Number.isInteger(p.seed) || p.seed < 0 || p.seed > 0xffffffff || p.direction !== undefined && (typeof p.direction !== 'string' || p.direction.length > 2000)) continue;
        const voice = join(voicesDir, p.id + '.breeze');
        if (!existsSync(voice)) continue;
        const rel = relative(realpathSync(voicesDir), realpathSync(voice));
        if (rel.startsWith('..') || isAbsolute(rel) || !statSync(voice).isFile()) continue;
        if (p.normalizeOutput !== undefined && typeof p.normalizeOutput !== 'boolean') continue;
        if (p.displayOrder !== undefined && (!Number.isInteger(p.displayOrder) || Math.abs(p.displayOrder) > 10000)) continue;
        ids.add(p.id); names.add(p.name);
        custom.push({ id: p.id, name: p.name, description: p.description, instruction: p.instruction, seed: p.seed, ...(p.direction ? { direction: p.direction } : {}), ...(p.normalizeOutput ? { normalizeOutput: true } : {}), ...(p.displayOrder !== undefined ? { displayOrder: p.displayOrder } : {}) });
      } catch { /* 单条不合法就跳过 */ }
    }
  }
  // 扫描 voices\*.breeze：桌面版克隆音色只写文件、不登记 custom-presets.json，
  // 自管（local）模式此前因此看不到。这里把未登记的音色按文件里的逐字稿自动建成条目，
  // 让任意模式都能同步——不动用户的 custom-presets.json，也不新建同步文件夹。
  const discovered = [];
  if (existsSync(voicesDir)) {
    for (const f of readdirSync(voicesDir)) {
      if (!f.endsWith('.breeze')) continue;
      const id = f.slice(0, -'.breeze'.length);
      if (!/^[-a-z0-9_]{1,64}$/.test(id) || ids.has(id)) continue;
      const voice = join(voicesDir, f);
      try {
        if (!statSync(voice).isFile()) continue;
        const rel = relative(realpathSync(voicesDir), realpathSync(voice));
        if (rel.startsWith('..') || isAbsolute(rel)) continue;
        const meta = readBreezeMeta(voice);
        ids.add(id);
        // 用户填的「音色名称和说明」存进 .breeze 的 description；填了中文名就用它当
        // 显示名、覆盖掉 ID；没填（只有逐字稿预览）才退回 id。见 describeLabel。
        const label = describeLabel(meta.description, meta.transcript)
        discovered.push({
          id,
          name: label.name || id,
          description: label.description,
          instruction: '',
          seed: stableSeed(id),
        });
      } catch { /* 单个音色文件坏了就跳过，不影响其它音色 */ }
    }
  }
  return [...PRESETS, ...custom.sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)), ...discovered];
}
export function validateText(value) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 1200) throw new Error('语音文字需为 1–1200 字。');
  return text;
}
export function wavBuffer(pcm) {
  if (pcm.length < 2400 || pcm.length % 2) throw new Error('Breeze 返回的音频为空或不完整。');
  const h = Buffer.alloc(44);
  h.write('RIFF'); h.writeUInt32LE(pcm.length + 36, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
export function readSourceWav(source, allowedRoots=[]) {
  const file = realpathSync(String(source));
  if (!allowedRoots.some(root => { if(!existsSync(root))return false; const p=relative(realpathSync(root),file); return p && !p.startsWith('..') && !isAbsolute(p); })) throw new Error('音源须位于已明确允许的大肥鱼歌曲库、缓存或试听目录内。');
  if (statSync(file).size > 64*1024*1024) throw new Error('实验换声音源最大为 64 MB。');
  const audio=readFileSync(file);
  if(audio.toString('ascii',0,4)!=='RIFF'||audio.toString('ascii',8,12)!=='WAVE')throw new Error('请提供已分离人声的 WAV 文件，不接受整首带伴奏歌曲。');
  let byteRate=0, data=0;
  for(let i=12;i+8<=audio.length;) {
    const n=audio.readUInt32LE(i+4),id=audio.toString('ascii',i,i+4);
    if(i+8+n>audio.length)throw new Error('WAV 文件不完整。');
    if(id==='fmt '&&n>=16){
      const format=audio.readUInt16LE(i+8),channels=audio.readUInt16LE(i+10),rate=audio.readUInt32LE(i+12),align=audio.readUInt16LE(i+20),bits=audio.readUInt16LE(i+22);
      byteRate=audio.readUInt32LE(i+16);
      if(![1,3].includes(format)||![1,2].includes(channels)||![8,16,24,32].includes(bits)||align!==channels*bits/8||byteRate!==rate*align)throw new Error('WAV 格式不支持或字节率不完整。');
    }
    if(id==='data')data+=n;
    i+=8+n+(n%2);
  }
  if(!byteRate||!data||data/byteRate<1||data/byteRate>180)throw new Error('实验换声目前接受 1–180 秒的有效 WAV 人声。');
  return {audio,seconds:data/byteRate};
}
export async function health(runtime) {
  try {
    const r = await fetch(`${runtime.base}/health`, { signal: AbortSignal.timeout(1500) });
    const h = await r.json();
    return r.ok && h.status === 'ok' && h.sample_rate === 24000 ? h : null;
  } catch { return null; }
}
export function createService({ runtime, log = {}, onDispose = () => {} } = {}) {
  const options=runtimeOptions(runtime),ROOT=options.root,BASE=options.base;
  const checkHealth=()=>health(options);
  let child = null, starting = null, disposed = false, queue = Promise.resolve();
  let lastUsedAt = 0, lastLoadedAt = 0, unloading = null, lastUnloadReason = '';
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  // 卸载 = 让占着显存的 breeze-server 进程退出。模型文件、音色文件一律不动，下次说话再拉起。
  // 只对「命令行确实是本模块的程序 + 本模型 + 本端口」的进程下手，避免误杀别人开的服务。
  function runFile(exe, args) {
    return new Promise((resolve) => {
      try {
        execFile(exe, args, { windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => resolve(String(stdout || '')));
      } catch { resolve(''); }
    });
  }
  async function portOwner(port) {
    const out = await runFile('netstat', ['-ano', '-p', 'TCP']);
    for (const line of out.split(/\r?\n/)) {
      if (!/LISTENING/i.test(line)) continue;
      const parts = line.trim().split(/\s+/);
      if (!(parts[1] || '').endsWith(':' + port)) continue;
      const pid = Number(parts[parts.length - 1]);
      if (Number.isInteger(pid) && pid > 0) return pid;
    }
    return 0;
  }
  async function commandLineOf(pid) {
    const out = await runFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`]);
    return out.trim();
  }
  onDispose(() => { disposed = true; if(child && child.exitCode === null) child.kill(); });
  async function ensure() {
    if (disposed) throw new Error('语音模块已停用。');
    if (await checkHealth()) return;
    if (starting) return starting;
    starting = (async () => {
      const {exe,model}=options;
      if (!existsSync(exe) || !existsSync(model)) throw new Error('Breeze 程序或模型尚未安装完整。');
      log.info?.('正在加载本机语音模型…');
      mkdirSync(join(ROOT, 'logs'), { recursive: true });
      const fd = openSync(join(ROOT, 'logs', `server-${Date.now()}.log`), 'a');
      try {
        const env={...process.env};
        // Opt in only after reproducing a driver-specific cooperative-matrix crash.
        if(options.disableCoopmat)env.GGML_VK_DISABLE_COOPMAT='1';
        child = spawn(exe, [model, '--host', '127.0.0.1', '--port', String(options.port), '--ws-port', '-1', '--voices-dir', join(ROOT, 'voices'), '--webui'], { cwd: join(ROOT, 'models'), windowsHide: true, env, stdio: ['ignore', fd, fd] });
      } finally { closeSync(fd); }
      let launchError = null;
      child.on('error', e => { launchError = e; });
      for (let n = 0; n < 120; n++) {
        if (disposed) throw new Error('语音模块已停用。');
        if (launchError) throw launchError;
        if (child.exitCode !== null) throw new Error(`Breeze 启动退出（${child.exitCode}），请检查本机日志。`);
        if (await checkHealth()) { lastLoadedAt = Date.now(); log.info?.('Breeze 本机语音服务已就绪。'); return; }
        await new Promise(r => setTimeout(r, 1000));
      }
      if (child.exitCode === null) child.kill();
      throw new Error('Breeze 启动超时；保留文字回复，不改用在线或系统声音。');
    })().finally(() => { starting = null; });
    return starting;
  }
  // 卸载：结束占显存的进程，模型文件/音色文件不动；下次说话 ensure() 会重新拉起。
  async function unload({ force = false, reason = '' } = {}) {
    if (disposed) return { ok: false, unloaded: false, message: '语音模块已停用。' };
    if (unloading) return unloading;
    unloading = (async () => {
      if (starting) { try { await starting; } catch {} }
      let pid = child && child.exitCode === null ? child.pid : 0;
      let how = '本模块启动的服务';
      if (!pid) {
        pid = await portOwner(options.port);
        if (!pid) {
          if (await checkHealth()) return { ok: false, unloaded: false, message: `端口 ${options.port} 上有服务但找不到进程，没有卸载。` };
          lastUnloadReason = reason || 'idle';
          return { ok: true, unloaded: false, message: '模型现在没有加载，不需要卸载。' };
        }
        how = '端口上托管的服务';
      }
      const cmd = await commandLineOf(pid);
      const modelFile = String(options.model).split(/[\\/]/).pop();
      const looksOurs = /breeze-server/i.test(cmd) && cmd.includes(String(options.port)) && cmd.includes(modelFile);
      if (!looksOurs && !force) {
        return { ok: false, unloaded: false, pid, message: `端口 ${options.port} 是别的程序占着（PID ${pid}），没有动它。` };
      }
      log.info?.(`正在卸载本机语音模型（${how}，PID ${pid}，原因：${reason || '手动'}）…`);
      await runFile('taskkill', ['/PID', String(pid), '/T', '/F']);
      let gone = false;
      for (let n = 0; n < 24; n++) {
        if (!(await checkHealth())) { gone = true; break; }
        await sleep(500);
      }
      child = null;
      lastUnloadReason = reason || 'manual';
      lastLoadedAt = 0;
      return { ok: gone, unloaded: gone, pid, message: gone ? '已卸载：模型进程退出，显存释放；下次说话会自动重新加载。' : '已发出结束指令，但服务还没退出，请再试一次。' };
    })().finally(() => { unloading = null; });
    return unloading;
  }
  async function state() {
    return { loaded: !!(await checkHealth()), lastUsedAt, lastLoadedAt, lastUnloadReason, unloading: !!unloading };
  }
  function synth(textValue, voiceValue, outputDir = join(ROOT, 'samples'), emotionValue = null) {
    const presets=loadPresets(ROOT),text = validateText(textValue), preset = presetOf(voiceValue,presets);
    if (!preset) return Promise.reject(new Error('音色不存在，请选择：'+presets.map(p=>p.name).join('、')+'。'));
    // 情绪只叠加语气，音色身份（preset.direction）始终保留在最前面。
    const emo = emotionValue && typeof emotionValue === 'object' ? emotionValue : null;
    const instruction = emo
      ? [preset.direction, emo.instruction].filter(Boolean).join(' ')
      : preset.direction;
    const cfgScale = instruction ? (emo?.cfg || 4) : 1;
    const job = queue.then(async () => {
      lastUsedAt = Date.now();
      await ensure();
      if (!existsSync(join(ROOT, 'voices', `${preset.id}.breeze`))) throw new Error(`音色 ${preset.name} 尚未建好，不会临时换成其他声音。`);
      const r = await fetch(`${BASE}/v1/audio/speech`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: text, voice: preset.id, ...(instruction?{instructions:instruction}:{}), response_format: 'pcm', seed: preset.seed, cfg_scale: cfgScale, split_chars: 120, max_new_tokens: 750 }),
        signal: AbortSignal.timeout(180000),
      });
      if (!r.ok) throw new Error(`Breeze 合成失败（HTTP ${r.status}）。`);
      if (!r.headers.get('content-type')?.startsWith('audio/pcm')) throw new Error('Breeze 返回的不是预期音频。');
      const pcm = Buffer.from(await r.arrayBuffer());
      mkdirSync(outputDir, { recursive: true });
      const file = join(outputDir, `${preset.id}-${randomUUID()}.wav`);
      if(preset.normalizeOutput){
        const raw=join(outputDir,'.raw-'+randomUUID()+'.wav');writeFileSync(raw,wavBuffer(pcm),{flag:'wx'});
        try{await normalizeSpeech(raw,file,options.ffmpeg);}finally{unlinkSync(raw);}
      }else writeFileSync(file, wavBuffer(pcm), { flag: 'wx' });
      lastUsedAt = Date.now();
      return { file, engine: 'breeze-tts2-vulkan', voice: preset.id, ...(emo?.name?{emotion:emo.name}:{}) };
    });
    queue = job.catch(() => {});
    return job;
  }
  function convert(source, voiceValue, {text='',keepMelody=0,outputDir=join(ROOT,'samples')}={}) {
    const preset=presetOf(voiceValue,loadPresets(ROOT));
    if(!preset)return Promise.reject(new Error('音色不存在。'));
    if(!Number.isInteger(keepMelody)||keepMelody<0||keepMelody>2)return Promise.reject(new Error('保留旋律只能是 0、1 或 2。'));
    const job=queue.then(async()=>{
      lastUsedAt=Date.now();
      const {audio,seconds}=readSourceWav(source,options.sourceRoots);
      await ensure();
      const form=new FormData();form.set('source',new Blob([audio],{type:'audio/wav'}),'vocal.wav');form.set('voice_id',preset.id);
      form.set('temperature','0.3');form.set('top_k','1');form.set('keep_acoustic',String(keepMelody));form.set('seed',String(preset.seed));
      if(text)form.set('text',validateText(text));
      const r=await fetch(`${BASE}/v1/audio/convert`,{method:'POST',body:form,signal:AbortSignal.timeout(900000)});
      if(!r.ok||!r.headers.get('content-type')?.startsWith('audio/pcm'))throw new Error(`实验换声失败（HTTP ${r.status}）。`);
      const pcm=Buffer.from(await r.arrayBuffer());
      mkdirSync(outputDir,{recursive:true});const file=join(outputDir,`experimental-${preset.id}-${randomUUID()}.wav`);
      writeFileSync(file,wavBuffer(pcm),{flag:'wx'});
      lastUsedAt=Date.now();
      return {file,voice:preset.id,engine:'breeze-experimental-conversion',sourceSeconds:seconds,seconds:pcm.length/48000,warning:'实验功能可能改变音高或旋律；没有替换原有 RVC 翻唱。'};
    });
    queue=job.catch(()=>{});return job;
  }
  return { ensure, synth, convert, unload, state, health:checkHealth };
}
