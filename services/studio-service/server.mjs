// T3 Studio — local service (127.0.0.1:4520, no dependencies).
// Excalidraw boards stored as .excalidraw JSON files (project/.excalidraw or the server folder),
// WordPress Playground sites (start/stop, persisted), and a bridge that asks the T3 window to open URLs in its right panel.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.OLY_STUDIO_PORT || 4520);
const HOST = '127.0.0.1';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(HERE, 'public');
const DATA = process.env.OLY_STUDIO_DATA || path.join(HERE, 'data');
const SERVER_BOARDS = path.join(DATA, 'boards');
const STATE_FILE = path.join(DATA, 'state.json');
const T3_HOME = path.join(os.homedir(), '.t3');
const T3_DB = path.join(T3_HOME, 'userdata', 'statev2.sqlite');
const IS_WIN = process.platform === 'win32';
const NPX_CLI = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
const WP_CLI_DEFAULT = '3.1.64';
const WP_PORT_FROM = 9410; // 9400–9409 are left to manual `npx @wp-playground/cli` runs (the user uses 9401/9403)
const ALLOWED_ORIGINS = new Set(['t3code://app', 'http://localhost:3773', 'http://127.0.0.1:3773', `http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
const BOARD_EXT = '.excalidraw';
const NAME_RE = /^[^<>:"/\\|?*\x00-\x1f]{1,100}$/;

fs.mkdirSync(SERVER_BOARDS, { recursive: true });
fs.mkdirSync(path.join(DATA, 'wp'), { recursive: true });

// ---------- state ----------
let state = { recent: [], wpSites: [], customDirs: [] };
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
const norm = (p) => path.resolve(String(p || ''));
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
    const { DatabaseSync } = globalThis.__olySqlite || {};
    if (!DatabaseSync) return [];
    const db = new DatabaseSync(T3_DB, { readOnly: true });
    try {
      const rows = db.prepare('select title, workspace_root from projection_projects where deleted_at is null and archived_at is null').all();
      // T3's "No project" lives in ~/.t3/scratch — boards of such threads go to the studio folder instead
      return rows.filter((r) => r.workspace_root && fs.existsSync(r.workspace_root) && !inside(norm(r.workspace_root), T3_HOME))
        .map((r) => ({ title: r.title, root: norm(r.workspace_root) }));
    } finally { db.close(); }
  } catch { return []; }
}
try { const warn = process.emitWarning; process.emitWarning = () => {}; globalThis.__olySqlite = await import('node:sqlite'); process.emitWarning = warn; } catch {}

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
      const main = norm(path.resolve(c, m[1].trim(), '..', '..', '..'));
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

// ---------- WordPress Playground ----------
const procs = new Map(); // id -> {child, startedAt, status}
function siteById(id) { const s = state.wpSites.find((x) => x.id === id); if (!s) { const e = new Error('Сайт не найден'); e.status = 404; throw e; } return s; }
function portBusy(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port }, () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.setTimeout(700, () => { s.destroy(); resolve(false); });
  });
}
async function freePort() {
  const used = new Set(state.wpSites.map((s) => s.port));
  for (let p = WP_PORT_FROM; p < WP_PORT_FROM + 200; p++) if (!used.has(p) && !(await portBusy(p))) return p;
  throw new Error('Нет свободного порта');
}
// a static file answers in milliseconds once WordPress is installed and served ("/" goes through PHP and takes ~2 s)
function httpOk(port) {
  return new Promise((resolve) => {
    const r = http.get({ host: '127.0.0.1', port, path: '/wp-includes/images/blank.gif', timeout: 2500 }, (res) => { res.resume(); resolve(res.statusCode >= 200 && res.statusCode < 400); });
    r.on('error', () => resolve(false)); r.on('timeout', () => { r.destroy(); resolve(false); });
  });
}
// Playground processes are found by command line (npx → cmd → node wp-playground.js → node --experimental-wasm-jspi …):
// the npx parent may exit early, so PIDs alone are unreliable. All processes of a site carry its unique data folder.
let procCache = { at: 0, p: null };
function listPlaygroundProcs(fresh) {
  if (!fresh && procCache.p && Date.now() - procCache.at < 1500) return procCache.p;
  procCache.at = Date.now();
  procCache.p = new Promise((resolve) => {
    const done = (list) => resolve(list.filter((x) => x.pid && /wp-playground/i.test(x.cmd)));
    if (IS_WIN) {
      const ps = `Get-CimInstance Win32_Process -Filter "Name='node.exe' or Name='cmd.exe'" | Where-Object { $_.CommandLine -like '*wp-playground*' } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`;
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 20000, maxBuffer: 16e6 }, (err, out) => {
        let list = [];
        try { const j = JSON.parse(String(out || '').trim() || '[]'); list = (Array.isArray(j) ? j : [j]).filter(Boolean).map((x) => ({ pid: x.ProcessId, cmd: String(x.CommandLine || '') })); } catch {}
        done(list);
      });
    } else {
      execFile('ps', ['-eo', 'pid=,args='], { maxBuffer: 16e6 }, (err, out) => done(String(out || '').split('\n').map((l) => { const m = /^\s*(\d+)\s+(.*)$/.exec(l); return m ? { pid: Number(m[1]), cmd: m[2] } : {}; })));
    }
  });
  return procCache.p;
}
async function siteProcs(s, fresh) { const key = s.dataDir.toLowerCase(); return (await listPlaygroundProcs(fresh)).filter((p) => p.cmd.toLowerCase().includes(key)); }
function logFile(s) { return path.join(DATA, 'wp', s.id + '.log'); }
async function siteStatus(s) {
  const rec = procs.get(s.id);
  if (rec && rec.status === 'starting') return 'starting';
  if (rec && rec.status === 'error') return 'error';
  const ok = await httpOk(s.port);
  if (ok) return s.running ? 'running' : 'stopped'; // a foreign server on our port: start() will pick another port
  if (!s.running) return 'stopped';
  if ((await siteProcs(s)).length) return 'starting'; // slow path, only when a started site stopped answering
  s.running = false; saveState();
  return 'stopped';
}
async function tail(f, n = 40) { try { const t = await fsp.readFile(f, 'utf8'); return t.split(/\r?\n/).slice(-n).join('\n'); } catch { return ''; } }
async function siteView(s) {
  const status = await siteStatus(s);
  return { ...s, status, url: `http://127.0.0.1:${s.port}/`, adminUrl: `http://127.0.0.1:${s.port}/wp-admin/`, log: status === 'error' ? await tail(logFile(s), 25) : undefined };
}
async function startSite(s) {
  const prev = procs.get(s.id);
  if (prev && prev.status === 'starting') return 'starting';
  if ((await siteProcs(s, true)).length) { s.running = true; saveState(); return (await httpOk(s.port)) ? 'running' : 'starting'; }
  if (await portBusy(s.port)) { s.port = await freePort(); saveState(); }
  await fsp.mkdir(s.dataDir, { recursive: true });
  const installed = fs.existsSync(path.join(s.dataDir, 'wp-load.php'));
  const args = [NPX_CLI, '-y', `@wp-playground/cli@${s.cliVersion || WP_CLI_DEFAULT}`, 'server',
    `--port=${s.port}`, `--php=${s.php || '8.3'}`, `--wp=${s.wp || 'latest'}`, '--login',
    '--mount-dir-before-install', s.dataDir, '/wordpress',
    '--wordpress-install-mode', installed ? 'install-from-existing-files-if-needed' : 'download-and-install'];
  for (const m of s.mounts || []) if (m.host && m.vfs && fs.existsSync(m.host)) args.push('--mount-dir', m.host, m.vfs);
  const fd = fs.openSync(logFile(s), 'w');
  fs.writeSync(fd, `[studio] ${new Date().toISOString()} node ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}\n`);
  const child = spawn(process.execPath, args, { cwd: s.dataDir, windowsHide: true, stdio: ['ignore', fd, fd], env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
  fs.closeSync(fd);
  const rec = { child, status: 'starting', startedAt: Date.now() };
  procs.set(s.id, rec);
  s.lastStartedAt = Date.now(); saveState();
  (async () => { // readiness: the first boot downloads WordPress (a minute or two)
    const until = Date.now() + 6 * 60000;
    while (Date.now() < until && rec.status === 'starting') {
      await new Promise((r) => setTimeout(r, 1500));
      if (rec.status !== 'starting') return;
      if (await httpOk(s.port)) { rec.status = 'running'; s.running = true; saveState(); if (procs.get(s.id) === rec) procs.delete(s.id); return; }
      if (Date.now() - rec.startedAt > 15000 && !(await siteProcs(s, true)).length) { rec.status = 'error'; return; }
    }
    if (rec.status === 'starting') rec.status = 'error';
  })();
  return 'starting';
}
function killTree(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve();
    if (IS_WIN) execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
    else { try { process.kill(pid, 'SIGTERM'); } catch {} resolve(); }
  });
}
async function stopSite(s) {
  const rec = procs.get(s.id);
  if (rec) rec.status = 'stopped';
  procs.delete(s.id);
  // only this site's own Playground processes (matched by its data folder) — never other `npx @wp-playground/cli` runs
  const pids = new Set((await siteProcs(s, true)).map((p) => p.pid));
  if (rec && rec.child.exitCode === null) pids.add(rec.child.pid);
  for (const pid of pids) await killTree(pid);
  procCache.p = null;
  s.running = false; saveState();
  return 'stopped';
}
function slugify(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'site'; }
async function createSite(b) {
  const name = String(b.name || '').trim().slice(0, 80) || 'WordPress';
  const root = b.root ? dirPath(b.root) : null;
  const id = slugify(name) + '-' + crypto.randomBytes(3).toString('hex');
  const store = b.store === 'project' && root ? 'project' : 'server';
  const dataDir = store === 'project' ? path.join(root, '.wordpress', id) : path.join(DATA, 'wp', id);
  const mounts = [];
  const mountAs = ['plugin', 'theme', 'wp-content', 'none'].includes(b.mountAs) ? b.mountAs : 'none';
  if (root && mountAs !== 'none') {
    const slug = slugify(b.slug || path.basename(root));
    const vfs = mountAs === 'plugin' ? `/wordpress/wp-content/plugins/${slug}` : mountAs === 'theme' ? `/wordpress/wp-content/themes/${slug}` : '/wordpress/wp-content';
    mounts.push({ host: root, vfs });
  }
  const s = { id, name, root, store, dataDir, mountAs, mounts, port: await freePort(), php: b.php || '8.3', wp: b.wp || 'latest', cliVersion: b.cliVersion || WP_CLI_DEFAULT, createdAt: Date.now() };
  state.wpSites.push(s); saveState();
  return s;
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
      if (b.board) { const f = boardPath(b.board); if (!fs.existsSync(f)) return json(res, req, 404, { error: 'Доска не найдена' }); touchRecent(f); msg = { kind: 'board', path: f, title: boardName(f) }; }
      else if (b.site) { const s = siteById(b.site); msg = { kind: 'url', url: `http://127.0.0.1:${s.port}${b.admin === false ? '/' : '/wp-admin/'}`, match: `http://127.0.0.1:${s.port}/` }; }
      else if (b.hub) msg = { kind: 'hub', tab: b.hub === 'wp' ? 'wp' : 'boards' };
      else if (typeof b.url === 'string' && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(b.url)) msg = { kind: 'url', url: b.url };
      else throw badReq('Что открыть: board, site, hub или локальный url');
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
    if (p === '/api/wp/sites' && req.method === 'GET') {
      const sites = await Promise.all(state.wpSites.map(siteView));
      return json(res, req, 200, { sites, cliDefault: WP_CLI_DEFAULT });
    }
    if (p === '/api/wp/sites' && req.method === 'POST') return json(res, req, 200, { ok: true, site: await siteView(await createSite(await B())) });
    if (p === '/api/wp/start') { const s = siteById((await B()).id); const st = await startSite(s); return json(res, req, 200, { ok: true, status: st, site: await siteView(s) }); }
    if (p === '/api/wp/stop') { const s = siteById((await B()).id); await stopSite(s); return json(res, req, 200, { ok: true, site: await siteView(s) }); }
    if (p === '/api/wp/remove') { // forget the site; its files stay on disk
      const s = siteById((await B()).id); await stopSite(s);
      state.wpSites = state.wpSites.filter((x) => x !== s); saveState();
      return json(res, req, 200, { ok: true, keptData: s.dataDir });
    }
    if (p === '/api/wp/log') { const s = siteById(q('id')); return json(res, req, 200, { log: await tail(logFile(s), Number(q('n')) || 80) }); }
    return json(res, req, 404, { error: 'Нет такого метода' });
  } catch (e) {
    if (!res.headersSent) json(res, req, e.status || 500, { error: e.message || String(e) });
    else try { res.end(); } catch {}
  }
});
server.listen(PORT, HOST, () => console.log(`T3 Studio on http://${HOST}:${PORT}/  data: ${DATA}`));
server.on('error', (e) => { console.error(e.message); process.exit(1); });
