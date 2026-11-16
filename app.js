import * as D from './dsp.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmt = (s) => (s < 10 ? s.toFixed(2) : s.toFixed(1)) + ' s';
const pad2 = (n) => String(n).padStart(2, '0');
const clone = (o) => JSON.parse(JSON.stringify(o));
const db2 = (v) => (v > 1e-6 ? (20 * Math.log10(v)).toFixed(1) : '-∞');
const app = $('#app');
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// ---------- banco de dados local ----------
let dbp;
function db() {
  return dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('sfx-studio', 1);
    r.onupgradeneeded = () => ['clips', 'presets', 'mixes'].forEach((s) => r.result.createObjectStore(s, { keyPath: 'id' }));
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
async function tx(st, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(st, mode), req = fn(t.objectStore(st));
    t.oncomplete = () => res(req && req.result);
    t.onerror = () => rej(t.error);
  });
}
const all = (s) => tx(s, 'readonly', (st) => st.getAll());
const put = (s, o) => tx(s, 'readwrite', (st) => st.put(o));
const del = (s, id) => tx(s, 'readwrite', (st) => st.delete(id));
navigator.storage?.persist?.();

// ---------- áudio ----------
const decodedByBlob = new WeakMap(), pcache = new Map();
async function decode(clip) {
  if (decodedByBlob.has(clip.blob)) return decodedByBlob.get(clip.blob);
  const b = await D.ctx().decodeAudioData(await clip.blob.arrayBuffer());
  decodedByBlob.set(clip.blob, b);
  return b;
}
const clipKey = (clip) => JSON.stringify([clip.edits, clip.chain]);
async function processed(clip) {
  const key = clipKey(clip), c = pcache.get(clip.id);
  if (c && c.key === key) return c.buf;
  const b = await D.renderClip(await decode(clip), clip.edits, clip.chain);
  pcache.set(clip.id, { key, buf: b });
  return b;
}
const clipLen = (c) => Math.max(0, (c.edits?.end ?? c.dur ?? 0) - (c.edits?.start || 0));

let playing = null;
function play(buf, { from = 0, to = null, loop = false, loopStart = 0, loopEnd = null, tag = '', onEnd } = {}) {
  stop();
  const c = D.ctx(), s = c.createBufferSource();
  s.buffer = buf;
  s.connect(c.destination);
  const le = loopEnd ?? buf.duration;
  from = Math.max(0, Math.min(from, buf.duration - 0.001));
  if (loop) { s.loop = true; s.loopStart = loopStart; s.loopEnd = le; s.start(0, from); }
  else if (to != null) s.start(0, from, Math.max(0.001, to - from));
  else s.start(0, from);
  playing = { s, buf, tag, from, t0: c.currentTime, loop, ls: loopStart, le };
  s.onended = () => { if (playing && playing.s === s) { playing = null; onEnd && onEnd(); } };
}
function stop() { if (playing) { const p = playing; playing = null; try { p.s.stop(); } catch {} } }
function playPos() {
  if (!playing) return null;
  let p = playing.from + D.ctx().currentTime - playing.t0;
  if (playing.loop && p >= playing.le) p = playing.ls + ((p - playing.ls) % Math.max(1e-3, playing.le - playing.ls));
  return p;
}

// ---------- desenho ----------
let C;
const col = () => C || (C = Object.fromEntries(['--wave', '--wave-dim', '--handle', '--fg', '--muted', '--accent', '--c4', '--rec', '--bg', '--line'].map((v) => [v.slice(2), getComputedStyle(document.documentElement).getPropertyValue(v).trim()])));

const peakCache = new WeakMap();
function peaks(buf, v0, v1, w) {
  const key = `${v0}|${v1}|${w}`, hit = peakCache.get(buf);
  if (hit && hit.key === key) return hit;
  const d = buf.getChannelData(0), r = buf.sampleRate, mn = new Float32Array(w), mx = new Float32Array(w);
  for (let px = 0; px < w; px++) {
    const a = Math.max(0, Math.floor((v0 + (px / w) * (v1 - v0)) * r));
    const b = Math.min(d.length, Math.max(a + 1, Math.floor((v0 + ((px + 1) / w) * (v1 - v0)) * r)));
    let lo = 1, hi = -1;
    for (let i = a; i < b; i++) { const v = d[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (hi < lo) { lo = hi = 0; }
    mn[px] = lo; mx[px] = hi;
  }
  const res = { key, mn, mx };
  peakCache.set(buf, res);
  return res;
}

const specCache = new WeakMap();
const STOPS = [[0, [12, 12, 22]], [0.3, [70, 22, 110]], [0.55, [180, 45, 90]], [0.75, [240, 120, 45]], [1, [252, 236, 160]]];
function cmap(t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < STOPS.length; i++) if (t <= STOPS[i][0]) {
    const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i], f = (t - a) / (b - a);
    return ca.map((v, k) => v + (cb[k] - v) * f);
  }
  return STOPS[STOPS.length - 1][1];
}
function specCanvas(buf, v0, v1, w, h) {
  const key = `${v0}|${v1}|${w}|${h}`, hit = specCache.get(buf);
  if (hit && hit.key === key) return hit.cv;
  const cols = Math.max(1, Math.floor(w / 2)), rows = Math.max(1, Math.floor(h)), N = 1024, r = buf.sampleRate, d = buf.getChannelData(0);
  const cv = document.createElement('canvas'); cv.width = cols; cv.height = rows;
  const x = cv.getContext('2d'), img = x.createImageData(cols, rows);
  const win = new Float64Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const re = new Float64Array(N), im = new Float64Array(N), fmin = 40, fmax = r / 2;
  const rowBin = new Int32Array(rows);
  for (let y = 0; y < rows; y++) rowBin[y] = Math.min(N / 2, Math.max(1, Math.round(fmin * Math.pow(fmax / fmin, 1 - y / Math.max(1, rows - 1)) / r * N)));
  for (let c = 0; c < cols; c++) {
    const center = Math.floor((v0 + ((c + 0.5) / cols) * (v1 - v0)) * r);
    for (let i = 0; i < N; i++) { const j = center - N / 2 + i; re[i] = (j >= 0 && j < d.length ? d[j] : 0) * win[i]; im[i] = 0; }
    D.fft(re, im, false);
    for (let y = 0; y < rows; y++) {
      const k = rowBin[y], m = Math.hypot(re[k], im[k]) / (N / 4);
      const db = 20 * Math.log10(m + 1e-9), [R, G, B] = cmap((db + 100) / 100), o = (y * cols + c) * 4;
      img.data[o] = R; img.data[o + 1] = G; img.data[o + 2] = B; img.data[o + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  specCache.set(buf, { key, cv });
  return cv;
}

const TICKS = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
function drawWave(cv, buf, o = {}) {
  const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const x = cv.getContext('2d'), K = col();
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, w, h);
  if (!buf) return;
  const v0 = o.v0 ?? 0, v1 = o.v1 ?? buf.duration, span = v1 - v0, T = (t) => ((t - v0) / span) * w;
  if (o.spec) {
    x.imageSmoothingEnabled = true;
    x.drawImage(specCanvas(buf, v0, v1, w, h), 0, 0, w, h);
    if (o.start != null) { x.fillStyle = 'rgba(0,0,0,.6)'; x.fillRect(0, 0, Math.max(0, T(o.start)), h); x.fillRect(T(o.end), 0, w, h); }
  } else {
    const { mn, mx } = peaks(buf, v0, v1, Math.ceil(w)), mid = h / 2;
    const sx = o.start != null ? T(o.start) : -1, ex = o.end != null ? T(o.end) : w + 1;
    x.fillStyle = K.line; x.fillRect(0, mid, w, 1);
    for (let px = 0; px < mn.length; px++) {
      x.fillStyle = px >= sx && px <= ex ? (o.color || K.wave) : K['wave-dim'];
      x.fillRect(px, mid + mn[px] * mid * 0.92, 1, Math.max(1, (mx[px] - mn[px]) * mid * 0.92));
    }
  }
  if (o.ruler) {
    const step = TICKS.find((s) => (s / span) * w >= 64) || 120;
    x.font = '10px system-ui'; x.fillStyle = K.muted;
    for (let t = Math.ceil(v0 / step) * step; t < v1; t += step) {
      const px = T(t); x.fillRect(px, 0, 1, 5);
      x.fillText((step < 0.1 ? t.toFixed(3) : step < 1 ? t.toFixed(1) : t.toFixed(0)) + 's', px + 3, 11);
    }
  }
  if (o.segs) { x.globalAlpha = 0.28; x.fillStyle = K.c4; for (const s of o.segs) x.fillRect(T(s.start), 0, Math.max(2, T(s.end) - T(s.start)), h); x.globalAlpha = 1; }
  if (o.start != null) {
    x.fillStyle = K.handle;
    for (const hx of [T(o.start), T(o.end)]) {
      x.fillRect(hx - 1, 0, 2, h);
      if (o.handles !== false) { x.beginPath(); x.arc(hx, h - 12, 10, 0, Math.PI * 2); x.fill(); }
    }
  }
  if (o.env && o.start != null) {
    const pts = o.env, selW = o.end - o.start, P = (p) => [T(o.start + p.t * selW), h * (1 - p.g / 2)];
    x.strokeStyle = K.fg; x.lineWidth = 2; x.beginPath();
    if (!pts.length) { x.setLineDash([5, 5]); x.moveTo(T(o.start), h / 2); x.lineTo(T(o.end), h / 2); x.stroke(); x.setLineDash([]); }
    else {
      x.moveTo(T(o.start), P(pts[0])[1]);
      for (const p of pts) x.lineTo(...P(p));
      x.lineTo(T(o.end), P(pts[pts.length - 1])[1]);
      x.stroke();
      pts.forEach((p, i) => { const [a, b] = P(p); x.beginPath(); x.arc(a, b, i === o.envSel ? 10 : 7, 0, Math.PI * 2); x.fillStyle = i === o.envSel ? K.accent : K.fg; x.fill(); });
    }
  }
  if (o.pos != null) { x.fillStyle = K.fg; x.fillRect(T(o.pos) - 1, 0, 2, h); }
  if (o.dur && span < o.dur - 1e-6) {
    x.fillStyle = K.line; x.fillRect(0, h - 3, w, 3);
    x.fillStyle = K.accent; x.fillRect((v0 / o.dur) * w, h - 3, Math.max(6, (span / o.dur) * w), 3);
  }
}

// ---------- exportação ----------
const safe = (s) => (s || 'som').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'som';
let expOpts = { rate: 44100, mono: true, fmt: 'wav', lufs: 0, ...store.get('exp', {}) };
const LUFS = [[0, 'Desligado'], [-14, '-14 LUFS (bem alto)'], [-16, '-16 LUFS (recomendado)'], [-18, '-18 LUFS'], [-20, '-20 LUFS (suave)'], [-23, '-23 LUFS (TV/cinema)']];

function exportPanel(id) {
  const opt = (arr, cur) => arr.map(([v, l]) => `<option value="${v}" ${v == cur ? 'selected' : ''}>${l}</option>`).join('');
  return `<div class="exp" id="${id}">
    <div class="grid2">
      <label class="field">Formato<select class="fmt">${opt([['wav', 'WAV (efeitos curtos)'], ['ogg', 'OGG (sons longos)']], expOpts.fmt)}</select></label>
      <label class="field">Taxa<select class="rate">${opt([[44100, '44.1 kHz'], [48000, '48 kHz'], [22050, '22.05 kHz']], expOpts.rate)}</select></label>
      <label class="field">Volume padronizado<select class="lufs">${opt(LUFS, expOpts.lufs)}</select></label>
      <label class="check"><input type="checkbox" class="mono" ${expOpts.mono ? 'checked' : ''}> Mono</label>
    </div>
    <p class="hint">Volume padronizado deixa todos os sons com o mesmo volume percebido e segura picos em -1 dB.</p>
    <div class="btns">
      <button class="primary" data-act="share">Enviar ${expOpts.fmt.toUpperCase()} <small>Drive e outros</small></button>
      <button class="wa" data-act="wa">Enviar no WhatsApp <small>MP3</small></button>
      <button data-act="save">Salvar no celular</button>
    </div>
    <p class="msg" role="status"></p>
  </div>`;
}
function download(f) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(f); a.download = f.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function bindExport(el, getItems) {
  const msg = $('.msg', el), saveExp = () => store.set('exp', expOpts);
  $('.rate', el).onchange = (e) => { expOpts.rate = +e.target.value; saveExp(); };
  $('.mono', el).onchange = (e) => { expOpts.mono = e.target.checked; saveExp(); };
  $('.lufs', el).onchange = (e) => { expOpts.lufs = +e.target.value; saveExp(); };
  $('.fmt', el).onchange = (e) => { expOpts.fmt = e.target.value; saveExp(); $('[data-act=share]', el).firstChild.textContent = `Enviar ${expOpts.fmt.toUpperCase()} `; };
  $$('[data-act]', el).forEach((btn) => btn.onclick = async () => {
    const act = btn.dataset.act;
    stop();
    try {
      msg.textContent = 'Preparando…';
      const items = await getItems();
      if (!items.length) { msg.textContent = 'Nada para exportar.'; return; }
      const files = [];
      for (const [i, it] of items.entries()) {
        if (items.length > 1) msg.textContent = `Preparando ${i + 1} de ${items.length}…`;
        const b = await D.prepare(it.buf, expOpts);
        const kind = act === 'wa' ? 'mp3' : expOpts.fmt;
        const blob = kind === 'mp3' ? await D.encodeMp3(b) : kind === 'ogg' ? await D.encodeOgg(b) : D.encodeWav(b, { loop: !!it.loop });
        files.push(new File([blob], `${safe(it.name)}.${kind}`, { type: blob.type }));
      }
      if (act === 'save') { files.forEach(download); msg.textContent = `${files.length > 1 ? files.length + ' arquivos salvos' : 'Salvo'} em Downloads.`; return; }
      await share(files, msg, act === 'wa' ? 'Pronto. Escolha o WhatsApp e o contato no menu.' : 'Enviado.');
    } catch (e) { msg.textContent = 'Erro: ' + e.message; }
  });
}
async function share(files, msg, okText) {
  if (!(navigator.canShare && navigator.canShare({ files }))) {
    files.forEach(download);
    msg.textContent = 'Este navegador não abriu o menu de compartilhar, então salvei em Downloads.';
    return;
  }
  try {
    await navigator.share({ files });
    msg.textContent = okText;
  } catch (e) {
    if (e.name === 'AbortError') { msg.textContent = 'Envio cancelado.'; return; }
    if (e.name === 'NotAllowedError') {
      msg.innerHTML = '';
      const b = document.createElement('button');
      b.className = 'primary'; b.textContent = 'Arquivo pronto. Toque para enviar';
      b.onclick = () => share(files, msg, okText);
      msg.appendChild(b);
      return;
    }
    msg.textContent = 'Não consegui compartilhar: ' + e.message;
  }
}

// ---------- backup ----------
async function makeBackup() {
  const [clips, presets, mixes] = await Promise.all([all('clips'), all('presets'), all('mixes')]);
  const toUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  const out = { app: 'sfx-studio', version: 1, date: new Date().toISOString(), presets, mixes, clips: [] };
  for (const c of clips) out.clips.push({ ...c, blob: await toUrl(c.blob) });
  const day = new Date().toISOString().slice(0, 10);
  return new File([JSON.stringify(out)], `sfx-studio-backup-${day}.txt`, { type: 'text/plain' });
}
async function restoreBackup(file) {
  let j;
  try { j = JSON.parse(await file.text()); } catch { throw new Error('Este arquivo não é um backup do SFX Studio.'); }
  if (j.app !== 'sfx-studio') throw new Error('Este arquivo não é um backup do SFX Studio.');
  for (const c of j.clips || []) { c.blob = await (await fetch(c.blob)).blob(); await put('clips', c); pcache.delete(c.id); }
  for (const p of j.presets || []) await put('presets', p);
  for (const m of j.mixes || []) await put('mixes', m);
  return { clips: (j.clips || []).length, presets: (j.presets || []).length, mixes: (j.mixes || []).length };
}

// ---------- navegação ----------
let tab = 'lib';
function nav(t) { stop(); tab = t; $$('.tabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.t === t)); render(); }
$$('.tabs button').forEach((b) => b.onclick = () => nav(b.dataset.t));
function render() { window.scrollTo(0, 0); (tab === 'mix' ? mixList : library)(); }

// ---------- biblioteca ----------
let selected = new Set(), query = '', tagFilter = '';
async function library() {
  const clips = (await all('clips')).sort((a, b) => b.created - a.created);
  const tags = [...new Set(clips.flatMap((c) => c.tags || []))].sort((a, b) => a.localeCompare(b));
  if (tagFilter && !tags.includes(tagFilter)) tagFilter = '';
  const q = query.trim().toLowerCase();
  const shown = clips.filter((c) => (!tagFilter || (c.tags || []).includes(tagFilter)) && (!q || c.name.toLowerCase().includes(q) || (c.tags || []).some((t) => t.toLowerCase().includes(q))));
  const lastBk = store.get('bk', 0), needBk = clips.length && Date.now() - lastBk > 7 * 864e5;
  app.innerHTML = `
    <header class="top"><h1>SFX Studio</h1><span class="count">${clips.length} ${clips.length === 1 ? 'som' : 'sons'}</span></header>
    ${needBk ? `<div class="banner"><span>${lastBk ? 'Seu último backup tem mais de uma semana.' : 'Suas gravações só existem neste celular.'} Faça um backup no Drive.</span><button id="goBk">Fazer backup</button></div>` : ''}
    <div class="hero">
      <button class="recbig" id="btnRec"><span class="dot"></span>Gravar</button>
      <label class="btn ghost">Importar<input type="file" accept="audio/*" id="imp" multiple hidden></label>
    </div>
    ${clips.length ? `
    <div class="row"><input id="q" type="search" placeholder="Buscar por nome ou tag" value="${esc(query)}" autocomplete="off" aria-label="Buscar"><button id="selAll" class="ghost">${shown.length && shown.every((c) => selected.has(c.id)) ? 'Desmarcar' : 'Marcar todos'}</button></div>
    ${tags.length ? `<div class="chips"><button class="chipb ${tagFilter ? '' : 'is'}" data-tag="">Todos</button>${tags.map((t) => `<button class="chipb ${t === tagFilter ? 'is' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}` : `<div class="empty"><b>Nenhum som ainda</b><p>Toque em Gravar para capturar seu primeiro efeito sonoro. As gravações ficam salvas neste celular.</p></div>`}
    ${clips.length && !shown.length ? '<p class="hint">Nenhum som encontrado.</p>' : ''}
    <ul class="list">${shown.map((c) => {
      const n = (c.chain || []).filter((f) => f.on).length;
      return `<li data-id="${c.id}">
        <label class="sel"><input type="checkbox" ${selected.has(c.id) ? 'checked' : ''} aria-label="Selecionar ${esc(c.name)}"></label>
        <button class="open"><span class="nm">${esc(c.name)}</span><small>${fmt(clipLen(c))}${n ? ` · ${n} efeito${n > 1 ? 's' : ''}` : ''}${c.edits?.loop ? ' · loop' : ''}${(c.tags || []).length ? ' · ' + c.tags.map(esc).join(', ') : ''}</small></button>
        <button class="icon play" aria-label="Ouvir">▶</button>
      </li>`; }).join('')}</ul>
    <section class="batch" ${selected.size ? '' : 'hidden'}>
      <h2>Exportar ${selected.size} selecionado(s)</h2>
      <label class="field">Nome base <input id="base" placeholder="ex.: passo" autocomplete="off"></label>
      <p class="hint">Com nome base, os arquivos saem como passo_01, passo_02… Sem ele, cada um usa o próprio nome.</p>
      ${exportPanel('bexp')}
      <button class="ghost" id="clearSel">Limpar seleção</button>
    </section>
    <details class="card" id="bkBox"><summary>Backup e restauração</summary>
      <p class="hint">O backup junta todos os sons, presets e mixagens num arquivo só. Guarde no Drive: se você limpar os dados do navegador ou trocar de celular, é só restaurar.${lastBk ? ` Último backup: ${new Date(lastBk).toLocaleDateString('pt-BR')}.` : ''}</p>
      <div class="btns">
        <button class="primary" id="bkShare">Enviar backup <small>Drive</small></button>
        <button id="bkSave">Salvar backup no celular</button>
        <label class="btn ghost">Restaurar backup<input type="file" id="bkIn" hidden></label>
      </div>
      <p class="msg" id="bkMsg" role="status"></p>
    </details>`;

  $('#btnRec').onclick = openRecorder;
  $('#imp').onchange = async (e) => {
    for (const f of e.target.files) {
      const clip = newClip(f.name.replace(/\.[^.]+$/, ''), f);
      try { clip.dur = (await decode(clip)).duration; } catch { continue; }
      await put('clips', clip);
    }
    library();
  };
  if ($('#goBk')) $('#goBk').onclick = () => { $('#bkBox').open = true; $('#bkBox').scrollIntoView({ behavior: 'smooth' }); };
  if ($('#q')) {
    $('#q').oninput = (e) => { query = e.target.value; clearTimeout(library.t); library.t = setTimeout(async () => { await library(); const qi = $('#q'); qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }, 250); };
    $('#selAll').onclick = () => { const allSel = shown.every((c) => selected.has(c.id)); shown.forEach((c) => (allSel ? selected.delete(c.id) : selected.add(c.id))); library(); };
  }
  $$('.chipb').forEach((b) => b.onclick = () => { tagFilter = b.dataset.tag; library(); });
  $$('.list li').forEach((li) => {
    const c = clips.find((x) => x.id === li.dataset.id);
    $('.open', li).onclick = () => editor(c);
    $('.sel input', li).onchange = (e) => { e.target.checked ? selected.add(c.id) : selected.delete(c.id); library(); };
    $('.play', li).onclick = async (e) => {
      const b = e.currentTarget;
      if (b.textContent === '■') { stop(); b.textContent = '▶'; return; }
      $$('.play').forEach((x) => x.textContent = '▶');
      b.textContent = '■';
      play(await processed(c), { onEnd: () => b.textContent = '▶' });
    };
  });
  if (selected.size) {
    $('#clearSel').onclick = () => { selected.clear(); library(); };
    bindExport($('#bexp'), async () => {
      const base = $('#base').value.trim();
      const list = clips.filter((c) => selected.has(c.id));
      const out = [];
      for (let i = 0; i < list.length; i++) out.push({ buf: await processed(list[i]), name: base ? `${base}_${pad2(i + 1)}` : list[i].name, loop: list[i].edits?.loop });
      return out;
    });
  }
  const bkMsg = $('#bkMsg');
  $('#bkShare').onclick = async () => {
    try { bkMsg.textContent = 'Montando backup…'; const f = await makeBackup(); await share([f], bkMsg, 'Backup enviado. Escolha uma pasta no Drive.'); if (!/cancel/.test(bkMsg.textContent)) store.set('bk', Date.now()); }
    catch (e) { bkMsg.textContent = 'Erro: ' + e.message; }
  };
  $('#bkSave').onclick = async () => {
    try { bkMsg.textContent = 'Montando backup…'; download(await makeBackup()); store.set('bk', Date.now()); bkMsg.textContent = 'Backup salvo em Downloads.'; }
    catch (e) { bkMsg.textContent = 'Erro: ' + e.message; }
  };
  $('#bkIn').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { bkMsg.textContent = 'Restaurando…'; const r = await restoreBackup(f); await library(); $('#bkBox').open = true; $('#bkMsg').textContent = `Restaurado: ${r.clips} sons, ${r.presets} presets e ${r.mixes} mixagens.`; }
    catch (err) { bkMsg.textContent = err.message; }
  };
}
function newClip(name, blob) {
  return { id: uid(), name, created: Date.now(), blob, tags: [], edits: { start: 0, end: null, reverse: false, normalize: false, fadeIn: 0, fadeOut: 0, env: [], loop: false }, chain: [] };
}
function autoTrim(buf) {
  const segs = D.detectSegments(buf, { thrDb: -40, minSilMs: 400, padMs: 60 });
  if (!segs.length) return null;
  return { start: segs[0].start, end: segs[segs.length - 1].end };
}

// ---------- gravador ----------
async function openRecorder() {
  const opts = { ns: false, cd: false, trim: true, ...store.get('recOpts', {}) };
  const ov = document.createElement('div');
  ov.className = 'ovl';
  ov.innerHTML = `<div class="recbox">
    <canvas id="rwv"></canvas>
    <div class="meter" aria-hidden="true"><i id="mbar"></i><b id="mpk"></b></div>
    <div class="meterlbl"><span id="mdb">-∞ dB</span><span id="mclip" class="clipwarn" hidden>Estourou! Afaste o celular</span></div>
    <div class="timer" id="rt">0.0 s</div>
    <button class="recbtn" id="rb" aria-label="Gravar"><span></span></button>
    <p class="msg" id="rm">Toque no botão para começar.</p>
    <div class="recopts">
      <label class="check"><input type="checkbox" id="rcd" ${opts.cd ? 'checked' : ''}> Contagem 3, 2, 1</label>
      <label class="check"><input type="checkbox" id="rtr" ${opts.trim ? 'checked' : ''}> Cortar silêncio no início e no fim</label>
      <label class="check"><input type="checkbox" id="rns" ${opts.ns ? 'checked' : ''}> Filtro de ruído do celular</label>
      <p class="hint">O filtro do celular é bom para vozes em lugar barulhento. Para efeitos sonoros, deixe desligado.</p>
    </div>
    <button class="ghost" id="rc">Cancelar</button></div>`;
  document.body.appendChild(ov);
  let stream, rec, raf, chunks = [], t0, cancelled = false, cdTimer, maxPk = 0, clipped = false;
  const cleanup = () => { cancelAnimationFrame(raf); clearInterval(cdTimer); stream?.getTracks().forEach((t) => t.stop()); };
  $('#rc', ov).onclick = () => { cancelled = true; if (rec?.state === 'recording') rec.stop(); cleanup(); ov.remove(); };
  $('#rb', ov).onclick = async () => {
    if (rec?.state === 'recording') { rec.stop(); return; }
    if (stream) return;
    Object.assign(opts, { ns: $('#rns', ov).checked, cd: $('#rcd', ov).checked, trim: $('#rtr', ov).checked });
    store.set('recOpts', opts);
    $$('.recopts input', ov).forEach((i) => i.disabled = true);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: opts.ns, autoGainControl: false } });
    } catch (e) {
      stream = null;
      $$('.recopts input', ov).forEach((i) => i.disabled = false);
      $('#rm', ov).textContent = e.name === 'NotAllowedError'
        ? 'Microfone bloqueado. Toque no ícone ao lado do endereço do site → Permissões → Microfone → Permitir, e tente de novo.'
        : 'Não consegui acessar o microfone: ' + e.message;
      return;
    }
    const ac = D.ctx(), an = ac.createAnalyser(); an.fftSize = 2048;
    const srcNode = ac.createMediaStreamSource(stream); srcNode.connect(an);
    const d = new Float32Array(an.fftSize), cv = $('#rwv', ov);
    let pkHold = 0, pkT = 0;
    const meter = () => {
      an.getFloatTimeDomainData(d);
      let pk = 0; for (const v of d) pk = Math.max(pk, Math.abs(v));
      const recording = rec?.state === 'recording';
      if (recording) { maxPk = Math.max(maxPk, pk); if (pk >= 0.985 && !clipped) { clipped = true; $('#mclip', ov).hidden = false; } }
      if (pk > pkHold || performance.now() - pkT > 1200) { pkHold = pk; pkT = performance.now(); }
      const pct = (v) => Math.max(0, Math.min(100, (20 * Math.log10(v + 1e-9) + 60) / 60 * 100));
      $('#mbar', ov).style.width = pct(pk) + '%';
      $('#mbar', ov).dataset.lvl = pk > 0.89 ? 'hot' : pk > 0.5 ? 'warm' : '';
      $('#mpk', ov).style.left = pct(pkHold) + '%';
      $('#mdb', ov).textContent = `${db2(pk)} dB`;
      const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
      cv.width = w * dpr; cv.height = h * dpr;
      const x = cv.getContext('2d'); x.scale(dpr, dpr);
      x.strokeStyle = recording ? col().rec : col().muted; x.lineWidth = 2; x.beginPath();
      for (let i = 0; i < d.length; i++) { const X = (i / d.length) * w, Y = (0.5 - d[i] / 2) * h; i ? x.lineTo(X, Y) : x.moveTo(X, Y); }
      x.stroke();
      if (recording) $('#rt', ov).textContent = ((performance.now() - t0) / 1000).toFixed(1) + ' s';
      raf = requestAnimationFrame(meter);
    };
    meter();
    rec = new MediaRecorder(stream, { audioBitsPerSecond: 256000 });
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      srcNode.disconnect(); cleanup();
      if (cancelled) return;
      $('#rm', ov).textContent = 'Salvando…';
      const n = (await all('clips')).length + 1;
      const clip = newClip(`Gravação ${pad2(n)}`, new Blob(chunks, { type: rec.mimeType }));
      try {
        const buf = await decode(clip);
        clip.dur = buf.duration;
        if (opts.trim) { const t = autoTrim(buf); if (t) { clip.edits.start = t.start; clip.edits.end = t.end; } }
      } catch {}
      await put('clips', clip);
      ov.remove();
      editor(clip, { recInfo: clipped ? 'clip' : maxPk < 0.1 ? 'low' : '' });
    };
    const begin = () => {
      rec.start(); t0 = performance.now(); ov.classList.add('on');
      $('#rm', ov).textContent = 'Gravando. Toque de novo para parar.';
    };
    if (opts.cd) {
      let k = 3;
      $('#rt', ov).textContent = k; $('#rm', ov).textContent = 'Prepare-se…';
      cdTimer = setInterval(() => { k--; if (k > 0) $('#rt', ov).textContent = k; else { clearInterval(cdTimer); begin(); } }, 1000);
    } else begin();
  };
}

// ---------- componente: cadeia de efeitos ----------
const GROUPS = [['Limpeza', ['denoise', 'gate']], ['Volume e dinâmica', ['gain', 'comp', 'limiter']], ['Timbre', ['eq', 'lowpass', 'highpass', 'bandpass']], ['Tom e tempo', ['pitch', 'speed', 'tape']], ['Distorção', ['dist', 'crush', 'robot', 'radio']], ['Espaço e movimento', ['echo', 'reverb', 'chorus', 'tremolo']]];
const FXOPTS = GROUPS.map(([g, ks]) => `<optgroup label="${g}">${ks.filter((k) => D.FX[k]).map((k) => `<option value="${k}">${D.FX[k].label}</option>`).join('')}</optgroup>`).join('');
const toSlider = (p, v) => (p.log ? Math.round(1000 * Math.log(v / p.min) / Math.log(p.max / p.min)) : v);
const fromSlider = (p, s) => (p.log ? Math.round(p.min * Math.pow(p.max / p.min, s / 1000)) : +s);
const show = (p, v) => (p.unit === 'Hz' && v >= 1000 ? (v / 1000).toFixed(1) + ' kHz' : `${+(+v).toFixed(2)}${p.unit ? (p.unit.startsWith(':') ? p.unit : ' ' + p.unit) : ''}`);

function chainUI(el, chain, onChange) {
  el.innerHTML = `<div class="chainbox"></div><div class="row add"><select class="addSel" aria-label="Efeito">${FXOPTS}</select><button class="addFx">+ Adicionar</button></div>`;
  const box = $('.chainbox', el);
  const draw = () => {
    if (!chain.length) { box.innerHTML = '<p class="hint">Nenhum efeito. Escolha um abaixo e toque em Adicionar.</p>'; return; }
    box.innerHTML = chain.map((fx, i) => {
      const def = D.FX[fx.type];
      if (!def) return '';
      for (const [k, p] of Object.entries(def.params)) if (fx.params[k] == null) fx.params[k] = p.def;
      return `<div class="fx ${fx.on ? '' : 'off'}" data-i="${i}">
        <div class="fxh">
          <label class="sw"><input type="checkbox" class="on" ${fx.on ? 'checked' : ''} aria-label="Ligar ${def.label}"><span></span></label>
          <b>${def.label}</b>
          <button class="icon sm info" aria-label="Sobre ${def.label}" aria-expanded="false">i</button>
          <button class="icon sm up" aria-label="Subir" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="icon sm dn" aria-label="Descer" ${i === chain.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="icon sm rm" aria-label="Remover">✕</button>
        </div>
        <div class="infobox" hidden><p>${def.info}</p><dl>${Object.values(def.params).map((p) => `<dt>${p.label}</dt><dd>${p.hint || ''}</dd>`).join('')}</dl>${def.tip ? `<p class="tip">${def.tip}</p>` : ''}</div>
        ${Object.entries(def.params).map(([k, p]) => `<label class="prm"><span>${p.label}</span><input type="range" data-k="${k}" min="${p.log ? 0 : p.min}" max="${p.log ? 1000 : p.max}" step="${p.log ? 1 : p.step}" value="${toSlider(p, fx.params[k])}"><output>${show(p, fx.params[k])}</output></label>`).join('')}
      </div>`;
    }).join('');
    $$('.fx', box).forEach((card) => {
      const i = +card.dataset.i, fx = chain[i], def = D.FX[fx.type];
      $('.on', card).onchange = (ev) => { fx.on = ev.target.checked; card.classList.toggle('off', !fx.on); onChange(); };
      $('.info', card).onclick = (ev) => { const b = $('.infobox', card); b.hidden = !b.hidden; ev.currentTarget.setAttribute('aria-expanded', !b.hidden); ev.currentTarget.classList.toggle('is', !b.hidden); };
      $('.up', card).onclick = () => { [chain[i - 1], chain[i]] = [chain[i], chain[i - 1]]; draw(); onChange(); };
      $('.dn', card).onclick = () => { [chain[i + 1], chain[i]] = [chain[i], chain[i + 1]]; draw(); onChange(); };
      $('.rm', card).onclick = () => { chain.splice(i, 1); draw(); onChange(); };
      $$('input[data-k]', card).forEach((inp) => inp.oninput = () => {
        const p = def.params[inp.dataset.k];
        fx.params[inp.dataset.k] = fromSlider(p, +inp.value);
        inp.nextElementSibling.textContent = show(p, fx.params[inp.dataset.k]);
        onChange();
      });
    });
  };
  $('.addFx', el).onclick = () => {
    const type = $('.addSel', el).value;
    chain.push({ type, on: true, params: D.defaultParams(type) });
    draw(); onChange();
    box.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  draw();
  return { redraw: draw };
}

// ---------- editor ----------
const views = new Map(), hists = new Map();

async function editor(clip, opt = {}) {
  stop();
  let orig;
  try { orig = await decode(clip); }
  catch (err) { app.innerHTML = `<div class="empty"><b>Não consegui abrir este som</b><p>${esc(err.message)}</p></div>`; return; }
  const dur = orig.duration;
  const e = clip.edits;
  e.env ||= [];
  if (e.end == null || e.end > dur) e.end = dur;
  clip.tags ||= [];
  const V = views.get(clip.id) || { v0: 0, v1: dur };
  views.set(clip.id, V);
  const snap = () => JSON.stringify({ edits: clip.edits, chain: clip.chain });
  let H = hists.get(clip.id);
  if (!H) { H = { stack: [snap()], i: 0 }; hists.set(clip.id, H); }
  let mode = opt.mode || 'trim', spec = !!opt.spec, loopOn = !!opt.loop, segs = null, envSel = -1, raf;

  app.innerHTML = `
    <header class="top">
      <button class="icon" id="back" aria-label="Voltar">‹</button>
      <input id="cname" class="title-input" value="${esc(clip.name)}" aria-label="Nome do som">
      <button class="icon" id="undo" aria-label="Desfazer">↶</button>
      <button class="icon" id="redo" aria-label="Refazer">↷</button>
    </header>
    ${opt.recInfo === 'clip' ? '<div class="banner warn"><span>A gravação estourou em algum momento. Se soar distorcida, grave de novo mais longe do microfone.</span></div>' : ''}
    ${opt.recInfo === 'low' ? '<div class="banner"><span>A gravação ficou baixa. Use Normalizar ou o Volume padronizado na exportação, ou grave mais perto.</span></div>' : ''}
    <div class="toolbar">
      <div class="seg" role="group" aria-label="Modo"><button data-m="trim">Cortar</button><button data-m="env">Volume</button></div>
      <button class="tbtn" id="specBtn" aria-pressed="${spec}">Espectro</button>
    </div>
    <div class="wavebox"><canvas id="wv" aria-label="Forma de onda"></canvas></div>
    <div class="zoomrow">
      <span class="hint" id="wvHint"></span>
      <button class="icon sm" id="zOut" aria-label="Afastar">−</button>
      <button class="icon sm" id="zIn" aria-label="Aproximar">+</button>
      <button class="tbtn sm" id="zSel">Seleção</button>
      <button class="tbtn sm" id="zAll">Tudo</button>
    </div>
    <div class="times" id="times"></div>
    <div class="envtools" id="envTools" hidden>
      <span id="envInfo" class="hint">Toque na onda para criar pontos. Arraste para cima ou para baixo.</span>
      <button class="tbtn sm" id="envDel" disabled>Apagar ponto</button>
      <button class="tbtn sm" id="envClr">Limpar</button>
    </div>
    <div class="transport">
      <button id="pO">▶ Original</button>
      <button id="pF" class="primary">▶ Com efeitos</button>
      <button id="pL" class="icon" aria-label="Repetir em loop" aria-pressed="${loopOn}">⟳</button>
      <button id="pS" class="icon" aria-label="Parar">■</button>
    </div>
    <div class="outbox"><canvas id="wo"></canvas><span id="fxState" class="hint">Toque em "Com efeitos" para ouvir. Com o loop ligado, os ajustes tocam na hora.</span></div>

    <section><h2>Edição</h2>
      <div class="toggles">
        <label class="check"><input type="checkbox" id="rev" ${e.reverse ? 'checked' : ''}> Reverter</label>
        <label class="check"><input type="checkbox" id="nor" ${e.normalize ? 'checked' : ''}> Normalizar volume</label>
        <label class="check"><input type="checkbox" id="lp" ${e.loop ? 'checked' : ''}> Som em loop (Godot)</label>
      </div>
      <p class="hint" id="lpHint" ${e.loop ? '' : 'hidden'}>O WAV sai marcado como loop. No Godot, mantenha "Loop Mode" em "Detect From WAV" na importação. Para OGG, ligue "Loop" na importação.</p>
      <label class="prm"><span>Fade in</span><input type="range" id="fi" min="0" max="2000" step="5" value="${e.fadeIn}"><output>${e.fadeIn} ms</output></label>
      <label class="prm"><span>Fade out</span><input type="range" id="fo" min="0" max="2000" step="5" value="${e.fadeOut}"><output>${e.fadeOut} ms</output></label>
      <div class="row wrap">
        <button class="ghost" id="autoTrim">Cortar silêncio</button>
        <button class="ghost" id="resetTrim">Desfazer corte</button>
      </div>
      <label class="field">Tags <input id="tags" value="${esc(clip.tags.join(', '))}" placeholder="ex.: passos, floresta" autocomplete="off"></label>
    </section>

    <section><h2>Efeitos <small>aplicados de cima para baixo</small></h2><div id="chain"></div></section>

    <section><h2>Presets</h2>
      <div class="row"><select id="preSel" aria-label="Preset"></select><button id="preApply">Aplicar</button></div>
      <div class="row"><input id="preName" placeholder="Nome do novo preset" autocomplete="off"><button id="preSave">Salvar</button></div>
      <p class="hint" id="preMsg">O preset guarda a lista de efeitos e seus ajustes.</p>
      <details><summary>Gerenciar presets</summary><div id="preList"></div></details>
    </section>

    <section><h2>Ferramentas</h2>
      <details id="splitBox"><summary>Dividir pelos silêncios</summary>
        <p class="hint">Grave vários sons seguidos (ex.: 10 passos) e o app separa cada um num som próprio, com os mesmos efeitos. Usa o trecho selecionado; o original continua igual.</p>
        <label class="prm"><span>Sensibilidade</span><input type="range" id="spThr" min="-60" max="-12" step="1" value="-35"><output>-35 dB</output></label>
        <p class="hint">Mais negativo pega sons mais baixos; menos negativo ignora ruído de fundo.</p>
        <label class="prm"><span>Silêncio mínimo</span><input type="range" id="spGap" min="40" max="1500" step="10" value="200"><output>200 ms</output></label>
        <p class="hint">Pausa necessária entre dois sons para separá-los.</p>
        <button class="primary" id="spGo" disabled>Criar sons</button>
        <p class="msg" id="spMsg" role="status"></p>
      </details>
      <details id="varBox"><summary>Gerar variações</summary>
        <p class="hint">Cria cópias com pequenas diferenças de tom e volume, para passos, golpes e tiros não soarem repetidos. No Godot, use um AudioStreamRandomizer com todas elas.</p>
        <label class="prm"><span>Quantidade</span><input type="range" id="vN" min="2" max="20" step="1" value="5"><output>5</output></label>
        <label class="prm"><span>Tom ±</span><input type="range" id="vP" min="0" max="6" step="0.1" value="1"><output>1 st</output></label>
        <label class="prm"><span>Volume ±</span><input type="range" id="vV" min="0" max="6" step="0.5" value="2"><output>2 dB</output></label>
        <button class="primary" id="vGo">Gerar variações</button>
        <p class="msg" id="vMsg" role="status"></p>
      </details>
    </section>

    <section><h2>Exportar</h2>${exportPanel('eexp')}</section>

    <section class="danger-zone">
      <button class="ghost" id="dup">Duplicar som</button>
      <button class="ghost danger" id="delC">Apagar som</button>
    </section>`;

  // ----- estado, histórico e salvamento -----
  let saveT, commitT, liveT;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { clip.dur = dur; put('clips', clip); }, 300); };
  const updUndo = () => { $('#undo').disabled = H.i <= 0; $('#redo').disabled = H.i >= H.stack.length - 1; };
  const commitNow = () => {
    clearTimeout(commitT); commitT = null;
    const s = snap();
    if (s !== H.stack[H.i]) { H.stack.splice(H.i + 1); H.stack.push(s); if (H.stack.length > 100) H.stack.shift(); H.i = H.stack.length - 1; }
    updUndo();
  };
  const commit = () => { clearTimeout(commitT); commitT = setTimeout(commitNow, 450); $('#undo').disabled = false; };
  const rerender = (extra = {}) => { const y = scrollY; editor(clip, { mode, spec, loop: loopOn, ...extra }).then(() => scrollTo(0, y)); };
  const restore = (k) => { const o = JSON.parse(H.stack[k]); clip.edits = o.edits; clip.chain = o.chain; H.i = k; put('clips', clip); rerender(); };
  $('#undo').onclick = () => { if (commitT) commitNow(); if (H.i > 0) restore(H.i - 1); };
  $('#redo').onclick = () => { if (H.i < H.stack.length - 1) restore(H.i + 1); };
  updUndo();

  const live = () => {
    clearTimeout(liveT);
    if (!playing || playing.tag !== 'fx') { $('#fxState').textContent = 'Toque em "Com efeitos" para ouvir as mudanças.'; return; }
    liveT = setTimeout(async () => {
      if (!playing || playing.tag !== 'fx') return;
      const pos = playPos();
      try { const b = await processed(clip); if (playing?.tag === 'fx') { showOut(b); playFx(b, pos); } } catch {}
    }, 220);
  };
  const dirty = () => { save(); commit(); live(); };

  $('#back').onclick = () => { stop(); if (commitT) commitNow(); render(); };
  $('#cname').oninput = (ev) => { clip.name = ev.target.value || 'Sem nome'; save(); };
  $('#tags').onchange = (ev) => { clip.tags = [...new Set(ev.target.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))]; ev.target.value = clip.tags.join(', '); save(); };

  // ----- forma de onda -----
  const wv = $('#wv'), minSpan = Math.min(dur, 0.02);
  const clampV = () => {
    let s = Math.max(minSpan, Math.min(dur, V.v1 - V.v0));
    V.v0 = Math.max(0, Math.min(dur - s, V.v0)); V.v1 = V.v0 + s;
  };
  const zoomed = () => V.v1 - V.v0 < dur - 1e-6;
  const tToX = (t) => ((t - V.v0) / (V.v1 - V.v0)) * wv.clientWidth;
  const xToT = (cx) => Math.max(0, Math.min(dur, V.v0 + ((cx - wv.getBoundingClientRect().left) / wv.clientWidth) * (V.v1 - V.v0)));
  const redraw = () => {
    if (!wv.isConnected) return;
    const pos = playing && playing.tag === 'orig' ? playPos() : null;
    drawWave(wv, orig, { v0: V.v0, v1: V.v1, start: e.start, end: e.end, pos, spec, segs, ruler: true, dur, handles: mode === 'trim', env: mode === 'env' ? e.env : null, envSel });
    $('#times').innerHTML = `<span>Início ${fmt(e.start)}</span><span>Duração ${fmt(e.end - e.start)}</span><span>Fim ${fmt(e.end)}</span>`;
    if (mode === 'env') {
      const p = e.env[envSel];
      $('#envInfo').textContent = p ? `Ponto: ${db2(p.g)} dB em ${fmt(e.start + p.t * (e.end - e.start))}` : e.env.length ? 'Toque num ponto para selecionar, ou na onda para criar outro.' : 'Toque na onda para criar pontos. Arraste para cima ou para baixo.';
      $('#envDel').disabled = !p;
    }
  };
  const anim = () => { redraw(); if (playing) raf = requestAnimationFrame(anim); else redraw(); };
  const startAnim = () => { cancelAnimationFrame(raf); anim(); };
  const setMode = (m) => {
    mode = m; envSel = -1;
    $$('.seg button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.m === m));
    $('#envTools').hidden = m !== 'env';
    $('#wvHint').textContent = m === 'env' ? 'Pinça: zoom' : 'Alças: cortar · toque: ouvir · pinça: zoom';
    redraw();
  };
  $$('.seg button').forEach((b) => b.onclick = () => setMode(b.dataset.m));
  $('#specBtn').onclick = (ev) => { spec = !spec; ev.currentTarget.setAttribute('aria-pressed', spec); redraw(); };
  const zoomBy = (f) => {
    const c = playing?.tag === 'orig' ? playPos() : (V.v0 + V.v1) / 2, s = Math.max(minSpan, Math.min(dur, (V.v1 - V.v0) * f));
    V.v0 = c - s / 2; V.v1 = c + s / 2; clampV(); redraw();
  };
  $('#zIn').onclick = () => zoomBy(0.5);
  $('#zOut').onclick = () => zoomBy(2);
  $('#zSel').onclick = () => { const m = (e.end - e.start) * 0.05; V.v0 = e.start - m; V.v1 = e.end + m; clampV(); redraw(); };
  $('#zAll').onclick = () => { V.v0 = 0; V.v1 = dur; redraw(); };
  new ResizeObserver(redraw).observe(wv);
  setMode(mode);

  const ptrs = new Map();
  let g = null;
  const envPt = (p) => [tToX(e.start + p.t * (e.end - e.start)), wv.clientHeight * (1 - p.g / 2)];
  wv.onpointerdown = (ev) => {
    wv.setPointerCapture(ev.pointerId);
    ptrs.set(ev.pointerId, ev.clientX);
    if (ptrs.size === 2) {
      const xs = [...ptrs.values()], cx = (xs[0] + xs[1]) / 2;
      g = { type: 'pinch', d0: Math.max(10, Math.abs(xs[0] - xs[1])), s0: V.v1 - V.v0, tc: xToT(cx) };
      return;
    }
    if (ptrs.size > 2) return;
    const r = wv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    if (mode === 'trim') {
      const ds = Math.abs(x - tToX(e.start)), de = Math.abs(x - tToX(e.end));
      if (Math.min(ds, de) < 30) { g = { type: 'handle', which: ds <= de ? 'start' : 'end' }; return; }
    } else {
      const hit = e.env.findIndex((p) => { const [px, py] = envPt(p); return Math.hypot(px - x, py - y) < 26; });
      if (hit >= 0) { envSel = hit; g = { type: 'pt', i: hit }; redraw(); return; }
    }
    g = { type: 'pan', x0: ev.clientX, v0: V.v0, moved: false };
  };
  wv.onpointermove = (ev) => {
    if (!ptrs.has(ev.pointerId) || !g) return;
    ptrs.set(ev.pointerId, ev.clientX);
    const r = wv.getBoundingClientRect(), w = wv.clientWidth;
    if (g.type === 'pinch') {
      if (ptrs.size < 2) return;
      const xs = [...ptrs.values()], d = Math.max(10, Math.abs(xs[0] - xs[1])), cx = (xs[0] + xs[1]) / 2 - r.left;
      const s = Math.max(minSpan, Math.min(dur, g.s0 * g.d0 / d));
      V.v0 = g.tc - (cx / w) * s; V.v1 = V.v0 + s; clampV(); redraw();
    } else if (g.type === 'handle') {
      const t = xToT(ev.clientX), m = 0.005;
      if (g.which === 'start') e.start = Math.min(t, e.end - m); else e.end = Math.max(t, e.start + m);
      redraw();
    } else if (g.type === 'pt') {
      const p = e.env[g.i], prev = e.env[g.i - 1], next = e.env[g.i + 1];
      let t = (xToT(ev.clientX) - e.start) / (e.end - e.start);
      t = Math.max(prev ? prev.t + 0.001 : 0, Math.min(next ? next.t - 0.001 : 1, t));
      p.t = t; p.g = Math.max(0, Math.min(2, 2 * (1 - (ev.clientY - r.top) / wv.clientHeight)));
      if (Math.abs(p.g - 1) < 0.04) p.g = 1;
      redraw();
    } else if (g.type === 'pan') {
      const dx = ev.clientX - g.x0;
      if (Math.abs(dx) > 8) g.moved = true;
      if (!g.moved) return;
      if (zoomed()) { const s = V.v1 - V.v0; V.v0 = g.v0 - (dx / w) * s; V.v1 = V.v0 + s; clampV(); redraw(); }
      else if (mode === 'trim') {
        const t0 = xToT(g.x0);
        g.type = 'handle'; g.which = Math.abs(t0 - e.start) <= Math.abs(t0 - e.end) ? 'start' : 'end';
        wv.onpointermove(ev);
      }
    }
  };
  const up = (ev) => {
    ptrs.delete(ev.pointerId);
    if (!g) return;
    const t = g.type;
    if (t === 'pinch') { if (!ptrs.size) g = null; else g = { type: 'none' }; return; }
    if (ptrs.size) return;
    if (t === 'handle' || t === 'pt') { segs = null; dirty(); }
    else if (t === 'pan' && !g.moved && ev.type === 'pointerup') {
      const tt = xToT(ev.clientX);
      if (mode === 'env') {
        if (tt >= e.start && tt <= e.end) {
          const r = wv.getBoundingClientRect();
          const p = { t: (tt - e.start) / (e.end - e.start), g: Math.max(0, Math.min(2, 2 * (1 - (ev.clientY - r.top) / wv.clientHeight))) };
          e.env.push(p); e.env.sort((a, b) => a.t - b.t); envSel = e.env.indexOf(p); dirty();
        } else envSel = -1;
        redraw();
      } else {
        const inSel = tt >= e.start && tt < e.end;
        play(orig, { from: tt, to: inSel ? e.end : dur, tag: 'orig', onEnd: redraw });
        startAnim();
      }
    }
    g = null;
  };
  wv.onpointerup = up; wv.onpointercancel = up;
  $('#envDel').onclick = () => { if (envSel >= 0) { e.env.splice(envSel, 1); envSel = -1; dirty(); redraw(); } };
  $('#envClr').onclick = () => { e.env.length = 0; envSel = -1; dirty(); redraw(); };
  $('#resetTrim').onclick = () => { e.start = 0; e.end = dur; segs = null; redraw(); dirty(); };
  $('#autoTrim').onclick = (ev) => {
    const t = autoTrim(orig);
    if (!t) { ev.target.textContent = 'Não achei som'; return; }
    e.start = t.start; e.end = t.end; redraw(); dirty();
  };

  // ----- reprodução -----
  const out = $('#wo');
  const showOut = (b) => {
    drawWave(out, b, { color: col().accent });
    const lu = D.loudness(b);
    const pk = D.peakOf(b);
    $('#fxState').textContent = `${fmt(b.duration)} · pico ${db2(pk)} dB${isFinite(lu) ? ` · ${lu.toFixed(1)} LUFS` : ''}${loopOn && playing?.tag === 'fx' ? ' · ao vivo' : ''}${pk > 1 ? ' · vai estourar: adicione o Limitador no fim' : ''}`;
    $('#fxState').classList.toggle('bad', pk > 1);
  };
  const playFx = (b, from = 0) => {
    play(b, { from: from || 0, loop: loopOn, tag: 'fx', onEnd: () => { drawWave(out, b, { color: col().accent }); } });
    const tickOut = () => { if (playing?.tag === 'fx' && playing.buf === b && out.isConnected) { drawWave(out, b, { color: col().accent, pos: playPos() }); requestAnimationFrame(tickOut); } };
    tickOut();
  };
  $('#pO').onclick = () => {
    play(orig, loopOn ? { from: e.start, loop: true, loopStart: e.start, loopEnd: e.end, tag: 'orig', onEnd: redraw } : { from: e.start, to: e.end, tag: 'orig', onEnd: redraw });
    startAnim();
  };
  $('#pF').onclick = async () => {
    $('#fxState').textContent = 'Processando…';
    try { const b = await processed(clip); playFx(b); showOut(b); }
    catch (err) { $('#fxState').textContent = 'Erro ao processar: ' + err.message; }
  };
  $('#pL').onclick = (ev) => {
    loopOn = !loopOn; ev.currentTarget.setAttribute('aria-pressed', loopOn);
    const tag = playing?.tag;
    if (tag === 'orig') $('#pO').click(); else if (tag === 'fx') $('#pF').click();
  };
  $('#pS').onclick = () => { stop(); redraw(); };

  // ----- edição -----
  $('#rev').onchange = (ev) => { e.reverse = ev.target.checked; dirty(); };
  $('#nor').onchange = (ev) => { e.normalize = ev.target.checked; dirty(); };
  $('#lp').onchange = (ev) => { e.loop = ev.target.checked; $('#lpHint').hidden = !e.loop; save(); commit(); };
  for (const id of ['fi', 'fo']) $('#' + id).oninput = (ev) => {
    e[id === 'fi' ? 'fadeIn' : 'fadeOut'] = +ev.target.value;
    ev.target.nextElementSibling.textContent = ev.target.value + ' ms';
    dirty();
  };

  // ----- efeitos e presets -----
  const chainCtl = chainUI($('#chain'), clip.chain, dirty);
  const drawPresets = async () => {
    const ps = (await all('presets')).sort((a, b) => a.name.localeCompare(b.name));
    if (!$('#preSel')) return;
    $('#preSel').innerHTML = ps.length ? ps.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('') : '<option value="">Nenhum preset salvo</option>';
    $('#preApply').disabled = !ps.length;
    $('#preList').innerHTML = ps.length ? ps.map((p) => `<div class="row" data-id="${p.id}"><input value="${esc(p.name)}" aria-label="Nome do preset"><button class="ren">Renomear</button><button class="ghost danger delp">Apagar</button></div>`).join('') : '<p class="hint">Você ainda não salvou presets.</p>';
    $$('#preList .row').forEach((row) => {
      const p = ps.find((x) => x.id === row.dataset.id);
      $('.ren', row).onclick = async () => { p.name = $('input', row).value.trim() || p.name; await put('presets', p); drawPresets(); };
      $('.delp', row).onclick = async (ev) => {
        if (ev.target.dataset.c) { await del('presets', p.id); drawPresets(); }
        else { ev.target.dataset.c = 1; ev.target.textContent = 'Confirmar'; }
      };
    });
    $('#preApply').onclick = () => {
      const p = ps.find((x) => x.id === $('#preSel').value);
      if (!p) return;
      clip.chain.splice(0, clip.chain.length, ...clone(p.chain));
      chainCtl.redraw(); dirty();
      $('#preMsg').textContent = `Preset "${p.name}" aplicado.`;
    };
  };
  drawPresets();
  $('#preSave').onclick = async () => {
    const name = $('#preName').value.trim();
    if (!name) { $('#preMsg').textContent = 'Digite um nome para o preset.'; return; }
    if (!clip.chain.length) { $('#preMsg').textContent = 'Adicione pelo menos um efeito antes de salvar.'; return; }
    const ps = await all('presets');
    const ex = ps.find((p) => p.name.toLowerCase() === name.toLowerCase());
    await put('presets', { id: ex?.id || uid(), name, chain: clone(clip.chain) });
    $('#preName').value = '';
    $('#preMsg').textContent = ex ? `Preset "${name}" atualizado.` : `Preset "${name}" salvo.`;
    drawPresets();
  };

  // ----- ferramentas -----
  const derived = (name, edits, chain) => ({ ...newClip(name, clip.blob), dur, tags: [...clip.tags], edits, chain });
  const goLib = (ids, msgEl, text) => {
    selected = new Set(ids);
    msgEl.innerHTML = `${text} <button class="primary" id="goLib">Ver na Biblioteca para exportar</button>`;
    $('#goLib', msgEl).onclick = () => nav('lib');
  };
  const analyze = async () => {
    const thr = +$('#spThr').value, gap = +$('#spGap').value;
    const part = await D.renderClip(orig, { start: e.start, end: e.end }, []);
    segs = D.detectSegments(part, { thrDb: thr, minSilMs: gap }).map((s) => ({ start: s.start + e.start, end: s.end + e.start }));
    $('#spMsg').textContent = segs.length ? `${segs.length} som(ns) encontrado(s), marcados em verde na onda.` : 'Nenhum som encontrado. Deixe a sensibilidade mais negativa.';
    $('#spGo').disabled = segs.length < 1;
    $('#spGo').textContent = `Criar ${segs.length} som(ns)`;
    redraw();
  };
  $('#splitBox').ontoggle = () => { if ($('#splitBox').open) analyze(); else { segs = null; redraw(); } };
  for (const [id, u] of [['spThr', ' dB'], ['spGap', ' ms']]) $('#' + id).oninput = (ev) => { ev.target.nextElementSibling.textContent = ev.target.value + u; clearTimeout(analyze.t); analyze.t = setTimeout(analyze, 200); };
  $('#spGo').onclick = async () => {
    if (!segs?.length) return;
    const ids = [];
    for (const [i, s] of segs.entries()) {
      const c = derived(`${clip.name}_${pad2(i + 1)}`, { ...clone(e), start: s.start, end: s.end, env: [], fadeIn: Math.max(e.fadeIn, 3), fadeOut: Math.max(e.fadeOut, 15) }, clone(clip.chain));
      c.created = Date.now() + i;
      await put('clips', c); ids.push(c.id);
    }
    goLib(ids, $('#spMsg'), `${ids.length} sons criados e selecionados.`);
  };
  for (const [id, u] of [['vN', ''], ['vP', ' st'], ['vV', ' dB']]) $('#' + id).oninput = (ev) => { ev.target.nextElementSibling.textContent = ev.target.value + u; };
  $('#vGo').onclick = async () => {
    const n = +$('#vN').value, pr = +$('#vP').value, vr = +$('#vV').value, ids = [];
    const pitches = Array.from({ length: n }, (_, i) => (n > 1 ? -pr + (2 * pr * i) / (n - 1) : 0) + (Math.random() - 0.5) * pr / Math.max(1, n - 1)).sort(() => Math.random() - 0.5);
    for (let i = 0; i < n; i++) {
      const st = pitches[i], dbv = (Math.random() * 2 - 1) * vr;
      const chain = [...clone(clip.chain), { type: 'tape', on: true, params: { rate: +Math.pow(2, st / 12).toFixed(4) } }, { type: 'gain', on: true, params: { db: +dbv.toFixed(1) } }];
      const c = derived(`${clip.name}_v${pad2(i + 1)}`, clone(e), chain);
      c.created = Date.now() + i;
      await put('clips', c); ids.push(c.id);
    }
    goLib(ids, $('#vMsg'), `${n} variações criadas e selecionadas.`);
  };

  bindExport($('#eexp'), async () => [{ buf: await processed(clip), name: clip.name, loop: e.loop }]);

  $('#dup').onclick = async () => {
    const c = { ...clone({ ...clip, blob: null }), id: uid(), name: clip.name + ' (cópia)', created: Date.now(), blob: clip.blob };
    await put('clips', c);
    editor(c);
  };
  $('#delC').onclick = async (ev) => {
    if (!ev.target.dataset.c) { ev.target.dataset.c = 1; ev.target.textContent = 'Toque de novo para apagar'; return; }
    stop();
    clearTimeout(saveT);
    await del('clips', clip.id);
    selected.delete(clip.id); hists.delete(clip.id); views.delete(clip.id);
    render();
  };
}

// ---------- mixagens ----------
async function mixList() {
  const mixes = (await all('mixes')).sort((a, b) => b.created - a.created);
  app.innerHTML = `
    <header class="top"><h1>Mixagens</h1></header>
    <p class="hint lead">Junte vários sons em camadas, cada um começando no momento certo e com seus próprios efeitos. O resultado sai como um único arquivo.</p>
    <button class="primary wide" id="newMix">+ Nova mixagem</button>
    ${mixes.length ? '' : '<div class="empty"><b>Nenhuma mixagem ainda</b><p>Exemplo: uma explosão feita de estouro + grave + estilhaços.</p></div>'}
    <ul class="list">${mixes.map((m) => `<li data-id="${m.id}"><button class="open"><span class="nm">${esc(m.name)}</span><small>${m.tracks.length} camada(s)</small></button></li>`).join('')}</ul>`;
  $('#newMix').onclick = async () => {
    const m = { id: uid(), name: `Mixagem ${pad2(mixes.length + 1)}`, created: Date.now(), tracks: [], limit: true };
    await put('mixes', m);
    mixEditor(m);
  };
  $$('.list li').forEach((li) => $('.open', li).onclick = () => mixEditor(mixes.find((m) => m.id === li.dataset.id)));
}

async function mixEditor(mix) {
  stop();
  const clips = (await all('clips')).sort((a, b) => a.name.localeCompare(b.name));
  const byId = Object.fromEntries(clips.map((c) => [c.id, c]));
  const tb = new Map();
  mix.tracks.forEach((t) => { t.chain ||= []; });
  const trackBuf = async (t) => {
    const c = byId[t.clipId]; if (!c) return null;
    const key = clipKey(c) + JSON.stringify(t.chain), hit = tb.get(t.id);
    if (hit && hit.key === key) return hit.buf;
    let b = await processed(c);
    if (t.chain.some((f) => f.on)) b = await D.renderClip(b, { start: 0, end: null }, t.chain);
    tb.set(t.id, { key, buf: b });
    return b;
  };
  const bufOf = (t) => tb.get(t.id)?.buf;
  app.innerHTML = `<div class="empty"><b>Carregando sons…</b></div>`;
  for (const t of mix.tracks) await trackBuf(t);
  let saveT;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => put('mixes', mix), 300); };
  const items = () => {
    const solo = mix.tracks.some((t) => t.solo);
    return mix.tracks.filter((t) => bufOf(t) && !t.mute && (!solo || t.solo)).map((t) => ({ buf: bufOf(t), offset: t.offset, vol: t.vol, pan: t.pan }));
  };
  const master = async () => { const it = items(); if (!it.length) return null; let b = await D.renderMix(it); if (mix.limit !== false) b = D.limit(b, -1, 60); return b; };

  app.innerHTML = `
    <header class="top"><button class="icon" id="back" aria-label="Voltar">‹</button><input id="mname" class="title-input" value="${esc(mix.name)}" aria-label="Nome da mixagem"></header>
    <div class="tlbox"><canvas id="tl" aria-label="Linha do tempo. Arraste os blocos para mudar o início."></canvas></div>
    <div class="transport two"><button id="mp" class="primary">▶ Ouvir mixagem</button><button id="ms" class="icon" aria-label="Parar">■</button></div>
    <p class="hint" id="mInfo"></p>
    <section><h2>Camadas</h2><div id="tracks"></div>
      ${clips.length ? `<div class="row add"><select id="addClip" aria-label="Som">${clips.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><button id="addT">+ Camada</button></div>` : '<p class="hint">Grave ou importe sons na Biblioteca primeiro.</p>'}
    </section>
    <section><h2>Master</h2>
      <label class="check"><input type="checkbox" id="mlim" ${mix.limit !== false ? 'checked' : ''}> Limitador no resultado final</label>
      <p class="hint">Segura a soma das camadas abaixo de -1 dB, evitando estouro quando vários sons tocam juntos.</p>
    </section>
    <section><h2>Exportar</h2>${exportPanel('mexp')}
      <button class="ghost" id="toClip">Salvar como som na Biblioteca</button><p class="hint" id="tcMsg"></p></section>
    <section class="danger-zone"><button class="ghost danger" id="delM">Apagar mixagem</button></section>`;

  $('#back').onclick = () => { stop(); render(); };
  $('#mname').oninput = (ev) => { mix.name = ev.target.value || 'Sem nome'; save(); };
  $('#mlim').onchange = (ev) => { mix.limit = ev.target.checked; save(); };

  const tl = $('#tl');
  const COLORS = ['--accent', '--wave', '--c3', '--c4', '--c5'];
  let scale = 1, mixBuf = null, raf;
  const total = () => Math.max(2, ...mix.tracks.map((t) => (bufOf(t) ? t.offset + bufOf(t).duration : 0))) * 1.15;
  const cssv = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const drawTL = () => {
    if (!tl.isConnected) return;
    const rowH = 34, h = Math.max(1, mix.tracks.length) * rowH + 22;
    tl.style.height = h + 'px';
    const dpr = devicePixelRatio || 1, w = tl.clientWidth;
    tl.width = w * dpr; tl.height = h * dpr;
    const x = tl.getContext('2d'); x.scale(dpr, dpr);
    const T = total(); scale = w / T;
    x.fillStyle = cssv('--muted'); x.font = '11px system-ui';
    const stepS = T > 20 ? 5 : T > 8 ? 2 : T > 4 ? 1 : 0.5;
    for (let s = 0; s < T; s += stepS) { x.fillRect(s * scale, 0, 1, 6); x.fillText(s + 's', s * scale + 3, 12); }
    mix.tracks.forEach((t, i) => {
      const b = bufOf(t); if (!b) return;
      const y = 20 + i * rowH, bx = t.offset * scale, bw = Math.max(4, b.duration * scale);
      x.globalAlpha = t.mute ? 0.3 : 1;
      x.fillStyle = cssv(COLORS[i % COLORS.length]);
      x.fillRect(bx, y, bw, rowH - 6);
      x.fillStyle = cssv('--bg');
      x.fillText(byId[t.clipId].name + (t.chain.some((f) => f.on) ? ' · fx' : ''), bx + 6, y + 18, bw - 10);
      x.globalAlpha = 1;
    });
    const pos = playing && playing.buf === mixBuf ? playPos() : null;
    if (pos != null) { x.fillStyle = cssv('--fg'); x.fillRect(pos * scale, 0, 2, h); }
  };
  new ResizeObserver(drawTL).observe(tl);
  let dragT = null;
  tl.onpointerdown = (ev) => {
    const r = tl.getBoundingClientRect(), i = Math.floor((ev.clientY - r.top - 20) / 34), t = mix.tracks[i];
    if (!t) return;
    dragT = { t, x0: ev.clientX, o0: t.offset };
    tl.setPointerCapture(ev.pointerId);
  };
  tl.onpointermove = (ev) => {
    if (!dragT) return;
    dragT.t.offset = Math.max(0, Math.round((dragT.o0 + (ev.clientX - dragT.x0) / scale) * 100) / 100);
    drawTL();
    const card = $(`#tracks .fx[data-i="${mix.tracks.indexOf(dragT.t)}"]`);
    if (card) { const inp = $('[data-k=offset]', card); inp.max = Math.max(+inp.max, Math.ceil(dragT.t.offset + 1)); inp.value = dragT.t.offset; inp.nextElementSibling.textContent = fmt(dragT.t.offset); }
  };
  tl.onpointerup = tl.onpointercancel = () => { if (dragT) { dragT = null; save(); } };

  const panTxt = (v) => (v == 0 ? 'centro' : v < 0 ? 'E ' + Math.round(-v * 100) : 'D ' + Math.round(v * 100));
  const openFx = (t) => {
    const ov = document.createElement('div');
    ov.className = 'ovl sheet';
    ov.innerHTML = `<div class="sheetbox"><header class="top"><b class="sheet-t">Efeitos: ${esc(byId[t.clipId]?.name || '')}</b><button class="primary" id="shClose">Pronto</button></header><p class="hint">Estes efeitos valem só para esta camada.</p><div id="shChain"></div></div>`;
    document.body.appendChild(ov);
    chainUI($('#shChain', ov), t.chain, save);
    $('#shClose', ov).onclick = async () => { ov.remove(); await trackBuf(t); drawTracks(); };
  };
  const drawTracks = () => {
    const el = $('#tracks');
    if (!mix.tracks.length) { el.innerHTML = '<p class="hint">Nenhuma camada. Escolha um som abaixo.</p>'; drawTL(); return; }
    el.innerHTML = mix.tracks.map((t, i) => {
      const c = byId[t.clipId], n = t.chain.filter((f) => f.on).length;
      return `<div class="fx ${t.mute ? 'off' : ''}" data-i="${i}">
        <div class="fxh"><span class="chip" style="background:var(${COLORS[i % COLORS.length]})"></span><b>${c ? esc(c.name) : 'Som apagado'}</b>
          <button class="tog ${t.mute ? 'is' : ''}" data-a="mute" aria-label="Mudo">M</button><button class="tog ${t.solo ? 'is' : ''}" data-a="solo" aria-label="Solo">S</button>
          <button class="icon sm rm" aria-label="Remover camada">✕</button></div>
        <label class="prm"><span>Início</span><input type="range" data-k="offset" min="0" max="${Math.max(10, Math.ceil(t.offset + 2))}" step="0.01" value="${t.offset}"><output>${fmt(t.offset)}</output></label>
        <label class="prm"><span>Volume</span><input type="range" data-k="vol" min="0" max="1.5" step="0.01" value="${t.vol}"><output>${Math.round(t.vol * 100)}%</output></label>
        <label class="prm"><span>Pan</span><input type="range" data-k="pan" min="-1" max="1" step="0.05" value="${t.pan}"><output>${panTxt(t.pan)}</output></label>
        <button class="ghost fxbtn">Efeitos da camada${n ? ` (${n})` : ''}</button>
      </div>`;
    }).join('');
    $$('.fx', el).forEach((card) => {
      const t = mix.tracks[+card.dataset.i];
      $$('input[data-k]', card).forEach((inp) => inp.oninput = () => {
        const k = inp.dataset.k, v = +inp.value; t[k] = v;
        inp.nextElementSibling.textContent = k === 'offset' ? fmt(v) : k === 'vol' ? Math.round(v * 100) + '%' : panTxt(v);
        drawTL(); save();
      });
      $$('.tog', card).forEach((b) => b.onclick = () => { t[b.dataset.a] = !t[b.dataset.a]; drawTracks(); save(); });
      $('.rm', card).onclick = () => { mix.tracks.splice(+card.dataset.i, 1); drawTracks(); save(); };
      $('.fxbtn', card).onclick = () => openFx(t);
    });
    drawTL();
  };
  drawTracks();
  if (clips.length) $('#addT').onclick = async () => {
    const t = { id: uid(), clipId: $('#addClip').value, offset: 0, vol: 1, pan: 0, mute: false, solo: false, chain: [] };
    await trackBuf(t);
    mix.tracks.push(t);
    drawTracks(); save();
  };

  const anim = () => { drawTL(); if (playing && playing.buf === mixBuf) raf = requestAnimationFrame(anim); };
  $('#mp').onclick = async () => {
    $('#mInfo').textContent = 'Mixando…';
    mixBuf = await master();
    if (!mixBuf) { $('#mInfo').textContent = 'Adicione pelo menos uma camada.'; return; }
    const lu = D.loudness(mixBuf);
    $('#mInfo').textContent = `${fmt(mixBuf.duration)} · pico ${db2(D.peakOf(mixBuf))} dB${isFinite(lu) ? ` · ${lu.toFixed(1)} LUFS` : ''}`;
    play(mixBuf, { onEnd: drawTL });
    cancelAnimationFrame(raf); anim();
  };
  $('#ms').onclick = () => { stop(); drawTL(); };
  bindExport($('#mexp'), async () => { const b = await master(); return b ? [{ buf: b, name: mix.name }] : []; });
  $('#toClip').onclick = async () => {
    const b = await master();
    if (!b) { $('#tcMsg').textContent = 'Adicione pelo menos uma camada.'; return; }
    const clip = newClip(mix.name, D.encodeWav(b));
    clip.dur = b.duration;
    await put('clips', clip);
    $('#tcMsg').textContent = `Salvo na Biblioteca como "${mix.name}". Lá você pode aplicar efeitos no conjunto.`;
  };
  $('#delM').onclick = async (ev) => {
    if (!ev.target.dataset.c) { ev.target.dataset.c = 1; ev.target.textContent = 'Toque de novo para apagar'; return; }
    stop(); await del('mixes', mix.id); render();
  };
}

render();
