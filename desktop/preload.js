// Ponte segura entre a interface e o Windows (arquivos, pastas, arrastar, atualização).
const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('farelo', {
  isDesktop: true,
  sep: path.sep,
  join: (...p) => path.join(...p),
  basename: (p) => path.basename(p),
  dirname: (p) => path.dirname(p),
  relative: (a, b) => path.relative(a, b),
  extname: (p) => path.extname(p),
  info: inv('app-info'),
  docsDir: inv('docs-dir'),
  tempDir: inv('temp-dir'),
  pickFolder: inv('pick-folder'),
  writeFile: inv('write-file'),
  readFile: inv('read-file'),
  listDir: inv('list-dir'),
  exists: inv('exists'),
  remove: inv('remove'),
  showItem: inv('show-item'),
  openPath: inv('open-path'),
  findGodotRoot: inv('find-godot-root'),
  pendingFiles: inv('pending-files'),
  checkUpdate: inv('update-check'),
  installUpdate: inv('update-install'),
  startDrag: (file) => ipcRenderer.send('start-drag', file),
  onOpenFiles: (cb) => ipcRenderer.on('open-files', (_e, files) => cb(files)),
  onUpdate: (cb) => ipcRenderer.on('update-status', (_e, s) => cb(s)),
});
