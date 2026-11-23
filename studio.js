// Estúdio de Música: lista de músicas, arranjo, piano roll, bateria por passos, mixer e exportação.
import * as M from './music.js';

let X; // funções compartilhadas do app
export function initStudio(ctx) { X = ctx; return { musicList, openSong, stop: () => player && player.playing && player.stop() }; }

const COLORS = ['#f2a33a', '#5fc4d9', '#b48cf2', '#7fd17a', '#f27aa8', '#f2d43a', '#7aa2f2', '#f27a5f', '#4fd1c5', '#c7a0ff'];
const WAVE_IDX = { sine: 0, triangle: 1, square: 2, sawtooth: 3 };
const normParams = (p) => ({ ...p, osc1: typeof p.osc1 === 'string' ? WAVE_IDX[p.osc1] ?? 3 : p.osc1, osc2: typeof p.osc2 === 'string' ? WAVE_IDX[p.osc2] ?? 2 : p.osc2 });
const KEYMAP = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ç: 16, ';': 16 };
let player = null;
const P = () => (player ||= new M.Player());
const songSecs = (s) => (M.songEnd(s) * 60) / s.bpm;
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---------- criação ----------
function makeTrack(kind, opt = {}, i = 0) {
  const inst = opt.inst || (kind === 'inst' ? 'piano' : null);
  return {
    id: X.uid(), kind, name: opt.name || (kind === 'drum' ? 'Bateria' : kind === 'audio' ? 'Áudio' : M.INSTRUMENTS[inst][0]),
    inst, params: inst ? normParams(M.instParams(inst)) : null, kit: opt.kit || 'k808', pads: M.PADS.map(() => ({ vol: 1, clipId: null })),
    vol: opt.vol ?? 0.8, pan: opt.pan ?? 0, mute: false, solo: false, fx: opt.fx || [], clips: [], color: COLORS[i % COLORS.length],
  };
}
const makePattern = (song, kind, len, notes = [], name) => {
  const n = Object.values(song.patterns).filter((p) => p.kind === kind).length + 1;
  const pat = { id: X.uid(), kind, len, notes, name: name || (kind === 'drums' ? `Ritmo ${n}` : `Padrão ${n}`) };
  song.patterns[pat.id] = pat;
  return pat;
};
function addClip(track, pat, start, len) { const c = { id: X.uid(), pat: pat.id, start, len: len ?? pat.len }; track.clips.push(c); return c; }
function baseSong(o = {}) {
  return { id: X.uid(), name: o.name || 'Música nova', created: Date.now(), bpm: o.bpm || 110, sig: o.sig || 4, key: o.key ?? 0, scale: o.scale || 'major', swing: 0, loop: { a: 0, b: (o.sig || 4) * 16, on: true }, tracks: [], patterns: {}, master: { vol: 0.9, fx: [] } };
}
const FXP = (type, params) => ({ type, on: true, params: { ...X.D.defaultParams(type), ...params } });
// monta faixas a partir da progressão (usado nos modelos e no assistente)
function buildArrangement(song, o) {
  const prog = M.PROGRESSIONS[o.prog][1], sig = song.sig, bpc = o.bpc || 1, patLen = prog.length * bpc * sig, at = o.at || 0, reps = o.reps || 4;
  const tracks = [];
  const put = (track, pat, from = at, times = reps) => { for (let r = 0; r < times; r++) addClip(track, pat, from + r * patLen); };
  if (o.chords) {
    const t = makeTrack('inst', { inst: o.chords[0], vol: 0.55, fx: [FXP('room', { type: 2, mix: 25 })] }, song.tracks.length + tracks.length);
    put(t, makePattern(song, 'notes', patLen, M.chordNotes(prog, song.key, song.scale, { bars: bpc, sig, style: o.chords[1] }), 'Acordes'));
    tracks.push(t);
  }
  if (o.arp) {
    const t = makeTrack('inst', { inst: o.arp, vol: 0.45, pan: 0.2, fx: [FXP('echo', { time: Math.round(60000 / song.bpm * 0.75), fb: 30, mix: 25 })] }, song.tracks.length + tracks.length);
    put(t, makePattern(song, 'notes', patLen, M.chordNotes(prog, song.key, song.scale, { bars: bpc, sig, style: 'arp', base: 72 }), 'Arpejo'), at + patLen, Math.max(1, reps - 1));
    tracks.push(t);
  }
  if (o.bass) {
    const t = makeTrack('inst', { inst: o.bass[0], vol: 0.75 }, song.tracks.length + tracks.length);
    put(t, makePattern(song, 'notes', patLen, M.bassNotes(prog, song.key, song.scale, { bars: bpc, sig, style: o.bass[1] }), 'Baixo'));
    tracks.push(t);
  }
  if (o.lead) {
    const t = makeTrack('inst', { inst: o.lead, vol: 0.6, fx: [FXP('room', { type: 1, mix: 20 })] }, song.tracks.length + tracks.length);
    const A = makePattern(song, 'notes', patLen, M.melodyNotes(prog, song.key, song.scale, { bars: bpc, sig }), 'Melodia A');
    const B = makePattern(song, 'notes', patLen, M.melodyNotes(prog, song.key, song.scale, { bars: bpc, sig, base: 74 }), 'Melodia B');
    if (reps >= 4) { addClip(t, A, at + patLen); addClip(t, B, at + 2 * patLen); addClip(t, A, at + 3 * patLen); } else for (let r = 0; r < reps; r++) addClip(t, r % 2 ? B : A, at + r * patLen);
    tracks.push(t);
  }
  if (o.choir) {
    const t = makeTrack('inst', { inst: 'choir', vol: 0.4, fx: [FXP('room', { type: 3, mix: 40 })] }, song.tracks.length + tracks.length);
    put(t, makePattern(song, 'notes', patLen, M.chordNotes(prog, song.key, song.scale, { bars: bpc, sig, style: 'block', base: 60 }), 'Coral'), at + 2 * patLen, Math.max(1, reps - 2));
    tracks.push(t);
  }
  if (o.drums) {
    const t = makeTrack('drum', { kit: o.kit || 'k808', vol: 0.75 }, song.tracks.length + tracks.length);
    const pat = makePattern(song, 'drums', sig, M.drumNotes(o.drums, 1, sig), M.DRUM_STYLE_NAMES[o.drums]);
    addClip(t, pat, at + (reps >= 4 ? patLen : 0), (reps >= 4 ? reps - 1 : reps) * patLen);
    tracks.push(t);
  }
  song.tracks.push(...tracks);
  return tracks;
}
function fromTemplate(key, over = {}) {
  const T = M.TEMPLATES[key], s = baseSong({ ...T, ...over });
  s.name = over.name || T.name;
  if (key === 'empty') {
    s.tracks.push(makeTrack('inst', { inst: 'piano' }, 0), makeTrack('drum', {}, 1));
    const p = makePattern(s, 'notes', 4 * s.sig); addClip(s.tracks[0], p, 0);
    const d = makePattern(s, 'drums', s.sig, M.drumNotes('pop', 1, s.sig)); addClip(s.tracks[1], d, 0, 4 * s.sig);
    s.loop = { a: 0, b: 4 * s.sig, on: true };
    return s;
  }
  buildArrangement(s, { prog: T.prog, chords: T.chords, bass: T.bass, lead: T.lead, drums: T.drums, kit: T.kit, arp: T.arp, choir: T.choir, reps: 4 });
  s.loop = { a: 0, b: M.songEnd(s), on: true };
  return s;
}

// ---------- lista de músicas ----------
async function musicList() {
  const songs = (await X.all('songs')).sort((a, b) => (b.updated || b.created) - (a.updated || a.created));
  X.app.innerHTML = `
    <header class="top"><h1>Música</h1><button class="ibtn" id="setBtn" aria-label="Configurações">${X.ic('gear')}</button></header>
    <p class="hint lead">Crie as músicas do jogo: faixas de instrumentos, bateria por passos, piano roll, mixer e exportação em loop perfeito para o Godot.</p>
    <div class="row wrap mtop"><button class="primary" id="newSong">${X.ic('plus')}Nova música</button><label class="btn ghost">${X.ic('download')}Importar MIDI<input type="file" id="impMidi" accept=".mid,.midi,audio/midi" hidden></label></div>
    <h3 class="gh">Comece por um modelo</h3>
    <div class="tpls">${Object.entries(M.TEMPLATES).map(([k, t]) => `<button class="tpl" data-k="${k}"><b>${t.name}</b><small>${k === 'empty' ? 'Começar do zero' : `${t.bpm} BPM · ${M.NOTE_NAMES[t.key]} ${M.SCALES[t.scale][0].toLowerCase()}`}</small></button>`).join('')}</div>
    <h3 class="gh">Suas músicas</h3>
    ${songs.length ? '' : '<div class="empty sm"><b>Nenhuma música ainda</b><p>Escolha um modelo acima: ele já vem com acordes, baixo, melodia e bateria para você ouvir e mudar.</p></div>'}
    <ul class="list simple songs">${songs.map((s) => `<li data-id="${s.id}"><button class="open"><span class="fxi">${X.ic('keyboard')}</span><span class="tx"><span class="nm">${X.esc(s.name)}</span><small>${s.bpm} BPM · ${M.NOTE_NAMES[s.key]} ${M.SCALES[s.scale][0].toLowerCase()} · ${fmtTime(songSecs(s))} · ${s.tracks.length} faixa(s)</small></span></button><button class="ibtn sdup" aria-label="Duplicar">${X.ic('dup')}</button><button class="ibtn sdel" aria-label="Apagar">${X.ic('trash')}</button></li>`).join('')}</ul>`;
  X.$('#setBtn').onclick = X.openSettings;
  X.$('#newSong').onclick = newSongSheet;
  X.$$('.tpl').forEach((b) => b.onclick = async () => { const s = fromTemplate(b.dataset.k); await X.put('songs', s); openSong(s); });
  X.$('#impMidi').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const s = midiToSong(M.parseMidi(new Uint8Array(await f.arrayBuffer())), f.name.replace(/\.[^.]+$/, '')); await X.put('songs', s); X.toast('MIDI importado'); openSong(s); }
    catch (err) { X.toast(err.message); }
  };
  X.$$('.songs li').forEach((li) => {
    const s = songs.find((x) => x.id === li.dataset.id);
    X.$('.open', li).onclick = () => openSong(s);
    X.$('.sdup', li).onclick = async () => { const c = JSON.parse(JSON.stringify(s)); c.id = X.uid(); c.name += ' (cópia)'; c.created = Date.now(); await X.put('songs', c); musicList(); };
    X.$('.sdel', li).onclick = async (ev) => { const b = ev.currentTarget; if (!b.dataset.c) { b.dataset.c = 1; b.classList.add('danger'); X.toast('Toque de novo para apagar'); return; } await X.del('songs', s.id); musicList(); };
  });
  X.setKeys(null);
}
function newSongSheet() {
  const s = X.sheet('Nova música', `
    <label class="field">Nome<input id="nsName" value="Música ${new Date().toLocaleDateString('pt-BR')}" autocomplete="off"></label>
    <label class="field">Modelo<select id="nsTpl">${Object.entries(M.TEMPLATES).map(([k, t]) => `<option value="${k}">${t.name}</option>`).join('')}</select></label>
    <div class="grid2">
      <label class="field">Andamento (BPM)<input id="nsBpm" type="number" min="40" max="240" value="110"></label>
      <label class="field">Compasso<select id="nsSig"><option value="4">4/4</option><option value="3">3/4 (valsa)</option></select></label>
      <label class="field">Tom<select id="nsKey">${M.NOTE_NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join('')}</select></label>
      <label class="field">Escala<select id="nsScale">${Object.entries(M.SCALES).map(([k, [n]]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
    </div>
    <p class="hint">Escolhendo um modelo, o andamento, o tom e a escala dele são usados, mas você pode mudar aqui.</p>
    <button class="primary wide" id="nsGo">${X.ic('plus')}Criar</button>`, { icon: 'keyboard' });
  const b = s.body, sync = () => { const t = M.TEMPLATES[X.$('#nsTpl', b).value]; X.$('#nsBpm', b).value = t.bpm; X.$('#nsKey', b).value = t.key; X.$('#nsScale', b).value = t.scale; };
  X.$('#nsTpl', b).onchange = sync;
  X.$('#nsGo', b).onclick = async () => {
    const over = { name: X.$('#nsName', b).value.trim() || 'Música nova', bpm: Math.max(40, Math.min(240, +X.$('#nsBpm', b).value || 110)), sig: +X.$('#nsSig', b).value, key: +X.$('#nsKey', b).value, scale: X.$('#nsScale', b).value };
    const song = fromTemplate(X.$('#nsTpl', b).value, over);
    await X.put('songs', song); s.close(); openSong(song);
  };
}
function midiToSong(mid, name) {
  const s = baseSong({ name, bpm: mid.bpm, sig: mid.sig === 3 ? 3 : 4 });
  let end = 0;
  for (const tr of mid.tracks) for (const n of tr.notes) end = Math.max(end, n.t + n.d);
  const len = Math.max(s.sig, Math.ceil(end / s.sig) * s.sig);
  mid.tracks.forEach((tr, i) => {
    if (!tr.notes.length) return;
    const t = makeTrack(tr.drum ? 'drum' : 'inst', { name: tr.name, inst: tr.drum ? null : 'piano' }, i);
    const notes = tr.drum ? tr.notes.map((n) => ({ ...n, p: M.GM_TO_PAD[n.p] ?? 3, d: 0.25 })) : tr.notes;
    addClip(t, makePattern(s, tr.drum ? 'drums' : 'notes', len, notes, tr.name), 0);
    s.tracks.push(t);
  });
  if (!s.tracks.length) throw new Error('Esse MIDI não tem notas.');
  s.loop = { a: 0, b: len, on: true };
  return s;
}

// ---------- editor da música ----------
const hist = new Map();
async function openSong(song, opt = {}) {
  X.stopAll();
  X.screen('ed');
  const pl = P();
  pl.stop();
  song.patterns ||= {}; song.master ||= { vol: 0.9, fx: [] }; song.loop ||= { a: 0, b: song.sig * 8, on: true };
  for (const t of song.tracks) { if (t.params) t.params = normParams(t.params); t.pads ||= M.PADS.map(() => ({ vol: 1, clipId: null })); t.fx ||= []; t.clips ||= []; }
  const S = { tab: opt.tab || 'arr', pat: opt.pat || null, track: opt.track || song.tracks[0]?.id, clip: null, ppb: opt.ppb || 26, cursor: 0, rec: false, oct: 60, snap: opt.snap ?? 0.25, tool: 'draw', chord: '', selN: new Set(), patOnly: false };
  let H = hist.get(song.id);
  if (!H) { H = { stack: [JSON.stringify(song)], i: 0 }; hist.set(song.id, H); }
  const res = { audio: {}, pads: {} };
  const loadRes = async () => {
    const lib = Object.fromEntries((await X.all('clips')).map((c) => [c.id, c]));
    for (const t of song.tracks) {
      if (t.kind === 'audio') for (const c of t.clips) if (c.clipId && !res.audio[c.clipId] && lib[c.clipId]) res.audio[c.clipId] = await X.processed(lib[c.clipId]);
      if (t.kind === 'drum') for (const pd of t.pads) if (pd.clipId && !res.pads[pd.clipId] && lib[pd.clipId]) res.pads[pd.clipId] = await X.processed(lib[pd.clipId]);
    }
  };
  await loadRes();
  pl.setSong(song, res);
  pl.rebuild();

  X.app.innerHTML = `
  <div class="st">
    <header class="sthead">
      <button class="ibtn" id="sBack" aria-label="Voltar">${X.ic('back')}</button>
      <input id="sName" class="title-input" value="${X.esc(song.name)}" aria-label="Nome da música">
      <div class="tport">
        <button class="ibtn" id="sHome" aria-label="Voltar ao início">${X.ic('tostart')}</button>
        <button class="ibtn primary" id="sPlay" aria-label="Tocar">${X.ic('play')}</button>
        <button class="ibtn" id="sLoop" aria-label="Repetir a região de loop" aria-pressed="${song.loop.on}">${X.ic('loop')}</button>
        <button class="ibtn" id="sMetro" aria-label="Metrônomo" aria-pressed="${pl.metro}">${X.ic('metro')}</button>
        <span class="sclock" id="sClock">1.1</span>
      </div>
      <div class="sprops">
        <label class="mini">BPM<input id="sBpm" type="number" min="40" max="240" value="${song.bpm}"></label>
        <label class="mini">Tom<select id="sKey">${M.NOTE_NAMES.map((n, i) => `<option value="${i}" ${i === song.key ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="mini">Escala<select id="sScale">${Object.entries(M.SCALES).map(([k, [n]]) => `<option value="${k}" ${k === song.scale ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      <button class="ibtn" id="sUndo" aria-label="Desfazer">${X.ic('undo')}</button>
      <button class="ibtn" id="sRedo" aria-label="Refazer">${X.ic('redo')}</button>
    </header>
    <nav class="sttabs">${[['arr', 'mix', 'Arranjo'], ['edit', 'keyboard', 'Editor'], ['mixer', 'fx', 'Mixer'], ['exp', 'export', 'Exportar']].map(([t, i, l]) => `<button data-t="${t}" aria-current="${t === S.tab}">${X.ic(i)}<span>${l}</span></button>`).join('')}</nav>
    <div class="stbody" id="stBody"></div>
  </div>`;

  // ----- histórico e salvamento -----
  let saveT, commitT;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => X.put('songs', song), 400); };
  const updUndo = () => { X.$('#sUndo').disabled = H.i <= 0; X.$('#sRedo').disabled = H.i >= H.stack.length - 1; };
  const commitNow = () => { clearTimeout(commitT); commitT = null; const s = JSON.stringify(song); if (s !== H.stack[H.i]) { H.stack.splice(H.i + 1); H.stack.push(s); if (H.stack.length > 80) H.stack.shift(); H.i = H.stack.length - 1; } updUndo(); };
  const touch = (o = {}) => { save(); clearTimeout(commitT); commitT = setTimeout(commitNow, 500); X.$('#sUndo').disabled = false; if (o.mix) pl.setTrackGains(); if (o.graph && pl.playing) { const p = pl.pos(); pl.play(p, { loop: loopRange() }); } else pl.refresh(); };
  const goHist = (k) => { const o = JSON.parse(H.stack[k]); Object.keys(song).forEach((kk) => delete song[kk]); Object.assign(song, o); H.i = k; X.put('songs', song); openSong(song, { tab: S.tab, pat: S.pat, track: S.track, ppb: S.ppb, snap: S.snap }); };
  X.$('#sUndo').onclick = () => { if (commitT) commitNow(); if (H.i > 0) goHist(H.i - 1); };
  X.$('#sRedo').onclick = () => { if (H.i < H.stack.length - 1) goHist(H.i + 1); };
  updUndo();
  X.$('#sBack').onclick = () => { pl.stop(); if (commitT) commitNow(); X.put('songs', song); X.render(); };
  X.$('#sName').oninput = (e) => { song.name = e.target.value || 'Sem nome'; document.title = `${song.name} — Farelo`; save(); };
  document.title = `${song.name} — Farelo`;
  X.$('#sBpm').onchange = (e) => { song.bpm = Math.max(40, Math.min(240, +e.target.value || song.bpm)); e.target.value = song.bpm; touch({ graph: true }); };
  X.$('#sKey').onchange = (e) => { song.key = +e.target.value; touch(); redrawView(); };
  X.$('#sScale').onchange = (e) => { song.scale = e.target.value; touch(); redrawView(); };

  // ----- transporte -----
  const loopRange = () => (S.patOnly ? null : song.loop.on ? { a: song.loop.a, b: song.loop.b } : null);
  const setPlayIcon = () => { X.$('#sPlay').innerHTML = X.ic(pl.playing ? 'stop' : 'play'); X.$('#sPlay').setAttribute('aria-label', pl.playing ? 'Parar' : 'Tocar'); };
  const playSong = (from = S.cursor) => {
    if (S.patOnly) stopPattern();
    pl.setSong(song, res);
    pl.play(from, { loop: loopRange(), onEnd: () => { setPlayIcon(); } });
    setPlayIcon(); anim();
  };
  const stopAll = () => { pl.stop(); if (S.patOnly) stopPattern(); setPlayIcon(); redrawView(); };
  X.$('#sPlay').onclick = () => (pl.playing ? stopAll() : playSong());
  X.$('#sHome').onclick = () => { S.cursor = song.loop.on ? song.loop.a : 0; if (pl.playing) playSong(S.cursor); redrawView(); };
  X.$('#sLoop').onclick = (e) => { song.loop.on = !song.loop.on; e.currentTarget.setAttribute('aria-pressed', song.loop.on); touch(); if (pl.playing && !S.patOnly) playSong(pl.pos()); redrawView(); };
  X.$('#sMetro').onclick = (e) => { pl.metro = !pl.metro; e.currentTarget.setAttribute('aria-pressed', pl.metro); };
  let raf;
  const anim = () => {
    cancelAnimationFrame(raf);
    const loop = () => {
      if (!X.$('#sClock')) return;
      const p = pl.pos();
      const b = p ?? S.cursor, bar = Math.floor(b / song.sig), beat = Math.floor(b % song.sig);
      X.$('#sClock').textContent = `${bar + 1}.${beat + 1}  ${fmtTime((b * 60) / song.bpm)}`;
      X.$('#sClock').classList.toggle('on', p != null);
      viewTick && viewTick(p);
      if (pl.playing) raf = requestAnimationFrame(loop); else { setPlayIcon(); viewTick && viewTick(null); }
    };
    loop();
  };
  // tocar só o padrão aberto, em loop
  let savedSong = null;
  const playPattern = () => {
    const pat = song.patterns[S.pat], tr = song.tracks.find((t) => t.clips.some((c) => c.pat === S.pat)) || song.tracks.find((t) => t.id === S.track);
    if (!pat || !tr) return;
    pl.stop();
    savedSong = song;
    const tmp = { ...song, swing: song.swing, tracks: [{ ...tr, solo: false, mute: false, clips: [{ id: 'tmp', pat: pat.id, start: 0, len: pat.len }] }] };
    S.patOnly = { tr, pat };
    pl.setSong(tmp, res); pl.rebuild();
    pl.play(0, { loop: { a: 0, b: pat.len } });
    setPlayIcon(); anim();
  };
  const stopPattern = () => { pl.stop(); S.patOnly = false; if (savedSong) { pl.setSong(savedSong, res); pl.rebuild(); } savedSong = null; };

  // ----- MIDI e teclado do computador -----
  const held = new Map();
  const editTrack = () => song.tracks.find((t) => t.clips.some((c) => c.pat === S.pat)) || song.tracks.find((t) => t.id === S.track);
  const recordNote = (m, start, end, vel) => {
    if (!S.rec || !S.patOnly) return;
    const pat = song.patterns[S.pat]; if (!pat) return;
    const spb = 60 / song.bpm, len = pat.len;
    let t = start % len; if (S.snap) t = Math.round(t / S.snap) * S.snap % len;
    const d = Math.max(S.snap || 0.125, S.snap ? Math.round(((end - start) / 1) / S.snap) * S.snap : end - start);
    pat.notes.push({ p: m, t: +t.toFixed(4), d: +Math.min(d, len).toFixed(4), v: +vel.toFixed(2) });
    void spb; touch(); redrawView();
  };
  const noteDown = (m, vel = 0.85) => {
    const tr = editTrack(); if (!tr || tr.kind === 'audio' || held.has(m)) return;
    const off = pl.noteOn(tr, tr.kind === 'drum' ? ((m % 12) % 8) : m, vel);
    held.set(m, { off, start: pl.pos(), vel, drumPad: tr.kind === 'drum' ? (m % 12) % 8 : null });
  };
  const noteUp = (m) => {
    const h = held.get(m); if (!h) return; held.delete(m); h.off && h.off();
    if (h.start != null) { const p = pl.pos(); if (p != null) recordNote(h.drumPad ?? m, h.start, p < h.start ? p + (S.patOnly?.pat.len || 0) : p, h.vel); }
  };
  let midiIn = [];
  if (navigator.requestMIDIAccess && !X.midiAsked) {
    X.midiAsked = true;
    navigator.requestMIDIAccess().then((acc) => { X.midi = acc; }).catch(() => {});
  }
  const hookMidi = () => {
    if (!X.midi) return;
    midiIn = [...X.midi.inputs.values()];
    midiIn.forEach((inp) => { inp.onmidimessage = (ev) => { const [st, a, b] = ev.data; const cmd = st & 0xf0; if (cmd === 0x90 && b > 0) noteDown(a, b / 127); else if (cmd === 0x80 || (cmd === 0x90 && b === 0)) noteUp(a); }; });
  };
  hookMidi();

  // ----- abas -----
  let viewTick = null, redrawView = () => {};
  const views = { arr: viewArr, edit: viewEdit, mixer: viewMixer, exp: viewExport };
  const show = (t) => {
    S.tab = t;
    X.$$('.sttabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.t === t));
    viewTick = null; redrawView = () => {};
    X.$('#stBody').innerHTML = '';
    views[t]();
  };
  X.$$('.sttabs button').forEach((b) => b.onclick = () => show(b.dataset.t));
  const openPattern = (patId, trackId) => { S.pat = patId; if (trackId) S.track = trackId; S.selN.clear(); show('edit'); };

  // ================= ARRANJO =================
  function viewArr() {
    const ROW = 64, RUL = 30, HEAD = 220;
    const body = X.$('#stBody');
    body.innerHTML = `
      <div class="arrtools">
        <button id="aAdd">${X.ic('plus')}Faixa</button>
        <button id="aAsst">${X.ic('dice')}Assistente de acordes</button>
        <label class="mini">Encaixe<select id="aSnap"><option value="bar">Compasso</option><option value="beat">Tempo</option></select></label>
        <button class="ibtn sm" id="aZo" aria-label="Afastar">${X.ic('minus')}</button><button class="ibtn sm" id="aZi" aria-label="Aproximar">${X.ic('plus')}</button>
        <span class="sp"></span>
        <span class="clipbar" id="aClip"></span>
      </div>
      <div class="arrwrap">
        <div class="arrhead" id="aHead" style="--row:${ROW}px;--rul:${RUL}px"></div>
        <div class="arrx" id="aX"><canvas id="aCv"></canvas></div>
      </div>
      <p class="hint">Clique num espaço vazio de uma faixa para criar um bloco; dê dois cliques num bloco para editar as notas. Arraste para mover, puxe a borda direita para repetir. Na régua de cima, arraste para marcar a região de loop. Delete apaga, Ctrl+D duplica.</p>`;
    const cv = X.$('#aCv'), sx = X.$('#aX');
    let snapMode = X.store.get('arrSnap', 'bar');
    X.$('#aSnap').value = snapMode;
    X.$('#aSnap').onchange = (e) => { snapMode = e.target.value; X.store.set('arrSnap', snapMode); };
    const snapB = (b) => { const q = snapMode === 'bar' ? song.sig : 1; return Math.max(0, Math.round(b / q) * q); };
    const totalBeats = () => Math.max(32 * song.sig, Math.ceil((M.songEnd(song) + 8 * song.sig) / song.sig) * song.sig);
    const heads = () => {
      X.$('#aHead').innerHTML = `<div class="ah-rul"><span>${song.tracks.length} faixa(s)</span></div>` + song.tracks.map((t) => `
        <div class="ah ${t.id === S.track ? 'is' : ''}" data-id="${t.id}" style="--c:${t.color}">
          <div class="ahl1"><span class="chip" style="background:${t.color}"></span><b>${X.esc(t.name)}</b>
            <button class="tog ${t.mute ? 'is' : ''}" data-a="mute" aria-label="Mudo">M</button><button class="tog ${t.solo ? 'is' : ''}" data-a="solo" aria-label="Solo">S</button>
            <button class="ibtn sm amore" aria-label="Opções da faixa">${X.ic('gear')}</button></div>
          <div class="ahl2"><button class="ainst">${t.kind === 'drum' ? X.ic('steps') + M.KITS[t.kit] : t.kind === 'audio' ? X.ic('edit') + 'Sons da biblioteca' : X.ic('keyboard') + (M.INSTRUMENTS[t.inst]?.[0] || 'Instrumento')}</button>
            <input type="range" class="avol" min="0" max="1.2" step="0.01" value="${t.vol}" aria-label="Volume de ${X.esc(t.name)}"></div>
        </div>`).join('');
      X.$$('.ah').forEach((el) => {
        const t = song.tracks.find((x) => x.id === el.dataset.id);
        el.onclick = (ev) => { if (ev.target.closest('button,input')) return; S.track = t.id; heads(); };
        X.$$('.tog', el).forEach((b) => b.onclick = () => { t[b.dataset.a] = !t[b.dataset.a]; touch({ mix: true }); heads(); draw(); });
        X.$('.avol', el).oninput = (e) => { t.vol = +e.target.value; touch({ mix: true }); };
        X.$('.ainst', el).onclick = () => (t.kind === 'audio' ? pickAudio(t, S.cursor) : instSheet(t));
        X.$('.amore', el).onclick = () => trackMenu(t);
      });
    };
    const clipAt = (x, y) => {
      const row = Math.floor((y - RUL) / ROW), t = song.tracks[row];
      if (!t) return { t: null, row };
      const b = x / S.ppb;
      const c = [...t.clips].reverse().find((k) => b >= k.start && b <= k.start + k.len);
      return { t, row, c, edge: c && Math.abs(x - (c.start + c.len) * S.ppb) < 8 };
    };
    const draw = () => {
      const W = totalBeats() * S.ppb, Hh = RUL + Math.max(1, song.tracks.length) * ROW;
      cv.style.width = W + 'px'; cv.style.height = Hh + 'px';
      const s = X.setupCanvas(cv); if (!s) return;
      const { x } = s, K = X.col();
      x.fillStyle = K.line;
      for (let b = 0; b <= totalBeats(); b++) { const bar = b % song.sig === 0; x.globalAlpha = bar ? 0.9 : 0.3; x.fillRect(b * S.ppb, RUL, 1, Hh - RUL); }
      x.globalAlpha = 1;
      for (let r = 0; r <= song.tracks.length; r++) x.fillRect(0, RUL + r * ROW, W, 1);
      // régua
      x.fillStyle = K.panel2 || '#20242d'; x.fillRect(0, 0, W, RUL);
      if (song.loop) { x.fillStyle = song.loop.on ? K.accent : K.muted; x.globalAlpha = song.loop.on ? 0.35 : 0.15; x.fillRect(song.loop.a * S.ppb, 0, (song.loop.b - song.loop.a) * S.ppb, RUL); x.globalAlpha = 1; x.fillRect(song.loop.a * S.ppb, 0, 2, RUL); x.fillRect(song.loop.b * S.ppb - 2, 0, 2, RUL); }
      x.fillStyle = K.muted; x.font = '600 11px system-ui';
      for (let bar = 0; bar * song.sig <= totalBeats(); bar++) if (S.ppb * song.sig >= 30 || bar % 4 === 0) x.fillText(String(bar + 1), bar * song.sig * S.ppb + 4, 19);
      // blocos
      song.tracks.forEach((t, r) => {
        for (const c of t.clips) {
          const bx = c.start * S.ppb, bw = c.len * S.ppb, by = RUL + r * ROW + 4, bh = ROW - 8, pat = song.patterns[c.pat];
          x.globalAlpha = t.mute ? 0.35 : 1;
          x.fillStyle = t.color; x.globalAlpha *= 0.28; x.beginPath(); x.roundRect(bx + 1, by, bw - 2, bh, 6); x.fill();
          x.globalAlpha = t.mute ? 0.35 : 1;
          x.strokeStyle = c.id === S.clip ? K.fg : t.color; x.lineWidth = c.id === S.clip ? 2 : 1; x.stroke();
          x.save(); x.beginPath(); x.rect(bx + 1, by, bw - 2, bh); x.clip();
          x.fillStyle = t.color;
          if (pat && pat.notes.length) {
            const ps = pat.notes.map((n) => n.p), lo = Math.min(...ps), hi = Math.max(...ps), span = Math.max(6, hi - lo);
            for (let rep = 0; rep * pat.len < c.len; rep++) for (const n of pat.notes) {
              const nb = rep * pat.len + n.t; if (nb >= c.len) continue;
              const ny = t.kind === 'drum' ? by + 16 + (n.p / 8) * (bh - 20) : by + bh - 6 - ((n.p - lo) / span) * (bh - 24);
              x.fillRect(bx + nb * S.ppb, ny, Math.max(2, (t.kind === 'drum' ? 0.12 : n.d) * S.ppb), t.kind === 'drum' ? 3 : 3);
            }
            if (pat.len < c.len) { x.globalAlpha *= 0.6; for (let rep = 1; rep * pat.len < c.len; rep++) x.fillRect(bx + rep * pat.len * S.ppb, by, 1, bh); }
          } else if (t.kind === 'audio' && res.audio[c.clipId]) {
            const buf = res.audio[c.clipId], w = Math.max(1, Math.ceil(bw)), pk = X.peaks(buf, 0, Math.min(buf.duration, (c.len * 60) / song.bpm), w);
            for (let px = 0; px < w; px++) x.fillRect(bx + px, by + bh / 2 + pk.mn[px] * bh * 0.4, 1, Math.max(1, (pk.mx[px] - pk.mn[px]) * bh * 0.4));
          }
          x.restore();
          x.fillStyle = K.fg; x.font = '600 11px system-ui'; x.globalAlpha = t.mute ? 0.5 : 1;
          x.fillText(pat ? pat.name : (c.name || 'Som'), bx + 6, by + 13, Math.max(10, bw - 10));
          x.globalAlpha = 1;
        }
      });
      // cursor
      x.fillStyle = K.sel; x.fillRect(S.cursor * S.ppb, 0, 2, Hh);
    };
    const ph = document.createElement('div'); ph.className = 'phead'; ph.hidden = true; sx.appendChild(ph);
    viewTick = (p) => {
      if (p == null) { ph.hidden = true; return; }
      const px = Math.round(p * S.ppb);
      ph.hidden = false; ph.style.transform = `translateX(${px}px)`; ph.style.height = (RUL + song.tracks.length * ROW) + 'px';
      if (!S.patOnly && (px < sx.scrollLeft || px > sx.scrollLeft + sx.clientWidth - 40)) sx.scrollLeft = Math.max(0, px - 60);
    };
    redrawView = () => { heads(); draw(); clipBar(); };

    const clipBar = () => {
      const el = X.$('#aClip'); const t = song.tracks.find((k) => k.clips.some((c) => c.id === S.clip)), c = t?.clips.find((k) => k.id === S.clip);
      if (!c) { el.innerHTML = ''; return; }
      const pat = song.patterns[c.pat];
      el.innerHTML = `${pat ? `<button id="cEdit">${X.ic('edit')}Editar</button>` : ''}<button id="cDup">${X.ic('dup')}Duplicar</button>${pat ? `<button id="cUniq" title="Separa este bloco: mudar as notas dele não muda as outras cópias">Tornar único</button>` : ''}<button class="danger" id="cDel">${X.ic('trash')}</button>`;
      if (X.$('#cEdit')) X.$('#cEdit').onclick = () => openPattern(c.pat, t.id);
      X.$('#cDup').onclick = () => dupClip(t, c);
      if (X.$('#cUniq')) X.$('#cUniq').onclick = () => { const np = makePattern(song, pat.kind, pat.len, JSON.parse(JSON.stringify(pat.notes)), pat.name + ' (único)'); c.pat = np.id; touch(); draw(); X.toast('Bloco separado'); };
      X.$('#cDel').onclick = () => delClip();
    };
    const dupClip = (t, c) => { const n = { ...c, id: X.uid(), start: c.start + c.len }; t.clips.push(n); S.clip = n.id; touch(); draw(); clipBar(); };
    const delClip = () => { for (const t of song.tracks) { const i = t.clips.findIndex((c) => c.id === S.clip); if (i >= 0) t.clips.splice(i, 1); } S.clip = null; touch(); draw(); clipBar(); };
    let g = null;
    cv.onpointerdown = (ev) => {
      const r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top, b = x / S.ppb;
      cv.setPointerCapture(ev.pointerId);
      if (y < RUL) { g = { type: 'ruler', b0: snapB(b), x0: x, moved: false }; return; }
      const h = clipAt(x, y);
      if (h.c) { S.clip = h.c.id; S.track = h.t.id; g = { type: h.edge ? 'resize' : 'move', c: h.c, t: h.t, b0: b, s0: h.c.start, l0: h.c.len, moved: false }; draw(); clipBar(); heads(); return; }
      g = { type: 'empty', t: h.t, b, moved: false };
      S.clip = null; clipBar(); draw();
    };
    cv.onpointermove = (ev) => {
      const r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top, b = x / S.ppb;
      if (!g) { const h = y > RUL ? clipAt(x, y) : {}; cv.style.cursor = y < RUL ? 'text' : h.edge ? 'ew-resize' : h.c ? 'grab' : 'copy'; return; }
      if (Math.abs(x - (g.x0 ?? x)) > 4 || Math.abs(b - (g.b0 ?? g.b)) * S.ppb > 4) g.moved = true;
      if (g.type === 'ruler' && g.moved) { const a = Math.min(g.b0, snapB(b)), z = Math.max(g.b0, snapB(b)); if (z > a) { song.loop = { a, b: z, on: true }; X.$('#sLoop').setAttribute('aria-pressed', true); draw(); } }
      else if (g.type === 'move' && g.moved) {
        g.c.start = snapB(g.s0 + (b - g.b0));
        const row = Math.floor((y - RUL) / ROW), nt = song.tracks[row];
        if (nt && nt !== g.t && nt.kind === g.t.kind) { g.t.clips.splice(g.t.clips.indexOf(g.c), 1); nt.clips.push(g.c); g.t = nt; S.track = nt.id; }
        draw();
      } else if (g.type === 'resize') { const q = snapMode === 'bar' ? song.sig : 1; g.c.len = Math.max(q, Math.round((g.l0 + (b - g.b0)) / q) * q); draw(); }
    };
    cv.onpointerup = (ev) => {
      if (!g) return;
      const r = cv.getBoundingClientRect(), x = ev.clientX - r.left;
      if (g.type === 'ruler' && !g.moved) { S.cursor = Math.max(0, x / S.ppb); if (pl.playing) playSong(S.cursor); draw(); }
      else if (g.type === 'ruler') touch();
      else if ((g.type === 'move' || g.type === 'resize') && g.moved) touch({ graph: pl.playing });
      else if (g.type === 'empty' && !g.moved && g.t) {
        const start = Math.floor(g.b / song.sig) * song.sig;
        if (g.t.kind === 'audio') pickAudio(g.t, start);
        else {
          const last = g.t.clips.map((c) => song.patterns[c.pat]).filter(Boolean).pop();
          const pat = g.t.kind === 'drum' ? makePattern(song, 'drums', song.sig, M.drumNotes('pop', 1, song.sig)) : makePattern(song, 'notes', last?.len || 4 * song.sig);
          const c = addClip(g.t, pat, start, g.t.kind === 'drum' ? 4 * song.sig : pat.len);
          S.clip = c.id; S.track = g.t.id; touch(); draw(); clipBar();
          X.toast(g.t.kind === 'drum' ? 'Bloco de bateria criado' : 'Bloco criado: dê dois cliques para escrever as notas');
        }
      }
      g = null;
    };
    cv.ondblclick = (ev) => { const r = cv.getBoundingClientRect(), h = clipAt(ev.clientX - r.left, ev.clientY - r.top); if (h.c && song.patterns[h.c.pat]) openPattern(h.c.pat, h.t.id); };
    cv.oncontextmenu = (ev) => { ev.preventDefault(); const r = cv.getBoundingClientRect(), h = clipAt(ev.clientX - r.left, ev.clientY - r.top); if (h.c) { S.clip = h.c.id; delClip(); } };
    sx.addEventListener('wheel', (ev) => { if (!ev.ctrlKey) return; ev.preventDefault(); zoom(ev.deltaY < 0 ? 1.2 : 1 / 1.2); }, { passive: false });
    const zoom = (f) => { S.ppb = Math.max(6, Math.min(120, S.ppb * f)); draw(); };
    X.$('#aZi').onclick = () => zoom(1.3); X.$('#aZo').onclick = () => zoom(1 / 1.3);
    X.$('#aAdd').onclick = addTrackSheet;
    X.$('#aAsst').onclick = assistant;
    X.setKeys((ev) => {
      const k = ev.key, ctrl = ev.ctrlKey || ev.metaKey;
      if (common(ev)) return;
      if (k === 'Delete' && S.clip) delClip();
      else if (ctrl && k.toLowerCase() === 'd' && S.clip) { ev.preventDefault(); const t = song.tracks.find((q) => q.clips.some((c) => c.id === S.clip)); dupClip(t, t.clips.find((c) => c.id === S.clip)); }
      else if (k === 'Enter' && S.clip) { const t = song.tracks.find((q) => q.clips.some((c) => c.id === S.clip)), c = t.clips.find((q) => q.id === S.clip); if (song.patterns[c.pat]) openPattern(c.pat, t.id); }
      else if (k === '+' || k === '=') zoom(1.3); else if (k === '-') zoom(1 / 1.3);
    });
    heads(); draw(); clipBar();
    new ResizeObserver(() => draw()).observe(sx);
  }

  // atalhos comuns a todas as abas
  function common(ev) {
    const k = ev.key, ctrl = ev.ctrlKey || ev.metaKey, lk = k.toLowerCase();
    if (k === ' ') { ev.preventDefault(); if (pl.playing) stopAll(); else if (S.tab === 'edit' && S.pat) playPattern(); else playSong(); return true; }
    if (ctrl && lk === 'z' && !ev.shiftKey) { ev.preventDefault(); X.$('#sUndo').click(); return true; }
    if (ctrl && (lk === 'y' || (lk === 'z' && ev.shiftKey))) { ev.preventDefault(); X.$('#sRedo').click(); return true; }
    if (k === 'Home') { X.$('#sHome').click(); return true; }
    if (k === 'F5') { ev.preventDefault(); show('arr'); return true; } if (k === 'F6') { ev.preventDefault(); show('edit'); return true; } if (k === 'F7') { ev.preventDefault(); show('mixer'); return true; } if (k === 'F8') { ev.preventDefault(); show('exp'); return true; }
    if (k === 'Backspace' && S.tab !== 'edit') { ev.preventDefault(); X.$('#sBack').click(); return true; }
    return false;
  }

  // ----- faixas -----
  function addTrackSheet() {
    const s = X.sheet('Nova faixa', `<div class="fxgrid">
      <button class="fxtile" data-k="inst">${X.ic('keyboard')}<b>Instrumento</b><small>Piano, baixo, cordas, chiptune… você escreve as notas no piano roll.</small></button>
      <button class="fxtile" data-k="drum">${X.ic('steps')}<b>Bateria</b><small>Sequenciador por passos com kits e ritmos prontos.</small></button>
      <button class="fxtile" data-k="audio">${X.ic('edit')}<b>Áudio</b><small>Coloque sons da sua biblioteca de SFX na música (ambiente, voz, efeitos).</small></button></div>`, { icon: 'plus' });
    X.$$('.fxtile', s.body).forEach((b) => b.onclick = () => {
      const t = makeTrack(b.dataset.k, {}, song.tracks.length);
      song.tracks.push(t); S.track = t.id; s.close(); touch({ graph: true }); pl.rebuild(); redrawView();
      if (t.kind === 'inst') instSheet(t);
    });
  }
  function trackMenu(t) {
    const s = X.sheet(t.name, `
      <label class="field">Nome<input id="tName" value="${X.esc(t.name)}" autocomplete="off"></label>
      <div class="colors">${COLORS.map((c) => `<button class="cdot ${c === t.color ? 'is' : ''}" data-c="${c}" style="background:${c}" aria-label="Cor"></button>`).join('')}</div>
      <div class="sliders">${X.sliderRow('pan', { label: 'Pan', min: -1, max: 1, step: 0.05, def: 0, unit: '' }, t.pan)}</div>
      ${t.kind !== 'audio' ? `<button class="wide" id="tInst">${X.ic(t.kind === 'drum' ? 'steps' : 'keyboard')}${t.kind === 'drum' ? 'Kit e pads da bateria' : 'Instrumento e timbre'}</button>` : ''}
      <button class="wide" id="tFx">${X.ic('fx')}Efeitos da faixa (${t.fx.filter((f) => f.on).length})</button>
      <div class="row"><button id="tUp">${X.ic('up')}Subir</button><button id="tDn">${X.ic('down')}Descer</button></div>
      <button class="wide" id="tDup">${X.ic('dup')}Duplicar faixa</button>
      <button class="ghost danger wide" id="tDel">${X.ic('trash')}Apagar faixa</button>`, { icon: 'gear' });
    const b = s.body;
    X.$('#tName', b).onchange = (e) => { t.name = e.target.value.trim() || t.name; touch(); redrawView(); };
    X.$$('.cdot', b).forEach((d) => d.onclick = () => { t.color = d.dataset.c; X.$$('.cdot', b).forEach((z) => z.classList.toggle('is', z === d)); touch(); redrawView(); });
    X.bindSliders(b, { pan: { label: 'Pan', min: -1, max: 1, step: 0.05, def: 0, unit: '' } }, () => t.pan, (k, v) => { t.pan = v; }, () => touch({ mix: true }));
    if (X.$('#tInst', b)) X.$('#tInst', b).onclick = () => { s.close(); instSheet(t); };
    X.$('#tFx', b).onclick = () => { s.close(); fxSheet(t.fx, t.name); };
    const mv = (d) => { const i = song.tracks.indexOf(t), j = i + d; if (j < 0 || j >= song.tracks.length) return; [song.tracks[i], song.tracks[j]] = [song.tracks[j], song.tracks[i]]; touch(); redrawView(); };
    X.$('#tUp', b).onclick = () => mv(-1); X.$('#tDn', b).onclick = () => mv(1);
    X.$('#tDup', b).onclick = () => { const c = JSON.parse(JSON.stringify(t)); c.id = X.uid(); c.name += ' (cópia)'; c.clips.forEach((k) => (k.id = X.uid())); song.tracks.splice(song.tracks.indexOf(t) + 1, 0, c); s.close(); touch({ graph: true }); pl.rebuild(); redrawView(); };
    X.$('#tDel', b).onclick = (e) => { if (!e.currentTarget.dataset.c) { e.currentTarget.dataset.c = 1; e.currentTarget.innerHTML = `${X.ic('trash')}Toque de novo para apagar`; return; } song.tracks.splice(song.tracks.indexOf(t), 1); s.close(); touch({ graph: true }); pl.rebuild(); redrawView(); };
  }
  function fxSheet(chain, title) {
    const s = X.sheet(`Efeitos: ${title}`, `<p class="hint">Os efeitos tocam ao vivo e saem iguais na exportação.</p><div id="fxC"></div>`, { icon: 'fx', onClose: () => { pl.rebuild(); if (pl.playing) playSong(pl.pos()); redrawView(); } });
    X.chainUI(X.$('#fxC', s.body), chain, () => touch(), { allow: M.LIVE_FX });
  }
  function instSheet(t) {
    if (t.kind === 'drum') return kitSheet(t);
    const keys = [60, 62, 64, 65, 67, 69, 71, 72];
    const s = X.sheet(`Instrumento: ${t.name}`, `
      <div class="fxgrid insts">${Object.entries(M.INSTRUMENTS).map(([k, [n]]) => `<button class="fxtile ${k === t.inst ? 'is' : ''}" data-k="${k}">${X.ic('keyboard')}<b>${n}</b></button>`).join('')}</div>
      <div class="minikeys">${keys.map((m) => `<button data-m="${m}">${M.NOTE_NAMES[m % 12]}</button>`).join('')}</div>
      <details class="card" open><summary>Ajustes do timbre</summary><div class="sliders" id="synS"></div></details>`, { icon: 'keyboard', onClose: () => redrawView() });
    const b = s.body;
    const sliders = () => { X.$('#synS', b).innerHTML = Object.entries(M.SYN_DEFS).map(([k, p]) => X.sliderRow(k, p, t.params[k])).join(''); X.bindSliders(X.$('#synS', b), M.SYN_DEFS, (k) => t.params[k], (k, v) => { t.params[k] = v; }, () => touch()); };
    sliders();
    X.$$('.insts .fxtile', b).forEach((tile) => tile.onclick = () => {
      t.inst = tile.dataset.k; t.params = normParams(M.instParams(t.inst));
      if (Object.values(M.INSTRUMENTS).some(([n]) => n === t.name) || /^Instrumento/.test(t.name)) t.name = M.INSTRUMENTS[t.inst][0];
      X.$$('.insts .fxtile', b).forEach((z) => z.classList.toggle('is', z === tile)); sliders(); touch(); pl.noteOn(t, 60)?.call && setTimeout(() => {}, 0);
      const off = pl.noteOn(t, 60); setTimeout(() => off && off(), 350);
    });
    X.$$('.minikeys button', b).forEach((k) => { let off; k.onpointerdown = () => { off = pl.noteOn(t, +k.dataset.m); }; k.onpointerup = k.onpointerleave = () => { off && off(); off = null; }; });
  }
  function kitSheet(t) {
    const s = X.sheet(`Bateria: ${t.name}`, `
      <label class="field">Kit<select id="kKit">${Object.entries(M.KITS).map(([k, n]) => `<option value="${k}" ${k === t.kit ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <p class="hint">Cada pad pode usar o som do kit ou qualquer som da sua biblioteca de SFX.</p>
      <div class="pads">${M.PADS.map((n, i) => `<div class="padrow" data-i="${i}"><button class="ptry">${X.ic('play')}${n}</button><button class="psrc">${t.pads[i].clipId ? 'Som da biblioteca' : 'Som do kit'}</button><input type="range" min="0" max="1.5" step="0.01" value="${t.pads[i].vol}" aria-label="Volume do pad ${n}"></div>`).join('')}</div>`, { icon: 'steps', onClose: () => redrawView() });
    const b = s.body;
    X.$('#kKit', b).onchange = (e) => { t.kit = e.target.value; touch(); pl.noteOn(t, 0); };
    X.$$('.padrow', b).forEach((row) => {
      const i = +row.dataset.i;
      X.$('.ptry', row).onclick = () => pl.noteOn(t, i);
      X.$('input', row).oninput = (e) => { t.pads[i].vol = +e.target.value; touch(); };
      X.$('.psrc', row).onclick = async () => {
        const clips = (await X.all('clips')).sort((a, c) => a.name.localeCompare(c.name));
        const s2 = X.sheet(`Som do pad: ${M.PADS[i]}`, `<button class="wide" data-id="">Usar o som do kit</button><ul class="list simple picks">${clips.map((c) => `<li><button class="open" data-id="${c.id}"><span class="tx"><span class="nm">${X.esc(c.name)}</span><small>${X.fmt(Math.max(0, (c.edits?.end ?? c.dur ?? 0) - (c.edits?.start || 0)))}</small></span></button></li>`).join('')}</ul>`, { icon: 'library' });
        X.$$('[data-id]', s2.body).forEach((bt) => bt.onclick = async () => { t.pads[i].clipId = bt.dataset.id || null; await loadRes(); pl.setSong(song, res); s2.close(); X.$('.psrc', row).textContent = t.pads[i].clipId ? 'Som da biblioteca' : 'Som do kit'; touch(); pl.noteOn(t, i); });
      };
    });
  }
  async function pickAudio(t, start) {
    const clips = (await X.all('clips')).sort((a, c) => (c.updated || c.created) - (a.updated || a.created));
    const s = X.sheet('Escolha um som da biblioteca', clips.length ? `<ul class="list simple picks">${clips.map((c) => `<li><button class="open" data-id="${c.id}"><span class="tx"><span class="nm">${X.esc(c.name)}</span><small>${X.fmt(Math.max(0, (c.edits?.end ?? c.dur ?? 0) - (c.edits?.start || 0)))}</small></span></button></li>`).join('')}</ul>` : '<p class="hint">Sua biblioteca de SFX está vazia. Grave ou importe sons na área SFX primeiro.</p>', { icon: 'library' });
    X.$$('[data-id]', s.body).forEach((bt) => bt.onclick = async () => {
      const c = clips.find((k) => k.id === bt.dataset.id);
      const buf = await X.processed(c); res.audio[c.id] = buf;
      const len = Math.max(0.25, Math.ceil(((buf.duration * song.bpm) / 60) * 4) / 4);
      t.clips.push({ id: X.uid(), clipId: c.id, name: c.name, start, len, gain: 1 });
      s.close(); pl.setSong(song, res); touch(); redrawView();
    });
  }

  // ----- assistente de acordes -----
  function assistant() {
    const s = X.sheet('Assistente de acordes', `
      <p class="hint">Cria faixas prontas no tom ${M.NOTE_NAMES[song.key]} ${M.SCALES[song.scale][0].toLowerCase()}, a partir do compasso ${Math.floor(S.cursor / song.sig) + 1}.</p>
      <label class="field">Progressão<select id="asP">${M.PROGRESSIONS.map(([n], i) => `<option value="${i}">${n}</option>`).join('')}</select></label>
      <div class="grid2">
        <label class="field">Compassos por acorde<select id="asB"><option value="1">1</option><option value="2">2</option></select></label>
        <label class="field">Repetições<select id="asR"><option>1</option><option>2</option><option selected>4</option><option>8</option></select></label>
        <label class="field">Acordes: instrumento<select id="asCi">${Object.entries(M.INSTRUMENTS).map(([k, [n]]) => `<option value="${k}" ${k === 'pad' ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="field">Acordes: estilo<select id="asCs"><option value="block">Blocos (longos)</option><option value="arp">Arpejo</option><option value="stab">Batidas no contratempo</option><option value="pulse">Pulsante (colcheias)</option></select></label>
      </div>
      <label class="check"><input type="checkbox" id="asBass" checked> Criar baixo</label>
      <label class="field">Baixo: estilo<select id="asBs"><option value="root">Uma nota por tempo</option><option value="eighth">Colcheias</option><option value="long">Notas longas</option><option value="sixteenth">Semicolcheias (rápido)</option></select></label>
      <label class="check"><input type="checkbox" id="asMel"> Criar melodia (sugestão para você ajustar)</label>
      <label class="check"><input type="checkbox" id="asDr"> Criar bateria</label>
      <label class="field">Bateria: ritmo<select id="asDs">${Object.entries(M.DRUM_STYLE_NAMES).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
      <div class="row"><button id="asPrev">${X.ic('play')}Ouvir a progressão</button><button class="primary" id="asGo">${X.ic('check')}Criar faixas</button></div>`, { icon: 'dice' });
    const b = s.body, v = (id) => X.$(id, b).value;
    X.$('#asPrev', b).onclick = () => {
      const prog = M.PROGRESSIONS[+v('#asP')][1], t = makeTrack('inst', { inst: v('#asCi') });
      prog.forEach((deg, i) => M.diatonic(M.degreeRoot(deg, song.key, song.scale, 60), song.key, song.scale).forEach((m) => { const c = pl.c; M.voice(c, c.destination, t.params, m, c.currentTime + 0.05 + i * 0.8, 0.75, 0.5); }));
    };
    X.$('#asGo', b).onclick = () => {
      const made = buildArrangement(song, { prog: +v('#asP'), bpc: +v('#asB'), reps: +v('#asR'), at: Math.floor(S.cursor / song.sig) * song.sig, chords: [v('#asCi'), v('#asCs')], bass: X.$('#asBass', b).checked ? ['bass', v('#asBs')] : null, lead: X.$('#asMel', b).checked ? 'lead' : null, drums: X.$('#asDr', b).checked ? v('#asDs') : null, kit: 'k808' });
      s.close(); pl.rebuild(); touch({ graph: true }); redrawView(); X.toast(`${made.length} faixa(s) criadas`);
    };
  }

  // ================= EDITOR (piano roll / bateria) =================
  function viewEdit() {
    const body = X.$('#stBody');
    let pat = song.patterns[S.pat];
    if (!pat) {
      const t = song.tracks.find((k) => k.id === S.track && k.kind !== 'audio') || song.tracks.find((k) => k.kind !== 'audio');
      const c = t?.clips.find((k) => song.patterns[k.pat]);
      if (c) { S.pat = c.pat; S.track = t.id; pat = song.patterns[c.pat]; }
    }
    if (!pat) { body.innerHTML = '<div class="empty"><b>Nada para editar</b><p>No Arranjo, clique num espaço vazio de uma faixa de instrumento ou bateria para criar um bloco.</p></div>'; X.setKeys((ev) => common(ev)); return; }
    const tr = editTrack();
    const pats = Object.values(song.patterns).filter((p) => p.kind === pat.kind);
    const head = `
      <div class="prtools">
        <label class="mini">Padrão<select id="ePat">${pats.map((p) => `<option value="${p.id}" ${p.id === pat.id ? 'selected' : ''}>${X.esc(p.name)}</option>`).join('')}</select></label>
        <button class="ibtn sm" id="eRen" aria-label="Renomear padrão">${X.ic('edit')}</button>
        <span class="trk-name" style="--c:${tr?.color}">${X.esc(tr?.name || '')}</span>
        <label class="mini">Tamanho<select id="eLen">${[1, 2, 4, 8, 16].map((n) => `<option value="${n * song.sig}" ${n * song.sig === pat.len ? 'selected' : ''}>${n} compasso${n > 1 ? 's' : ''}</option>`).join('')}</select></label>
        <button id="ePlay">${X.ic('play')}Tocar padrão</button>
        <button id="eRec" aria-pressed="${S.rec}">${X.ic('rec')}Gravar</button>
        <span class="sp"></span>
        <button id="eInst">${X.ic(pat.kind === 'drums' ? 'steps' : 'keyboard')}${pat.kind === 'drums' ? 'Kit' : 'Timbre'}</button>
      </div>`;
    if (pat.kind === 'drums') return drumEditor(body, head, pat, tr);
    pianoRoll(body, head, pat, tr);
  }
  function bindEditHead(pat, tr) {
    X.$('#ePat').onchange = (e) => { S.pat = e.target.value; S.selN.clear(); show('edit'); };
    X.$('#eRen').onclick = () => { const s = X.sheet('Renomear padrão', `<div class="row"><input id="rn" value="${X.esc(pat.name)}"><button class="primary" id="rnOk">Salvar</button></div>`, { icon: 'edit' }); X.$('#rnOk', s.body).onclick = () => { pat.name = X.$('#rn', s.body).value.trim() || pat.name; s.close(); touch(); show('edit'); }; };
    X.$('#eLen').onchange = (e) => { pat.len = +e.target.value; pat.notes = pat.notes.filter((n) => n.t < pat.len); touch(); show('edit'); };
    X.$('#ePlay').onclick = () => (pl.playing ? stopAll() : playPattern());
    X.$('#eRec').onclick = (e) => { S.rec = !S.rec; e.currentTarget.setAttribute('aria-pressed', S.rec); if (S.rec && !pl.playing) playPattern(); X.toast(S.rec ? (pat.kind === 'drums' ? 'Gravando: toque as teclas A a K para os pads' : 'Gravando: toque o teclado do computador (A, W, S…) ou um teclado MIDI') : 'Gravação desligada'); };
    X.$('#eInst').onclick = () => tr && instSheet(tr);
  }
  function pianoRoll(body, head, pat, tr) {
    const LO = 24, HI = 96, RH = 15, KW = 64, rows = HI - LO + 1;
    const snaps = [[1, '1 tempo'], [0.5, '1/8'], [0.25, '1/16'], [0.125, '1/32'], [1 / 3, '1/4 tercina'], [0, 'Livre']];
    body.innerHTML = head + `
      <div class="prtools two">
        <div class="seg"><button data-tool="draw" aria-pressed="${S.tool === 'draw'}">${X.ic('brush')}Desenhar</button><button data-tool="sel" aria-pressed="${S.tool === 'sel'}">${X.ic('select')}Selecionar</button></div>
        <label class="mini">Grade<select id="eSnap">${snaps.map(([v, l]) => `<option value="${v}" ${Math.abs(v - S.snap) < 1e-6 ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="mini">Acorde<select id="eChord"><option value="">Nota única</option><option value="dia3" ${S.chord === 'dia3' ? 'selected' : ''}>Acorde da escala</option><option value="dia4" ${S.chord === 'dia4' ? 'selected' : ''}>Acorde da escala com 7ª</option>${Object.entries(M.CHORDS).map(([k, [n]]) => `<option value="${k}" ${S.chord === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <button id="eQ" title="Alinha as notas na grade">Quantizar</button>
        <button class="ibtn sm" id="eTd" aria-label="Transpor meio tom abaixo">${X.ic('down')}</button><button class="ibtn sm" id="eTu" aria-label="Transpor meio tom acima">${X.ic('up')}</button>
        <button class="ibtn sm" id="eZo" aria-label="Afastar">${X.ic('minus')}</button><button class="ibtn sm" id="eZi" aria-label="Aproximar">${X.ic('plus')}</button>
        <span class="hint" id="eInfo"></span>
      </div>
      <div class="prwrap"><div class="pry" id="pry"><canvas id="prK" width="${KW}"></canvas><div class="prx" id="prx"><canvas id="prG"></canvas></div></div>
      <div class="velx" id="velx"><canvas id="prV"></canvas></div></div>
      <p class="hint">Clique para criar notas, arraste para mover, puxe a borda para alongar, clique com o botão direito (ou dois cliques) para apagar. Teclado do PC toca notas: A W S E D F T G Y H U J K (Z e X mudam a oitava). Linhas claras são notas da escala.</p>`;
    bindEditHead(pat, tr);
    const kc = X.$('#prK'), gc = X.$('#prG'), vc = X.$('#prV'), prx = X.$('#prx'), velx = X.$('#velx'), pry = X.$('#pry');
    let ppb = Math.max(40, S.ppb * 3);
    const yOf = (m) => (HI - m) * RH, mOf = (y) => HI - Math.floor(y / RH);
    const W = () => pat.len * ppb + 2;
    const snapT = (b) => (S.snap ? Math.round(b / S.snap) * S.snap : b);
    const drawKeys = () => {
      kc.style.height = rows * RH + 'px'; kc.style.width = KW + 'px';
      const s = X.setupCanvas(kc); if (!s) return; const { x } = s, K = X.col();
      for (let m = LO; m <= HI; m++) {
        const y = yOf(m), black = [1, 3, 6, 8, 10].includes(m % 12);
        x.fillStyle = black ? '#1b1d22' : '#e9eaee'; x.fillRect(0, y, KW, RH - 1);
        if (m % 12 === 0 || m === held_hl) { x.fillStyle = m === held_hl ? K.accent : black ? '#aaa' : '#555'; x.font = '600 10px system-ui'; x.fillText(M.noteName(m), 4, y + RH - 4); }
        if (M.inScale(m, song.key, song.scale)) { x.fillStyle = K.accent; x.fillRect(KW - 4, y, 4, RH - 1); }
      }
    };
    let held_hl = -1;
    const drawGrid = (p = null) => {
      gc.style.width = W() + 'px'; gc.style.height = rows * RH + 'px';
      const s = X.setupCanvas(gc); if (!s) return; const { x, w } = s, K = X.col();
      for (let m = LO; m <= HI; m++) {
        const y = yOf(m), inS = M.inScale(m, song.key, song.scale), root = ((m - song.key) % 12 + 12) % 12 === 0;
        x.fillStyle = root ? 'rgba(242,163,58,.10)' : inS ? 'rgba(255,255,255,.045)' : 'rgba(0,0,0,.18)';
        x.fillRect(0, y, w, RH); x.fillStyle = K.line; x.globalAlpha = 0.5; x.fillRect(0, y + RH - 1, w, 1); x.globalAlpha = 1;
      }
      const step = S.snap && S.snap * ppb >= 8 ? S.snap : 1;
      for (let b = 0; b <= pat.len + 1e-6; b += step) { const bar = Math.abs(b % song.sig) < 1e-6, beat = Math.abs(b % 1) < 1e-6; x.fillStyle = K.line; x.globalAlpha = bar ? 1 : beat ? 0.55 : 0.22; x.fillRect(Math.round(b * ppb), 0, bar ? 2 : 1, rows * RH); }
      x.globalAlpha = 1;
      for (const [i, n] of pat.notes.entries()) {
        const nx = n.t * ppb, ny = yOf(n.p), nw = Math.max(4, n.d * ppb - 1), sel = S.selN.has(i);
        x.fillStyle = tr?.color || K.accent; x.globalAlpha = 0.45 + n.v * 0.55;
        x.beginPath(); x.roundRect(nx + 1, ny + 1, nw - 1, RH - 2, 3); x.fill();
        x.globalAlpha = 1;
        if (sel) { x.strokeStyle = K.fg; x.lineWidth = 2; x.stroke(); }
        if (nw > 26) { x.fillStyle = '#111'; x.font = '600 9px system-ui'; x.fillText(M.noteName(n.p), nx + 4, ny + RH - 4); }
      }
      if (box) { x.strokeStyle = K.sel; x.setLineDash([4, 3]); x.lineWidth = 1; x.strokeRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0); x.setLineDash([]); }
      if (p != null) { x.fillStyle = K.fg; x.fillRect(Math.round(p * ppb), 0, 2, rows * RH); }
      drawVel();
    };
    const drawVel = () => {
      vc.style.width = W() + 'px'; vc.style.height = '70px';
      const s = X.setupCanvas(vc); if (!s) return; const { x, w, h } = s, K = X.col();
      x.fillStyle = K.panel2 || '#20242d'; x.fillRect(0, 0, w, h);
      for (const [i, n] of pat.notes.entries()) { x.fillStyle = S.selN.has(i) ? K.fg : tr?.color || K.accent; const bh = n.v * (h - 6); x.fillRect(n.t * ppb, h - bh, Math.max(3, Math.min(8, n.d * ppb)), bh); }
    };
    const redraw = () => { drawKeys(); drawGrid(); info(); };
    const info = () => { X.$('#eInfo').textContent = `${pat.notes.length} nota(s)${S.selN.size ? ` · ${S.selN.size} selecionada(s)` : ''} · oitava do teclado: ${M.noteName(S.oct)}`; };
    redrawView = redraw;
    viewTick = (p) => { if (!S.patOnly && p != null) { const t = S.patOnly; void t; } const lp = p == null ? null : S.patOnly ? p % pat.len : localPos(p); drawGrid(lp); };
    const localPos = (p) => { const c = tr?.clips.find((k) => k.pat === pat.id && p >= k.start && p < k.start + k.len); return c ? (p - c.start) % pat.len : null; };
    // posição inicial: centraliza nas notas
    requestAnimationFrame(() => { const ps = pat.notes.map((n) => n.p); const mid = ps.length ? (Math.min(...ps) + Math.max(...ps)) / 2 : 60; pry.scrollTop = Math.max(0, yOf(mid) - pry.clientHeight / 2); });
    prx.addEventListener('scroll', () => { velx.scrollLeft = prx.scrollLeft; });
    const hit = (x, y) => { const m = mOf(y), b = x / ppb; for (let i = pat.notes.length - 1; i >= 0; i--) { const n = pat.notes[i]; if (n.p === m && b >= n.t && b <= n.t + n.d) return { i, n, edge: Math.abs(x - (n.t + n.d) * ppb) < 7 }; } return null; };
    const chordOf = (m) => {
      if (!S.chord) return [m];
      if (S.chord === 'dia3' || S.chord === 'dia4') { let r = m; if (!M.inScale(r, song.key, song.scale)) r -= 1; return M.diatonic(r, song.key, song.scale, S.chord === 'dia4' ? 4 : 3); }
      return M.CHORDS[S.chord][1].map((i) => m + i);
    };
    const preview = (ms) => { if (!tr) return; ms.forEach((m) => { const off = pl.noteOn(tr, m, 0.75); setTimeout(() => off && off(), 220); }); };
    let g = null, box = null, lastLen = Math.max(S.snap || 0.25, 0.25);
    gc.onpointerdown = (ev) => {
      gc.setPointerCapture(ev.pointerId);
      const r = gc.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top, h = hit(x, y), b = x / ppb;
      if (ev.button === 2) return;
      if (h) {
        if (!S.selN.has(h.i)) { if (!ev.shiftKey) S.selN.clear(); S.selN.add(h.i); }
        g = { type: h.edge ? 'resize' : 'move', b0: b, m0: mOf(y), orig: [...S.selN].map((i) => ({ i, ...pat.notes[i] })), moved: false };
        if (!h.edge) preview([h.n.p]);
        drawGrid(); info(); return;
      }
      if (S.tool === 'sel') { if (!ev.shiftKey) S.selN.clear(); box = { x0: x, y0: y, x1: x, y1: y }; g = { type: 'box' }; drawGrid(); return; }
      const t = Math.max(0, Math.min(pat.len - 0.01, S.snap ? Math.floor(b / S.snap) * S.snap : b)), ms = chordOf(mOf(y));
      S.selN.clear();
      for (const m of ms) { pat.notes.push({ p: m, t: +t.toFixed(4), d: Math.min(lastLen, pat.len - t), v: 0.8 }); S.selN.add(pat.notes.length - 1); }
      preview(ms);
      g = { type: 'resize', b0: t + lastLen, orig: [...S.selN].map((i) => ({ i, ...pat.notes[i] })), moved: true, fresh: true };
      drawGrid(); info();
    };
    gc.onpointermove = (ev) => {
      const r = gc.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top, b = x / ppb;
      if (!g) { const h = hit(x, y); gc.style.cursor = h ? (h.edge ? 'ew-resize' : 'grab') : S.tool === 'sel' ? 'crosshair' : 'copy'; return; }
      if (g.type === 'box') { box.x1 = x; box.y1 = y; const [x0, x1, y0, y1] = [Math.min(box.x0, x), Math.max(box.x0, x), Math.min(box.y0, y), Math.max(box.y0, y)]; S.selN.clear(); pat.notes.forEach((n, i) => { const nx = n.t * ppb, ny = yOf(n.p); if (nx + n.d * ppb > x0 && nx < x1 && ny + RH > y0 && ny < y1) S.selN.add(i); }); drawGrid(); info(); return; }
      if (g.type === 'move') {
        const db = snapT(b - g.b0), dm = mOf(y) - g.m0;
        if (db || dm) g.moved = true;
        let changed = false;
        for (const o of g.orig) { const n = pat.notes[o.i], np = Math.max(LO, Math.min(HI, o.p + dm)); if (np !== n.p) changed = true; n.t = +Math.max(0, Math.min(pat.len - 0.01, o.t + db)).toFixed(4); n.p = np; }
        if (changed && dm) preview([pat.notes[g.orig[0].i].p]);
        drawGrid();
      } else if (g.type === 'resize') {
        const end = snapT(b);
        for (const o of g.orig) { const n = pat.notes[o.i]; n.d = +Math.max(S.snap || 0.0625, Math.min(pat.len - n.t, (g.fresh ? end : o.t + o.d + (end - g.b0)) - (g.fresh ? n.t : o.t))).toFixed(4); }
        g.moved = true; drawGrid();
      }
    };
    gc.onpointerup = () => {
      if (!g) return;
      if (g.type === 'resize' && g.orig.length) lastLen = pat.notes[g.orig[0].i].d;
      if (g.type === 'box') box = null;
      if (g.moved) touch();
      g = null; drawGrid(); info();
    };
    const delAt = (ev) => { const r = gc.getBoundingClientRect(), h = hit(ev.clientX - r.left, ev.clientY - r.top); if (h) { pat.notes.splice(h.i, 1); S.selN.clear(); touch(); drawGrid(); info(); } };
    gc.oncontextmenu = (ev) => { ev.preventDefault(); delAt(ev); };
    gc.ondblclick = (ev) => delAt(ev);
    kc.onpointerdown = (ev) => { const r = kc.getBoundingClientRect(), m = mOf(ev.clientY - r.top); preview([m]); };
    // velocidade
    let vg = false;
    const setVel = (ev) => { const r = vc.getBoundingClientRect(), b = (ev.clientX - r.left) / ppb, v = Math.max(0.05, Math.min(1, 1 - (ev.clientY - r.top) / r.height)); pat.notes.forEach((n, i) => { if ((S.selN.size === 0 || S.selN.has(i)) && b >= n.t - 0.06 && b <= n.t + Math.max(0.12, Math.min(n.d, 0.25))) n.v = +v.toFixed(2); }); drawGrid(); };
    vc.onpointerdown = (ev) => { vc.setPointerCapture(ev.pointerId); vg = true; setVel(ev); };
    vc.onpointermove = (ev) => { if (vg) setVel(ev); };
    vc.onpointerup = () => { if (vg) { vg = false; touch(); } };
    // ferramentas
    X.$$('[data-tool]').forEach((bt) => bt.onclick = () => { S.tool = bt.dataset.tool; X.$$('[data-tool]').forEach((z) => z.setAttribute('aria-pressed', z === bt)); });
    X.$('#eSnap').onchange = (e) => { S.snap = +e.target.value; drawGrid(); };
    X.$('#eChord').onchange = (e) => { S.chord = e.target.value; };
    const sel = () => (S.selN.size ? [...S.selN] : pat.notes.map((_, i) => i));
    X.$('#eQ').onclick = () => { const q = S.snap || 0.25; for (const i of sel()) { const n = pat.notes[i]; n.t = Math.min(pat.len - q, Math.round(n.t / q) * q); n.d = Math.max(q, Math.round(n.d / q) * q); } touch(); drawGrid(); X.toast('Notas alinhadas na grade'); };
    const transpose = (d) => { for (const i of sel()) pat.notes[i].p = Math.max(LO, Math.min(HI, pat.notes[i].p + d)); touch(); drawGrid(); };
    X.$('#eTd').onclick = () => transpose(-1); X.$('#eTu').onclick = () => transpose(1);
    const zoom = (f) => { ppb = Math.max(16, Math.min(320, ppb * f)); drawGrid(); };
    X.$('#eZi').onclick = () => zoom(1.3); X.$('#eZo').onclick = () => zoom(1 / 1.3);
    prx.addEventListener('wheel', (ev) => { if (!ev.ctrlKey) return; ev.preventDefault(); zoom(ev.deltaY < 0 ? 1.2 : 1 / 1.2); }, { passive: false });
    let clip = null;
    X.setKeys((ev) => {
      const k = ev.key, lk = k.toLowerCase(), ctrl = ev.ctrlKey || ev.metaKey;
      if (common(ev)) return;
      if (ctrl && lk === 'a') { ev.preventDefault(); S.selN = new Set(pat.notes.map((_, i) => i)); drawGrid(); info(); return; }
      if (ctrl && lk === 'c') { clip = sel().map((i) => ({ ...pat.notes[i] })); X.toast(`${clip.length} nota(s) copiadas`); return; }
      if (ctrl && lk === 'v' && clip?.length) { ev.preventDefault(); const t0 = Math.min(...clip.map((n) => n.t)), base = S.selN.size ? Math.max(...[...S.selN].map((i) => pat.notes[i].t + pat.notes[i].d)) : 0; const shift = Math.ceil((base - t0) / (S.snap || 0.25)) * (S.snap || 0.25); S.selN.clear(); for (const n of clip) { const t = n.t + shift; if (t < pat.len) { pat.notes.push({ ...n, t }); S.selN.add(pat.notes.length - 1); } } touch(); drawGrid(); info(); return; }
      if (ctrl && lk === 'd') { ev.preventDefault(); const ns = sel().map((i) => pat.notes[i]); if (!ns.length) return; const span = Math.max(...ns.map((n) => n.t + n.d)) - Math.min(...ns.map((n) => n.t)); S.selN.clear(); for (const n of ns) { const t = n.t + span; if (t < pat.len) { pat.notes.push({ ...n, t }); S.selN.add(pat.notes.length - 1); } } touch(); drawGrid(); info(); return; }
      if (k === 'Delete' || k === 'Backspace') { ev.preventDefault(); if (S.selN.size) { pat.notes = pat.notes.filter((_, i) => !S.selN.has(i)); S.selN.clear(); touch(); drawGrid(); info(); } return; }
      if (k === 'ArrowUp' || k === 'ArrowDown') { ev.preventDefault(); if (S.selN.size) transpose((k === 'ArrowUp' ? 1 : -1) * (ev.shiftKey ? 12 : 1)); return; }
      if (k === 'ArrowLeft' || k === 'ArrowRight') { ev.preventDefault(); const q = (S.snap || 0.25) * (k === 'ArrowRight' ? 1 : -1); for (const i of S.selN) pat.notes[i].t = Math.max(0, Math.min(pat.len - 0.01, pat.notes[i].t + q)); touch(); drawGrid(); return; }
      if (k === 'Escape') { S.selN.clear(); drawGrid(); info(); return; }
      if (ctrl || ev.altKey || ev.repeat) return;
      if (lk === 'z') { S.oct = Math.max(24, S.oct - 12); info(); return; }
      if (lk === 'x') { S.oct = Math.min(96, S.oct + 12); info(); return; }
      if (lk in KEYMAP) { ev.preventDefault(); const m = S.oct + KEYMAP[lk]; held_hl = m; drawKeys(); noteDown(m); }
    });
    X.setKeyUp((ev) => { const lk = ev.key.toLowerCase(); if (lk in KEYMAP) { noteUp(S.oct + KEYMAP[lk]); held_hl = -1; drawKeys(); if (S.rec) { drawGrid(); info(); } } });
    redraw();
    new ResizeObserver(() => drawGrid()).observe(prx);
  }
  function drumEditor(body, head, pat, tr) {
    const steps = Math.round(pat.len * 4);
    body.innerHTML = head + `
      <div class="prtools two">
        <label class="mini">Ritmo pronto<select id="dSty"><option value="">Escolher…</option>${Object.entries(M.DRUM_STYLE_NAMES).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
        <button id="dClr">Limpar</button>
        <div class="sliders swing">${X.sliderRow('swing', { label: 'Swing', min: 0, max: 1, step: 0.01, def: 0, unit: '' }, song.swing || 0)}</div>
        <span class="hint">Clique liga ou desliga; botão direito muda a força (fraco, normal, forte).</span>
      </div>
      <div class="seqx"><div class="seq" style="--steps:${steps}">
        ${M.PADS.map((n, pad) => `<button class="pname" data-pad="${pad}">${n}</button>${Array.from({ length: steps }, (_, s) => `<button class="stp ${s % 4 === 0 ? 'beat' : ''} ${Math.floor(s / (song.sig * 4)) % 2 ? 'alt' : ''}" data-pad="${pad}" data-s="${s}" aria-label="${n} passo ${s + 1}"></button>`).join('')}`).join('')}
      </div></div>
      <p class="hint">Teclas A a K tocam os pads na ordem (Bumbo, Caixa, Palma, Chimbal…). Com Gravar ligado, o que você tocar entra no ritmo.</p>`;
    bindEditHead(pat, tr);
    const cellNote = (pad, s) => pat.notes.findIndex((n) => n.p === pad && Math.abs(n.t * 4 - s) < 0.01);
    const paint = () => X.$$('.stp').forEach((b) => { const i = cellNote(+b.dataset.pad, +b.dataset.s); b.classList.toggle('on', i >= 0); b.style.setProperty('--v', i >= 0 ? pat.notes[i].v : 0); });
    X.$$('.stp').forEach((b) => {
      const pad = +b.dataset.pad, s = +b.dataset.s;
      b.onclick = () => { const i = cellNote(pad, s); if (i >= 0) pat.notes.splice(i, 1); else { pat.notes.push({ p: pad, t: s / 4, d: 0.25, v: 0.8 }); pl.noteOn(tr, pad, 0.8); } touch(); paint(); };
      b.oncontextmenu = (ev) => { ev.preventDefault(); const i = cellNote(pad, s); if (i < 0) { pat.notes.push({ p: pad, t: s / 4, d: 0.25, v: 1 }); } else { const v = pat.notes[i].v; pat.notes[i].v = v >= 0.95 ? 0.45 : v >= 0.7 ? 1 : 0.8; } pl.noteOn(tr, pad, pat.notes[cellNote(pad, s)].v); touch(); paint(); };
    });
    X.$$('.pname').forEach((b) => b.onclick = () => pl.noteOn(tr, +b.dataset.pad));
    X.$('#dSty').onchange = (e) => { if (!e.target.value) return; pat.notes = M.drumNotes(e.target.value, pat.len / song.sig, song.sig); touch(); paint(); X.toast('Ritmo aplicado'); e.target.value = ''; };
    X.$('#dClr').onclick = () => { pat.notes = []; touch(); paint(); };
    X.bindSliders(body, { swing: { label: 'Swing', min: 0, max: 1, step: 0.01, def: 0, unit: '' } }, () => song.swing || 0, (k, v) => { song.swing = v; }, () => touch());
    let lastStep = -1;
    viewTick = (p) => {
      const lp = p == null ? null : S.patOnly ? p % pat.len : (() => { const c = tr?.clips.find((k) => k.pat === pat.id && p >= k.start && p < k.start + k.len); return c ? (p - c.start) % pat.len : null; })();
      const st = lp == null ? -1 : Math.floor(lp * 4);
      if (st === lastStep) return;
      X.$$(`.stp[data-s="${lastStep}"]`).forEach((b) => b.classList.remove('now'));
      X.$$(`.stp[data-s="${st}"]`).forEach((b) => b.classList.add('now'));
      lastStep = st;
    };
    redrawView = paint;
    const DK = 'asdfghjk';
    X.setKeys((ev) => {
      if (common(ev)) return;
      const lk = ev.key.toLowerCase(), i = DK.indexOf(lk);
      if (i >= 0 && !ev.ctrlKey && !ev.repeat) { ev.preventDefault(); pl.noteOn(tr, i, 0.85); if (S.rec && S.patOnly) { const p = pl.pos(); if (p != null) { const s = Math.round((p % pat.len) * 4) % steps; if (cellNote(i, s) < 0) { pat.notes.push({ p: i, t: s / 4, d: 0.25, v: 0.85 }); touch(); paint(); } } } }
    });
    X.setKeyUp(null);
    paint();
  }

  // ================= MIXER =================
  function viewMixer() {
    const body = X.$('#stBody');
    const strip = (t) => `<div class="strip" data-id="${t.id}" style="--c:${t.color}">
      <b class="sname">${X.esc(t.name)}</b>
      <button class="sfx">${X.ic('fx')}Efeitos${t.fx.filter((f) => f.on).length ? ` (${t.fx.filter((f) => f.on).length})` : ''}</button>
      <input type="range" class="span" min="-1" max="1" step="0.05" value="${t.pan || 0}" aria-label="Pan">
      <div class="sfad"><canvas class="smeter"></canvas><input type="range" class="svol" min="0" max="1.2" step="0.01" value="${t.vol ?? 0.8}" aria-label="Volume"></div>
      <span class="sdb">${dbTxt(t.vol ?? 0.8)}</span>
      <div class="row"><button class="tog ${t.mute ? 'is' : ''}" data-a="mute">M</button><button class="tog ${t.solo ? 'is' : ''}" data-a="solo">S</button></div>
    </div>`;
    const dbTxt = (v) => (v > 0.001 ? `${(20 * Math.log10(v)).toFixed(1)} dB` : '-∞');
    body.innerHTML = `<div class="mixer">${song.tracks.map(strip).join('')}
      <div class="strip master" data-id="master"><b class="sname">Master</b><button class="sfx">${X.ic('fx')}Efeitos${song.master.fx.filter((f) => f.on).length ? ` (${song.master.fx.filter((f) => f.on).length})` : ''}</button><span class="hint">Limitador sempre ligado</span>
      <div class="sfad"><canvas class="smeter"></canvas><input type="range" class="svol" min="0" max="1.2" step="0.01" value="${song.master.vol}" aria-label="Volume master"></div><span class="sdb">${dbTxt(song.master.vol)}</span></div></div>
      <p class="hint">Toque a música (Espaço) para ver os medidores. Os efeitos de cada faixa tocam ao vivo e saem iguais na exportação.</p>`;
    X.$$('.strip').forEach((el) => {
      const isM = el.dataset.id === 'master', t = isM ? null : song.tracks.find((k) => k.id === el.dataset.id);
      X.$('.svol', el).oninput = (e) => { const v = +e.target.value; if (isM) song.master.vol = v; else t.vol = v; X.$('.sdb', el).textContent = dbTxt(v); touch({ mix: true }); };
      X.$('.sfx', el).onclick = () => fxSheet(isM ? song.master.fx : t.fx, isM ? 'Master' : t.name);
      if (!isM) {
        X.$('.span', el).oninput = (e) => { t.pan = +e.target.value; touch({ mix: true }); };
        X.$$('.tog', el).forEach((b) => b.onclick = () => { t[b.dataset.a] = !t[b.dataset.a]; b.classList.toggle('is', t[b.dataset.a]); touch({ mix: true }); });
        X.$('.svol', el).ondblclick = (e) => { t.vol = 0.8; e.target.value = 0.8; X.$('.sdb', el).textContent = dbTxt(0.8); touch({ mix: true }); };
      }
    });
    const meters = X.$$('.smeter');
    viewTick = () => {
      const m = pl.meters() || {};
      meters.forEach((cv) => {
        const id = cv.closest('.strip').dataset.id, v = id === 'master' ? m.master : m[id];
        const s = X.setupCanvas(cv); if (!s) return; const { x, w, h } = s;
        x.fillStyle = '#0006'; x.fillRect(0, 0, w, h);
        const db = v > 1e-5 ? 20 * Math.log10(v) : -60, f = Math.max(0, Math.min(1, (db + 60) / 60));
        const grd = x.createLinearGradient(0, h, 0, 0); grd.addColorStop(0, '#3ec46d'); grd.addColorStop(0.75, '#f2c43a'); grd.addColorStop(0.95, '#ff4b4b');
        x.fillStyle = grd; x.fillRect(0, h * (1 - f), w, h * f);
      });
    };
    viewTick();
    X.setKeys((ev) => common(ev));
  }

  // ================= EXPORTAR =================
  function viewExport() {
    const body = X.$('#stBody');
    const ex = { range: song.loop.on ? 'loop' : 'all', fix: true, fmt: 'ogg', lufs: -16, rate: 44100, mono: false, ...X.store.get('mexp', {}) };
    const saveEx = () => X.store.set('mexp', ex);
    const opt = (arr, cur) => arr.map(([v, l]) => `<option value="${v}" ${v == cur ? 'selected' : ''}>${l}</option>`).join('');
    const dur = () => { const a = ex.range === 'loop' ? song.loop.a : 0, b = ex.range === 'loop' ? song.loop.b : M.songEnd(song); return ((b - a) * 60) / song.bpm; };
    body.innerHTML = `<div class="expm">
      <section><h2>O que exportar</h2>
        <div class="seg" id="xR"><button data-r="all" aria-pressed="${ex.range === 'all'}">Música inteira</button><button data-r="loop" aria-pressed="${ex.range === 'loop'}">Região de loop (compassos ${Math.floor(song.loop.a / song.sig) + 1} a ${Math.floor(song.loop.b / song.sig)})</button></div>
        <label class="check"><input type="checkbox" id="xFix" ${ex.fix ? 'checked' : ''}> Loop perfeito para BGM</label>
        <p class="hint">Com o loop perfeito, o final do reverb e das notas longas volta para o começo do arquivo. No jogo, a música repete sem emenda nem corte. O arquivo também sai marcado como loop.</p>
        <p class="hint" id="xDur"></p>
      </section>
      <section><h2>Formato</h2>
        <div class="grid2">
          <label class="field">Formato<select id="xF">${opt([['ogg', 'OGG (recomendado para músicas)'], ['wav', 'WAV (sem perda)'], ['mp3', 'MP3']], ex.fmt)}</select></label>
          <label class="field">Taxa<select id="xRate">${opt([[44100, '44.1 kHz'], [48000, '48 kHz']], ex.rate)}</select></label>
          <label class="field">Volume padronizado<select id="xL">${opt(X.LUFS, ex.lufs)}</select></label>
          <label class="check"><input type="checkbox" id="xMono" ${ex.mono ? 'checked' : ''}> Mono</label>
        </div>
      </section>
      <section><h2>Salvar</h2>
        ${X.DESK ? `<label class="field">Subpasta no projeto Godot<input id="xSub" value="${X.esc(X.deskCfg.msub ?? 'music')}" autocomplete="off"></label>
        <p class="hint">${X.deskCfg.godot ? `Projeto: ${X.esc(X.deskCfg.godot)}` : 'Nenhum projeto Godot vinculado ainda: o botão abaixo pede a pasta.'}</p>` : ''}
        <div class="btns">
          ${X.DESK ? `<button class="primary" data-x="godot">${X.ic('export')}Salvar no projeto Godot</button><button data-x="folder">${X.ic('library')}Salvar em uma pasta…</button>` : `<button class="primary" data-x="share">${X.ic('share')}Enviar</button><button data-x="save">${X.ic('download')}Salvar no celular</button>`}
          <button data-x="lib">${X.ic('plus')}Mandar para a biblioteca de SFX</button>
          <button data-x="stems">${X.ic('mix')}Faixas separadas (stems)</button>
          <button data-x="midi">${X.ic('keyboard')}Exportar MIDI</button>
        </div>
        <p class="msg" id="xMsg" role="status"></p>
        <p class="hint">No Godot: arquivos OGG precisam do "Loop" ligado na aba Importar. Use um AudioStreamPlayer com "Autoplay" para a música da fase.</p>
      </section></div>`;
    const updDur = () => { X.$('#xDur').textContent = `Duração: ${fmtTime(dur())} (${(dur()).toFixed(2)} s) · ${song.bpm} BPM`; };
    updDur();
    X.$$('#xR button').forEach((b) => b.onclick = () => { ex.range = b.dataset.r; X.$$('#xR button').forEach((z) => z.setAttribute('aria-pressed', z === b)); saveEx(); updDur(); });
    X.$('#xFix').onchange = (e) => { ex.fix = e.target.checked; saveEx(); };
    X.$('#xF').onchange = (e) => { ex.fmt = e.target.value; saveEx(); };
    X.$('#xRate').onchange = (e) => { ex.rate = +e.target.value; saveEx(); };
    X.$('#xL').onchange = (e) => { ex.lufs = +e.target.value; saveEx(); };
    X.$('#xMono').onchange = (e) => { ex.mono = e.target.checked; saveEx(); };
    if (X.$('#xSub')) X.$('#xSub').onchange = (e) => { X.deskCfg.msub = e.target.value.trim().replace(/^res:\/\//, '').replace(/^\/+|\/+$/g, ''); e.target.value = X.deskCfg.msub; X.saveDesk(); };
    const msg = X.$('#xMsg');
    const renderOne = async (only = null) => {
      await loadRes();
      const isLoop = ex.range === 'loop';
      const a = isLoop ? song.loop.a : 0, b = isLoop ? song.loop.b : M.songEnd(song);
      let buf = await M.render(song, res, { from: a, to: b, loopFix: isLoop && ex.fix, tail: isLoop && ex.fix ? 6 : 3, only, rate: ex.rate });
      buf = await X.D.prepare(buf, { rate: ex.rate, mono: ex.mono, lufs: ex.lufs });
      return { buf, loop: isLoop && ex.fix };
    };
    const encode = async (buf, loop) => (ex.fmt === 'mp3' ? X.D.encodeMp3(buf) : ex.fmt === 'wav' ? X.D.encodeWav(buf, { loop }) : X.D.encodeOgg(buf, 0.7));
    const fname = (suffix = '') => `${X.safe(song.name)}${suffix}.${ex.fmt}`;
    X.$$('[data-x]').forEach((btn) => btn.onclick = async () => {
      const act = btn.dataset.x;
      pl.stop(); setPlayIcon();
      btn.disabled = true;
      try {
        if (act === 'midi') {
          const f = new File([M.writeMidi(song)], `${X.safe(song.name)}.mid`, { type: 'audio/midi' });
          if (X.DESK) { const d = await X.DESK.pickFolder({ title: 'Salvar o MIDI em…' }); if (d) { const p = X.DESK.join(d, f.name); await X.DESK.writeFile(p, new Uint8Array(await f.arrayBuffer())); X.DESK.showItem(p); msg.textContent = `MIDI salvo em ${d}.`; } }
          else { X.download(f); msg.textContent = 'MIDI salvo em Downloads.'; }
          return;
        }
        msg.textContent = 'Renderizando a música…';
        let files = [];
        if (act === 'stems') {
          for (const [i, t] of song.tracks.entries()) { msg.textContent = `Renderizando faixa ${i + 1} de ${song.tracks.length}…`; const { buf, loop } = await renderOne(t.id); files.push(new File([await encode(buf, loop)], fname(`_${X.safe(t.name)}`), { type: 'audio/' + ex.fmt })); }
        } else {
          const { buf, loop } = await renderOne();
          if (act === 'lib') {
            const clip = X.newClip(song.name, X.D.encodeWav(buf, { loop }));
            clip.dur = buf.duration; clip.thumb = X.thumbOf(buf); clip.tags = ['música']; clip.edits.loop = loop;
            await X.put('clips', clip); msg.textContent = `"${song.name}" foi para a biblioteca de SFX.`; return;
          }
          files = [new File([await encode(buf, loop)], fname(), { type: 'audio/' + ex.fmt })];
        }
        const dest = act === 'stems' ? (X.DESK ? 'folder' : 'share') : act;
        if (dest === 'godot') {
          if (!X.deskCfg.godot && !(await X.linkGodot(msg))) { msg.textContent = 'Nenhum projeto escolhido.'; return; }
          const r = await X.godotWrite(files, X.deskCfg.msub ?? 'music');
          msg.innerHTML = `${files.length > 1 ? files.length + ' arquivos salvos' : 'Salvo'} em <b>${X.esc(r.res)}</b>. <button class="tbtn sm" data-show>Mostrar na pasta</button>`;
          X.$('[data-show]', msg).onclick = () => X.DESK.showItem(r.paths[0]);
        } else if (dest === 'folder') {
          const d = await X.DESK.pickFolder({ title: act === 'stems' ? 'Salvar as faixas separadas em…' : 'Salvar a música em…' }); if (!d) { msg.textContent = 'Nenhuma pasta escolhida.'; return; }
          const ps = []; for (const f of files) { const p = X.DESK.join(d, f.name); await X.DESK.writeFile(p, new Uint8Array(await f.arrayBuffer())); ps.push(p); }
          X.DESK.showItem(ps[0]); msg.textContent = `${files.length > 1 ? files.length + ' arquivos salvos' : 'Salvo'} em ${d}.`;
        } else if (dest === 'save') { files.forEach(X.download); msg.textContent = 'Salvo em Downloads.'; }
        else await X.share(files, msg, 'Enviado.');
      } catch (err) { msg.textContent = 'Erro: ' + err.message; console.error(err); }
      finally { btn.disabled = false; }
    });
    X.setKeys((ev) => common(ev));
  }

  show(S.tab);
}
