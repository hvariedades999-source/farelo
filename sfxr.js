// Gerador de efeitos sonoros retrô no estilo sfxr (DrPetter). Gera um AudioBuffer a 44,1 kHz.
const frnd = (r) => Math.random() * r;
const coin = () => Math.random() < 0.5;
const irnd = (n) => Math.floor(Math.random() * (n + 1));

export const PARAMS = [
  ['Envelope', [
    ['env_attack', 'Ataque', 0, 'Tempo até o som chegar ao volume máximo.'],
    ['env_sustain', 'Sustentação', 0, 'Tempo que o som fica no volume máximo.'],
    ['env_punch', 'Punch', 0, 'Um estalo extra de volume logo no começo.'],
    ['env_decay', 'Decaimento', 0, 'Tempo que o som leva para sumir.'],
  ]],
  ['Frequência', [
    ['base_freq', 'Tom inicial', 0, 'Quão agudo o som começa.'],
    ['freq_limit', 'Tom mínimo', 0, 'O som para se o tom cair abaixo deste valor.'],
    ['freq_ramp', 'Deslize', 1, 'Faz o tom subir (direita) ou descer (esquerda) ao longo do som.'],
    ['freq_dramp', 'Aceleração do deslize', 1, 'Faz o deslize ficar mais rápido ou mais lento com o tempo.'],
  ]],
  ['Vibrato', [
    ['vib_strength', 'Intensidade', 0, 'Quanto o tom oscila.'],
    ['vib_speed', 'Velocidade', 0, 'Quão rápido o tom oscila.'],
  ]],
  ['Arpejo', [
    ['arp_mod', 'Salto de tom', 1, 'Muda o tom de repente no meio do som (moedas usam isso).'],
    ['arp_speed', 'Momento do salto', 0, 'Quando o salto acontece.'],
  ]],
  ['Timbre', [
    ['duty', 'Largura do pulso', 0, 'Só para onda quadrada: deixa o som mais cheio ou mais fino.'],
    ['duty_ramp', 'Variação do pulso', 1, 'Muda a largura do pulso ao longo do som.'],
  ]],
  ['Repetição e phaser', [
    ['repeat_speed', 'Repetição', 0, 'Reinicia o som várias vezes, em sequência.'],
    ['pha_offset', 'Phaser', 1, 'Efeito metálico de "jato".'],
    ['pha_ramp', 'Movimento do phaser', 1, 'Faz o phaser varrer ao longo do som.'],
  ]],
  ['Filtros', [
    ['lpf_freq', 'Passa-baixa', 0, 'Abafa o som. No máximo, desligado.'],
    ['lpf_ramp', 'Movimento do passa-baixa', 1, 'Abre ou fecha o filtro ao longo do som.'],
    ['lpf_resonance', 'Ressonância', 0, 'Realça a frequência do filtro.'],
    ['hpf_freq', 'Passa-alta', 0, 'Tira os graves.'],
    ['hpf_ramp', 'Movimento do passa-alta', 1, 'Varre o passa-alta ao longo do som.'],
  ]],
];
export const WAVES = ['Quadrada', 'Serra', 'Seno', 'Ruído'];

export function defaults() {
  return { wave_type: 0, base_freq: 0.3, freq_limit: 0, freq_ramp: 0, freq_dramp: 0, vib_strength: 0, vib_speed: 0, arp_mod: 0, arp_speed: 0,
    duty: 0, duty_ramp: 0, repeat_speed: 0, pha_offset: 0, pha_ramp: 0, lpf_freq: 1, lpf_ramp: 0, lpf_resonance: 0, hpf_freq: 0, hpf_ramp: 0,
    env_attack: 0, env_sustain: 0.3, env_punch: 0, env_decay: 0.4, sound_vol: 0.5 };
}

export const KINDS = {
  coin: ['Moeda', () => { const p = defaults(); p.base_freq = 0.4 + frnd(0.5); p.env_sustain = frnd(0.1); p.env_decay = 0.1 + frnd(0.4); p.env_punch = 0.3 + frnd(0.3); if (coin()) { p.arp_speed = 0.5 + frnd(0.2); p.arp_mod = 0.2 + frnd(0.4); } return p; }],
  laser: ['Laser', () => {
    const p = defaults(); p.wave_type = irnd(2); if (p.wave_type === 2 && coin()) p.wave_type = irnd(1);
    p.base_freq = 0.5 + frnd(0.5); p.freq_limit = Math.max(0.2, p.base_freq - 0.2 - frnd(0.6)); p.freq_ramp = -0.15 - frnd(0.2);
    if (irnd(2) === 0) { p.base_freq = 0.3 + frnd(0.6); p.freq_limit = frnd(0.1); p.freq_ramp = -0.35 - frnd(0.3); }
    if (coin()) { p.duty = frnd(0.5); p.duty_ramp = frnd(0.2); } else { p.duty = 0.4 + frnd(0.5); p.duty_ramp = -frnd(0.7); }
    p.env_sustain = 0.1 + frnd(0.2); p.env_decay = frnd(0.4); if (coin()) p.env_punch = frnd(0.3);
    if (irnd(2) === 0) { p.pha_offset = frnd(0.2); p.pha_ramp = -frnd(0.2); }
    if (coin()) p.hpf_freq = frnd(0.3);
    return p;
  }],
  boom: ['Explosão', () => {
    const p = defaults(); p.wave_type = 3;
    if (coin()) { p.base_freq = 0.1 + frnd(0.4); p.freq_ramp = -0.1 + frnd(0.4); } else { p.base_freq = 0.2 + frnd(0.7); p.freq_ramp = -0.2 - frnd(0.2); }
    p.base_freq *= p.base_freq; if (irnd(4) === 0) p.freq_ramp = 0; if (irnd(2) === 0) p.repeat_speed = 0.3 + frnd(0.5);
    p.env_sustain = 0.1 + frnd(0.3); p.env_decay = frnd(0.5);
    if (coin()) { p.pha_offset = -0.3 + frnd(0.9); p.pha_ramp = -frnd(0.3); }
    p.env_punch = 0.2 + frnd(0.6);
    if (coin()) { p.vib_strength = frnd(0.7); p.vib_speed = frnd(0.6); }
    if (irnd(2) === 0) { p.arp_speed = 0.6 + frnd(0.3); p.arp_mod = 0.8 - frnd(1.6); }
    return p;
  }],
  power: ['Power-up', () => {
    const p = defaults(); if (coin()) p.wave_type = 1; else p.duty = frnd(0.6);
    if (coin()) { p.base_freq = 0.2 + frnd(0.3); p.freq_ramp = 0.1 + frnd(0.4); p.repeat_speed = 0.4 + frnd(0.4); }
    else { p.base_freq = 0.2 + frnd(0.3); p.freq_ramp = 0.05 + frnd(0.2); if (coin()) { p.vib_strength = frnd(0.7); p.vib_speed = frnd(0.6); } }
    p.env_sustain = frnd(0.4); p.env_decay = 0.1 + frnd(0.4);
    return p;
  }],
  hit: ['Dano', () => {
    const p = defaults(); p.wave_type = irnd(2); if (p.wave_type === 2) p.wave_type = 3; if (p.wave_type === 0) p.duty = frnd(0.6);
    p.base_freq = 0.2 + frnd(0.6); p.freq_ramp = -0.3 - frnd(0.4); p.env_sustain = frnd(0.1); p.env_decay = 0.1 + frnd(0.2);
    if (coin()) p.hpf_freq = frnd(0.3);
    return p;
  }],
  jump: ['Pulo', () => {
    const p = defaults(); p.duty = frnd(0.6); p.base_freq = 0.3 + frnd(0.3); p.freq_ramp = 0.1 + frnd(0.2);
    p.env_sustain = 0.1 + frnd(0.3); p.env_decay = 0.1 + frnd(0.2);
    if (coin()) p.hpf_freq = frnd(0.3); if (coin()) p.lpf_freq = 1 - frnd(0.6);
    return p;
  }],
  blip: ['Clique de menu', () => {
    const p = defaults(); p.wave_type = irnd(1); if (p.wave_type === 0) p.duty = frnd(0.6);
    p.base_freq = 0.2 + frnd(0.4); p.env_sustain = 0.1 + frnd(0.1); p.env_decay = frnd(0.2); p.hpf_freq = 0.1;
    return p;
  }],
  random: ['Aleatório', () => {
    const p = defaults(), c = (v) => Math.max(-1, Math.min(1, v));
    p.wave_type = irnd(3);
    p.base_freq = Math.pow(frnd(2) - 1, 2); if (coin()) p.base_freq = Math.pow(frnd(2) - 1, 3) + 0.5;
    p.freq_limit = 0; p.freq_ramp = Math.pow(frnd(2) - 1, 5);
    if (p.base_freq > 0.7 && p.freq_ramp > 0.2) p.freq_ramp = -p.freq_ramp;
    if (p.base_freq < 0.2 && p.freq_ramp < -0.05) p.freq_ramp = -p.freq_ramp;
    p.freq_dramp = Math.pow(frnd(2) - 1, 3); p.duty = frnd(2) - 1; p.duty_ramp = Math.pow(frnd(2) - 1, 3);
    p.vib_strength = Math.pow(frnd(2) - 1, 3); p.vib_speed = frnd(2) - 1;
    p.env_attack = Math.pow(frnd(2) - 1, 3); p.env_sustain = Math.pow(frnd(2) - 1, 2); p.env_decay = frnd(2) - 1; p.env_punch = Math.pow(frnd(0.8), 2);
    if (p.env_attack + p.env_sustain + p.env_decay < 0.2) { p.env_sustain += 0.2 + frnd(0.3); p.env_decay += 0.2 + frnd(0.3); }
    p.lpf_resonance = frnd(2) - 1; p.lpf_freq = 1 - Math.pow(frnd(1), 3); p.lpf_ramp = Math.pow(frnd(2) - 1, 3);
    if (p.lpf_freq < 0.1 && p.lpf_ramp < -0.05) p.lpf_ramp = -p.lpf_ramp;
    p.hpf_freq = Math.pow(frnd(1), 5); p.hpf_ramp = Math.pow(frnd(2) - 1, 5);
    p.pha_offset = Math.pow(frnd(2) - 1, 3); p.pha_ramp = Math.pow(frnd(2) - 1, 3);
    p.repeat_speed = frnd(2) - 1; p.arp_speed = frnd(2) - 1; p.arp_mod = frnd(2) - 1;
    for (const k of Object.keys(p)) if (k !== 'wave_type' && k !== 'sound_vol') p[k] = c(p[k]);
    for (const k of ['base_freq', 'env_attack', 'env_sustain', 'env_decay', 'env_punch', 'lpf_freq', 'lpf_resonance', 'hpf_freq', 'repeat_speed', 'arp_speed', 'vib_strength', 'vib_speed', 'duty']) p[k] = Math.abs(p[k]);
    return p;
  }],
};

export function mutate(src) {
  const p = { ...src }, signed = new Set(PARAMS.flatMap(([, ps]) => ps.filter((x) => x[2]).map((x) => x[0])));
  for (const [, ps] of PARAMS) for (const [k] of ps) if (coin()) p[k] = Math.max(signed.has(k) ? -1 : 0, Math.min(1, p[k] + frnd(0.1) - 0.05));
  return p;
}

export function synth(p) {
  const RATE = 44100, out = [];
  let fperiod, fmaxperiod, fslide, fdslide, period, square_duty, square_slide, arp_mod, arp_time, arp_limit;
  let fltp, fltdp, fltw, fltw_d, fltdmp, fltphp, flthp, flthp_d, vib_phase, vib_speed, vib_amp;
  let env_vol, env_stage, env_time, env_length, fphase, fdphase, iphase, ipp, rep_time, rep_limit, phase = 0;
  const phaser = new Float32Array(1024), noise = new Float32Array(32);
  const reset = (restart) => {
    fperiod = 100 / (p.base_freq * p.base_freq + 0.001);
    period = fperiod | 0;
    fmaxperiod = 100 / (p.freq_limit * p.freq_limit + 0.001);
    fslide = 1 - Math.pow(p.freq_ramp, 3) * 0.01;
    fdslide = -Math.pow(p.freq_dramp, 3) * 0.000001;
    square_duty = 0.5 - p.duty * 0.5;
    square_slide = -p.duty_ramp * 0.00005;
    arp_mod = p.arp_mod >= 0 ? 1 - p.arp_mod * p.arp_mod * 0.9 : 1 + p.arp_mod * p.arp_mod * 10;
    arp_time = 0;
    arp_limit = p.arp_speed === 1 ? 0 : (Math.pow(1 - p.arp_speed, 2) * 20000 + 32) | 0;
    if (!restart) {
      fltp = 0; fltdp = 0;
      fltw = Math.pow(p.lpf_freq, 3) * 0.1; fltw_d = 1 + p.lpf_ramp * 0.0001;
      fltdmp = Math.min(0.8, (5 / (1 + p.lpf_resonance * p.lpf_resonance * 20)) * (0.01 + fltw));
      fltphp = 0; flthp = p.hpf_freq * p.hpf_freq * 0.1; flthp_d = 1 + p.hpf_ramp * 0.0003;
      vib_phase = 0; vib_speed = p.vib_speed * p.vib_speed * 0.01; vib_amp = p.vib_strength * 0.5;
      env_vol = 0; env_stage = 0; env_time = 0;
      env_length = [p.env_attack * p.env_attack * 100000, p.env_sustain * p.env_sustain * 100000, p.env_decay * p.env_decay * 100000].map((v) => Math.max(1, v | 0));
      fphase = p.pha_offset * p.pha_offset * 1020; if (p.pha_offset < 0) fphase = -fphase;
      fdphase = p.pha_ramp * p.pha_ramp; if (p.pha_ramp < 0) fdphase = -fdphase;
      iphase = Math.abs(fphase | 0); ipp = 0; phaser.fill(0);
      for (let i = 0; i < 32; i++) noise[i] = Math.random() * 2 - 1;
      rep_time = 0;
      rep_limit = p.repeat_speed === 0 ? 0 : (Math.pow(1 - p.repeat_speed, 2) * 20000 + 32) | 0;
    }
  };
  reset(false);
  const maxLen = RATE * 6;
  while (out.length < maxLen) {
    rep_time++;
    if (rep_limit && rep_time >= rep_limit) { rep_time = 0; reset(true); }
    arp_time++;
    if (arp_limit && arp_time >= arp_limit) { arp_limit = 0; fperiod *= arp_mod; }
    fslide += fdslide; fperiod *= fslide;
    if (fperiod > fmaxperiod) { fperiod = fmaxperiod; if (p.freq_limit > 0) break; }
    let rf = fperiod;
    if (vib_amp > 0) { vib_phase += vib_speed; rf = fperiod * (1 + Math.sin(vib_phase) * vib_amp); }
    period = Math.max(8, rf | 0);
    square_duty = Math.max(0, Math.min(0.5, square_duty + square_slide));
    env_time++;
    if (env_time > env_length[env_stage]) { env_time = 0; env_stage++; if (env_stage === 3) break; }
    if (env_stage === 0) env_vol = env_time / env_length[0];
    else if (env_stage === 1) env_vol = 1 + (1 - env_time / env_length[1]) * 2 * p.env_punch;
    else env_vol = 1 - env_time / env_length[2];
    fphase += fdphase; iphase = Math.min(1023, Math.abs(fphase | 0));
    if (flthp_d !== 0) flthp = Math.max(0.00001, Math.min(0.1, flthp * flthp_d));
    let ss = 0;
    for (let si = 0; si < 8; si++) {
      let s = 0;
      phase++;
      if (phase >= period) { phase %= period; if (p.wave_type === 3) for (let i = 0; i < 32; i++) noise[i] = Math.random() * 2 - 1; }
      const fp = phase / period;
      if (p.wave_type === 0) s = fp < square_duty ? 0.5 : -0.5;
      else if (p.wave_type === 1) s = 1 - fp * 2;
      else if (p.wave_type === 2) s = Math.sin(fp * 2 * Math.PI);
      else s = noise[((phase * 32) / period) | 0];
      const pp = fltp;
      fltw = Math.max(0, Math.min(0.1, fltw * fltw_d));
      if (p.lpf_freq !== 1) { fltdp += (s - fltp) * fltw; fltdp -= fltdp * fltdmp; } else { fltp = s; fltdp = 0; }
      fltp += fltdp;
      fltphp += fltp - pp; fltphp -= fltphp * flthp; s = fltphp;
      phaser[ipp & 1023] = s; s += phaser[(ipp - iphase + 1024) & 1023]; ipp = (ipp + 1) & 1023;
      ss += s * env_vol;
    }
    ss = (ss / 8) * 0.05 * 2 * p.sound_vol * 4;
    out.push(Math.max(-1, Math.min(1, ss)));
  }
  const n = Math.max(1, out.length);
  const b = new AudioBuffer({ numberOfChannels: 1, length: n, sampleRate: RATE });
  b.copyToChannel(Float32Array.from(out.length ? out : [0]), 0);
  return b;
}
