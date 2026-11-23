// Motor do Estúdio de Música: instrumentos, bateria, efeitos em tempo real, agendador e renderização.
import * as D from './dsp.js';

// ---------- teoria ----------
export const NOTE_NAMES = ['Dó', 'Dó#', 'Ré', 'Ré#', 'Mi', 'Fá', 'Fá#', 'Sol', 'Sol#', 'Lá', 'Lá#', 'Si'];
export const noteName = (m) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
export const SCALES = {
  major: ['Maior', [0, 2, 4, 5, 7, 9, 11]], minor: ['Menor', [0, 2, 3, 5, 7, 8, 10]], harmonic: ['Menor harmônica', [0, 2, 3, 5, 7, 8, 11]],
  dorian: ['Dórico', [0, 2, 3, 5, 7, 9, 10]], phrygian: ['Frígio', [0, 1, 3, 5, 7, 8, 10]], lydian: ['Lídio', [0, 2, 4, 6, 7, 9, 11]],
  mixolydian: ['Mixolídio', [0, 2, 4, 5, 7, 9, 10]], pentaMaj: ['Pentatônica maior', [0, 2, 4, 7, 9]], pentaMin: ['Pentatônica menor', [0, 3, 5, 7, 10]],
  blues: ['Blues', [0, 3, 5, 6, 7, 10]], chromatic: ['Cromática', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]],
};
export const inScale = (m, key, scale) => SCALES[scale][1].includes((((m - key) % 12) + 12) % 12);
export const CHORDS = { maj: ['Maior', [0, 4, 7]], min: ['Menor', [0, 3, 7]], dim: ['Diminuto', [0, 3, 6]], aug: ['Aumentado', [0, 4, 8]], sus2: ['Sus2', [0, 2, 7]], sus4: ['Sus4', [0, 5, 7]], d7: ['Com sétima', [0, 4, 7, 10]], maj7: ['Sétima maior', [0, 4, 7, 11]], m7: ['Menor com sétima', [0, 3, 7, 10]], pow: ['Power (quinta)', [0, 7, 12]] };
// acorde formado pela escala a partir de uma nota (tríade ou tétrade diatônica)
export function diatonic(root, key, scale, size = 3) {
  const sc = SCALES[scale][1];
  if (sc.length < 7) return [root, root + 7];
  const deg = sc.indexOf((((root - key) % 12) + 12) % 12);
  if (deg < 0) return [root, root + 4, root + 7];
  const out = [];
  for (let i = 0; i < size; i++) { const d = deg + i * 2, oct = Math.floor(d / 7); out.push(root - sc[deg] + sc[d % 7] + 12 * oct); }
  return out;
}
export const PROGRESSIONS = [
  ['I – V – vi – IV (pop, aventura)', [0, 4, 5, 3]], ['vi – IV – I – V (emotivo)', [5, 3, 0, 4]], ['I – vi – IV – V (clássico)', [0, 5, 3, 4]],
  ['i – VI – III – VII (épico menor)', [0, 5, 2, 6]], ['i – iv – v – i (sombrio)', [0, 3, 4, 0]], ['ii – V – I – I (jazz)', [1, 4, 0, 0]],
  ['I – IV – I – V (vila, alegre)', [0, 3, 0, 4]], ['i – VII – VI – VII (batalha)', [0, 6, 5, 6]],
];
// grau (0..6) da escala → nota base na oitava escolhida
export const degreeRoot = (deg, key, scale, base = 48) => { const sc = SCALES[scale][1].length >= 7 ? SCALES[scale][1] : SCALES.major[1]; return base + key + sc[deg % 7] + 12 * Math.floor(deg / 7); };

// ---------- instrumentos (sintetizador) ----------
const SYN = { osc1: 'sawtooth', osc2: 'square', mix2: 0, detune: 6, sub: 0, noise: 0, fm: 0, fmRatio: 2, attack: 0.005, decay: 0.3, sustain: 0.6, release: 0.25, cutoff: 3000, reso: 1, fenv: 0.4, fdecay: 0.25, vibrato: 0, gain: 0.5, octave: 0 };
export const INSTRUMENTS = {
  piano: ['Piano elétrico', { osc1: 'sine', osc2: 'triangle', mix2: 0.3, detune: 3, fm: 1.2, fmRatio: 1, attack: 0.003, decay: 0.9, sustain: 0.15, release: 0.4, cutoff: 6000, fenv: 0.2, fdecay: 0.5, gain: 0.55 }],
  keys: ['Órgão', { osc1: 'sine', osc2: 'sine', mix2: 0.5, detune: 2, sub: 0.4, attack: 0.01, decay: 0.1, sustain: 0.9, release: 0.08, cutoff: 5000, fenv: 0, gain: 0.4, octave: 0 }],
  pluck: ['Pluck', { osc1: 'sawtooth', osc2: 'square', mix2: 0.3, detune: 8, attack: 0.002, decay: 0.25, sustain: 0, release: 0.2, cutoff: 900, reso: 3, fenv: 4, fdecay: 0.15, gain: 0.5 }],
  lead: ['Lead', { osc1: 'sawtooth', osc2: 'sawtooth', mix2: 0.6, detune: 12, attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.15, cutoff: 3500, reso: 2, fenv: 0.6, vibrato: 0.4, gain: 0.4 }],
  square: ['Chiptune (quadrada)', { osc1: 'square', osc2: 'square', mix2: 0, detune: 0, attack: 0.001, decay: 0.1, sustain: 0.7, release: 0.05, cutoff: 12000, fenv: 0, gain: 0.3 }],
  triangle: ['Chiptune baixo (triângulo)', { osc1: 'triangle', osc2: 'triangle', mix2: 0, detune: 0, attack: 0.001, decay: 0.1, sustain: 0.9, release: 0.04, cutoff: 12000, fenv: 0, gain: 0.6, octave: -1 }],
  bass: ['Baixo synth', { osc1: 'sawtooth', osc2: 'square', mix2: 0.4, detune: 4, sub: 0.6, attack: 0.004, decay: 0.25, sustain: 0.5, release: 0.12, cutoff: 500, reso: 4, fenv: 2.5, fdecay: 0.18, gain: 0.55, octave: -1 }],
  sub: ['Sub grave', { osc1: 'sine', osc2: 'triangle', mix2: 0.2, detune: 0, sub: 0, attack: 0.005, decay: 0.2, sustain: 0.9, release: 0.1, cutoff: 800, fenv: 0, gain: 0.7, octave: -1 }],
  pad: ['Pad', { osc1: 'sawtooth', osc2: 'sawtooth', mix2: 0.7, detune: 18, attack: 0.9, decay: 0.8, sustain: 0.8, release: 1.4, cutoff: 1400, reso: 1, fenv: 0.5, fdecay: 1.2, vibrato: 0.15, gain: 0.3 }],
  strings: ['Cordas', { osc1: 'sawtooth', osc2: 'sawtooth', mix2: 0.8, detune: 14, attack: 0.25, decay: 0.4, sustain: 0.85, release: 0.6, cutoff: 2600, reso: 0.7, fenv: 0.3, vibrato: 0.35, gain: 0.3 }],
  brass: ['Metais', { osc1: 'sawtooth', osc2: 'square', mix2: 0.4, detune: 7, attack: 0.06, decay: 0.3, sustain: 0.7, release: 0.2, cutoff: 1200, reso: 1.5, fenv: 2, fdecay: 0.2, vibrato: 0.2, gain: 0.4 }],
  bell: ['Sino', { osc1: 'sine', osc2: 'sine', mix2: 0.2, detune: 1, fm: 3, fmRatio: 3.5, attack: 0.002, decay: 1.6, sustain: 0, release: 1.2, cutoff: 9000, fenv: 0, gain: 0.45 }],
  flute: ['Flauta', { osc1: 'sine', osc2: 'triangle', mix2: 0.25, detune: 2, noise: 0.08, attack: 0.08, decay: 0.2, sustain: 0.85, release: 0.15, cutoff: 4000, fenv: 0.2, vibrato: 0.5, gain: 0.45, octave: 1 }],
  marimba: ['Marimba', { osc1: 'sine', osc2: 'sine', mix2: 0.3, fm: 1.5, fmRatio: 4, attack: 0.001, decay: 0.35, sustain: 0, release: 0.3, cutoff: 7000, fenv: 0, gain: 0.6 }],
  choir: ['Coral', { osc1: 'sawtooth', osc2: 'triangle', mix2: 0.6, detune: 10, noise: 0.03, attack: 0.5, decay: 0.5, sustain: 0.85, release: 0.9, cutoff: 1100, reso: 4, fenv: 0.2, vibrato: 0.3, gain: 0.35 }],
};
export const instParams = (name, over = {}) => ({ ...SYN, ...(INSTRUMENTS[name]?.[1] || {}), ...over });
export const SYN_DEFS = {
  osc1: { label: 'Onda 1', min: 0, max: 3, step: 1, def: 3, unit: '', labels: ['Seno', 'Triângulo', 'Quadrada', 'Serra'] },
  osc2: { label: 'Onda 2', min: 0, max: 3, step: 1, def: 2, unit: '', labels: ['Seno', 'Triângulo', 'Quadrada', 'Serra'] },
  mix2: { label: 'Mistura onda 2', min: 0, max: 1, step: 0.01, def: 0, unit: '' },
  detune: { label: 'Desafinação', min: 0, max: 40, step: 1, def: 6, unit: 'cents' },
  sub: { label: 'Sub-oitava', min: 0, max: 1, step: 0.01, def: 0, unit: '' },
  noise: { label: 'Ruído', min: 0, max: 0.5, step: 0.01, def: 0, unit: '' },
  fm: { label: 'FM (brilho metálico)', min: 0, max: 6, step: 0.05, def: 0, unit: '' },
  fmRatio: { label: 'Razão FM', min: 0.5, max: 8, step: 0.5, def: 2, unit: 'x' },
  attack: { label: 'Ataque', min: 0.001, max: 3, step: 0.001, def: 0.005, unit: 's', log: 0 },
  decay: { label: 'Decaimento', min: 0.01, max: 3, step: 0.01, def: 0.3, unit: 's' },
  sustain: { label: 'Sustentação', min: 0, max: 1, step: 0.01, def: 0.6, unit: '' },
  release: { label: 'Soltura', min: 0.01, max: 4, step: 0.01, def: 0.25, unit: 's' },
  cutoff: { label: 'Filtro', min: 80, max: 16000, step: 1, def: 3000, unit: 'Hz', log: 1 },
  reso: { label: 'Ressonância', min: 0.1, max: 15, step: 0.1, def: 1, unit: '' },
  fenv: { label: 'Envelope do filtro', min: 0, max: 6, step: 0.05, def: 0.4, unit: '' },
  fdecay: { label: 'Tempo do envelope', min: 0.02, max: 2, step: 0.01, def: 0.25, unit: 's' },
  vibrato: { label: 'Vibrato', min: 0, max: 1, step: 0.01, def: 0, unit: '' },
  gain: { label: 'Volume', min: 0.05, max: 1, step: 0.01, def: 0.5, unit: '' },
  octave: { label: 'Oitava', min: -2, max: 2, step: 1, def: 0, unit: '' },
};
const WAVES = ['sine', 'triangle', 'square', 'sawtooth'];
const waveOf = (v) => (typeof v === 'number' ? WAVES[v] : v);
const noiseCache = new WeakMap();
function noise(c) {
  let b = noiseCache.get(c);
  if (!b) { b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; noiseCache.set(c, b); }
  return b;
}
// toca uma nota; devolve uma função para soltar a nota antes do tempo (teclado ao vivo)
export function voice(c, out, P, m, t, dur, vel = 0.8) {
  const f = 440 * Math.pow(2, (m + 12 * (P.octave || 0) - 69) / 12);
  const a = Math.max(0.001, P.attack), dc = Math.max(0.005, P.decay), r = Math.max(0.01, P.release), peak = vel * P.gain;
  const amp = c.createGain(), fl = c.createBiquadFilter(), srcs = [];
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + a);
  amp.gain.setTargetAtTime(peak * P.sustain, t + a, dc / 3);
  fl.type = 'lowpass'; fl.Q.value = P.reso;
  const top = Math.min(18000, P.cutoff * (1 + P.fenv * 4));
  fl.frequency.setValueAtTime(Math.min(18000, P.cutoff), t);
  if (P.fenv > 0) { fl.frequency.linearRampToValueAtTime(top, t + Math.min(a, 0.02) + 0.003); fl.frequency.setTargetAtTime(P.cutoff, t + Math.min(a, 0.02) + 0.003, Math.max(0.01, P.fdecay) / 3); }
  fl.connect(amp).connect(out);
  const osc = (type, det, g, mult = 1) => { const o = c.createOscillator(); o.type = waveOf(type); o.frequency.value = f * mult; o.detune.value = det; const gg = c.createGain(); gg.gain.value = g; o.connect(gg).connect(fl); srcs.push(o); return o; };
  const o1 = osc(P.osc1, -P.detune / 2, 1 - P.mix2 * 0.5);
  const o2 = P.mix2 > 0 ? osc(P.osc2, P.detune / 2, P.mix2) : null;
  if (P.sub > 0) osc('sine', 0, P.sub, 0.5);
  if (P.noise > 0) { const n = c.createBufferSource(); n.buffer = noise(c); n.loop = true; const ng = c.createGain(); ng.gain.value = P.noise; n.connect(ng).connect(fl); srcs.push(n); }
  if (P.fm > 0) {
    const mod = c.createOscillator(), mg = c.createGain(); mod.frequency.value = f * P.fmRatio;
    mg.gain.setValueAtTime(f * P.fm, t); mg.gain.setTargetAtTime(f * P.fm * 0.15, t, Math.max(0.05, dc) / 2);
    mod.connect(mg); mg.connect(o1.frequency); if (o2) mg.connect(o2.frequency); srcs.push(mod);
  }
  if (P.vibrato > 0) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 5.5; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * P.vibrato * 0.012, t + 0.35); l.connect(lg); lg.connect(o1.frequency); if (o2) lg.connect(o2.frequency); srcs.push(l); }
  srcs.forEach((s) => s.start(t));
  srcs[0].onended = () => { try { amp.disconnect(); fl.disconnect(); } catch {} };
  const release = (at) => {
    const off = Math.max(at, t + 0.005);
    amp.gain.cancelScheduledValues(off);
    amp.gain.setValueAtTime(amp.gain.value || peak * P.sustain, off);
    amp.gain.setTargetAtTime(0, off, r / 4);
    srcs.forEach((s) => { try { s.stop(off + r * 1.6 + 0.05); } catch {} });
  };
  if (dur != null) {
    const off = t + Math.max(dur, a * 0.5, 0.01);
    amp.gain.setTargetAtTime(0, off, r / 4);
    srcs.forEach((s) => s.stop(off + r * 1.6 + 0.05));
    return null;
  }
  return () => release(c.currentTime);
}

// ---------- bateria ----------
export const PADS = ['Bumbo', 'Caixa', 'Palma', 'Chimbal', 'Chimbal aberto', 'Tom grave', 'Tom agudo', 'Prato'];
export const KITS = { k808: 'Eletrônico 808', acoustic: 'Acústico', chip: 'Chiptune', lofi: 'Lo-fi' };
export function drum(c, out, pad, t, vel = 0.8, kit = 'k808', sample = null) {
  const g = c.createGain(); g.gain.value = vel; g.connect(out);
  if (sample) { const s = c.createBufferSource(); s.buffer = sample; s.connect(g); s.start(t); return; }
  const env = (node, a, d, peak = 1) => { const e = c.createGain(); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(peak, t + a); e.gain.exponentialRampToValueAtTime(0.0005, t + a + d); node.connect(e).connect(g); return e; };
  let live = 0;
  const done = (s) => { live++; s.onended = () => { if (--live === 0) try { g.disconnect(); } catch {} }; return s; };
  const nz = (dur) => { const s = done(c.createBufferSource()); s.buffer = noise(c); s.start(t, Math.random()); s.stop(t + dur + 0.05); return s; };
  const tone = (f0, f1, dur, type = 'sine') => { const o = done(c.createOscillator()); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur * 0.7); o.start(t); o.stop(t + dur + 0.05); return o; };
  const filt = (node, type, f, q = 0.7) => { const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; node.connect(fl); return fl; };
  const chip = kit === 'chip', ac = kit === 'acoustic', lofi = kit === 'lofi';
  if (lofi) { const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3500; g.disconnect(); g.connect(lp).connect(out); }
  switch (pad) {
    case 0: // bumbo
      if (chip) env(tone(180, 40, 0.15, 'triangle'), 0.001, 0.15);
      else { env(tone(ac ? 110 : 150, ac ? 50 : 42, ac ? 0.35 : 0.6), 0.001, ac ? 0.35 : 0.6, 1); env(filt(nz(0.02), 'lowpass', 3000), 0.001, 0.02, ac ? 0.5 : 0.25); }
      break;
    case 1: // caixa
      if (chip) env(filt(nz(0.12), 'highpass', 1500), 0.001, 0.12, 0.8);
      else { env(tone(ac ? 220 : 190, 150, 0.12, 'triangle'), 0.001, 0.12, 0.6); env(filt(nz(0.25), 'bandpass', ac ? 3500 : 2500, 0.8), 0.001, ac ? 0.22 : 0.18, 0.9); }
      break;
    case 2: // palma
      for (let i = 0; i < 4; i++) { const e = c.createGain(), s = filt(nz(0.2), 'bandpass', 1500, 1.2), tt = t + i * 0.011; e.gain.setValueAtTime(0, tt); e.gain.linearRampToValueAtTime(i === 3 ? 0.9 : 0.6, tt + 0.002); e.gain.exponentialRampToValueAtTime(0.001, tt + (i === 3 ? 0.18 : 0.02)); s.connect(e).connect(g); }
      break;
    case 3: env(filt(nz(0.06), 'highpass', chip ? 6000 : 8000, 0.7), 0.001, chip ? 0.03 : 0.05, 0.55); break;
    case 4: env(filt(nz(0.4), 'highpass', 7000, 0.7), 0.002, 0.35, 0.5); break;
    case 5: env(tone(chip ? 160 : 120, chip ? 60 : 80, 0.35, chip ? 'triangle' : 'sine'), 0.001, 0.35, 0.9); break;
    case 6: env(tone(chip ? 260 : 200, chip ? 120 : 140, 0.28, chip ? 'triangle' : 'sine'), 0.001, 0.28, 0.85); break;
    default: env(filt(nz(1.6), 'highpass', 4500, 0.5), 0.003, chip ? 0.5 : 1.5, 0.5);
  }
}
// GM (canal 10) ↔ pads
export const GM_TO_PAD = { 35: 0, 36: 0, 37: 1, 38: 1, 40: 1, 39: 2, 42: 3, 44: 3, 46: 4, 41: 5, 43: 5, 45: 5, 47: 6, 48: 6, 50: 6, 49: 7, 51: 7, 52: 7, 55: 7, 57: 7, 59: 7 };
export const PAD_TO_GM = [36, 38, 39, 42, 46, 41, 48, 49];

// ---------- efeitos em tempo real (os mesmos no ao vivo e na exportação) ----------
export const LIVE_FX = ['gain', 'eq', 'lowpass', 'highpass', 'bandpass', 'comp', 'limiter', 'dist', 'crush', 'echo', 'pingpong', 'reverb', 'room', 'chorus', 'flanger', 'phaser', 'wah', 'tremolo'];
function mixNode(c, inp, wetOut, mix) {
  const o = c.createGain(), dry = c.createGain(), wet = c.createGain();
  dry.gain.value = 1 - mix; wet.gain.value = mix;
  inp.connect(dry).connect(o); wetOut.connect(wet).connect(o);
  return o;
}
function lfo(c, rate, depth) { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = rate; g.gain.value = depth; o.connect(g); o.start(); return g; }
function fxNode(c, fx) {
  const p = fx.params, inp = c.createGain();
  const bq = (type, f, q = 0.7, gain = 0) => { const n = c.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; n.gain.value = gain; return n; };
  let out;
  switch (fx.type) {
    case 'gain': out = c.createGain(); out.gain.value = Math.pow(10, p.db / 20); inp.connect(out); break;
    case 'eq': { const a = bq('lowshelf', 120, 0.7, p.low), m1 = bq('peaking', p.f1, p.q, p.g1), m2 = bq('peaking', p.f2, p.q, p.g2), h = bq('highshelf', 8000, 0.7, p.high); inp.connect(a).connect(m1).connect(m2).connect(h); out = h; break; }
    case 'lowpass': case 'highpass': case 'bandpass': out = bq(fx.type, p.freq, p.q); inp.connect(out); break;
    case 'comp': { const k = c.createDynamicsCompressor(); k.threshold.value = p.thr; k.ratio.value = p.ratio; k.knee.value = 6; k.attack.value = p.atk / 1000; k.release.value = p.rel / 1000; out = c.createGain(); out.gain.value = Math.pow(10, p.makeup / 20); inp.connect(k).connect(out); break; }
    case 'limiter': { const k = c.createDynamicsCompressor(); k.threshold.value = p.ceil - 1; k.ratio.value = 20; k.knee.value = 0; k.attack.value = 0.001; k.release.value = p.rel / 1000; out = c.createGain(); inp.connect(k).connect(out); break; }
    case 'dist': { const sh = c.createWaveShaper(); sh.curve = D.distCurve(p.drive); sh.oversample = '4x'; const lp = bq('lowpass', p.tone); inp.connect(sh).connect(lp); out = mixNode(c, inp, lp, p.mix / 100); break; }
    case 'crush': { const sh = c.createWaveShaper(), n = 4096, q = Math.pow(2, p.bits - 1), cv = new Float32Array(n); for (let i = 0; i < n; i++) cv[i] = Math.round((i / (n - 1) * 2 - 1) * q) / q; sh.curve = cv; inp.connect(sh); out = mixNode(c, inp, sh, p.mix / 100); break; }
    case 'echo': { const d = c.createDelay(2), fb = c.createGain(); d.delayTime.value = p.time / 1000; fb.gain.value = p.fb / 100; inp.connect(d); d.connect(fb).connect(d); out = mixNode(c, inp, d, p.mix / 100); break; }
    case 'pingpong': { const t = p.time / 1000, dL = c.createDelay(2), dR = c.createDelay(2), gL = c.createGain(), gR = c.createGain(), m = c.createChannelMerger(2); dL.delayTime.value = t; dR.delayTime.value = t; gL.gain.value = p.fb / 100; gR.gain.value = p.fb / 100; inp.connect(dL); dL.connect(gL).connect(dR); dR.connect(gR).connect(dL); dL.connect(m, 0, 0); dR.connect(m, 0, 1); out = mixNode(c, inp, m, p.mix / 100); break; }
    case 'reverb': { const len = Math.floor(p.size * c.sampleRate), ir = c.createBuffer(2, Math.max(1, len), c.sampleRate); for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, p.decay); } const cv = c.createConvolver(); cv.buffer = ir; inp.connect(cv); out = mixNode(c, inp, cv, p.mix / 100); break; }
    case 'room': { const cv = c.createConvolver(); cv.buffer = D.roomIR(c, Math.round(p.type), c.sampleRate); const pd = c.createDelay(1); pd.delayTime.value = p.pre / 1000; inp.connect(pd).connect(cv); out = mixNode(c, inp, cv, p.mix / 100); break; }
    case 'chorus': { const d = c.createDelay(0.1); d.delayTime.value = 0.025; lfo(c, p.rate, 0.012 * p.depth / 100).connect(d.delayTime); inp.connect(d); out = mixNode(c, inp, d, p.mix / 100); break; }
    case 'flanger': { const d = c.createDelay(0.05), fb = c.createGain(); d.delayTime.value = 0.004; fb.gain.value = 0.9 * p.fb / 100; lfo(c, p.rate, 0.0035 * p.depth / 100).connect(d.delayTime); inp.connect(d); d.connect(fb).connect(d); out = mixNode(c, inp, d, p.mix / 100); break; }
    case 'phaser': { const l = lfo(c, p.rate, 1200 * p.depth / 100), x = c.createGain(), fb = c.createGain(); fb.gain.value = 0.85 * p.fb / 100; inp.connect(x); let last = x; for (let i = 0; i < 6; i++) { const ap = bq('allpass', 400 + i * 350, 0.6); l.connect(ap.frequency); last = last.connect(ap); } last.connect(fb).connect(x); out = mixNode(c, inp, last, p.mix / 100); break; }
    case 'wah': { const lo = Math.min(p.low, p.high), hi = Math.max(p.low, p.high), f = bq('bandpass', (lo + hi) / 2, p.q); lfo(c, p.rate, (hi - lo) / 2).connect(f.frequency); const mk = c.createGain(); mk.gain.value = 2.5; inp.connect(f).connect(mk); out = mixNode(c, inp, mk, p.mix / 100); break; }
    case 'tremolo': { const dep = p.depth / 100; out = c.createGain(); out.gain.value = 1 - dep / 2; lfo(c, p.rate, dep / 2).connect(out.gain); inp.connect(out); break; }
    default: out = inp;
  }
  return [inp, out];
}
// cadeia: entrada → efeitos → saída
export function buildChain(c, chain) {
  const inp = c.createGain();
  let last = inp;
  for (const fx of chain || []) {
    if (!fx.on || !LIVE_FX.includes(fx.type) || !D.FX[fx.type]) continue;
    for (const [k, pd] of Object.entries(D.FX[fx.type].params)) if (fx.params[k] == null) fx.params[k] = pd.def;
    const [i, o] = fxNode(c, fx);
    last.connect(i); last = o;
  }
  const out = c.createGain();
  last.connect(out);
  return { inp, out };
}

// ---------- mesa de som ----------
function buildMix(c, song, dest) {
  const master = buildChain(c, song.master?.fx);
  const lim = c.createDynamicsCompressor(); lim.threshold.value = -1.5; lim.ratio.value = 20; lim.knee.value = 0; lim.attack.value = 0.002; lim.release.value = 0.08;
  const mvol = c.createGain(); mvol.gain.value = song.master?.vol ?? 0.9;
  const man = c.createAnalyser(); man.fftSize = 1024;
  master.out.connect(mvol).connect(lim);
  lim.connect(dest); lim.connect(man);
  const solo = song.tracks.some((t) => t.solo);
  const ch = {};
  for (const t of song.tracks) {
    const chain = buildChain(c, t.fx), pan = c.createStereoPanner(), vol = c.createGain(), an = c.createAnalyser();
    an.fftSize = 512;
    pan.pan.value = t.pan || 0;
    vol.gain.value = t.mute || (solo && !t.solo) ? 0 : t.vol ?? 0.8;
    chain.out.connect(pan).connect(vol).connect(master.inp);
    vol.connect(an);
    ch[t.id] = { inp: chain.inp, pan, vol, an };
  }
  return { ch, master, mvol, man };
}

// ---------- linha do tempo → eventos ----------
export const songEnd = (song) => Math.max(song.sig * 4, ...song.tracks.flatMap((t) => (t.clips || []).map((c) => c.start + c.len)));
export function compile(song, res = {}) {
  const ev = [], sw = (song.swing || 0) * 0.0833;
  for (const t of song.tracks) {
    for (const c of t.clips || []) {
      if (t.kind === 'audio') { const buf = res.audio?.[c.clipId]; if (buf) ev.push({ b: c.start, kind: 'audio', t, buf, gain: c.gain ?? 1, len: Math.min(c.len, (buf.duration * song.bpm) / 60) }); continue; }
      const pat = song.patterns[c.pat];
      if (!pat || !pat.len) continue;
      for (let rep = 0; rep * pat.len < c.len; rep++) {
        for (const n of pat.notes) {
          const local = rep * pat.len + n.t;
          if (local >= c.len - 1e-6) continue;
          const off16 = Math.round(n.t * 4) % 2 === 1 && Math.abs(n.t * 4 - Math.round(n.t * 4)) < 0.01 ? sw : 0;
          ev.push({ b: c.start + local + off16, kind: t.kind === 'drum' ? 'drum' : 'note', t, m: n.p, v: n.v ?? 0.8, d: Math.min(n.d, c.len - local) });
        }
      }
    }
  }
  return ev.sort((a, b) => a.b - b.b);
}
function fire(c, e, mix, spb, at, offsetBeats = 0, res = {}) {
  const ch = mix.ch[e.t.id]; if (!ch) return;
  if (e.kind === 'note') voice(c, ch.inp, e.t.params || instParams(e.t.inst), e.m, at, e.d * spb, e.v);
  else if (e.kind === 'drum') { const pad = e.t.pads?.[e.m]; drum(c, ch.inp, e.m, at, e.v * (pad?.vol ?? 1), e.t.kit || 'k808', pad?.clipId ? res.pads?.[pad.clipId] : null); }
  else if (e.kind === 'audio') { const s = c.createBufferSource(), g = c.createGain(); s.buffer = e.buf; g.gain.value = e.gain; s.connect(g).connect(ch.inp); const off = offsetBeats * spb; if (off < e.buf.duration) s.start(at, off, Math.max(0.01, e.len * spb - off)); }
}

// ---------- tocador ao vivo ----------
export class Player {
  constructor() { this.c = D.ctx(); this.playing = false; this.metro = false; this.events = []; this.res = {}; }
  setSong(song, res) { this.song = song; if (res) this.res = res; this.events = compile(song, this.res); if (!this.mix) this.rebuild(); }
  refresh() { if (this.song) this.events = compile(this.song, this.res); }
  rebuild() {
    if (this.mix) { try { this.out.disconnect(); } catch {} }
    this.out = this.c.createGain(); this.out.connect(this.c.destination);
    this.mix = buildMix(this.c, this.song, this.out);
  }
  setTrackGains() {
    if (!this.mix) return;
    const solo = this.song.tracks.some((t) => t.solo), now = this.c.currentTime;
    for (const t of this.song.tracks) { const ch = this.mix.ch[t.id]; if (!ch) { this.rebuild(); return; } ch.vol.gain.setTargetAtTime(t.mute || (solo && !t.solo) ? 0 : t.vol ?? 0.8, now, 0.02); ch.pan.pan.setTargetAtTime(t.pan || 0, now, 0.02); }
    this.mix.mvol.gain.setTargetAtTime(this.song.master?.vol ?? 0.9, now, 0.02);
  }
  get spb() { return 60 / this.song.bpm; }
  play(fromBeat = 0, { loop = null, onEnd } = {}) {
    this.stop(true);
    if (this.c.state === 'suspended') this.c.resume();
    this.rebuild();
    this.events = compile(this.song, this.res);
    this.loop = loop; this.onEnd = onEnd;
    const t0 = this.c.currentTime + 0.06;
    this.anchor = { t: t0, b: fromBeat }; this.anchors = [this.anchor];
    this.cursor = fromBeat; this.ctime = t0;
    this.end = songEnd(this.song);
    // sons de áudio que já começaram antes do ponto de partida
    for (const e of this.events) if (e.kind === 'audio' && e.b < fromBeat && e.b + e.len > fromBeat) fire(this.c, e, this.mix, this.spb, t0, fromBeat - e.b, this.res);
    this.playing = true;
    this.timer = setInterval(() => this.tick(), 25);
    this.tick();
  }
  tick() {
    if (!this.playing) return;
    const horizon = this.c.currentTime + 0.12, spb = this.spb;
    let guard = 0;
    while (this.ctime < horizon && guard++ < 64) {
      const loopEnd = this.loop ? this.loop.b : Infinity;
      const segEnd = Math.min(this.cursor + (horizon - this.ctime) / spb, loopEnd);
      for (const e of this.events) { if (e.b >= segEnd) break; if (e.b >= this.cursor - 1e-9) fire(this.c, e, this.mix, spb, this.ctime + (e.b - this.cursor) * spb, 0, this.res); }
      if (this.metro) for (let b = Math.ceil(this.cursor - 1e-9); b < segEnd; b++) this.click(this.ctime + (b - this.cursor) * spb, b % this.song.sig === 0);
      this.ctime += (segEnd - this.cursor) * spb; this.cursor = segEnd;
      if (this.loop && this.cursor >= loopEnd - 1e-9) { this.cursor = this.loop.a; this.anchors.push({ t: this.ctime, b: this.loop.a }); if (this.anchors.length > 8) this.anchors.shift(); }
      if (!this.loop && this.cursor >= this.end + this.song.sig) { const tEnd = this.ctime; setTimeout(() => { if (this.playing && this.c.currentTime >= tEnd - 0.2) { this.stop(); this.onEnd && this.onEnd(); } }, Math.max(0, (tEnd - this.c.currentTime) * 1000)); break; }
    }
  }
  click(at, strong) { const o = this.c.createOscillator(), g = this.c.createGain(); o.frequency.value = strong ? 1600 : 1100; g.gain.setValueAtTime(0.25, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.05); o.connect(g).connect(this.out); o.start(at); o.stop(at + 0.06); }
  pos() {
    if (!this.playing) return null;
    const now = this.c.currentTime;
    let a = this.anchors[0];
    for (const x of this.anchors) if (x.t <= now) a = x;
    return a.b + Math.max(0, now - a.t) / this.spb;
  }
  stop(silent) {
    clearInterval(this.timer); this.timer = null;
    if (this.playing || silent) { try { this.out?.disconnect(); } catch {} this.mix = null; }
    this.playing = false;
  }
  // nota ao vivo (teclado, clique no piano roll)
  noteOn(track, m, vel = 0.85) {
    if (this.c.state === 'suspended') this.c.resume();
    if (!this.mix || !this.mix.ch[track.id]) this.rebuild();
    const ch = this.mix.ch[track.id];
    if (track.kind === 'drum') { drum(this.c, ch.inp, m, this.c.currentTime, vel * (track.pads?.[m]?.vol ?? 1), track.kit || 'k808', track.pads?.[m]?.clipId ? this.res.pads?.[track.pads[m].clipId] : null); return () => {}; }
    return voice(this.c, ch.inp, track.params || instParams(track.inst), m, this.c.currentTime, null, vel);
  }
  meters() {
    if (!this.mix) return null;
    const read = (an) => { const d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d); let pk = 0; for (const v of d) pk = Math.max(pk, Math.abs(v)); return pk; };
    const o = { master: read(this.mix.man) };
    for (const [id, ch] of Object.entries(this.mix.ch)) o[id] = read(ch.an);
    return o;
  }
}

// ---------- exportação ----------
// from/to em tempos (beats). loopFix: a cauda depois do fim volta para o começo (BGM em loop perfeito)
export async function render(song, res, { from = 0, to = null, tail = 2.5, loopFix = false, only = null, rate = 44100 } = {}) {
  const spb = 60 / song.bpm, end = to ?? songEnd(song);
  const bodyS = (end - from) * spb, len = Math.ceil((bodyS + tail) * rate);
  const c = new OfflineAudioContext(2, Math.max(1, len), rate);
  const s2 = only ? { ...song, tracks: song.tracks.filter((t) => t.id === only).map((t) => ({ ...t, solo: false, mute: false })) } : song;
  const mix = buildMix(c, s2, c.destination);
  const events = compile(s2, res);
  // agenda em blocos de poucos segundos (suspend/resume): só as notas próximas ficam no grafo, o que deixa a renderização bem mais rápida
  const CH = 2, at = (e) => (e.b - from) * spb;
  for (const e of events) if (e.kind === 'audio' && e.b < from && e.b + e.len > from) fire(c, e, mix, spb, 0, from - e.b, res);
  const list = events.filter((e) => e.b >= from && e.b < end);
  let i = 0;
  const feed = (until) => { while (i < list.length && at(list[i]) < until) { fire(c, list[i], mix, spb, at(list[i]), 0, res); i++; } };
  feed(CH * 2);
  for (let k = 1; k * CH < bodyS; k++) {
    const tk = k * CH;
    c.suspend(Math.floor((tk * rate) / 128) * 128 / rate).then(() => { feed(tk + CH * 2); c.resume(); });
  }
  let b = await c.startRendering();
  if (loopFix) {
    const n = Math.round(bodyS * rate), out = new AudioBuffer({ numberOfChannels: 2, length: n, sampleRate: rate });
    for (let ch = 0; ch < 2; ch++) {
      const src = b.getChannelData(ch), dst = out.getChannelData(ch);
      dst.set(src.subarray(0, n));
      for (let i = n; i < src.length; i++) dst[(i - n) % n] += src[i];
    }
    b = out;
  }
  return b;
}

// ---------- MIDI ----------
export function parseMidi(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  const str = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(v.getUint8(p + i)); p += n; return s; };
  const u32 = () => { const x = v.getUint32(p); p += 4; return x; }, u16 = () => { const x = v.getUint16(p); p += 2; return x; };
  const vlq = () => { let x = 0, b; do { b = v.getUint8(p++); x = (x << 7) | (b & 0x7f); } while (b & 0x80); return x; };
  if (str(4) !== 'MThd') throw new Error('Este arquivo não é MIDI.');
  const hl = u32(); u16(); const ntr = u16(), div = u16(); p += hl - 6;
  if (div & 0x8000) throw new Error('Formato de tempo MIDI não suportado.');
  let bpm = 120, sig = 4;
  const tracks = [];
  for (let k = 0; k < ntr && p < bytes.length; k++) {
    if (str(4) !== 'MTrk') break;
    const len = u32(), endp = p + len;
    let tick = 0, run = 0, name = '';
    const on = {}, notes = {};
    while (p < endp) {
      tick += vlq();
      let st = v.getUint8(p);
      if (st & 0x80) p++; else st = run;
      if (st === 0xff) {
        const type = v.getUint8(p++), l = vlq();
        if (type === 0x51 && l === 3) bpm = Math.round(60000000 / ((v.getUint8(p) << 16) | (v.getUint8(p + 1) << 8) | v.getUint8(p + 2)));
        else if (type === 0x58) sig = v.getUint8(p) || 4;
        else if (type === 0x03) { const sp = p; name = str(l); p = sp; }
        p += l;
      } else if (st === 0xf0 || st === 0xf7) { p += vlq(); }
      else {
        run = st;
        const cmd = st & 0xf0, chn = st & 0x0f, a = v.getUint8(p++), b2 = cmd === 0xc0 || cmd === 0xd0 ? 0 : v.getUint8(p++);
        const key = chn * 128 + a;
        if (cmd === 0x90 && b2 > 0) on[key] = { t: tick, v: b2 / 127 };
        else if (cmd === 0x80 || (cmd === 0x90 && b2 === 0)) { const o = on[key]; if (o) { (notes[chn] ||= []).push({ p: a, t: o.t / div, d: Math.max(0.05, (tick - o.t) / div), v: +o.v.toFixed(2) }); delete on[key]; } }
      }
    }
    p = endp;
    for (const [chn, ns] of Object.entries(notes)) tracks.push({ name: name || `Faixa ${tracks.length + 1}`, drum: +chn === 9, notes: ns });
  }
  return { bpm, sig, tracks };
}
export function writeMidi(song) {
  const TPB = 480, out = [];
  const u32 = (x) => [(x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255], u16 = (x) => [(x >> 8) & 255, x & 255];
  const vlq = (x) => { const b = [x & 0x7f]; while ((x >>= 7)) b.unshift((x & 0x7f) | 0x80); return b; };
  const chunk = (evs) => { const body = []; let last = 0; for (const [tk, bytes] of evs.sort((a, b) => a[0] - b[0] || a[2] - b[2])) { body.push(...vlq(tk - last), ...bytes); last = tk; } body.push(0, 0xff, 0x2f, 0); return [...[77, 84, 114, 107], ...u32(body.length), ...body]; };
  const us = Math.round(60000000 / song.bpm);
  const tempo = chunk([[0, [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255], 0], [0, [0xff, 0x58, 4, song.sig, 2, 24, 8], 0]]);
  const trks = [tempo];
  let chn = 0;
  for (const t of song.tracks) {
    if (t.kind === 'audio') continue;
    const c = t.kind === 'drum' ? 9 : chn++ % 16 === 9 ? chn++ : (chn - 1) % 16;
    const evs = [[0, [0xff, 0x03, ...vlq(t.name.length), ...[...t.name].map((ch) => ch.charCodeAt(0) & 127)], 0]];
    for (const e of compile({ ...song, swing: 0, tracks: [t] }, {})) {
      const m = t.kind === 'drum' ? PAD_TO_GM[e.m] ?? 42 : Math.max(0, Math.min(127, e.m + 12 * ((t.params || instParams(t.inst)).octave || 0)));
      const s = Math.round(e.b * TPB), en = Math.round((e.b + (t.kind === 'drum' ? 0.1 : e.d)) * TPB), vel = Math.max(1, Math.min(127, Math.round(e.v * 127)));
      evs.push([s, [0x90 | c, m, vel], 1], [en, [0x80 | c, m, 0], 0]);
    }
    trks.push(chunk(evs));
  }
  out.push(77, 84, 104, 100, ...u32(6), ...u16(1), ...u16(trks.length), ...u16(TPB));
  for (const t of trks) out.push(...t);
  return new Uint8Array(out);
}

// ---------- modelos de música de jogo ----------
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const DRUM_STYLES = {
  rock: ['Rock', { 0: [0, 8], 1: [4, 12], 3: [0, 2, 4, 6, 8, 10, 12, 14] }],
  pop: ['Pop', { 0: [0, 6, 8], 1: [4, 12], 3: [0, 2, 4, 6, 8, 10, 12, 14] }],
  four: ['Quatro no chão (dance)', { 0: [0, 4, 8, 12], 2: [4, 12], 4: [2, 6, 10, 14] }],
  trap: ['Trap', { 0: [0, 7, 10], 1: [8], 3: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] }],
  march: ['Marcha chiptune', { 0: [0, 8], 1: [4, 12, 14], 3: [0, 4, 8, 12] }],
  calm: ['Calmo', { 0: [0, 10], 3: [4, 12], 6: [14] }],
  battle: ['Batalha', { 0: [0, 3, 6, 8, 11, 14], 1: [4, 12], 3: [0, 2, 4, 6, 8, 10, 12, 14], 7: [0] }],
  boss: ['Chefe (tambores)', { 0: [0, 8], 5: [2, 6, 10, 14], 6: [4, 12, 15], 7: [0] }],
  waltz: ['Valsa (3/4)', { 0: [0], 3: [4, 8] }],
  bossa: ['Bossa nova', { 0: [0, 6, 8, 14], 1: [3, 6, 10, 13], 3: [0, 2, 4, 6, 8, 10, 12, 14] }],
};
export const DRUM_STYLE_NAMES = Object.fromEntries(Object.entries(DRUM_STYLES).map(([k, [n]]) => [k, n]));
export function drumNotes(style, bars = 1, sig = 4) {
  const st = DRUM_STYLES[style]?.[1] || DRUM_STYLES.rock[1], notes = [], steps = sig * 4;
  for (let bar = 0; bar < bars; bar++) for (const [pad, arr] of Object.entries(st)) for (const s of arr) if (s < steps) notes.push({ p: +pad, t: bar * sig + s / 4, d: 0.25, v: s % 4 === 0 ? 0.9 : 0.7 });
  return notes;
}
// acordes da progressão em estilos diferentes
export function chordNotes(prog, key, scale, { bars = 1, sig = 4, style = 'block', base = 60 } = {}) {
  const notes = [];
  prog.forEach((deg, i) => {
    const root = degreeRoot(deg, key, scale, base), ch = diatonic(root, key, scale, 3), t0 = i * bars * sig, L = bars * sig;
    if (style === 'block') ch.forEach((p) => notes.push({ p, t: t0, d: L - 0.05, v: 0.7 }));
    else if (style === 'arp') { const seq = [...ch, ch[1] + 12, ch[2], ch[1]]; for (let s = 0; s < L * 2; s++) notes.push({ p: seq[s % seq.length], t: t0 + s / 2, d: 0.45, v: s % 2 ? 0.6 : 0.75 }); }
    else if (style === 'stab') for (let b = 0; b < L; b++) ch.forEach((p) => notes.push({ p, t: t0 + b + 0.5, d: 0.3, v: 0.7 }));
    else if (style === 'pulse') for (let s = 0; s < L * 2; s++) ch.forEach((p) => notes.push({ p, t: t0 + s / 2, d: 0.35, v: 0.6 }));
  });
  return notes;
}
export function bassNotes(prog, key, scale, { bars = 1, sig = 4, style = 'root', base = 36 } = {}) {
  const notes = [];
  prog.forEach((deg, i) => {
    const r = degreeRoot(deg, key, scale, base), t0 = i * bars * sig, L = bars * sig;
    if (style === 'root') for (let b = 0; b < L; b++) notes.push({ p: r, t: t0 + b, d: 0.9, v: 0.8 });
    else if (style === 'eighth') for (let s = 0; s < L * 2; s++) notes.push({ p: s % 4 === 3 ? r + 12 : r, t: t0 + s / 2, d: 0.42, v: s % 2 ? 0.65 : 0.85 });
    else if (style === 'long') notes.push({ p: r, t: t0, d: L - 0.05, v: 0.8 });
    else for (let s = 0; s < L * 4; s++) notes.push({ p: r, t: t0 + s / 4, d: 0.22, v: s % 4 === 0 ? 0.9 : 0.6 });
  });
  return notes;
}
// melodia simples: notas do acorde nos tempos fortes e passos da escala no resto
export function melodyNotes(prog, key, scale, { bars = 1, sig = 4, base = 72, density = 0.6 } = {}) {
  const sc = SCALES[scale][1], notes = [];
  const near = (target, m) => { let best = m, bd = 99; for (let k = m - 7; k <= m + 7; k++) if (inScale(k, key, scale) && Math.abs(k - target) < bd) { bd = Math.abs(k - target); best = k; } return best; };
  let cur = degreeRoot(0, key, scale, base);
  const RHY = [[0, 1, 1.5, 2, 3], [0, 0.5, 1, 2, 2.5, 3], [0, 1, 2, 2.5, 3, 3.5], [0, 1.5, 2, 3], [0, 0.5, 1, 1.5, 2, 3]];
  prog.forEach((deg, i) => {
    const ch = diatonic(degreeRoot(deg, key, scale, base), key, scale, 3);
    for (let bar = 0; bar < bars; bar++) {
      const r = rnd(RHY).filter((x) => x < sig), t0 = (i * bars + bar) * sig;
      r.forEach((x, k) => {
        if (Math.random() > density + 0.35 && x % 1) return;
        const strong = x % 2 === 0;
        const target = strong ? ch.reduce((a, b) => (Math.abs(b - cur) < Math.abs(a - cur) ? b : a)) : cur + rnd([-2, -1, 1, 2, 2, -3]);
        cur = Math.max(base - 7, Math.min(base + 12, near(target, cur)));
        const next = r[k + 1] ?? sig;
        notes.push({ p: cur, t: t0 + x, d: Math.max(0.2, next - x - 0.05), v: strong ? 0.85 : 0.7 });
      });
    }
  });
  void sc;
  return notes;
}
export const TEMPLATES = {
  empty: { name: 'Música vazia', bpm: 110, key: 0, scale: 'major' },
  adventure: { name: 'Aventura chiptune', bpm: 140, key: 0, scale: 'major', prog: 0, kit: 'chip', drums: 'march', lead: 'square', chords: ['square', 'pulse'], bass: ['triangle', 'eighth'] },
  calm: { name: 'Exploração calma', bpm: 82, key: 2, scale: 'major', prog: 2, kit: 'lofi', drums: 'calm', lead: 'flute', chords: ['pad', 'block'], bass: ['sub', 'long'], arp: 'piano' },
  battle: { name: 'Batalha', bpm: 158, key: 9, scale: 'minor', prog: 7, kit: 'acoustic', drums: 'battle', lead: 'lead', chords: ['strings', 'stab'], bass: ['bass', 'sixteenth'] },
  village: { name: 'Vila / aldeia', bpm: 104, key: 5, scale: 'major', prog: 6, kit: 'acoustic', drums: 'bossa', lead: 'flute', chords: ['pluck', 'stab'], bass: ['bass', 'root'], arp: 'marimba' },
  boss: { name: 'Chefe', bpm: 120, key: 4, scale: 'harmonic', prog: 4, kit: 'acoustic', drums: 'boss', lead: 'brass', chords: ['strings', 'block'], bass: ['bass', 'eighth'], choir: true },
  dungeon: { name: 'Masmorra', bpm: 90, key: 2, scale: 'phrygian', prog: 4, kit: 'lofi', drums: 'calm', lead: 'bell', chords: ['choir', 'block'], bass: ['sub', 'long'] },
};
