// Geradores procedurais: ambientes, interface, passos e sintetizador simples.
const RATE = 44100;
const rnd = (a = 1) => Math.random() * a;
const noiseBuf = (c, sec, kind = 'white') => {
  const n = Math.max(1, Math.floor(sec * RATE)), b = c.createBuffer(1, n, RATE), d = b.getChannelData(0);
  let last = 0, b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    else if (kind === 'pink') { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
    else d[i] = w;
  }
  return b;
};
const src = (c, buf) => { const s = c.createBufferSource(); s.buffer = buf; s.start(); return s; };
const filt = (c, type, f, q = 0.7) => { const n = c.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; };
const gainN = (c, v) => { const g = c.createGain(); g.gain.value = v; return g; };
async function finish(c, peak = 0.8) {
  const b = await c.startRendering();
  let pk = 0;
  for (let ch = 0; ch < b.numberOfChannels; ch++) for (const v of b.getChannelData(ch)) pk = Math.max(pk, Math.abs(v));
  if (pk > 1e-6) for (let ch = 0; ch < b.numberOfChannels; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] *= peak / pk; }
  return b;
}
// automação lenta e aleatória num parâmetro
function wander(param, base, amt, dur, step = 0.5) {
  param.setValueAtTime(base, 0);
  for (let t = step; t <= dur + step; t += step * (0.6 + rnd(0.8))) param.linearRampToValueAtTime(Math.max(1e-4, base + (rnd(2) - 1) * amt), t);
}

export const AMB = {
  rain: 'Chuva', wind: 'Vento', fire: 'Fogo', sea: 'Mar', stream: 'Riacho', hum: 'Zumbido de máquina',
};
export async function ambience(kind, { dur = 8, intensity = 0.5, tone = 0.5 } = {}) {
  const c = new OfflineAudioContext(2, Math.floor(dur * RATE), RATE), out = gainN(c, 1);
  out.connect(c.destination);
  if (kind === 'rain') {
    const n = src(c, noiseBuf(c, dur, 'pink')).connect(filt(c, 'highpass', 300)).connect(filt(c, 'lowpass', 2500 + tone * 7000));
    n.connect(gainN(c, 0.5 + intensity * 0.5)).connect(out);
    const drops = c.createBuffer(2, Math.floor(dur * RATE), RATE), cnt = Math.floor(dur * (20 + intensity * 260));
    for (let k = 0; k < cnt; k++) {
      const ch = drops.getChannelData(k % 2), at = Math.floor(rnd(dur * RATE)), f = 1500 + rnd(4000) * (0.5 + tone), a = rnd(0.5) * (0.4 + intensity), L = Math.floor(RATE * (0.004 + rnd(0.01)));
      for (let i = 0; i < L && at + i < ch.length; i++) ch[at + i] += Math.sin(2 * Math.PI * f * i / RATE) * a * Math.exp(-i / (L / 4));
    }
    src(c, drops).connect(out);
  } else if (kind === 'wind') {
    for (let ch = 0; ch < 2; ch++) {
      const bp = filt(c, 'bandpass', 400 + tone * 800, 0.8 + intensity);
      wander(bp.frequency, 300 + tone * 900, 250 + tone * 500, dur, 0.8);
      const g = gainN(c, 0.5); wander(g.gain, 0.5 + intensity * 0.3, 0.35, dur, 1.1);
      const pn = c.createStereoPanner(); pn.pan.value = ch ? 0.6 : -0.6;
      src(c, noiseBuf(c, dur, 'pink')).connect(bp).connect(g).connect(pn).connect(out);
    }
  } else if (kind === 'fire') {
    src(c, noiseBuf(c, dur, 'brown')).connect(filt(c, 'lowpass', 200 + tone * 300)).connect(gainN(c, 0.9)).connect(out);
    const hiss = gainN(c, 0.08 + intensity * 0.1); wander(hiss.gain, 0.1 + intensity * 0.1, 0.06, dur, 0.3);
    src(c, noiseBuf(c, dur)).connect(filt(c, 'bandpass', 3000 + tone * 3000, 0.6)).connect(hiss).connect(out);
    const cr = c.createBuffer(2, Math.floor(dur * RATE), RATE), cnt = Math.floor(dur * (8 + intensity * 70));
    for (let k = 0; k < cnt; k++) {
      const ch = cr.getChannelData(k % 2), at = Math.floor(rnd(dur * RATE)), a = Math.pow(rnd(1), 2) * (0.6 + intensity), L = Math.floor(RATE * (0.001 + rnd(0.006)));
      let lp = 0;
      for (let i = 0; i < L && at + i < ch.length; i++) { lp += ((Math.random() * 2 - 1) - lp) * (0.4 + tone * 0.5); ch[at + i] += lp * a * Math.exp(-i / (L / 3)); }
    }
    src(c, cr).connect(out);
  } else if (kind === 'sea') {
    for (let ch = 0; ch < 2; ch++) {
      const lp = filt(c, 'lowpass', 600 + tone * 1500), g = gainN(c, 0);
      const period = 5 + rnd(3);
      for (let t = rnd(2); t < dur + period; t += period * (0.8 + rnd(0.4))) { g.gain.linearRampToValueAtTime(0.15, t); g.gain.linearRampToValueAtTime(0.6 + intensity * 0.4, t + period * 0.35); g.gain.linearRampToValueAtTime(0.15, t + period * 0.95); }
      wander(lp.frequency, 700 + tone * 1500, 400, dur, 1.5);
      const pn = c.createStereoPanner(); pn.pan.value = ch ? 0.5 : -0.5;
      src(c, noiseBuf(c, dur, 'pink')).connect(lp).connect(g).connect(pn).connect(out);
    }
  } else if (kind === 'stream') {
    for (let k = 0; k < 6; k++) {
      const bp = filt(c, 'bandpass', 800 + rnd(3000) * (0.5 + tone), 4 + rnd(6));
      wander(bp.frequency, bp.frequency.value, bp.frequency.value * 0.3, dur, 0.15 + rnd(0.2));
      const g = gainN(c, 0.3 + intensity * 0.4), pn = c.createStereoPanner(); pn.pan.value = rnd(1.6) - 0.8;
      src(c, noiseBuf(c, dur)).connect(bp).connect(g).connect(pn).connect(out);
    }
  } else {
    const f0 = 50 + tone * 70;
    for (const [m, a] of [[1, 0.6], [2, 0.35], [3, 0.2], [5, 0.08]]) { const o = c.createOscillator(); o.frequency.value = f0 * m; const g = gainN(c, a); wander(g.gain, a, a * 0.15, dur, 0.4); o.connect(g).connect(out); o.start(); }
    src(c, noiseBuf(c, dur, 'pink')).connect(filt(c, 'bandpass', 1200 + tone * 1500, 1)).connect(gainN(c, 0.05 + intensity * 0.25)).connect(out);
  }
  return finish(c, 0.7);
}

export const UI = { click: 'Clique', confirm: 'Confirmar', cancel: 'Cancelar', error: 'Erro', notify: 'Notificação', hover: 'Passar por cima', open: 'Abrir menu', close: 'Fechar menu' };
const WAVE = ['sine', 'triangle', 'square', 'sawtooth'];
export async function uiSound(kind, { pitch = 0, len = 1, timbre = 0 } = {}) {
  const k = Math.pow(2, pitch / 12), L = 0.6 * len + 0.1;
  const c = new OfflineAudioContext(1, Math.floor(L * RATE), RATE), out = filt(c, 'lowpass', 9000);
  out.connect(c.destination);
  const tone = (f, t0, d, a = 0.6, slide = 1, type = WAVE[Math.round(timbre)]) => {
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f * k, t0); o.frequency.exponentialRampToValueAtTime(f * k * slide, t0 + d);
    const g = c.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(a, t0 + 0.004); g.gain.exponentialRampToValueAtTime(0.0008, t0 + d);
    o.connect(g).connect(out); o.start(t0); o.stop(t0 + d + 0.01);
  };
  const s = len;
  if (kind === 'click') { tone(1800, 0, 0.03 * s, 0.7, 0.6); const n = src(c, noiseBuf(c, 0.02)); const g = gainN(c, 0.25); n.connect(filt(c, 'highpass', 3000)).connect(g).connect(out); }
  else if (kind === 'confirm') { tone(660, 0, 0.09 * s); tone(990, 0.08 * s, 0.18 * s); }
  else if (kind === 'cancel') { tone(700, 0, 0.09 * s); tone(470, 0.08 * s, 0.18 * s); }
  else if (kind === 'error') { tone(160, 0, 0.12 * s, 0.5, 1, 'square'); tone(150, 0.15 * s, 0.18 * s, 0.5, 1, 'square'); }
  else if (kind === 'notify') { for (const [f, a] of [[880, 0.5], [1760, 0.2], [2640, 0.1]]) tone(f, 0, 0.5 * s, a); tone(1320, 0.12 * s, 0.45 * s, 0.35); }
  else if (kind === 'hover') tone(2400, 0, 0.025 * s, 0.35, 0.9);
  else if (kind === 'open') tone(300, 0, 0.18 * s, 0.6, 2.2);
  else tone(650, 0, 0.18 * s, 0.6, 0.45);
  return finish(c, 0.8);
}

export const STEPS = { dirt: 'Terra', wood: 'Madeira', stone: 'Pedra', grass: 'Grama', metal: 'Metal', snow: 'Neve', water: 'Água' };
export async function footstep(kind, { weight = 0.5, hard = 0.5 } = {}) {
  const c = new OfflineAudioContext(1, Math.floor(0.6 * RATE), RATE), out = gainN(c, 1);
  out.connect(c.destination);
  const lowF = 1 - weight * 0.6;
  const burst = (t0, d, a, fType, f, q, kindN = 'white') => {
    const s = c.createBufferSource(); s.buffer = noiseBuf(c, d + 0.05, kindN);
    const fl = filt(c, fType, f * lowF, q), g = c.createGain();
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(a, t0 + 0.002 + (1 - hard) * 0.01); g.gain.exponentialRampToValueAtTime(0.001, t0 + d);
    s.connect(fl).connect(g).connect(out); s.start(t0);
  };
  const ring = (t0, f, d, a) => { const o = c.createOscillator(); o.frequency.value = f * (0.95 + rnd(0.1)); const g = c.createGain(); g.gain.setValueAtTime(a, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + d); o.connect(g).connect(out); o.start(t0); o.stop(t0 + d); };
  const toe = 0.05 + rnd(0.04);
  if (kind === 'dirt') { burst(0, 0.12, 0.9, 'lowpass', 1200, 0.7, 'pink'); burst(toe, 0.1, 0.6, 'bandpass', 1800, 0.8); }
  else if (kind === 'wood') { burst(0, 0.08, 0.9, 'bandpass', 900, 1.2); ring(0, 220 * lowF, 0.12, 0.35); burst(toe, 0.07, 0.5, 'bandpass', 1400, 1); }
  else if (kind === 'stone') { burst(0, 0.05, 1, 'highpass', 1500, 0.7); burst(toe, 0.05, 0.6, 'highpass', 2200, 0.7); }
  else if (kind === 'grass') { for (let i = 0; i < 6; i++) burst(rnd(0.12), 0.06 + rnd(0.05), 0.5, 'bandpass', 3000 + rnd(3000), 1.5); }
  else if (kind === 'metal') { burst(0, 0.04, 0.8, 'highpass', 2000, 0.7); ring(0, 1800, 0.25, 0.2); ring(0, 2700, 0.18, 0.12); ring(toe, 1250, 0.2, 0.12); }
  else if (kind === 'snow') { for (let i = 0; i < 14; i++) burst(rnd(0.16), 0.02 + rnd(0.03), 0.35, 'bandpass', 2000 + rnd(2500), 2); burst(0, 0.15, 0.4, 'lowpass', 600, 0.7, 'pink'); }
  else { burst(0, 0.2, 0.8, 'lowpass', 900, 1, 'pink'); for (let i = 0; i < 5; i++) ring(0.02 + rnd(0.15), 600 + rnd(1400), 0.05, 0.12); }
  return finish(c, 0.85);
}

// Sintetizador: renderiza notas com envelope e filtro
export const SYN_WAVES = ['Seno', 'Triângulo', 'Quadrada', 'Serra'];
export function synthDefaults() { return { wave: 3, attack: 5, decay: 200, sustain: 0.6, release: 250, cutoff: 3000, reso: 2, fenv: 0.5, detune: 8, octave: 0 }; }
export async function synthNotes(notes, p) {
  const end = Math.max(0.2, ...notes.map((n) => n.t + n.d + p.release / 1000)) + 0.05;
  const c = new OfflineAudioContext(1, Math.ceil(end * RATE), RATE), out = gainN(c, 0.4);
  out.connect(c.destination);
  for (const n of notes) {
    const f = 440 * Math.pow(2, (n.m + p.octave * 12 - 69) / 12), t0 = n.t, a = p.attack / 1000, dcy = p.decay / 1000, r = p.release / 1000, off = t0 + Math.max(n.d, a + 0.01);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(1, t0 + a); g.gain.linearRampToValueAtTime(p.sustain, t0 + a + dcy);
    g.gain.setValueAtTime(p.sustain, off); g.gain.linearRampToValueAtTime(0, off + r);
    const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = p.reso;
    const fc = p.cutoff, peak = Math.min(18000, fc * (1 + p.fenv * 6));
    fl.frequency.setValueAtTime(fc, t0); fl.frequency.linearRampToValueAtTime(peak, t0 + a); fl.frequency.exponentialRampToValueAtTime(Math.max(60, fc), t0 + a + dcy + 0.01);
    for (const det of p.detune ? [-p.detune, p.detune] : [0]) {
      const o = c.createOscillator(); o.type = WAVE[Math.round(p.wave)]; o.frequency.value = f; o.detune.value = det;
      o.connect(fl); o.start(t0); o.stop(off + r + 0.02);
    }
    fl.connect(g).connect(out);
  }
  return c.startRendering();
}
