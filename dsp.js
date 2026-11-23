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
  comp: {
    label: 'Compressor',
    info: 'Diminui a diferença entre as partes altas e baixas do som. O resultado fica mais encorpado, presente e "na cara", como em filmes e jogos.',
    tip: 'Para voz: limiar -24 dB, proporção 4:1. Para impactos: ataque um pouco maior (20 ms) mantém o estalo inicial.',
    params: {
      thr: { label: 'Limiar', min: -60, max: 0, def: -24, step: 1, unit: 'dB', hint: 'A partir deste volume o compressor começa a agir. Mais baixo comprime mais o som.' },
      ratio: { label: 'Proporção', min: 1, max: 20, def: 4, step: 0.5, unit: ':1', hint: 'Quanto o volume acima do limiar é reduzido. 2:1 é suave; 10:1 ou mais é quase um limitador.' },
      atk: { label: 'Ataque', min: 0, max: 200, def: 10, step: 1, unit: 'ms', hint: 'Quão rápido o compressor reage. Curto segura picos; longo deixa passar o estalo inicial.' },
      rel: { label: 'Liberação', min: 10, max: 1000, def: 150, step: 5, unit: 'ms', hint: 'Quão rápido ele solta depois que o som baixa.' },
      makeup: { label: 'Ganho final', min: 0, max: 24, def: 6, step: 0.5, unit: 'dB', hint: 'Recupera o volume perdido com a compressão.' },
    },
  },
  limiter: {
    label: 'Limitador',
    info: 'Impede que o som passe de um volume máximo, segurando os picos sem distorcer. Deixa o som mais alto e seguro contra estouros.',
    tip: 'Coloque no fim da lista. Junto com o Volume antes dele, serve para deixar o som bem alto sem estourar.',
    params: {
      ceil: { label: 'Teto', min: -12, max: 0, def: -1, step: 0.1, unit: 'dB', hint: 'Volume máximo que o som pode atingir. -1 dB é o padrão seguro.' },
      rel: { label: 'Liberação', min: 5, max: 500, def: 60, step: 1, unit: 'ms', hint: 'Quão rápido o volume volta depois de um pico. Curto soa mais alto; longo, mais natural.' },
    },
  },
  eq: {
    label: 'Equalizador',
    info: 'Aumenta ou diminui regiões do som: graves, médios e agudos. Serve para dar peso, tirar som "embolado", deixar mais claro ou mais escuro.',
    tip: 'Corte em vez de aumentar quando puder: tirar médios-graves (300 Hz) limpa; tirar agudos acalma chiado.',
    params: {
      low: { label: 'Graves', min: -18, max: 18, def: 0, step: 0.5, unit: 'dB', hint: 'Abaixo de 120 Hz: peso, impacto e ronco.' },
      f1: HZ('Freq. médio-grave', 100, 2000, 400, 'Centro da faixa de médios-graves.'),
      g1: { label: 'Médio-grave', min: -18, max: 18, def: 0, step: 0.5, unit: 'dB', hint: 'Corpo do som. Em excesso deixa embolado; reduzir limpa.' },
      f2: HZ('Freq. médio-agudo', 1000, 10000, 3000, 'Centro da faixa de médios-agudos.'),
      g2: { label: 'Médio-agudo', min: -18, max: 18, def: 0, step: 0.5, unit: 'dB', hint: 'Presença e clareza. Aumentar destaca vozes; em excesso fica estridente.' },
      high: { label: 'Agudos', min: -18, max: 18, def: 0, step: 0.5, unit: 'dB', hint: 'Acima de 8 kHz: brilho e ar. Reduzir esconde chiado.' },
      q: Q('Largura dos médios', 1, 'Valores altos afetam uma faixa estreita; baixos, uma faixa larga.'),
    },
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

async function graph(buf, tailSec, build, chOut) {
  const rate = buf.sampleRate, ch = chOut || Math.max(1, buf.numberOfChannels);
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
export function fft(re, im, inv) {
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
  comp: (b, p) => graph(b, 0, (c, src) => {
    const k = c.createDynamicsCompressor();
    k.threshold.value = p.thr; k.ratio.value = p.ratio; k.knee.value = 6;
    k.attack.value = p.atk / 1000; k.release.value = p.rel / 1000;
    const g = c.createGain(); g.gain.value = Math.pow(10, p.makeup / 20);
    src.connect(k).connect(g);
    return g;
  }),
  limiter: (b, p) => limit(b, p.ceil, p.rel),
  eq: (b, p) => graph(b, 0, (c, src) => {
    const mk = (type, f, g, q) => { const n = c.createBiquadFilter(); n.type = type; n.frequency.value = f; n.gain.value = g; if (q) n.Q.value = q; return n; };
    const a = mk('lowshelf', 120, p.low), m1 = mk('peaking', p.f1, p.g1, p.q), m2 = mk('peaking', p.f2, p.g2, p.q), h = mk('highshelf', 8000, p.high);
    src.connect(a).connect(m1).connect(m2).connect(h);
    return h;
  }),
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
  const peak = peakOf(b);
  if (peak < 1e-6) return b;
  const g = target / peak;
  return mapCh(b, (x) => x.map((v) => v * g));
}

export function peakOf(b) {
  let peak = 0;
  for (let c = 0; c < b.numberOfChannels; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  }
  return peak;
}

// Limitador com antecipação (lookahead): segura os picos abaixo do teto sem cortar a onda.
export function limit(b, ceilDb = -1, relMs = 60) {
  const ceil = Math.pow(10, ceilDb / 20), n = b.length, rate = b.sampleRate;
  const L = Math.max(1, Math.round(0.005 * rate));
  const req = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let a = 0;
    for (let c = 0; c < b.numberOfChannels; c++) a = Math.max(a, Math.abs(b.getChannelData(c)[i]));
    req[i] = a > ceil ? ceil / a : 1;
  }
  // mínimo numa janela à frente (fila monotônica)
  const win = new Float32Array(n), dq = new Int32Array(n);
  let h = 0, t = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (t > h && req[dq[t - 1]] >= req[i]) t--;
    dq[t++] = i;
    while (dq[h] > i + L) h++;
    win[i] = req[dq[h]];
  }
  const rel = Math.exp(-1 / (relMs / 1000 * rate)), atk = Math.exp(-1 / (L / 2));
  const g = new Float32Array(n);
  let cur = 1;
  for (let i = 0; i < n; i++) {
    const tg = win[i];
    cur = tg < cur ? tg + (cur - tg) * atk : tg + (cur - tg) * rel;
    g[i] = Math.min(cur, req[i]);
  }
  return mapCh(b, (x) => { const y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) y[i] = Math.max(-ceil, Math.min(ceil, x[i] * g[i])); return y; });
}

// Curva de volume desenhada: pontos {t: 0..1, g: 0..2}, interpolação linear.
function applyEnvelope(b, env) {
  const pts = [...env].sort((a, z) => a.t - z.t);
  return mapCh(b, (x) => {
    const y = new Float32Array(x.length), n = x.length;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      while (k < pts.length - 1 && pts[k + 1].t <= t) k++;
      let g;
      if (t <= pts[0].t) g = pts[0].g;
      else if (k >= pts.length - 1) g = pts[pts.length - 1].g;
      else { const a = pts[k], z = pts[k + 1]; g = a.g + (z.g - a.g) * (t - a.t) / Math.max(1e-9, z.t - a.t); }
      y[i] = x[i] * g;
    }
    return y;
  });
}

// Aplica corte, reversão, cadeia de efeitos, curva de volume, fades e normalização. O original nunca é alterado.
export async function renderClip(orig, e, chain) {
  const r = orig.sampleRate;
  const s = Math.max(0, Math.floor((e.start || 0) * r));
  let en = e.end == null ? orig.length : Math.floor(e.end * r);
  en = Math.min(orig.length, Math.max(s + 1, en));
  let b = newBuf(orig.numberOfChannels, en - s, r);
  for (let c = 0; c < orig.numberOfChannels; c++) b.copyToChannel(orig.getChannelData(c).subarray(s, en), c);
  if (e.reverse) b = mapCh(b, (x) => x.slice().reverse());
  if (e.env && e.env.length) b = applyEnvelope(b, e.env);
  for (const fx of chain || []) if (fx.on && PROC[fx.type]) b = await PROC[fx.type](b, fx.params);
  const fi = Math.floor((e.fadeIn || 0) / 1000 * r), fo = Math.floor((e.fadeOut || 0) / 1000 * r);
  if (fi || fo) b = mapCh(b, (x) => {
    const y = x.slice(), n = y.length;
    for (let i = 0; i < Math.min(fi, n); i++) y[i] *= i / fi;
    for (let i = 0; i < Math.min(fo, n); i++) y[n - 1 - i] *= i / fo;
    return y;
  });
  if (e.loop && e.loopXf > 0) b = loopCrossfade(b, e.loopXf);
  if (e.normalize) b = normalize(b, 0.89);
  return b;
}

export async function renderMix(items, rate = 44100) {
  let len = 1;
  for (const it of items) len = Math.max(len, Math.ceil((it.offset + it.buf.duration) * rate));
  const c = new OfflineAudioContext(2, len, rate);
  const ramp = (param, pts, map) => {
    const ps = [...pts].sort((a, b) => a.t - b.t);
    param.setValueAtTime(map(ps[0].v), 0);
    for (const p of ps) param.linearRampToValueAtTime(map(p.v), Math.max(0, p.t));
  };
  for (const it of items) {
    const s = c.createBufferSource(); s.buffer = it.buf;
    const g = c.createGain(); g.gain.value = it.vol;
    const ag = c.createGain();
    const pn = c.createStereoPanner(); pn.pan.value = it.pan;
    let node = s.connect(g).connect(ag);
    const au = it.auto || {};
    if (au.vol?.length) ramp(ag.gain, au.vol, (v) => v * 2);
    if (au.cut?.length) { const f = c.createBiquadFilter(); f.type = 'lowpass'; ramp(f.frequency, au.cut, (v) => 100 * Math.pow(200, v)); node = node.connect(f); }
    if (au.pan?.length) ramp(pn.pan, au.pan, (v) => v * 2 - 1);
    node.connect(pn).connect(c.destination);
    s.start(it.offset);
  }
  return c.startRendering();
}

// ---------- análise ----------
// Trechos com som, separados por silêncios. thrDb é relativo ao pico.
export function detectSegments(b, { thrDb = -35, minSilMs = 200, minSegMs = 40, padMs = 25 } = {}) {
  const rate = b.sampleRate, win = Math.max(1, Math.round(rate * 0.01)), n = b.length;
  const frames = Math.ceil(n / win), lvl = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    const a = f * win, z = Math.min(n, a + win);
    for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = a; i < z; i++) s += d[i] * d[i]; }
    lvl[f] = Math.sqrt(s / Math.max(1, (z - a) * b.numberOfChannels));
  }
  let peak = 0;
  for (const v of lvl) peak = Math.max(peak, v);
  if (peak < 1e-5) return [];
  const thr = peak * Math.pow(10, thrDb / 20), minSil = Math.ceil(minSilMs / 10), minSeg = Math.ceil(minSegMs / 10), pad = padMs / 1000;
  const segs = [];
  let st = -1, quiet = 0;
  for (let f = 0; f < frames; f++) {
    if (lvl[f] >= thr) { if (st < 0) st = f; quiet = 0; }
    else if (st >= 0 && ++quiet >= minSil) { const en = f - quiet + 1; if (en - st >= minSeg) segs.push([st, en]); st = -1; quiet = 0; }
  }
  if (st >= 0 && frames - quiet - st >= minSeg) segs.push([st, frames - quiet]);
  const dur = b.duration;
  return segs.map(([a, z]) => ({ start: Math.max(0, a * win / rate - pad), end: Math.min(dur, z * win / rate + pad) }));
}

// ---------- loudness (ITU-R BS.1770) ----------
function kCoefs(fs) {
  let G = 3.999843853973347, Qh = 0.7071752369554196, fc = 1681.974450955533;
  let K = Math.tan(Math.PI * fc / fs), Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416), a0 = 1 + K / Qh + K * K;
  const s1 = { b: [(Vh + Vb * K / Qh + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Qh + K * K) / a0], a: [2 * (K * K - 1) / a0, (1 - K / Qh + K * K) / a0] };
  const Qp = 0.5003270373238773; fc = 38.13547087602444; K = Math.tan(Math.PI * fc / fs); a0 = 1 + K / Qp + K * K;
  const s2 = { b: [1, -2, 1], a: [2 * (K * K - 1) / a0, (1 - K / Qp + K * K) / a0] };
  return [s1, s2];
}
function biq(x, { b, a }) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
export function loudness(b) {
  const fs = b.sampleRate, [s1, s2] = kCoefs(fs);
  const chans = [];
  for (let c = 0; c < b.numberOfChannels; c++) chans.push(biq(biq(b.getChannelData(c), s1), s2));
  const blk = Math.round(0.4 * fs), hop = Math.round(0.1 * fs);
  const z = [];
  if (b.length < blk) {
    let s = 0;
    for (const d of chans) { let m = 0; for (const v of d) m += v * v; s += m / Math.max(1, d.length); }
    z.push(s);
  } else {
    for (let st = 0; st + blk <= b.length; st += hop) {
      let s = 0;
      for (const d of chans) { let m = 0; for (let i = st; i < st + blk; i++) m += d[i] * d[i]; s += m / blk; }
      z.push(s);
    }
  }
  const L = (v) => -0.691 + 10 * Math.log10(v);
  let g1 = z.filter((v) => L(v) > -70);
  if (!g1.length) return -Infinity;
  const rel = L(g1.reduce((a, v) => a + v, 0) / g1.length) - 10;
  const g2 = g1.filter((v) => L(v) > rel);
  return L(g2.reduce((a, v) => a + v, 0) / g2.length);
}

// ---------- exportação ----------
export async function prepare(buf, { rate, mono, lufs }) {
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
  if (lufs) {
    const cur = loudness(b);
    if (isFinite(cur)) {
      const g = Math.pow(10, (lufs - cur) / 20);
      b = mapCh(b, (x) => x.map((v) => v * g));
      b = limit(b, -1, 50);
    }
  }
  return b;
}

export function encodeWav(b, { loop = false } = {}) {
  const ch = b.numberOfChannels, n = b.length, rate = b.sampleRate;
  const dataLen = n * ch * 2, smplLen = loop ? 8 + 36 + 24 : 0;
  const ab = new ArrayBuffer(44 + dataLen + smplLen), v = new DataView(ab);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataLen + smplLen, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, dataLen, true);
  const data = [];
  for (let c = 0; c < ch; c++) data.push(b.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const s = Math.max(-1, Math.min(1, data[c][i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    o += 2;
  }
  if (loop) {
    // chunk "smpl" com um loop do início ao fim (o Godot detecta ao importar)
    str(o, 'smpl'); v.setUint32(o + 4, 60, true);
    const f = [0, 0, Math.round(1e9 / rate), 60, 0, 0, 0, 1, 0];
    f.forEach((x, k) => v.setUint32(o + 8 + k * 4, x, true));
    const lp = o + 44;
    [0, 0, 0, n - 1, 0, 0].forEach((x, k) => v.setUint32(lp + k * 4, x, true));
  }
  return new Blob([ab], { type: 'audio/wav' });
}

const VENDOR = new URL('./vendor/', import.meta.url).href;
function loadScript(src, ready) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => (ready ? ready(res) : res());
    s.onerror = () => rej(new Error('Não consegui carregar o conversor. Abra o app com internet uma vez para ele ficar salvo.'));
    document.head.appendChild(s);
  });
}

let lameP;
function loadLame() {
  return lameP || (lameP = loadScript(VENDOR + 'lame.min.js').then(() => window.lamejs).catch((e) => { lameP = null; throw e; }));
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

let oggP;
function loadOgg() {
  return oggP || (oggP = new Promise((res, rej) => {
    window.OggVorbisEncoderConfig = { memoryInitializerPrefixURL: VENDOR, onRuntimeInitialized: () => res(window.OggVorbisEncoder) };
    loadScript(VENDOR + 'OggVorbisEncoder.min.js').catch(rej);
    setTimeout(() => rej(new Error('O conversor de OGG demorou demais para carregar.')), 20000);
  }).catch((e) => { oggP = null; throw e; }));
}

export async function encodeOgg(b, quality = 0.6) {
  const Enc = await loadOgg();
  const enc = new Enc(b.sampleRate, b.numberOfChannels, quality);
  const chans = [];
  for (let c = 0; c < b.numberOfChannels; c++) chans.push(b.getChannelData(c));
  const step = 4096;
  for (let i = 0; i < b.length; i += step) enc.encode(chans.map((d) => d.subarray(i, i + step)));
  return enc.finish('audio/ogg');
}

// ---------- edição de trechos (não destrutiva: lista de operações) ----------
function sliceBuf(b, a, z) {
  a = Math.max(0, Math.min(b.length, a)); z = Math.max(a, Math.min(b.length, z));
  const o = newBuf(b.numberOfChannels, Math.max(1, z - a), b.sampleRate);
  for (let c = 0; c < b.numberOfChannels; c++) o.copyToChannel(b.getChannelData(c).subarray(a, Math.max(a + 1, z)), c);
  return o;
}
function concatParts(rate, ch, parts) {
  const len = parts.reduce((s, p) => s + p[0].length, 0);
  const o = newBuf(ch, Math.max(1, len), rate);
  for (let c = 0; c < ch; c++) {
    const d = o.getChannelData(c);
    let off = 0;
    for (const p of parts) { d.set(p[Math.min(c, p.length - 1)], off); off += p[0].length; }
  }
  return o;
}
const chans = (b, a = 0, z = b.length) => Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c).slice(Math.max(0, a), Math.max(0, Math.min(b.length, z))));

function opDelete(b, a, z) {
  const cf = Math.min(Math.round(b.sampleRate * 0.004), a, b.length - z);
  const pre = chans(b, 0, a - cf), post = chans(b, z + cf), mid = chans(b, a - cf, a).map((d, c) => {
    const nx = b.getChannelData(c);
    for (let i = 0; i < cf; i++) { const f = i / cf; d[i] = d[i] * (1 - f) + nx[z + i] * f; }
    return d;
  });
  return concatParts(b.sampleRate, b.numberOfChannels, [pre, mid, post]);
}
function opSilence(b, a, z) {
  const cf = Math.round(b.sampleRate * 0.004);
  return mapCh(b, (x) => {
    const y = x.slice();
    for (let i = a; i < z; i++) {
      const g = Math.max(0, 1 - Math.min(i - a, z - 1 - i) / cf);
      y[i] = (i - a < cf || z - 1 - i < cf) ? x[i] * g : 0;
    }
    return y;
  });
}
function opInsert(b, at, src) {
  const cf = Math.round(b.sampleRate * 0.003);
  const ins = chans(src).map((d) => { const n = d.length; for (let i = 0; i < Math.min(cf, n); i++) { d[i] *= i / cf; d[n - 1 - i] *= i / cf; } return d; });
  while (ins.length < b.numberOfChannels) ins.push(ins[0]);
  return concatParts(b.sampleRate, b.numberOfChannels, [chans(b, 0, at), ins.slice(0, b.numberOfChannels), chans(b, at)]);
}
const TIME_FX = new Set(['speed', 'tape']);
async function opFx(b, a, z, chain) {
  const part = sliceBuf(b, a, z);
  let pr = part;
  for (const fx of chain) if (fx.on !== false && PROC[fx.type]) pr = await PROC[fx.type](pr, fx.params);
  const keepLen = !chain.some((f) => TIME_FX.has(f.type));
  const len = keepLen ? part.length : pr.length, cf = Math.min(Math.round(b.sampleRate * 0.005), len >> 2);
  const mid = Array.from({ length: b.numberOfChannels }, (_, c) => {
    const p = pr.getChannelData(Math.min(c, pr.numberOfChannels - 1)), o = part.getChannelData(c), y = new Float32Array(len);
    for (let i = 0; i < len; i++) y[i] = p[i] || 0;
    for (let i = 0; i < cf; i++) { const f = i / cf; y[i] = o[i] * (1 - f) + y[i] * f; const j = len - 1 - i, oj = o[Math.min(o.length - 1, o.length - 1 - i)]; y[j] = oj * (1 - f) + y[j] * f; }
    return y;
  });
  return concatParts(b.sampleRate, b.numberOfChannels, [chans(b, 0, a), mid, chans(b, z)]);
}
// Reparo espectral: reduz o que está dentro do retângulo tempo × frequência ao nível do entorno.
function specRepairCh(x, rate, a, z, f0, f1) {
  const N = 2048, H = 512, B = N / 2 + 1;
  const s0 = Math.max(0, a - 2 * N), s1 = Math.min(x.length, z + 2 * N), seg = x.subarray(s0, s1);
  const w = new Float32Array(N); for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const padded = new Float32Array(seg.length + 2 * N); padded.set(seg, N);
  const F = Math.floor((padded.length - N) / H) + 1, re = new Float64Array(N), im = new Float64Array(N);
  const mags = [], phs = [];
  for (let f = 0; f < F; f++) {
    for (let i = 0; i < N; i++) { re[i] = padded[f * H + i] * w[i]; im[i] = 0; }
    fft(re, im, false);
    const m = new Float32Array(B), p = new Float32Array(B);
    for (let k = 0; k < B; k++) { m[k] = Math.hypot(re[k], im[k]); p[k] = Math.atan2(im[k], re[k]); }
    mags.push(m); phs.push(p);
  }
  const k0 = Math.max(0, Math.floor(f0 / rate * N)), k1 = Math.min(B - 1, Math.ceil(f1 / rate * N));
  const center = (f) => s0 + f * H + N / 2 - N;
  const inside = [], before = [], after = [];
  for (let f = 0; f < F; f++) { const c = center(f); if (c >= a && c <= z) inside.push(f); else if (c < a && c > a - N * 1.5) before.push(f); else if (c > z && c < z + N * 1.5) after.push(f); }
  const ref = new Float32Array(B), refs = [...before, ...after];
  for (let k = k0; k <= k1; k++) { let s = 0; for (const f of refs) s += mags[f][k]; ref[k] = refs.length ? s / refs.length : 0; }
  for (const f of inside) for (let k = k0; k <= k1; k++) if (mags[f][k] > ref[k]) mags[f][k] = ref[k];
  const y = new Float32Array(padded.length);
  for (let f = 0; f < F; f++) {
    for (let k = 0; k < B; k++) { re[k] = mags[f][k] * Math.cos(phs[f][k]); im[k] = mags[f][k] * Math.sin(phs[f][k]); if (k > 0 && k < N / 2) { re[N - k] = re[k]; im[N - k] = -im[k]; } }
    fft(re, im, true);
    for (let i = 0; i < N; i++) y[f * H + i] += re[i] * w[i] / 1.5;
  }
  const outX = x.slice(), lo = Math.max(s0 + N, a - N), hi = Math.min(s1 - N, z + N);
  for (let i = lo; i < hi; i++) outX[i] = y[i - s0 + N];
  return outX;
}

const opsCache = new WeakMap();
export async function applyOps(orig, ops) {
  if (!ops || !ops.length) return orig;
  const key = JSON.stringify(ops), hit = opsCache.get(orig);
  if (hit && hit.has(key)) return hit.get(key);
  const states = [orig];
  let b = orig;
  for (const op of ops) {
    const r = b.sampleRate, A = Math.round((op.a || 0) * r), Z = Math.round((op.b || 0) * r);
    if (op.type === 'delete') b = opDelete(b, A, Z);
    else if (op.type === 'silence') b = opSilence(b, A, Z);
    else if (op.type === 'paste') { const s = states[Math.min(op.src.k, states.length - 1)]; b = opInsert(b, Math.round(op.at * r), sliceBuf(s, Math.round(op.src.a * r), Math.round(op.src.b * r))); }
    else if (op.type === 'fx') b = await opFx(b, A, Z, op.chain);
    else if (op.type === 'norm') b = normRegion(b, A, Z);
    else if (op.type === 'spec') b = mapCh(b, (x) => specRepairCh(x, r, A, Z, op.f0, op.f1));
    states.push(b);
  }
  if (!opsCache.has(orig)) opsCache.set(orig, new Map());
  const m = opsCache.get(orig); if (m.size > 30) m.clear(); m.set(key, b);
  return b;
}

// ---------- loop perfeito ----------
// Funde o fim no começo: o som passa a emendar sem clique ao repetir.
export function loopCrossfade(b, ms) {
  const X = Math.min(Math.floor((ms / 1000) * b.sampleRate), Math.floor(b.length / 2));
  if (X < 2) return b;
  const n = b.length, o = newBuf(b.numberOfChannels, n - X, b.sampleRate);
  for (let c = 0; c < b.numberOfChannels; c++) {
    const x = b.getChannelData(c), y = o.getChannelData(c);
    for (let i = 0; i < n - X; i++) y[i] = x[i];
    for (let i = 0; i < X; i++) { const f = i / X; y[i] = x[i] * Math.sin(f * Math.PI / 2) + x[n - X + i] * Math.cos(f * Math.PI / 2); }
  }
  return o;
}
// Procura, perto do fim, o ponto que mais combina com o começo.
export function bestLoopEnd(buf, start, end, rangeS = 0.05) {
  const r = buf.sampleRate, d = buf.getChannelData(0), W = Math.round(0.02 * r), S = Math.round(start * r);
  const lo = Math.max(S + W * 2, Math.round((end - rangeS) * r)), hi = Math.min(d.length - W, Math.round((end + rangeS) * r));
  let best = Math.round(end * r), bestC = -Infinity;
  let ea = 0; for (let i = 0; i < W; i++) ea += d[S + i] * d[S + i];
  for (let e = lo; e <= hi; e++) {
    let c = 0, eb = 0;
    for (let i = 0; i < W; i += 2) { c += d[S + i] * d[e + i]; eb += d[e + i] * d[e + i]; }
    const nc = c / Math.sqrt(ea * eb * 0.5 + 1e-12);
    if (nc > bestC) { bestC = nc; best = e; }
  }
  return best / r;
}
function normRegion(b, a, z) {
  let pk = 0;
  for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = a; i < z; i++) pk = Math.max(pk, Math.abs(d[i])); }
  if (pk < 1e-5) return b;
  const g = 0.89 / pk, cf = Math.round(b.sampleRate * 0.005);
  return mapCh(b, (x) => { const y = x.slice(); for (let i = a; i < z; i++) { const ramp = Math.min(1, (i - a) / cf, (z - 1 - i) / cf); y[i] = x[i] * (1 + (g - 1) * Math.max(0, ramp)); } return y; });
}

// ---------- efeitos novos ----------
function rbj(type, f, q, fs, gainDb = 0) {
  const w = 2 * Math.PI * f / fs, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q), A = Math.pow(10, gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  return { b: [b0 / a0, b1 / a0, b2 / a0], a: [a1 / a0, a2 / a0] };
}
function deess(x, p, rate) {
  const hi = biq(x, rbj('hp', p.freq, 0.7, rate)), thr = Math.pow(10, p.thr / 20), ratio = p.ratio;
  const atk = Math.exp(-1 / (0.001 * rate)), rel = Math.exp(-1 / (0.06 * rate));
  const y = new Float32Array(x.length);
  let env = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(hi[i]);
    env = a > env ? a + (env - a) * atk : a + (env - a) * rel;
    const g = env > thr ? Math.pow(thr / env, 1 - 1 / ratio) : 1;
    y[i] = x[i] - hi[i] * (1 - g);
  }
  return y;
}
const ROOMS = [
  // tamanho (s), decaimento, abafamento (0 brilhante..1 escuro), reflexões iniciais [s, ganho], ressonância Hz
  { len: 0.45, dec: 4, damp: 0.3, early: [[0.007, 0.6], [0.013, 0.4]] },
  { len: 1.1, dec: 3.5, damp: 0.4, early: [[0.012, 0.5], [0.021, 0.35], [0.03, 0.25]] },
  { len: 2.6, dec: 3, damp: 0.5, early: [[0.02, 0.45], [0.037, 0.3], [0.05, 0.2]] },
  { len: 6, dec: 2.5, damp: 0.6, early: [[0.035, 0.4], [0.06, 0.3], [0.09, 0.2]] },
  { len: 4.5, dec: 2.2, damp: 0.8, early: [[0.08, 0.5], [0.17, 0.35], [0.29, 0.25], [0.43, 0.15]] },
  { len: 1.4, dec: 3, damp: 0.1, early: [[0.004, 0.6], [0.009, 0.5]], ring: 1700 },
];
function roomIR(c, t, rate) {
  const R = ROOMS[t], n = Math.floor(R.len * rate), ir = c.createBuffer(2, n, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const f = i / n, damp = R.damp * (0.3 + 0.7 * f);
      lp = lp + (Math.random() * 2 - 1 - lp) * (1 - damp);
      d[i] = lp * Math.pow(1 - f, R.dec);
      if (R.ring) d[i] += Math.sin(2 * Math.PI * R.ring * (1 + ch * 0.01) * i / rate) * 0.25 * Math.pow(1 - f, R.dec * 1.5);
    }
    for (const [tt, g] of R.early) { const k = Math.floor(tt * rate * (1 + ch * 0.07)); if (k < n) d[k] += g; }
  }
  return ir;
}
// Detecção de tom (YIN simplificado, com o sinal reduzido pela metade)
function detectF0(x, c, rate, N = 2048) {
  const H = N >> 1, sr = rate / 2, minLag = Math.max(2, Math.floor(sr / 1000)), maxLag = Math.min(H - 2, Math.floor(sr / 70)), s = c - N / 2;
  const seg = new Float32Array(H);
  for (let i = 0; i < H; i++) { const j = s + i * 2; seg[i] = j >= 0 && j < x.length ? x[j] : 0; }
  let en = 0; for (const v of seg) en += v * v;
  if (en / H < 1e-6) return 0;
  const W = H - maxLag, dfn = new Float32Array(maxLag + 2);
  let sum = 0;
  dfn[0] = 1;
  for (let lag = 1; lag <= maxLag + 1; lag++) {
    let dsum = 0;
    for (let i = 0; i < W; i++) { const df = seg[i] - seg[i + lag]; dsum += df * df; }
    sum += dsum;
    dfn[lag] = sum > 0 ? (dsum * lag) / sum : 1;
  }
  let lag = -1;
  for (let l = minLag; l <= maxLag; l++) if (dfn[l] < 0.15) { while (l < maxLag && dfn[l + 1] < dfn[l]) l++; lag = l; break; }
  if (lag < 0) return 0;
  const a = dfn[lag - 1], b = dfn[lag], cc = dfn[lag + 1], den = a - 2 * b + cc;
  return sr / (lag + (den ? (a - cc) / (2 * den) : 0));
}
// PSOLA: recorta grãos de dois períodos em cada ciclo da voz e os reposiciona no novo espaçamento
function psola(x, f0s, ratios, H, rate) {
  const n = x.length, y = new Float32Array(n), ws = new Float32Array(n), F = f0s.length;
  const at = (arr, t) => arr[Math.max(0, Math.min(F - 1, Math.floor(t / H)))];
  const per = (t) => { const f = at(f0s, t); return f > 0 ? rate / f : rate * 0.008; };
  const marks = [];
  for (let t = 0; t < n; t += per(t)) marks.push(Math.round(t));
  let mi = 0;
  for (let to = 0; to < n;) {
    while (mi < marks.length - 1 && Math.abs(marks[mi + 1] - to) <= Math.abs(marks[mi] - to)) mi++;
    const m = marks[mi], T0 = per(m), r = at(f0s, m) > 0 ? at(ratios, m) : 1, L = Math.max(8, Math.round(T0)), o = Math.round(to);
    for (let i = -L; i <= L; i++) {
      const si = m + i, oi = o + i;
      if (si < 0 || si >= n || oi < 0 || oi >= n) continue;
      const w = 0.5 + 0.5 * Math.cos((Math.PI * i) / L);
      y[oi] += x[si] * w; ws[oi] += w;
    }
    to += T0 / r;
  }
  for (let i = 0; i < n; i++) if (ws[i] > 1e-3) y[i] /= ws[i];
  return y;
}
const SCALES = [null, [0, 2, 4, 5, 7, 9, 11], [0, 2, 3, 5, 7, 8, 10], [0, 2, 4, 7, 9]];
function autotune(b, p) {
  const rate = b.sampleRate, x = b.getChannelData(0), H = 256, F = Math.ceil(x.length / H) + 1;
  const scale = SCALES[Math.round(p.scale)], key = Math.round(p.key);
  const ratios = new Float32Array(F), f0s = new Float32Array(F);
  const alpha = p.speed <= 0 ? 1 : 1 - Math.exp(-(H / rate) / (p.speed / 1000));
  let cur = 0;
  for (let f = 0; f < F; f++) {
    const f0 = f % 2 === 0 ? detectF0(x, f * H, rate) : f0s[f - 1];
    f0s[f] = f0;
    let tgt = 0;
    if (f0) {
      const m = 69 + 12 * Math.log2(f0 / 440);
      let best = Math.round(m);
      if (scale) { let bd = 99; for (let k = Math.floor(m) - 2; k <= Math.ceil(m) + 2; k++) { const pc = (((k - key) % 12) + 12) % 12; if (scale.includes(pc) && Math.abs(k - m) < bd) { bd = Math.abs(k - m); best = k; } } }
      tgt = (best - m) * (p.amount / 100);
    }
    cur += (tgt - cur) * alpha;
    ratios[f] = Math.pow(2, cur / 12);
  }
  return mapCh(b, (ch) => psola(ch, f0s, ratios, H, rate));
}
// Tom e timbre (formantes) separados: o timbre original é reaplicado depois de mudar o tom
function smoothEnv(m, W) {
  const n = m.length, lg = new Float32Array(n), o = new Float32Array(n);
  for (let k = 0; k < n; k++) lg[k] = Math.log(m[k] + 1e-9);
  let acc = 0, cnt = 0;
  for (let k = 0; k < Math.min(n, W); k++) { acc += lg[k]; cnt++; }
  for (let k = 0; k < n; k++) {
    if (k + W < n) { acc += lg[k + W]; cnt++; }
    if (k - W - 1 >= 0) { acc -= lg[k - W - 1]; cnt--; }
    o[k] = Math.exp(acc / cnt);
  }
  return o;
}
function formantFix(src, shifted, fRatio) {
  const N = 2048, Hh = 512, B = N / 2 + 1, n = src.length;
  const w = new Float32Array(N); for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const y = new Float32Array(n + N), re = new Float64Array(N), im = new Float64Array(N), re2 = new Float64Array(N), im2 = new Float64Array(N);
  const ma = new Float32Array(B), mb = new Float32Array(B);
  for (let s0 = -N / 2; s0 < n; s0 += Hh) {
    for (let i = 0; i < N; i++) { const j = s0 + i, ok = j >= 0 && j < n; re[i] = ok ? src[j] * w[i] : 0; im[i] = 0; re2[i] = ok ? shifted[j] * w[i] : 0; im2[i] = 0; }
    fft(re, im, false); fft(re2, im2, false);
    for (let k = 0; k < B; k++) { ma[k] = Math.hypot(re[k], im[k]); mb[k] = Math.hypot(re2[k], im2[k]); }
    const ea = smoothEnv(ma, 10), eb = smoothEnv(mb, 10);
    for (let k = 0; k < B; k++) {
      const kk = k / fRatio, k0 = Math.floor(kk), fr = kk - k0;
      const tgt = k0 + 1 < B ? ea[k0] * (1 - fr) + ea[k0 + 1] * fr : ea[B - 1] * 0.1;
      const g = Math.max(0.05, Math.min(12, tgt / (eb[k] + 1e-9)));
      re2[k] *= g; im2[k] *= g;
      if (k > 0 && k < N / 2) { re2[N - k] = re2[k]; im2[N - k] = -im2[k]; }
    }
    fft(re2, im2, true);
    for (let i = 0; i < N; i++) { const j = s0 + i; if (j >= 0 && j < n + N) y[j] += re2[i] * w[i] / 1.5; }
  }
  return y.subarray(0, n);
}

Object.assign(FX, {
  deess: {
    label: 'De-esser',
    info: 'Reduz o chiado forte das letras S, X e CH na voz, sem abafar o resto.',
    tip: 'Ouça com o A/B: o S deve ficar mais suave, mas ainda claro.',
    params: {
      freq: { label: 'Frequência', min: 3000, max: 10000, def: 5500, step: 1, unit: 'Hz', log: 1, hint: 'Onde fica o chiado. Vozes graves: 4–6 kHz; agudas: 6–9 kHz.' },
      thr: { label: 'Limiar', min: -50, max: 0, def: -28, step: 1, unit: 'dB', hint: 'Mais baixo reduz mais os S.' },
      ratio: { label: 'Intensidade', min: 1, max: 10, def: 4, step: 0.5, unit: ':1', hint: 'Quanto o chiado é reduzido quando passa do limiar.' },
    },
  },
  flanger: {
    label: 'Flanger',
    info: 'Som de "avião a jato" ou de nave: uma cópia com atraso curtíssimo que varia, criando um varrido metálico.',
    params: {
      rate: { label: 'Velocidade', min: 0.05, max: 5, def: 0.3, step: 0.05, unit: 'Hz', hint: 'Quão rápido o varrido acontece.' },
      depth: PCT('Profundidade', 70, 'Tamanho do varrido.'),
      fb: PCT('Realimentação', 50, 'Deixa o efeito mais metálico e ressonante.'),
      mix: MIX(50),
    },
  },
  phaser: {
    label: 'Phaser',
    info: 'Varrido suave e rodopiante, como um som passando por um tubo. Clássico em sons de ficção científica e teletransporte.',
    params: {
      rate: { label: 'Velocidade', min: 0.05, max: 8, def: 0.5, step: 0.05, unit: 'Hz', hint: 'Quão rápido o efeito gira.' },
      depth: PCT('Profundidade', 70, 'Faixa de frequências que o efeito percorre.'),
      fb: PCT('Ressonância', 40, 'Deixa o efeito mais marcado.'),
      mix: MIX(50),
    },
  },
  wah: {
    label: 'Wah automático',
    info: 'Um filtro que abre e fecha sozinho, fazendo o som "falar" (uá-uá). Bom para criaturas, máquinas e sons cômicos.',
    params: {
      rate: { label: 'Velocidade', min: 0.1, max: 10, def: 2, step: 0.1, unit: 'Hz', hint: 'Quantos "uás" por segundo.' },
      low: HZ('Frequência baixa', 200, 2000, 400, 'Onde o filtro fecha.'),
      high: HZ('Frequência alta', 800, 6000, 2500, 'Onde o filtro abre.'),
      q: { label: 'Ressonância', min: 1, max: 20, def: 6, step: 0.5, unit: '', hint: 'Valores altos deixam o "uá" mais pronunciado.' },
      mix: MIX(100),
    },
  },
  room: {
    label: 'Reverb de ambiente',
    info: 'Coloca o som num lugar específico: quarto, sala, salão, catedral, caverna ou dentro de algo metálico.',
    tip: 'Para jogos, combine o ambiente com a fase: caverna para masmorras, salão para castelos, metal para naves e dutos.',
    params: {
      type: { label: 'Ambiente', min: 0, max: 5, def: 1, step: 1, unit: '', labels: ['Quarto', 'Sala', 'Salão', 'Catedral', 'Caverna', 'Metal'], hint: 'O tipo de lugar simulado.' },
      pre: { label: 'Pré-atraso', min: 0, max: 200, def: 10, step: 1, unit: 'ms', hint: 'Espera antes do reverb começar. Aumenta a sensação de tamanho sem embolar.' },
      mix: MIX(35),
    },
  },
  pingpong: {
    label: 'Eco ping-pong',
    info: 'Eco que alterna entre o lado esquerdo e o direito. Deixa o som largo e espacial (precisa exportar em estéreo).',
    tip: 'Desmarque "Mono" na exportação para manter o efeito.',
    params: {
      time: { label: 'Tempo', min: 30, max: 1000, def: 220, step: 5, unit: 'ms', hint: 'Intervalo entre os ecos.' },
      fb: { label: 'Repetições', min: 0, max: 90, def: 45, step: 1, unit: '%', hint: 'Quanto cada eco volta.' },
      mix: MIX(40),
    },
  },
  vocoder: {
    label: 'Vocoder',
    info: 'A voz "toca" um sintetizador: a fala controla um som eletrônico. É a voz clássica de robô e de vilão de ficção científica.',
    tip: 'Fale devagar e articulado. Mais bandas deixam a fala mais compreensível.',
    params: {
      freq: HZ('Tom do robô', 40, 400, 110, 'Nota do sintetizador que a voz controla.'),
      bands: { label: 'Bandas', min: 8, max: 32, def: 20, step: 1, unit: '', hint: 'Mais bandas: fala mais clara. Menos: mais robótico.' },
      carrier: { label: 'Timbre', min: 0, max: 2, def: 0, step: 1, unit: '', labels: ['Serra', 'Quadrada', 'Acorde'], hint: 'O som do sintetizador.' },
      mix: MIX(100),
    },
  },
  autotune: {
    label: 'Afinação (auto-tune)',
    info: 'Puxa a voz para a nota afinada mais próxima. Com velocidade zero, fica o efeito robótico famoso; com velocidade maior, só corrige de leve.',
    tip: 'Funciona melhor em voz sem fundo e sem reverb. Coloque antes dos outros efeitos.',
    params: {
      amount: PCT('Força', 100, 'Quanto a voz é puxada para a nota certa.'),
      speed: { label: 'Velocidade', min: 0, max: 300, def: 20, step: 5, unit: 'ms', hint: '0 é instantâneo (robótico). Valores maiores soam naturais.' },
      scale: { label: 'Escala', min: 0, max: 3, def: 0, step: 1, unit: '', labels: ['Cromática', 'Maior', 'Menor', 'Pentatônica'], hint: 'Quais notas são permitidas.' },
      key: { label: 'Tonalidade', min: 0, max: 11, def: 0, step: 1, unit: '', labels: ['Dó', 'Dó#', 'Ré', 'Ré#', 'Mi', 'Fá', 'Fá#', 'Sol', 'Sol#', 'Lá', 'Lá#', 'Si'], hint: 'A nota base da escala (não vale para Cromática).' },
    },
  },
  formant: {
    label: 'Voz: tom e timbre',
    info: 'Muda o tom da voz mantendo o timbre natural, ou muda o timbre sem mudar o tom. Com os dois, dá para criar vozes de gigante, criança, criatura ou trocar o "gênero" da voz.',
    tip: 'Tom -5 com timbre 0 deixa a voz mais grave sem ficar com som de monstro artificial. Timbre negativo deixa a voz maior e mais escura.',
    params: {
      semi: { label: 'Tom', min: -12, max: 12, def: -4, step: 0.5, unit: 'st', hint: 'Mais grave ou mais agudo, em semitons.' },
      fmt: { label: 'Timbre', min: -12, max: 12, def: 0, step: 0.5, unit: 'st', hint: '0 mantém o timbre original. Negativo: corpo maior, voz mais escura. Positivo: voz menor e mais fina.' },
    },
  },
});

Object.assign(PROC, {
  deess: (b, p) => mapCh(b, (x) => deess(x, p, b.sampleRate)),
  flanger: (b, p) => graph(b, 0.05, (c, src) => {
    const d = c.createDelay(0.05); d.delayTime.value = 0.004;
    const o = c.createOscillator(); o.frequency.value = p.rate;
    const og = c.createGain(); og.gain.value = 0.0035 * p.depth / 100;
    o.connect(og).connect(d.delayTime); o.start();
    const fb = c.createGain(); fb.gain.value = 0.9 * p.fb / 100;
    d.connect(fb).connect(d);
    return wetDry(c, src, d, d, p.mix / 100);
  }),
  phaser: (b, p) => graph(b, 0, (c, src) => {
    const o = c.createOscillator(); o.frequency.value = p.rate; o.start();
    const og = c.createGain(); og.gain.value = 1200 * p.depth / 100;
    o.connect(og);
    const inp = c.createGain(), fb = c.createGain(); fb.gain.value = 0.85 * p.fb / 100;
    let last = inp;
    for (let i = 0; i < 6; i++) { const a = c.createBiquadFilter(); a.type = 'allpass'; a.frequency.value = 400 + i * 350; a.Q.value = 0.6; og.connect(a.frequency); last = last.connect(a); }
    last.connect(fb).connect(inp);
    return wetDry(c, src, inp, last, p.mix / 100);
  }),
  wah: (b, p) => graph(b, 0, (c, src) => {
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = p.q;
    const lo = Math.min(p.low, p.high), hi = Math.max(p.low, p.high);
    f.frequency.value = (lo + hi) / 2;
    const o = c.createOscillator(); o.frequency.value = p.rate; o.start();
    const og = c.createGain(); og.gain.value = (hi - lo) / 2;
    o.connect(og).connect(f.frequency);
    const mk = c.createGain(); mk.gain.value = 2.5;
    f.connect(mk);
    return wetDry(c, src, f, mk, p.mix / 100);
  }),
  room: (b, p) => graph(b, ROOMS[Math.round(p.type)].len + p.pre / 1000, (c, src) => {
    const cv = c.createConvolver(); cv.buffer = roomIR(c, Math.round(p.type), b.sampleRate);
    const pd = c.createDelay(1); pd.delayTime.value = p.pre / 1000;
    pd.connect(cv);
    return wetDry(c, src, pd, cv, p.mix / 100);
  }),
  pingpong: (b, p) => {
    const t = p.time / 1000, f = p.fb / 100, tail = Math.min(12, f > 0.01 ? (2 * t * Math.log(0.001)) / Math.log(f) : t * 2) + 0.1;
    return graph(b, tail, (c, src) => {
      const mono = c.createGain(); mono.channelCount = 1; mono.channelCountMode = 'explicit'; mono.channelInterpretation = 'speakers';
      src.connect(mono);
      const dL = c.createDelay(2), dR = c.createDelay(2); dL.delayTime.value = t; dR.delayTime.value = t;
      const gL = c.createGain(), gR = c.createGain(); gL.gain.value = f; gR.gain.value = f;
      mono.connect(dL); dL.connect(gL).connect(dR); dR.connect(gR).connect(dL);
      const m = c.createChannelMerger(2), wet = c.createGain(); wet.gain.value = p.mix / 100;
      dL.connect(m, 0, 0); dR.connect(m, 0, 1); m.connect(wet);
      const dry = c.createGain(); dry.gain.value = 1 - (p.mix / 100) * 0.5;
      const out = c.createGain(); src.connect(dry).connect(out); wet.connect(out);
      return out;
    }, 2);
  },
  vocoder: async (b, p) => {
    const res = await graph(b, 0, (c, src) => {
      const n = Math.round(p.bands), out = c.createGain(), carrier = c.createGain();
      const freqs = Math.round(p.carrier) === 2 ? [p.freq, p.freq * 1.26, p.freq * 1.5] : [p.freq];
      for (const fq of freqs) { const o = c.createOscillator(); o.type = Math.round(p.carrier) === 1 ? 'square' : 'sawtooth'; o.frequency.value = fq; o.start(); o.connect(carrier); }
      const nz = c.createBufferSource(), nb = c.createBuffer(1, b.length, b.sampleRate), nd = nb.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * 0.15;
      nz.buffer = nb; nz.start(); nz.connect(carrier);
      const abs = new Float32Array(1024); for (let i = 0; i < 1024; i++) abs[i] = Math.abs(i / 511.5 - 1);
      for (let i = 0; i < n; i++) {
        const f = 120 * Math.pow(8000 / 120, (i + 0.5) / n), q = n / 3;
        const ma = c.createBiquadFilter(); ma.type = 'bandpass'; ma.frequency.value = f; ma.Q.value = q;
        const rect = c.createWaveShaper(); rect.curve = abs;
        const sm = c.createBiquadFilter(); sm.type = 'lowpass'; sm.frequency.value = 40;
        const eg = c.createGain(); eg.gain.value = 6;
        src.connect(ma).connect(rect).connect(sm).connect(eg);
        const cb = c.createBiquadFilter(); cb.type = 'bandpass'; cb.frequency.value = f; cb.Q.value = q;
        const vca = c.createGain(); vca.gain.value = 0;
        eg.connect(vca.gain);
        carrier.connect(cb).connect(vca).connect(out);
      }
      return wetDry(c, src, out, out, p.mix / 100);
    });
    const pa = peakOf(b), pr = peakOf(res);
    return pr > 1e-6 ? normalize(res, Math.min(0.95, pa * 1.1 + 0.05)) : res;
  },
  autotune: (b, p) => autotune(b, p),
  formant: async (b, p) => {
    const r = Math.pow(2, p.semi / 12), fr = Math.pow(2, (p.fmt - (0)) / 12);
    return mapCh(b, (x) => { const sh = Math.abs(p.semi) < 0.01 ? x : resample(stretch(x, r), r); const y = new Float32Array(x.length); y.set(sh.subarray(0, x.length)); return formantFix(x, y, fr); });
  },
});

export { roomIR, ROOMS, curve as distCurve };
