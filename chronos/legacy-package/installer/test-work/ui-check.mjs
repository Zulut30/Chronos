// Real UI check of the running T3 web client (http://127.0.0.1:3773) in headless Edge via CDP.
// Uses a short-lived read-only pairing token and a throw-away browser profile; the session is revoked afterwards.
// Usage: node ui-check.mjs [out.json]
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OUT = process.argv[2];
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const T3 = path.join(os.homedir(), '.t3', 'bin', 't3.cmd');
const LABEL = 'olympus-v3-verify';
const PORT = 9339;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t3 = (...args) => execFileSync('cmd.exe', ['/d', '/s', '/c', T3, ...args], { encoding: 'utf8', timeout: 60000, windowsHide: true });
const result = { at: new Date().toISOString(), ok: false, checks: {} };
let edge, profile;

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0; const wait = new Map();
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const n = ++id; wait.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value; };
  return { send, evaluate, close: () => ws.close() };
}

try {
  const pair = JSON.parse(t3('auth', 'pairing', 'create', '--scope', 'orchestration:read', '--ttl', '5m', '--label', LABEL, '--base-url', 'http://127.0.0.1:3773', '--json'));
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'oly-ui-check-'));
  edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, '--window-size=1400,900', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  let target;
  for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {} }
  if (!target) throw new Error('Edge DevTools did not start');
  const page = await cdp(target.webSocketDebuggerUrl);
  await page.send('Page.enable'); await page.send('Runtime.enable');
  await page.send('Page.navigate', { url: pair.pairUrl });
  let ready = false;
  for (let i = 0; i < 90 && !ready; i++) { await sleep(500); ready = await page.evaluate(`!!document.querySelector('[data-testid=composer-editor], .composer-tiptap, [contenteditable=true]')`); }
  result.checks.composerRendered = ready;
  await sleep(2500); // let feature scripts attach
  Object.assign(result.checks, await page.evaluate(`(() => ({
    url: location.pathname + location.hash,
    featureGlobals: ['__olyReferences','__olyMentions','__olyMachines','__olyStudio','__olyOpenRouter'].filter(k => globalThis[k] !== undefined),
    placeholderV3: [...document.querySelectorAll('[data-placeholder], [placeholder], p')].some(e => /@ контекст, # задачи, ! поиск/.test((e.getAttribute('data-placeholder')||'') + (e.getAttribute('placeholder')||'') + e.textContent)) || document.body.innerHTML.includes('@ контекст, # задачи'),
    sidebarSkills: /Скиллы/.test(document.body.innerText) || !!document.querySelector('[title*="Скилл"],[aria-label*="Скилл"]'),
    sidebarTasks: /Задачи/.test(document.body.innerText),
    russianUi: /Новый тред|Новая|Настройки/.test(document.body.innerText),
    errorsOverlay: !!document.querySelector('[data-nextjs-dialog], vite-error-overlay')
  }))()`));
  // Type "@" into the composer and confirm the compact context tabs (Files / Servers / Models) appear, then clear it.
  const focused = await page.evaluate(`(() => { const e = document.querySelector('[data-testid=composer-editor], .composer-tiptap'); if (!e) return false; e.focus(); return true })()`);
  if (focused) {
    await page.send('Input.insertText', { text: '@' });
    let tabs = null;
    for (let i = 0; i < 20 && !tabs; i++) { await sleep(250); tabs = await page.evaluate(`(() => { const n = document.querySelector('.oly-context-tabs'); return n ? [...n.children].map(b => b.textContent) : null })()`); }
    result.checks.mentionTabs = tabs;
    result.checks.mentionView = await page.evaluate(`document.querySelector('[data-oly-mention-view]')?.getAttribute('data-oly-mention-view') || null`);
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  }
  const consoleErrors = await page.evaluate(`(window.__olyErrors || []).length`);
  result.checks.consoleErrors = consoleErrors;
  page.close();
  const c = result.checks;
  result.ok = !!(c.composerRendered && c.featureGlobals.includes('__olyReferences') && c.placeholderV3 && Array.isArray(c.mentionTabs) && c.mentionTabs.length === 3);
} catch (e) {
  result.error = String(e && e.message || e);
} finally {
  try { edge?.kill(); } catch {}
  await sleep(1500);
  // Revoke every session created through this check's pairing label; never touch other sessions.
  try {
    const sessions = JSON.parse(t3('auth', 'session', 'list', '--json'));
    const list = Array.isArray(sessions) ? sessions : sessions.sessions || [];
    const mine = list.filter((s) => s.client?.label === LABEL && s.subject === 'one-time-token');
    for (const s of mine) t3('auth', 'session', 'revoke', s.sessionId);
    result.revokedSessions = mine.length;
  } catch (e) { result.revokeError = String(e.message || e).slice(0, 300); }
  try { if (profile) fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch {}
  const text = JSON.stringify(result, null, 2);
  if (OUT) fs.writeFileSync(OUT, text);
  console.log(text);
  process.exit(result.ok ? 0 : 1);
}
