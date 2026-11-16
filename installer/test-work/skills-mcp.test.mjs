// Isolated test of the oly-skills MCP server + staged skills-manager service.
// Uses a throw-away fake home (USERPROFILE/HOME) and port 4597, so real user skills are never touched. No network calls.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const PORT = 4597;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oly-skills-fixture-'));
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'oly-skills-code-'));
let svc, mcp, nextId = 1; const pending = new Map();
const env = { ...process.env, USERPROFILE: home, HOME: home, OLY_SKILLS_PORT: String(PORT), OLY_SKILLS_URL: `http://127.0.0.1:${PORT}` };
const skill = (dir, name, desc, extra = {}) => { fs.mkdirSync(path.join(dir, name), { recursive: true }); fs.writeFileSync(path.join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}\n`); for (const [f, t] of Object.entries(extra)) { fs.mkdirSync(path.dirname(path.join(dir, name, f)), { recursive: true }); fs.writeFileSync(path.join(dir, name, f), t); } };
const rpc = (method, params) => new Promise((resolve, reject) => { const id = nextId++; const t = setTimeout(() => reject(new Error('MCP timeout: ' + method)), 20000); pending.set(id, (m) => { clearTimeout(t); resolve(m); }); mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
const tool = async (name, args) => { const r = await rpc('tools/call', { name, arguments: args }); return { text: r.result.content[0].text, error: !!r.result.isError }; };

before(async () => {
  // The service runs from a copy laid out like the live skills-manager folder (server.mjs + mcp.mjs side by side).
  fs.copyFileSync(path.join(SRC, 'skills-server.mjs'), path.join(stage, 'server.mjs'));
  fs.copyFileSync(path.join(SRC, 'skills-mcp.mjs'), path.join(stage, 'mcp.mjs'));
  const claude = path.join(home, '.claude', 'skills');
  skill(claude, 'alpha-tool', 'Use when testing alpha flows', { 'references/notes.md': 'alpha notes', 'bin.dat': Buffer.from([1, 0, 2]) });
  skill(claude, 'beta-writer', 'Writing helper for beta docs');
  skill(path.join(home, '.claude', 'skills.disabled'), 'gamma-off', 'Disabled gamma');
  fs.writeFileSync(path.join(home, 'outside-secret.txt'), 'secret');
  svc = spawn(process.execPath, ['server.mjs'], { cwd: stage, env, stdio: 'ignore', windowsHide: true });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 150)); }
  mcp = spawn(process.execPath, [path.join(stage, 'mcp.mjs')], { cwd: home, env, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
  let buf = '';
  mcp.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); pending.get(m.id)?.(m); pending.delete(m.id); } });
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'test' } });
  assert.equal(init.result.serverInfo.name, 'oly-skills');
});
const exited = (p) => (p && p.exitCode === null ? new Promise((r) => p.once('exit', r)) : Promise.resolve());
after(async () => {
  mcp?.stdin.end(); svc?.kill(); mcp?.kill();
  await Promise.all([exited(mcp), exited(svc)]);
  for (const d of [home, stage]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test('tools_list_exposes_scoped_tools_only', async () => {
  const names = (await rpc('tools/list', {})).result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['check_updates', 'copy_skill', 'create_skill', 'install_skill', 'list_locations', 'list_skills', 'read_skill', 'read_skill_file', 'search_catalog', 'set_skill_enabled', 'trash_skill', 'update_skill', 'write_skill_file']);
});
test('locations_and_listing_with_search', async () => {
  const locs = await tool('list_locations', {});
  assert.match(locs.text, /local:user:claude/); assert.match(locs.text, /local:user:codex/);
  const all = await tool('list_skills', { location: 'claude' });
  assert.match(all.text, /alpha-tool/); assert.match(all.text, /gamma-off \[отключён\]/);
  const q = await tool('list_skills', { location: 'claude', query: 'beta docs' });
  assert.match(q.text, /beta-writer/); assert.doesNotMatch(q.text, /alpha-tool/);
});
test('read_skill_and_files', async () => {
  const r = await tool('read_skill', { location: 'claude', name: 'alpha-tool' });
  assert.match(r.text, /references\/notes\.md/); assert.match(r.text, /# alpha-tool/);
  assert.equal((await tool('read_skill_file', { location: 'claude', name: 'alpha-tool', path: 'references/notes.md' })).text, 'alpha notes');
  assert.match((await tool('read_skill_file', { location: 'claude', name: 'alpha-tool', path: 'bin.dat' })).text, /двоичный/);
  const off = await tool('read_skill', { location: 'claude', name: 'gamma-off' });
  assert.match(off.text, /\[отключён\]/);
});
test('path_traversal_and_bad_input_rejected_with_actionable_errors', async () => {
  for (const p of ['../../outside-secret.txt', '..\\..\\outside-secret.txt', 'C:/Windows/win.ini', '/etc/passwd']) {
    const r = await tool('read_skill_file', { location: 'claude', name: 'alpha-tool', path: p });
    assert.ok(r.error); assert.match(r.text, /Некорректный путь/);
  }
  const loc = await tool('read_skill', { location: 'nowhere', name: 'alpha-tool' });
  assert.ok(loc.error); assert.match(loc.text, /list_locations/);
  const missing = await tool('read_skill', { location: 'claude', name: 'no-such' });
  assert.ok(missing.error); assert.match(missing.text, /list_skills/);
  const bad = await tool('create_skill', { name: '../evil', locations: ['claude'] });
  assert.ok(bad.error); assert.match(bad.text, /Некорректное имя/);
});
test('write_skill_file_backs_up_previous_version', async () => {
  const r = await tool('write_skill_file', { location: 'claude', name: 'beta-writer', content: '---\nname: beta-writer\ndescription: v2\n---\nnew body\n' });
  assert.ok(!r.error, r.text);
  assert.match(fs.readFileSync(path.join(home, '.claude', 'skills', 'beta-writer', 'SKILL.md'), 'utf8'), /new body/);
  const trash = path.join(home, '.t3', 'caches', 'skills-trash');
  const bk = fs.readdirSync(trash).find((d) => d.endsWith('-claude-beta-writer-before-edit'));
  assert.ok(bk); assert.match(fs.readFileSync(path.join(trash, bk, 'SKILL.md'), 'utf8'), /Writing helper/);
  const add = await tool('write_skill_file', { location: 'claude', name: 'beta-writer', path: 'references/extra.md', content: 'x' });
  assert.ok(!add.error, add.text);
  assert.ok((await tool('write_skill_file', { location: 'claude', name: 'beta-writer', content: '  ' })).error);
});
test('create_toggle_copy_sync_and_trash', async () => {
  const c = await tool('create_skill', { name: 'delta-new', description: 'Use when delta', locations: ['claude'] });
  assert.ok(!c.error, c.text); assert.ok(fs.existsSync(path.join(home, '.claude', 'skills', 'delta-new', 'SKILL.md')));
  const dup = await tool('create_skill', { name: 'delta-new', locations: ['claude'] });
  assert.ok(dup.error); assert.match(dup.text, /overwrite: true/);
  assert.ok(!(await tool('set_skill_enabled', { location: 'claude', name: 'delta-new', enabled: false })).error);
  assert.ok(fs.existsSync(path.join(home, '.claude', 'skills.disabled', 'delta-new')));
  assert.match((await tool('set_skill_enabled', { location: 'claude', name: 'delta-new', enabled: false })).text, /уже отключён/);
  assert.ok(!(await tool('set_skill_enabled', { location: 'claude', name: 'delta-new', enabled: true })).error);
  const cp = await tool('copy_skill', { from: 'claude', name: 'alpha-tool', to: ['codex'] });
  assert.ok(!cp.error, cp.text); assert.ok(fs.existsSync(path.join(home, '.codex', 'skills', 'alpha-tool', 'references', 'notes.md')));
  const again = await tool('copy_skill', { from: 'claude', name: 'alpha-tool', to: ['codex'] });
  assert.ok(again.error); assert.match(again.text, /overwrite: true/);
  const sync = await tool('copy_skill', { from: 'claude', name: 'alpha-tool', to: ['codex'], overwrite: true });
  assert.ok(!sync.error, sync.text);
  const t = await tool('trash_skill', { location: 'codex', name: 'alpha-tool' });
  assert.ok(!t.error, t.text); assert.ok(!fs.existsSync(path.join(home, '.codex', 'skills', 'alpha-tool')));
  assert.ok(fs.readdirSync(path.join(home, '.t3', 'caches', 'skills-trash')).filter((d) => d.endsWith('-codex-alpha-tool')).length >= 2);
});
test('existing_ui_endpoints_unchanged', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/skills?loc=local:user:claude`); assert.equal(r.status, 200);
  const w = await fetch(`http://127.0.0.1:${PORT}/api/write`, { method: 'POST', body: '{}' }); assert.equal(w.status, 403); // mutations still need the private header
});
