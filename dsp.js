// Processamento de áudio do SFX Studio: efeitos, renderização, mixagem e codificação.

const AC = window.AudioContext || window.webkitAudioContext;
let _ctx;
export function ctx() {
  if (!_ctx) _ctx = new AC();
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

export function newBuf(ch, len, rate) {
  return new AudioBuffer({ numberOfChannels: Math.max(1, ch), length: Math.max(1, len | 0), sampleRate: rate });
}

const PCT = (label, def, hint) => ({ label, min: 0, max: 100, def, step: 1, unit: '%', hint });
const MIX = (def) => PCT('Mix', def, 'Quanto do som com efeito entra no resultado. 100% é só o efeito; valores menores misturam com o som original.');
const HZ = (label, min, max, def, hint) => ({ label, min, max, def, step: 1, unit: 'Hz', log: 1, hint });
const Q = (label, def, hint) => ({ label, min: 0.1, max: 20, def, step: 0.1, unit: '', hint });

export const FX = {
  denoise: {
    label: 'Redução de ruído',
    info: 'Remove chiado e barulho constante do ambiente (ventilador, ar-condicionado, trânsito ao fundo). Ele procura os trechos mais silenciosos da gravação, aprende como é o ruído ali e tira esse ruído do som inteiro.',
    tip: 'Funciona melhor quando a gravação tem meio segundo de silêncio no começo ou no fim. Coloque este efeito primeiro na lista. Exagerar deixa o som metálico ou "aquoso".',
    params: {
      amount: PCT('Força', 80, 'Quanto do ruído é removido. Comece em 60–80% e suba se ainda ouvir chiado.'),
      sens: { label: 'Sensibilidade', min: 1, max: 4, def: 1.5, step: 0.1, unit: 'x', hint: 'Quanto acima do ruído aprendido um som precisa estar para ser preservado. Valores altos limpam mais, mas podem comer partes baixas do som.' },
    },
  },
  gate: {
    label: 'Noise gate',
    info: 'Silencia os momentos em que o som está abaixo de um volume mínimo. Ótimo para limpar os espaços entre palavras ou o barulho antes e depois de um efeito sonoro.',
    tip: 'Use junto com a Redução de ruído: ela limpa o ruído por baixo do som, e o gate deixa os silêncios totalmente limpos.',
    params: {
      thr: { label: 'Limiar', min: -80, max: -5, def: -40, step: 1, unit: 'dB', hint: 'Abaixo deste volume o som é silenciado. Suba até o ruído sumir, sem cortar o começo ou o fim do som.' },
      range: { label: 'Redução', min: 6, max: 80, def: 60, step: 1, unit: 'dB', hint: 'Quanto o volume cai quando o gate fecha. 80 dB é silêncio total; valores menores deixam um pouco do ambiente, soando mais natural.' },
      rel: { label: 'Liberação', min: 10, max: 1000, def: 150, step: 5, unit: 'ms', hint: 'Quanto tempo o gate leva para fechar depois que o som cai. Valores curtos cortam caudas de reverb; longos são mais suaves.' },
    },
  },
  gain: {
    label: 'Volume',
    info: 'Aumenta ou diminui o volume do som neste ponto da lista.',
    params: { db: { label: 'Ganho', min: -24, max: 24, def: 0, step: 0.5, unit: 'dB', hint: '+6 dB dobra a sensação de volume; -6 dB reduz pela metade. Cuidado com valores altos, que podem estourar.' } },
  },
  pitch: {
    label: 'Pitch (mantém duração)',
    info: 'Deixa o som mais grave ou mais agudo sem mudar a duração. Bom para vozes de monstro, criança ou criatura.',
    params: { semi: { label: 'Tom', min: -24, max: 24, def: -5, step: 0.5, unit: 'st', hint: 'Em semitons. 12 é uma oitava. Negativo deixa grave (monstro); positivo deixa agudo (esquilo).' } },
  },
  speed: {
    label: 'Velocidade (mantém tom)',
    info: 'Acelera ou desacelera o som sem mudar se ele é grave ou agudo.',
    params: { rate: { label: 'Velocidade', min: 0.25, max: 4, def: 1.5, step: 0.05, unit: 'x', hint: '1x é o original. 2x dura metade do tempo; 0,5x dura o dobro.' } },
  },
  tape: {
    label: 'Fita (tom + velocidade)',
    info: 'Muda velocidade e tom juntos, como tocar uma fita ou disco mais rápido ou mais devagar. Mais lento fica grave e arrastado; mais rápido fica agudo e acelerado.',
    params: { rate: { label: 'Rotação', min: 0.25, max: 4, def: 0.7, step: 0.05, unit: 'x', hint: 'Abaixo de 1x: grave e lento, bom para gigantes e máquinas pesadas. Acima: agudo e rápido.' } },
  },
  dist: {
    label: 'Distorção',
    info: 'Satura o som até ele "rasgar", deixando mais agressivo e sujo. Bom para explosões, motores, golpes e vozes de vilão.',
    params: {
      drive: PCT('Drive', 50, 'Intensidade da distorção. Valores baixos aquecem; altos deixam o som estourado.'),
      tone: HZ('Tom', 500, 16000, 6000, 'Corta os agudos depois da distorção. Mais baixo fica abafado e pesado; mais alto fica áspero.'),
      mix: MIX(100),
    },
  },
  crush: {
    label: 'Bitcrusher 8-bit',
    info: 'Reduz a qualidade digital do som de propósito, imitando videogames antigos e aparelhos digitais baratos.',
    params: {
      bits: { label: 'Bits', min: 1, max: 16, def: 6, step: 1, unit: '', hint: 'Menos bits deixa o som mais áspero e granulado. 8 lembra consoles antigos; 2–4 é bem destruído.' },
      down: { label: 'Redução', min: 1, max: 40, def: 6, step: 1, unit: 'x', hint: 'Diminui a taxa de amostragem. Valores altos deixam o som metálico e "robótico".' },
      mix: MIX(100),
    },
  },
  lowpass: {
    label: 'Passa-baixa (abafar)',
    info: 'Deixa passar só os graves e corta os agudos. O som fica abafado, como ouvido através de uma parede, debaixo d’água ou de longe.',
    params: { freq: HZ('Corte', 40, 20000, 1500, 'Acima desta frequência o som é cortado. Quanto mais baixo, mais abafado.'), q: Q('Ressonância', 0.7, 'Realça a região do corte. Valores altos criam um "assobio" na frequência de corte.') },
  },
  highpass: {
    label: 'Passa-alta (tirar grave)',
    info: 'Deixa passar só os agudos e corta os graves. Limpa ronco, vento e batidas no microfone, ou deixa o som fino.',
    tip: 'Um corte em torno de 80–120 Hz limpa vozes sem deixá-las finas.',
    params: { freq: HZ('Corte', 20, 12000, 800, 'Abaixo desta frequência o som é cortado. Quanto mais alto, mais fino.'), q: Q('Ressonância', 0.7, 'Realça a região do corte.') },
  },
  bandpass: {
    label: 'Passa-banda',
    info: 'Deixa passar só uma faixa de frequências e corta o resto, isolando uma "fatia" do som.',
    params: { freq: HZ('Centro', 60, 12000, 1000, 'O meio da faixa que continua soando.'), q: Q('Largura', 2, 'Valores altos deixam a faixa mais estreita e o efeito mais forte.') },
  },
  echo: {
    label: 'Eco',
    info: 'Repete o som várias vezes, cada vez mais baixo, como em uma caverna ou um vale.',
    params: {
      time: { label: 'Tempo', min: 10, max: 1500, def: 250, step: 5, unit: 'ms', hint: 'Intervalo entre as repetições. Curto soa metálico; longo soa como um vale.' },
      fb: { label: 'Repetições', min: 0, max: 90, def: 40, step: 1, unit: '%', hint: 'Quanto cada repetição volta. Valores altos fazem o eco durar muito.' },
      mix: MIX(40),
    },
  },
  reverb: {
    label: 'Reverb',
    info: 'Simula o som dentro de um ambiente: sala, salão, catedral. Dá sensação de espaço e distância.',
    params: {
      size: { label: 'Tamanho', min: 0.1, max: 8, def: 2, step: 0.1, unit: 's', hint: 'Duração da cauda. 0,5 s é uma sala; 3 s um salão; 6 s ou mais, uma catedral.' },
      decay: { label: 'Decaimento', min: 1, max: 10, def: 3, step: 0.1, unit: '', hint: 'Quão rápido a cauda some. Valores altos somem rápido; baixos ficam longos e densos.' },
      mix: MIX(35),
    },
  },
  robot: {
    label: 'Robô',
    info: 'Multiplica o som por um tom eletrônico (ring modulator), criando vozes metálicas de robô, alien ou rádio quebrado.',
    params: { freq: HZ('Frequência', 10, 1000, 50, 'Abaixo de ~30 Hz soa como um tremor; 50–150 Hz é robô clássico; acima disso fica alienígena.'), mix: MIX(100) },
  },
  radio: {
    label: 'Rádio / telefone',
    info: 'Imita o som saindo de um rádio, walkie-talkie ou telefone: sem graves, sem agudos, um pouco saturado e com chiado.',
    params: {
      low: HZ('Corta grave em', 100, 1500, 400, 'Tudo abaixo desta frequência some. Mais alto soa mais "de telefone".'),
      high: HZ('Corta agudo em', 1500, 8000, 3000, 'Tudo acima desta frequência some. Mais baixo soa mais velho e abafado.'),
      drive: PCT('Saturação', 30, 'Sujeira do alto-falante pequeno.'),
      noise: PCT('Chiado', 10, 'Ruído de fundo de transmissão.'),
    },
  },
  tremolo: {
    label: 'Tremolo',
    info: 'Faz o volume subir e descer repetidamente, criando um som pulsante ou vibrante.',
    params: { rate: { label: 'Velocidade', min: 0.5, max: 30, def: 6, step: 0.1, unit: 'Hz', hint: 'Pulsos por segundo. Rápido soa como asas de inseto ou motor.' }, depth: PCT('Profundidade', 70, 'Quanto o volume cai em cada pulso.') },
  },
  chorus: {
    label: 'Chorus',
    info: 'Soma cópias do som levemente desafinadas e atrasadas, deixando ele mais largo, brilhante e "etéreo", como várias vozes juntas.',
    params: { rate: { label: 'Velocidade', min: 0.1, max: 5, def: 1.2, step: 0.1, unit: 'Hz', hint: 'Quão rápido a desafinação oscila.' }, depth: PCT('Profundidade', 40, 'Quanto as cópias desafinam.'), mix: MIX(50) },
  },
};

export function defaultParams(type) {
  const p = {};
  for (const [k, v] of Object.entries(FX[type].params)) p[k] = v.def;
  return p;
}

// ---------- utilitários ----------
function mapCh(buf, fn) {
  const out = [];
  let len = 1;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const r = fn(buf.getChannelData(c), c);
    out.push(r);
    len = Math.max(len, r.length);
  }
  const b = newBuf(out.length, len, buf.sampleRate);
  out.forEach((d, c) => b.copyToChannel(d, c));
  return b;
}

function resample(x, step) {
  const n = Math.max(1, Math.floor(x.length / step)), y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * step, j = p | 0, f = p - j;
    y[i] = (x[j] || 0) * (1 - f) + (x[j + 1] || 0) * f;
  }
  return y;
}

// Time-stretch WSOLA: muda a duração sem mudar o tom.
function stretch(xIn, s) {
  if (Math.abs(s - 1) < 1e-3) return xIn.slice();
  const N = 1024, H = N / 2, T = 256;
  const x = new Float32Array(xIn.length + H);
  x.set(xIn, H);
  const w = new Float32Array(N);
  for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const outLen = Math.floor(x.length * s);
  const y = new Float32Array(outLen + N);
  const frames = Math.ceil(outLen / H) + 1;
  const get = (i) => (i >= 0 && i < x.length ? x[i] : 0);
  let prev = 0;
  for (let k = 0; k < frames; k++) {
    const nominal = Math.round(k * H / s);
    let best = nominal;
    if (k > 0) {
      const nat = prev + H;
      let bestC = -Infinity;
      for (let d = -T; d <= T; d += 4) {
        const p = nominal + d;
        if (p < 0) continue;
        let c = 0;
        for (let i = 0; i < H; i += 4) c += get(p + i) * get(nat + i);
        if (c > bestC) { bestC = c; best = p; }
      }
    }
    const o = k * H;
    for (let i = 0; i < N && o + i < y.length; i++) y[o + i] += get(best + i) * w[i];
    prev = best;
  }
  const skip = Math.round(H * s);
  return y.slice(skip, skip + Math.max(1, Math.floor(xIn.length * s)));
}

function curve(drive) {
  const k = Math.pow(drive / 100, 2) * 300, n = 2048, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * 2 / n - 1;
    c[i] = (1 + k) * x / (1 + k * Math.abs(x));
  }
  return c;
}

async function graph(buf, tailSec, build) {
  const rate = buf.sampleRate, ch = Math.max(1, buf.numberOfChannels);
  const c = new OfflineAudioContext(ch, Math.ceil(buf.length + tailSec * rate), rate);
  const src = c.createBufferSource();
  src.buffer = buf;
  const out = build(c, src);
  out.connect(c.destination);
  src.start();
  return c.startRendering();
}

function wetDry(c, src, inp, out, mix) {
  const o = c.createGain(), d = c.createGain(), w = c.createGain();
  d.gain.value = 1 - mix;
  w.gain.value = mix;
  src.connect(d).connect(o);
  src.connect(inp);
  out.connect(w).connect(o);
  return o;
}

function biquad(type) {
  return (b, p) => graph(b, 0, (c, src) => {
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = p.freq;
    f.Q.value = p.q;
    src.connect(f);
    return f;
  });
}


// FFT radix-2 in-place
function fft(re, im, inv) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (inv ? 2 : -2) * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const u = i + k, v = u + len / 2;
        const tr = re[v] * cr - im[v] * ci, ti = re[v] * ci + im[v] * cr;
        re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

// Redução de ruído espectral: aprende o ruído nos trechos mais silenciosos.
function denoise(x, p) {
  const N = 2048, H = 512, B = N / 2 + 1;
  const w = new Float32Array(N);
  for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const pad = new Float32Array(x.length + 2 * N);
  pad.set(x, N);
  const F = Math.floor((pad.length - N) / H) + 1;
  const mags = [], phs = [], energy = new Float32Array(F);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let f = 0; f < F; f++) {
    const o = f * H;
    for (let i = 0; i < N; i++) { re[i] = pad[o + i] * w[i]; im[i] = 0; }
    fft(re, im, false);
    const m = new Float32Array(B), ph = new Float32Array(B);
    let e = 0;
    for (let k = 0; k < B; k++) { m[k] = Math.hypot(re[k], im[k]); ph[k] = Math.atan2(im[k], re[k]); e += m[k] * m[k]; }
    mags.push(m); phs.push(ph); energy[f] = e;
  }
  // perfil de ruído: média dos 15% de quadros mais silenciosos (ignorando silêncio digital do preenchimento)
  const order = [...energy.keys()].filter((f) => energy[f] > 1e-12).sort((a, b) => energy[a] - energy[b]);
  const take = order.slice(0, Math.max(1, Math.floor(order.length * 0.15)));
  const noise = new Float32Array(B);
  for (const f of take) for (let k = 0; k < B; k++) noise[k] += mags[f][k] / take.length;
  const floor = 1 - p.amount / 100, k2 = p.sens;
  const y = new Float32Array(pad.length), prev = new Float32Array(B).fill(1);
  for (let f = 0; f < F; f++) {
    const m = mags[f], ph = phs[f];
    for (let k = 0; k < B; k++) {
      let g = m[k] > 0 ? 1 - k2 * noise[k] / m[k] : 0;
      g = Math.max(floor, Math.min(1, g));
      g = 0.5 * g + 0.5 * prev[k];
      prev[k] = g;
      const a = m[k] * g;
      re[k] = a * Math.cos(ph[k]); im[k] = a * Math.sin(ph[k]);
      if (k > 0 && k < N / 2) { re[N - k] = re[k]; im[N - k] = -im[k]; }
    }
    fft(re, im, true);
    const o = f * H;
    for (let i = 0; i < N; i++) y[o + i] += re[i] * w[i] / 1.5;
  }
  return y.slice(N, N + x.length);
}

function gate(x, p, rate) {
  const thr = Math.pow(10, p.thr / 20), low = Math.pow(10, -p.range / 20);
  const atk = Math.exp(-1 / (0.002 * rate)), rel = Math.exp(-1 / (p.rel / 1000 * rate)), envRel = Math.exp(-1 / (0.02 * rate));
  const hold = Math.floor(0.02 * rate);
  const y = new Float32Array(x.length);
  let env = 0, g = low, h = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    env = a > env ? a : env * envRel;
    let target;
    if (env >= thr) { target = 1; h = hold; } else if (h > 0) { target = 1; h--; } else target = low;
    g = target > g ? target + (g - target) * atk : target + (g - target) * rel;
    y[i] = x[i] * g;
  }
  return y;
}

// ---------- efeitos ----------
const PROC = {
  denoise: (b, p) => mapCh(b, (x) => denoise(x, p)),
  gate: (b, p) => mapCh(b, (x) => gate(x, p, b.sampleRate)),
  gain: (b, p) => { const g = Math.pow(10, p.db / 20); return mapCh(b, (x) => x.map((v) => v * g)); },
  pitch: (b, p) => { const r = Math.pow(2, p.semi / 12); return mapCh(b, (x) => resample(stretch(x, r), r)); },
  speed: (b, p) => mapCh(b, (x) => stretch(x, 1 / p.rate)),
  tape: (b, p) => mapCh(b, (x) => resample(x, p.rate)),
  dist: (b, p) => graph(b, 0, (c, src) => {
    const sh = c.createWaveShaper();
    sh.curve = curve(p.drive);
    sh.oversample = '4x';
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = p.tone;
    sh.connect(lp);
    return wetDry(c, src, sh, lp, p.mix / 100);
  }),
  crush: (b, p) => mapCh(b, (x) => {
    const q = Math.pow(2, p.bits - 1), m = p.mix / 100, y = new Float32Array(x.length);
    let h = 0;
    for (let i = 0; i < x.length; i++) {
      if (i % p.down === 0) h = Math.round(x[i] * q) / q;
      y[i] = h * m + x[i] * (1 - m);
    }
    return y;
  }),
  lowpass: biquad('lowpass'),
  highpass: biquad('highpass'),
  bandpass: biquad('bandpass'),
  echo: (b, p) => {
    const t = p.time / 1000, f = p.fb / 100;
    const tail = Math.min(12, f > 0.01 ? t * Math.log(0.001) / Math.log(f) : t) + 0.1;
    return graph(b, tail, (c, src) => {
      const d = c.createDelay(2);
      d.delayTime.value = t;
      const g = c.createGain();
      g.gain.value = f;
      d.connect(g).connect(d);
      return wetDry(c, src, d, d, p.mix / 100);
    });
  },
  reverb: (b, p) => graph(b, p.size, (c, src) => {
    const n = Math.max(1, Math.floor(p.size * b.sampleRate)), ir = c.createBuffer(2, n, b.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, p.decay);
    }
    const cv = c.createConvolver();
    cv.buffer = ir;
    return wetDry(c, src, cv, cv, p.mix / 100);
  }),
  robot: (b, p) => graph(b, 0, (c, src) => {
    const g = c.createGain();
    g.gain.value = 0;
    const o = c.createOscillator();
    o.frequency.value = p.freq;
    o.connect(g.gain);
    o.start();
    return wetDry(c, src, g, g, p.mix / 100);
  }),
  radio: (b, p) => graph(b, 0, (c, src) => {
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = p.low; hp.Q.value = 0.9;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = p.high; lp.Q.value = 0.9;
    const sh = c.createWaveShaper(); sh.curve = curve(p.drive);
    const out = c.createGain();
    src.connect(hp).connect(sh).connect(lp).connect(out);
    if (p.noise > 0) {
      const nb = c.createBuffer(1, Math.max(1, b.length), b.sampleRate), d = nb.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const ns = c.createBufferSource(); ns.buffer = nb;
      const ng = c.createGain(); ng.gain.value = p.noise / 100 * 0.08;
      ns.connect(ng).connect(out);
      ns.start();
    }
    return out;
  }),
  tremolo: (b, p) => graph(b, 0, (c, src) => {
    const dep = p.depth / 100, g = c.createGain();
    g.gain.value = 1 - dep / 2;
    const o = c.createOscillator(); o.frequency.value = p.rate;
    const og = c.createGain(); og.gain.value = dep / 2;
    o.connect(og).connect(g.gain);
    o.start();
    src.connect(g);
    return g;
  }),
  chorus: (b, p) => graph(b, 0.05, (c, src) => {
    const d = c.createDelay(0.1); d.delayTime.value = 0.025;
    const o = c.createOscillator(); o.frequency.value = p.rate;
    const og = c.createGain(); og.gain.value = 0.012 * p.depth / 100;
    o.connect(og).connect(d.delayTime);
    o.start();
    return wetDry(c, src, d, d, p.mix / 100);
  }),
};

function normalize(b, target) {
  let peak = 0;
  for (let c = 0; c < b.numberOfChannels; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  }
  if (peak < 1e-6) return b;
  const g = target / peak;
  return mapCh(b, (x) => x.map((v) => v * g));
}

// Aplica corte, reversão, cadeia de efeitos, fades e normalização. O original nunca é alterado.
export async function renderClip(orig, e, chain) {
  const r = orig.sampleRate;
  const s = Math.max(0, Math.floor((e.start || 0) * r));
  let en = e.end == null ? orig.length : Math.floor(e.end * r);
  en = Math.min(orig.length, Math.max(s + 1, en));
  let b = newBuf(orig.numberOfChannels, en - s, r);
  for (let c = 0; c < orig.numberOfChannels; c++) b.copyToChannel(orig.getChannelData(c).subarray(s, en), c);
  if (e.reverse) b = mapCh(b, (x) => x.slice().reverse());
  for (const fx of chain || []) if (fx.on && PROC[fx.type]) b = await PROC[fx.type](b, fx.params);
  const fi = Math.floor((e.fadeIn || 0) / 1000 * r), fo = Math.floor((e.fadeOut || 0) / 1000 * r);
  if (fi || fo) b = mapCh(b, (x) => {
    const y = x.slice(), n = y.length;
    for (let i = 0; i < Math.min(fi, n); i++) y[i] *= i / fi;
    for (let i = 0; i < Math.min(fo, n); i++) y[n - 1 - i] *= i / fo;
    return y;
  });
  if (e.normalize) b = normalize(b, 0.89);
  return b;
}

export async function renderMix(items, rate = 44100) {
  let len = 1;
  for (const it of items) len = Math.max(len, Math.ceil((it.offset + it.buf.duration) * rate));
  const c = new OfflineAudioContext(2, len, rate);
  for (const it of items) {
    const s = c.createBufferSource(); s.buffer = it.buf;
    const g = c.createGain(); g.gain.value = it.vol;
    const pn = c.createStereoPanner(); pn.pan.value = it.pan;
    s.connect(g).connect(pn).connect(c.destination);
    s.start(it.offset);
  }
  return c.startRendering();
}

// ---------- exportação ----------
export async function prepare(buf, { rate, mono }) {
  let b = buf;
  if (mono && b.numberOfChannels > 1) {
    const m = new Float32Array(b.length);
    for (let c = 0; c < b.numberOfChannels; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < d.length; i++) m[i] += d[i] / b.numberOfChannels;
    }
    b = newBuf(1, b.length, b.sampleRate);
    b.copyToChannel(m, 0);
  }
  if (rate && rate !== b.sampleRate) {
    const c = new OfflineAudioContext(b.numberOfChannels, Math.max(1, Math.ceil(b.duration * rate)), rate);
    const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start();
    b = await c.startRendering();
  }
  return b;
}

export function encodeWav(b) {
  const ch = b.numberOfChannels, n = b.length, rate = b.sampleRate;
  const ab = new ArrayBuffer(44 + n * ch * 2), v = new DataView(ab);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * ch * 2, true);
  const data = [];
  for (let c = 0; c < ch; c++) data.push(b.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const s = Math.max(-1, Math.min(1, data[c][i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    o += 2;
  }
  return new Blob([ab], { type: 'audio/wav' });
}

let lameP;
function loadLame() {
  return lameP || (lameP = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js';
    s.onload = () => res(window.lamejs);
    s.onerror = () => { lameP = null; rej(new Error('Não consegui carregar o conversor de MP3. Verifique a internet.')); };
    document.head.appendChild(s);
  }));
}

export async function encodeMp3(b) {
  const lame = await loadLame();
  const ch = Math.min(2, b.numberOfChannels);
  const enc = new lame.Mp3Encoder(ch, b.sampleRate, 128);
  const toI16 = (d) => { const o = new Int16Array(d.length); for (let i = 0; i < d.length; i++) { const s = Math.max(-1, Math.min(1, d[i])); o[i] = s < 0 ? s * 0x8000 : s * 0x7fff; } return o; };
  const L = toI16(b.getChannelData(0)), R = ch > 1 ? toI16(b.getChannelData(1)) : null;
  const parts = [];
  for (let i = 0; i < L.length; i += 1152) {
    const l = L.subarray(i, i + 1152);
    const out = R ? enc.encodeBuffer(l, R.subarray(i, i + 1152)) : enc.encodeBuffer(l);
    if (out.length) parts.push(new Uint8Array(out));
  }
  const end = enc.flush();
  if (end.length) parts.push(new Uint8Array(end));
  return new Blob(parts, { type: 'audio/mpeg' });
}
