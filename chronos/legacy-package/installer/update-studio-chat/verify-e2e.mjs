// E2E: board page (#send=1) -> studio service -> T3 composer (real T3 UI, headless Edge, read-only pairing).
// The new T3-side handler is injected from src/60-studio.js (section 3b), since the installed archive still has the old one.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const T3 = path.join(os.homedir(), '.t3', 'bin', 't3.cmd');
const SRC = 'C:\\Users\\zulut\\.t3\\caches\\t3-customizations\\olympus-v3\\src\\60-studio.js';
const SVC = 'http://127.0.0.1:4520';
const PORT = 9341;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t3 = (...a) => execFileSync('cmd.exe', ['/d', '/s', '/c', T3, ...a], { encoding: 'utf8', timeout: 60000, windowsHide: true });
const H = { 'x-oly': '1', 'content-type': 'application/json' };
const res = { checks: {} };
let edge, profile, board;

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0; const wait = new Map();
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; wait.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result?.result?.value; };
  return { send, evaluate };
}
const newTab = async (url) => { const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json(); const p = await cdp(t.webSocketDebuggerUrl); await p.send('Runtime.enable'); return p; };

try {
  // test board
  const created = await (await fetch(SVC + '/api/board/create', { method: 'POST', headers: H, body: JSON.stringify({ dir: 'C:\\Users\\zulut\\.t3\\caches\\t3-customizations\\studio-service\\data\\boards', name: 'oly-e2e-send',
    content: { type: 'excalidraw', version: 2, elements: [{ type: 'rectangle', id: 'a', x: 0, y: 0, width: 220, height: 90, backgroundColor: '#a5d8ff', fillStyle: 'solid', label: { text: 'API' } }, { type: 'ellipse', id: 'b', x: 360, y: 0, width: 200, height: 90, label: { text: 'DB' } }, { type: 'arrow', x: 220, y: 45, width: 140, height: 0, start: { id: 'a' }, end: { id: 'b' } }], appState: { viewBackgroundColor: '#ffffff' }, files: {} } }) })).json();
  board = created.path; res.board = board;
  if (!board) throw new Error('board create failed: ' + JSON.stringify(created));

  const pair = JSON.parse(t3('auth', 'pairing', 'create', '--scope', 'orchestration:read', '--ttl', '5m', '--label', 'olympus-e2e-board-chat', '--base-url', 'http://127.0.0.1:3773', '--json'));
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'oly-e2e-'));
  edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, '--window-size=1400,900', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  let target;
  for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {} }
  const app = await cdp(target.webSocketDebuggerUrl);
  await app.send('Page.enable'); await app.send('Runtime.enable');
  await app.send('Page.navigate', { url: pair.pairUrl });
  let ready = false;
  for (let i = 0; i < 90 && !ready; i++) { await sleep(500); ready = await app.evaluate(`!!document.querySelector('[data-slot=composer-host] .composer-tiptap')`); }
  res.checks.composer = ready;
  if (!ready) throw new Error('composer not rendered');
  await sleep(2500);

  // inject the new handler (section 3b of src/60-studio.js) + its own bridge subscription
  const src = fs.readFileSync(SRC, 'utf8');
  const sec = src.slice(src.indexOf('/* ---- 3b.'), src.indexOf('S.attachBoard=attachBoard;'));
  await app.evaluate("localStorage.setItem('oly-studio-client','e2e')");
  res.mode = (await app.evaluate('!!(globalThis.__olyStudio&&globalThis.__olyStudio.attachBoard)')) ? 'installed' : 'injected';
  if (res.mode === 'injected')
  await app.evaluate(`(()=>{const SVC='${SVC}';const report=e=>{window.__e2eErr=String(e&&e.message||e)};const toast=(m,err)=>{window.__e2eToast=(err?'ERR ':'')+m};
${sec}
const es=new EventSource(SVC+'/api/bridge');es.addEventListener('chat',ev=>{const m=JSON.parse(ev.data);if(m.to!=='e2e')return;attachBoard(m).catch(report)});window.__e2eEs=es;return true})()`);
  await sleep(800);

  // board page with #send=1 (exercises Excalidraw export + POST /api/chat/send)
  const bp = await newTab(SVC + '/board?path=' + encodeURIComponent(board) + '#olympus=1&send=1&to=e2e');
  let st = null;
  for (let i = 0; i < 60; i++) { await sleep(300); st = await bp.evaluate(`document.querySelector('.oly-status')?.textContent||null`); if (st && /отправлен|Не отправлено/i.test(st)) break; }
  res.checks.boardStatus = st;
  res.checks.boardHashCleaned = !(await bp.evaluate('location.hash')).includes('send=1');
  res.checks.sendButton = await bp.evaluate(`!!document.querySelector('.oly-send')`);

  await sleep(1500);
  Object.assign(res.checks, await app.evaluate(`(()=>{const host=document.querySelector('[data-slot=composer-host]');const ed=host.querySelector('.composer-tiptap');
    let box=host;for(let i=0;i<4&&box.parentElement;i++)box=box.parentElement;
    const imgs=[...box.querySelectorAll('img')].filter(i=>/^blob:|^data:image/.test(i.src)).map(i=>({alt:i.alt,w:i.naturalWidth,h:i.naturalHeight}));
    return {composerText:ed.textContent.slice(0,300),images:imgs,toast:window.__e2eToast||document.querySelector('.oly-studio-toast')?.textContent||null,err:window.__e2eErr||null}})()`));
  const shot = await app.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SCR, 'e2e-composer.png'), Buffer.from(shot.result.data, 'base64'));
  const bshot = await bp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SCR, 'e2e-board.png'), Buffer.from(bshot.result.data, 'base64'));
  res.ok = /отправлена/.test(res.checks.boardStatus || '') && res.checks.composerText.includes('oly-e2e-send') && res.checks.images.length > 0;
} catch (e) { res.error = String(e && e.stack || e); }
finally {
  try { edge && edge.kill(); } catch {}
  try { const j = JSON.parse(t3('auth', 'session', 'list', '--json')); const list = Array.isArray(j) ? j : j.sessions || []; for (const s of list.filter((s) => s.client?.label === 'olympus-e2e-board-chat' && s.subject === 'one-time-token')) { t3('auth', 'session', 'revoke', s.sessionId); res.revoked = (res.revoked || 0) + 1; } } catch (e) { res.revokeErr = String(e.message).slice(0, 200); }
  await sleep(800);
  try { profile && fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  if (board) { try { fs.rmSync(board, { force: true }); } catch {} }
  console.log(JSON.stringify(res, null, 1));
}
