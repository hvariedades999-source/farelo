// Farelo para Windows: janela, acesso a arquivos, abrir com duplo clique e atualização automática.
const { app, BrowserWindow, protocol, net, ipcMain, dialog, shell, session, Menu, nativeImage, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const { pathToFileURL } = require('url');

const TEST_DIR = process.env.FARELO_TEST_DIR || '';
if (TEST_DIR) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
  app.setPath('userData', path.join(TEST_DIR, 'userdata'));
}
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);

const WEB = path.join(__dirname, 'web');
const ICON = path.join(__dirname, 'build', 'icon.png');
const AUDIO = /\.(wav|mp3|ogg|oga|flac|m4a|aac|webm|mp4|opus)$/i;
let win = null;
let pending = [];
const audioArgs = (argv) => argv.slice(1).filter((a) => AUDIO.test(a) && fs.existsSync(a));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const files = audioArgs(argv);
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    if (files.length) win.webContents.send('open-files', files);
  });
  pending = audioArgs(process.argv);
  app.whenReady().then(start);
}

function start() {
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    let p = decodeURIComponent(u.pathname);
    if (p === '/' || !p) p = '/index.html';
    const fp = path.normalize(path.join(WEB, p));
    if (!fp.startsWith(WEB)) return new Response('Proibido', { status: 403 });
    return net.fetch(pathToFileURL(fp).toString());
  });
  const allowed = new Set(['media', 'display-capture', 'speaker-selection', 'clipboard-sanitized-write', 'fullscreen']);
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(allowed.has(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => allowed.has(perm));
  // Som do computador: o Windows entrega o áudio de tudo o que está tocando (loopback)
  session.defaultSession.setDisplayMediaRequestHandler((_req, cb) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((srcs) => cb({ video: srcs[0], audio: 'loopback' })).catch(() => cb({}));
  });
  Menu.setApplicationMenu(null);

  win = new BrowserWindow({
    width: 1400, height: 880, minWidth: 380, minHeight: 560,
    backgroundColor: '#0f1116', title: 'Farelo', icon: ICON, show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false, spellcheck: false },
  });
  win.once('ready-to-show', () => { win.show(); if (!TEST_DIR) win.maximize(); });
  win.loadURL('app://farelo/index.html');
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/accounts\.google\.com\//.test(url)) return { action: 'allow' };
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') win.webContents.toggleDevTools();
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });
  setupUpdater();
}
app.on('window-all-closed', () => app.quit());

// ---------- arquivos ----------
ipcMain.handle('app-info', () => ({ version: app.getVersion(), packaged: app.isPackaged, test: !!TEST_DIR }));
ipcMain.handle('docs-dir', () => TEST_DIR || app.getPath('documents'));
ipcMain.handle('temp-dir', () => path.join(os.tmpdir(), 'Farelo'));
ipcMain.handle('pick-folder', async (_e, { title = 'Escolher pasta', start } = {}) => {
  if (TEST_DIR && process.env.FARELO_TEST_PICK) return process.env.FARELO_TEST_PICK;
  const r = await dialog.showOpenDialog(win, { title, defaultPath: start || undefined, properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('write-file', async (_e, file, data) => {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, typeof data === 'string' ? data : Buffer.from(data));
  return true;
});
ipcMain.handle('read-file', async (_e, file, asText) => {
  const b = await fsp.readFile(file);
  return asText ? b.toString('utf8') : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
});
ipcMain.handle('list-dir', async (_e, dir) => {
  const ents = await fsp.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const d of ents) {
    if (d.name.startsWith('.')) continue;
    let size = 0, mtime = 0;
    try { const st = await fsp.stat(path.join(dir, d.name)); size = st.size; mtime = st.mtimeMs; } catch {}
    out.push({ name: d.name, dir: d.isDirectory(), size, mtime });
  }
  return out;
});
ipcMain.handle('exists', async (_e, p) => { try { await fsp.access(p); return true; } catch { return false; } });
ipcMain.handle('remove', async (_e, p) => { await fsp.rm(p, { force: true, recursive: true }); return true; });
ipcMain.handle('show-item', (_e, p) => { shell.showItemInFolder(p); return true; });
ipcMain.handle('open-path', (_e, p) => shell.openPath(p));
ipcMain.handle('find-godot-root', async (_e, dir) => {
  let d = path.resolve(dir);
  for (let i = 0; i < 12; i++) {
    try { await fsp.access(path.join(d, 'project.godot')); return d; } catch {}
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
});
ipcMain.handle('pending-files', () => { const p = pending; pending = []; return p; });
let dragIcon = null;
ipcMain.on('start-drag', (e, file) => {
  try {
    if (!dragIcon) { dragIcon = nativeImage.createFromPath(path.join(__dirname, 'build', 'drag.png')); if (dragIcon.isEmpty()) dragIcon = nativeImage.createFromPath(ICON).resize({ width: 48 }); }
    e.sender.startDrag({ file, icon: dragIcon });
  } catch {}
});

// ---------- atualização automática ----------
function setupUpdater() {
  const send = (s, extra = {}) => win && !win.isDestroyed() && win.webContents.send('update-status', { s, ...extra });
  let au = null;
  if (app.isPackaged && !TEST_DIR) { try { au = require('electron-updater').autoUpdater; } catch { au = null; } }
  if (!au) {
    ipcMain.handle('update-check', () => send('dev'));
    ipcMain.handle('update-install', () => false);
    return;
  }
  au.autoDownload = true;
  au.autoInstallOnAppQuit = true;
  au.on('checking-for-update', () => send('checking'));
  au.on('update-available', (i) => send('available', { v: i.version }));
  au.on('update-not-available', () => send('none'));
  au.on('download-progress', (p) => send('progress', { p: Math.round(p.percent) }));
  au.on('update-downloaded', (i) => send('ready', { v: i.version }));
  au.on('error', (err) => send('error', { m: String((err && err.message) || err).slice(0, 200) }));
  ipcMain.handle('update-check', () => au.checkForUpdates().catch((err) => send('error', { m: String(err.message || err) })));
  ipcMain.handle('update-install', () => { au.quitAndInstall(false, true); return true; });
  setTimeout(() => au.checkForUpdates().catch(() => {}), 5000);
}
