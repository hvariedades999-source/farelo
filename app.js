import * as D from './dsp.js';
import { ic } from './icons.js';
import * as G from './sfxr.js';
import * as P from './procgen.js';
import * as DR from './drive.js';

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
const DESK = window.farelo || null;
if (DESK) document.documentElement.classList.add('desktop');
else if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// ---------- preferências: tema e vibração ----------
const settings = { theme: 'dark', vib: true, ...store.get('settings', {}) };
settings.drive = { clientId: '', folder: 'Farelo', ...(settings.drive || {}) };
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
const putRaw = (s, o) => tx(s, 'readwrite', (st) => st.put(o));
const delRaw = (s, id) => tx(s, 'readwrite', (st) => st.delete(id));
const put = async (s, o) => {
  if (s !== 'presets') o.updated = Date.now();
  const r = await putRaw(s, o);
  if (DESK) mirror(s, o).catch((e) => console.warn('disco', e));
  return r;
};
const del = async (s, id) => { const r = await delRaw(s, id); if (DESK) unmirror(s, id).catch(() => {}); return r; };
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
let sinkSet = '';
function applySink() {
  const c = D.ctx(), id = settings.outDev || '';
  if (c.setSinkId && sinkSet !== id) { sinkSet = id; c.setSinkId(id).catch(() => {}); }
}
function play(buf, { from = 0, to = null, loop = false, loopStart = 0, loopEnd = null, tag = '', onEnd } = {}) {
  stop();
  applySink();
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
const col = () => C || (C = Object.fromEntries(['--wave', '--wave-dim', '--handle', '--fg', '--muted', '--accent', '--c3', '--c4', '--rec', '--bg', '--line', '--sel'].map((v) => [v.slice(2), getComputedStyle(document.documentElement).getPropertyValue(v).trim()])));

const peakCache = new WeakMap();
function peaks(buf, v0, v1, w, ch = 0) {
  const key = `${v0}|${v1}|${w}|${ch}`;
  let m = peakCache.get(buf);
  if (!m) { m = new Map(); peakCache.set(buf, m); }
  if (m.has(key)) return m.get(key);
  const d = buf.getChannelData(Math.min(ch, buf.numberOfChannels - 1)), r = buf.sampleRate, mn = new Float32Array(w), mx = new Float32Array(w);
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
    const lanes = o.stereo && buf.numberOfChannels > 1 ? 2 : 1, vz = o.vz || 1;
    const sx = o.start != null ? T(o.start) : -1, ex = o.end != null ? T(o.end) : w + 1;
    for (let L = 0; L < lanes; L++) {
      const { mn, mx } = peaks(buf, v0, v1, Math.ceil(w), L), lh = h / lanes, mid = lh * L + lh / 2, amp = (lh / 2) * 0.92;
      x.fillStyle = K.line; x.fillRect(0, mid, w, 1);
      if (L) x.fillRect(0, lh * L, w, 1);
      for (let px = 0; px < mn.length; px++) {
        const lo = Math.max(-1, mn[px] * vz), hi = Math.min(1, mx[px] * vz);
        x.fillStyle = px >= sx && px <= ex ? (o.color || K.wave) : K['wave-dim'];
        x.fillRect(px, mid + lo * amp, 1, Math.max(1, (hi - lo) * amp));
      }
      if (lanes === 2) { x.fillStyle = K.muted; x.font = '600 10px system-ui'; x.fillText(L ? 'D' : 'E', w - 12, lh * L + 24); }
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
  if (o.markers) for (const m of o.markers) {
    const mx2 = T(m.t);
    if (mx2 < -2 || mx2 > w + 2) continue;
    x.fillStyle = K.c3 || '#b48cf2'; x.globalAlpha = 0.9; x.fillRect(mx2, 14, 1.5, h - 14);
    x.font = '600 10px system-ui';
    const tw = Math.min(90, x.measureText(m.name).width + 8);
    x.fillRect(mx2, 14, tw, 14); x.globalAlpha = 1;
    x.fillStyle = '#111'; x.fillText(m.name, mx2 + 4, 25, tw - 6);
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
const show = (p, v) => p.labels ? p.labels[Math.round(v)] ?? '' : (p.unit === 'Hz' && v >= 1000 ? (v / 1000).toFixed(1) + ' kHz' : `${+(+v).toFixed(p.step < 0.1 ? 2 : p.step < 1 ? 1 : 0)}${p.unit ? (p.unit.startsWith(':') ? p.unit : ' ' + p.unit) : ''}`);
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
const GROUPS = [['Limpeza', ['denoise', 'gate', 'deess']], ['Volume e dinâmica', ['gain', 'comp', 'limiter']], ['Timbre', ['eq', 'lowpass', 'highpass', 'bandpass']], ['Voz, tom e tempo', ['formant', 'autotune', 'pitch', 'speed', 'tape']], ['Distorção e robô', ['dist', 'crush', 'robot', 'vocoder', 'radio']], ['Espaço', ['room', 'reverb', 'echo', 'pingpong']], ['Modulação', ['chorus', 'flanger', 'phaser', 'wah', 'tremolo']]];
const SHORT = { denoise: 'Remove chiado constante', gate: 'Silencia os vazios', gain: 'Mais alto ou mais baixo', comp: 'Som mais encorpado', limiter: 'Segura os picos', eq: 'Graves, médios e agudos', lowpass: 'Abafa o som', highpass: 'Tira o grave', bandpass: 'Isola uma faixa', pitch: 'Mais grave ou agudo', speed: 'Mais rápido ou lento', tape: 'Tom e velocidade juntos', dist: 'Som rasgado', crush: 'Som de videogame antigo', robot: 'Voz metálica', radio: 'Rádio ou telefone', echo: 'Repetições', reverb: 'Sala, salão, caverna', chorus: 'Várias vozes juntas', tremolo: 'Volume pulsante', deess: 'Suaviza o chiado do S', flanger: 'Varrido de jato', phaser: 'Varrido rodopiante', wah: 'Filtro que fala', room: 'Quarto, caverna, metal…', pingpong: 'Eco de um lado ao outro', vocoder: 'Voz de robô clássica', autotune: 'Afina a voz', formant: 'Tom sem perder o timbre' };
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
      <div class="gdbox" ${expOpts.godot ? '' : 'hidden'}>${DESK ? '' : `<label class="field">Pasta no projeto Godot<input class="gdir" value="${esc(expOpts.gdir)}" autocomplete="off"></label>`}
      <p class="hint">Junto com os sons vai um arquivo .tres que sorteia um deles a cada vez. Coloque todos os arquivos nessa pasta do projeto e use o .tres num AudioStreamPlayer.</p></div>` : ''}
    ${DESK ? `<div class="gdrow"><label class="field">Subpasta no projeto Godot<input class="gsub" value="${esc(deskCfg.gsub)}" placeholder="ex.: sfx/passos" autocomplete="off"></label></div>
      <p class="hint gdinfo">${deskCfg.godot ? `Projeto: ${esc(deskCfg.godot)}` : 'Nenhum projeto Godot vinculado. Toque em "Salvar no projeto Godot" para escolher a pasta.'}</p>` : ''}
    <div class="btns">
      ${DESK ? `<button class="primary" data-act="godot">${ic('export')}Salvar no projeto Godot <small>Ctrl+S</small></button>
      <button data-act="folder">${ic('library')}Salvar em uma pasta…</button>
      <button class="wa" data-act="wafile">${ic('share')}MP3 para WhatsApp <small>abre a pasta</small></button>` : `<button class="primary" data-act="share">${ic('share')}<span class="lbl">Enviar ${expOpts.fmt.toUpperCase()}</span><small>Drive e outros</small></button>
      <button class="wa" data-act="wa">${ic('share')}Enviar no WhatsApp <small>MP3</small></button>`}
      ${settings.drive.clientId ? `<button data-act="drive">${ic('drive')}Enviar para o Drive <small>${esc(settings.drive.folder)}</small></button>` : ''}
      ${DESK ? '' : `<button data-act="save">${ic('download')}Salvar no celular</button>`}
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
  $('.fmt', el).onchange = (e) => { expOpts.fmt = e.target.value; saveExp(); const l = $('[data-act=share] .lbl', el); if (l) l.textContent = `Enviar ${expOpts.fmt.toUpperCase()}`; };
  if ($('.gsub', el)) $('.gsub', el).onchange = (e) => { deskCfg.gsub = e.target.value.trim().replace(/^res:\/\//, '').replace(/^\/+|\/+$/g, ''); e.target.value = deskCfg.gsub; saveDesk(); };
  if ($('.gd', el)) {
    $('.gd', el).onchange = (e) => { expOpts.godot = e.target.checked; $('.gdbox', el).hidden = !expOpts.godot; saveExp(); };
    if ($('.gdir', el)) $('.gdir', el).onchange = (e) => { expOpts.gdir = e.target.value.trim() || 'res://sfx/'; saveExp(); };
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
        const kind = act === 'wa' || act === 'wafile' ? 'mp3' : expOpts.fmt;
        const blob = kind === 'mp3' ? await D.encodeMp3(b) : kind === 'ogg' ? await D.encodeOgg(b) : D.encodeWav(b, { loop: !!it.loop });
        let name = `${safe(it.name)}.${kind}`, n = 2;
        while (files.some((f) => f.name === name)) name = `${safe(it.name)}_${n++}.${kind}`;
        files.push(new File([blob], name, { type: blob.type }));
      }
      let tres = null;
      const gdirNow = DESK ? `res://${deskCfg.gsub ? deskCfg.gsub + '/' : ''}` : expOpts.gdir;
      if (act !== 'wa' && act !== 'wafile' && $('.gd', el)?.checked) tres = new File([godotTres(files.map((f) => f.name), gdirNow)], `${safe(packName ? packName() : items[0].name)}.tres`, { type: 'text/plain' });
      const allF = [...files, ...(tres ? [tres] : [])];
      if (act === 'godot') {
        if (!deskCfg.godot && !(await linkGodot($('.gdinfo', el)))) { msg.textContent = 'Nenhum projeto escolhido.'; return; }
        const r = await godotWrite(allF, deskCfg.gsub);
        for (const [i, it] of items.entries()) if (it.clip) { it.clip.godot = { sub: deskCfg.gsub, file: files[i].name, key: clipKey(it.clip), at: Date.now() }; await put('clips', it.clip); }
        if ($('.gdinfo', el)) $('.gdinfo', el).textContent = `Projeto: ${deskCfg.godot}`;
        msg.innerHTML = `${allF.length > 1 ? allF.length + ' arquivos salvos' : 'Salvo'} em <b>${esc(r.res)}</b>. O Godot importa sozinho ao voltar para ele. <button class="tbtn sm" data-show>Mostrar na pasta</button>`;
        $('[data-show]', msg).onclick = () => DESK.showItem(r.paths[0]);
        return;
      }
      if (act === 'folder' || act === 'wafile') {
        let dir = act === 'wafile' ? DESK.join(deskCfg.lib || (await DESK.docsDir()), 'Exportados') : await DESK.pickFolder({ title: 'Salvar os sons em…' });
        if (!dir) { msg.textContent = 'Nenhuma pasta escolhida.'; return; }
        const ps = [];
        for (const f of allF) { const p = DESK.join(dir, f.name); await DESK.writeFile(p, new Uint8Array(await f.arrayBuffer())); ps.push(p); }
        DESK.showItem(ps[0]);
        msg.textContent = act === 'wafile' ? 'MP3 salvo. Arraste o arquivo da pasta que abriu para a conversa no WhatsApp (app ou web).' : `${ps.length > 1 ? ps.length + ' arquivos salvos' : 'Salvo'} em ${dir}.`;
        return;
      }
      const total = files.length + (tres ? 1 : 0);
      if (act === 'drive') {
        const all2 = [...files, ...(tres ? [tres] : [])];
        await DR.upload(all2, settings.drive, (i, n) => { msg.textContent = `Enviando ${i + 1} de ${n} para o Drive…`; });
        msg.textContent = `${all2.length > 1 ? all2.length + ' arquivos enviados' : 'Enviado'} para a pasta "${settings.drive.folder}" no Drive.`;
        return;
      }
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
  const out = { app: 'farelo', version: 3, date: new Date().toISOString(), presets, mixes, clips: [] };
  for (const c of clips) out.clips.push({ ...c, blob: await toUrl(c.blob) });
  return new File([JSON.stringify(out)], `farelo-backup-${new Date().toISOString().slice(0, 10)}.txt`, { type: 'text/plain' });
}
async function restoreBackup(file) {
  let j;
  try { j = JSON.parse(await file.text()); } catch { throw new Error('Este arquivo não é um backup do Farelo.'); }
  if (j.app !== 'sfx-studio' && j.app !== 'farelo') throw new Error('Este arquivo não é um backup do Farelo.');
  for (const c of j.clips || []) { c.blob = await (await fetch(c.blob)).blob(); await put('clips', c); pcache.delete(c.id); }
  for (const p of j.presets || []) await put('presets', p);
  for (const m of j.mixes || []) await put('mixes', m);
  return { clips: (j.clips || []).length, presets: (j.presets || []).length, mixes: (j.mixes || []).length };
}

// ---------- programa de Windows: biblioteca no disco, Godot, arquivos ----------
const deskCfg = { lib: '', godot: '', gsub: 'sfx', browse: '', ...store.get('desk', {}) };
const saveDesk = () => store.set('desk', deskCfg);
const EXT_OF = (t = '') => (/wav/.test(t) ? 'wav' : /ogg/.test(t) ? 'ogg' : /mpeg|mp3/.test(t) ? 'mp3' : /mp4|aac|m4a/.test(t) ? 'm4a' : /flac/.test(t) ? 'flac' : 'webm');
const MIME_OF = (name) => ({ wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', webm: 'audio/webm', opus: 'audio/ogg', mp4: 'video/mp4' }[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream');
const AUDIO_RE = /\.(wav|mp3|ogg|oga|flac|m4a|aac|webm|opus|mp4)$/i;
const writtenAudio = new Set();
const libPath = (...p) => DESK.join(deskCfg.lib, ...p);
async function mirror(s, o) {
  if (!deskCfg.lib) return;
  if (s === 'clips') {
    const ext = EXT_OF(o.blob?.type), audio = `${o.id}.${ext}`;
    if (o.blob && !writtenAudio.has(audio)) {
      if (!(await DESK.exists(libPath('sons', audio)))) await DESK.writeFile(libPath('sons', audio), new Uint8Array(await o.blob.arrayBuffer()));
      writtenAudio.add(audio);
    }
    const { blob, ...meta } = o;
    await DESK.writeFile(libPath('sons', `${o.id}.json`), JSON.stringify({ ...meta, audioFile: audio, mime: blob?.type || '' }, null, 1));
  } else if (s === 'mixes') await DESK.writeFile(libPath('mixagens', `${o.id}.json`), JSON.stringify(o, null, 1));
  else if (s === 'presets') await DESK.writeFile(libPath('presets.json'), JSON.stringify(await all('presets'), null, 1));
}
async function unmirror(s, id) {
  if (!deskCfg.lib) return;
  if (s === 'clips') { const ls = await DESK.listDir(libPath('sons')).catch(() => []); for (const f of ls) if (f.name.startsWith(id + '.')) await DESK.remove(libPath('sons', f.name)); }
  else if (s === 'mixes') await DESK.remove(libPath('mixagens', `${id}.json`));
  else if (s === 'presets') await DESK.writeFile(libPath('presets.json'), JSON.stringify(await all('presets'), null, 1));
}
// Lê a pasta da biblioteca e traz para o app o que estiver mais novo no disco
async function syncFromDisk() {
  if (!deskCfg.lib || !(await DESK.exists(deskCfg.lib))) return 0;
  let n = 0;
  const have = Object.fromEntries((await all('clips')).map((c) => [c.id, c]));
  for (const f of await DESK.listDir(libPath('sons')).catch(() => [])) {
    if (!f.name.endsWith('.json')) continue;
    try {
      const meta = JSON.parse(await DESK.readFile(libPath('sons', f.name), true));
      const cur = have[meta.id];
      if (cur && (cur.updated || 0) >= (meta.updated || 0)) { writtenAudio.add(meta.audioFile); continue; }
      const bytes = await DESK.readFile(libPath('sons', meta.audioFile));
      const { audioFile, mime, ...clip } = meta;
      clip.blob = new Blob([bytes], { type: mime || MIME_OF(audioFile) });
      await putRaw('clips', clip); pcache.delete(clip.id); writtenAudio.add(audioFile); n++;
    } catch (e) { console.warn('sync', f.name, e); }
  }
  try { for (const p of JSON.parse(await DESK.readFile(libPath('presets.json'), true))) await putRaw('presets', p); } catch {}
  const mixes = Object.fromEntries((await all('mixes')).map((m) => [m.id, m]));
  for (const f of await DESK.listDir(libPath('mixagens')).catch(() => [])) {
    try { const m = JSON.parse(await DESK.readFile(libPath('mixagens', f.name), true)); if (!mixes[m.id] || (mixes[m.id].updated || 0) < (m.updated || 0)) await putRaw('mixes', m); } catch {}
  }
  return n;
}
// Copia para o disco tudo o que já existe no app (primeira vez ou ao trocar de pasta)
async function pushAllToDisk() {
  for (const c of await all('clips')) await mirror('clips', c);
  for (const m of await all('mixes')) await mirror('mixes', m);
  await mirror('presets');
}
async function importFiles(files, open = false) {
  let last = null, n = 0;
  for (const f of files) {
    const clip = newClip(f.name.replace(/\.[^.]+$/, ''), f);
    try { const b = await decode(clip); clip.dur = b.duration; clip.thumb = thumbOf(b); }
    catch { toast(String(f.type).startsWith('video') ? `O vídeo ${f.name} não tem áudio que dê para ler.` : `Não consegui abrir ${f.name}`); continue; }
    await put('clips', clip); last = clip; n++;
  }
  if (n) toast(n > 1 ? `${n} sons importados` : `"${last.name}" importado`);
  if (open && n === 1) editor(last); else if (n && tab === 'lib' && !document.body.classList.contains('ed-mode')) library();
  return n;
}
async function importPaths(paths, open = false) {
  const files = [];
  for (const p of paths) { try { const bytes = await DESK.readFile(p); files.push(new File([bytes], DESK.basename(p), { type: MIME_OF(p) })); } catch { toast(`Não consegui ler ${p}`); } }
  return importFiles(files, open);
}
// Godot: escreve os arquivos dentro do projeto vinculado
const godotChanged = (c) => c.godot && c.godot.key !== clipKey(c);
async function godotWrite(files, sub) {
  if (!deskCfg.godot) throw new Error('Vincule um projeto Godot em Configurações primeiro.');
  const parts = (sub || '').split(/[\\/]+/).filter(Boolean), dir = DESK.join(deskCfg.godot, ...parts), out = [];
  for (const f of files) { const p = DESK.join(dir, f.name); await DESK.writeFile(p, new Uint8Array(await f.arrayBuffer())); out.push(p); }
  return { dir, paths: out, res: `res://${parts.join('/')}${parts.length ? '/' : ''}` };
}
async function encodeFor(buf, kind, loop) {
  const b = await D.prepare(buf, expOpts);
  return kind === 'mp3' ? D.encodeMp3(b) : kind === 'ogg' ? D.encodeOgg(b) : D.encodeWav(b, { loop: !!loop });
}
async function reexportClip(c) {
  const g = c.godot, kind = g.file.split('.').pop();
  const blob = await encodeFor(await processed(c), kind, c.edits?.loop);
  await godotWrite([new File([blob], g.file)], g.sub);
  c.godot = { ...g, key: clipKey(c), at: Date.now() };
  await put('clips', c);
}
async function linkGodot(msgEl) {
  const dir = await DESK.pickFolder({ title: 'Escolha a pasta do projeto Godot (onde fica o project.godot)', start: deskCfg.godot || undefined });
  if (!dir) return false;
  const root = await DESK.findGodotRoot(dir);
  deskCfg.godot = root || dir; saveDesk();
  if (msgEl) msgEl.textContent = root ? `Projeto vinculado: ${root}` : 'Não achei o arquivo project.godot nessa pasta. Vou salvar nela mesmo assim.';
  return true;
}
const dragCache = new Map();
async function prepDrag(c) {
  const key = clipKey(c) + expOpts.rate + expOpts.mono + expOpts.lufs;
  const hit = dragCache.get(c.id);
  if (hit && hit.key === key) return hit.path;
  const blob = await encodeFor(await processed(c), 'wav', c.edits?.loop);
  const path = DESK.join(await DESK.tempDir(), `${safe(c.name)}.wav`);
  await DESK.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  dragCache.set(c.id, { key, path });
  return path;
}

// Navegador de arquivos: ouvir pastas de sons com as setas e importar
const browseBufs = new Map();
async function browser() {
  const dir = deskCfg.browse;
  let ents = [];
  if (dir) { try { ents = (await DESK.listDir(dir)).filter((e) => e.dir || AUDIO_RE.test(e.name)).sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, 'pt', { numeric: true })); } catch { ents = []; } }
  app.innerHTML = `
    <header class="top"><h1>Arquivos</h1><button class="ibtn" id="setBtn" aria-label="Configurações">${ic('gear')}</button></header>
    <p class="hint lead">Abra qualquer pasta de sons do computador (inclusive a do seu projeto Godot) e ouça um por um com as setas do teclado. Espaço toca, Enter importa, e dá para arrastar um arquivo direto para o Godot.</p>
    <div class="row brow"><button class="primary" id="bPick">${ic('library')}Escolher pasta</button>${dir ? `<button id="bUp">${ic('up')}Subir</button><button id="bOpen">Abrir no Explorer</button>` : ''}${deskCfg.godot ? `<button id="bGodot">Projeto Godot</button>` : ''}</div>
    ${dir ? `<p class="path">${esc(dir)}</p>` : ''}
    <div class="wavebox gen"><canvas id="bwv"></canvas></div>
    <p class="hint" id="bInfo">${dir ? (ents.some((e) => !e.dir) ? 'Selecione um arquivo para ouvir.' : 'Nenhum áudio nesta pasta.') : 'Nenhuma pasta aberta.'}</p>
    <ul class="flist" id="flist" tabindex="0">${ents.map((e, i) => `<li data-i="${i}" class="${e.dir ? 'isdir' : ''}" ${e.dir ? '' : 'draggable="true"'}>
      ${e.dir ? `<span class="fxi">${ic('library')}</span>` : `<label class="sel"><input type="checkbox" aria-label="Marcar ${esc(e.name)}"></label>`}
      <span class="tx"><span class="nm">${esc(e.name)}</span><small>${e.dir ? 'pasta' : `${(e.size / 1024).toFixed(0)} KB`}</small></span></li>`).join('')}</ul>
    ${ents.some((e) => !e.dir) ? `<div class="row"><button id="bImpSel">${ic('download')}Importar marcados</button><button id="bImpAll">Importar todos desta pasta</button></div>` : ''}`;
  $('#setBtn').onclick = openSettings;
  const go = (d) => { deskCfg.browse = d; saveDesk(); browser(); };
  $('#bPick').onclick = async () => { const d = await DESK.pickFolder({ title: 'Escolha uma pasta de sons', start: dir || undefined }); if (d) go(d); };
  if ($('#bUp')) { $('#bUp').onclick = () => go(DESK.dirname(dir)); $('#bOpen').onclick = () => DESK.openPath(dir); }
  if ($('#bGodot')) $('#bGodot').onclick = () => go(deskCfg.godot);
  let cur = -1;
  const lis = $$('#flist li');
  const pick = async (i, autoplay = true) => {
    if (i < 0 || i >= ents.length || !$('#bInfo') || !lis[i]?.isConnected) return;
    cur = i; lis.forEach((l) => l.classList.toggle('cur', +l.dataset.i === i)); lis[i].scrollIntoView({ block: 'nearest' });
    const e = ents[i];
    if (e.dir) { $('#bInfo').textContent = 'Pasta. Enter ou duplo clique para abrir.'; return; }
    const p = DESK.join(dir, e.name);
    try {
      let b = browseBufs.get(p);
      if (!b) { const bytes = await DESK.readFile(p); b = await D.ctx().decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); browseBufs.set(p, b); if (browseBufs.size > 40) browseBufs.delete(browseBufs.keys().next().value); }
      if (cur !== i || !$('#bwv')) return;
      drawWave($('#bwv'), b, { color: col().accent });
      $('#bInfo').textContent = `${e.name} · ${fmt(b.duration)} · ${b.numberOfChannels > 1 ? 'estéreo' : 'mono'} · ${b.sampleRate} Hz · pico ${db2(D.peakOf(b))} dB`;
      if (autoplay) play(b);
    } catch { if ($('#bInfo')) $('#bInfo').textContent = `Não consegui ler ${e.name}.`; }
  };
  lis.forEach((li) => {
    const i = +li.dataset.i, e = ents[i];
    li.onclick = (ev) => { if (ev.target.closest('.sel')) return; pick(i); };
    li.ondblclick = () => (e.dir ? go(DESK.join(dir, e.name)) : importPaths([DESK.join(dir, e.name)], true));
    if (!e.dir) li.ondragstart = (ev) => { ev.preventDefault(); DESK.startDrag(DESK.join(dir, e.name)); };
  });
  const checked = () => lis.filter((l) => $('input', l)?.checked).map((l) => DESK.join(dir, ents[+l.dataset.i].name));
  if ($('#bImpSel')) {
    $('#bImpSel').onclick = () => { const c = checked(); if (!c.length) { toast('Marque os arquivos primeiro'); return; } importPaths(c); };
    $('#bImpAll').onclick = () => importPaths(ents.filter((e) => !e.dir).map((e) => DESK.join(dir, e.name)));
  }
  keyHandler = (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); pick(Math.max(0, Math.min(ents.length - 1, cur + (ev.key === 'ArrowDown' ? 1 : -1)))); }
    else if (ev.key === ' ') { ev.preventDefault(); if (playing) stop(); else if (cur >= 0) pick(cur); }
    else if (ev.key === 'Enter' && cur >= 0) { const e = ents[cur]; e.dir ? go(DESK.join(dir, e.name)) : importPaths([DESK.join(dir, e.name)], true); }
    else if (ev.key === 'Backspace' && dir) go(DESK.dirname(dir));
  };
  new ResizeObserver(() => cur >= 0 && pick(cur, false)).observe($('#bwv'));
}

let updText = '';
function updStatus(st) {
  const T = { checking: 'Procurando atualização…', none: 'Você está na versão mais nova.', available: `Baixando a versão ${st.v}…`, progress: `Baixando atualização: ${st.p}%`, ready: `Versão ${st.v} pronta.`, error: `Não consegui verificar atualizações (${st.m || 'sem internet?'}).`, dev: 'Versão de teste: atualização automática desligada.' };
  updText = T[st.s] || '';
  const m = $('#stUpdMsg'); if (m) m.textContent = updText;
  if (st.s === 'ready' && !$('#updBar')) {
    document.body.insertAdjacentHTML('beforeend', `<div id="updBar" role="status"><span>Atualização ${esc(st.v)} pronta.</span><button class="primary" id="updNow">Reiniciar e atualizar</button><button class="ibtn sm" id="updLater" aria-label="Depois">${ic('close')}</button></div>`);
    $('#updNow').onclick = () => DESK.installUpdate();
    $('#updLater').onclick = () => $('#updBar').remove();
  }
}
// ---------- atalhos de teclado ----------
let keyHandler = null;
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t.closest && t.closest('input:not([type=range]):not([type=checkbox]), textarea, select, [contenteditable]')) return;
  if (document.querySelector('.ovl')) { if (e.key === 'Escape') { const x = document.querySelector('.ovl [data-close], .ovl #rc, .ovl #lc, .ovl #tSkip'); x && x.click(); } return; }
  if (e.key === '?' || (e.key === '/' && e.shiftKey)) { e.preventDefault(); shortcutsSheet(); return; }
  if (!e.ctrlKey && !e.metaKey && !e.altKey && document.body.classList.contains('ed-mode') === false) {
    const map = { F1: 'lib', F2: 'gen', F3: 'mix', F4: 'files' };
    if (map[e.key] && (map[e.key] !== 'files' || DESK)) { e.preventDefault(); nav(map[e.key]); return; }
  }
  keyHandler && keyHandler(e);
});
const SHORTCUTS = [
  ['Geral', [['?', 'Mostrar esta lista'], ['Esc', 'Fechar janela ou gaveta'], ['F1 / F2 / F3 / F4', 'Biblioteca, Gerador, Mixagens, Arquivos'], ['R', 'Gravar (na Biblioteca)'], ['Espaço', 'Tocar / parar']]],
  ['Editor', [['Espaço', 'Tocar com efeitos / parar'], ['Shift + Espaço', 'Tocar o original'], ['L', 'Liga/desliga o loop'], ['1 2 3 4', 'Cortar, Trecho, Volume, Reparar'], ['Ctrl + Z / Ctrl + Y', 'Desfazer / refazer'], ['Ctrl + A', 'Selecionar tudo (modo Trecho)'], ['Ctrl + C / X / V', 'Copiar, recortar, colar trecho'], ['Delete', 'Apagar trecho selecionado'], ['M', 'Adicionar marcador'], ['+ / - / 0', 'Aproximar, afastar, ver tudo'], ['Roda do mouse', 'Zoom; com Shift, rolar para os lados'], ['E', 'Abrir a aba Exportar'], ['Ctrl + S', 'Salvar no projeto Godot (programa de Windows)'], ['Backspace', 'Voltar para a Biblioteca']]],
  ['Biblioteca e Arquivos', [['↑ / ↓', 'Escolher som'], ['Espaço', 'Ouvir'], ['Enter', 'Abrir no editor / importar'], ['Ctrl + A', 'Marcar todos']]],
];
function shortcutsSheet() {
  if ($('.ovl')) return;
  sheet('Atalhos de teclado', SHORTCUTS.map(([g, ks]) => `<h3 class="gh">${g}</h3><dl class="keys">${ks.map(([k, d]) => `<dt>${k.split(' / ').map((x) => x.split(' + ').map((y) => `<kbd>${y}</kbd>`).join(' + ')).join(' / ')}</dt><dd>${d}</dd>`).join('')}</dl>`).join(''), { icon: 'keyboard' });
}

// ---------- arrastar arquivos para dentro da janela ----------
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (![...(e.dataTransfer?.types || [])].includes('Files')) return; dragDepth++; document.body.classList.add('dropping'); });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dropping'); });
window.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
window.addEventListener('drop', (e) => {
  dragDepth = 0; document.body.classList.remove('dropping');
  const files = [...(e.dataTransfer?.files || [])].filter((f) => AUDIO_RE.test(f.name) || /^(audio|video)\//.test(f.type));
  if (!files.length) return;
  e.preventDefault();
  importFiles(files, files.length === 1);
});

// ---------- navegação ----------
let tab = 'lib';
const tabsEl = $('.tabs');
tabsEl.classList.toggle('four', !!DESK);
tabsEl.innerHTML = [['lib', 'library', 'Biblioteca'], ['gen', 'gen', 'Gerador'], ['mix', 'mix', 'Mixagens'], ...(DESK ? [['files', 'search', 'Arquivos']] : [])].map(([t, i, l]) => `<button data-t="${t}" aria-current="${t === tab}">${ic(i)}<span>${l}</span></button>`).join('');
function setTab(t) { tab = t; $$('.tabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.t === t)); }
function nav(t) { stop(); setTab(t); render(); }
$$('.tabs button').forEach((b) => b.onclick = () => nav(b.dataset.t));
function screen(mode) { document.body.classList.toggle('ed-mode', mode === 'ed'); }
function render() { screen('main'); keyHandler = null; document.title = 'Farelo'; window.scrollTo(0, 0); ({ mix: mixList, gen: generator, files: DESK ? browser : null }[tab] || library)(); }

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
    <header class="top"><h1>Farelo</h1><span class="count">${clips.length} ${clips.length === 1 ? 'som' : 'sons'}</span><button class="ibtn" id="setBtn" aria-label="Configurações">${ic('gear')}</button></header>
    ${needBk && !DESK ? `<div class="banner"><span>${lastBk ? 'Seu último backup tem mais de uma semana.' : 'Suas gravações só existem neste celular.'} Faça um backup no Drive.</span><button id="goBk">Backup</button></div>` : ''}
    ${DESK && clips.some(godotChanged) ? `<div class="banner"><span>${clips.filter(godotChanged).length} som(ns) mudaram desde que foram salvos no projeto Godot.</span><button id="reAll">${ic('export')}Atualizar no projeto</button></div>` : ''}
    <div class="hero">
      <button class="recbig" id="btnRec">${ic('mic')}Gravar</button>
      <label class="btn ghost" title="Você também pode arrastar arquivos para a janela">${ic('download')}Importar<input type="file" accept="audio/*,video/*" id="imp" multiple hidden></label>
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
          ${DESK ? `<span class="grip" title="Arraste para o Godot ou para uma pasta">${ic('select')}</span>` : ''}
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
        ${settings.drive.clientId ? `<button id="bkDrive">${ic('drive')}Backup direto no Drive <small>${esc(settings.drive.folder)}</small></button>` : ''}
        <button id="bkSave">${ic('download')}Salvar backup no celular</button>
        <label class="btn ghost">${ic('export')}Restaurar backup<input type="file" id="bkIn" hidden></label>
      </div>
      <p class="msg" id="bkMsg" role="status"></p>
    </details>`;

  $('#setBtn').onclick = openSettings;
  $('#btnRec').onclick = openRecorder;
  $('#imp').onchange = (e) => importFiles([...e.target.files]);
  if ($('#reAll')) $('#reAll').onclick = async (ev) => {
    ev.currentTarget.disabled = true;
    const list = clips.filter(godotChanged);
    for (const [i, c] of list.entries()) { ev.currentTarget.textContent = `Atualizando ${i + 1} de ${list.length}…`; try { await reexportClip(c); } catch (err) { toast(err.message); break; } }
    toast(`${list.length} som(ns) atualizados no projeto`); library();
  };
  if ($('#goBk')) $('#goBk').onclick = () => { $('#bkBox').open = true; $('#bkBox').scrollIntoView({ behavior: 'smooth' }); };
  if ($('#q')) {
    $('#q').oninput = (e) => { query = e.target.value; clearTimeout(library.t); library.t = setTimeout(async () => { await library(); const qi = $('#q'); if (qi) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); } }, 250); };
    $('#sort').onchange = (e) => { store.set('sort', e.target.value); library(); };
    $('#selAll').onclick = () => { const allSel = shown.every((c) => selected.has(c.id)); shown.forEach((c) => (allSel ? selected.delete(c.id) : selected.add(c.id))); library(); };
  }
  $$('.chipb[data-tag]').forEach((b) => b.onclick = () => { tagFilter = b.dataset.tag; library(); });
  const missing = [], lis = $$('.list li');
  let cur = -1;
  const curPick = (i) => { cur = Math.max(0, Math.min(lis.length - 1, i)); lis.forEach((l, k) => l.classList.toggle('cur', k === cur)); lis[cur]?.scrollIntoView({ block: 'nearest' }); };
  keyHandler = (ev) => {
    const k = ev.key;
    if ((k === 'r' || k === 'R') && !ev.ctrlKey) { ev.preventDefault(); openRecorder(); }
    else if (k === 'ArrowDown' || k === 'ArrowUp') { ev.preventDefault(); curPick(cur + (k === 'ArrowDown' ? 1 : -1)); }
    else if (k === ' ' && lis.length) { ev.preventDefault(); if (playing) stop(); else { if (cur < 0) curPick(0); $('.play', lis[cur]).click(); } }
    else if (k === 'Enter' && cur >= 0) $('.open', lis[cur]).click();
    else if ((ev.ctrlKey || ev.metaKey) && k.toLowerCase() === 'a' && $('#selAll')) { ev.preventDefault(); $('#selAll').click(); }
    else if (k === 'Delete' && cur >= 0) { const b = $('.a-del', lis[cur]); b.click(); if (b.dataset.c) toast('Aperte Delete de novo para apagar'); }
  };
  lis.forEach((li) => {
    const c = clips.find((x) => x.id === li.dataset.id), fg = $('.fg', li), cv = $('.th', li);
    if (DESK) {
      li.draggable = true;
      li.addEventListener('mouseenter', () => { prepDrag(c).catch(() => {}); });
      li.addEventListener('dragstart', (ev) => { ev.preventDefault(); const hit = dragCache.get(c.id); if (hit && hit.key === clipKey(c) + expOpts.rate + expOpts.mono + expOpts.lufs) DESK.startDrag(hit.path); else prepDrag(c).then((p) => DESK.startDrag(p)); });
    }
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
      for (let i = 0; i < list.length; i++) out.push({ buf: await processed(list[i]), name: base ? `${base}_${pad2(i + 1)}` : list[i].name, loop: list[i].edits?.loop, clip: list[i] });
      return out;
    }, { packName: () => $('#base').value.trim() || 'sons' });
  }
  const bkMsg = $('#bkMsg');
  $('#bkShare').onclick = async () => {
    try { bkMsg.textContent = 'Montando backup…'; const f = await makeBackup(); await share([f], bkMsg, 'Backup enviado. Escolha uma pasta no Drive.'); if (!/cancel/i.test(bkMsg.textContent)) store.set('bk', Date.now()); }
    catch (e) { bkMsg.textContent = 'Erro: ' + e.message; }
  };
  if ($('#bkDrive')) $('#bkDrive').onclick = async () => {
    try { bkMsg.textContent = 'Montando backup…'; const f = await makeBackup(); bkMsg.textContent = 'Enviando para o Drive…'; await DR.upload([f], settings.drive); store.set('bk', Date.now()); bkMsg.textContent = `Backup salvo na pasta "${settings.drive.folder}" do Drive.`; }
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
    ${DESK ? '' : `<label class="check"><input type="checkbox" id="stVib" ${settings.vib ? 'checked' : ''}> Vibrar ao tocar nos botões</label>`}
    <details class="card" id="stDev"><summary>${ic('mic')}Microfone e saída de som</summary>
      <label class="field">Microfone<select id="stIn"><option value="">Padrão do sistema</option></select></label>
      <label class="field">Saída (fone, caixa de som)<select id="stOut"><option value="">Padrão do sistema</option></select></label>
      <p class="hint" id="stDevHint">Se os nomes não aparecerem, grave uma vez para liberar o microfone e abra de novo.</p>
    </details>
    ${DESK ? `<details class="card" open><summary>${ic('library')}Programa de Windows</summary>
      <div class="kv"><span>Pasta da biblioteca</span><b id="stLib">${esc(deskCfg.lib)}</b></div>
      <p class="hint">Todos os sons, presets e mixagens ficam salvos aqui como arquivos. Coloque essa pasta dentro do Google Drive para PC ou do OneDrive para ter backup automático.</p>
      <div class="row"><button id="stLibCh">Trocar pasta</button><button id="stLibOpen">Abrir</button></div>
      <div class="kv"><span>Projeto Godot</span><b id="stGd">${deskCfg.godot ? esc(deskCfg.godot) : 'nenhum'}</b></div>
      <div class="row"><button id="stGdCh" class="primary">${deskCfg.godot ? 'Trocar projeto' : 'Escolher projeto'}</button>${deskCfg.godot ? '<button id="stGdOpen">Abrir</button>' : ''}</div>
      <p class="msg" id="stGdMsg"></p>
      <div class="kv"><span>Versão</span><b id="stVer">…</b></div>
      <div class="row"><button id="stUpd">Procurar atualização</button></div>
      <p class="msg" id="stUpdMsg">${esc(updText || '')}</p>
    </details>` : ''}
    <button id="stKeys">${ic('keyboard')}Atalhos de teclado</button>
    <button id="stTour">Ver o tutorial de novo</button>
    <details class="card"><summary>${ic('drive')}Envio direto para o Google Drive</summary>
      <p class="hint">Com isso configurado, aparece o botão "Enviar para o Drive", que manda os arquivos direto para uma pasta, sem passar pelo menu de compartilhar.</p>
      <label class="field">ID do cliente OAuth<input id="stCid" value="${esc(settings.drive.clientId)}" placeholder="…apps.googleusercontent.com" autocomplete="off"></label>
      <label class="field">Pasta no Drive<input id="stFolder" value="${esc(settings.drive.folder)}" autocomplete="off"></label>
      <div class="row"><button id="stDsave" class="primary">Salvar</button><button id="stDtest">Testar conexão</button></div>
      <p class="msg" id="stDmsg"></p>
      <details><summary>Como conseguir o ID do cliente (uma vez só)</summary>
        <ol class="steps">
          <li>No navegador, abra console.cloud.google.com e crie um projeto (ex.: "Farelo").</li>
          <li>Em "APIs e serviços" → "Biblioteca", procure "Google Drive API" e ative.</li>
          <li>Em "Tela de permissão OAuth", escolha "Externo", preencha o nome do app e seu e-mail, e em "Usuários de teste" adicione o seu e-mail do Google.</li>
          <li>Em "Credenciais" → "Criar credenciais" → "ID do cliente OAuth", tipo "Aplicativo da Web".</li>
          <li>Em "Origens JavaScript autorizadas", adicione: <code>${esc(location.origin)}</code></li>
          <li>Copie o "ID do cliente" (termina em apps.googleusercontent.com) e cole aqui.</li>
        </ol>
        <p class="hint">O app só pede permissão para os arquivos que ele mesmo cria no seu Drive.</p>
      </details>
    </details>
    ${est ? `<p class="hint">Espaço usado pelo app: ${(est.usage / 1048576).toFixed(1)} MB.</p>` : ''}
    <p class="hint">Farelo · versão ${DESK ? 'Windows' : 'web'} 8</p>`, { icon: 'gear' });
  $('#stTheme', s.body).onchange = (e) => { settings.theme = e.target.value; store.set('settings', settings); applyTheme(); s.close(); render(); };
  if ($('#stVib', s.body)) $('#stVib', s.body).onchange = (e) => { settings.vib = e.target.checked; store.set('settings', settings); };
  $('#stKeys', s.body).onclick = () => { s.close(); shortcutsSheet(); };
  (async () => {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      const fill = (sel, kind, cur) => { for (const d of devs.filter((x) => x.kind === kind && x.deviceId && x.deviceId !== 'default')) sel.insertAdjacentHTML('beforeend', `<option value="${esc(d.deviceId)}" ${d.deviceId === cur ? 'selected' : ''}>${esc(d.label || (kind === 'audioinput' ? 'Microfone' : 'Saída') + ' ' + d.deviceId.slice(0, 5))}</option>`); };
      fill($('#stIn', s.body), 'audioinput', settings.inDev); fill($('#stOut', s.body), 'audiooutput', settings.outDev);
      if (!D.ctx().setSinkId) { $('#stOut', s.body).disabled = true; $('#stDevHint', s.body).textContent = 'Este navegador não deixa escolher a saída de som.'; }
    } catch {}
  })();
  $('#stIn', s.body).onchange = (e) => { settings.inDev = e.target.value; store.set('settings', settings); toast('Microfone escolhido'); };
  $('#stOut', s.body).onchange = (e) => { settings.outDev = e.target.value; store.set('settings', settings); applySink(); toast('Saída escolhida'); };
  if (DESK) {
    DESK.info().then((i) => { const v = $('#stVer', s.body); if (v) v.textContent = i.version; });
    $('#stLibCh', s.body).onclick = async () => {
      const d = await DESK.pickFolder({ title: 'Escolha a pasta da biblioteca', start: deskCfg.lib });
      if (!d) return;
      deskCfg.lib = d; saveDesk(); $('#stLib', s.body).textContent = d;
      const n = await syncFromDisk(); await pushAllToDisk();
      toast(n ? `${n} som(ns) encontrados na pasta` : 'Biblioteca copiada para a pasta nova');
    };
    $('#stLibOpen', s.body).onclick = () => DESK.openPath(deskCfg.lib);
    $('#stGdCh', s.body).onclick = async () => { if (await linkGodot($('#stGdMsg', s.body))) $('#stGd', s.body).textContent = deskCfg.godot; };
    if ($('#stGdOpen', s.body)) $('#stGdOpen', s.body).onclick = () => DESK.openPath(deskCfg.godot);
    $('#stUpd', s.body).onclick = () => { $('#stUpdMsg', s.body).textContent = 'Procurando…'; DESK.checkUpdate(); };
  }
  $('#stTour', s.body).onclick = () => { s.close(); tour(); };
  const dsave = () => { settings.drive = { clientId: $('#stCid', s.body).value.trim(), folder: $('#stFolder', s.body).value.trim() || 'Farelo' }; store.set('settings', settings); };
  $('#stDsave', s.body).onclick = () => { dsave(); $('#stDmsg', s.body).textContent = settings.drive.clientId ? 'Salvo. O botão do Drive aparece na exportação e no backup.' : 'Removido.'; };
  $('#stDtest', s.body).onclick = async () => {
    dsave();
    const m = $('#stDmsg', s.body);
    try { m.textContent = 'Abrindo o login do Google…'; await DR.upload([new File(['Farelo conectado.'], 'teste-farelo.txt', { type: 'text/plain' })], settings.drive); m.textContent = `Funcionou! Um arquivo de teste foi criado na pasta "${settings.drive.folder}".`; }
    catch (e) { m.textContent = e.message; }
  };
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
async function getMic(ns) {
  const base = { echoCancellation: false, noiseSuppression: ns, autoGainControl: false };
  if (settings.inDev) { try { return await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: { exact: settings.inDev } } }); } catch {} }
  return navigator.mediaDevices.getUserMedia({ audio: base });
}
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

// ---------- gerador ----------
let gen = store.get('genP', null) || G.KINDS.coin[1](), genKind = store.get('genK', 'coin'), genBuf = null, genMode = store.get('genM', 'retro');
const GDEF = Object.fromEntries(G.PARAMS.flatMap(([, ps]) => ps.map(([k, label, signed, hint]) => [k, { label, min: signed ? -1 : 0, max: 1, step: 0.01, def: G.defaults()[k], unit: '', hint }])));
GDEF.sound_vol = { label: 'Volume', min: 0, max: 1, step: 0.01, def: 0.5, unit: '' };
const AMBP = { dur: { label: 'Duração', min: 2, max: 30, step: 1, def: 8, unit: 's' }, intensity: { label: 'Intensidade', min: 0, max: 1, step: 0.01, def: 0.5, unit: '' }, tone: { label: 'Tom', min: 0, max: 1, step: 0.01, def: 0.5, unit: '' } };
const UIP = { pitch: { label: 'Tom', min: -12, max: 12, step: 1, def: 0, unit: 'st' }, len: { label: 'Duração', min: 0.4, max: 2.5, step: 0.05, def: 1, unit: 'x' }, timbre: { label: 'Timbre', min: 0, max: 3, step: 1, def: 0, unit: '', labels: ['Seno', 'Triângulo', 'Quadrada', 'Serra'] } };
const STP = { weight: { label: 'Peso', min: 0, max: 1, step: 0.01, def: 0.5, unit: '' }, hard: { label: 'Dureza', min: 0, max: 1, step: 0.01, def: 0.5, unit: '' } };
const SYNP = {
  wave: { label: 'Onda', min: 0, max: 3, step: 1, def: 3, unit: '', labels: P.SYN_WAVES }, octave: { label: 'Oitava', min: -2, max: 2, step: 1, def: 0, unit: '' },
  attack: { label: 'Ataque', min: 1, max: 2000, step: 1, def: 5, unit: 'ms', log: 1 }, decay: { label: 'Decaimento', min: 10, max: 3000, step: 1, def: 200, unit: 'ms', log: 1 },
  sustain: { label: 'Sustentação', min: 0, max: 1, step: 0.01, def: 0.6, unit: '' }, release: { label: 'Soltura', min: 10, max: 4000, step: 1, def: 250, unit: 'ms', log: 1 },
  cutoff: { label: 'Filtro', min: 80, max: 18000, step: 1, def: 3000, unit: 'Hz', log: 1 }, reso: { label: 'Ressonância', min: 0.1, max: 20, step: 0.1, def: 2, unit: '' },
  fenv: { label: 'Envelope do filtro', min: 0, max: 1, step: 0.01, def: 0.5, unit: '' }, detune: { label: 'Desafinação', min: 0, max: 50, step: 1, def: 8, unit: 'cents' },
};
const genState = { amb: { kind: 'rain', dur: 8, intensity: 0.5, tone: 0.5 }, ui: { kind: 'confirm', pitch: 0, len: 1, timbre: 0 }, steps: { kind: 'wood', weight: 0.5, hard: 0.5 }, syn: { ...P.synthDefaults() }, ...store.get('genS', {}) };
const saveGenState = () => store.set('genS', genState);
async function saveGenClip(buf, name, extra = {}) {
  const clip = newClip(name, D.encodeWav(buf));
  clip.dur = buf.duration; clip.thumb = thumbOf(buf); clip.tags = ['gerado'];
  Object.assign(clip, extra.clip || {}); Object.assign(clip.edits, extra.edits || {});
  await put('clips', clip);
  return clip;
}
const GMODES = [['retro', 'retro', 'Retrô'], ['amb', 'amb', 'Ambiente'], ['ui', 'ui', 'Interface'], ['steps', 'steps', 'Passos'], ['syn', 'keyboard', 'Sintetizador']];
function generator() {
  app.innerHTML = `
    <header class="top"><h1>Gerador</h1><button class="ibtn" id="setBtn" aria-label="Configurações">${ic('gear')}</button></header>
    <div class="gmodes" role="tablist">${GMODES.map(([m, i, l]) => `<button data-g="${m}" aria-pressed="${m === genMode}">${ic(i)}<span>${l}</span></button>`).join('')}</div>
    <div id="gbody" class="gbody"></div>`;
  $('#setBtn').onclick = openSettings;
  $$('.gmodes button').forEach((b) => b.onclick = () => { stop(); genMode = b.dataset.g; store.set('genM', genMode); generator(); });
  ({ retro: genRetro, amb: genAmb, ui: genUI, steps: genSteps, syn: genSynth }[genMode] || genRetro)($('#gbody'));
}
const savedMsg = (el, clip) => { el.innerHTML = `Salvo como "${esc(clip.name)}". <button class="tbtn sm" id="gOpen">Abrir no editor</button>`; $('#gOpen', el).onclick = () => editor(clip); toast(`Salvo como "${clip.name}"`); };
function genRetro(el) {
  el.innerHTML = `
    <p class="hint">Sons de videogame antigo. Cada toque gera uma versão nova; ajuste os controles e salve.</p>
    <div class="kinds">${Object.entries(G.KINDS).map(([k, [l]]) => `<button class="kind ${k === genKind ? 'is' : ''}" data-k="${k}">${ic(k === 'random' ? 'dice' : k)}<span>${l}</span></button>`).join('')}</div>
    <div class="wavebox gen"><canvas id="gwv"></canvas></div>
    <div class="genacts"><button class="primary" id="gPlay">${ic('play')}Tocar</button><button id="gMut">${ic('mutate')}Variar</button><button id="gSave">${ic('plus')}Salvar</button></div>
    <p class="hint" id="gInfo"></p>
    <section><h2>Forma de onda</h2><div class="seg" id="gWave">${G.WAVES.map((w, i) => `<button data-w="${i}" aria-pressed="${gen.wave_type === i}">${w}</button>`).join('')}</div>
      <div class="sliders">${sliderRow('sound_vol', GDEF.sound_vol, gen.sound_vol)}</div></section>
    ${G.PARAMS.map(([g, ps], gi) => `<details class="card" ${gi < 2 ? 'open' : ''}><summary>${g}</summary><div class="sliders">${ps.map(([k]) => sliderRow(k, GDEF[k], gen[k])).join('')}</div>
      <dl class="ghints">${ps.map(([, l, , h]) => `<dt>${l}</dt><dd>${h}</dd>`).join('')}</dl></details>`).join('')}`;
  const regen = (autoPlay = true) => {
    genBuf = G.synth(gen);
    store.set('genP', gen); store.set('genK', genKind);
    drawWave($('#gwv'), genBuf, { color: col().accent });
    $('#gInfo').textContent = `${fmt(genBuf.duration)} · pico ${db2(D.peakOf(genBuf))} dB`;
    if (autoPlay) play(genBuf);
  };
  let t;
  const soon = () => { clearTimeout(t); t = setTimeout(() => regen(true), 140); };
  $$('.kind', el).forEach((b) => b.onclick = () => { genKind = b.dataset.k; gen = G.KINDS[genKind][1](); genRetro(el); regen(true); });
  $('#gPlay').onclick = () => { if (!genBuf) regen(false); play(genBuf); };
  $('#gMut').onclick = () => { gen = G.mutate(gen); genRetro(el); regen(true); };
  $$('#gWave button').forEach((b) => b.onclick = () => { gen.wave_type = +b.dataset.w; $$('#gWave button').forEach((x) => x.setAttribute('aria-pressed', x === b)); soon(); });
  bindSliders(el, GDEF, (k) => gen[k], (k, v) => { gen[k] = v; }, soon);
  $('#gSave').onclick = async () => {
    if (!genBuf) regen(false);
    const n = (await all('clips')).filter((c) => c.gen).length + 1;
    savedMsg($('#gInfo'), await saveGenClip(genBuf, `${G.KINDS[genKind][0]} ${pad2(n)}`, { clip: { gen: clone(gen) } }));
  };
  new ResizeObserver(() => genBuf && $('#gwv') && drawWave($('#gwv'), genBuf, { color: col().accent })).observe($('#gwv'));
  keyHandler = (ev) => { if (ev.key === ' ') { ev.preventDefault(); if (playing) stop(); else $('#gPlay').click(); } else if (ev.key === 'Enter') $('#gMut').click(); };
  regen(false);
}
// tela genérica para geradores assíncronos (ambiente, interface, passos)
function genSimple(el, { state, kinds, defs, intro, make, nameOf, extraSave, onSaved, autoplay = true, multi }) {
  el.innerHTML = `
    <p class="hint">${intro}</p>
    <div class="kinds">${Object.entries(kinds).map(([k, l]) => `<button class="kind ${k === state.kind ? 'is' : ''}" data-k="${k}">${ic(k in P.AMB ? k : k in P.STEPS ? 'steps' : 'ui')}<span>${l}</span></button>`).join('')}</div>
    <div class="wavebox gen"><canvas id="gwv"></canvas></div>
    <div class="genacts"><button class="primary" id="gPlay">${ic('play')}Tocar</button><button id="gNew">${ic('dice')}Outro</button><button id="gSave">${ic('plus')}Salvar</button></div>
    ${multi ? `<button class="wide" id="gMulti">${ic('dice')}${multi}</button>` : ''}
    <p class="hint" id="gInfo"></p>
    <section><div class="sliders">${Object.entries(defs).map(([k, p]) => sliderRow(k, p, state[k])).join('')}</div></section>`;
  let buf = null, busy = 0;
  const regen = async (autoPlay = autoplay) => {
    const my = ++busy;
    $('#gInfo').textContent = 'Gerando…';
    const b = await make(state);
    if (my !== busy || !$('#gwv')) return;
    buf = b; genBuf = b;
    drawWave($('#gwv'), b, { color: col().accent });
    $('#gInfo').textContent = `${fmt(b.duration)} · pico ${db2(D.peakOf(b))} dB`;
    if (autoPlay) play(b);
  };
  let t;
  $$('.kind', el).forEach((b) => b.onclick = () => { state.kind = b.dataset.k; saveGenState(); $$('.kind', el).forEach((x) => x.classList.toggle('is', x === b)); regen(true); });
  bindSliders(el, defs, (k) => state[k], (k, v) => { state[k] = v; saveGenState(); }, () => { clearTimeout(t); t = setTimeout(() => regen(true), 250); });
  $('#gPlay').onclick = async () => { if (!buf) await regen(false); play(buf); };
  $('#gNew').onclick = () => regen(true);
  $('#gSave').onclick = async () => { if (!buf) await regen(false); const n = (await all('clips')).filter((c) => c.name.startsWith(nameOf(state))).length + 1; savedMsg($('#gInfo'), await saveGenClip(buf, `${nameOf(state)} ${pad2(n)}`, extraSave)); };
  if (multi) $('#gMulti').onclick = async () => {
    const ids = [], base = nameOf(state), n0 = (await all('clips')).filter((c) => c.name.startsWith(base)).length;
    for (let i = 0; i < 5; i++) { const c = await saveGenClip(await make(state), `${base} ${pad2(n0 + i + 1)}`, extraSave); c.created = Date.now() + i; await put('clips', c); ids.push(c.id); }
    onSaved && onSaved(ids);
  };
  new ResizeObserver(() => buf && $('#gwv') && drawWave($('#gwv'), buf, { color: col().accent })).observe($('#gwv'));
  regen(false);
}
function genAmb(el) {
  genSimple(el, { state: genState.amb, kinds: P.AMB, defs: AMBP, autoplay: true,
    intro: 'Ambientes contínuos para fundo de fase. Já saem marcados como loop, com emenda suave.',
    make: (s) => P.ambience(s.kind, s), nameOf: (s) => P.AMB[s.kind], extraSave: { edits: { loop: true, loopXf: 300 } } });
}
function genUI(el) {
  genSimple(el, { state: genState.ui, kinds: P.UI, defs: UIP,
    intro: 'Sons de menu e interface. Toque num tipo para ouvir; ajuste tom, duração e timbre.',
    make: (s) => P.uiSound(s.kind, s), nameOf: (s) => `UI ${P.UI[s.kind].toLowerCase()}` });
}
function genSteps(el) {
  genSimple(el, { state: genState.steps, kinds: P.STEPS, defs: STP,
    intro: 'Passos em vários pisos. Cada toque sai um pouco diferente, como passos de verdade.',
    make: (s) => P.footstep(s.kind, s), nameOf: (s) => `Passo ${P.STEPS[s.kind].toLowerCase()}`,
    multi: 'Gerar 5 passos diferentes e salvar',
    onSaved: (ids) => { selected = new Set(ids); toast('5 passos salvos e selecionados na Biblioteca'); setTab('lib'); render(); } });
}
function genSynth(el) {
  const S = genState.syn, KEYS = [];
  for (let m = 60; m < 84; m++) KEYS.push(m);
  const black = (m) => [1, 3, 6, 8, 10].includes(m % 12);
  const whites = KEYS.filter((m) => !black(m)), names = ['Dó', '', 'Ré', '', 'Mi', 'Fá', '', 'Sol', '', 'Lá', '', 'Si'];
  el.innerHTML = `
    <p class="hint">Toque as teclas para ouvir. Ligue "Gravar" para registrar uma sequência, depois salve como som.</p>
    <div class="kb">${whites.map((m) => `<button class="wk" data-m="${m}"><span>${names[m % 12]}${m % 12 === 0 ? (m / 12 - 1) : ''}</span></button>`).join('')}
      ${KEYS.filter(black).map((m) => { const wi = whites.filter((w) => w < m).length; return `<button class="bk" data-m="${m}" style="left:calc(${(wi / whites.length) * 100}% - ${100 / whites.length / 3}%)"></button>`; }).join('')}</div>
    <div class="genacts"><button id="sRec" aria-pressed="false">${ic('rec')}Gravar</button><button id="sPlay">${ic('play')}Ouvir</button><button class="primary" id="sSave">${ic('plus')}Salvar</button></div>
    <p class="hint" id="gInfo">Nada gravado. Salvar sem gravar guarda uma nota Dó.</p>
    <section><div class="sliders">${Object.entries(SYNP).map(([k, p]) => sliderRow(k, p, S[k])).join('')}</div></section>`;
  bindSliders(el, SYNP, (k) => S[k], (k, v) => { S[k] = v; saveGenState(); }, () => {});
  let recOn = false, rec0 = 0, notes = [];
  const live = new Map();
  const WAV = ['sine', 'triangle', 'square', 'sawtooth'];
  const start = (m) => {
    const c = D.ctx(), t0 = c.currentTime, f = 440 * Math.pow(2, (m + S.octave * 12 - 69) / 12), a = S.attack / 1000, dcy = S.decay / 1000;
    const g = c.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.35, t0 + a); g.gain.linearRampToValueAtTime(0.35 * S.sustain, t0 + a + dcy);
    const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = S.reso;
    fl.frequency.setValueAtTime(S.cutoff, t0); fl.frequency.linearRampToValueAtTime(Math.min(18000, S.cutoff * (1 + S.fenv * 6)), t0 + a); fl.frequency.exponentialRampToValueAtTime(Math.max(60, S.cutoff), t0 + a + dcy + 0.01);
    const oscs = (S.detune ? [-S.detune, S.detune] : [0]).map((det) => { const o = c.createOscillator(); o.type = WAV[Math.round(S.wave)]; o.frequency.value = f; o.detune.value = det; o.connect(fl); o.start(t0); return o; });
    fl.connect(g).connect(c.destination);
    live.set(m, { g, oscs, t: performance.now() });
  };
  const end = (m) => {
    const v = live.get(m); if (!v) return;
    live.delete(m);
    const c = D.ctx(), t = c.currentTime, r = S.release / 1000;
    v.g.gain.cancelScheduledValues(t); v.g.gain.setValueAtTime(v.g.gain.value, t); v.g.gain.linearRampToValueAtTime(0, t + r);
    v.oscs.forEach((o) => o.stop(t + r + 0.05));
    if (recOn) { notes.push({ m, t: (v.t - rec0) / 1000, d: Math.max(0.05, (performance.now() - v.t) / 1000) }); $('#gInfo').textContent = `${notes.length} nota(s) gravada(s).`; }
  };
  $$('.kb button', el).forEach((k) => {
    const m = +k.dataset.m;
    k.addEventListener('pointerdown', (e) => { e.preventDefault(); k.setPointerCapture(e.pointerId); k.classList.add('down'); start(m); });
    const up = () => { k.classList.remove('down'); end(m); };
    k.addEventListener('pointerup', up); k.addEventListener('pointercancel', up);
  });
  $('#sRec').onclick = (e) => {
    recOn = !recOn; e.currentTarget.setAttribute('aria-pressed', recOn);
    if (recOn) { notes = []; rec0 = performance.now(); $('#gInfo').textContent = 'Gravando: toque as teclas.'; }
    else $('#gInfo').textContent = notes.length ? `${notes.length} nota(s) gravada(s). Toque em Ouvir ou Salvar.` : 'Nada gravado.';
  };
  const render1 = async () => { const ns = notes.length ? notes.map((n) => ({ ...n, t: n.t - notes[0].t })) : [{ m: 60, t: 0, d: 0.5 }]; return P.synthNotes(ns, S); };
  $('#sPlay').onclick = async () => play(await render1());
  $('#sSave').onclick = async () => { const b = await render1(); const n = (await all('clips')).filter((c) => c.name.startsWith('Sintetizador')).length + 1; savedMsg($('#gInfo'), await saveGenClip(b, `Sintetizador ${pad2(n)}`)); };
}

// ---------- editor ----------
const views = new Map(), hists = new Map();
let clipboard = null, edTab = 'edit';
const LOOPXF = { label: 'Emenda', min: 0, max: 1000, step: 5, def: 80, unit: 'ms' };
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
  let sel = opt.sel || null, cur = opt.cur ?? null, rect = null, abFx = null, vz = opt.vz || 1, stereo = !!opt.stereo && orig.numberOfChannels > 1;
  clip.markers ||= [];
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
        <button class="ibtn sm" id="mkAdd" aria-label="Adicionar marcador">${ic('marker')}</button>
        <button class="ibtn sm vzb" id="vzBtn" aria-label="Zoom vertical">${vz}x</button>
        ${orig.numberOfChannels > 1 ? `<button class="ibtn sm" id="stBtn" aria-label="Ver esquerdo e direito separados" aria-pressed="${stereo}">${ic('stereo')}</button>` : ''}
        <button class="ibtn sm" id="zOut" aria-label="Afastar">${ic('minus')}</button>
        <button class="ibtn sm" id="zIn" aria-label="Aproximar">${ic('plus')}</button>
        <button class="ibtn sm" id="zSel" aria-label="Zoom na seleção">${ic('focus')}</button>
        <button class="ibtn sm" id="zAll" aria-label="Ver tudo">${ic('fit')}</button>
      </div>
      <div class="ctx" id="ctx"></div>
      <div class="transport">
        <span class="clock" id="clock">0:00.000</span>
        <button id="pO">${ic('play')}Original</button>
        <button id="pF" class="primary">${ic('play')}Com efeitos</button>
        <button id="pL" class="ibtn" aria-label="Repetir em loop" aria-pressed="${loopOn}">${ic('loop')}</button>
        <button id="pS" class="ibtn" aria-label="Parar">${ic('stop')}</button>
      </div>
      <div class="outbox"><canvas id="wo"></canvas><span id="fxState" class="hint">Com o loop ligado, os ajustes tocam na hora.</span></div>
    </div>
    <div class="edpanel" id="panel"></div>
    <aside class="edlib" id="edlib"></aside>
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
  const rerender = (extra = {}) => { const ps = $('#panel')?.scrollTop || 0; return editor(clip, { mode, spec, loop: loopOn, vz, stereo, ...extra }).then(() => { const p = $('#panel'); if (p) p.scrollTop = ps; }); };
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
  document.title = `${clip.name} — Farelo`;
  $('#cname').oninput = (ev) => { clip.name = ev.target.value || 'Sem nome'; document.title = `${clip.name} — Farelo`; save(); };

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
      c.innerHTML = `<div class="acts-row">${A('aCut', 'cut', 'Recortar', !sel)}${A('aCopy', 'copy', 'Copiar', !sel)}${A('aPaste', 'paste', 'Colar', !canPaste || (!sel && cur == null))}${A('aDel', 'trash', 'Apagar', !sel)}${A('aSil', 'silence', 'Silenciar', !sel)}${A('aNorm', 'norm', 'Normalizar', !sel)}${A('aFx', 'fx', 'Efeito', !sel)}${A('aNew', 'newclip', 'Novo som', !sel)}</div>`;
      $('#aCut').onclick = () => { doCopy(); doDelete(true); toast('Recortado'); };
      $('#aCopy').onclick = doCopy; $('#aPaste').onclick = doPaste; $('#aDel').onclick = () => doDelete(); $('#aSil').onclick = doSilence; $('#aNorm').onclick = () => { if (!sel) return; addOp({ type: 'norm', a: sel.a, b: sel.b }); toast('Trecho normalizado'); rerender({ sel }); }; $('#aFx').onclick = doRegionFx; $('#aNew').onclick = doNewClip;
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
    drawWave(wv, orig, { v0: V.v0, v1: V.v1, start: e.start, end: e.end, pos, spec, segs, ruler: true, dur, handles: mode === 'trim', env: mode === 'env' ? e.env : null, envSel, sel: mode === 'sel' ? sel : null, cur: mode === 'sel' && !sel ? cur : null, rect: mode === 'fix' ? rect : null, vz, stereo, markers: clip.markers });
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
  $('#vzBtn').onclick = (ev) => { vz = vz >= 8 ? 1 : vz * 2; ev.currentTarget.textContent = vz + 'x'; redraw(); };
  if ($('#stBtn')) $('#stBtn').onclick = (ev) => { stereo = !stereo; ev.currentTarget.setAttribute('aria-pressed', stereo); redraw(); };
  $('#mkAdd').onclick = () => {
    const t = playing?.tag === 'orig' ? playPos() : sel ? sel.a : cur ?? (V.v0 + V.v1) / 2;
    const s = sheet('Novo marcador', `<p class="hint">Em ${fmt(t)}. Marcadores ajudam a achar partes de uma gravação longa.</p><div class="row"><input id="mkName" value="Marcador ${clip.markers.length + 1}" autocomplete="off"><button class="primary" id="mkOk">Salvar</button></div>`, { icon: 'marker' });
    const ok = () => { clip.markers.push({ id: uid(), t, name: $('#mkName', s.body).value.trim() || 'Marcador' }); clip.markers.sort((x, y) => x.t - y.t); save(); s.close(); redraw(); if (edTab === 'edit') showPanel('edit'); toast('Marcador criado'); };
    $('#mkOk', s.body).onclick = ok; $('#mkName', s.body).onkeydown = (e) => { if (e.key === 'Enter') ok(); };
    setTimeout(() => $('#mkName', s.body)?.select(), 50);
  };
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
      <div class="loopbox" id="lpBox" ${e.loop ? '' : 'hidden'}>
        <p class="hint">O WAV sai marcado como loop. No Godot, mantenha "Loop Mode" em "Detect From WAV". Para OGG, ligue "Loop" na importação.</p>
        <div class="sliders">${sliderRow('loopXf', LOOPXF, e.loopXf || 0)}</div>
        <div class="row"><button id="lpBest">${ic('loop')}Achar melhor ponto de emenda</button></div>
        <p class="hint">A emenda funde o fim no começo para não ter clique. Use o botão ⟳ e "Com efeitos" para ouvir repetindo. Evite fades em sons de loop.</p>
      </div>
      <div class="sliders">${sliderRow('fadeIn', FADE.fadeIn, e.fadeIn)}${sliderRow('fadeOut', FADE.fadeOut, e.fadeOut)}</div>
      <div class="row wrap"><button id="autoTrim">${ic('scissorsTrim')}Cortar silêncio</button><button id="resetTrim">Desfazer corte</button></div>
      ${e.ops.length ? `<div class="banner sm"><span>${e.ops.length} edição(ões) de trecho neste som.</span><button class="tbtn sm" id="clrOps">Remover todas</button></div>` : ''}
      <label class="field">Tags <input id="tags" value="${esc(clip.tags.join(', '))}" placeholder="ex.: passos, floresta" autocomplete="off"></label>
      <div class="markers"><h3 class="gh">Marcadores</h3>${clip.markers.length ? clip.markers.map((m) => `<div class="row mk" data-id="${m.id}"><button class="ibtn sm mkgo" aria-label="Tocar a partir de ${esc(m.name)}">${ic('play')}</button><input value="${esc(m.name)}" aria-label="Nome do marcador"><span class="mkt">${fmt(m.t)}</span><button class="ibtn sm mkdel" aria-label="Apagar marcador">${ic('trash')}</button></div>`).join('') : `<p class="hint">Nenhum marcador. Use o botão ${ic('marker')} acima da onda.</p>`}</div>`,
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
    export: () => `${DESK && clip.godot ? `<div class="banner sm ${godotChanged(clip) ? '' : 'ok'}"><span>No projeto Godot: <b>res://${esc(clip.godot.sub ? clip.godot.sub + '/' : '')}${esc(clip.godot.file)}</b>${godotChanged(clip) ? ' · mudou desde a última vez' : ' · em dia'}</span><button class="tbtn sm primary" id="reexp">${ic('export')}Atualizar</button></div>` : ''}${exportPanel('eexp', { godot: false })}<button class="ghost danger wide" id="delC">${ic('trash')}Apagar som</button>`,
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
      $('#lp').onchange = (ev) => { e.loop = ev.target.checked; if (e.loop && e.loopXf == null) e.loopXf = 80; $('#lpBox').hidden = !e.loop; if (e.loop) showPanel('edit'); dirty(); };
      if (e.loop) {
        bindSliders($('#lpBox'), { loopXf: LOOPXF }, (k) => e[k] || 0, (k, v) => { e[k] = v; }, dirty);
        $('#lpBest').onclick = () => { const ne = D.bestLoopEnd(orig, e.start, e.end); const d = ne - e.end; e.end = Math.min(dur, ne); redraw(); dirty(); toast(`Ponto de emenda ajustado (${d >= 0 ? '+' : ''}${(d * 1000).toFixed(0)} ms)`); };
      }
      $$('.mk', el).forEach((row) => {
        const m = clip.markers.find((x) => x.id === row.dataset.id);
        $('input', row).onchange = (ev) => { m.name = ev.target.value.trim() || m.name; save(); redraw(); };
        $('.mkgo', row).onclick = () => { if (zoomed() && (m.t < V.v0 || m.t > V.v1)) { const s2 = V.v1 - V.v0; V.v0 = m.t - s2 / 4; V.v1 = V.v0 + s2; clampV(); } play(orig, { from: m.t, to: dur, tag: 'orig', onEnd: redraw }); startAnim(); };
        $('.mkdel', row).onclick = () => { clip.markers = clip.markers.filter((x) => x !== m); save(); redraw(); showPanel('edit'); };
      });
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
      bindExport($('#eexp'), async () => [{ buf: await processed(clip), name: clip.name, loop: e.loop, clip }]);
      if ($('#reexp')) $('#reexp').onclick = async (ev) => { ev.currentTarget.disabled = true; try { await reexportClip(clip); toast(`Atualizado no projeto: ${clip.godot.sub ? clip.godot.sub + '/' : ''}${clip.godot.file}`); showPanel('export'); } catch (err) { toast(err.message); ev.currentTarget.disabled = false; } };
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

  // ----- lista lateral (telas largas) -----
  all('clips').then((cs) => {
    const el = $('#edlib'); if (!el) return;
    cs.sort(SORTS[store.get('sort', 'recent')]?.[1] || SORTS.recent[1]);
    el.innerHTML = `<h3 class="gh">Biblioteca</h3><ul>${cs.map((c) => `<li><button data-id="${c.id}" class="${c.id === clip.id ? 'is' : ''}"><canvas class="th"></canvas><span>${esc(c.name)}</span></button></li>`).join('')}</ul>`;
    $$('button', el).forEach((b) => { const c = cs.find((x) => x.id === b.dataset.id); if (c?.thumb) requestAnimationFrame(() => drawThumb($('.th', b), c.thumb)); b.onclick = () => { if (c.id !== clip.id) { if (commitT) commitNow(); editor(c); } }; });
    $('button.is', el)?.scrollIntoView({ block: 'center' });
  });

  // ----- relógio, roda do mouse e cursor -----
  const fmtClock = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}`;
  const tickClock = () => { const c = $('#clock'); if (!c) return; const p = playPos(); c.textContent = fmtClock(p ?? (sel ? sel.a : cur ?? e.start)); c.classList.toggle('on', p != null); requestAnimationFrame(tickClock); };
  tickClock();
  wv.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const s = V.v1 - V.v0;
    if (ev.shiftKey || Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) { const d = (ev.shiftKey ? ev.deltaY : ev.deltaX) / wv.clientWidth * s; V.v0 += d; V.v1 += d; clampV(); redraw(); return; }
    const t = xToT(ev.clientX), f = Math.exp(ev.deltaY * 0.0015), ns = Math.max(minSpan, Math.min(dur, s * f)), r = (t - V.v0) / s;
    V.v0 = t - r * ns; V.v1 = V.v0 + ns; clampV(); redraw();
  }, { passive: false });
  wv.addEventListener('mousemove', (ev) => {
    if (g) return;
    const x = ev.clientX - wv.getBoundingClientRect().left;
    let cs = 'pointer';
    if (mode === 'trim') cs = Math.min(Math.abs(x - tToX(e.start)), Math.abs(x - tToX(e.end))) < 30 ? 'ew-resize' : 'pointer';
    else if (mode === 'sel') cs = sel && Math.min(Math.abs(x - tToX(sel.a)), Math.abs(x - tToX(sel.b))) < 24 ? 'ew-resize' : 'text';
    else if (mode === 'fix') cs = 'crosshair';
    else if (mode === 'env') cs = 'copy';
    wv.style.cursor = cs;
  });

  // ----- atalhos do editor -----
  keyHandler = (ev) => {
    const k = ev.key, ctrl = ev.ctrlKey || ev.metaKey, lk = k.toLowerCase();
    const act = (id) => { const b = $(id); if (b && !b.disabled) b.click(); };
    if (k === ' ') { ev.preventDefault(); if (playing) { stop(); redraw(); } else act(ev.shiftKey ? '#pO' : '#pF'); }
    else if (ctrl && lk === 'z' && !ev.shiftKey) { ev.preventDefault(); act('#undo'); }
    else if (ctrl && (lk === 'y' || (lk === 'z' && ev.shiftKey))) { ev.preventDefault(); act('#redo'); }
    else if (ctrl && lk === 's') { ev.preventDefault(); if (DESK) { showPanel('export'); setTimeout(() => act('#eexp [data-act=godot]'), 30); } else showPanel('export'); }
    else if (ctrl && lk === 'a') { ev.preventDefault(); setMode('sel'); sel = { a: 0, b: dur }; renderCtx(); redraw(); }
    else if (ctrl && lk === 'c') { if (mode === 'sel' && sel) { ev.preventDefault(); act('#aCopy'); } }
    else if (ctrl && lk === 'x') { if (mode === 'sel' && sel) { ev.preventDefault(); act('#aCut'); } }
    else if (ctrl && lk === 'v') { if (mode === 'sel') { ev.preventDefault(); act('#aPaste'); } }
    else if (ctrl) return;
    else if (k === 'Delete') { if (mode === 'sel' && sel) { ev.preventDefault(); act('#aDel'); } else if (mode === 'env' && envSel >= 0) act('#envDel'); else if (mode === 'fix' && rect) act('#fixGo'); }
    else if (k === 'Escape') { sel = null; rect = null; envSel = -1; renderCtx(); redraw(); }
    else if (['1', '2', '3', '4'].includes(k)) setMode(['trim', 'sel', 'env', 'fix'][+k - 1]);
    else if (lk === 'l') act('#pL');
    else if (lk === 'm') act('#mkAdd');
    else if (k === '+' || k === '=') act('#zIn');
    else if (k === '-') act('#zOut');
    else if (k === '0') act('#zAll');
    else if (lk === 'e') showPanel('export');
    else if (k === 'Backspace') { ev.preventDefault(); act('#back'); }
  };
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
  mix.tracks.forEach((t) => { t.chain ||= []; t.trimS ||= 0; t.trimE ||= 0; t.fadeIn ||= 0; t.fadeOut ||= 0; t.auto ||= { vol: [], pan: [], cut: [] }; });
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
    return mix.tracks.filter((t) => bufOf(t) && !t.mute && (!solo || t.solo)).map((t) => ({ buf: bufOf(t), offset: t.offset, vol: t.vol, pan: t.pan, auto: t.auto }));
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
    <p class="hint" id="mInfo">Arraste os blocos para mudar o início; arraste a borda de um bloco para cortar o começo ou o fim. Espaço toca.</p>
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
  const edgeAt = (ev) => {
    const r = tl.getBoundingClientRect(), i = Math.floor((ev.clientY - r.top - 20) / ROW), t = mix.tracks[i], b = t && bufOf(t);
    if (!b) return { t };
    const x = ev.clientX - r.left, bx = t.offset * scale, ex = bx + b.duration * scale;
    return { t, edge: Math.abs(x - bx) < 8 ? 'l' : Math.abs(x - ex) < 8 ? 'r' : null };
  };
  tl.onpointerdown = (ev) => {
    const { t, edge } = edgeAt(ev);
    if (!t) return;
    dragT = { t, x0: ev.clientX, o0: t.offset, edge, s0: t.trimS, e0: t.trimE, full: tb.get(t.id)?.full || 1 };
    tl.setPointerCapture(ev.pointerId);
  };
  tl.onpointermove = (ev) => {
    if (!dragT) { const { edge } = edgeAt(ev); tl.style.cursor = edge ? 'ew-resize' : 'grab'; return; }
    const d = (ev.clientX - dragT.x0) / scale, t = dragT.t;
    if (dragT.edge === 'l') {
      const ns = Math.max(0, Math.min(dragT.full - dragT.e0 - 0.02, dragT.s0 + d));
      t.trimS = +ns.toFixed(3); t.offset = Math.max(0, +(dragT.o0 + (ns - dragT.s0)).toFixed(3));
    } else if (dragT.edge === 'r') {
      t.trimE = +Math.max(0, Math.min(dragT.full - dragT.s0 - 0.02, dragT.e0 - d)).toFixed(3);
    } else {
      const nv = Math.max(0, +snapT(dragT.o0 + d).toFixed(3));
      if (nv !== t.offset && mix.grid && settings.vib) navigator.vibrate?.(4);
      t.offset = nv;
    }
    if (dragT.edge) { clearTimeout(dragT.rt); dragT.rt = setTimeout(async () => { await trackBuf(t); drawTL(); }, 60); }
    drawTL();
    const card = $(`#tracks .trk[data-i="${mix.tracks.indexOf(t)}"]`);
    if (card) for (const k of ['offset', 'trimS', 'trimE']) { const row = $(`.prm[data-k=${k}]`, card); if (!row) continue; const inp = $('input', row); if (k === 'offset') inp.max = Math.max(+inp.max, Math.ceil(t.offset + 1)); inp.value = t[k]; $('.val', row).textContent = fmt(t[k]); }
  };
  tl.onpointerup = tl.onpointercancel = async () => { if (dragT) { const t = dragT.t, ed = dragT.edge; dragT = null; if (ed) { await trackBuf(t); drawTL(); } save(); } };

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
        <details class="autobox"><summary>Automação${['vol', 'pan', 'cut'].some((k) => t.auto[k].length) ? ' <em class="dot"></em>' : ''}</summary>
          <div class="seg autoseg"><button data-a="vol" aria-pressed="true">Volume</button><button data-a="pan" aria-pressed="false">Pan</button><button data-a="cut" aria-pressed="false">Filtro</button></div>
          <canvas class="autocv"></canvas>
          <div class="ctxline"><span class="hint ainfo">Toque para criar pontos ao longo da mixagem; arraste para ajustar.</span><button class="tbtn sm adel" disabled>${ic('trash')}Ponto</button><button class="tbtn sm aclr">Limpar</button></div>
        </details>
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
      autoUI(card, t, +card.dataset.i);
    });
    drawTL();
  };
  const AUTO = { vol: ['Volume', (v) => `${Math.round(v * 200)}%`, 0.5], pan: ['Pan', (v) => panTxt(+(v * 2 - 1).toFixed(2)), 0.5], cut: ['Filtro', (v) => { const f = 100 * Math.pow(200, v); return f >= 1000 ? (f / 1000).toFixed(1) + ' kHz' : Math.round(f) + ' Hz'; }, 1] };
  function autoUI(card, t, idx) {
    const box = $('.autobox', card), cv = $('.autocv', box);
    let param = 'vol', selI = -1, drag = null;
    const pts = () => t.auto[param];
    const draw = () => {
      const s = setupCanvas(cv); if (!s) return;
      const { x, w, h } = s, T = total(), b = bufOf(t);
      x.fillStyle = cssv('--panel2'); x.fillRect(0, 0, w, h);
      if (b) { x.fillStyle = cssv(COLORS[idx % COLORS.length]); x.globalAlpha = 0.18; x.fillRect((t.offset / T) * w, 0, (b.duration / T) * w, h); x.globalAlpha = 1; }
      x.fillStyle = cssv('--line'); x.fillRect(0, h / 2, w, 1);
      const P2 = (p) => [(p.t / T) * w, (1 - p.v) * h], ps = pts();
      x.strokeStyle = cssv('--accent'); x.lineWidth = 2; x.beginPath();
      if (!ps.length) { x.setLineDash([5, 5]); const y = (1 - AUTO[param][2]) * h; x.moveTo(0, y); x.lineTo(w, y); x.stroke(); x.setLineDash([]); }
      else { x.moveTo(0, P2(ps[0])[1]); ps.forEach((p) => x.lineTo(...P2(p))); x.lineTo(w, P2(ps[ps.length - 1])[1]); x.stroke(); ps.forEach((p, i) => { const [px, py] = P2(p); x.beginPath(); x.arc(px, py, i === selI ? 9 : 6, 0, 7); x.fillStyle = i === selI ? cssv('--fg') : cssv('--accent'); x.fill(); }); }
      const p = ps[selI];
      $('.ainfo', box).textContent = p ? `${AUTO[param][0]}: ${AUTO[param][1](p.v)} em ${fmt(p.t)}` : `${AUTO[param][0]}: toque para criar pontos ao longo da mixagem.`;
      $('.adel', box).disabled = !p;
    };
    box.addEventListener('toggle', () => box.open && draw());
    $$('.autoseg button', box).forEach((bt) => bt.onclick = () => { param = bt.dataset.a; selI = -1; $$('.autoseg button', box).forEach((z) => z.setAttribute('aria-pressed', z === bt)); draw(); });
    const at = (ev) => { const r = cv.getBoundingClientRect(); return { t: Math.max(0, ((ev.clientX - r.left) / r.width) * total()), v: Math.max(0, Math.min(1, 1 - (ev.clientY - r.top) / r.height)), x: ev.clientX - r.left, y: ev.clientY - r.top, w: r.width, h: r.height }; };
    cv.onpointerdown = (ev) => {
      cv.setPointerCapture(ev.pointerId);
      const q = at(ev), T = total();
      const hit = pts().findIndex((p) => Math.hypot((p.t / T) * q.w - q.x, (1 - p.v) * q.h - q.y) < 22);
      drag = { i: hit, moved: false, x0: q.x }; if (hit >= 0) { selI = hit; draw(); }
    };
    cv.onpointermove = (ev) => {
      if (!drag || drag.i < 0) return;
      const q = at(ev); if (Math.abs(q.x - drag.x0) > 3) drag.moved = true;
      const ps = pts(), p = ps[drag.i], lo = ps[drag.i - 1]?.t ?? 0, hi = ps[drag.i + 1]?.t ?? Infinity;
      p.t = +Math.max(lo + 0.001, Math.min(hi - 0.001, q.t)).toFixed(3); p.v = +q.v.toFixed(3); drag.moved = true; draw();
    };
    cv.onpointerup = (ev) => {
      if (!drag) return;
      if (drag.i < 0) { const q = at(ev), p = { t: +q.t.toFixed(3), v: +q.v.toFixed(3) }; pts().push(p); pts().sort((m, n) => m.t - n.t); selI = pts().indexOf(p); }
      drag = null; save(); draw();
    };
    $('.adel', box).onclick = () => { if (selI >= 0) { pts().splice(selI, 1); selI = -1; save(); draw(); } };
    $('.aclr', box).onclick = () => { t.auto[param] = []; selI = -1; save(); draw(); };
  }
  drawTracks();
  const addTrack = async (clipId, extra = {}) => {
    const t = { id: uid(), clipId, offset: 0, vol: 1, pan: 0, mute: false, solo: false, chain: [], trimS: 0, trimE: 0, fadeIn: 0, fadeOut: 0, auto: { vol: [], pan: [], cut: [] }, ...extra };
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
  keyHandler = (ev) => { if (ev.key === ' ') { ev.preventDefault(); if (playing) { stop(); drawTL(); } else $('#mp').click(); } else if (ev.key === 'Backspace') { ev.preventDefault(); $('#back').click(); } };
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
(async () => {
  if (DESK) {
    try {
      if (!deskCfg.lib) { deskCfg.lib = DESK.join(await DESK.docsDir(), 'Farelo'); saveDesk(); }
      const fresh = !(await DESK.exists(deskCfg.lib));
      await syncFromDisk();
      if (fresh) pushAllToDisk().catch(() => {});
      DESK.onOpenFiles((ps) => importPaths(ps, true));
      DESK.onUpdate(updStatus);
    } catch (e) { console.warn('início', e); }
  }
  render();
  if (DESK) { const pend = await DESK.pendingFiles().catch(() => []); if (pend.length) importPaths(pend, true); }
})();
if (!store.get('tour', 0)) setTimeout(tour, 400);
