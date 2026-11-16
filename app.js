import * as D from './dsp.js';
import { ic } from './icons.js';
import * as G from './sfxr.js';

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

// ---------- preferências: tema e vibração ----------
const settings = { theme: 'dark', vib: true, ...store.get('settings', {}) };
let C;
function applyTheme() {
  document.documentElement.dataset.theme = settings.theme;
  C = null;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  $('meta[name=theme-color]')?.setAttribute('content', bg || '#101217');
}
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => { applyTheme(); });
document.addEventListener('click', (e) => { if (settings.vib && e.target.closest('button, .btn, .sw, .check')) navigator.vibrate?.(8); }, true);

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
const baseOf = async (clip) => D.applyOps(await decode(clip), clip.edits?.ops);
const clipKey = (clip) => JSON.stringify([clip.edits, clip.chain]);
async function processed(clip, chain = clip.chain) {
  const key = JSON.stringify([clip.edits, chain]), id = clip.id + (chain === clip.chain ? '' : '#v');
  const c = pcache.get(id);
  if (c && c.key === key) return c.buf;
  const b = await D.renderClip(await baseOf(clip), clip.edits, chain);
  pcache.set(id, { key, buf: b });
  return b;
}
const clipLen = (c) => Math.max(0, (c.edits?.end ?? c.dur ?? 0) - (c.edits?.start || 0));
function thumbOf(buf, a = 0, z = buf.duration, n = 48) {
  const d = buf.getChannelData(0), r = buf.sampleRate, A = Math.floor(a * r), Z = Math.max(A + 1, Math.floor(z * r)), out = [];
  let mx = 1e-6;
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (let j = A + Math.floor(((Z - A) * i) / n); j < A + Math.floor(((Z - A) * (i + 1)) / n); j++) p = Math.max(p, Math.abs(d[j] || 0));
    out.push(p); mx = Math.max(mx, p);
  }
  return out.map((v) => +(v / mx).toFixed(3));
}

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
const col = () => C || (C = Object.fromEntries(['--wave', '--wave-dim', '--handle', '--fg', '--muted', '--accent', '--c4', '--rec', '--bg', '--line', '--sel'].map((v) => [v.slice(2), getComputedStyle(document.documentElement).getPropertyValue(v).trim()])));

const peakCache = new WeakMap();
function peaks(buf, v0, v1, w) {
  const key = `${v0}|${v1}|${w}`;
  let m = peakCache.get(buf);
  if (!m) { m = new Map(); peakCache.set(buf, m); }
  if (m.has(key)) return m.get(key);
  const d = buf.getChannelData(0), r = buf.sampleRate, mn = new Float32Array(w), mx = new Float32Array(w);
  for (let px = 0; px < w; px++) {
    const a = Math.max(0, Math.floor((v0 + (px / w) * (v1 - v0)) * r));
    const b = Math.min(d.length, Math.max(a + 1, Math.floor((v0 + ((px + 1) / w) * (v1 - v0)) * r)));
    let lo = 1, hi = -1;
    for (let i = a; i < b; i++) { const v = d[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (hi < lo) lo = hi = 0;
    mn[px] = lo; mx[px] = hi;
  }
  if (m.size > 12) m.clear();
  const res = { mn, mx };
  m.set(key, res);
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
const FMIN = 40;
const fToY = (f, h, rate) => h * (1 - Math.log(Math.max(FMIN, f) / FMIN) / Math.log(rate / 2 / FMIN));
const yToF = (y, h, rate) => FMIN * Math.pow(rate / 2 / FMIN, 1 - Math.max(0, Math.min(h, y)) / h);
function specCanvas(buf, v0, v1, w, h) {
  const key = `${v0}|${v1}|${w}|${h}`, hit = specCache.get(buf);
  if (hit && hit.key === key) return hit.cv;
  const cols = Math.max(1, Math.floor(w / 2)), rows = Math.max(1, Math.floor(h)), N = 1024, r = buf.sampleRate, d = buf.getChannelData(0);
  const cv = document.createElement('canvas'); cv.width = cols; cv.height = rows;
  const x = cv.getContext('2d'), img = x.createImageData(cols, rows);
  const win = new Float64Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const re = new Float64Array(N), im = new Float64Array(N), rowBin = new Int32Array(rows);
  for (let y = 0; y < rows; y++) rowBin[y] = Math.min(N / 2, Math.max(1, Math.round((yToF(y, rows - 1, r) / r) * N)));
  for (let c = 0; c < cols; c++) {
    const center = Math.floor((v0 + ((c + 0.5) / cols) * (v1 - v0)) * r);
    for (let i = 0; i < N; i++) { const j = center - N / 2 + i; re[i] = (j >= 0 && j < d.length ? d[j] : 0) * win[i]; im[i] = 0; }
    D.fft(re, im, false);
    for (let y = 0; y < rows; y++) {
      const k = rowBin[y], m = Math.hypot(re[k], im[k]) / (N / 4);
      const [R, G2, B] = cmap((20 * Math.log10(m + 1e-9) + 100) / 100), o = (y * cols + c) * 4;
      img.data[o] = R; img.data[o + 1] = G2; img.data[o + 2] = B; img.data[o + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  specCache.set(buf, { key, cv });
  return cv;
}

const TICKS = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
function setupCanvas(cv) {
  const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return null;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const x = cv.getContext('2d');
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.clearRect(0, 0, w, h);
  return { x, w, h };
}
function drawWave(cv, buf, o = {}) {
  const s = setupCanvas(cv);
  if (!s || !buf) return;
  const { x, w, h } = s, K = col();
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
    const step = TICKS.find((st) => (st / span) * w >= 64) || 120;
    x.font = '10px system-ui'; x.fillStyle = o.spec ? '#ddd' : K.muted;
    for (let t = Math.ceil(v0 / step) * step; t < v1; t += step) {
      const px = T(t); x.fillRect(px, 0, 1, 5);
      x.fillText((step < 0.1 ? t.toFixed(3) : step < 1 ? t.toFixed(1) : t.toFixed(0)) + 's', px + 3, 11);
    }
  }
  if (o.segs) { x.globalAlpha = 0.28; x.fillStyle = K.c4; for (const sg of o.segs) x.fillRect(T(sg.start), 0, Math.max(2, T(sg.end) - T(sg.start)), h); x.globalAlpha = 1; }
  if (o.sel) {
    x.globalAlpha = 0.25; x.fillStyle = K.sel; x.fillRect(T(o.sel.a), 0, T(o.sel.b) - T(o.sel.a), h); x.globalAlpha = 1;
    x.fillStyle = K.sel;
    for (const hx of [T(o.sel.a), T(o.sel.b)]) { x.fillRect(hx - 1, 0, 2, h); x.fillRect(hx - 6, 0, 12, 4); x.fillRect(hx - 6, h - 4, 12, 4); }
  }
  if (o.rect) {
    const r = buf.sampleRate, y0 = fToY(o.rect.f1, h, r), y1 = fToY(o.rect.f0, h, r);
    x.strokeStyle = '#fff'; x.lineWidth = 2; x.setLineDash([6, 4]);
    x.strokeRect(T(o.rect.a), y0, T(o.rect.b) - T(o.rect.a), y1 - y0); x.setLineDash([]);
    x.fillStyle = 'rgba(255,255,255,.12)'; x.fillRect(T(o.rect.a), y0, T(o.rect.b) - T(o.rect.a), y1 - y0);
  }
  if (o.start != null) {
    x.fillStyle = K.handle;
    for (const hx of [T(o.start), T(o.end)]) {
      x.fillRect(hx - 1, 0, 2, h);
      if (o.handles !== false) { x.beginPath(); x.arc(hx, h - 12, 10, 0, Math.PI * 2); x.fill(); }
    }
  }
  if (o.env && o.start != null) {
    const pts = o.env, selW = o.end - o.start, P = (p) => [T(o.start + p.t * selW), h * (1 - p.g / 2)];
    x.strokeStyle = o.spec ? '#fff' : K.fg; x.lineWidth = 2; x.beginPath();
    if (!pts.length) { x.setLineDash([5, 5]); x.moveTo(T(o.start), h / 2); x.lineTo(T(o.end), h / 2); x.stroke(); x.setLineDash([]); }
    else {
      x.moveTo(T(o.start), P(pts[0])[1]);
      for (const p of pts) x.lineTo(...P(p));
      x.lineTo(T(o.end), P(pts[pts.length - 1])[1]);
      x.stroke();
      pts.forEach((p, i) => { const [a, b] = P(p); x.beginPath(); x.arc(a, b, i === o.envSel ? 10 : 7, 0, Math.PI * 2); x.fillStyle = i === o.envSel ? K.accent : K.fg; x.fill(); });
    }
  }
  if (o.cur != null) { x.fillStyle = K.sel; x.fillRect(T(o.cur) - 1, 0, 2, h); x.beginPath(); x.moveTo(T(o.cur) - 6, 0); x.lineTo(T(o.cur) + 6, 0); x.lineTo(T(o.cur), 8); x.fill(); }
  if (o.pos != null) { x.fillStyle = o.spec ? '#fff' : K.fg; x.fillRect(T(o.pos) - 1, 0, 2, h); }
  if (o.dur && span < o.dur - 1e-6) {
    x.fillStyle = K.line; x.fillRect(0, h - 3, w, 3);
    x.fillStyle = K.accent; x.fillRect((v0 / o.dur) * w, h - 3, Math.max(6, (span / o.dur) * w), 3);
  }
}
function drawThumb(cv, th) {
  const s = setupCanvas(cv);
  if (!s) return;
  const { x, w, h } = s, n = th?.length || 0;
  x.fillStyle = col().wave;
  if (!n) { x.fillRect(0, h / 2, w, 1); return; }
  const bw = w / n;
  th.forEach((v, i) => { const bh = Math.max(1.5, v * h * 0.9); x.fillRect(i * bw + bw * 0.15, (h - bh) / 2, Math.max(1, bw * 0.7), bh); });
}

// ---------- componentes: sliders, gavetas, avisos ----------
const toSlider = (p, v) => (p.log ? Math.round(1000 * Math.log(v / p.min) / Math.log(p.max / p.min)) : v);
const fromSlider = (p, s) => (p.log ? Math.round(p.min * Math.pow(p.max / p.min, s / 1000)) : +s);
const show = (p, v) => (p.unit === 'Hz' && v >= 1000 ? (v / 1000).toFixed(1) + ' kHz' : `${+(+v).toFixed(p.step < 0.1 ? 2 : p.step < 1 ? 1 : 0)}${p.unit ? (p.unit.startsWith(':') ? p.unit : ' ' + p.unit) : ''}`);
function sliderRow(k, p, v) {
  return `<div class="prm" data-k="${k}"><span>${p.label}</span><input type="range" aria-label="${esc(p.label)}" min="${p.log ? 0 : p.min}" max="${p.log ? 1000 : p.max}" step="${p.log ? 1 : p.step}" value="${toSlider(p, v)}"><button type="button" class="val" aria-label="Digitar valor de ${esc(p.label)}">${show(p, v)}</button></div>`;
}
// Toque duplo no slider volta ao padrão; tocar no número permite digitar.
function bindSliders(root, defs, get, set, onChange) {
  $$('.prm[data-k]', root).forEach((row) => {
    const k = row.dataset.k, p = defs[k];
    if (!p) return;
    const inp = $('input[type=range]', row), val = $('.val', row);
    const apply = (v, fromInput) => {
      v = Math.max(p.min, Math.min(p.max, v));
      set(k, v);
      if (!fromInput) inp.value = toSlider(p, v);
      val.textContent = show(p, v);
      onChange(k, v);
    };
    inp.oninput = () => apply(fromSlider(p, +inp.value), true);
    let lastTap = 0;
    inp.addEventListener('pointerdown', () => {
      const now = Date.now();
      if (now - lastTap < 320) { setTimeout(() => apply(p.def, false), 0); toast(`${p.label}: valor padrão`); }
      lastTap = now;
    });
    val.onclick = () => {
      const ni = document.createElement('input');
      ni.type = 'number'; ni.className = 'valin'; ni.step = p.step || 'any'; ni.min = p.min; ni.max = p.max; ni.value = +(+get(k)).toFixed(3);
      ni.setAttribute('inputmode', 'decimal');
      val.replaceWith(ni); ni.focus(); ni.select();
      let fin = false;
      const done = (keep = true) => { if (fin) return; fin = true; const v = parseFloat(String(ni.value).replace(',', '.')); if (ni.isConnected) ni.replaceWith(val); if (keep && isFinite(v)) apply(v, false); };
      ni.onblur = () => done();
      ni.onkeydown = (e) => { if (e.key === 'Enter') done(); if (e.key === 'Escape') done(false); };
    };
  });
}
let toastT;
function toast(msg) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 1800);
}
function sheet(title, body, { onClose, icon } = {}) {
  const ov = document.createElement('div');
  ov.className = 'ovl sheet';
  ov.innerHTML = `<div class="sheetbox" role="dialog" aria-label="${esc(title)}"><div class="grab"></div><header class="shh">${icon ? ic(icon) : ''}<b>${esc(title)}</b><button class="ibtn" data-close aria-label="Fechar">${ic('close')}</button></header><div class="shb">${body}</div></div>`;
  document.body.appendChild(ov);
  const close = () => { if (!ov.isConnected) return; ov.remove(); onClose && onClose(); };
  ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-close]')) close(); });
  return { el: ov, body: $('.shb', ov), close };
}

// ---------- efeitos: cartões, seletor e gaveta ----------
const GROUPS = [['Limpeza', ['denoise', 'gate']], ['Volume e dinâmica', ['gain', 'comp', 'limiter']], ['Timbre', ['eq', 'lowpass', 'highpass', 'bandpass']], ['Tom e tempo', ['pitch', 'speed', 'tape']], ['Distorção', ['dist', 'crush', 'robot', 'radio']], ['Espaço e movimento', ['echo', 'reverb', 'chorus', 'tremolo']]];
const SHORT = { denoise: 'Remove chiado constante', gate: 'Silencia os vazios', gain: 'Mais alto ou mais baixo', comp: 'Som mais encorpado', limiter: 'Segura os picos', eq: 'Graves, médios e agudos', lowpass: 'Abafa o som', highpass: 'Tira o grave', bandpass: 'Isola uma faixa', pitch: 'Mais grave ou agudo', speed: 'Mais rápido ou lento', tape: 'Tom e velocidade juntos', dist: 'Som rasgado', crush: 'Som de videogame antigo', robot: 'Voz metálica', radio: 'Rádio ou telefone', echo: 'Repetições', reverb: 'Sala, salão, caverna', chorus: 'Várias vozes juntas', tremolo: 'Volume pulsante' };
function pickEffect(onPick) {
  const s = sheet('Adicionar efeito', GROUPS.map(([g, ks]) => `<h3 class="gh">${g}</h3><div class="fxgrid">${ks.map((k) => `<button class="fxtile" data-t="${k}">${ic(k)}<b>${D.FX[k].label.replace(/ \(.*\)/, '')}</b><small>${SHORT[k]}</small></button>`).join('')}</div>`).join(''), { icon: 'plus' });
  $$('.fxtile', s.body).forEach((b) => b.onclick = () => { s.close(); onPick(b.dataset.t); });
}
const fxSummary = (fx) => { const def = D.FX[fx.type]; return Object.entries(def.params).slice(0, 2).map(([k, p]) => show(p, fx.params[k])).join(' · '); };
function fxSheet(fx, { onChange, onAB, onMove, onRemove, first, last, extra = '' } = {}) {
  const def = D.FX[fx.type];
  for (const [k, p] of Object.entries(def.params)) if (fx.params[k] == null) fx.params[k] = p.def;
  const s = sheet(def.label, `
    <div class="fxbar">
      ${onMove ? `<label class="sw"><input type="checkbox" class="on" ${fx.on ? 'checked' : ''} aria-label="Ligar efeito"><span></span></label><span class="onlbl">${fx.on ? 'Ligado' : 'Desligado'}</span>` : ''}
      <span class="sp"></span>
      ${onAB ? `<button class="tbtn ab" aria-pressed="false">${ic('ab')}A/B</button>` : ''}
      <button class="ibtn info" aria-label="Sobre o efeito" aria-expanded="false">${ic('info')}</button>
    </div>
    <div class="infobox" hidden><p>${def.info}</p><dl>${Object.values(def.params).map((p) => `<dt>${p.label}</dt><dd>${p.hint || ''}</dd>`).join('')}</dl>${def.tip ? `<p class="tip">${def.tip}</p>` : ''}<p class="hint">Toque duas vezes num controle para voltar ao padrão. Toque no número para digitar.</p></div>
    <div class="sliders">${Object.entries(def.params).map(([k, p]) => sliderRow(k, p, fx.params[k])).join('')}</div>
    <p class="hint ablbl" hidden>Ouvindo SEM este efeito (B). Toque em A/B de novo para voltar.</p>
    ${extra}
    ${onMove || onRemove ? `<div class="row fxacts">
      ${onMove ? `<button class="ghost mv" data-d="-1" ${first ? 'disabled' : ''}>${ic('up')}Subir</button><button class="ghost mv" data-d="1" ${last ? 'disabled' : ''}>${ic('down')}Descer</button>` : ''}
      ${onRemove ? `<button class="ghost danger rmv">${ic('trash')}Remover</button>` : ''}
    </div>` : ''}`, { icon: fx.type, onClose: () => onAB && onAB(false) });
  const b = s.body;
  bindSliders(b, def.params, (k) => fx.params[k], (k, v) => { fx.params[k] = v; }, () => onChange && onChange());
  $('.info', b).onclick = (e) => { const box = $('.infobox', b); box.hidden = !box.hidden; e.currentTarget.setAttribute('aria-expanded', !box.hidden); e.currentTarget.classList.toggle('is', !box.hidden); };
  if ($('.on', b)) $('.on', b).onchange = (e) => { fx.on = e.target.checked; $('.onlbl', b).textContent = fx.on ? 'Ligado' : 'Desligado'; onChange && onChange(); };
  if (onAB) $('.ab', b).onclick = (e) => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', on); $('.ablbl', b).hidden = !on; onAB(on); };
  $$('.mv', b).forEach((m) => m.onclick = () => { s.close(); onMove(+m.dataset.d); });
  if (onRemove) $('.rmv', b).onclick = () => { s.close(); onRemove(); };
  return s;
}
// Lista de efeitos em cartões; tocar abre a gaveta de ajustes.
function chainUI(el, chain, onChange, { onAB } = {}) {
  const draw = () => {
    el.innerHTML = `${chain.length ? '' : '<div class="empty sm"><b>Nenhum efeito</b><p>Toque em Adicionar efeito. Eles são aplicados de cima para baixo.</p></div>'}
      <div class="fxlist">${chain.map((fx, i) => (D.FX[fx.type] ? `<div class="fxcard ${fx.on ? '' : 'off'}" data-i="${i}">
        <button class="fxopen"><span class="fxi">${ic(fx.type)}</span><span class="tx"><b>${D.FX[fx.type].label}</b><small>${fxSummary(fx)}</small></span></button>
        <label class="sw"><input type="checkbox" ${fx.on ? 'checked' : ''} aria-label="Ligar ${esc(D.FX[fx.type].label)}"><span></span></label>
      </div>` : '')).join('')}</div>
      <button class="addfx wide">${ic('plus')}Adicionar efeito</button>`;
    $$('.fxcard', el).forEach((card) => {
      const i = +card.dataset.i, fx = chain[i];
      $('input', card).onchange = (e) => { fx.on = e.target.checked; card.classList.toggle('off', !fx.on); onChange(); };
      $('.fxopen', card).onclick = () => open(i);
    });
    $('.addfx', el).onclick = () => pickEffect((type) => { chain.push({ type, on: true, params: D.defaultParams(type) }); draw(); onChange(); open(chain.length - 1); });
  };
  const open = (i) => {
    const fx = chain[i];
    fxSheet(fx, {
      onChange: () => { draw(); onChange(); },
      onAB: onAB ? (on) => onAB(on ? fx : null) : null,
      first: i === 0, last: i === chain.length - 1,
      onMove: (d) => { [chain[i], chain[i + d]] = [chain[i + d], chain[i]]; draw(); onChange(); },
      onRemove: () => { chain.splice(i, 1); draw(); onChange(); },
    });
  };
  draw();
  return { redraw: draw };
}

// ---------- exportação ----------
const safe = (s) => (s || 'som').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'som';
let expOpts = { rate: 44100, mono: true, fmt: 'wav', lufs: 0, godot: false, gdir: 'res://sfx/', ...store.get('exp', {}) };
const LUFS = [[0, 'Desligado'], [-14, '-14 LUFS (bem alto)'], [-16, '-16 LUFS (recomendado)'], [-18, '-18 LUFS'], [-20, '-20 LUFS (suave)'], [-23, '-23 LUFS (TV/cinema)']];
function exportPanel(id, { godot = false } = {}) {
  const opt = (arr, cur) => arr.map(([v, l]) => `<option value="${v}" ${v == cur ? 'selected' : ''}>${l}</option>`).join('');
  return `<div class="exp" id="${id}">
    <div class="grid2">
      <label class="field">Formato<select class="fmt">${opt([['wav', 'WAV (efeitos curtos)'], ['ogg', 'OGG (sons longos)']], expOpts.fmt)}</select></label>
      <label class="field">Taxa<select class="rate">${opt([[44100, '44.1 kHz'], [48000, '48 kHz'], [22050, '22.05 kHz']], expOpts.rate)}</select></label>
      <label class="field">Volume padronizado<select class="lufs">${opt(LUFS, expOpts.lufs)}</select></label>
      <label class="check"><input type="checkbox" class="mono" ${expOpts.mono ? 'checked' : ''}> Mono</label>
    </div>
    ${godot ? `<label class="check"><input type="checkbox" class="gd" ${expOpts.godot ? 'checked' : ''}> Pacote Godot (AudioStreamRandomizer)</label>
      <div class="gdbox" ${expOpts.godot ? '' : 'hidden'}><label class="field">Pasta no projeto Godot<input class="gdir" value="${esc(expOpts.gdir)}" autocomplete="off"></label>
      <p class="hint">Junto com os sons vai um arquivo .tres que sorteia um deles a cada vez. Coloque todos os arquivos nessa pasta do projeto e use o .tres num AudioStreamPlayer.</p></div>` : ''}
    <div class="btns">
      <button class="primary" data-act="share">${ic('share')}<span class="lbl">Enviar ${expOpts.fmt.toUpperCase()}</span><small>Drive e outros</small></button>
      <button class="wa" data-act="wa">${ic('share')}Enviar no WhatsApp <small>MP3</small></button>
      <button data-act="save">${ic('download')}Salvar no celular</button>
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
function godotTres(names, dir) {
  if (!dir.endsWith('/')) dir += '/';
  const ext = names.map((n, i) => `[ext_resource type="AudioStream" path="${dir}${n}" id="${i + 1}_sfx"]`).join('\n');
  const streams = names.map((n, i) => `stream_${i}/stream = ExtResource("${i + 1}_sfx")\nstream_${i}/weight = 1.0`).join('\n');
  return `[gd_resource type="AudioStreamRandomizer" load_steps=${names.length + 1} format=3]\n\n${ext}\n\n[resource]\nrandom_pitch = 1.0\nrandom_volume_offset_db = 0.0\nstreams_count = ${names.length}\n${streams}\n`;
}
function bindExport(el, getItems, { packName } = {}) {
  const msg = $('.msg', el), saveExp = () => store.set('exp', expOpts);
  $('.rate', el).onchange = (e) => { expOpts.rate = +e.target.value; saveExp(); };
  $('.mono', el).onchange = (e) => { expOpts.mono = e.target.checked; saveExp(); };
  $('.lufs', el).onchange = (e) => { expOpts.lufs = +e.target.value; saveExp(); };
  $('.fmt', el).onchange = (e) => { expOpts.fmt = e.target.value; saveExp(); $('[data-act=share] .lbl', el).textContent = `Enviar ${expOpts.fmt.toUpperCase()}`; };
  if ($('.gd', el)) {
    $('.gd', el).onchange = (e) => { expOpts.godot = e.target.checked; $('.gdbox', el).hidden = !expOpts.godot; saveExp(); };
    $('.gdir', el).onchange = (e) => { expOpts.gdir = e.target.value.trim() || 'res://sfx/'; saveExp(); };
  }
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
        let name = `${safe(it.name)}.${kind}`, n = 2;
        while (files.some((f) => f.name === name)) name = `${safe(it.name)}_${n++}.${kind}`;
        files.push(new File([blob], name, { type: blob.type }));
      }
      let tres = null;
      if (act !== 'wa' && $('.gd', el)?.checked) tres = new File([godotTres(files.map((f) => f.name), expOpts.gdir)], `${safe(packName ? packName() : items[0].name)}.tres`, { type: 'text/plain' });
      const total = files.length + (tres ? 1 : 0);
      if (act === 'save') { [...files, ...(tres ? [tres] : [])].forEach(download); msg.textContent = `${total > 1 ? total + ' arquivos salvos' : 'Salvo'} em Downloads.`; return; }
      if (tres) {
        const withT = [...files, tres];
        if (navigator.canShare?.({ files: withT })) return share(withT, msg, 'Enviado com o pacote do Godot.');
        download(tres);
        return share(files, msg, 'Sons enviados. O arquivo .tres foi salvo em Downloads, porque o Android não deixa compartilhar esse tipo.');
      }
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
  const out = { app: 'sfx-studio', version: 2, date: new Date().toISOString(), presets, mixes, clips: [] };
  for (const c of clips) out.clips.push({ ...c, blob: await toUrl(c.blob) });
  return new File([JSON.stringify(out)], `sfx-studio-backup-${new Date().toISOString().slice(0, 10)}.txt`, { type: 'text/plain' });
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
const tabsEl = $('.tabs');
tabsEl.innerHTML = [['lib', 'library', 'Biblioteca'], ['gen', 'gen', 'Gerador'], ['mix', 'mix', 'Mixagens']].map(([t, i, l]) => `<button data-t="${t}" aria-current="${t === tab}">${ic(i)}<span>${l}</span></button>`).join('');
function setTab(t) { tab = t; $$('.tabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.t === t)); }
function nav(t) { stop(); setTab(t); render(); }
$$('.tabs button').forEach((b) => b.onclick = () => nav(b.dataset.t));
function screen(mode) { document.body.classList.toggle('ed-mode', mode === 'ed'); }
function render() { screen('main'); window.scrollTo(0, 0); ({ mix: mixList, gen: generator }[tab] || library)(); }

// ---------- biblioteca ----------
let selected = new Set(), query = '', tagFilter = '';
const SORTS = { recent: ['Mais recentes', (a, b) => b.created - a.created], name: ['Nome', (a, b) => a.name.localeCompare(b.name, 'pt', { numeric: true })], dur: ['Duração', (a, b) => clipLen(a) - clipLen(b)] };
async function library() {
  const sortK = store.get('sort', 'recent');
  const clips = (await all('clips')).sort(SORTS[sortK]?.[1] || SORTS.recent[1]);
  const tags = [...new Set(clips.flatMap((c) => c.tags || []))].sort((a, b) => a.localeCompare(b));
  if (tagFilter && !tags.includes(tagFilter)) tagFilter = '';
  const q = query.trim().toLowerCase();
  const shown = clips.filter((c) => (!tagFilter || (c.tags || []).includes(tagFilter)) && (!q || c.name.toLowerCase().includes(q) || (c.tags || []).some((t) => t.toLowerCase().includes(q))));
  const lastBk = store.get('bk', 0), needBk = clips.length && Date.now() - lastBk > 7 * 864e5;
  const presets = (await all('presets')).sort((a, b) => a.name.localeCompare(b.name));
  app.innerHTML = `
    <header class="top"><h1>SFX Studio</h1><span class="count">${clips.length} ${clips.length === 1 ? 'som' : 'sons'}</span><button class="ibtn" id="setBtn" aria-label="Configurações">${ic('gear')}</button></header>
    ${needBk ? `<div class="banner"><span>${lastBk ? 'Seu último backup tem mais de uma semana.' : 'Suas gravações só existem neste celular.'} Faça um backup no Drive.</span><button id="goBk">Backup</button></div>` : ''}
    <div class="hero">
      <button class="recbig" id="btnRec">${ic('mic')}Gravar</button>
      <label class="btn ghost">${ic('download')}Importar<input type="file" accept="audio/*" id="imp" multiple hidden></label>
    </div>
    ${clips.length ? `
    <div class="searchrow"><label class="search">${ic('search')}<input id="q" type="search" placeholder="Buscar" value="${esc(query)}" autocomplete="off" aria-label="Buscar"></label>
      <label class="sortsel" aria-label="Ordenar">${ic('sort')}<select id="sort">${Object.entries(SORTS).map(([k, [l]]) => `<option value="${k}" ${k === sortK ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <div class="chips">
      <button class="chipb" id="selAll">${shown.length && shown.every((c) => selected.has(c.id)) ? 'Desmarcar todos' : 'Marcar todos'}</button>
      ${tags.length ? `<span class="chipsep"></span><button class="chipb ${tagFilter ? '' : 'is'}" data-tag="">Todas as tags</button>${tags.map((t) => `<button class="chipb ${t === tagFilter ? 'is' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}` : ''}
    </div>` : `<div class="empty"><b>Nenhum som ainda</b><p>Toque em Gravar, importe um arquivo ou crie um som retrô na aba Gerador.</p></div>`}
    ${clips.length && !shown.length ? '<p class="hint">Nenhum som encontrado.</p>' : ''}
    <ul class="list">${shown.map((c) => {
      const n = (c.chain || []).filter((f) => f.on).length;
      return `<li data-id="${c.id}">
        <div class="acts"><button class="a-dup">${ic('dup')}Duplicar</button><button class="a-del">${ic('trash')}Apagar</button></div>
        <div class="fg">
          <label class="sel"><input type="checkbox" ${selected.has(c.id) ? 'checked' : ''} aria-label="Selecionar ${esc(c.name)}"></label>
          <button class="open"><canvas class="th"></canvas><span class="tx"><span class="nm">${esc(c.name)}</span><small>${fmt(clipLen(c))}${n ? ` · ${n} efeito${n > 1 ? 's' : ''}` : ''}${c.edits?.loop ? ' · loop' : ''}${(c.tags || []).length ? ' · ' + c.tags.map(esc).join(', ') : ''}</small></span></button>
          <button class="ibtn play" aria-label="Ouvir">${ic('play')}</button>
        </div>
      </li>`;
    }).join('')}</ul>
    ${clips.length ? '<p class="hint center">Deslize um som para a esquerda para duplicar ou apagar.</p>' : ''}
    <section class="batch" ${selected.size ? '' : 'hidden'}>
      <h2>${selected.size} selecionado(s)</h2>
      <details><summary>Aplicar preset em todos</summary>
        ${presets.length ? `<div class="row"><select id="bPre" aria-label="Preset">${presets.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
        <div class="row"><button id="bRep">Substituir efeitos</button><button id="bAdd">Adicionar ao fim</button></div>` : '<p class="hint">Salve um preset no editor primeiro (aba Efeitos, botão +).</p>'}
      </details>
      <label class="field">Nome base <input id="base" placeholder="ex.: passo" autocomplete="off"></label>
      <p class="hint">Com nome base, os arquivos saem como passo_01, passo_02… Sem ele, cada um usa o próprio nome.</p>
      ${exportPanel('bexp', { godot: true })}
      <button class="ghost" id="clearSel">Limpar seleção</button>
    </section>
    <details class="card" id="bkBox"><summary>Backup e restauração</summary>
      <p class="hint">O backup junta todos os sons, presets e mixagens num arquivo só. Guarde no Drive: se você limpar os dados do navegador ou trocar de celular, é só restaurar.${lastBk ? ` Último backup: ${new Date(lastBk).toLocaleDateString('pt-BR')}.` : ''}</p>
      <div class="btns">
        <button class="primary" id="bkShare">${ic('share')}Enviar backup <small>Drive</small></button>
        <button id="bkSave">${ic('download')}Salvar backup no celular</button>
        <label class="btn ghost">${ic('export')}Restaurar backup<input type="file" id="bkIn" hidden></label>
      </div>
      <p class="msg" id="bkMsg" role="status"></p>
    </details>`;

  $('#setBtn').onclick = openSettings;
  $('#btnRec').onclick = openRecorder;
  $('#imp').onchange = async (e) => {
    for (const f of e.target.files) {
      const clip = newClip(f.name.replace(/\.[^.]+$/, ''), f);
      try { const b = await decode(clip); clip.dur = b.duration; clip.thumb = thumbOf(b); } catch { toast(`Não consegui abrir ${f.name}`); continue; }
      await put('clips', clip);
    }
    library();
  };
  if ($('#goBk')) $('#goBk').onclick = () => { $('#bkBox').open = true; $('#bkBox').scrollIntoView({ behavior: 'smooth' }); };
  if ($('#q')) {
    $('#q').oninput = (e) => { query = e.target.value; clearTimeout(library.t); library.t = setTimeout(async () => { await library(); const qi = $('#q'); if (qi) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); } }, 250); };
    $('#sort').onchange = (e) => { store.set('sort', e.target.value); library(); };
    $('#selAll').onclick = () => { const allSel = shown.every((c) => selected.has(c.id)); shown.forEach((c) => (allSel ? selected.delete(c.id) : selected.add(c.id))); library(); };
  }
  $$('.chipb[data-tag]').forEach((b) => b.onclick = () => { tagFilter = b.dataset.tag; library(); });
  const missing = [];
  $$('.list li').forEach((li) => {
    const c = clips.find((x) => x.id === li.dataset.id), fg = $('.fg', li), cv = $('.th', li);
    if (c.thumb) requestAnimationFrame(() => drawThumb(cv, c.thumb)); else missing.push([c, cv]);
    $('.open', li).onclick = () => { if (li.dataset.swiped) return; if (li.classList.contains('open-acts')) { li.classList.remove('open-acts'); fg.style.transform = ''; return; } editor(c); };
    $('.sel input', li).onchange = (e) => { e.target.checked ? selected.add(c.id) : selected.delete(c.id); library(); };
    $('.play', li).onclick = async (e) => {
      const b = e.currentTarget;
      if (b.dataset.on) { stop(); delete b.dataset.on; b.innerHTML = ic('play'); return; }
      $$('.play').forEach((x) => { delete x.dataset.on; x.innerHTML = ic('play'); });
      b.dataset.on = 1; b.innerHTML = ic('stop');
      play(await processed(c), { onEnd: () => { delete b.dataset.on; b.innerHTML = ic('play'); } });
    };
    $('.a-dup', li).onclick = async () => { await put('clips', { ...clone({ ...c, blob: null }), id: uid(), name: c.name + ' (cópia)', created: Date.now(), blob: c.blob }); toast('Som duplicado'); library(); };
    $('.a-del', li).onclick = async (e) => {
      const b = e.currentTarget;
      if (!b.dataset.c) { b.dataset.c = 1; b.innerHTML = `${ic('trash')}Confirmar`; return; }
      await del('clips', c.id); selected.delete(c.id); toast('Som apagado'); library();
    };
    let sx = 0, sy = 0, base = 0, mode = null;
    fg.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; base = li.classList.contains('open-acts') ? -156 : 0; mode = null; });
    fg.addEventListener('pointermove', (e) => {
      if (mode === 'v' || !sx) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!mode) { if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { mode = 'h'; li.classList.add('swiping'); fg.setPointerCapture(e.pointerId); fg.style.transition = 'none'; } else if (Math.abs(dy) > 10) mode = 'v'; }
      if (mode === 'h') fg.style.transform = `translateX(${Math.max(-156, Math.min(0, base + dx))}px)`;
    });
    const end = (e) => {
      if (mode === 'h') {
        const openA = base + (e.clientX - sx) < -70;
        fg.style.transition = ''; fg.style.transform = openA ? 'translateX(-156px)' : '';
        li.classList.toggle('open-acts', openA);
        setTimeout(() => li.classList.remove('swiping'), 220);
        li.dataset.swiped = 1; setTimeout(() => delete li.dataset.swiped, 60);
      }
      sx = 0; mode = null;
    };
    fg.addEventListener('pointerup', end); fg.addEventListener('pointercancel', end);
  });
  (async () => {
    for (const [c, cv] of missing) {
      try { const b = await baseOf(c); c.thumb = thumbOf(b, c.edits?.start || 0, c.edits?.end ?? b.duration); c.dur ||= b.duration; await put('clips', c); if (cv.isConnected) drawThumb(cv, c.thumb); } catch {}
    }
  })();
  if (selected.size) {
    $('#clearSel').onclick = () => { selected.clear(); library(); };
    const applyPre = async (replace) => {
      const p = presets.find((x) => x.id === $('#bPre').value); if (!p) return;
      const list = clips.filter((c) => selected.has(c.id));
      for (const c of list) { c.chain = replace ? clone(p.chain) : [...(c.chain || []), ...clone(p.chain)]; await put('clips', c); }
      toast(`Preset aplicado em ${list.length} som(ns)`); library();
    };
    if ($('#bRep')) { $('#bRep').onclick = () => applyPre(true); $('#bAdd').onclick = () => applyPre(false); }
    bindExport($('#bexp'), async () => {
      const base = $('#base').value.trim();
      const list = clips.filter((c) => selected.has(c.id));
      const out = [];
      for (let i = 0; i < list.length; i++) out.push({ buf: await processed(list[i]), name: base ? `${base}_${pad2(i + 1)}` : list[i].name, loop: list[i].edits?.loop });
      return out;
    }, { packName: () => $('#base').value.trim() || 'sons' });
  }
  const bkMsg = $('#bkMsg');
  $('#bkShare').onclick = async () => {
    try { bkMsg.textContent = 'Montando backup…'; const f = await makeBackup(); await share([f], bkMsg, 'Backup enviado. Escolha uma pasta no Drive.'); if (!/cancel/i.test(bkMsg.textContent)) store.set('bk', Date.now()); }
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
  return { id: uid(), name, created: Date.now(), blob, tags: [], edits: { start: 0, end: null, reverse: false, normalize: false, fadeIn: 0, fadeOut: 0, env: [], loop: false, ops: [] }, chain: [] };
}
function autoTrim(buf) {
  const segs = D.detectSegments(buf, { thrDb: -40, minSilMs: 400, padMs: 60 });
  return segs.length ? { start: segs[0].start, end: segs[segs.length - 1].end } : null;
}

// ---------- configurações e tutorial ----------
async function openSettings() {
  const est = await (navigator.storage?.estimate?.() || Promise.resolve(null)).catch(() => null);
  const s = sheet('Configurações', `
    <label class="field">Tema<select id="stTheme">${[['dark', 'Escuro'], ['light', 'Claro'], ['system', 'Igual ao celular']].map(([v, l]) => `<option value="${v}" ${settings.theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="check"><input type="checkbox" id="stVib" ${settings.vib ? 'checked' : ''}> Vibrar ao tocar nos botões</label>
    <button id="stTour">Ver o tutorial de novo</button>
    ${est ? `<p class="hint">Espaço usado pelo app: ${(est.usage / 1048576).toFixed(1)} MB.</p>` : ''}
    <p class="hint">SFX Studio · versão 6</p>`, { icon: 'gear' });
  $('#stTheme', s.body).onchange = (e) => { settings.theme = e.target.value; store.set('settings', settings); applyTheme(); s.close(); render(); };
  $('#stVib', s.body).onchange = (e) => { settings.vib = e.target.checked; store.set('settings', settings); };
  $('#stTour', s.body).onclick = () => { s.close(); tour(); };
}
const TOUR = [
  ['mic', 'Grave ou gere sons', 'Grave pelo microfone, importe arquivos ou crie sons retrô de jogo na aba Gerador.'],
  ['edit', 'Edite sem medo', 'Corte as pontas, selecione um trecho para apagar, copiar ou aplicar efeito, e desenhe a curva de volume. O original nunca é perdido, e o botão de desfazer volta qualquer passo.'],
  ['fx', 'Efeitos com A/B', 'Na aba Efeitos, toque num cartão para ajustar. O botão A/B compara com e sem o efeito. Toque duas vezes num controle para voltar ao padrão.'],
  ['export', 'Exporte para o Godot', 'Exporte WAV ou OGG, em lote, com volume padronizado e até um pacote .tres pronto. Faça backup na Biblioteca de vez em quando.'],
];
function tour() {
  if ($('.tour')) return;
  let i = 0;
  const ov = document.createElement('div');
  ov.className = 'ovl tour';
  const done = () => { store.set('tour', 1); ov.remove(); };
  const draw = () => {
    const [icn, t, d] = TOUR[i];
    ov.innerHTML = `<div class="tourbox">${ic(icn, 'big')}<h2>${t}</h2><p>${d}</p>
      <div class="dots">${TOUR.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
      <div class="row"><button class="ghost" id="tSkip">${i < TOUR.length - 1 ? 'Pular' : 'Fechar'}</button><button class="primary" id="tNext">${i < TOUR.length - 1 ? 'Próximo' : 'Começar'}</button></div></div>`;
    $('#tSkip', ov).onclick = done;
    $('#tNext', ov).onclick = () => { if (i < TOUR.length - 1) { i++; draw(); } else done(); };
  };
  draw();
  document.body.appendChild(ov);
}

// ---------- gravador ----------
const getMic = (ns) => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: ns, autoGainControl: false } });
const micError = (e) => (e.name === 'NotAllowedError' ? 'Microfone bloqueado. Toque no ícone ao lado do endereço do site → Permissões → Microfone → Permitir, e tente de novo.' : 'Não consegui acessar o microfone: ' + e.message);
function meterLoop(an, ov, isRec, onPeak) {
  const d = new Float32Array(an.fftSize), cv = $('.rwv', ov);
  let pkHold = 0, pkT = 0, raf;
  const pct = (v) => Math.max(0, Math.min(100, ((20 * Math.log10(v + 1e-9) + 60) / 60) * 100));
  const tick = () => {
    an.getFloatTimeDomainData(d);
    let pk = 0; for (const v of d) pk = Math.max(pk, Math.abs(v));
    if (isRec()) onPeak(pk);
    if (pk > pkHold || performance.now() - pkT > 1200) { pkHold = pk; pkT = performance.now(); }
    $('.mbar', ov).style.width = pct(pk) + '%';
    $('.mbar', ov).dataset.lvl = pk > 0.89 ? 'hot' : pk > 0.5 ? 'warm' : '';
    $('.mpk', ov).style.left = pct(pkHold) + '%';
    $('.mdb', ov).textContent = `${db2(pk)} dB`;
    const s = setupCanvas(cv);
    if (s) {
      const { x, w, h } = s;
      x.strokeStyle = isRec() ? col().rec : col().muted; x.lineWidth = 2; x.beginPath();
      for (let i = 0; i < d.length; i++) { const X = (i / d.length) * w, Y = (0.5 - d[i] / 2) * h; i ? x.lineTo(X, Y) : x.moveTo(X, Y); }
      x.stroke();
    }
    raf = requestAnimationFrame(tick);
  };
  tick();
  return () => cancelAnimationFrame(raf);
}
const METER = `<canvas class="rwv"></canvas><div class="meter" aria-hidden="true"><i class="mbar"></i><b class="mpk"></b></div><div class="meterlbl"><span class="mdb">-∞ dB</span><span class="clipwarn" hidden>Estourou! Afaste o celular</span></div>`;
async function openRecorder() {
  const opts = { ns: false, cd: false, trim: true, ...store.get('recOpts', {}) };
  const ov = document.createElement('div');
  ov.className = 'ovl';
  ov.innerHTML = `<div class="recbox">${METER}
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
  let stream, rec, stopMeter, chunks = [], t0, cancelled = false, cdTimer, maxPk = 0, clipped = false, tim;
  const cleanup = () => { stopMeter?.(); clearInterval(cdTimer); clearInterval(tim); stream?.getTracks().forEach((t) => t.stop()); };
  $('#rc', ov).onclick = () => { cancelled = true; if (rec?.state === 'recording') rec.stop(); cleanup(); ov.remove(); };
  $('#rb', ov).onclick = async () => {
    if (rec?.state === 'recording') { rec.stop(); return; }
    if (stream) return;
    Object.assign(opts, { ns: $('#rns', ov).checked, cd: $('#rcd', ov).checked, trim: $('#rtr', ov).checked });
    store.set('recOpts', opts);
    $$('.recopts input', ov).forEach((i) => i.disabled = true);
    try { stream = await getMic(opts.ns); }
    catch (e) { stream = null; $$('.recopts input', ov).forEach((i) => i.disabled = false); $('#rm', ov).textContent = micError(e); return; }
    const ac = D.ctx(), an = ac.createAnalyser(); an.fftSize = 2048;
    const srcNode = ac.createMediaStreamSource(stream); srcNode.connect(an);
    stopMeter = meterLoop(an, ov, () => rec?.state === 'recording', (pk) => { maxPk = Math.max(maxPk, pk); if (pk >= 0.985 && !clipped) { clipped = true; $('.clipwarn', ov).hidden = false; } });
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
        clip.thumb = thumbOf(buf, clip.edits.start, clip.edits.end ?? buf.duration);
      } catch {}
      await put('clips', clip);
      ov.remove();
      editor(clip, { recInfo: clipped ? 'clip' : maxPk < 0.1 ? 'low' : '' });
    };
    const begin = () => {
      rec.start(); t0 = performance.now(); ov.classList.add('on');
      $('#rm', ov).textContent = 'Gravando. Toque de novo para parar.';
      tim = setInterval(() => { $('#rt', ov).textContent = ((performance.now() - t0) / 1000).toFixed(1) + ' s'; }, 100);
    };
    if (opts.cd) {
      let k = 3;
      $('#rt', ov).textContent = k; $('#rm', ov).textContent = 'Prepare-se…';
      cdTimer = setInterval(() => { k--; if (k > 0) $('#rt', ov).textContent = k; else { clearInterval(cdTimer); begin(); } }, 1000);
    } else begin();
  };
}

// ---------- gerador retrô ----------
let gen = store.get('genP', null) || G.KINDS.coin[1](), genKind = store.get('genK', 'coin'), genBuf = null;
const GDEF = Object.fromEntries(G.PARAMS.flatMap(([, ps]) => ps.map(([k, label, signed, hint]) => [k, { label, min: signed ? -1 : 0, max: 1, step: 0.01, def: G.defaults()[k], unit: '', hint }])));
GDEF.sound_vol = { label: 'Volume', min: 0, max: 1, step: 0.01, def: 0.5, unit: '' };
function generator() {
  app.innerHTML = `
    <header class="top"><h1>Gerador</h1><button class="ibtn" id="setBtn" aria-label="Configurações">${ic('gear')}</button></header>
    <p class="hint lead">Crie sons retrô de jogo com um toque. Cada toque gera uma versão nova; ajuste os controles e salve na Biblioteca para editar como qualquer som.</p>
    <div class="kinds">${Object.entries(G.KINDS).map(([k, [l]]) => `<button class="kind ${k === genKind ? 'is' : ''}" data-k="${k}">${ic(k === 'random' ? 'dice' : k)}<span>${l}</span></button>`).join('')}</div>
    <div class="wavebox gen"><canvas id="gwv"></canvas></div>
    <div class="genacts">
      <button class="primary" id="gPlay">${ic('play')}Tocar</button>
      <button id="gMut">${ic('mutate')}Variar</button>
      <button id="gSave">${ic('plus')}Salvar</button>
    </div>
    <p class="hint" id="gInfo"></p>
    <section><h2>Forma de onda</h2><div class="seg" id="gWave">${G.WAVES.map((w, i) => `<button data-w="${i}" aria-pressed="${gen.wave_type === i}">${w}</button>`).join('')}</div>
      <div class="sliders">${sliderRow('sound_vol', GDEF.sound_vol, gen.sound_vol)}</div></section>
    ${G.PARAMS.map(([g, ps], gi) => `<details class="card" ${gi < 2 ? 'open' : ''}><summary>${g}</summary><div class="sliders">${ps.map(([k]) => sliderRow(k, GDEF[k], gen[k])).join('')}</div>
      <dl class="ghints">${ps.map(([, l, , h]) => `<dt>${l}</dt><dd>${h}</dd>`).join('')}</dl></details>`).join('')}`;
  $('#setBtn').onclick = openSettings;
  const regen = (autoPlay = true) => {
    genBuf = G.synth(gen);
    store.set('genP', gen); store.set('genK', genKind);
    drawWave($('#gwv'), genBuf, { color: col().accent });
    $('#gInfo').textContent = `${fmt(genBuf.duration)} · pico ${db2(D.peakOf(genBuf))} dB`;
    if (autoPlay) play(genBuf);
  };
  let t;
  const soon = () => { clearTimeout(t); t = setTimeout(() => regen(true), 140); };
  $$('.kind').forEach((b) => b.onclick = () => { genKind = b.dataset.k; gen = G.KINDS[genKind][1](); generator(); regen(true); });
  $('#gPlay').onclick = () => { if (!genBuf) regen(false); play(genBuf); };
  $('#gMut').onclick = () => { gen = G.mutate(gen); generator(); regen(true); };
  $$('#gWave button').forEach((b) => b.onclick = () => { gen.wave_type = +b.dataset.w; $$('#gWave button').forEach((x) => x.setAttribute('aria-pressed', x === b)); soon(); });
  bindSliders(app, GDEF, (k) => gen[k], (k, v) => { gen[k] = v; }, soon);
  $('#gSave').onclick = async () => {
    if (!genBuf) regen(false);
    const n = (await all('clips')).filter((c) => c.gen).length + 1;
    const clip = newClip(`${G.KINDS[genKind][0]} ${pad2(n)}`, D.encodeWav(genBuf));
    clip.dur = genBuf.duration; clip.gen = clone(gen); clip.tags = ['gerado']; clip.thumb = thumbOf(genBuf);
    await put('clips', clip);
    toast(`Salvo como "${clip.name}"`);
    $('#gInfo').innerHTML = `Salvo na Biblioteca como "${esc(clip.name)}". <button class="tbtn sm" id="gOpen">Abrir no editor</button>`;
    $('#gOpen').onclick = () => editor(clip);
  };
  new ResizeObserver(() => genBuf && $('#gwv') && drawWave($('#gwv'), genBuf, { color: col().accent })).observe($('#gwv'));
  regen(false);
}

// ---------- editor ----------
const views = new Map(), hists = new Map();
let clipboard = null, edTab = 'edit';
const FADE = { fadeIn: { label: 'Fade in', min: 0, max: 2000, step: 5, def: 0, unit: 'ms' }, fadeOut: { label: 'Fade out', min: 0, max: 2000, step: 5, def: 0, unit: 'ms' } };
const SPLIT = { thr: { label: 'Sensibilidade', min: -60, max: -12, step: 1, def: -35, unit: 'dB' }, gap: { label: 'Pausa mínima', min: 40, max: 1500, step: 10, def: 200, unit: 'ms' } };
const VAR = { n: { label: 'Quantidade', min: 2, max: 20, step: 1, def: 5, unit: '' }, p: { label: 'Tom ±', min: 0, max: 6, step: 0.1, def: 1, unit: 'st' }, v: { label: 'Volume ±', min: 0, max: 6, step: 0.5, def: 2, unit: 'dB' } };

async function editor(clip, opt = {}) {
  stop();
  screen('ed');
  let orig;
  try { orig = await baseOf(clip); }
  catch (err) { screen('main'); app.innerHTML = `<div class="empty"><b>Não consegui abrir este som</b><p>${esc(err.message)}</p><button id="bk">Voltar</button></div>`; $('#bk').onclick = render; return; }
  const dur = orig.duration;
  const e = clip.edits;
  e.env ||= []; e.ops ||= [];
  if (e.end == null || e.end > dur) e.end = dur;
  if (e.start >= e.end) e.start = 0;
  clip.tags ||= [];
  const V = views.get(clip.id) || { v0: 0, v1: dur };
  if (V.v1 > dur) { V.v0 = 0; V.v1 = dur; }
  views.set(clip.id, V);
  const snap = () => JSON.stringify({ edits: clip.edits, chain: clip.chain });
  let H = hists.get(clip.id);
  if (!H) { H = { stack: [snap()], i: 0 }; hists.set(clip.id, H); }
  let mode = opt.mode || 'trim', spec = opt.spec || mode === 'fix', loopOn = !!opt.loop, segs = null, envSel = -1, raf;
  let sel = opt.sel || null, cur = opt.cur ?? null, rect = null, abFx = null;
  const nfx = () => clip.chain.filter((f) => f.on).length;

  app.innerHTML = `
  <div class="ed">
    <div class="edtop">
      <header class="top">
        <button class="ibtn" id="back" aria-label="Voltar">${ic('back')}</button>
        <input id="cname" class="title-input" value="${esc(clip.name)}" aria-label="Nome do som">
        <button class="ibtn" id="undo" aria-label="Desfazer">${ic('undo')}</button>
        <button class="ibtn" id="redo" aria-label="Refazer">${ic('redo')}</button>
      </header>
      ${opt.recInfo === 'clip' ? '<div class="banner warn sm"><span>A gravação estourou em algum momento. Se soar distorcida, grave de novo mais longe.</span></div>' : ''}
      ${opt.recInfo === 'low' ? '<div class="banner sm"><span>A gravação ficou baixa. Use Normalizar ou o Volume padronizado na exportação.</span></div>' : ''}
      <div class="modebar">
        <div class="seg icons" role="group" aria-label="Ferramenta">
          <button data-m="trim">${ic('scissorsTrim')}<span>Cortar</span></button>
          <button data-m="sel">${ic('select')}<span>Trecho</span></button>
          <button data-m="env">${ic('env')}<span>Volume</span></button>
          <button data-m="fix">${ic('brush')}<span>Reparar</span></button>
        </div>
        <button class="ibtn" id="specBtn" aria-pressed="${spec}" aria-label="Espectrograma">${ic('spectrum')}</button>
      </div>
      <div class="wavebox"><canvas id="wv" aria-label="Forma de onda"></canvas></div>
      <div class="zoomrow">
        <span class="hint" id="info"></span>
        <button class="ibtn sm" id="zOut" aria-label="Afastar">${ic('minus')}</button>
        <button class="ibtn sm" id="zIn" aria-label="Aproximar">${ic('plus')}</button>
        <button class="ibtn sm" id="zSel" aria-label="Zoom na seleção">${ic('focus')}</button>
        <button class="ibtn sm" id="zAll" aria-label="Ver tudo">${ic('fit')}</button>
      </div>
      <div class="ctx" id="ctx"></div>
      <div class="transport">
        <button id="pO">${ic('play')}Original</button>
        <button id="pF" class="primary">${ic('play')}Com efeitos</button>
        <button id="pL" class="ibtn" aria-label="Repetir em loop" aria-pressed="${loopOn}">${ic('loop')}</button>
        <button id="pS" class="ibtn" aria-label="Parar">${ic('stop')}</button>
      </div>
      <div class="outbox"><canvas id="wo"></canvas><span id="fxState" class="hint">Com o loop ligado, os ajustes tocam na hora.</span></div>
    </div>
    <div class="edpanel" id="panel"></div>
    <nav class="edtabs">${[['edit', 'edit', 'Editar'], ['fx', 'fx', 'Efeitos'], ['tools', 'tools', 'Ferramentas'], ['export', 'export', 'Exportar']].map(([t, i, l]) => `<button data-p="${t}" aria-current="${t === edTab}">${ic(i)}<span>${l}</span>${t === 'fx' && nfx() ? `<em>${nfx()}</em>` : ''}</button>`).join('')}</nav>
  </div>`;

  // ----- histórico e salvamento -----
  let saveT, commitT, liveT;
  const save = () => {
    clearTimeout(saveT);
    saveT = setTimeout(() => { clip.dur = dur; try { clip.thumb = thumbOf(orig, e.start, e.end); } catch {} put('clips', clip); }, 300);
  };
  const updUndo = () => { $('#undo').disabled = H.i <= 0; $('#redo').disabled = H.i >= H.stack.length - 1; };
  const commitNow = () => {
    clearTimeout(commitT); commitT = null;
    const s = snap();
    if (s !== H.stack[H.i]) { H.stack.splice(H.i + 1); H.stack.push(s); if (H.stack.length > 100) H.stack.shift(); H.i = H.stack.length - 1; }
    updUndo();
  };
  const commit = () => { clearTimeout(commitT); commitT = setTimeout(commitNow, 450); $('#undo').disabled = false; };
  const rerender = (extra = {}) => { const ps = $('#panel')?.scrollTop || 0; return editor(clip, { mode, spec, loop: loopOn, ...extra }).then(() => { const p = $('#panel'); if (p) p.scrollTop = ps; }); };
  const goTo = (k, word) => { const o = JSON.parse(H.stack[k]); clip.edits = o.edits; clip.chain = o.chain; H.i = k; put('clips', clip); rerender(); toast(word); };
  $('#undo').onclick = () => { if (commitT) commitNow(); if (H.i > 0) goTo(H.i - 1, 'Desfeito'); };
  $('#redo').onclick = () => { if (H.i < H.stack.length - 1) goTo(H.i + 1, 'Refeito'); };
  updUndo();
  const viewChain = () => (abFx ? clip.chain.map((f) => (f === abFx ? { ...f, on: false } : f)) : clip.chain);
  const live = () => {
    clearTimeout(liveT);
    if (!playing || playing.tag !== 'fx') { $('#fxState').textContent = 'Toque em "Com efeitos" para ouvir as mudanças.'; $('#fxState').classList.remove('bad'); return; }
    liveT = setTimeout(async () => {
      if (!playing || playing.tag !== 'fx') return;
      const pos = playPos();
      try { const b = await processed(clip, viewChain()); if (playing?.tag === 'fx') { showOut(b); playFx(b, pos); } } catch {}
    }, 200);
  };
  const updFxBadge = () => { const n = nfx(), btn = $('.edtabs [data-p=fx]'); if (!btn) return; $('em', btn)?.remove(); if (n) btn.insertAdjacentHTML('beforeend', `<em>${n}</em>`); };
  const dirty = () => { save(); commit(); live(); updFxBadge(); };
  $('#back').onclick = () => { stop(); if (commitT) commitNow(); render(); };
  $('#cname').oninput = (ev) => { clip.name = ev.target.value || 'Sem nome'; save(); };

  // ----- operações de trecho -----
  const addOp = (op, shift) => {
    const full = e.end >= dur - 1e-3;
    if (shift) { e.start = shift(e.start); e.end = full ? null : shift(e.end); } else if (full) e.end = null;
    e.ops.push(op);
    put('clips', clip); commitNow();
  };
  const delShift = (a, b) => (t) => (t >= b ? t - (b - a) : t > a ? a : t);
  const doCopy = () => { if (!sel) return; clipboard = { clipId: clip.id, a: sel.a, b: sel.b, k: e.ops.length }; toast(`Copiado: ${fmt(sel.b - sel.a)}`); renderCtx(); };
  const doDelete = (quiet) => {
    if (!sel) return;
    const { a, b } = sel;
    addOp({ type: 'delete', a, b }, delShift(a, b));
    if (!quiet) toast('Trecho apagado');
    rerender({ sel: null, cur: a });
  };
  const doPaste = () => {
    if (!clipboard || clipboard.clipId !== clip.id) return;
    const L = clipboard.b - clipboard.a;
    let at = cur ?? e.start;
    if (sel) { addOp({ type: 'delete', a: sel.a, b: sel.b }, delShift(sel.a, sel.b)); at = sel.a; }
    addOp({ type: 'paste', at, src: { a: clipboard.a, b: clipboard.b, k: clipboard.k } }, (t) => (t > at ? t + L : t));
    toast('Colado');
    rerender({ sel: { a: at, b: at + L }, cur: null });
  };
  const doSilence = () => { if (!sel) return; addOp({ type: 'silence', a: sel.a, b: sel.b }); toast('Trecho silenciado'); rerender({ sel }); };
  const doNewClip = async () => {
    if (!sel) return;
    const c = { ...newClip(`${clip.name} (trecho)`, clip.blob), dur, tags: [...clip.tags], edits: { ...clone(e), start: sel.a, end: sel.b, env: [], fadeIn: 3, fadeOut: 10 }, chain: clone(clip.chain) };
    c.thumb = thumbOf(orig, sel.a, sel.b);
    await put('clips', c);
    toast('Novo som criado na Biblioteca');
  };
  const doRegionFx = () => {
    if (!sel) return;
    const S = { ...sel };
    pickEffect((type) => {
      const fx = { type, on: true, params: D.defaultParams(type) };
      const s = fxSheet(fx, {
        extra: `<div class="row"><button id="rfPrev">${ic('play')}Ouvir trecho</button><button class="primary" id="rfApply">${ic('check')}Aplicar no trecho</button></div><p class="hint">O efeito vale só para a parte selecionada (${fmt(S.b - S.a)}).</p>`,
      });
      $('#rfPrev', s.body).onclick = async () => {
        const pad = Math.min(0.3, S.a);
        const part = await D.renderClip(orig, { start: S.a - pad, end: Math.min(dur, S.b + 0.3) }, []);
        play(await D.applyOps(part, [{ type: 'fx', a: pad, b: pad + (S.b - S.a), chain: [clone(fx)] }]));
      };
      $('#rfApply', s.body).onclick = () => { s.close(); addOp({ type: 'fx', a: S.a, b: S.b, chain: [clone(fx)] }); toast(`${D.FX[type].label} aplicado no trecho`); rerender({ sel: S }); };
    });
  };
  const doRepair = () => {
    if (!rect) return;
    addOp({ type: 'spec', a: rect.a, b: rect.b, f0: Math.round(rect.f0), f1: Math.round(rect.f1) });
    toast('Removido do espectro');
    rerender({ mode: 'fix' });
  };

  // ----- barra de contexto (muda com a ferramenta) -----
  const renderCtx = () => {
    const c = $('#ctx');
    if (mode === 'trim') c.innerHTML = `<div class="times"><span>Início <b>${fmt(e.start)}</b></span><span>Duração <b>${fmt(e.end - e.start)}</b></span><span>Fim <b>${fmt(e.end)}</b></span></div>`;
    else if (mode === 'sel') {
      const canPaste = clipboard && clipboard.clipId === clip.id;
      const A = (id, i, l, dis) => `<button class="act" id="${id}" ${dis ? 'disabled' : ''}>${ic(i)}<span>${l}</span></button>`;
      c.innerHTML = `<div class="acts-row">${A('aCut', 'cut', 'Recortar', !sel)}${A('aCopy', 'copy', 'Copiar', !sel)}${A('aPaste', 'paste', 'Colar', !canPaste || (!sel && cur == null))}${A('aDel', 'trash', 'Apagar', !sel)}${A('aSil', 'silence', 'Silenciar', !sel)}${A('aFx', 'fx', 'Efeito', !sel)}${A('aNew', 'newclip', 'Novo som', !sel)}</div>`;
      $('#aCut').onclick = () => { doCopy(); doDelete(true); toast('Recortado'); };
      $('#aCopy').onclick = doCopy; $('#aPaste').onclick = doPaste; $('#aDel').onclick = () => doDelete(); $('#aSil').onclick = doSilence; $('#aFx').onclick = doRegionFx; $('#aNew').onclick = doNewClip;
    } else if (mode === 'env') {
      c.innerHTML = `<div class="ctxline"><span class="hint" id="envInfo"></span><button class="tbtn sm" id="envDel">${ic('trash')}Ponto</button><button class="tbtn sm" id="envClr">Limpar</button></div>`;
      $('#envDel').onclick = () => { if (envSel >= 0) { e.env.splice(envSel, 1); envSel = -1; dirty(); redraw(); } };
      $('#envClr').onclick = () => { e.env.length = 0; envSel = -1; dirty(); redraw(); };
    } else {
      c.innerHTML = `<div class="ctxline"><span class="hint">${rect ? `${fmt(rect.b - rect.a)} · ${Math.round(rect.f0)}–${Math.round(rect.f1)} Hz` : 'Arraste sobre um barulho. Na horizontal, pega todas as frequências.'}</span><button class="tbtn sm primary" id="fixGo" ${rect ? '' : 'disabled'}>${ic('brush')}Remover</button></div>`;
      $('#fixGo').onclick = doRepair;
    }
  };

  // ----- forma de onda -----
  const wv = $('#wv'), minSpan = Math.min(dur, 0.02);
  const clampV = () => { const s = Math.max(minSpan, Math.min(dur, V.v1 - V.v0)); V.v0 = Math.max(0, Math.min(dur - s, V.v0)); V.v1 = V.v0 + s; };
  const zoomed = () => V.v1 - V.v0 < dur - 1e-6;
  const tToX = (t) => ((t - V.v0) / (V.v1 - V.v0)) * wv.clientWidth;
  const xToT = (cx) => Math.max(0, Math.min(dur, V.v0 + ((cx - wv.getBoundingClientRect().left) / wv.clientWidth) * (V.v1 - V.v0)));
  const redraw = () => {
    if (!wv.isConnected) return;
    const pos = playing && playing.tag === 'orig' ? playPos() : null;
    drawWave(wv, orig, { v0: V.v0, v1: V.v1, start: e.start, end: e.end, pos, spec, segs, ruler: true, dur, handles: mode === 'trim', env: mode === 'env' ? e.env : null, envSel, sel: mode === 'sel' ? sel : null, cur: mode === 'sel' && !sel ? cur : null, rect: mode === 'fix' ? rect : null });
    $('#info').textContent = mode === 'sel' ? (sel ? `Seleção ${fmt(sel.b - sel.a)}` : 'Arraste para selecionar · toque para ouvir') : mode === 'fix' ? 'Grave embaixo, agudo em cima' : mode === 'env' ? 'Toque para criar, arraste para ajustar' : 'Arraste as alças · toque para ouvir';
    if (mode === 'trim') renderCtx();
    if (mode === 'env') {
      const p = e.env[envSel], h = $('#envInfo');
      if (h) h.innerHTML = p ? `Ponto: <b>${db2(p.g)} dB</b>` : e.env.length ? 'Toque num ponto ou crie outro.' : 'Toque na onda para criar pontos.';
      if ($('#envDel')) $('#envDel').disabled = !p;
      if ($('#envClr')) $('#envClr').disabled = !e.env.length;
    }
  };
  const anim = () => { redraw(); if (playing) raf = requestAnimationFrame(anim); else redraw(); };
  const startAnim = () => { cancelAnimationFrame(raf); anim(); };
  const setMode = (m) => {
    mode = m; envSel = -1; rect = null;
    if (m === 'fix' && !spec) { spec = true; $('#specBtn').setAttribute('aria-pressed', true); }
    $$('.modebar .seg button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.m === m));
    renderCtx(); redraw();
  };
  $$('.modebar .seg button').forEach((b) => b.onclick = () => setMode(b.dataset.m));
  $('#specBtn').onclick = (ev) => { spec = !spec; ev.currentTarget.setAttribute('aria-pressed', spec); if (!spec && mode === 'fix') setMode('trim'); redraw(); };
  const zoomBy = (f) => { const c = playing?.tag === 'orig' ? playPos() : sel ? (sel.a + sel.b) / 2 : (V.v0 + V.v1) / 2, s = Math.max(minSpan, Math.min(dur, (V.v1 - V.v0) * f)); V.v0 = c - s / 2; V.v1 = c + s / 2; clampV(); redraw(); };
  $('#zIn').onclick = () => zoomBy(0.5);
  $('#zOut').onclick = () => zoomBy(2);
  $('#zSel').onclick = () => { const a = sel ? sel.a : e.start, b = sel ? sel.b : e.end, m = (b - a) * 0.08; V.v0 = a - m; V.v1 = b + m; clampV(); redraw(); };
  $('#zAll').onclick = () => { V.v0 = 0; V.v1 = dur; redraw(); };
  new ResizeObserver(redraw).observe(wv);
  setMode(mode);

  const ptrs = new Map();
  let g = null;
  const envPt = (p) => [tToX(e.start + p.t * (e.end - e.start)), wv.clientHeight * (1 - p.g / 2)];
  wv.onpointerdown = (ev) => {
    wv.setPointerCapture(ev.pointerId);
    ptrs.set(ev.pointerId, ev.clientX);
    if (ptrs.size === 2) { const xs = [...ptrs.values()]; g = { type: 'pinch', d0: Math.max(10, Math.abs(xs[0] - xs[1])), s0: V.v1 - V.v0, tc: xToT((xs[0] + xs[1]) / 2) }; return; }
    if (ptrs.size > 2) return;
    const r = wv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    if (mode === 'trim') {
      const ds = Math.abs(x - tToX(e.start)), de = Math.abs(x - tToX(e.end));
      if (Math.min(ds, de) < 30) { g = { type: 'handle', which: ds <= de ? 'start' : 'end' }; return; }
    } else if (mode === 'env') {
      const hit = e.env.findIndex((p) => { const [px, py] = envPt(p); return Math.hypot(px - x, py - y) < 26; });
      if (hit >= 0) { envSel = hit; g = { type: 'pt', i: hit }; redraw(); return; }
    } else if (mode === 'sel') {
      if (sel) { const da = Math.abs(x - tToX(sel.a)), dz = Math.abs(x - tToX(sel.b)); if (Math.min(da, dz) < 24) { g = { type: 'seledge', which: da <= dz ? 'a' : 'b' }; return; } }
      g = { type: 'selnew', t0: xToT(ev.clientX), x0: ev.clientX, moved: false }; return;
    } else if (mode === 'fix') {
      g = { type: 'rect', t0: xToT(ev.clientX), y0: y, x0: ev.clientX, moved: false }; return;
    }
    g = { type: 'pan', x0: ev.clientX, v0: V.v0, moved: false };
  };
  wv.onpointermove = (ev) => {
    if (!ptrs.has(ev.pointerId) || !g) return;
    ptrs.set(ev.pointerId, ev.clientX);
    const r = wv.getBoundingClientRect(), w = wv.clientWidth, h = wv.clientHeight;
    if (g.type === 'pinch') {
      if (ptrs.size < 2) return;
      const xs = [...ptrs.values()], d = Math.max(10, Math.abs(xs[0] - xs[1])), cx = (xs[0] + xs[1]) / 2 - r.left;
      const s = Math.max(minSpan, Math.min(dur, (g.s0 * g.d0) / d));
      V.v0 = g.tc - (cx / w) * s; V.v1 = V.v0 + s; clampV(); redraw();
    } else if (g.type === 'handle') {
      const t = xToT(ev.clientX), m = 0.005;
      if (g.which === 'start') e.start = Math.min(t, e.end - m); else e.end = Math.max(t, e.start + m);
      redraw();
    } else if (g.type === 'pt') {
      const p = e.env[g.i], prev = e.env[g.i - 1], next = e.env[g.i + 1];
      let t = (xToT(ev.clientX) - e.start) / (e.end - e.start);
      t = Math.max(prev ? prev.t + 0.001 : 0, Math.min(next ? next.t - 0.001 : 1, t));
      p.t = t; p.g = Math.max(0, Math.min(2, 2 * (1 - (ev.clientY - r.top) / h)));
      if (Math.abs(p.g - 1) < 0.04) p.g = 1;
      redraw();
    } else if (g.type === 'seledge') {
      const t = xToT(ev.clientX);
      if (g.which === 'a') sel.a = Math.min(t, sel.b - 0.002); else sel.b = Math.max(t, sel.a + 0.002);
      redraw();
    } else if (g.type === 'selnew') {
      if (Math.abs(ev.clientX - g.x0) > 6) g.moved = true;
      if (!g.moved) return;
      const t = xToT(ev.clientX);
      sel = { a: Math.min(g.t0, t), b: Math.max(g.t0, t) }; cur = null;
      redraw();
    } else if (g.type === 'rect') {
      if (Math.abs(ev.clientX - g.x0) > 6 || Math.abs(ev.clientY - r.top - g.y0) > 6) g.moved = true;
      if (!g.moved) return;
      const t = xToT(ev.clientX), y = ev.clientY - r.top, fa = yToF(g.y0, h, orig.sampleRate), fb = yToF(y, h, orig.sampleRate);
      rect = Math.abs(y - g.y0) < 10
        ? { a: Math.min(g.t0, t), b: Math.max(g.t0, t), f0: FMIN, f1: orig.sampleRate / 2 }
        : { a: Math.min(g.t0, t), b: Math.max(g.t0, t), f0: Math.min(fa, fb), f1: Math.max(fa, fb) };
      redraw();
    } else if (g.type === 'pan') {
      const dx = ev.clientX - g.x0;
      if (Math.abs(dx) > 8) g.moved = true;
      if (!g.moved) return;
      if (zoomed()) { const s = V.v1 - V.v0; V.v0 = g.v0 - (dx / w) * s; V.v1 = V.v0 + s; clampV(); redraw(); }
      else if (mode === 'trim') { const t0 = xToT(g.x0); g.type = 'handle'; g.which = Math.abs(t0 - e.start) <= Math.abs(t0 - e.end) ? 'start' : 'end'; wv.onpointermove(ev); }
    }
  };
  const up = (ev) => {
    ptrs.delete(ev.pointerId);
    if (!g) return;
    const t = g.type;
    if (t === 'pinch') { g = ptrs.size ? { type: 'none' } : null; return; }
    if (ptrs.size) return;
    const tap = ev.type === 'pointerup' && !g.moved;
    if (t === 'handle' || t === 'pt') { segs = null; dirty(); }
    else if (t === 'seledge' || (t === 'selnew' && g.moved)) { if (sel && sel.b - sel.a < 0.003) sel = null; renderCtx(); }
    else if (t === 'rect') { if (tap) rect = null; renderCtx(); redraw(); }
    else if (t === 'selnew' && tap) {
      sel = null; cur = xToT(ev.clientX); renderCtx();
      play(orig, { from: cur, to: dur, tag: 'orig', onEnd: redraw }); startAnim();
    } else if (t === 'pan' && tap) {
      const tt = xToT(ev.clientX);
      if (mode === 'env') {
        if (tt >= e.start && tt <= e.end) {
          const r = wv.getBoundingClientRect();
          const p = { t: (tt - e.start) / (e.end - e.start), g: Math.max(0, Math.min(2, 2 * (1 - (ev.clientY - r.top) / wv.clientHeight))) };
          e.env.push(p); e.env.sort((a, b) => a.t - b.t); envSel = e.env.indexOf(p); dirty();
        } else envSel = -1;
        redraw();
      } else {
        play(orig, { from: tt, to: tt >= e.start && tt < e.end ? e.end : dur, tag: 'orig', onEnd: redraw });
        startAnim();
      }
    }
    g = null;
  };
  wv.onpointerup = up; wv.onpointercancel = up;

  // ----- reprodução -----
  const out = $('#wo');
  const showOut = (b) => {
    drawWave(out, b, { color: col().accent });
    const lu = D.loudness(b), pk = D.peakOf(b);
    $('#fxState').textContent = `${abFx ? 'B (sem o efeito) · ' : ''}${fmt(b.duration)} · pico ${db2(pk)} dB${isFinite(lu) ? ` · ${lu.toFixed(1)} LUFS` : ''}${pk > 1 ? ' · vai estourar: use o Limitador' : ''}`;
    $('#fxState').classList.toggle('bad', pk > 1);
  };
  const playFx = (b, from = 0) => {
    play(b, { from: from || 0, loop: loopOn, tag: 'fx', onEnd: () => drawWave(out, b, { color: col().accent }) });
    const tickOut = () => { if (playing?.tag === 'fx' && playing.buf === b && out.isConnected) { drawWave(out, b, { color: col().accent, pos: playPos() }); requestAnimationFrame(tickOut); } };
    tickOut();
  };
  $('#pO').onclick = () => {
    const a = mode === 'sel' && sel ? sel.a : e.start, z = mode === 'sel' && sel ? sel.b : e.end;
    play(orig, loopOn ? { from: a, loop: true, loopStart: a, loopEnd: z, tag: 'orig', onEnd: redraw } : { from: a, to: z, tag: 'orig', onEnd: redraw });
    startAnim();
  };
  $('#pF').onclick = async () => {
    $('#fxState').textContent = 'Processando…';
    try { const b = await processed(clip, viewChain()); playFx(b); showOut(b); }
    catch (err) { $('#fxState').textContent = 'Erro ao processar: ' + err.message; }
  };
  $('#pL').onclick = (ev) => { loopOn = !loopOn; ev.currentTarget.setAttribute('aria-pressed', loopOn); const tag = playing?.tag; if (tag === 'orig') $('#pO').click(); else if (tag === 'fx') $('#pF').click(); };
  $('#pS').onclick = () => { stop(); redraw(); };
  const setAB = (fx) => { abFx = fx; if (playing?.tag === 'fx') live(); else if (fx) $('#pF').click(); };

  // ----- painéis -----
  const splitV = { thr: -35, gap: 200 }, varV = { n: 5, p: 1, v: 2 };
  const panels = {
    edit: () => `
      <div class="toggles">
        <label class="check"><input type="checkbox" id="rev" ${e.reverse ? 'checked' : ''}> Reverter</label>
        <label class="check"><input type="checkbox" id="nor" ${e.normalize ? 'checked' : ''}> Normalizar volume</label>
        <label class="check"><input type="checkbox" id="lp" ${e.loop ? 'checked' : ''}> Som em loop (Godot)</label>
      </div>
      <p class="hint" id="lpHint" ${e.loop ? '' : 'hidden'}>O WAV sai marcado como loop. No Godot, mantenha "Loop Mode" em "Detect From WAV". Para OGG, ligue "Loop" na importação.</p>
      <div class="sliders">${sliderRow('fadeIn', FADE.fadeIn, e.fadeIn)}${sliderRow('fadeOut', FADE.fadeOut, e.fadeOut)}</div>
      <div class="row wrap"><button id="autoTrim">${ic('scissorsTrim')}Cortar silêncio</button><button id="resetTrim">Desfazer corte</button></div>
      ${e.ops.length ? `<div class="banner sm"><span>${e.ops.length} edição(ões) de trecho neste som.</span><button class="tbtn sm" id="clrOps">Remover todas</button></div>` : ''}
      <label class="field">Tags <input id="tags" value="${esc(clip.tags.join(', '))}" placeholder="ex.: passos, floresta" autocomplete="off"></label>`,
    fx: () => `
      <div class="presetbar"><select id="preSel" aria-label="Preset"></select><button id="preApply">Aplicar</button><button class="ibtn" id="preMore" aria-label="Salvar ou gerenciar presets">${ic('plus')}</button></div>
      <div id="chain"></div>`,
    tools: () => `
      <details id="splitBox" class="card"><summary>${ic('cut')}Dividir pelos silêncios</summary>
        <p class="hint">Grave vários sons seguidos (ex.: 10 passos) e o app separa cada um num som próprio, com os mesmos efeitos.</p>
        <div class="sliders">${sliderRow('thr', SPLIT.thr, splitV.thr)}${sliderRow('gap', SPLIT.gap, splitV.gap)}</div>
        <button class="primary wide" id="spGo" disabled>Criar sons</button>
        <p class="msg" id="spMsg" role="status"></p>
      </details>
      <details id="varBox" class="card"><summary>${ic('dice')}Gerar variações</summary>
        <p class="hint">Cria cópias com pequenas diferenças de tom e volume, para passos, golpes e tiros não soarem repetidos. Exporte todas com o "Pacote Godot".</p>
        <div class="sliders">${sliderRow('n', VAR.n, varV.n)}${sliderRow('p', VAR.p, varV.p)}${sliderRow('v', VAR.v, varV.v)}</div>
        <button class="primary wide" id="vGo">Gerar variações</button>
        <p class="msg" id="vMsg" role="status"></p>
      </details>
      ${clip.gen ? `<button class="wide" id="toGen">${ic('gen')}Abrir no Gerador</button>` : ''}
      <button class="wide" id="dup">${ic('dup')}Duplicar som</button>`,
    export: () => `${exportPanel('eexp', { godot: false })}<button class="ghost danger wide" id="delC">${ic('trash')}Apagar som</button>`,
  };
  const derived = (name, edits, chain) => ({ ...newClip(name, clip.blob), dur, tags: [...clip.tags], edits, chain });
  const goLib = (ids, msgEl, text) => {
    selected = new Set(ids);
    msgEl.innerHTML = `${text} <button class="primary" id="goLib">Ver na Biblioteca</button>`;
    $('#goLib', msgEl).onclick = () => { setTab('lib'); render(); };
  };
  const showPanel = (p) => {
    edTab = p;
    $$('.edtabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.p === p));
    const el = $('#panel');
    el.innerHTML = panels[p]();
    el.scrollTop = 0;
    segs = null; redraw();
    if (p === 'edit') {
      $('#rev').onchange = (ev) => { e.reverse = ev.target.checked; dirty(); };
      $('#nor').onchange = (ev) => { e.normalize = ev.target.checked; dirty(); };
      $('#lp').onchange = (ev) => { e.loop = ev.target.checked; $('#lpHint').hidden = !e.loop; save(); commit(); };
      bindSliders(el, FADE, (k) => e[k], (k, v) => { e[k] = v; }, dirty);
      $('#resetTrim').onclick = () => { e.start = 0; e.end = dur; redraw(); dirty(); };
      $('#autoTrim').onclick = () => { const t = autoTrim(orig); if (!t) { toast('Não achei som para cortar'); return; } e.start = t.start; e.end = t.end; redraw(); dirty(); toast('Silêncio cortado'); };
      if ($('#clrOps')) $('#clrOps').onclick = () => { e.ops = []; e.end = null; put('clips', clip); commitNow(); rerender(); toast('Edições de trecho removidas'); };
      $('#tags').onchange = (ev) => { clip.tags = [...new Set(ev.target.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))]; ev.target.value = clip.tags.join(', '); save(); };
    } else if (p === 'fx') {
      chainUI($('#chain'), clip.chain, dirty, { onAB: setAB });
      const drawPresets = async () => {
        const ps = (await all('presets')).sort((a, b) => a.name.localeCompare(b.name));
        if (!$('#preSel')) return;
        $('#preSel').innerHTML = ps.length ? ps.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('') : '<option value="">Sem presets salvos</option>';
        $('#preApply').disabled = !ps.length;
        $('#preApply').onclick = () => { const x = ps.find((y) => y.id === $('#preSel').value); if (!x) return; clip.chain.splice(0, clip.chain.length, ...clone(x.chain)); showPanel('fx'); dirty(); toast(`Preset "${x.name}" aplicado`); };
        $('#preMore').onclick = () => {
          const s = sheet('Presets', `<div class="row"><input id="pName" placeholder="Nome do novo preset" autocomplete="off"><button class="primary" id="pSave">Salvar</button></div>
            <p class="hint">O preset guarda a lista de efeitos atual e todos os ajustes.</p>
            <div id="pList">${ps.length ? ps.map((x) => `<div class="row" data-id="${x.id}"><input value="${esc(x.name)}" aria-label="Nome do preset"><button class="ren">Renomear</button><button class="ghost danger delp">Apagar</button></div>`).join('') : '<p class="hint">Você ainda não salvou presets.</p>'}</div>`, { icon: 'fx' });
          $('#pSave', s.body).onclick = async () => {
            const name = $('#pName', s.body).value.trim();
            if (!name) { toast('Digite um nome'); return; }
            if (!clip.chain.length) { toast('Adicione pelo menos um efeito'); return; }
            const ex = ps.find((x) => x.name.toLowerCase() === name.toLowerCase());
            await put('presets', { id: ex?.id || uid(), name, chain: clone(clip.chain) });
            toast(ex ? `Preset "${name}" atualizado` : `Preset "${name}" salvo`); s.close(); drawPresets();
          };
          $$('#pList .row', s.body).forEach((row) => {
            const x = ps.find((y) => y.id === row.dataset.id);
            $('.ren', row).onclick = async () => { x.name = $('input', row).value.trim() || x.name; await put('presets', x); toast('Renomeado'); drawPresets(); };
            $('.delp', row).onclick = async (ev) => { if (ev.target.dataset.c) { await del('presets', x.id); row.remove(); drawPresets(); } else { ev.target.dataset.c = 1; ev.target.textContent = 'Confirmar'; } };
          });
        };
      };
      drawPresets();
    } else if (p === 'tools') {
      const analyze = async () => {
        const part = await D.renderClip(orig, { start: e.start, end: e.end }, []);
        segs = D.detectSegments(part, { thrDb: splitV.thr, minSilMs: splitV.gap }).map((s) => ({ start: s.start + e.start, end: s.end + e.start }));
        $('#spMsg').textContent = segs.length ? `${segs.length} som(ns) encontrado(s), marcados em verde na onda.` : 'Nenhum som encontrado. Deixe a sensibilidade mais negativa.';
        $('#spGo').disabled = !segs.length; $('#spGo').textContent = `Criar ${segs.length} som(ns)`;
        redraw();
      };
      let at;
      $('#splitBox').ontoggle = () => { if ($('#splitBox').open) analyze(); else { segs = null; redraw(); } };
      bindSliders($('#splitBox'), SPLIT, (k) => splitV[k], (k, v) => { splitV[k] = v; }, () => { clearTimeout(at); at = setTimeout(analyze, 200); });
      $('#spGo').onclick = async () => {
        if (!segs?.length) return;
        const ids = [];
        for (const [i, s] of segs.entries()) {
          const c = derived(`${clip.name}_${pad2(i + 1)}`, { ...clone(e), start: s.start, end: s.end, env: [], fadeIn: Math.max(e.fadeIn, 3), fadeOut: Math.max(e.fadeOut, 15) }, clone(clip.chain));
          c.created = Date.now() + i; c.thumb = thumbOf(orig, s.start, s.end);
          await put('clips', c); ids.push(c.id);
        }
        goLib(ids, $('#spMsg'), `${ids.length} sons criados e selecionados.`);
      };
      bindSliders($('#varBox'), VAR, (k) => varV[k], (k, v) => { varV[k] = v; }, () => {});
      $('#vGo').onclick = async () => {
        const n = Math.round(varV.n), pr = varV.p, vr = varV.v, ids = [];
        const pitches = Array.from({ length: n }, (_, i) => (n > 1 ? -pr + (2 * pr * i) / (n - 1) : 0) + ((Math.random() - 0.5) * pr) / Math.max(1, n - 1)).sort(() => Math.random() - 0.5);
        for (let i = 0; i < n; i++) {
          const chain = [...clone(clip.chain), { type: 'tape', on: true, params: { rate: +Math.pow(2, pitches[i] / 12).toFixed(4) } }, { type: 'gain', on: true, params: { db: +((Math.random() * 2 - 1) * vr).toFixed(1) } }];
          const c = derived(`${clip.name}_v${pad2(i + 1)}`, clone(e), chain);
          c.created = Date.now() + i; c.thumb = clip.thumb;
          await put('clips', c); ids.push(c.id);
        }
        goLib(ids, $('#vMsg'), `${n} variações criadas e selecionadas.`);
      };
      if ($('#toGen')) $('#toGen').onclick = () => { gen = clone(clip.gen); setTab('gen'); render(); };
      $('#dup').onclick = async () => { const c = { ...clone({ ...clip, blob: null }), id: uid(), name: clip.name + ' (cópia)', created: Date.now(), blob: clip.blob }; await put('clips', c); toast('Som duplicado'); editor(c); };
    } else if (p === 'export') {
      bindExport($('#eexp'), async () => [{ buf: await processed(clip), name: clip.name, loop: e.loop }]);
      $('#delC').onclick = async (ev) => {
        const b = ev.currentTarget;
        if (!b.dataset.c) { b.dataset.c = 1; b.innerHTML = `${ic('trash')}Toque de novo para apagar`; return; }
        stop(); clearTimeout(saveT);
        await del('clips', clip.id);
        selected.delete(clip.id); hists.delete(clip.id); views.delete(clip.id);
        toast('Som apagado'); render();
      };
    }
  };
  $$('.edtabs button').forEach((b) => b.onclick = () => showPanel(b.dataset.p));
  showPanel(edTab);
}

// ---------- mixagens ----------
async function mixList() {
  const mixes = (await all('mixes')).sort((a, b) => b.created - a.created);
  app.innerHTML = `
    <header class="top"><h1>Mixagens</h1><button class="ibtn" id="setBtn" aria-label="Configurações">${ic('gear')}</button></header>
    <p class="hint lead">Junte vários sons em camadas, cada um começando no momento certo e com seus próprios efeitos. O resultado sai como um único arquivo.</p>
    <button class="primary wide" id="newMix">${ic('plus')}Nova mixagem</button>
    ${mixes.length ? '' : '<div class="empty"><b>Nenhuma mixagem ainda</b><p>Exemplo: uma explosão feita de estouro + grave + estilhaços.</p></div>'}
    <ul class="list simple">${mixes.map((m) => `<li data-id="${m.id}"><button class="open"><span class="fxi">${ic('mix')}</span><span class="tx"><span class="nm">${esc(m.name)}</span><small>${m.tracks.length} camada(s)</small></span></button></li>`).join('')}</ul>`;
  $('#setBtn').onclick = openSettings;
  $('#newMix').onclick = async () => {
    const m = { id: uid(), name: `Mixagem ${pad2(mixes.length + 1)}`, created: Date.now(), tracks: [], limit: true, grid: 0.1 };
    await put('mixes', m);
    mixEditor(m);
  };
  $$('.list li').forEach((li) => $('.open', li).onclick = () => mixEditor(mixes.find((m) => m.id === li.dataset.id)));
}

async function mixEditor(mix) {
  stop();
  screen('main');
  let clips = (await all('clips')).sort((a, b) => a.name.localeCompare(b.name));
  let byId = Object.fromEntries(clips.map((c) => [c.id, c]));
  const tb = new Map();
  mix.grid ??= 0.1;
  mix.tracks.forEach((t) => { t.chain ||= []; t.trimS ||= 0; t.trimE ||= 0; t.fadeIn ||= 0; t.fadeOut ||= 0; });
  const trackBuf = async (t) => {
    const c = byId[t.clipId]; if (!c) return null;
    const key = clipKey(c) + JSON.stringify([t.chain, t.trimS, t.trimE, t.fadeIn, t.fadeOut]), hit = tb.get(t.id);
    if (hit && hit.key === key) return hit.buf;
    const base = await processed(c);
    let b = base;
    if (t.trimS || t.trimE || t.fadeIn || t.fadeOut || t.chain.some((f) => f.on)) {
      const s = Math.min(t.trimS, base.duration - 0.01), end = Math.max(s + 0.01, base.duration - t.trimE);
      b = await D.renderClip(base, { start: s, end, fadeIn: t.fadeIn, fadeOut: t.fadeOut }, t.chain);
    }
    tb.set(t.id, { key, buf: b, full: base.duration });
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
    <header class="top"><button class="ibtn" id="back" aria-label="Voltar">${ic('back')}</button><input id="mname" class="title-input" value="${esc(mix.name)}" aria-label="Nome da mixagem"></header>
    <div class="mixbar">
      <label class="sortsel" aria-label="Grade magnética">${ic('grid')}<select id="grid">${[[0, 'Sem grade'], [0.05, 'Grade 0,05 s'], [0.1, 'Grade 0,1 s'], [0.25, 'Grade 0,25 s'], [0.5, 'Grade 0,5 s'], [1, 'Grade 1 s']].map(([v, l]) => `<option value="${v}" ${v == mix.grid ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <button class="tbtn" id="recLayer">${ic('mic')}Gravar camada</button>
    </div>
    <div class="tlbox"><canvas id="tl" aria-label="Linha do tempo. Arraste os blocos para mudar o início."></canvas></div>
    <div class="transport two"><button id="mp" class="primary">${ic('play')}Ouvir mixagem</button><button id="ms" class="ibtn" aria-label="Parar">${ic('stop')}</button></div>
    <p class="hint" id="mInfo">Arraste os blocos na linha do tempo. Eles grudam na grade.</p>
    <section><h2>Camadas</h2><div id="tracks"></div>
      ${clips.length ? `<div class="row add"><select id="addClip" aria-label="Som">${clips.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><button id="addT">${ic('plus')}Camada</button></div>` : '<p class="hint">Grave ou importe sons na Biblioteca primeiro.</p>'}
    </section>
    <section><h2>Master</h2>
      <label class="check"><input type="checkbox" id="mlim" ${mix.limit !== false ? 'checked' : ''}> Limitador no resultado final</label>
      <p class="hint">Segura a soma das camadas abaixo de -1 dB, evitando estouro quando vários sons tocam juntos.</p>
    </section>
    <section><h2>Exportar</h2>${exportPanel('mexp')}
      <button class="ghost wide" id="toClip">${ic('plus')}Salvar como som na Biblioteca</button><p class="hint" id="tcMsg"></p></section>
    <button class="ghost danger wide" id="delM">${ic('trash')}Apagar mixagem</button>`;

  $('#back').onclick = () => { stop(); render(); };
  $('#mname').oninput = (ev) => { mix.name = ev.target.value || 'Sem nome'; save(); };
  $('#mlim').onchange = (ev) => { mix.limit = ev.target.checked; save(); };
  $('#grid').onchange = (ev) => { mix.grid = +ev.target.value; save(); drawTL(); };

  const tl = $('#tl');
  const COLORS = ['--accent', '--wave', '--c3', '--c4', '--c5'];
  let scale = 1, mixBuf = null, raf;
  const total = () => Math.max(2, ...mix.tracks.map((t) => (bufOf(t) ? t.offset + bufOf(t).duration : 0))) * 1.15;
  const cssv = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const ROW = 44;
  const drawTL = () => {
    if (!tl.isConnected) return;
    const h = Math.max(1, mix.tracks.length) * ROW + 22;
    tl.style.height = h + 'px';
    const s = setupCanvas(tl); if (!s) return;
    const { x, w } = s, T = total(); scale = w / T;
    if (mix.grid) { x.fillStyle = cssv('--line'); const gs = mix.grid * scale >= 6 ? mix.grid : Math.ceil(6 / scale / mix.grid) * mix.grid; for (let g2 = 0; g2 < T; g2 += gs) x.fillRect(g2 * scale, 16, 1, h); }
    x.fillStyle = cssv('--muted'); x.font = '11px system-ui';
    const stepS = T > 20 ? 5 : T > 8 ? 2 : T > 4 ? 1 : 0.5;
    for (let s2 = 0; s2 < T; s2 += stepS) { x.fillRect(s2 * scale, 0, 1, 6); x.fillText(s2 + 's', s2 * scale + 3, 12); }
    mix.tracks.forEach((t, i) => {
      const b = bufOf(t); if (!b) return;
      const y = 20 + i * ROW, bx = t.offset * scale, bw = Math.max(4, b.duration * scale), bh = ROW - 6, c = cssv(COLORS[i % COLORS.length]), a = t.mute ? 0.3 : 1;
      x.globalAlpha = a * 0.3; x.fillStyle = c; x.fillRect(bx, y, bw, bh);
      x.globalAlpha = a;
      const pk = peaks(b, 0, b.duration, Math.max(1, Math.ceil(bw)));
      for (let px = 0; px < pk.mn.length; px++) x.fillRect(bx + px, y + bh / 2 + pk.mn[px] * bh * 0.45, 1, Math.max(1, (pk.mx[px] - pk.mn[px]) * bh * 0.45));
      x.fillStyle = 'rgba(0,0,0,.35)';
      if (t.fadeIn) { const fw = (t.fadeIn / 1000) * scale; x.beginPath(); x.moveTo(bx, y); x.lineTo(bx + fw, y); x.lineTo(bx, y + bh); x.fill(); }
      if (t.fadeOut) { const fw = (t.fadeOut / 1000) * scale; x.beginPath(); x.moveTo(bx + bw, y); x.lineTo(bx + bw - fw, y); x.lineTo(bx + bw, y + bh); x.fill(); }
      x.fillStyle = cssv('--fg'); x.font = '600 11px system-ui';
      x.fillText(byId[t.clipId].name + (t.chain.some((f) => f.on) ? ' · fx' : ''), bx + 5, y + 12, Math.max(10, bw - 10));
      x.globalAlpha = 1;
    });
    const pos = playing && playing.buf === mixBuf ? playPos() : null;
    if (pos != null) { x.fillStyle = cssv('--fg'); x.fillRect(pos * scale, 0, 2, h); }
  };
  new ResizeObserver(drawTL).observe(tl);
  let dragT = null;
  const snapT = (v) => (mix.grid ? Math.round(v / mix.grid) * mix.grid : Math.round(v * 100) / 100);
  tl.onpointerdown = (ev) => {
    const r = tl.getBoundingClientRect(), i = Math.floor((ev.clientY - r.top - 20) / ROW), t = mix.tracks[i];
    if (!t) return;
    dragT = { t, x0: ev.clientX, o0: t.offset };
    tl.setPointerCapture(ev.pointerId);
  };
  tl.onpointermove = (ev) => {
    if (!dragT) return;
    const nv = Math.max(0, +snapT(dragT.o0 + (ev.clientX - dragT.x0) / scale).toFixed(3));
    if (nv !== dragT.t.offset && mix.grid && settings.vib) navigator.vibrate?.(4);
    dragT.t.offset = nv;
    drawTL();
    const card = $(`#tracks .trk[data-i="${mix.tracks.indexOf(dragT.t)}"]`);
    if (card) { const row = $('.prm[data-k=offset]', card), inp = $('input', row); inp.max = Math.max(+inp.max, Math.ceil(nv + 1)); inp.value = nv; $('.val', row).textContent = fmt(nv); }
  };
  tl.onpointerup = tl.onpointercancel = () => { if (dragT) { dragT = null; save(); } };

  const panTxt = (v) => (v == 0 ? 'centro' : v < 0 ? 'E ' + Math.round(-v * 100) : 'D ' + Math.round(v * 100));
  const openFx = (t) => {
    const s = sheet(`Efeitos: ${byId[t.clipId]?.name || ''}`, `<p class="hint">Estes efeitos valem só para esta camada.</p><div id="shChain"></div>`, { icon: 'fx', onClose: async () => { await trackBuf(t); drawTracks(); } });
    chainUI($('#shChain', s.body), t.chain, save);
  };
  const tdefs = (t) => {
    const full = tb.get(t.id)?.full || 5;
    return {
      offset: { label: 'Início', min: 0, max: Math.max(10, Math.ceil(t.offset + 2)), step: 0.01, def: 0, unit: 's' },
      vol: { label: 'Volume', min: 0, max: 1.5, step: 0.01, def: 1, unit: '' },
      pan: { label: 'Pan', min: -1, max: 1, step: 0.05, def: 0, unit: '' },
      trimS: { label: 'Corte início', min: 0, max: +full.toFixed(2), step: 0.01, def: 0, unit: 's' },
      trimE: { label: 'Corte fim', min: 0, max: +full.toFixed(2), step: 0.01, def: 0, unit: 's' },
      fadeIn: { label: 'Fade in', min: 0, max: 2000, step: 5, def: 0, unit: 'ms' },
      fadeOut: { label: 'Fade out', min: 0, max: 2000, step: 5, def: 0, unit: 'ms' },
    };
  };
  const drawTracks = () => {
    const el = $('#tracks');
    if (!mix.tracks.length) { el.innerHTML = '<p class="hint">Nenhuma camada. Escolha um som abaixo ou grave uma.</p>'; drawTL(); return; }
    el.innerHTML = mix.tracks.map((t, i) => {
      const c = byId[t.clipId], n = t.chain.filter((f) => f.on).length, d = tdefs(t);
      return `<div class="fx trk ${t.mute ? 'off' : ''}" data-i="${i}">
        <div class="fxh"><span class="chip" style="background:var(${COLORS[i % COLORS.length]})"></span><b>${c ? esc(c.name) : 'Som apagado'}</b>
          <button class="tog ${t.mute ? 'is' : ''}" data-a="mute" aria-label="Mudo">M</button><button class="tog ${t.solo ? 'is' : ''}" data-a="solo" aria-label="Solo">S</button>
          <button class="ibtn sm rm" aria-label="Remover camada">${ic('close')}</button></div>
        <div class="sliders">${['offset', 'vol', 'pan'].map((k) => sliderRow(k, d[k], t[k])).join('')}</div>
        <details><summary>Corte e fades do bloco</summary><div class="sliders">${['trimS', 'trimE', 'fadeIn', 'fadeOut'].map((k) => sliderRow(k, d[k], t[k])).join('')}</div></details>
        <button class="ghost fxbtn">${ic('fx')}Efeitos da camada${n ? ` (${n})` : ''}</button>
      </div>`;
    }).join('');
    $$('.trk', el).forEach((card) => {
      const t = mix.tracks[+card.dataset.i], d = tdefs(t);
      let rt;
      const lbl = () => { $('.prm[data-k=vol] .val', card).textContent = Math.round(t.vol * 100) + '%'; $('.prm[data-k=pan] .val', card).textContent = panTxt(t.pan); };
      bindSliders(card, d, (k) => t[k], (k, v) => { t[k] = v; }, (k) => {
        lbl(); save();
        if (['trimS', 'trimE', 'fadeIn', 'fadeOut'].includes(k)) { clearTimeout(rt); rt = setTimeout(async () => { await trackBuf(t); drawTL(); }, 150); } else drawTL();
      });
      lbl();
      $$('.tog', card).forEach((b) => b.onclick = () => { t[b.dataset.a] = !t[b.dataset.a]; drawTracks(); save(); });
      $('.rm', card).onclick = () => { mix.tracks.splice(+card.dataset.i, 1); drawTracks(); save(); };
      $('.fxbtn', card).onclick = () => openFx(t);
    });
    drawTL();
  };
  drawTracks();
  const addTrack = async (clipId, extra = {}) => {
    const t = { id: uid(), clipId, offset: 0, vol: 1, pan: 0, mute: false, solo: false, chain: [], trimS: 0, trimE: 0, fadeIn: 0, fadeOut: 0, ...extra };
    await trackBuf(t);
    mix.tracks.push(t);
    drawTracks(); save();
  };
  if (clips.length) $('#addT').onclick = () => addTrack($('#addClip').value);

  // gravar uma camada nova ouvindo as outras
  $('#recLayer').onclick = async () => {
    stop();
    const ov = document.createElement('div');
    ov.className = 'ovl';
    ov.innerHTML = `<div class="recbox">${METER}<div class="timer" id="lt">0.0 s</div>
      <button class="recbtn" id="lb" aria-label="Gravar"><span></span></button>
      <p class="msg" id="lm">Use fone de ouvido: a mixagem toca enquanto você grava, e o microfone não deve captar o som do alto-falante.</p>
      <button class="ghost" id="lc">Cancelar</button></div>`;
    document.body.appendChild(ov);
    let stream, rec, stopM, chunks = [], t0, tim, cancelled = false;
    const cleanup = () => { stopM?.(); clearInterval(tim); stream?.getTracks().forEach((x) => x.stop()); stop(); };
    $('#lc', ov).onclick = () => { cancelled = true; if (rec?.state === 'recording') rec.stop(); cleanup(); ov.remove(); };
    $('#lb', ov).onclick = async () => {
      if (rec?.state === 'recording') { rec.stop(); return; }
      if (stream) return;
      try { stream = await getMic(false); } catch (e) { $('#lm', ov).textContent = micError(e); return; }
      const ac = D.ctx(), an = ac.createAnalyser(); an.fftSize = 2048;
      const src = ac.createMediaStreamSource(stream); src.connect(an);
      stopM = meterLoop(an, ov, () => rec?.state === 'recording', () => {});
      const mb = await master();
      rec = new MediaRecorder(stream, { audioBitsPerSecond: 256000 });
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        src.disconnect(); cleanup();
        if (cancelled) return;
        const n = clips.filter((c) => c.name.startsWith('Camada gravada')).length + 1;
        const clip = newClip(`Camada gravada ${pad2(n)}`, new Blob(chunks, { type: rec.mimeType }));
        try { const b = await decode(clip); clip.dur = b.duration; clip.thumb = thumbOf(b); } catch {}
        await put('clips', clip);
        clips = (await all('clips')).sort((a, b) => a.name.localeCompare(b.name)); byId = Object.fromEntries(clips.map((c) => [c.id, c]));
        const lat = Math.max(0, (ac.outputLatency || 0) + (ac.baseLatency || 0));
        ov.remove();
        await addTrack(clip.id, { trimS: +lat.toFixed(3) });
        toast('Camada gravada. Se ficar fora de sincronia, ajuste o "Corte início".');
      };
      rec.start();
      if (mb) play(mb);
      t0 = performance.now(); ov.classList.add('on');
      $('#lm', ov).textContent = 'Gravando junto com a mixagem. Toque para parar.';
      tim = setInterval(() => { $('#lt', ov).textContent = ((performance.now() - t0) / 1000).toFixed(1) + ' s'; }, 100);
    };
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
    clip.dur = b.duration; clip.thumb = thumbOf(b);
    await put('clips', clip);
    $('#tcMsg').textContent = `Salvo na Biblioteca como "${mix.name}". Lá você pode aplicar efeitos no conjunto.`;
  };
  $('#delM').onclick = async (ev) => {
    const b = ev.currentTarget;
    if (!b.dataset.c) { b.dataset.c = 1; b.innerHTML = `${ic('trash')}Toque de novo para apagar`; return; }
    stop(); await del('mixes', mix.id); render();
  };
}

applyTheme();
render();
if (!store.get('tour', 0)) setTimeout(tour, 400);
