// Post-install check of the board-to-chat update on the LIVE system. Usage: node post-verify.mjs <restart-before.json>
// 1 installed archive hash, 2 new T3 server process, 3 served main bundle == staged one, 4 studio service + endpoint,
// 5 real UI e2e (verify-e2e.mjs: board page "#send=1&to=e2e" -> service -> composer of a headless read-only T3 session).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const U = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const m = JSON.parse(fs.readFileSync(path.join(U, 'manifest.json'), 'utf8'));
const before = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
const runtime = JSON.parse(fs.readFileSync('C:\\Users\\zulut\\.t3\\userdata\\server-runtime.json', 'utf8').replace(/^\uFEFF/, ''));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const out = { at: new Date().toISOString(), checks: [] };
const check = (name, ok, detail) => out.checks.push({ name, ok: !!ok, detail });
const safe = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, String(e && e.message || e).slice(0, 300)); } };

await safe('installed_archive', () => check('installed_archive', sha(fs.readFileSync(m.live)) === m.stagedSha256, m.stagedSha256));
await safe('server_restarted', () => check('server_restarted', runtime.pid !== before.pid && runtime.startedAt !== before.startedAt, { before: before.pid, now: runtime.pid, startedAt: runtime.startedAt }));
await safe('served_main_bundle', async () => {
  const r = await fetch(runtime.origin + '/assets/main-lxHaZZx7.js', { cache: 'no-store' });
  const b = Buffer.from(await r.arrayBuffer());
  check('served_main_bundle', r.status === 200 && sha(b) === m.mainSha256 && b.includes('attachBoard') && b.includes('__olyBrand'), { status: r.status, same: sha(b) === m.mainSha256 });
});
await safe('studio_service', async () => {
  const h = await (await fetch('http://127.0.0.1:4520/api/health')).json();
  const r = await fetch('http://127.0.0.1:4520/api/chat/send', { method: 'POST', headers: { 'x-oly': '1', 'content-type': 'application/json' }, body: JSON.stringify({ board: 'C:\\nope\\missing.excalidraw' }) });
  check('studio_service', h.ok && r.status === 404, { health: h, chatEndpointStatus: r.status });
});
await safe('ui_e2e', () => {
  const txt = execFileSync(process.execPath, [path.join(U, 'verify-e2e.mjs')], { encoding: 'utf8', timeout: 240000, windowsHide: true });
  const j = JSON.parse(txt.slice(txt.indexOf('{')));
  check('ui_e2e', j.ok && j.mode === 'installed', j);
});
out.ok = out.checks.every((c) => c.ok);
out.passed = out.checks.filter((c) => c.ok).length; out.total = out.checks.length;
fs.writeFileSync(path.join(U, 'post-verify.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ok: out.ok, passed: out.passed, total: out.total, failed: out.checks.filter((c) => !c.ok).map((c) => c.name) }));
process.exit(out.ok ? 0 : 1);
