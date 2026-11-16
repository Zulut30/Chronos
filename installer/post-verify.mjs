// Post-install verification of Olympus v3 against the LIVE system (installed files, restarted T3 server, services, MCP, UI).
// Read-only except: one short-lived read-only T3 pairing session (revoked by ui-check.mjs). No paid API calls.
// Usage: node post-verify.mjs [before-runtime.json]   -> writes post-verify.json next to this script, exit 0 only if all pass.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const R = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.dirname(R);
const manifest = JSON.parse(fs.readFileSync(path.join(R, 'patch-manifest.json'), 'utf8'));
const before = process.argv[2] && fs.existsSync(process.argv[2]) ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^﻿/, '')) : null;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = (p) => (fs.existsSync(p) ? sha(fs.readFileSync(p)) : null);
const checks = [];
const check = (name, pass, detail) => { checks.push({ name, pass: !!pass, ...(detail === undefined ? {} : { detail }) }); };
const safe = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, String(e && e.message || e).slice(0, 400)); } };

// asar reader for the expected bytes of changed client assets
function asarFiles(file) {
  const fd = fs.openSync(file, 'r'); const h = Buffer.alloc(16); fs.readSync(fd, h, 0, 16, 0);
  const size = h.readUInt32LE(4), jsonLen = h.readUInt32LE(12); const j = Buffer.alloc(jsonLen); fs.readSync(fd, j, 0, jsonLen, 16);
  const tree = JSON.parse(j.toString('utf8')), base = 8 + size, out = new Map();
  (function walk(t, p) { for (const [n, v] of Object.entries(t.files || {})) { const q = p + '/' + n; if (v.files) walk(v, q); else out.set(q, v); } })(tree, '');
  return { get(p) { const n = out.get(p); const b = Buffer.alloc(n.size); fs.readSync(fd, b, 0, n.size, base + Number(n.offset)); return b; }, close() { fs.closeSync(fd); } };
}

function mcpSession(script, { cwd = os.homedir() } = {}) {
  const child = spawn(process.execPath, [script], { cwd, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  let buf = '', id = 0; const wait = new Map();
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { let m; try { m = JSON.parse(buf.slice(0, i)); } catch {} buf = buf.slice(i + 1); if (m && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } } });
  const rpc = (method, params) => new Promise((res, rej) => { const n = ++id; const t = setTimeout(() => rej(new Error('timeout ' + method)), 60000); wait.set(n, (m) => { clearTimeout(t); res(m); }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
  const call = async (name, args) => { const r = (await rpc('tools/call', { name, arguments: args })).result; return { isError: !!r.isError, text: r.content?.[0]?.text || '' }; };
  return { rpc, call, close: () => { child.stdin.end(); setTimeout(() => child.kill(), 2000).unref(); } };
}
const listenerPid = (port) => { try { return Number(execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction Stop | Select-Object -First 1).OwningProcess`], { encoding: 'utf8', windowsHide: true }).trim()) || null; } catch { return null; } };
const startTime = (pid) => { try { return execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().ToString('o')`], { encoding: 'utf8', windowsHide: true }).trim(); } catch { return null; } };

// 1. installed files
await safe('installed_archive_hash', () => check('installed_archive_hash', fileSha(manifest.originalArchive) === manifest.patchedSha256, manifest.patchedSha256));
await safe('installed_service_hashes', () => { const bad = manifest.serviceFiles.filter((s) => fileSha(s.destination) !== s.sha256).map((s) => s.destination); check('installed_service_hashes', !bad.length, bad.length ? bad : `${manifest.serviceFiles.length} files`); });
await safe('installed_state', () => { const s = JSON.parse(fs.readFileSync(path.join(R, 'installed-state.json'), 'utf8')); check('installed_state', s.installed && s.archiveSha256 === manifest.patchedSha256, s.mcp); });

// 2. restarted server identity
const runtime = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.t3', 'userdata', 'server-runtime.json'), 'utf8'));
await safe('server_restarted', () => check('server_restarted', !before || (runtime.startedAt !== before.startedAt && runtime.pid !== before.pid), { before: before && { pid: before.pid, startedAt: before.startedAt }, now: { pid: runtime.pid, startedAt: runtime.startedAt } }));
await safe('server_version', () => check('server_version', runtime.serverVersion === manifest.version, runtime.serverVersion));
await safe('server_started_after_install', () => { const st = fs.statSync(path.join(R, 'installed-state.json')).mtimeMs; check('server_started_after_install', Date.parse(runtime.startedAt) > st, { installedAt: new Date(st).toISOString(), startedAt: runtime.startedAt }); });

// 3. new client assets actually served by the running server
await safe('client_assets_served', async () => {
  const a = asarFiles(manifest.stagedArchive); const res = [];
  for (const p of manifest.changed.filter((x) => x.includes('/client/assets/'))) {
    const r = await fetch(runtime.origin + '/assets/' + p.split('/').pop(), { cache: 'no-store' });
    const body = Buffer.from(await r.arrayBuffer());
    res.push({ asset: p.split('/').pop(), status: r.status, same: sha(body) === sha(a.get(p)) });
  }
  a.close();
  check('client_assets_served', res.every((x) => x.status === 200 && x.same), res);
});

// 4. local services (restarted processes, new APIs)
const helperStart = before && before.helperStartedAt ? Date.parse(before.helperStartedAt) : 0;
await safe('tasks_service', async () => {
  const h = await (await fetch('http://127.0.0.1:4518/api/health')).json();
  const projects = await (await fetch('http://127.0.0.1:4518/api/projects')).json();
  const pid = listenerPid(4518), st = pid && startTime(pid);
  check('tasks_service', h.service === 'oly-tasks' && Array.isArray(projects) && projects.every((p) => 'icon' in p) && (!helperStart || Date.parse(st) > helperStart),
    { projects: projects.length, withImageIcon: projects.filter((p) => p.icon && p.icon.kind === 'image').length, pid, startedAt: st });
});
await safe('skills_service', async () => {
  const page = await (await fetch('http://127.0.0.1:4517/')).text();
  const r = await fetch('http://127.0.0.1:4517/api/file?loc=__probe__&name=x&path=SKILL.md');
  const j = await r.json();
  const pid = listenerPid(4517), st = pid && startTime(pid);
  check('skills_service', page.includes('skill-toolbar') && r.status === 400 && /Неизвестное расположение/.test(j.error) && (!helperStart || Date.parse(st) > helperStart), { fileApi: r.status, pid, startedAt: st });
});

// 5. MCP servers: initialize, tools/list, safe read calls
await safe('mcp_oly_skills', async () => {
  const m = mcpSession(path.join(BASE, 'skills-manager', 'mcp.mjs'));
  try {
    const init = await m.rpc('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'post-verify' } });
    const tools = (await m.rpc('tools/list', {})).result.tools.map((t) => t.name);
    const locs = await m.call('list_locations', { kind: 'local' });
    const list = await m.call('list_skills', { location: 'claude' });
    const first = /^- (\S+)/m.exec(list.text)?.[1];
    const read = first ? await m.call('read_skill', { location: 'claude', name: first }) : { isError: true, text: 'no skills' };
    const file = first ? await m.call('read_skill_file', { location: 'claude', name: first, path: 'SKILL.md' }) : { isError: true };
    check('mcp_oly_skills', init.result?.serverInfo?.name === 'oly-skills' && tools.length === 13 && !locs.isError && !list.isError && !read.isError && !file.isError,
      { tools: tools.length, sampleSkill: first, skillsListed: (list.text.match(/^- /gm) || []).length });
  } finally { m.close(); }
});
for (const [name, script, expectTool] of [['mcp_oly_tasks', 'tasks-service/mcp.mjs', 'list_tasks'], ['mcp_oly_web', 'integrations-service/mcp.mjs', 'hackernews_search'], ['mcp_openrouter', 'openrouter-service/server.mjs', null]]) {
  await safe(name, async () => {
    const m = mcpSession(path.join(BASE, script));
    try {
      await m.rpc('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'post-verify' } });
      const tools = (await m.rpc('tools/list', {})).result.tools.map((t) => t.name);
      const extra = name === 'mcp_oly_tasks' ? await m.call('list_projects', {}) : null;
      check(name, tools.length > 0 && (!expectTool || tools.includes(expectTool)) && (!extra || !extra.isError), { tools: tools.length });
    } finally { m.close(); }
  });
}

// 6. agent registrations
await safe('claude_registration', () => { const out = execFileSync(path.join(os.homedir(), '.local', 'bin', 'claude.exe'), ['mcp', 'get', 'oly-skills'], { encoding: 'utf8', timeout: 90000, windowsHide: true }); check('claude_registration', /Connected/.test(out) && out.includes('skills-manager'), out.split('\n').slice(0, 3).join(' | ')); });
await safe('codex_registration', () => { const out = execFileSync('cmd.exe', ['/d', '/s', '/c', 'codex', 'mcp', 'get', 'oly-skills'], { encoding: 'utf8', timeout: 90000, windowsHide: true }); check('codex_registration', /enabled: true/.test(out) && out.includes('skills-manager'), out.split('\n').slice(0, 2).join(' | ')); });

// 7. real UI of the running client
await safe('ui_runtime', () => {
  let out; try { out = execFileSync(process.execPath, [path.join(R, 'test-work', 'ui-check.mjs'), path.join(R, 'ui-check.json')], { encoding: 'utf8', timeout: 180000, windowsHide: true }); } catch (e) { out = e.stdout || String(e); }
  const j = JSON.parse(fs.readFileSync(path.join(R, 'ui-check.json'), 'utf8'));
  check('ui_runtime', j.ok, { ...j.checks, revokedSessions: j.revokedSessions, error: j.error });
});

const result = { at: new Date().toISOString(), ok: checks.every((c) => c.pass), passed: checks.filter((c) => c.pass).length, total: checks.length, checks };
fs.writeFileSync(path.join(R, 'post-verify.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ok: result.ok, passed: result.passed, total: result.total, failed: checks.filter((c) => !c.pass).map((c) => c.name) }));
process.exit(result.ok ? 0 : 1);
