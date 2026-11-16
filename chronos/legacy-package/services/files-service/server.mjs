// Files service for T3 Code — saves downloads to the user's Downloads folder (127.0.0.1 only, no dependencies).
// Sources: signed T3 asset URLs (any environment), the local disk (local environment only) and SSH (environments
// that T3 desktop reaches through an SSH tunnel; target resolved from T3's own desktop trace log). Never writes remotely.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const PORT = Number(process.env.OLY_FILES_PORT || 4519);
const HOME = os.homedir();
const T3 = path.join(HOME, '.t3');
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
const ORIGINS = new Set(['t3code://app', 'http://localhost:3773', 'http://127.0.0.1:3773']);
const LOG = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'server.log');

function log(...a) { try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + a.join(' ') + '\n'); } catch {} }

function downloadsDir() {
  if (process.env.OLY_FILES_DEST) return process.env.OLY_FILES_DEST;
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders', '/v', '{374DE290-123F-4565-9164-39C4925E467B}'], { encoding: 'utf8', windowsHide: true });
    const m = /REG_(?:EXPAND_)?SZ\s+(.+)\s*$/m.exec(out);
    if (m) { const p = m[1].trim().replace(/%([^%]+)%/g, (_, v) => process.env[v] || ''); if (p) return p; }
  } catch {}
  return path.join(HOME, 'Downloads');
}
const DEST = downloadsDir();
const localEnvId = () => { try { return fs.readFileSync(path.join(T3, 'userdata', 'environment-id'), 'utf8').trim(); } catch { return ''; } };

// ---------- helpers ----------
const safeName = (n, fb = 'download') => {
  let s = String(n || '').split(/[\\/]/).pop().replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').trim();
  if (!s || s === '.' || s === '..') s = fb;
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(s)) s = '_' + s;
  return s.slice(0, 180);
};
function uniquePath(dir, name) {
  const ext = /\.(tar\.gz|[^.]{1,8})$/i.exec(name)?.[0] || '';
  const base = ext ? name.slice(0, -ext.length) : name;
  let p = path.join(dir, name);
  for (let i = 2; fs.existsSync(p) || fs.existsSync(p + '.part'); i++) p = path.join(dir, `${base} (${i})${ext}`);
  return p;
}
function run(cmd, args, { stdoutFile, timeout = 0, signal } = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { windowsHide: true, signal, stdio: ['ignore', stdoutFile ? 'pipe' : 'ignore', 'pipe'] });
    let err = '', t = null;
    if (timeout) t = setTimeout(() => { p.kill(); err += '\nTimeout'; }, timeout);
    if (stdoutFile) p.stdout.pipe(stdoutFile.stream).on('error', () => {});
    if (stdoutFile) p.stdout.on('data', (d) => stdoutFile.onData(d.length));
    p.stderr.on('data', (d) => { if (err.length < 4000) err += d; });
    p.on('error', (e) => { err += ' ' + String(e); if (p.pid === undefined) { if (t) clearTimeout(t); resolve({ code: -1, err }); } });
    p.on('close', (code) => { if (t) clearTimeout(t); resolve({ code: code ?? -1, err }); });
  });
}
const rmQuiet = (p) => fsp.rm(p, { force: true, maxRetries: 8, retryDelay: 250 }).catch(() => {});
const shq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
function assertAssetUrl(u) {
  const x = new URL(u);
  if (!/^https?:$/.test(x.protocol) || !x.pathname.startsWith('/api/assets/')) throw new Error('Недопустимый адрес');
  return x.toString();
}

// ---------- jobs ----------
const jobs = new Map();
let jobSeq = 0;
function newJob(kind, name) {
  const id = Date.now().toString(36) + (++jobSeq);
  const j = { id, kind, name, state: 'running', bytes: 0, total: 0, files: 0, filesDone: 0, path: '', error: '', ac: new AbortController() };
  jobs.set(id, j);
  setTimeout(() => jobs.delete(id), 30 * 60e3).unref();
  return j;
}
const pub = (j) => ({ id: j.id, kind: j.kind, name: j.name, state: j.state, bytes: j.bytes, total: j.total, files: j.files, filesDone: j.filesDone, path: j.path, error: j.error });
async function finish(j, fn) {
  try { await fn(); j.state = 'done'; log('done', j.kind, j.path, j.bytes); }
  catch (e) { const ab = j.ac.signal.aborted; j.state = ab ? 'cancelled' : 'error'; j.error = ab ? 'Отменено' : String(e && e.message || e).slice(0, 400); log(j.state, j.kind, j.name, j.error); }
}

async function fetchTo(url, file, onBytes, onTotal, signal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`Сервер окружения ответил ${r.status}`);
  const len = Number(r.headers.get('content-length')) || 0;
  if (onTotal) onTotal(len);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const body = Readable.fromWeb(r.body);
  body.on('data', (c) => onBytes(c.length));
  await pipeline(body, fs.createWriteStream(file), { signal });
}
async function zipDir(parent, name, out, signal, onSize) {
  const tmp = out + '.part';
  const iv = onSize ? setInterval(() => fsp.stat(tmp).then((st) => onSize(st.size), () => {}), 500) : null;
  const r = await run(TAR, ['-a', '-c', '-f', tmp, '-C', parent, name], { signal });
  if (iv) clearInterval(iv);
  if (r.code !== 0) { await rmQuiet(tmp); throw new Error('tar: ' + r.err.trim().split('\n').slice(-2).join(' ')); }
  await fsp.rename(tmp, out);
}

// file from a signed T3 asset URL
function jobFetch({ url, name }) {
  url = assertAssetUrl(url);
  const n = safeName(name);
  const j = newJob('fetch', n);
  finish(j, async () => {
    const out = uniquePath(DEST, n); const tmp = out + '.part';
    try { await fetchTo(url, tmp, (b) => { j.bytes += b; }, (t) => { j.total = t; }, j.ac.signal); await fsp.rename(tmp, out); }
    catch (e) { await rmQuiet(tmp); throw e; }
    j.path = out;
  });
  return j;
}
// folder: list of {rel,url} downloaded into a temp dir and zipped
function jobZip({ name, files }) {
  if (!Array.isArray(files) || !files.length) throw new Error('Папка пуста');
  const root = safeName(name, 'folder');
  const j = newJob('zip', root + '.zip'); j.files = files.length;
  finish(j, async () => {
    const tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), 'oly-files-'));
    try {
      const dir = path.join(tmpBase, root);
      await fsp.mkdir(dir, { recursive: true });
      let i = 0;
      const worker = async () => {
        while (i < files.length) {
          const f = files[i++];
          const rel = String(f.rel || '').split(/[\\/]+/).filter((s) => s && s !== '.' && s !== '..').map((s) => safeName(s, '_'));
          if (!rel.length) continue;
          await fetchTo(assertAssetUrl(f.url), path.join(dir, ...rel), (b) => { j.bytes += b; }, null, j.ac.signal);
          j.filesDone++;
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      const out = uniquePath(DEST, root + '.zip');
      await zipDir(tmpBase, root, out, j.ac.signal);
      j.path = out; j.bytes = (await fsp.stat(out)).size;
    } finally { await fsp.rm(tmpBase, { recursive: true, force: true }).catch(() => {}); }
  });
  return j;
}
// local environment: copy or zip straight from disk
function jobLocal({ envId, path: p, isDir }) {
  if (!envId || envId !== localEnvId()) throw new Error('Не локальное окружение');
  const abs = path.resolve(String(p || ''));
  const st = fs.statSync(abs);
  const n = safeName(path.basename(abs), 'download');
  const j = newJob('local', st.isDirectory() ? n + '.zip' : n);
  finish(j, async () => {
    if (st.isDirectory()) {
      const out = uniquePath(DEST, n + '.zip');
      await zipDir(path.dirname(abs), path.basename(abs), out, j.ac.signal, (n) => { j.bytes = n; });
      j.path = out; j.bytes = (await fsp.stat(out)).size;
    } else {
      j.total = st.size;
      const out = uniquePath(DEST, n); const tmp = out + '.part';
      try { await pipeline(fs.createReadStream(abs).on('data', (c) => { j.bytes += c.length; }), fs.createWriteStream(tmp), { signal: j.ac.signal }); }
      catch (e) { await rmQuiet(tmp); throw e; }
      await fsp.rename(tmp, out); j.path = out;
    }
  });
  return j;
}
// SSH environments: T3 desktop logs its tunnels ("ssh.tunnel.ready" with alias/user/port/httpBaseUrl)
const SSH_CACHE = path.join(path.dirname(LOG), 'ssh-targets.json');
function sshTargets() {
  const map = new Map();
  try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(SSH_CACHE, 'utf8')))) map.set(k, v); } catch {}
  for (const f of ['desktop.trace.ndjson.1', 'desktop.trace.ndjson']) {
    let txt = '';
    try { txt = fs.readFileSync(path.join(T3, 'userdata', 'logs', f), 'utf8'); } catch { continue; }
    let i = 0;
    while ((i = txt.indexOf('ssh.tunnel.ready', i)) >= 0) {
      const seg = txt.slice(i, i + 3000).replace(/\\"/g, '"').replace(/\\n/g, ' ');
      i += 16;
      const g = (k) => new RegExp(`"${k}":\\s*"?([^",}\\]]+)`).exec(seg)?.[1]?.trim();
      const base = g('httpBaseUrl'), alias = g('alias'), user = g('username'), port = g('port');
      if (base && alias) map.set(base.replace(/\/+$/, ''), { alias, user, port: port || '22', hostname: g('hostname') });
    }
  }
  try { fs.writeFileSync(SSH_CACHE, JSON.stringify(Object.fromEntries(map), null, 1)); } catch {}
  return map;
}
const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
function jobSsh({ httpBase, path: p, isDir }) {
  const t = sshTargets().get(String(httpBase || '').replace(/\/+$/, ''));
  if (!t) throw new Error('SSH-хост для окружения не найден');
  if (!HOST_RE.test(t.alias) || (t.user && !HOST_RE.test(t.user)) || !/^\d+$/.test(t.port)) throw new Error('Некорректный SSH-хост');
  const rp = String(p || '');
  if (!rp.startsWith('/')) throw new Error('Нужен абсолютный путь');
  const clean = rp.replace(/\/+$/, '') || '/';
  const base = clean.split('/').pop() || 'root';
  const parent = clean.slice(0, clean.length - base.length) || '/';
  const n = safeName(base, 'download') + (isDir ? '.tar.gz' : '');
  const host = (t.user ? t.user + '@' : '') + t.alias;
  const j = newJob('ssh', n);
  finish(j, async () => {
    const out = uniquePath(DEST, n); const tmp = out + '.part';
    const ws = fs.createWriteStream(tmp);
    const cmd = isDir ? `tar czf - -C ${shq(parent)} ${shq(base)}` : `cat -- ${shq(clean)}`;
    const r = await run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-p', t.port, host, cmd], { signal: j.ac.signal, stdoutFile: { stream: ws, onData: (b) => { j.bytes += b; } } });
    await new Promise((res) => { if (ws.writableFinished || ws.destroyed) return res(); ws.on('finish', res); ws.on('error', res); ws.on('close', res); });
    if (r.code !== 0) { await rmQuiet(tmp); throw new Error('ssh: ' + (r.err.trim().split('\n').pop() || 'код ' + r.code)); }
    await fsp.rename(tmp, out); j.path = out;
  });
  return j;
}
// raw body (client-side fallback)
async function saveBody(req, name) {
  const n = safeName(name);
  const out = uniquePath(DEST, n); const tmp = out + '.part';
  await pipeline(req, fs.createWriteStream(tmp));
  await fsp.rename(tmp, out);
  return out;
}
function reveal(p) {
  const abs = path.resolve(String(p || ''));
  const inDest = abs.toLowerCase().startsWith(path.resolve(DEST).toLowerCase() + path.sep);
  if (!inDest && abs.toLowerCase() !== path.resolve(DEST).toLowerCase()) throw new Error('Путь вне папки загрузок');
  const target = fs.existsSync(abs) ? abs : path.resolve(DEST);
  spawn('explorer.exe', [target === abs && abs !== path.resolve(DEST) ? `/select,"${abs}"` : `"${target}"`], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' }).unref();
}

// ---------- http ----------
function cors(req, res) {
  const o = req.headers.origin;
  if (o && ORIGINS.has(o)) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-oly');
  res.setHeader('Access-Control-Max-Age', '600');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
async function readJson(req) { let s = ''; for await (const c of req) { s += c; if (s.length > 64e6) throw new Error('Слишком большой запрос'); } return s ? JSON.parse(s) : {}; }

const server = http.createServer(async (req, res) => {
  cors(req, res);
  const u = new URL(req.url, 'http://127.0.0.1');
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (req.method === 'GET' && u.pathname === '/health') return send(res, 200, { ok: true, service: 'oly-files', dest: DEST, localEnvId: localEnvId() });
    if (req.method === 'GET' && u.pathname === '/job') { const j = jobs.get(u.searchParams.get('id') || ''); return j ? send(res, 200, pub(j)) : send(res, 404, { error: 'Нет такой задачи' }); }
    if (req.method !== 'POST') return send(res, 404, { error: 'not found' });
    if (req.headers['x-oly'] !== '1') return send(res, 403, { error: 'forbidden' });
    const o = req.headers.origin; if (o && !ORIGINS.has(o)) return send(res, 403, { error: 'forbidden origin' });
    if (u.pathname === '/save') return send(res, 200, { path: await saveBody(req, u.searchParams.get('name')) });
    const body = await readJson(req);
    switch (u.pathname) {
      case '/fetch': return send(res, 200, pub(jobFetch(body)));
      case '/zip': return send(res, 200, pub(jobZip(body)));
      case '/local': return send(res, 200, pub(jobLocal(body)));
      case '/ssh': return send(res, 200, pub(jobSsh(body)));
      case '/cancel': { const j = jobs.get(String(body.id || '')); if (j && j.state === 'running') j.ac.abort(); return send(res, 200, { ok: !!j }); }
      case '/ssh-target': { const t = sshTargets().get(String(body.httpBase || '').replace(/\/+$/, '')); return send(res, 200, { ok: !!t, alias: t?.alias || '' }); }
      case '/reveal': reveal(body.path); return send(res, 200, { ok: true });
      default: return send(res, 404, { error: 'not found' });
    }
  } catch (e) { log('req error', u.pathname, e && e.message); return send(res, 400, { error: String(e && e.message || e) }); }
});
server.on('error', (e) => { log('server error', e.message); process.exit(1); });
server.listen(PORT, '127.0.0.1', () => log('listening', PORT, 'dest', DEST));
