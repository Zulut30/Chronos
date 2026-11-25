// T3 Studio — local service (127.0.0.1:4520, no dependencies).
// Excalidraw boards stored as .excalidraw JSON files (project/.excalidraw or the server folder),
import { resolveServicePath, t3Home, serviceDir } from '../paths.mjs';
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.OLY_STUDIO_PORT || 4520);
const HOST = '127.0.0.1';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(HERE, 'public');
const DATA = process.env.OLY_STUDIO_DATA || path.join(serviceDir('studio-service'), 'data');
const SERVER_BOARDS = path.join(DATA, 'boards');
const STATE_FILE = path.join(DATA, 'state.json');
const T3_HOME = t3Home;
const T3_DB = path.join(T3_HOME, 'userdata', 'statev2.sqlite');
const IS_WIN = process.platform === 'win32';
const ALLOWED_ORIGINS = new Set(['t3code://app', 'http://localhost:3773', 'http://127.0.0.1:3773', `http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
const BOARD_EXT = '.excalidraw';
const NAME_RE = /^[^<>:"/\\|?*\x00-\x1f]{1,100}$/;

fs.mkdirSync(SERVER_BOARDS, { recursive: true });

// ---------- state ----------
let state = { recent: [], customDirs: [] };
try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch {}
let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, STATE_FILE);
  }, 150);
}
let context = { threadId: null, cwd: null, at: 0 };

// ---------- helpers ----------
const norm = (p) => resolveServicePath(String(p || ''));
const same = (a, b) => (IS_WIN ? a.toLowerCase() === b.toLowerCase() : a === b);
const inside = (child, parent) => { const r = path.relative(parent, child); return r === '' || (!!r && !r.startsWith('..') && !path.isAbsolute(r)); };
function badReq(msg) { const e = new Error(msg); e.status = 400; return e; }
function boardPath(p) {
  if (!p || typeof p !== 'string' || !path.isAbsolute(p)) throw badReq('Нужен абсолютный путь к доске');
  const f = norm(p);
  if (!f.toLowerCase().endsWith(BOARD_EXT)) throw badReq('Доска должна иметь расширение .excalidraw');
  return f;
}
function dirPath(p) {
  if (!p || typeof p !== 'string' || !path.isAbsolute(p)) throw badReq('Нужен абсолютный путь к папке');
  return norm(p);
}
function cleanName(n) {
  const s = String(n || '').trim().replace(/\.excalidraw$/i, '').trim();
  if (!NAME_RE.test(s) || /^\.+$/.test(s)) throw badReq('Недопустимое имя доски');
  return s;
}
const boardName = (f) => path.basename(f).replace(/\.excalidraw$/i, '');

function t3Projects() {
  try {
    const db = new DatabaseSync(T3_DB, { readOnly: true });
    try {
      const rows = db.prepare('select title, workspace_root from projection_projects where deleted_at is null and archived_at is null').all();
      // T3's "No project" lives in ~/.t3/scratch — boards of such threads go to the studio folder instead
      return rows.filter((r) => r.workspace_root && fs.existsSync(r.workspace_root) && !inside(norm(r.workspace_root), T3_HOME))
        .map((r) => ({ title: r.title, root: norm(r.workspace_root) }));
    } finally { db.close(); }
  } catch { return []; }
}

// Map a thread cwd (project root, subfolder or git worktree) to a T3 project.
function resolveProject(cwd) {
  if (!cwd || !path.isAbsolute(cwd)) return null;
  const c = norm(cwd);
  const projects = t3Projects().sort((a, b) => b.root.length - a.root.length);
  let hit = projects.find((p) => same(c, p.root));
  if (hit) return hit;
  try { // git worktree: <cwd>/.git is a file "gitdir: <main>/.git/worktrees/<name>"
    const g = fs.readFileSync(path.join(c, '.git'), 'utf8');
    const m = /gitdir:\s*(.+)/.exec(g);
    if (m) {
      const main = norm(resolveServicePath(c, m[1].trim(), '..', '..', '..'));
      hit = projects.find((p) => same(p.root, main));
      if (hit) return hit;
    }
  } catch {}
  // a subfolder of a project — but never T3's own folders (~/.t3/scratch is the cwd of "No project" threads)
  if (inside(c, T3_HOME)) return null;
  return projects.find((p) => inside(c, p.root)) || null;
}
function locationsFor(cwd) {
  const projects = t3Projects().sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  const cur = resolveProject(cwd);
  const list = [];
  for (const p of projects) list.push({ id: 'p:' + p.root, kind: 'project', title: p.title, root: p.root, dir: path.join(p.root, '.excalidraw'), current: !!cur && same(cur.root, p.root) });
  list.push({ id: 'server', kind: 'server', title: 'Папка студии', root: DATA, dir: SERVER_BOARDS, current: !cur });
  for (const d of state.customDirs || []) if (fs.existsSync(d)) list.push({ id: 'd:' + d, kind: 'custom', title: path.basename(d) || d, root: d, dir: d, current: false });
  return list;
}

async function listBoards(dir) {
  let names = [];
  try { names = await fsp.readdir(dir); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!n.toLowerCase().endsWith(BOARD_EXT)) continue;
    const f = path.join(dir, n);
    try { const st = await fsp.stat(f); if (st.isFile()) out.push({ name: boardName(f), path: f, dir, mtime: st.mtimeMs, size: st.size }); } catch {}
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}
function emptyBoard() {
  return JSON.stringify({ type: 'excalidraw', version: 2, source: 'oly-studio', elements: [], appState: { viewBackgroundColor: '#ffffff', gridSize: 20 }, files: {} }, null, 2);
}
async function writeAtomic(f, text) {
  await fsp.mkdir(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp-' + crypto.randomBytes(4).toString('hex');
  await fsp.writeFile(tmp, text);
  try { await fsp.rename(tmp, f); } catch (e) { await fsp.rm(tmp, { force: true }); await fsp.writeFile(f, text); }
  return (await fsp.stat(f)).mtimeMs;
}
function touchRecent(f) {
  state.recent = [{ path: f, name: boardName(f), dir: path.dirname(f), openedAt: Date.now() }, ...state.recent.filter((r) => !same(r.path, f))].slice(0, 30);
  saveState();
}

// ---------- SSE ----------
const bridgeClients = new Set(); // T3 windows
const watchers = new Map(); // dir -> {w, subs:Set<{res,file}>, last:Map}
function sse(res, req) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', ...cors(req) });
  res.write('retry: 4000\n\n');
  const ka = setInterval(() => res.write(': ka\n\n'), 25000);
  res.on('close', () => clearInterval(ka));
}
const send = (res, ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
function watchBoard(res, file) {
  const dir = path.dirname(file);
  let w = watchers.get(dir);
  if (!w) {
    w = { subs: new Set(), timers: new Map() };
    try {
      w.w = fs.watch(dir, (ev, name) => {
        if (!name) return;
        const f = path.join(dir, String(name));
        clearTimeout(w.timers.get(f));
        w.timers.set(f, setTimeout(async () => {
          let mtime = 0; try { mtime = (await fsp.stat(f)).mtimeMs; } catch {}
          for (const s of w.subs) if (same(s.file, f)) send(s.res, 'change', { mtime, exists: mtime > 0 });
        }, 120));
      });
      w.w.on('error', () => {});
    } catch {}
    watchers.set(dir, w);
  }
  const sub = { res, file };
  w.subs.add(sub);
  res.on('close', () => { w.subs.delete(sub); if (!w.subs.size) { try { w.w && w.w.close(); } catch {} watchers.delete(dir); } });
}
function openInT3(payload) {
  const msg = { id: crypto.randomUUID(), ...payload };
  for (const c of bridgeClients) send(c, 'open', msg);
  return bridgeClients.size;
}
// "Send board to chat": the board page posts a PNG snapshot; T3 windows fetch it and attach it to the composer.
const chatShots = new Map(); // id -> {buf, ts}
function sendToChat(payload, png) {
  const id = crypto.randomUUID();
  const now = Date.now();
  for (const [k, v] of chatShots) if (now - v.ts > 10 * 60 * 1000) chatShots.delete(k);
  if (png) chatShots.set(id, { buf: png, ts: now });
  const msg = { id, ...payload, png: png ? `/api/chat/png?id=${id}` : null };
  for (const c of bridgeClients) send(c, 'chat', msg);
  return bridgeClients.size;
}

// ---------- HTTP ----------
function cors(req) {
  const o = req.headers.origin;
  return o && ALLOWED_ORIGINS.has(o) ? { 'Access-Control-Allow-Origin': o, Vary: 'Origin' } : {};
}
function json(res, req, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(req) });
  res.end(JSON.stringify(obj));
}
async function body(req, limit = 64 * 1024 * 1024) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw badReq('Слишком большой запрос'); chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.map': 'application/json' };
async function serveStatic(req, res, rel) {
  const f = path.join(PUB, rel);
  if (!inside(f, PUB)) { res.writeHead(403); return res.end(); }
  try {
    const st = await fsp.stat(f);
    if (!st.isFile()) throw new Error();
    const ext = path.extname(f).toLowerCase();
    const immutable = /\/excalidraw\/(fonts|chunks)\//.test(rel.replace(/\\/g, '/'));
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache', 'Content-Length': st.size, ...cors(req) });
    fs.createReadStream(f).pipe(res);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Не найдено'); }
}

const server = http.createServer(async (req, res) => {
  try {
    const host = String(req.headers.host || '');
    if (!new RegExp(`^(127\\.0\\.0\\.1|localhost):${PORT}$`).test(host)) { res.writeHead(421); return res.end('bad host'); }
    const u = new URL(req.url, `http://${host}`);
    const p = u.pathname;
    const q = (k) => u.searchParams.get(k);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors(req), 'Access-Control-Allow-Methods': 'GET,POST,PUT', 'Access-Control-Allow-Headers': 'content-type,x-oly', 'Access-Control-Max-Age': '600' });
      return res.end();
    }
    const mutating = req.method !== 'GET' && req.method !== 'HEAD';
    if (mutating && req.headers['x-oly'] !== '1') return json(res, req, 403, { error: 'Нужен заголовок x-oly: 1' });
    const B = async () => { const t = await body(req); return t ? JSON.parse(t) : {}; };

    // chronos: gallery actions share the artifact store with Studio MCP.
    if (p.startsWith('/api/artifacts/')) {
      if (req.method !== 'POST' || req.headers.origin !== 'http://' + host)
        return json(res, req, 403, {error:'Откройте галерею в Студии'});
      const { galleryRequest } = await import('../artifacts/gallery.mjs');
      return json(res, req, 200, await galleryRequest(p.slice('/api/artifacts/'.length), await B()));
    }
    if (!p.startsWith('/api/')) {
      if (p === '/' || p === '/index.html') return serveStatic(req, res, 'index.html');
      if (p === '/board') return serveStatic(req, res, 'excalidraw/index.html');
      return serveStatic(req, res, decodeURIComponent(p.slice(1)));
    }

    if (p === '/api/health') return json(res, req, 200, { ok: true, service: 't3-studio', port: PORT, bridge: bridgeClients.size });
    if (p === '/api/context' && req.method === 'GET') {
      const proj = resolveProject(context.cwd);
      return json(res, req, 200, { ...context, project: proj, boardsDir: proj ? path.join(proj.root, '.excalidraw') : SERVER_BOARDS });
    }
    if (p === '/api/context' && req.method === 'POST') {
      const b = await B();
      context = { threadId: typeof b.threadId === 'string' ? b.threadId : null, cwd: typeof b.cwd === 'string' ? b.cwd : null, title: typeof b.title === 'string' ? b.title.slice(0, 200) : null, at: Date.now() };
      return json(res, req, 200, { ok: true });
    }
    if (p === '/api/locations') return json(res, req, 200, { locations: locationsFor(q('cwd') || context.cwd) });
    if (p === '/api/boards') {
      if (q('dir')) return json(res, req, 200, { boards: await listBoards(dirPath(q('dir'))) });
      const all = [];
      for (const l of locationsFor(q('cwd') || context.cwd)) for (const b of await listBoards(l.dir)) all.push({ ...b, location: l.title, kind: l.kind, current: l.current });
      return json(res, req, 200, { boards: all });
    }
    if (p === '/api/recent') {
      if (req.method === 'POST') { const b = await B(); const f = boardPath(b.path); if (fs.existsSync(f)) touchRecent(f); return json(res, req, 200, { ok: true }); }
      const out = [];
      for (const r of state.recent) { try { const st = await fsp.stat(r.path); out.push({ ...r, mtime: st.mtimeMs }); } catch {} }
      return json(res, req, 200, { recent: out });
    }
    if (p === '/api/board' && req.method === 'GET') {
      const f = boardPath(q('path'));
      let text, st;
      try { [text, st] = await Promise.all([fsp.readFile(f, 'utf8'), fsp.stat(f)]); } catch { return json(res, req, 404, { error: 'Доска не найдена', path: f }); }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'x-mtime': String(st.mtimeMs), 'Access-Control-Expose-Headers': 'x-mtime', ...cors(req) });
      return res.end(text);
    }
    if (p === '/api/board' && req.method === 'PUT') {
      const f = boardPath(q('path'));
      const text = await body(req);
      let doc; try { doc = JSON.parse(text); } catch { throw badReq('Тело должно быть JSON'); }
      if (!doc || !Array.isArray(doc.elements)) throw badReq('В доске нет массива elements');
      const base = q('base');
      if (base) { try { const cur = (await fsp.stat(f)).mtimeMs; if (Math.abs(cur - Number(base)) > 1) return json(res, req, 409, { error: 'Доска изменена извне', mtime: cur }); } catch {} }
      const mtime = await writeAtomic(f, text);
      return json(res, req, 200, { ok: true, mtime });
    }
    if (p === '/api/board/create') {
      const b = await B();
      const dir = dirPath(b.dir);
      const name = cleanName(b.name);
      let f = path.join(dir, name + BOARD_EXT);
      for (let i = 2; fs.existsSync(f); i++) f = path.join(dir, `${name} ${i}${BOARD_EXT}`);
      const content = b.content ? (typeof b.content === 'string' ? b.content : JSON.stringify(b.content, null, 2)) : emptyBoard();
      await writeAtomic(f, content);
      if (b.custom && !locationsFor(context.cwd).some((l) => same(l.dir, dir))) { state.customDirs = [...new Set([...(state.customDirs || []), dir])]; saveState(); }
      touchRecent(f);
      return json(res, req, 200, { ok: true, path: f, name: boardName(f) });
    }
    if (p === '/api/board/rename') {
      const b = await B();
      const f = boardPath(b.path);
      const to = path.join(path.dirname(f), cleanName(b.name) + BOARD_EXT);
      if (!same(f, to)) {
        if (fs.existsSync(to)) return json(res, req, 409, { error: 'Доска с таким именем уже есть' });
        await fsp.rename(f, to);
        state.recent = state.recent.map((r) => (same(r.path, f) ? { ...r, path: to, name: boardName(to) } : r)); saveState();
      }
      return json(res, req, 200, { ok: true, path: to, name: boardName(to) });
    }
    if (p === '/api/board/delete') { // moved to <dir>/.trash, never destroyed
      const b = await B();
      const f = boardPath(b.path);
      const trash = path.join(path.dirname(f), '.trash');
      await fsp.mkdir(trash, { recursive: true });
      const to = path.join(trash, `${boardName(f)} ${new Date().toISOString().replace(/[:.]/g, '-')}${BOARD_EXT}`);
      await fsp.rename(f, to);
      state.recent = state.recent.filter((r) => !same(r.path, f)); saveState();
      return json(res, req, 200, { ok: true, trashed: to });
    }
    if (p === '/api/watch') { const f = boardPath(q('path')); sse(res, req); return watchBoard(res, f); }
    if (p === '/api/bridge') {
      sse(res, req); bridgeClients.add(res);
      res.on('close', () => bridgeClients.delete(res));
      return send(res, 'hello', { ok: true });
    }
    if (p === '/api/open') { // ask T3 windows to open something in the right panel
      const b = await B();
      let msg;
      if (b.artifact) {
        const {deliverToDesktop} = await import('../artifacts/desktop-bridge.mjs');
        const delivery = deliverToDesktop(b.artifact,b.confirmDelete);
        if (delivery) return json(res,req,200,{ok:true,delivered:await delivery});
      }
      if (b.board) { const f = boardPath(b.board); if (!fs.existsSync(f)) return json(res, req, 404, { error: 'Доска не найдена' }); touchRecent(f); msg = { kind: 'board', path: f, title: boardName(f) }; }
      else if (b.hub === 'boards') msg = { kind: 'hub', tab: 'boards' };
      else if (typeof b.url === 'string' && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(b.url)) msg = { kind: 'url', url: b.url };
      else throw badReq('Что открыть: board, hub или локальный url');
      return json(res, req, 200, { ok: true, delivered: openInT3(msg) });
    }
    if (p === '/api/chat/send') { // {board, png?: "data:image/png;base64,...", selection?: bool}
      const b = JSON.parse(await body(req, 24 * 1024 * 1024) || '{}');
      const f = boardPath(b.board); if (!fs.existsSync(f)) return json(res, req, 404, { error: 'Доска не найдена' });
      let png = null;
      if (b.png != null) {
        const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.png));
        if (!m) throw badReq('png: ожидается data:image/png;base64');
        png = Buffer.from(m[1], 'base64');
        if (png.length < 8 || png.readUInt32BE(0) !== 0x89504e47) throw badReq('png: это не PNG');
      }
      if (!bridgeClients.size) return json(res, req, 409, { error: 'Окно T3 не подключено к студии — откройте T3 и повторите' });
      const to = typeof b.to === 'string' && /^[\w-]{1,40}$/.test(b.to) ? b.to : undefined; // optional: only the T3 window tagged with this id
      return json(res, req, 200, { ok: true, delivered: sendToChat({ path: f, title: boardName(f), selection: !!b.selection, to }, png) });
    }
    if (p === '/api/chat/png') {
      const s = chatShots.get(q('id') || '');
      if (!s) return json(res, req, 404, { error: 'Снимок устарел' });
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'Content-Length': s.buf.length, ...cors(req) });
      return res.end(s.buf);
    }
    return json(res, req, 404, { error: 'Нет такого метода' });
  } catch (e) {
    if (!res.headersSent) json(res, req, e.status || 500, { error: e.message || String(e) });
    else try { res.end(); } catch {}
  }
});
server.listen(PORT, HOST, () => console.log(`T3 Studio on http://${HOST}:${PORT}/  data: ${DATA}`));
server.on('error', (e) => { console.error(e.message); process.exit(1); });
