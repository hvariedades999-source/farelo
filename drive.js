// Envio direto para uma pasta do Google Drive (Google Identity Services + Drive API v3).
// Precisa de um "ID do cliente OAuth" criado no Google Cloud pelo dono do app.
let gisP, token = null, tokenExp = 0, tokenClient = null, clientIdUsed = '';
const folderCache = {};

function loadGis() {
  return gisP || (gisP = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = () => res(window.google);
    s.onerror = () => { gisP = null; rej(new Error('Não consegui carregar o login do Google. Verifique a internet.')); };
    document.head.appendChild(s);
  }));
}
export async function getToken(clientId, interactive = true) {
  if (token && Date.now() < tokenExp - 60000 && clientId === clientIdUsed) return token;
  const google = await loadGis();
  return new Promise((res, rej) => {
    if (!tokenClient || clientId !== clientIdUsed) {
      clientIdUsed = clientId;
      tokenClient = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: 'https://www.googleapis.com/auth/drive.file', callback: () => {} });
    }
    tokenClient.callback = (r) => {
      if (r.error) { rej(new Error(r.error === 'access_denied' ? 'Acesso ao Drive negado.' : 'Login do Google falhou: ' + r.error)); return; }
      token = r.access_token; tokenExp = Date.now() + (r.expires_in || 3600) * 1000; res(token);
    };
    tokenClient.error_callback = (e) => rej(new Error(e?.type === 'popup_closed' ? 'Janela do Google fechada antes de terminar.' : 'Login do Google falhou.'));
    tokenClient.requestAccessToken({ prompt: interactive && !token ? 'consent' : '' });
  });
}
async function api(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`Drive respondeu ${r.status}. ${t.slice(0, 120)}`); }
  return r.json();
}
async function folderId(name) {
  if (folderCache[name]) return folderCache[name];
  const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`);
  if (found.files?.length) return (folderCache[name] = found.files[0].id);
  const made = await api('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }) });
  return (folderCache[name] = made.id);
}
export async function upload(files, { clientId, folder = 'SFX Studio' }, onProgress) {
  if (!clientId) throw new Error('Configure o Google Drive nas Configurações primeiro.');
  await getToken(clientId, true);
  const parent = await folderId(folder);
  for (const [i, f] of files.entries()) {
    onProgress && onProgress(i, files.length);
    const meta = new Blob([JSON.stringify({ name: f.name, parents: [parent] })], { type: 'application/json' });
    const body = new FormData();
    body.append('metadata', meta);
    body.append('file', f);
    await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', body });
  }
}
