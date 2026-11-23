// Copia o app web (pasta acima) para desktop/web, que vai dentro do programa.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(__dirname, 'web');
const files = ['index.html', 'app.js', 'dsp.js', 'icons.js', 'sfxr.js', 'procgen.js', 'drive.js', 'music.js', 'studio.js', 'style.css', 'manifest.json', 'icon.svg'];
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'vendor'), { recursive: true });
for (const f of files) fs.copyFileSync(path.join(root, f), path.join(out, f));
for (const f of fs.readdirSync(path.join(root, 'vendor'))) fs.copyFileSync(path.join(root, 'vendor', f), path.join(out, 'vendor', f));
console.log('web copiado para', out);
