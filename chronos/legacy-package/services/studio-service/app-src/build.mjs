// Builds the board editor into ../public/excalidraw (fully local: JS, CSS, fonts, locales).
// Usage (needs network once):  cd <temp>; npm i @excalidraw/excalidraw@0.18.1 react@19.1.0 react-dom@19.1.0 esbuild@0.25.5
//                              node <this file> <temp>/node_modules
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NM = path.resolve(process.argv[2] || path.join(HERE, 'node_modules'));
const OUT = path.join(HERE, '..', 'public', 'excalidraw');
const req = createRequire(path.join(NM, 'x.js'));
const esbuild = req('esbuild');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
await esbuild.build({
  entryPoints: [path.join(HERE, 'main.jsx')],
  bundle: true, splitting: true, format: 'esm', minify: true, target: 'es2022',
  outdir: OUT, entryNames: 'app', chunkNames: 'chunks/[name]-[hash]', assetNames: 'assets/[name]-[hash]',
  nodePaths: [NM], jsx: 'automatic', conditions: ['production'],
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true', 'import.meta.env.MODE': '"production"', 'import.meta.env': '{"DEV":false,"PROD":true,"MODE":"production"}' },
  loader: { '.woff2': 'file', '.ttf': 'file', '.png': 'file', '.svg': 'file' },
  legalComments: 'none', logLevel: 'warning',
});
fs.cpSync(path.join(NM, '@excalidraw', 'excalidraw', 'dist', 'prod', 'fonts'), path.join(OUT, 'fonts'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Excalidraw</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%231952C5' stroke-width='2'%3E%3Cpath d='M12 20h9'/%3E%3Cpath d='M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'/%3E%3C/svg%3E">
<link rel="stylesheet" href="/excalidraw/app.css"></head>
<body><div id="root"></div><script type="module" src="/excalidraw/app.js"></script></body></html>
`);
const size = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? size(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
console.log('built', OUT, (size(OUT) / 1048576).toFixed(1) + ' MB');
