// Skills Manager for T3 Code — local service (127.0.0.1 only, no dependencies).
// Lists, copies, syncs, enables/disables, creates, deletes and installs/updates agent skills across
// local folders, T3 projects and SSH servers. Deleted/replaced skills go to a trash folder, never removed outright.
import { resolveServicePath, t3Home, servicesData } from '../paths.mjs';
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.OLY_SKILLS_PORT || 4517);
const HOME = os.homedir();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const T3_DB = path.join(t3Home, 'userdata', 'statev2.sqlite');
const TRASH = path.join(servicesData, 'caches', 'skills-trash');
const REGISTRY = path.join(servicesData, 'caches', 'skills-registry.json');
const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$/;
const DIS = '.disabled'; // disabled skills live next to the skills folder: <…>/skills.disabled/<name>
const AGENTS = [
  { agent: 'claude', label: 'Claude Code', short: 'Claude', rel: '.claude/skills' },
  { agent: 'codex', label: 'Codex', short: 'Codex', rel: '.codex/skills' },
  { agent: 'agents', label: 'Общие (.agents)', short: '.agents', rel: '.agents/skills' },
];
const SSH_TTL = 5 * 60000;
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const checkName = (n) => { if (!NAME_RE.test(String(n || ''))) throw err('Некорректное имя скилла'); return n; };

// ---------- helpers ----------
function run(cmd, args, { input, timeout = 60000, cwd } = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, windowsHide: true });
    const chunks = []; let errs = '';
    const t = setTimeout(() => { p.kill(); errs += '\nTimeout'; }, timeout);
    p.stdout.on('data', (d) => chunks.push(d));
    p.stderr.on('data', (d) => { errs += d; });
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: Buffer.concat(chunks), err: String(e) }); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out: Buffer.concat(chunks), err: errs }); });
    p.stdin.on('error', () => {});
    if (input) { if (typeof input.pipe === 'function') input.pipe(p.stdin); else p.stdin.end(input); } else p.stdin.end();
  });
}
const sshArgs = (host, remoteCmd) => ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', host, remoteCmd];
const shq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
const sshErr = (r) => (r.err.trim().split('\n').filter(Boolean).pop() || 'нет соединения');
function frontmatter(md) {
  const text = (md || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const m = /^---\s*\n([\s\S]*?)\n---/.exec(text);
  const out = {};
  if (m) {
    const lines = m[1].split('\n');
    for (let i = 0; i < lines.length; i++) {
      const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(lines[i]);
      if (!kv) continue;
      let v = kv[2].trim();
      if (/^[>|][+-]?$/.test(v) || v === '') {
        const parts = [];
        while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) { i++; if (lines[i].trim()) parts.push(lines[i].trim()); }
        v = parts.join(' ');
      }
      out[kv[1]] = v.replace(/^["']|["']$/g, '').trim();
    }
  }
  if (!out.description) {
    const body = text.replace(/^---[\s\S]*?\n---/, '').split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#') && !/^-{3,}$/.test(l));
    if (body) out.description = body.slice(0, 300);
  }
  return out;
}
async function readJson(file, def) { try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return def; } }
async function writeJson(file, v) { await fsp.mkdir(path.dirname(file), { recursive: true }); const tmp = file + '.tmp'; await fsp.writeFile(tmp, JSON.stringify(v, null, 1)); await fsp.rename(tmp, file); }

// ---------- content hash (identical on Windows and on POSIX servers) ----------
// hash = sha1( for each regular file sorted by "./rel" bytewise: sha1(file) + "  ./rel\n" ) — same as
// `find . -type f ! -name .DS_Store ! -path './.git/*' -print0 | LC_ALL=C sort -z | xargs -0 -r sha1sum | sha1sum`
const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
async function fileList(dir) {
  const out = [];
  async function walk(d, rel) {
    let ents = []; try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { if (r === '.git') continue; await walk(path.join(d, e.name), r); }
      else if (e.isFile() && e.name !== '.DS_Store') out.push(r);
    }
  }
  await walk(dir, '');
  return out;
}
const hashCache = new Map(); // dir -> {sig, hash}
async function skillHash(dir) {
  const files = await fileList(dir);
  const stats = await Promise.all(files.map((f) => fsp.stat(path.join(dir, f)).then((s) => [f, s.size, s.mtimeMs]).catch(() => [f, -1, 0])));
  const sig = stats.map((x) => x.join(':')).join('|');
  const c = hashCache.get(dir); if (c && c.sig === sig) return c.hash;
  const keyed = files.map((f) => ['./' + f, f]).sort((a, b) => Buffer.compare(Buffer.from(a[0]), Buffer.from(b[0])));
  let acc = '';
  for (const [k, f] of keyed) acc += sha1(await fsp.readFile(path.join(dir, f))) + '  ' + k + '\n';
  const hash = sha1(acc);
  hashCache.set(dir, { sig, hash });
  return hash;
}
const REMOTE_HASH = `find . -type f ! -name .DS_Store ! -path './.git/*' -print0 2>/dev/null | LC_ALL=C sort -z | xargs -0 -r sha1sum 2>/dev/null | sha1sum | cut -c1-40`;

// ---------- locations ----------
function sshHosts() {
  try {
    const cfg = fs.readFileSync(path.join(HOME, '.ssh', 'config'), 'utf8');
    const hosts = [];
    for (const line of cfg.split(/\r?\n/)) {
      const m = /^\s*Host\s+(.+)$/i.exec(line);
      if (m) { const first = m[1].trim().split(/\s+/)[0]; if (HOST_RE.test(first) && !first.includes('*')) hosts.push(first); }
    }
    return [...new Set(hosts)];
  } catch { return []; }
}
// Hosts with an active T3 SSH tunnel — detected in the background (PowerShell is slow), never blocks a request.
let tunnels = new Set(), tunnelsAt = 0, tunnelsBusy = false;
function refreshTunnels() {
  if (process.platform !== 'win32' || tunnelsBusy || Date.now() - tunnelsAt < 120000) return;
  tunnelsBusy = true;
  run('powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='ssh.exe'\" | ForEach-Object { $_.CommandLine }"], { timeout: 20000 }).then((r) => {
    const set = new Set();
    for (const line of r.out.toString().split(/\r?\n/)) if (/-L\s*\d+:127\.0\.0\.1:3773/.test(line)) { const m = /--\s+(?:[^@\s]+@)?(\S+)\s*$/.exec(line.trim()); if (m) set.add(m[1]); }
    tunnels = set; tunnelsAt = Date.now();
  }).finally(() => { tunnelsBusy = false; });
}
async function t3Projects() {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(T3_DB, { readOnly: true });
    const rows = db.prepare('select title, workspace_root from projection_projects where deleted_at is null and archived_at is null').all();
    db.close();
    return rows.filter((r) => r.workspace_root && fs.existsSync(r.workspace_root)).map((r) => ({ title: r.title, root: r.workspace_root }));
  } catch { return []; }
}
let locCache = null, locAt = 0;
async function locations(force) {
  refreshTunnels();
  if (!force && locCache && Date.now() - locAt < 60000) return locCache.map((l) => (l.kind === 'ssh' ? { ...l, t3: tunnels.has(l.host) } : l));
  const locs = [];
  for (const a of AGENTS) locs.push({ id: `local:user:${a.agent}`, kind: 'local', group: 'Этот компьютер', label: a.label, short: a.short, agent: a.agent, path: path.join(HOME, a.rel) });
  const same = (x, y) => resolveServicePath(x).toLowerCase() === resolveServicePath(y).toLowerCase();
  for (const p of await t3Projects()) for (const a of AGENTS) {
    const dir = path.join(p.root, a.rel);
    if (same(p.root, HOME)) continue; // a project at the home folder would duplicate «Этот компьютер»
    locs.push({ id: `local:project:${a.agent}:${Buffer.from(p.root).toString('base64url')}`, kind: 'local', group: 'Проекты', project: p.title, label: `${p.title} · ${a.label}`, short: a.short, agent: a.agent, path: dir, exists: fs.existsSync(dir) || fs.existsSync(dir + DIS) });
  }
  for (const h of sshHosts()) for (const a of AGENTS) locs.push({ id: `ssh:${h}:${a.agent}`, kind: 'ssh', group: 'Серверы', host: h, t3: tunnels.has(h), label: `${h} · ${a.label}`, short: a.short, agent: a.agent, path: `~/${a.rel}`, rel: a.rel });
  locCache = locs; locAt = Date.now();
  return locs;
}
async function loc(id) { const l = (await locations()).find((x) => x.id === id); if (!l) throw err('Неизвестное расположение'); return l; }
const remotePath = (l, disabled) => '$HOME/' + l.path.replace(/^~\//, '') + (disabled ? DIS : '');
const localDir = (l, name, disabled) => path.join(l.path + (disabled ? DIS : ''), name);

// ---------- listing ----------
async function listLocalDir(dir, disabled) {
  let ents = [];
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return null; }
  const out = [];
  await Promise.all(ents.map(async (e) => {
    if (!e.isDirectory() && !e.isSymbolicLink()) return;
    const d = path.join(dir, e.name);
    let md = '';
    try { md = await fsp.readFile(path.join(d, 'SKILL.md'), 'utf8'); } catch { return; }
    const fm = frontmatter(md);
    const st = await fsp.stat(path.join(d, 'SKILL.md')).catch(() => null);
    out.push({ name: e.name, title: fm.name || e.name, description: fm.description || '', mtime: st ? st.mtimeMs : 0, link: e.isSymbolicLink(), disabled: !!disabled });
  }));
  return out;
}
async function listLocal(l) {
  const [on, off] = await Promise.all([listLocalDir(l.path, false), listLocalDir(l.path + DIS, true)]);
  if (!on && !off) return { skills: [], exists: false };
  return { skills: [...(on || []), ...(off || [])].sort((a, b) => a.name.localeCompare(b.name)), exists: true };
}
// One SSH round trip lists all agent folders of a host (enabled + disabled). Cached for 5 minutes.
const hostCache = new Map(); // host -> {at, data, promise}
async function listHost(host, force) {
  const c = hostCache.get(host);
  if (c && !force) { if (c.promise) return c.promise; if (Date.now() - c.at < SSH_TTL) return c.data; }
  const dirs = AGENTS.flatMap((a) => [a.rel, a.rel + DIS]).join(' ');
  const cmd = `for a in ${dirs}; do d="$HOME/$a"; [ -d "$d" ] || continue; printf '\\036D%s\\037' "$a"; cd "$d" || continue; for s in */; do s=\${s%/}; [ -f "$s/SKILL.md" ] || continue; m=$(stat -c %Y "$s/SKILL.md" 2>/dev/null || echo 0); printf '\\036S%s\\037%s\\037' "$s" "$m"; head -c 3000 "$s/SKILL.md"; done; done; printf '\\036E'`;
  const promise = run('ssh', sshArgs(host, cmd), { timeout: 30000 }).then((r) => {
    const text = r.out.toString('utf8');
    if (r.code !== 0 || !text.includes('\x1eE')) throw err('SSH ' + host + ': ' + sshErr(r), 502);
    const data = {};
    for (const a of AGENTS) data[`ssh:${host}:${a.agent}`] = { skills: [], exists: false };
    let curRel = null;
    for (const chunk of text.split('\x1e')) {
      if (chunk[0] === 'D') {
        curRel = chunk.slice(1).split('\x1f')[0];
        const a = AGENTS.find((x) => curRel === x.rel || curRel === x.rel + DIS); if (a) data[`ssh:${host}:${a.agent}`].exists = true;
      } else if (chunk[0] === 'S' && curRel) {
        const [name, mt, md] = chunk.slice(1).split('\x1f');
        const disabled = curRel.endsWith(DIS);
        const a = AGENTS.find((x) => curRel === x.rel || curRel === x.rel + DIS); if (!a || !NAME_RE.test(name)) continue;
        const fm = frontmatter(md || '');
        data[`ssh:${host}:${a.agent}`].skills.push({ name, title: fm.name || name, description: fm.description || '', mtime: Number(mt) * 1000 || 0, disabled });
      }
    }
    for (const k in data) data[k].skills.sort((x, y) => x.name.localeCompare(y.name));
    hostCache.set(host, { at: Date.now(), data });
    return data;
  });
  hostCache.set(host, { ...(c || {}), promise });
  try { return await promise; } catch (e) { hostCache.delete(host); throw e; } finally { const x = hostCache.get(host); if (x) delete x.promise; }
}
function invalidate(l) { if (l && l.kind === 'ssh') hostCache.delete(l.host); }
async function listSkills(l, force) {
  if (l.kind === 'local') return listLocal(l);
  if (!HOST_RE.test(l.host)) throw err('Некорректный хост');
  return (await listHost(l.host, force))[l.id] || { skills: [], exists: false };
}
// Content hashes of every skill in a location (separate call: hashing can take a moment on big folders).
const hostHashCache = new Map();
async function hashes(l, force) {
  if (l.kind === 'local') {
    const out = {};
    for (const disabled of [false, true]) {
      const base = l.path + (disabled ? DIS : '');
      let ents = []; try { ents = await fsp.readdir(base, { withFileTypes: true }); } catch { continue; }
      for (const e of ents) {
        if (!e.isDirectory() && !e.isSymbolicLink()) continue;
        if (!fs.existsSync(path.join(base, e.name, 'SKILL.md'))) continue;
        try { out[(disabled ? '!' : '') + e.name] = await skillHash(path.join(base, e.name)); } catch {}
      }
    }
    return out;
  }
  const c = hostHashCache.get(l.host);
  let data = c && !force && Date.now() - c.at < SSH_TTL ? c.data : null;
  if (!data) {
    const dirs = AGENTS.flatMap((a) => [a.rel, a.rel + DIS]).join(' ');
    const cmd = `for a in ${dirs}; do d="$HOME/$a"; [ -d "$d" ] || continue; cd "$d" || continue; for s in */; do s=\${s%/}; [ -f "$s/SKILL.md" ] || continue; h=$(cd "$s" && ${REMOTE_HASH}); printf '%s\\t%s\\t%s\\n' "$a" "$s" "$h"; done; done`;
    const r = await run('ssh', sshArgs(l.host, cmd), { timeout: 90000 });
    if (r.code !== 0) throw err('SSH ' + l.host + ': ' + sshErr(r), 502);
    data = {};
    for (const line of r.out.toString('utf8').split('\n')) {
      const [rel, name, h] = line.split('\t'); if (!rel || !name || !/^[0-9a-f]{40}$/.test(h || '')) continue;
      const a = AGENTS.find((x) => rel === x.rel || rel === x.rel + DIS); if (!a) continue;
      const id = `ssh:${l.host}:${a.agent}`; (data[id] = data[id] || {})[(rel.endsWith(DIS) ? '!' : '') + name] = h;
    }
    hostHashCache.set(l.host, { at: Date.now(), data });
  }
  return data[l.id] || {};
}

// ---------- reading ----------
async function readSkill(l, name, disabled) {
  checkName(name);
  if (l.kind === 'local') {
    const dir = localDir(l, name, disabled);
    const markdown = await fsp.readFile(path.join(dir, 'SKILL.md'), 'utf8');
    const files = (await fileList(dir)).slice(0, 400);
    const sizes = await Promise.all(files.map((f) => fsp.stat(path.join(dir, f)).then((s) => s.size).catch(() => 0)));
    return { markdown, files: files.map((f, i) => ({ path: f, size: sizes[i] })).sort((a, b) => a.path.localeCompare(b.path)) };
  }
  const d = remotePath(l, disabled) + '/' + shq(name);
  const r = await run('ssh', sshArgs(l.host, `cat ${d}/SKILL.md && printf '\\036' && cd ${d} && find . -type f ! -path './.git/*' -printf '%s\\t%P\\n' 2>/dev/null | head -400`), { timeout: 20000 });
  if (r.code !== 0) throw err('Не удалось прочитать SKILL.md: ' + sshErr(r), 502);
  const [markdown, list = ''] = r.out.toString('utf8').split('\x1e');
  const files = list.split('\n').filter(Boolean).map((x) => { const i = x.indexOf('\t'); return { size: Number(x.slice(0, i)) || 0, path: x.slice(i + 1) }; }).sort((a, b) => a.path.localeCompare(b.path));
  return { markdown, files };
}

// One file inside a skill folder (relative path, never outside the folder; text only, binary files reported by size).
const FILE_MAX = 512 * 1024, WRITE_MAX = 200000;
function relPath(p) {
  const parts = String(p || '').replace(/\\/g, '/').split('/');
  if (!p || String(p).length > 300 || /^[A-Za-z]:|^\//.test(String(p).replace(/\\/g, '/')) || parts.some((s) => !s || s === '.' || s === '..' || s === '.git' || /[\x00-\x1f<>:"|?*]/.test(s)))
    throw err('Некорректный путь файла: нужен путь внутри папки скилла, например SKILL.md или references/notes.md');
  return parts.join('/');
}
const isBinary = (b) => b.subarray(0, 8000).includes(0);
// Symlinked sub-folders must not lead outside the skill folder.
async function assertInside(dir, target) {
  let probe = target; while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  const [rd, rp] = await Promise.all([fsp.realpath(dir), fsp.realpath(probe)]);
  const rel = path.relative(rd, rp);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw err('Путь ведёт за пределы папки скилла');
}
async function readSkillFile(l, name, disabled, file) {
  checkName(name); const rel = relPath(file);
  if (l.kind === 'local') {
    const dir = localDir(l, name, disabled), abs = path.join(dir, ...rel.split('/'));
    const st = await fsp.lstat(abs).catch(() => null);
    if (!st || !st.isFile()) throw err(`Файл «${rel}» не найден в скилле «${name}»`, 404);
    await assertInside(dir, abs);
    if (st.size > FILE_MAX) return { path: rel, size: st.size, truncated: true, binary: false, text: null };
    const b = await fsp.readFile(abs);
    return isBinary(b) ? { path: rel, size: st.size, binary: true, text: null } : { path: rel, size: st.size, binary: false, text: b.toString('utf8') };
  }
  const d = remotePath(l, disabled) + '/' + shq(name) + '/' + shq(rel);
  const r = await run('ssh', sshArgs(l.host, `[ -f ${d} ] || { echo 'файл не найден' >&2; exit 3; }; wc -c < ${d}; printf '\\036'; head -c ${FILE_MAX} ${d}`), { timeout: 20000 });
  if (r.code !== 0) throw err(`Не удалось прочитать «${rel}»: ` + sshErr(r), r.code === 3 ? 404 : 502);
  const i = r.out.indexOf(0x1e), size = Number(r.out.subarray(0, i).toString().trim()) || 0, b = r.out.subarray(i + 1);
  if (size > FILE_MAX) return { path: rel, size, truncated: true, binary: false, text: null };
  return isBinary(b) ? { path: rel, size, binary: true, text: null } : { path: rel, size, binary: false, text: b.toString('utf8') };
}

// ---------- mutations ----------
// Edit one file of an existing skill. The whole previous skill folder is copied to the trash first.
async function writeSkillFile(l, name, disabled, file, content) {
  checkName(name); const rel = relPath(file);
  if (typeof content !== 'string') throw err('Нужен текст файла (content)');
  if (content.length > WRITE_MAX) throw err('Файл слишком большой (лимит 200 000 символов)');
  if (rel === 'SKILL.md' && !content.trim()) throw err('SKILL.md не может быть пустым — чтобы убрать скилл, удалите его в корзину');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (l.kind === 'local') {
    const dir = localDir(l, name, disabled);
    if (!fs.existsSync(path.join(dir, 'SKILL.md'))) throw err(`«${name}» не найден${disabled ? ' среди отключённых' : ''}`, 404);
    const abs = path.join(dir, ...rel.split('/'));
    const st = await fsp.lstat(abs).catch(() => null);
    if (st && !st.isFile()) throw err(`«${rel}» — не обычный файл`, 409);
    await assertInside(dir, abs);
    await fsp.mkdir(TRASH, { recursive: true });
    const backup = path.join(TRASH, `${stamp}-${l.agent}-${name}-before-edit`);
    await fsp.cp(dir, backup, { recursive: true, verbatimSymlinks: true });
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    const tmp = abs + '.oly-tmp';
    await fsp.writeFile(tmp, content); await fsp.rename(tmp, abs);
    return { ok: true, path: rel, backup };
  }
  invalidate(l);
  const d = remotePath(l, disabled) + '/' + shq(name), t = d + '/' + shq(rel), bk = `"$HOME/.skills-trash/${stamp}-${l.agent}-"${shq(name)}-before-edit`;
  const r = await run('ssh', sshArgs(l.host, `[ -f ${d}/SKILL.md ] || { echo 'скилл не найден' >&2; exit 3; }; mkdir -p "$HOME/.skills-trash" && cp -a ${d} ${bk} && mkdir -p "$(dirname ${t})" && cat > ${t}.oly-tmp && mv ${t}.oly-tmp ${t}`), { input: Buffer.from(content, 'utf8'), timeout: 30000 });
  if (r.code !== 0) throw err('SSH: ' + sshErr(r), r.code === 3 ? 404 : 502);
  return { ok: true, path: rel, backup: `~/.skills-trash/${stamp}-${l.agent}-${name}-before-edit` };
}
async function deleteSkill(l, name, disabled) {
  checkName(name);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (l.kind === 'local') {
    const src = localDir(l, name, disabled);
    if (!fs.existsSync(src)) throw err(`«${name}» не найден`, 404);
    await fsp.mkdir(TRASH, { recursive: true });
    const dst = path.join(TRASH, `${stamp}-${l.agent}-${name}`);
    await fsp.cp(src, dst, { recursive: true, verbatimSymlinks: true });
    await fsp.rm(src, { recursive: true, force: true });
    return { trash: dst };
  }
  invalidate(l);
  const r = await run('ssh', sshArgs(l.host, `mkdir -p "$HOME/.skills-trash" && mv ${remotePath(l, disabled)}/${shq(name)} "$HOME/.skills-trash/${stamp}-${l.agent}-"${shq(name)}`), { timeout: 20000 });
  if (r.code !== 0) throw err('SSH: ' + sshErr(r), 502);
  return { trash: `~/.skills-trash/${stamp}-${l.agent}-${name}` };
}
async function toggleSkill(l, name, enable) {
  checkName(name);
  if (l.kind === 'local') {
    const src = localDir(l, name, enable), dst = localDir(l, name, !enable);
    if (!fs.existsSync(src)) throw err(`«${name}» не найден`, 404);
    if (fs.existsSync(dst)) throw err(enable ? `«${name}» уже включён — сначала удалите одну из копий` : `Отключённая копия «${name}» уже есть`, 409);
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    try { await fsp.rename(src, dst); } catch { await fsp.cp(src, dst, { recursive: true, verbatimSymlinks: true }); await fsp.rm(src, { recursive: true, force: true }); }
    return { ok: true };
  }
  invalidate(l);
  const from = remotePath(l, enable), to = remotePath(l, !enable);
  const r = await run('ssh', sshArgs(l.host, `[ -e ${from}/${shq(name)} ] || { echo 'не найден' >&2; exit 3; }; [ ! -e ${to}/${shq(name)} ] || { echo 'копия уже есть' >&2; exit 4; }; mkdir -p ${to} && mv ${from}/${shq(name)} ${to}/${shq(name)}`), { timeout: 20000 });
  if (r.code !== 0) throw err('SSH: ' + sshErr(r), r.code === 4 ? 409 : 502);
  return { ok: true };
}
// Materialize a skill folder locally (temp dir), then push it to any location.
async function pullToTemp(l, name, disabled) {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'oly-skill-'));
  if (l.kind === 'local') { await fsp.cp(localDir(l, name, disabled), path.join(tmp, name), { recursive: true, dereference: true }); return tmp; }
  const r = await run('ssh', sshArgs(l.host, `tar -C ${remotePath(l, disabled)} -cf - ${shq(name)}`), { timeout: 120000 });
  if (r.code !== 0) throw err('SSH tar: ' + sshErr(r), 502);
  const x = await run(TAR, ['-xf', '-', '-C', tmp], { input: r.out, timeout: 60000 });
  if (x.code !== 0) throw new Error('tar: ' + x.err);
  return tmp;
}
async function pushFromTemp(tmp, name, to, overwrite) {
  if (to.kind === 'local') {
    const dst = path.join(to.path, name);
    if (fs.existsSync(dst)) { if (!overwrite) throw err(`«${name}» уже есть в ${to.label}`, 409); await deleteSkill(to, name); }
    await fsp.mkdir(to.path, { recursive: true });
    await fsp.cp(path.join(tmp, name), dst, { recursive: true });
    return;
  }
  invalidate(to);
  const exists = await run('ssh', sshArgs(to.host, `[ -e ${remotePath(to)}/${shq(name)} ] && echo yes || echo no`), { timeout: 20000 });
  if (exists.code !== 0) throw err('SSH: ' + sshErr(exists), 502);
  if (exists.out.toString().trim() === 'yes') { if (!overwrite) throw err(`«${name}» уже есть на ${to.label}`, 409); await deleteSkill(to, name); }
  const pack = await run(TAR, ['-C', tmp, '-cf', '-', name], { timeout: 60000 });
  if (pack.code !== 0) throw new Error('tar: ' + pack.err);
  const r = await run('ssh', sshArgs(to.host, `mkdir -p ${remotePath(to)} && tar -C ${remotePath(to)} -xf -`), { input: pack.out, timeout: 120000 });
  if (r.code !== 0) throw err('SSH: ' + sshErr(r), 502);
}
async function pushAll(stage, name, targets, overwrite) {
  const results = [];
  for (const t of targets) { try { await pushFromTemp(stage, name, t, overwrite); results.push({ id: t.id, ok: true }); } catch (e) { results.push({ id: t.id, ok: false, error: e.message }); } }
  return results;
}
async function copySkill(from, name, targets, overwrite, disabled) {
  checkName(name);
  const tmp = await pullToTemp(from, name, disabled);
  try { return await pushAll(tmp, name, targets.filter((t) => t.id !== from.id), overwrite); } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
}
function template(name, description) {
  const title = name.replace(/[-_.]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const desc = String(description || '').replace(/\s+/g, ' ').trim() || `Use when … (опишите, в каких задачах агенту применять скилл «${name}»).`;
  return `---\nname: ${name}\ndescription: ${desc.includes(':') || desc.includes('#') ? JSON.stringify(desc) : desc}\n---\n\n# ${title}\n\n## Когда использовать\n\n- …\n\n## Порядок работы\n\n1. …\n2. …\n3. …\n\n## Проверка результата\n\n- …\n`;
}
async function createSkill(name, description, markdown, targets) {
  checkName(name);
  if (!targets.length) throw err('Выберите, куда создать скилл');
  const stage = await fsp.mkdtemp(path.join(os.tmpdir(), 'oly-skillnew-'));
  try {
    await fsp.mkdir(path.join(stage, name));
    const md = typeof markdown === 'string' && markdown.trim() ? markdown : template(name, description);
    if (md.length > 200000) throw err('SKILL.md слишком большой');
    await fsp.writeFile(path.join(stage, name, 'SKILL.md'), md);
    return await pushAll(stage, name, targets, false);
  } finally { await fsp.rm(stage, { recursive: true, force: true }); }
}

// ---------- skills.sh ----------
async function search(q) {
  const u = `https://skills.sh/api/search?q=${encodeURIComponent(q)}&limit=30`;
  const r = await fetch(u, { headers: { 'user-agent': 'skills-manager' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw err('skills.sh: ' + r.status, 502);
  const j = await r.json();
  return (j.skills || []).map((s) => ({ id: s.id, source: s.source, skillId: s.skillId, name: s.name, installs: s.installs }));
}
const SRC_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const repoCache = new Map(); // source -> {at, dir, promise}
async function repoDir(source) {
  if (!SRC_RE.test(source)) throw err('Некорректный источник');
  const c = repoCache.get(source);
  if (c && c.promise) return c.promise;
  if (c && Date.now() - c.at < 15 * 60000 && fs.existsSync(c.dir)) return c.dir;
  const promise = (async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'oly-skillsh-'));
    const r = await fetch(`https://codeload.github.com/${source}/tar.gz/HEAD`, { headers: { 'user-agent': 'skills-manager' }, signal: AbortSignal.timeout(90000) });
    if (!r.ok) throw err(`GitHub ${source}: ${r.status}`, 502);
    const tgz = path.join(tmp, 'repo.tgz');
    await fsp.writeFile(tgz, Buffer.from(await r.arrayBuffer()));
    const x = await run(TAR, ['-xzf', tgz, '-C', tmp], { timeout: 120000 });
    await fsp.rm(tgz, { force: true });
    if (x.code !== 0) throw new Error('tar: ' + x.err);
    if (c && c.dir) fsp.rm(c.dir, { recursive: true, force: true }).catch(() => {});
    repoCache.set(source, { at: Date.now(), dir: tmp });
    return tmp;
  })();
  repoCache.set(source, { ...(c || {}), promise });
  try { return await promise; } catch (e) { repoCache.delete(source); throw e; }
}
async function findInRepo(dir, skillId) {
  let found = null;
  async function walk(d, depth) {
    if (found || depth > 6) return;
    let ents = []; try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    if (ents.some((e) => e.isFile() && e.name === 'SKILL.md')) {
      const fm = frontmatter(await fsp.readFile(path.join(d, 'SKILL.md'), 'utf8'));
      if (path.basename(d) === skillId || fm.name === skillId) { found = d; return; }
    }
    for (const e of ents) if (e.isDirectory() && !e.name.startsWith('.git') && e.name !== 'node_modules') await walk(path.join(d, e.name), depth + 1);
  }
  await walk(dir, 0);
  return found;
}
async function stageFromSkillsSh(source, skillId, asName) {
  if (!SRC_RE.test(source) || !NAME_RE.test(skillId)) throw err('Некорректный источник');
  const found = await findInRepo(await repoDir(source), skillId);
  if (!found) throw err(`В ${source} не найден скилл ${skillId}`, 404);
  const stage = await fsp.mkdtemp(path.join(os.tmpdir(), 'oly-skillstage-'));
  await fsp.cp(found, path.join(stage, asName || skillId), { recursive: true });
  return stage;
}
async function registry() { return readJson(REGISTRY, {}); }
async function remember(name, source, skillId) { const r = await registry(); r[name] = { source, skillId, at: new Date().toISOString() }; await writeJson(REGISTRY, r); }
async function install(source, skillId, targets, overwrite, asName) {
  const name = checkName(asName || skillId);
  const stage = await stageFromSkillsSh(source, skillId, name);
  try { const results = await pushAll(stage, name, targets, overwrite); if (results.some((x) => x.ok)) await remember(name, source, skillId); return results; }
  finally { await fsp.rm(stage, { recursive: true, force: true }); }
}
// For each skill name: where it comes from on skills.sh (registry of our installs, else exact-name match in the catalog)
// and the content hash of the upstream folder — compared with installed copies in the UI.
async function upstream(names) {
  const reg = await registry();
  const out = {};
  const list = [...new Set(names.filter((n) => NAME_RE.test(n)))].slice(0, 80);
  const metas = await Promise.all(list.map(async (n) => {
    if (reg[n] && SRC_RE.test(reg[n].source)) return [n, { source: reg[n].source, skillId: reg[n].skillId, via: 'registry' }];
    try {
      const hits = (await search(n)).filter((s) => String(s.skillId).toLowerCase() === n.toLowerCase() && SRC_RE.test(s.source)).sort((a, b) => (b.installs || 0) - (a.installs || 0));
      return [n, hits[0] ? { source: hits[0].source, skillId: hits[0].skillId, installs: hits[0].installs, via: 'search' } : null];
    } catch (e) { return [n, { error: e.message }]; }
  }));
  for (const [n, m] of metas) {
    if (!m || m.error) { out[n] = m || null; continue; }
    try {
      const dir = await findInRepo(await repoDir(m.source), m.skillId);
      if (!dir) { out[n] = { ...m, error: 'нет в репозитории' }; continue; }
      const fm = frontmatter(await fsp.readFile(path.join(dir, 'SKILL.md'), 'utf8').catch(() => ''));
      out[n] = { ...m, hash: await skillHash(dir), description: (fm.description || '').slice(0, 400) };
    } catch (e) { out[n] = { ...m, error: e.message }; }
  }
  return out;
}

// ---------- HTTP ----------
const STATIC = { '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
const ALLOW = new Set(['t3code://app', 'http://localhost:3773', 'http://127.0.0.1:3773']);
function send(res, code, body, type = 'application/json; charset=utf-8', origin) {
  const h = { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
  if (origin && ALLOW.has(origin)) h['access-control-allow-origin'] = origin;
  res.writeHead(code, h);
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
async function body(req) { let s = ''; for await (const c of req) { s += c; if (s.length > 1e6) throw new Error('too large'); } return s ? JSON.parse(s) : {}; }
// Local prompt library. Serialize library operations so first access, edits and trash
// moves cannot interleave across windows using the same service.
const PROMPTS = process.env.OLY_PROMPTS_DIR || path.join(servicesData, 'prompts');
const PROMPT_TRASH = process.env.OLY_PROMPTS_TRASH || path.join(servicesData, 'caches', 'prompts-trash');
const PROMPT_LIMIT = 64 * 1024;
const MODES = ['', 'default', 'plan', 'brainstorm', 'bug-hunter', 'design-plan'];
const STARTERS = [
  ['статья-wp', 'Статья для WordPress Playground', 'Структура и вычитка для локального редактора', 'default', 'Подготовь материал по теме: {{cursor}}\nРазбей текст на разделы h2/h3, проверь факты и подготовь черновик для локального WordPress Playground.'],
  ['разбор-репо', 'Разбор репозитория', 'Точки входа, зависимости и проверка запуска', 'plan', 'Разбери репозиторий {{cursor}}. Найди точки входа и объясни на примере одного сценария, как связаны его модули. Укажи пути к файлам.'],
  ['бриф-по-доске', 'Бриф по доске', 'Решения, открытые вопросы и задачи', '', 'Составь бриф по доске {{cursor}}. Выдели цель, принятые решения и вопросы, на которые ещё нужен ответ.'],
  ['аудит-багов', 'Аудит багов', 'Проверка интерфейса и воспроизводимые дефекты', 'bug-hunter', 'Проверь пользовательский сценарий {{cursor}}. Для каждого подтверждённого дефекта запиши шаги, ожидаемый и фактический результат.'],
  ['бренд-кит', 'Бренд-кит', 'Палитра, типографика и примеры компонентов', 'design-plan', 'Разработай бренд-кит для {{cursor}}. Покажи палитру дня и ночи, шрифтовую пару и состояния основных компонентов.'],
];
function promptName(name) {
  if (typeof name !== 'string' || !/^[a-zа-яё0-9][a-zа-яё0-9_-]{0,63}$/u.test(name) ||
      /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(name)) throw err('Имя шаблона: до 64 строчных букв, цифр, дефисов и подчёркиваний');
  return name;
}
function promptValue(input) {
  if (!input || typeof input !== 'object') throw err('Ожидается шаблон');
  const {name, title, description = '', mode = '', body} = input;
  promptName(name);
  if (typeof title !== 'string' || !title.trim() || title.length > 120 ||
      typeof description !== 'string' || description.length > 350 ||
      /[\x00-\x1f\x7f]/.test(title + description)) throw err('Проверьте заголовок и описание');
  if (!MODES.includes(mode)) throw err('Неизвестный режим');
  if (typeof body !== 'string' || !body.trim() || body.includes('\0')) throw err('Введите текст шаблона');
  if (Buffer.byteLength(body) > PROMPT_LIMIT) throw err('Текст шаблона больше 64 КиБ', 413);
  return {name, title, description, mode, body};
}
function encodePrompt({name,title,description,mode,body}) {
  return ['---', 'name: ' + name, 'title: ' + JSON.stringify(title), 'description: ' + JSON.stringify(description),
    'mode: ' + mode, '---', body].join('\n');
}
const revisionOf = data => crypto.createHash('sha256').update(data).digest('hex');
async function libraryDir(dir) {
  await fsp.mkdir(dir, {recursive:true});
  if (path.relative(resolveServicePath(dir), await fsp.realpath(dir))) throw err('Недопустимая ссылка на каталог шаблонов');
}
let promptQueue = Promise.resolve();
function inLibrary(operation) {
  const result = promptQueue.then(async () => {
    await libraryDir(PROMPTS);
    const flag = path.join(PROMPTS, '.initialized');
    if (!fs.existsSync(flag)) {
      const entries = await fsp.readdir(PROMPTS);
      const pending = path.join(PROMPTS, '.seeding');
      if (!entries.length || entries.includes('.seeding')) {
        if (!entries.length) await fsp.writeFile(pending, '', {flag:'wx'});
        for (const [name,title,description,mode,body] of STARTERS) {
          try { await fsp.writeFile(path.join(PROMPTS, name + '.md'), encodePrompt({name,title,description,mode,body}), {flag:'wx'}); }
          catch (e) { if (e.code !== 'EEXIST') throw e; }
        }
        await fsp.rename(pending, flag);
      } else await fsp.writeFile(flag, '', {flag:'wx'});
    }
    return operation();
  });
  promptQueue = result.catch(() => {});
  return result;
}
async function readPrompt(name) {
  const file = path.join(PROMPTS, promptName(name) + '.md');
  const stat = await fsp.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw err('Недопустимый файл шаблона');
  if (stat.size > PROMPT_LIMIT + 4096) throw err('Слишком большой файл шаблона', 413);
  const raw = await fsp.readFile(file, 'utf8');
  const header = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  if (!header) throw err('В файле шаблона отсутствует заголовок');
  const fields = {};
  for (const line of header[1].split(/\r?\n/)) {
    const m = /^(name|title|description|mode):[ \t]*(.*)$/.exec(line);
    if (!m) continue;
    const v = m[2].trim();
    fields[m[1]] = v.startsWith('"') ? JSON.parse(v) : v.replace(/^'(.*)'$/, '$1').replace(/''/g, "'");
  }
  if (fields.name !== name) throw err('Имя в заголовке не совпадает с именем файла');
  return {...promptValue({...fields, body:raw.slice(header[0].length)}), revision:revisionOf(raw)};
}
async function listPrompts() {
  const prompts = [], skipped = [];
  for (const entry of await fsp.readdir(PROMPTS, {withFileTypes:true})) {
    if (!entry.name.endsWith('.md')) continue;
    try { prompts.push(await readPrompt(entry.name.slice(0,-3))); }
    catch (e) { if (e.code !== 'ENOENT') skipped.push(entry.name); }
  }
  return {prompts:prompts.sort((a,b) => a.name.localeCompare(b.name,'ru')), skipped};
}
async function changePrompt(input, deleting) {
  const name = promptName(input?.name);
  const file = path.join(PROMPTS, name + '.md');
  let existing;
  try { existing = await readPrompt(name); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (deleting && !existing) throw err('Шаблон не найден', 404);
  if (input.revision !== undefined && (existing?.revision ?? null) !== input.revision) throw err('Шаблон изменился. Откройте актуальную версию.', 409);
  if (deleting) {
    await libraryDir(PROMPT_TRASH);
    await fsp.rename(file, path.join(PROMPT_TRASH, name + '-' + crypto.randomUUID() + '.md'));
    return {ok:true};
  }
  const prompt = promptValue(input);
  const raw = encodePrompt(prompt);
  const tmp = path.join(PROMPTS, '.' + crypto.randomUUID() + '.tmp');
  await fsp.writeFile(tmp, raw, {flag:'wx'});
  try { await fsp.rename(tmp, file); } finally { await fsp.rm(tmp, {force:true}); }
  return {...prompt, revision:revisionOf(raw)};
}
async function promptRoute(req, res, pathname) {
  const origin = req.headers.origin;
  if (origin && !ALLOW.has(origin) && origin !== 'http://127.0.0.1:' + PORT) return send(res,403,{error:'Недопустимый источник'});
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {'access-control-allow-origin':origin || '', 'access-control-allow-headers':'content-type, x-oly',
      'access-control-allow-methods':'GET, POST', vary:'Origin'});
    return res.end();
  }
  try {
    if (req.method === 'GET' && pathname === '/api/prompts') return send(res,200,await inLibrary(listPrompts),undefined,origin);
    if (req.method !== 'POST') throw err('Метод не поддерживается',405);
    if (req.headers['x-oly'] !== '1') throw err('Требуется заголовок x-oly',403);
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > PROMPT_LIMIT * 6 + 8192) throw err('Запрос слишком большой',413);
      chunks.push(chunk);
    }
    let input;
    try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw err('Некорректный JSON'); }
    return send(res,200,await inLibrary(() => changePrompt(input, pathname.endsWith('/delete'))),undefined,origin);
  } catch (e) { return send(res,e.status || 500,{error:e.message},undefined,origin); }
}

const server = http.createServer(async (req, res) => {
  if (!['127.0.0.1:' + PORT, 'localhost:' + PORT].includes(req.headers.host)) { res.writeHead(403); return res.end(); }
  try {
    const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (u.pathname === '/api/prompts' || u.pathname === '/api/prompts/delete') return await promptRoute(req,res,u.pathname);
    const origin = req.method === 'GET' ? req.headers.origin : null;
    if (req.method === 'GET' && STATIC[u.pathname]) { const [f, t] = STATIC[u.pathname]; return send(res, 200, await fsp.readFile(path.join(HERE, f)), t); }
    if (!u.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    // Mutations only from our own page: the custom header forces a CORS preflight that we never approve.
    if (req.method !== 'GET' && req.headers['x-oly'] !== '1' && req.headers['x-oly-skills'] !== '1') return send(res, 403, { error: 'forbidden' });
    const p = u.searchParams, force = p.get('refresh') === '1';
    if (u.pathname === '/api/health') return send(res, 200, { ok: true, port: PORT }, undefined, origin);
    if (req.method === 'GET') {
      if (u.pathname === '/api/locations') return send(res, 200, await locations(force));
      if (u.pathname === '/api/skills') return send(res, 200, await listSkills(await loc(p.get('loc')), force));
      if (u.pathname === '/api/host') { const h = p.get('host'); if (!HOST_RE.test(h || '') || !sshHosts().includes(h)) throw err('Неизвестный сервер'); return send(res, 200, await listHost(h, force)); }
      if (u.pathname === '/api/hashes') return send(res, 200, await hashes(await loc(p.get('loc')), force));
      if (u.pathname === '/api/skill') return send(res, 200, await readSkill(await loc(p.get('loc')), p.get('name'), p.get('disabled') === '1'));
      if (u.pathname === '/api/file') return send(res, 200, await readSkillFile(await loc(p.get('loc')), p.get('name'), p.get('disabled') === '1', p.get('path')));
      if (u.pathname === '/api/search') return send(res, 200, await search(p.get('q') || ''));
      if (u.pathname === '/api/registry') return send(res, 200, await registry());
      if (u.pathname === '/api/template') return send(res, 200, { markdown: template(checkName(p.get('name') || 'my-skill'), p.get('description') || '') });
    }
    if (req.method === 'POST') {
      const b = await body(req);
      const targets = async () => Promise.all((b.to || []).map(loc));
      if (u.pathname === '/api/delete') return send(res, 200, await deleteSkill(await loc(b.loc), b.name, !!b.disabled));
      if (u.pathname === '/api/write') return send(res, 200, await writeSkillFile(await loc(b.loc), b.name, !!b.disabled, b.path || 'SKILL.md', b.content));
      if (u.pathname === '/api/toggle') return send(res, 200, await toggleSkill(await loc(b.loc), b.name, !!b.enable));
      if (u.pathname === '/api/copy') return send(res, 200, { results: await copySkill(await loc(b.from), b.name, await targets(), !!b.overwrite, !!b.disabled) });
      if (u.pathname === '/api/install') return send(res, 200, { results: await install(b.source, b.skillId, await targets(), !!b.overwrite, b.name) });
      if (u.pathname === '/api/create') return send(res, 200, { results: await createSkill(b.name, b.description, b.markdown, await targets()) });
      if (u.pathname === '/api/upstream') return send(res, 200, await upstream(Array.isArray(b.names) ? b.names : []));
      if (u.pathname === '/api/reveal') { const l = await loc(b.loc); if (l.kind === 'local') { const dir = b.name && NAME_RE.test(b.name) ? localDir(l, b.name, !!b.disabled) : l.path; await fsp.mkdir(l.path, { recursive: true }); spawn(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open', [dir], { detached: true, windowsHide: false }).unref(); } return send(res, 200, { ok: true }); }
    }
    send(res, 404, { error: 'not found' });
  } catch (e) { send(res, e.status || 500, { error: e.message || String(e) }); }
});
server.listen(PORT, '127.0.0.1', () => { console.log(`skills manager on http://127.0.0.1:${server.address().port}`); refreshTunnels(); });
