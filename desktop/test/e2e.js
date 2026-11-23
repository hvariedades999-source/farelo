// Teste de ponta a ponta do programa instalado no Windows (roda no GitHub Actions).
const { _electron } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const os = require('os');

const OUT = path.join(__dirname, '..', 'test-results');
fs.mkdirSync(OUT, { recursive: true });
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'farelo-'));
const GODOT = path.join(T, 'jogo');
fs.mkdirSync(GODOT, { recursive: true });
fs.writeFileSync(path.join(GODOT, 'project.godot'), '[application]\nconfig/name="Teste"\n');
const LIB = path.join(T, 'Farelo');
const results = [];
const errors = [];
let shot = 0;

async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log('OK  ', name); }
  catch (e) { results.push({ name, ok: false, ms: Date.now() - t0, error: String(e && e.stack || e).slice(0, 600) }); console.log('FALHA', name, e && e.message); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const files = (dir, re) => { try { return fs.readdirSync(dir).filter((f) => !re || re.test(f)); } catch { return []; } };

(async () => {
  const exe = process.env.FARELO_EXE;
  const env = { ...process.env, FARELO_TEST_DIR: T, FARELO_TEST_PICK: GODOT };
  const app = await _electron.launch(exe ? { executablePath: exe, env, timeout: 60000 } : { args: [path.join(__dirname, '..')], env, timeout: 60000 });
  const win = await app.firstWindow();
  win.setDefaultTimeout(20000);
  win.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const snap = async (name) => { await win.screenshot({ path: path.join(OUT, `${String(++shot).padStart(2, '0')}-${name}.png`) }); };
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1440, 900); w.center(); });
  await win.waitForSelector('.tabs button', { timeout: 30000 });
  await sleep(800);

  await step('abre e mostra o tutorial', async () => { await win.click('#tSkip', { timeout: 8000 }); await snap('biblioteca-vazia'); });
  await step('é o programa de Windows', async () => {
    const isDesk = await win.evaluate(() => !!window.farelo && document.documentElement.classList.contains('desktop'));
    if (!isDesk) throw new Error('ponte do Windows ausente');
    const n = await win.locator('.tabs [data-t]').count();
    if (n !== 4) throw new Error('esperava 4 abas, veio ' + n);
    if (await win.locator('.areasw button').count() !== 2) throw new Error('sem a troca SFX / Música');
  });
  await step('gera e salva sons retrô', async () => {
    await win.click('.tabs [data-t=gen]');
    for (const k of ['laser', 'coin', 'jump']) { await win.click(`.kind[data-k=${k}]`); await sleep(300); await win.click('#gSave'); await sleep(700); }
    await snap('gerador');
  });
  await step('biblioteca salva como arquivos no disco', async () => {
    await sleep(800);
    const js = files(path.join(LIB, 'sons'), /\.json$/), wav = files(path.join(LIB, 'sons'), /\.wav$/);
    if (js.length < 3 || wav.length < 3) throw new Error(`json=${js.length} wav=${wav.length} em ${LIB}`);
  });
  await step('ambiente, interface, passos e sintetizador geram som', async () => {
    for (const m of ['amb', 'ui', 'steps']) { await win.click(`.gmodes [data-g=${m}]`); await sleep(600); await win.locator('.kind').nth(1).click(); await sleep(1500); const t = await win.locator('#gInfo').innerText(); if (!/pico/.test(t)) throw new Error(m + ': ' + t); }
    await win.click('.gmodes [data-g=syn]'); await sleep(400); await snap('sintetizador');
  });
  await step('grava com microfone (simulado)', async () => {
    await win.keyboard.press('F1'); await sleep(500);
    await win.keyboard.press('r'); await sleep(400);
    await win.uncheck('#rcd'); await win.click('#rb'); await sleep(2500); await win.click('#rb');
    await win.waitForSelector('.ed', { timeout: 15000 }); await sleep(800);
    await snap('editor-largo');
  });
  await step('grava o som do computador', async () => {
    await win.keyboard.press('Backspace'); await sleep(500);
    if (!(await win.locator('#btnSys').count())) throw new Error('botão "Gravar som do PC" ausente');
    await win.click('#btnSys'); await sleep(400);
    await win.uncheck('#rcd'); await win.click('#rb'); await sleep(1500);
    const recording = await win.evaluate(() => !!document.querySelector('.ovl.on'));
    if (recording) { await win.click('#rb'); await win.waitForSelector('.ed', { timeout: 15000 }); results.push({ name: 'captura do PC: gravou', ok: true, ms: 0 }); }
    else { const m = await win.locator('#rm').innerText(); results.push({ name: 'captura do PC: sem áudio no Windows de teste (' + m.slice(0, 120) + ')', ok: true, ms: 0 }); await win.click('#rc'); }
    await snap('captura-pc');
    if (!(await win.locator('.ed').count())) { await win.keyboard.press('F1'); await sleep(300); await win.locator('.list .open').first().click(); await win.waitForSelector('.ed'); }
  });
  await step('atalhos do editor', async () => {
    await win.keyboard.press('2'); await win.keyboard.press('Control+a'); await sleep(200);
    const info = await win.locator('#info').innerText(); if (!/Seleção/.test(info)) throw new Error(info);
    await win.keyboard.press('Escape'); await win.keyboard.press('1');
    await win.keyboard.press(' '); await sleep(600); await win.keyboard.press(' ');
    await win.keyboard.press('m'); await sleep(300); await win.keyboard.press('Enter'); await sleep(300);
  });
  await step('efeito com gaveta lateral', async () => {
    await win.click('.edtabs [data-p=fx]'); await win.click('.addfx'); await sleep(300); await win.click('.fxtile[data-t=room]'); await sleep(500);
    await snap('gaveta-efeito'); await win.keyboard.press('Escape'); await sleep(300);
  });
  await step('salva no projeto Godot (Ctrl+S)', async () => {
    await win.keyboard.press('Control+s'); await sleep(2500);
    const w = files(path.join(GODOT, 'sfx'), /\.wav$/);
    if (!w.length) throw new Error('nenhum wav em ' + path.join(GODOT, 'sfx') + ' msg=' + await win.locator('#eexp .msg').innerText());
    const head = fs.readFileSync(path.join(GODOT, 'sfx', w[0])).subarray(0, 4).toString();
    if (head !== 'RIFF') throw new Error('arquivo não é WAV');
    await snap('exportado-godot');
  });
  await step('reexporta depois de mudar', async () => {
    const f = path.join(GODOT, 'sfx', files(path.join(GODOT, 'sfx'), /\.wav$/)[0]);
    const before = fs.readFileSync(f);
    await win.click('.edtabs [data-p=edit]'); await win.check('#rev'); await sleep(600);
    await win.click('.edtabs [data-p=export]'); await sleep(300); await win.click('#reexp'); await sleep(1500);
    if (Buffer.compare(before, fs.readFileSync(f)) === 0) throw new Error('arquivo não mudou');
  });
  await step('pacote Godot .tres em lote', async () => {
    await win.keyboard.press('Backspace'); await sleep(600);
    await win.keyboard.press('Control+a'); await sleep(500);
    await win.fill('#base', 'pacote'); await win.check('#bexp .gd'); await win.click('#bexp [data-act=godot]'); await sleep(3500);
    const t = files(path.join(GODOT, 'sfx'), /\.tres$/);
    if (!t.length) throw new Error('sem .tres');
    const txt = fs.readFileSync(path.join(GODOT, 'sfx', t[0]), 'utf8');
    if (!/res:\/\/sfx\/pacote_01\.wav/.test(txt)) throw new Error(txt.slice(0, 200));
    await snap('biblioteca-lote');
  });
  await step('navegador de arquivos', async () => {
    await win.keyboard.press('F4'); await sleep(300); await win.click('#bPick'); await sleep(600);
    await win.locator('#flist li').first().dblclick(); await sleep(700);
    const n = await win.locator('#flist li').count(); if (n < 3) throw new Error('itens=' + n);
    await win.locator('#flist li').first().click(); await sleep(900);
    const info = await win.locator('#bInfo').innerText(); if (!/Hz/.test(info)) throw new Error(info);
    await snap('arquivos');
  });
  await step('abrir arquivo pelo Windows (duplo clique)', async () => {
    const f = path.join(GODOT, 'sfx', files(path.join(GODOT, 'sfx'), /\.wav$/)[0]);
    await app.evaluate(({ BrowserWindow }, p) => BrowserWindow.getAllWindows()[0].webContents.send('open-files', [p]), f);
    await win.waitForSelector('.ed', { timeout: 10000 });
  });
  await step('mixagem com camadas', async () => {
    await win.keyboard.press('Backspace'); await sleep(300); await win.keyboard.press('F3'); await sleep(300);
    await win.click('#newMix'); await sleep(700); await win.click('#addT'); await sleep(400); await win.click('#addT'); await sleep(400);
    await win.click('#mp'); await sleep(1200);
    const t = await win.locator('#mInfo').innerText(); if (!/pico/.test(t)) throw new Error(t);
    await snap('mixagem');
  });

  // ---------- Estúdio de Música ----------
  await step('música: área separada e modelo', async () => {
    await win.keyboard.press('Backspace'); await sleep(400);
    await win.click('.areasw [data-a=music]'); await sleep(500);
    if (await win.locator('.tabs [data-t]').count() !== 1) throw new Error('área Música deveria ter só a aba Músicas');
    await snap('musica-lista');
    await win.click('.tpl[data-k=adventure]'); await win.waitForSelector('.st #aCv'); await sleep(800);
    const n = await win.locator('.ah').count(); if (n < 4) throw new Error('faixas do modelo: ' + n);
    await snap('musica-arranjo');
  });
  await step('música: toca e o relógio anda', async () => {
    await win.click('#sPlay'); await sleep(1800);
    const t = await win.locator('#sClock').innerText(); await win.click('.sttabs [data-t=mixer]'); await sleep(900); await snap('musica-mixer');
    await win.keyboard.press(' '); await sleep(200);
    if (/^1\.1 /.test(t)) throw new Error('relógio parado: ' + t);
  });
  await step('música: piano roll e teclado do PC', async () => {
    await win.click('.sttabs [data-t=arr]'); await sleep(300);
    const bb = await win.locator('#aCv').boundingBox();
    await win.mouse.dblclick(bb.x + 140, bb.y + 30 + 30); await sleep(700);
    if (!(await win.locator('#prG').count())) throw new Error('piano roll não abriu');
    const before = await win.locator('#eInfo').innerText();
    const g = await win.locator('#prG').boundingBox(), y = await win.locator('#pry').boundingBox();
    await win.mouse.click(g.x + 20, y.y + 40); await sleep(300);
    const after = await win.locator('#eInfo').innerText();
    if (parseInt(after) !== parseInt(before) + 1) throw new Error(before + ' -> ' + after);
    await win.keyboard.down('a'); await sleep(150); await win.keyboard.up('a');
    await win.click('#ePlay'); await sleep(1000); await snap('musica-piano-roll'); await win.click('#ePlay');
  });
  await step('música: bateria por passos', async () => {
    await win.click('.sttabs [data-t=arr]'); await sleep(300);
    const n = await win.locator('.ah').count(), bb = await win.locator('#aCv').boundingBox();
    await win.mouse.dblclick(bb.x + 600, bb.y + 30 + 64 * (n - 1) + 30); await sleep(700);
    if (!(await win.locator('.stp').count())) throw new Error('sequenciador não abriu');
    const on0 = await win.locator('.stp.on').count();
    await win.click('.stp[data-pad="2"][data-s="6"]'); await sleep(200);
    if (await win.locator('.stp.on').count() === on0) throw new Error('passo não ligou');
    await snap('musica-bateria');
  });
  await step('música: assistente de acordes', async () => {
    await win.click('.sttabs [data-t=arr]'); await sleep(300);
    const n = await win.locator('.ah').count();
    await win.click('#aAsst'); await sleep(400); await win.check('#asDr'); await win.click('#asGo'); await sleep(600);
    if (await win.locator('.ah').count() <= n) throw new Error('nenhuma faixa criada');
  });
  await step('música: exporta em loop para o Godot', async () => {
    await win.click('.sttabs [data-t=exp]'); await sleep(300);
    await win.selectOption('#xF', 'wav'); await win.click('[data-x=godot]');
    await win.waitForFunction(() => /Salvo|Erro/.test(document.querySelector('#xMsg').textContent), null, { timeout: 90000 });
    const m = await win.locator('#xMsg').innerText(); if (/Erro/.test(m)) throw new Error(m);
    const w = files(path.join(GODOT, 'music'), /\.wav$/); if (!w.length) throw new Error('nenhum wav em music/');
    const buf = fs.readFileSync(path.join(GODOT, 'music', w[0]));
    if (!buf.includes(Buffer.from('smpl'))) throw new Error('WAV sem marcação de loop');
    await win.selectOption('#xF', 'ogg'); await win.click('[data-x=godot]');
    await win.waitForFunction(() => !document.querySelector('[data-x=godot]').disabled && /Salvo|Erro/.test(document.querySelector('#xMsg').textContent), null, { timeout: 90000 });
    if (!files(path.join(GODOT, 'music'), /\.ogg$/).length) throw new Error('nenhum ogg');
    await snap('musica-exportar');
  });
  await step('música: salva no disco e volta', async () => {
    await sleep(800);
    if (!files(path.join(LIB, 'musicas'), /\.json$/).length) throw new Error('música não foi para Documentos/Farelo/musicas');
    await win.click('#sBack'); await sleep(400); await win.click('.areasw [data-a=sfx]'); await sleep(400);
  });
  await step('configurações e atalhos', async () => {
    await win.keyboard.press('F1'); await sleep(300); await win.click('#setBtn'); await sleep(600); await snap('configuracoes'); await win.keyboard.press('Escape');
    await win.keyboard.press('?'); await sleep(300); await snap('atalhos'); await win.keyboard.press('Escape');
  });
  await step('tema claro', async () => {
    await win.click('#setBtn'); await win.selectOption('#stTheme', 'light'); await sleep(600); await snap('tema-claro');
    await win.click('#setBtn'); await win.selectOption('#stTheme', 'dark'); await sleep(300); await win.keyboard.press('Escape');
  });
  await step('janela estreita', async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(420, 860));
    await sleep(800); await snap('janela-estreita');
  });
  await step('biblioteca volta depois de reabrir', async () => {
    await app.close();
    const app2 = await _electron.launch(exe ? { executablePath: exe, env, timeout: 60000 } : { args: [path.join(__dirname, '..')], env, timeout: 60000 });
    const w2 = await app2.firstWindow();
    await w2.waitForSelector('.list li', { timeout: 30000 });
    const n = await w2.locator('.list li').count();
    await w2.screenshot({ path: path.join(OUT, `${String(++shot).padStart(2, '0')}-reaberto.png`) });
    await app2.close();
    if (n < 4) throw new Error('sons depois de reabrir: ' + n);
  });

  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(OUT, 'resultados.json'), JSON.stringify({ results, errors, failed: failed.length }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} passos ok; ${errors.length} erro(s) no console`);
  for (const e of errors.slice(0, 20)) console.log('  ', e);
  try { await app.close(); } catch {}
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('ERRO GERAL', e);
  fs.writeFileSync(path.join(OUT, 'resultados.json'), JSON.stringify({ results, errors, fatal: String(e && e.stack || e) }, null, 2));
  process.exit(1);
});
