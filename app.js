import * as D from './dsp.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmt = (s) => (s < 10 ? s.toFixed(2) : s.toFixed(1)) + ' s';
const app = $('#app');

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
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode), req = fn(t.objectStore(store));
    t.oncomplete = () => res(req && req.result);
    t.onerror = () => rej(t.error);
  });
}
const all = (s) => tx(s, 'readonly', (st) => st.getAll());
const put = (s, o) => tx(s, 'readwrite', (st) => st.put(o));
const del = (s, id) => tx(s, 'readwrite', (st) => st.delete(id));
navigator.storage?.persist?.();

// ---------- áudio ----------
const decoded = new Map(), pcache = new Map();
async function decode(clip) {
  if (decoded.has(clip.id)) return decoded.get(clip.id);
  const b = await D.ctx().decodeAudioData(await clip.blob.arrayBuffer());
  decoded.set(clip.id, b);
  return b;
}
async function processed(clip) {
  const key = JSON.stringify([clip.edits, clip.chain]);
  const c = pcache.get(clip.id);
  if (c && c.key === key) return c.buf;
  const b = await D.renderClip(await decode(clip), clip.edits, clip.chain);
  pcache.set(clip.id, { key, buf: b });
  return b;
}
let playing = null;
function play(buf, onEnd, from = 0) {
  stop();
  const c = D.ctx(), s = c.createBufferSource();
  s.buffer = buf;
  s.connect(c.destination);
  s.start(0, from);
  playing = { s, t0: c.currentTime - from, buf };
  s.onended = () => { if (playing && playing.s === s) { playing = null; onEnd && onEnd(); } };
}
function stop() { if (playing) { try { playing.s.stop(); } catch {} playing = null; } }
const playPos = () => (playing ? D.ctx().currentTime - playing.t0 : null);

// ---------- desenho da onda ----------
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function drawWave(cv, buf, o = {}) {
  const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr;
  const x = cv.getContext('2d');
  x.scale(dpr, dpr);
  x.clearRect(0, 0, w, h);
  if (!buf) return;
  const d = buf.getChannelData(0), step = d.length / w, mid = h / 2;
  const sx = o.start != null ? (o.start / buf.duration) * w : 0;
  const ex = o.end != null ? (o.end / buf.duration) * w : w;
  for (let px = 0; px < w; px++) {
    let mn = 1, mx = -1;
    const a = Math.floor(px * step), b = Math.min(d.length, Math.floor((px + 1) * step) + 1);
    for (let i = a; i < b; i++) { const v = d[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    x.fillStyle = px >= sx && px <= ex ? (o.color || css('--wave')) : css('--wave-dim');
    x.fillRect(px, mid + mn * mid * 0.95, 1, Math.max(1, (mx - mn) * mid * 0.95));
  }
  if (o.start != null) {
    x.fillStyle = css('--handle');
    for (const hx of [sx, ex]) {
      x.fillRect(hx - 1, 0, 2, h);
      x.beginPath(); x.arc(hx, h - 10, 9, 0, Math.PI * 2); x.fill();
    }
  }
  if (o.pos != null) { x.fillStyle = css('--fg'); x.fillRect((o.pos / buf.duration) * w, 0, 2, h); }
}

// ---------- exportação ----------
const safe = (s) => (s || 'som').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'som';
let expOpts = { rate: 44100, mono: true };
try { expOpts = { ...expOpts, ...JSON.parse(localStorage.getItem('exp') || '{}') }; } catch {}

function exportPanel(id) {
  return `<div class="exp" id="${id}">
    <div class="row">
      <label class="field">Taxa
        <select class="rate">${[44100, 48000, 22050].map((r) => `<option value="${r}" ${r == expOpts.rate ? 'selected' : ''}>${(r / 1000).toFixed(r % 1000 ? 2 : 1)} kHz</option>`).join('')}</select>
      </label>
      <label class="check"><input type="checkbox" class="mono" ${expOpts.mono ? 'checked' : ''}> Mono</label>
    </div>
    <div class="btns">
      <button class="primary" data-act="share">Enviar WAV <small>Drive e outros</small></button>
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
  const msg = $('.msg', el);
  $('.rate', el).onchange = (e) => { expOpts.rate = +e.target.value; saveExp(); };
  $('.mono', el).onchange = (e) => { expOpts.mono = e.target.checked; saveExp(); };
  $$('[data-act]', el).forEach((btn) => btn.onclick = async () => {
    const act = btn.dataset.act;
    stop();
    try {
      msg.textContent = 'Preparando…';
      const items = await getItems();
      if (!items.length) { msg.textContent = 'Nada para exportar.'; return; }
      const files = [];
      for (const it of items) {
        const b = await D.prepare(it.buf, expOpts);
        const mp3 = act === 'wa';
        const blob = mp3 ? await D.encodeMp3(b) : D.encodeWav(b);
        files.push(new File([blob], safe(it.name) + (mp3 ? '.mp3' : '.wav'), { type: blob.type }));
      }
      if (act === 'save') { files.forEach(download); msg.textContent = `${files.length > 1 ? files.length + ' arquivos salvos' : 'Salvo'} em Downloads.`; return; }
      await share(files, msg, act === 'wa');
    } catch (e) { msg.textContent = 'Erro: ' + e.message; }
  });
}
function saveExp() { try { localStorage.setItem('exp', JSON.stringify(expOpts)); } catch {} }
async function share(files, msg, wa) {
  if (!(navigator.canShare && navigator.canShare({ files }))) {
    files.forEach(download);
    msg.textContent = 'Este navegador não abriu o menu de compartilhar, então salvei em Downloads.';
    return;
  }
  try {
    await navigator.share({ files });
    msg.textContent = wa ? 'Pronto. Escolha o WhatsApp e o contato no menu.' : 'Enviado.';
  } catch (e) {
    if (e.name === 'AbortError') { msg.textContent = 'Envio cancelado.'; return; }
    if (e.name === 'NotAllowedError') {
      msg.innerHTML = '';
      const b = document.createElement('button');
      b.className = 'primary'; b.textContent = 'Arquivo pronto. Toque para enviar';
      b.onclick = () => share(files, msg, wa);
      msg.appendChild(b);
      return;
    }
    msg.textContent = 'Não consegui compartilhar: ' + e.message;
  }
}

// ---------- navegação ----------
let tab = 'lib';
function nav(t) { stop(); tab = t; $$('.tabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.t === t)); render(); }
$$('.tabs button').forEach((b) => b.onclick = () => nav(b.dataset.t));
function render() { app.scrollTop = 0; window.scrollTo(0, 0); (tab === 'mix' ? mixList : library)(); }

// ---------- biblioteca ----------
let selected = new Set();
async function library() {
  const clips = (await all('clips')).sort((a, b) => b.created - a.created);
  app.innerHTML = `
    <header class="top"><h1>SFX Studio</h1><span class="count">${clips.length} ${clips.length === 1 ? 'som' : 'sons'}</span></header>
    <div class="hero">
      <button class="recbig" id="btnRec"><span class="dot"></span>Gravar</button>
      <label class="btn ghost">Importar arquivo<input type="file" accept="audio/*" id="imp" hidden></label>
    </div>
    ${clips.length ? '' : `<div class="empty"><b>Nenhum som ainda</b><p>Toque em Gravar para capturar seu primeiro efeito sonoro. As gravações ficam salvas neste celular.</p></div>`}
    <ul class="list">${clips.map((c) => `
      <li data-id="${c.id}">
        <label class="sel"><input type="checkbox" ${selected.has(c.id) ? 'checked' : ''} aria-label="Selecionar ${esc(c.name)}"></label>
        <button class="open"><span class="nm">${esc(c.name)}</span><small>${c.dur ? fmt(c.dur) : ''}${c.chain?.filter((f) => f.on).length ? ' · ' + c.chain.filter((f) => f.on).length + ' efeito(s)' : ''}</small></button>
        <button class="icon play" aria-label="Ouvir">▶</button>
      </li>`).join('')}</ul>
    <section class="batch" ${selected.size ? '' : 'hidden'}>
      <h2>Exportar ${selected.size} selecionado(s)</h2>
      <label class="field">Nome base <input id="base" placeholder="ex.: passo" autocomplete="off"></label>
      <p class="hint">Com nome base, os arquivos saem como passo_01, passo_02… Sem ele, cada um usa o próprio nome.</p>
      ${exportPanel('bexp')}
      <button class="ghost" id="clearSel">Limpar seleção</button>
    </section>`;
  $('#btnRec').onclick = openRecorder;
  $('#imp').onchange = async (e) => {
    for (const f of e.target.files) {
      const clip = newClip(f.name.replace(/\.[^.]+$/, ''), f);
      try { clip.dur = (await decode(clip)).duration; } catch { continue; }
      await put('clips', clip);
    }
    library();
  };
  $$('.list li').forEach((li) => {
    const c = clips.find((x) => x.id === li.dataset.id);
    $('.open', li).onclick = () => editor(c);
    $('.sel input', li).onchange = (e) => { e.target.checked ? selected.add(c.id) : selected.delete(c.id); library(); };
    $('.play', li).onclick = async (e) => {
      const b = e.currentTarget;
      if (b.textContent === '■') { stop(); b.textContent = '▶'; return; }
      $$('.play').forEach((x) => x.textContent = '▶');
      b.textContent = '■';
      play(await processed(c), () => b.textContent = '▶');
    };
  });
  if (selected.size) {
    $('#clearSel').onclick = () => { selected.clear(); library(); };
    bindExport($('#bexp'), async () => {
      const base = $('#base').value.trim();
      const list = clips.filter((c) => selected.has(c.id));
      const out = [];
      for (let i = 0; i < list.length; i++) out.push({ buf: await processed(list[i]), name: base ? `${base}_${String(i + 1).padStart(2, '0')}` : list[i].name });
      return out;
    });
  }
}
function newClip(name, blob) {
  return { id: uid(), name, created: Date.now(), blob, edits: { start: 0, end: null, reverse: false, normalize: false, fadeIn: 0, fadeOut: 0 }, chain: [] };
}

// ---------- gravador ----------
async function openRecorder() {
  const ov = document.createElement('div');
  ov.className = 'ovl';
  ov.innerHTML = `<div class="recbox">
    <canvas id="rwv"></canvas>
    <div class="timer" id="rt">0.0 s</div>
    <button class="recbtn" id="rb" aria-label="Gravar"><span></span></button>
    <p class="msg" id="rm">Toque no botão para começar.</p>
    <label class="check"><input type="checkbox" id="rns" ${localStorage.getItem('ns') === '1' ? 'checked' : ''}> Filtro de ruído do celular</label>
    <p class="hint">Bom para vozes em lugar barulhento. Para efeitos sonoros, deixe desligado: o filtro pode cortar o próprio som.</p>
    <button class="ghost" id="rc">Cancelar</button></div>`;
  document.body.appendChild(ov);
  let stream, rec, ac, raf, chunks = [], t0, cancelled = false;
  const cleanup = () => { cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  $('#rc', ov).onclick = () => { cancelled = true; if (rec?.state === 'recording') rec.stop(); cleanup(); ov.remove(); };
  $('#rb', ov).onclick = async () => {
    if (rec?.state === 'recording') { rec.stop(); return; }
    try {
      const ns = $('#rns', ov).checked;
      try { localStorage.setItem('ns', ns ? '1' : '0'); } catch {}
      $('#rns', ov).disabled = true;
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: ns, autoGainControl: false } });
    } catch (e) {
      $('#rm', ov).textContent = e.name === 'NotAllowedError'
        ? 'Microfone bloqueado. Toque no ícone ao lado do endereço do site → Permissões → Microfone → Permitir, e tente de novo.'
        : 'Não consegui acessar o microfone: ' + e.message;
      return;
    }
    ac = D.ctx();
    const an = ac.createAnalyser(); an.fftSize = 2048;
    const srcNode = ac.createMediaStreamSource(stream); srcNode.connect(an);
    rec = new MediaRecorder(stream, { audioBitsPerSecond: 256000 });
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      srcNode.disconnect(); cleanup();
      if (cancelled) return;
      $('#rm', ov).textContent = 'Salvando…';
      const n = (await all('clips')).length + 1;
      const clip = newClip(`Gravação ${String(n).padStart(2, '0')}`, new Blob(chunks, { type: rec.mimeType }));
      try { clip.dur = (await decode(clip)).duration; } catch {}
      await put('clips', clip);
      ov.remove();
      editor(clip);
    };
    rec.start();
    t0 = performance.now();
    ov.classList.add('on');
    $('#rm', ov).textContent = 'Gravando. Toque de novo para parar.';
    const cv = $('#rwv', ov), d = new Uint8Array(an.fftSize);
    const loop = () => {
      an.getByteTimeDomainData(d);
      const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
      cv.width = w * dpr; cv.height = h * dpr;
      const x = cv.getContext('2d'); x.scale(dpr, dpr);
      x.strokeStyle = css('--rec'); x.lineWidth = 2; x.beginPath();
      for (let i = 0; i < d.length; i++) { const X = i / d.length * w, Y = d[i] / 255 * h; i ? x.lineTo(X, Y) : x.moveTo(X, Y); }
      x.stroke();
      $('#rt', ov).textContent = ((performance.now() - t0) / 1000).toFixed(1) + ' s';
      raf = requestAnimationFrame(loop);
    };
    loop();
  };
}

// ---------- editor ----------
const FXOPTS = Object.entries(D.FX).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
const toSlider = (p, v) => (p.log ? Math.round(1000 * Math.log(v / p.min) / Math.log(p.max / p.min)) : v);
const fromSlider = (p, s) => (p.log ? Math.round(p.min * Math.pow(p.max / p.min, s / 1000)) : +s);
const show = (p, v) => `${p.unit === 'Hz' && v >= 1000 ? (v / 1000).toFixed(1) + ' k' : +(+v).toFixed(2)}${p.unit === 'Hz' && v >= 1000 ? 'Hz' : p.unit ? ' ' + p.unit : ''}`;

async function editor(clip) {
  stop();
  const orig = await decode(clip);
  const e = clip.edits;
  if (e.end == null || e.end > orig.duration) e.end = orig.duration;
  let saveT;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { clip.dur = orig.duration; put('clips', clip); }, 300); };
  const dirty = () => { save(); $('#fxState').textContent = 'Toque em "Com efeitos" para ouvir as mudanças.'; };

  app.innerHTML = `
    <header class="top"><button class="icon" id="back" aria-label="Voltar">‹</button><input id="cname" class="title-input" value="${esc(clip.name)}" aria-label="Nome do som"></header>
    <div class="wavebox"><canvas id="wv" aria-label="Forma de onda. Arraste as alças para cortar."></canvas></div>
    <div class="times" id="times"></div>
    <div class="transport">
      <button id="pO">▶ Original</button>
      <button id="pF" class="primary">▶ Com efeitos</button>
      <button id="pS" class="icon" aria-label="Parar">■</button>
    </div>
    <div class="outbox"><canvas id="wo"></canvas><span id="fxState" class="hint">Resultado aparece aqui.</span></div>

    <section><h2>Edição</h2>
      <div class="toggles">
        <label class="check"><input type="checkbox" id="rev" ${e.reverse ? 'checked' : ''}> Reverter</label>
        <label class="check"><input type="checkbox" id="nor" ${e.normalize ? 'checked' : ''}> Normalizar volume</label>
      </div>
      <label class="prm"><span>Fade in</span><input type="range" id="fi" min="0" max="2000" step="10" value="${e.fadeIn}"><output>${e.fadeIn} ms</output></label>
      <label class="prm"><span>Fade out</span><input type="range" id="fo" min="0" max="2000" step="10" value="${e.fadeOut}"><output>${e.fadeOut} ms</output></label>
      <button class="ghost" id="resetTrim">Desfazer corte</button>
    </section>

    <section><h2>Efeitos <small>aplicados de cima para baixo</small></h2>
      <div id="chain"></div>
      <div class="row add"><select id="addSel" aria-label="Efeito">${FXOPTS}</select><button id="addFx">+ Adicionar</button></div>
    </section>

    <section><h2>Presets</h2>
      <div class="row"><select id="preSel" aria-label="Preset"></select><button id="preApply">Aplicar</button></div>
      <div class="row"><input id="preName" placeholder="Nome do novo preset" autocomplete="off"><button id="preSave">Salvar</button></div>
      <p class="hint" id="preMsg">O preset guarda a lista de efeitos e seus ajustes.</p>
      <details><summary>Gerenciar presets</summary><div id="preList"></div></details>
    </section>

    <section><h2>Exportar</h2>${exportPanel('eexp')}</section>

    <section class="danger-zone">
      <button class="ghost" id="dup">Duplicar som</button>
      <button class="ghost danger" id="delC">Apagar som</button>
    </section>`;

  $('#back').onclick = () => { stop(); render(); };
  $('#cname').oninput = (ev) => { clip.name = ev.target.value || 'Sem nome'; save(); };

  // forma de onda + corte
  const wv = $('#wv');
  let drag = null, raf;
  const redraw = () => {
    if (!wv.isConnected) return;
    drawWave(wv, orig, { start: e.start, end: e.end, pos: playing && playing.buf === orig ? playPos() : null });
    $('#times').innerHTML = `<span>Início ${fmt(e.start)}</span><span>Duração ${fmt(e.end - e.start)}</span><span>Fim ${fmt(e.end)}</span>`;
  };
  const anim = () => { redraw(); if (playing && playing.buf === orig) raf = requestAnimationFrame(anim); };
  redraw();
  new ResizeObserver(redraw).observe(wv);
  const tAt = (ev) => Math.max(0, Math.min(orig.duration, (ev.clientX - wv.getBoundingClientRect().left) / wv.clientWidth * orig.duration));
  wv.onpointerdown = (ev) => {
    const t = tAt(ev);
    drag = Math.abs(t - e.start) <= Math.abs(t - e.end) ? 'start' : 'end';
    wv.setPointerCapture(ev.pointerId);
    wv.onpointermove(ev);
  };
  wv.onpointermove = (ev) => {
    if (!drag) return;
    const t = tAt(ev), min = 0.01;
    if (drag === 'start') e.start = Math.min(t, e.end - min); else e.end = Math.max(t, e.start + min);
    redraw();
  };
  wv.onpointerup = wv.onpointercancel = () => { if (drag) { drag = null; dirty(); } };
  $('#resetTrim').onclick = () => { e.start = 0; e.end = orig.duration; redraw(); dirty(); };

  // reprodução
  $('#pO').onclick = () => { play(orig, () => { cancelAnimationFrame(raf); redraw(); }, e.start); cancelAnimationFrame(raf); anim(); stopAtEnd(); };
  const stopAtEnd = () => { const chk = () => { if (playing && playing.buf === orig) { if (playPos() >= e.end) { stop(); redraw(); } else requestAnimationFrame(chk); } }; chk(); };
  $('#pF').onclick = async () => {
    $('#fxState').textContent = 'Processando…';
    try {
      const b = await processed(clip);
      drawWave($('#wo'), b, { color: css('--accent') });
      $('#fxState').textContent = `Resultado: ${fmt(b.duration)}`;
      play(b);
    } catch (err) { $('#fxState').textContent = 'Erro ao processar: ' + err.message; }
  };
  $('#pS').onclick = () => { stop(); redraw(); };

  // edição
  $('#rev').onchange = (ev) => { e.reverse = ev.target.checked; dirty(); };
  $('#nor').onchange = (ev) => { e.normalize = ev.target.checked; dirty(); };
  for (const id of ['fi', 'fo']) $('#' + id).oninput = (ev) => {
    e[id === 'fi' ? 'fadeIn' : 'fadeOut'] = +ev.target.value;
    ev.target.nextElementSibling.textContent = ev.target.value + ' ms';
    dirty();
  };

  // cadeia de efeitos
  const drawChain = () => {
    const el = $('#chain');
    if (!clip.chain.length) { el.innerHTML = '<p class="hint">Nenhum efeito. Escolha um abaixo e toque em Adicionar.</p>'; return; }
    el.innerHTML = clip.chain.map((fx, i) => {
      const def = D.FX[fx.type];
      return `<div class="fx ${fx.on ? '' : 'off'}" data-i="${i}">
        <div class="fxh">
          <label class="sw"><input type="checkbox" class="on" ${fx.on ? 'checked' : ''} aria-label="Ligar ${def.label}"><span></span></label>
          <b>${def.label}</b>
          <button class="icon sm info" aria-label="Sobre ${def.label}" aria-expanded="false">i</button>
          <button class="icon sm up" aria-label="Subir" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="icon sm dn" aria-label="Descer" ${i === clip.chain.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="icon sm rm" aria-label="Remover">✕</button>
        </div>
        <div class="infobox" hidden><p>${def.info}</p><dl>${Object.values(def.params).map((p) => `<dt>${p.label}</dt><dd>${p.hint || ''}</dd>`).join('')}</dl>${def.tip ? `<p class="tip">${def.tip}</p>` : ''}</div>
        ${Object.entries(def.params).map(([k, p]) => `<label class="prm"><span>${p.label}</span><input type="range" data-k="${k}" min="${p.log ? 0 : p.min}" max="${p.log ? 1000 : p.max}" step="${p.log ? 1 : p.step}" value="${toSlider(p, fx.params[k])}"><output>${show(p, fx.params[k])}</output></label>`).join('')}
      </div>`;
    }).join('');
    $$('.fx', el).forEach((card) => {
      const i = +card.dataset.i, fx = clip.chain[i], def = D.FX[fx.type];
      $('.on', card).onchange = (ev) => { fx.on = ev.target.checked; card.classList.toggle('off', !fx.on); dirty(); };
      $('.info', card).onclick = (ev) => { const box = $('.infobox', card); box.hidden = !box.hidden; ev.currentTarget.setAttribute('aria-expanded', !box.hidden); ev.currentTarget.classList.toggle('is', !box.hidden); };
      $('.up', card).onclick = () => { [clip.chain[i - 1], clip.chain[i]] = [clip.chain[i], clip.chain[i - 1]]; drawChain(); dirty(); };
      $('.dn', card).onclick = () => { [clip.chain[i + 1], clip.chain[i]] = [clip.chain[i], clip.chain[i + 1]]; drawChain(); dirty(); };
      $('.rm', card).onclick = () => { clip.chain.splice(i, 1); drawChain(); dirty(); };
      $$('input[data-k]', card).forEach((inp) => inp.oninput = () => {
        const p = def.params[inp.dataset.k];
        fx.params[inp.dataset.k] = fromSlider(p, +inp.value);
        inp.nextElementSibling.textContent = show(p, fx.params[inp.dataset.k]);
        dirty();
      });
    });
  };
  drawChain();
  $('#addFx').onclick = () => {
    const type = $('#addSel').value;
    clip.chain.push({ type, on: true, params: D.defaultParams(type) });
    drawChain(); dirty();
    $('#chain').lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // presets
  const drawPresets = async () => {
    const ps = (await all('presets')).sort((a, b) => a.name.localeCompare(b.name));
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
      clip.chain = JSON.parse(JSON.stringify(p.chain));
      drawChain(); dirty();
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
    await put('presets', { id: ex?.id || uid(), name, chain: JSON.parse(JSON.stringify(clip.chain)) });
    $('#preName').value = '';
    $('#preMsg').textContent = ex ? `Preset "${name}" atualizado.` : `Preset "${name}" salvo.`;
    drawPresets();
  };

  bindExport($('#eexp'), async () => [{ buf: await processed(clip), name: clip.name }]);

  $('#dup').onclick = async () => {
    const c = { ...JSON.parse(JSON.stringify({ ...clip, blob: null })), id: uid(), name: clip.name + ' (cópia)', created: Date.now(), blob: clip.blob };
    await put('clips', c);
    editor(c);
  };
  $('#delC').onclick = async (ev) => {
    if (!ev.target.dataset.c) { ev.target.dataset.c = 1; ev.target.textContent = 'Toque de novo para apagar'; return; }
    stop();
    await del('clips', clip.id);
    selected.delete(clip.id);
    render();
  };
}

// ---------- mixagens ----------
async function mixList() {
  const mixes = (await all('mixes')).sort((a, b) => b.created - a.created);
  app.innerHTML = `
    <header class="top"><h1>Mixagens</h1></header>
    <p class="hint lead">Junte vários sons em camadas, cada um começando no momento certo. O resultado sai como um único arquivo.</p>
    <button class="primary wide" id="newMix">+ Nova mixagem</button>
    ${mixes.length ? '' : '<div class="empty"><b>Nenhuma mixagem ainda</b><p>Exemplo: uma explosão feita de estouro + grave + estilhaços.</p></div>'}
    <ul class="list">${mixes.map((m) => `<li data-id="${m.id}"><button class="open"><span class="nm">${esc(m.name)}</span><small>${m.tracks.length} camada(s)</small></button></li>`).join('')}</ul>`;
  $('#newMix').onclick = async () => {
    const m = { id: uid(), name: `Mixagem ${String(mixes.length + 1).padStart(2, '0')}`, created: Date.now(), tracks: [] };
    await put('mixes', m);
    mixEditor(m);
  };
  $$('.list li').forEach((li) => $('.open', li).onclick = () => mixEditor(mixes.find((m) => m.id === li.dataset.id)));
}

async function mixEditor(mix) {
  stop();
  const clips = (await all('clips')).sort((a, b) => a.name.localeCompare(b.name));
  const byId = Object.fromEntries(clips.map((c) => [c.id, c]));
  const bufs = {};
  app.innerHTML = `<div class="empty"><b>Carregando sons…</b></div>`;
  for (const t of mix.tracks) if (byId[t.clipId] && !bufs[t.clipId]) bufs[t.clipId] = await processed(byId[t.clipId]);
  let saveT;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => put('mixes', mix), 300); };
  const items = () => {
    const solo = mix.tracks.some((t) => t.solo);
    return mix.tracks.filter((t) => bufs[t.clipId] && !t.mute && (!solo || t.solo)).map((t) => ({ buf: bufs[t.clipId], offset: t.offset, vol: t.vol, pan: t.pan }));
  };

  app.innerHTML = `
    <header class="top"><button class="icon" id="back" aria-label="Voltar">‹</button><input id="mname" class="title-input" value="${esc(mix.name)}" aria-label="Nome da mixagem"></header>
    <div class="tlbox"><canvas id="tl" aria-label="Linha do tempo. Arraste os blocos para mudar o início."></canvas></div>
    <div class="transport"><button id="mp" class="primary">▶ Ouvir mixagem</button><button id="ms" class="icon" aria-label="Parar">■</button></div>
    <section><h2>Camadas</h2><div id="tracks"></div>
      ${clips.length ? `<div class="row add"><select id="addClip" aria-label="Som">${clips.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><button id="addT">+ Camada</button></div>` : '<p class="hint">Grave ou importe sons na Biblioteca primeiro.</p>'}
    </section>
    <section><h2>Exportar</h2>${exportPanel('mexp')}
      <button class="ghost" id="toClip">Salvar como som na Biblioteca</button><p class="hint" id="tcMsg"></p></section>
    <section class="danger-zone"><button class="ghost danger" id="delM">Apagar mixagem</button></section>`;

  $('#back').onclick = () => { stop(); render(); };
  $('#mname').oninput = (ev) => { mix.name = ev.target.value || 'Sem nome'; save(); };

  const tl = $('#tl');
  const COLORS = ['--accent', '--wave', '--c3', '--c4', '--c5'];
  let scale = 1, mixBuf = null, raf;
  const total = () => Math.max(2, ...mix.tracks.map((t) => (bufs[t.clipId] ? t.offset + bufs[t.clipId].duration : 0))) * 1.15;
  const drawTL = () => {
    if (!tl.isConnected) return;
    const rowH = 34, h = Math.max(1, mix.tracks.length) * rowH + 22;
    tl.style.height = h + 'px';
    const dpr = devicePixelRatio || 1, w = tl.clientWidth;
    tl.width = w * dpr; tl.height = h * dpr;
    const x = tl.getContext('2d'); x.scale(dpr, dpr);
    const T = total(); scale = w / T;
    x.fillStyle = css('--muted'); x.font = '11px system-ui';
    const stepS = T > 20 ? 5 : T > 8 ? 2 : T > 4 ? 1 : 0.5;
    for (let s = 0; s < T; s += stepS) { x.fillRect(s * scale, 0, 1, 6); x.fillText(s + 's', s * scale + 3, 12); }
    mix.tracks.forEach((t, i) => {
      const b = bufs[t.clipId]; if (!b) return;
      const y = 20 + i * rowH, bx = t.offset * scale, bw = Math.max(4, b.duration * scale);
      x.globalAlpha = t.mute ? 0.3 : 1;
      x.fillStyle = css(COLORS[i % COLORS.length]);
      x.fillRect(bx, y, bw, rowH - 6);
      x.fillStyle = css('--bg');
      x.fillText(byId[t.clipId].name, bx + 6, y + 18, bw - 10);
      x.globalAlpha = 1;
    });
    const pos = playing && playing.buf === mixBuf ? playPos() : null;
    if (pos != null) { x.fillStyle = css('--fg'); x.fillRect(pos * scale, 0, 2, h); }
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
    const card = $(`.fx[data-i="${mix.tracks.indexOf(dragT.t)}"]`);
    if (card) { $('[data-k=offset]', card).value = dragT.t.offset; $('[data-k=offset]', card).nextElementSibling.textContent = fmt(dragT.t.offset); }
  };
  tl.onpointerup = tl.onpointercancel = () => { if (dragT) { dragT = null; save(); } };

  const drawTracks = () => {
    const el = $('#tracks');
    if (!mix.tracks.length) { el.innerHTML = '<p class="hint">Nenhuma camada. Escolha um som abaixo.</p>'; drawTL(); return; }
    el.innerHTML = mix.tracks.map((t, i) => {
      const c = byId[t.clipId];
      return `<div class="fx ${t.mute ? 'off' : ''}" data-i="${i}">
        <div class="fxh"><span class="chip" style="background:var(${COLORS[i % COLORS.length]})"></span><b>${c ? esc(c.name) : 'Som apagado'}</b>
          <button class="tog ${t.mute ? 'is' : ''}" data-a="mute">M</button><button class="tog ${t.solo ? 'is' : ''}" data-a="solo">S</button>
          <button class="icon sm rm" aria-label="Remover camada">✕</button></div>
        <label class="prm"><span>Início</span><input type="range" data-k="offset" min="0" max="${Math.max(10, Math.ceil(t.offset + 2))}" step="0.01" value="${t.offset}"><output>${fmt(t.offset)}</output></label>
        <label class="prm"><span>Volume</span><input type="range" data-k="vol" min="0" max="1.5" step="0.01" value="${t.vol}"><output>${Math.round(t.vol * 100)}%</output></label>
        <label class="prm"><span>Pan</span><input type="range" data-k="pan" min="-1" max="1" step="0.05" value="${t.pan}"><output>${t.pan == 0 ? 'centro' : t.pan < 0 ? 'E ' + Math.round(-t.pan * 100) : 'D ' + Math.round(t.pan * 100)}</output></label>
      </div>`;
    }).join('');
    $$('.fx', el).forEach((card) => {
      const t = mix.tracks[+card.dataset.i];
      $$('input[data-k]', card).forEach((inp) => inp.oninput = () => {
        const k = inp.dataset.k, v = +inp.value; t[k] = v;
        inp.nextElementSibling.textContent = k === 'offset' ? fmt(v) : k === 'vol' ? Math.round(v * 100) + '%' : v == 0 ? 'centro' : v < 0 ? 'E ' + Math.round(-v * 100) : 'D ' + Math.round(v * 100);
        drawTL(); save();
      });
      $$('.tog', card).forEach((b) => b.onclick = () => { t[b.dataset.a] = !t[b.dataset.a]; drawTracks(); save(); });
      $('.rm', card).onclick = () => { mix.tracks.splice(+card.dataset.i, 1); drawTracks(); save(); };
    });
    drawTL();
  };
  drawTracks();
  if (clips.length) $('#addT').onclick = async () => {
    const id = $('#addClip').value;
    if (!bufs[id]) bufs[id] = await processed(byId[id]);
    mix.tracks.push({ id: uid(), clipId: id, offset: 0, vol: 1, pan: 0, mute: false, solo: false });
    drawTracks(); save();
  };

  const anim = () => { drawTL(); if (playing && playing.buf === mixBuf) raf = requestAnimationFrame(anim); };
  $('#mp').onclick = async () => {
    const it = items();
    if (!it.length) return;
    mixBuf = await D.renderMix(it);
    play(mixBuf, drawTL);
    cancelAnimationFrame(raf); anim();
  };
  $('#ms').onclick = () => { stop(); drawTL(); };
  bindExport($('#mexp'), async () => { const it = items(); return it.length ? [{ buf: await D.renderMix(it), name: mix.name }] : []; });
  $('#toClip').onclick = async () => {
    const it = items();
    if (!it.length) { $('#tcMsg').textContent = 'Adicione pelo menos uma camada.'; return; }
    const b = await D.renderMix(it);
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
