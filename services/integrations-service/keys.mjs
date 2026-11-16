// Shared catalog of web-data integrations + API-key storage in Windows user environment variables (HKCU\Environment).
// Key values never leave this module except as request auth; nothing here logs or writes them to files.
import { spawn } from 'node:child_process';

export const INTEGRATIONS = [
  { id: 'scrapedo', name: 'Scrape.do', env: 'SCRAPEDO_API_KEY',
    description: 'Парсинг страниц (в т. ч. с JS-рендерингом) и поиск Google для агентов.',
    url: 'https://scrape.do/', docs: 'https://scrape.do/documentation/',
    pricing: 'страница — 1 кредит, с JS — 5; поиск Google — 10',
    tools: ['web_search', 'scrape_page'] },
  { id: 'getxapi', name: 'GetXAPI', env: 'GETXAPI_API_KEY',
    description: 'Поиск по X (Twitter), профили, ленты пользователей и ответы.',
    url: 'https://www.getxapi.com/', docs: 'https://docs.getxapi.com/',
    pricing: '$0.001 за запрос (~20 твитов)',
    tools: ['x_search', 'x_user', 'x_user_tweets', 'x_tweet'] },
  { id: 'redditapis', name: 'RedditAPIs', env: 'REDDITAPIS_API_KEY',
    description: 'Поиск по Reddit, посты сабреддитов и деревья комментариев.',
    url: 'https://www.redditapis.com/', docs: 'https://docs.redditapis.com/',
    pricing: '$0.0015 за запрос',
    tools: ['reddit_search', 'reddit_posts', 'reddit_comments'] },
  { id: 'transcriptapi', name: 'TranscriptAPI', env: 'TRANSCRIPTAPI_API_KEY',
    description: 'Расшифровки роликов YouTube и поиск видео.',
    url: 'https://transcriptapi.io/dashboard', docs: 'https://transcriptapi.io/docs',
    pricing: '1 кредит за запрос, повторы из кэша бесплатно',
    tools: ['youtube_transcript', 'youtube_search'] },
  { id: 'openrouter', name: 'OpenRouter', env: 'OPENROUTER_API_KEY',
    description: 'Модели OpenRouter для генерации изображений, видео и решений (MCP openrouter).',
    url: 'https://openrouter.ai/settings/keys', docs: 'https://openrouter.ai/docs',
    pricing: 'по тарифам моделей',
    tools: [] },
];
export const byId = (id) => INTEGRATIONS.find((x) => x.id === id);
export const SETTINGS_HINT = 'Пользователь задаёт ключ в T3 → Настройки → API-ключи.';

export class UserError extends Error {}

function run(cmd, args, input) {
  return new Promise((resolve) => {
    let p;
    try { p = spawn(cmd, args, { windowsHide: true }); } catch (e) { return resolve({ code: -1, out: '', err: String(e) }); }
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => resolve({ code: -1, out, err: String(e) }));
    p.on('close', (code) => resolve({ code, out, err }));
    if (input !== undefined) p.stdin.end(input); else p.stdin.end();
  });
}

// All values of HKCU\Environment (fresh read each time, so keys added later are picked up without restarts).
export async function readUserEnv() {
  if (process.platform !== 'win32') return {};
  const r = await run('reg.exe', ['query', 'HKCU\\Environment']);
  const map = {};
  for (const line of r.out.split(/\r?\n/)) {
    const m = /^\s{2,}(\S+)\s+REG_(?:EXPAND_)?SZ\s+(.*?)\s*$/.exec(line);
    if (m) map[m[1].toUpperCase()] = m[2];
  }
  return map;
}

// MCP order: process env first, then the registry. `fresh` forces the registry (used after an auth error).
export async function getKey(id, { fresh = false } = {}) {
  const it = byId(id);
  if (!it) throw new UserError('Неизвестная интеграция: ' + id);
  if (!fresh) {
    const v = (process.env[it.env] || '').trim();
    if (v) return v;
  }
  const v = ((await readUserEnv())[it.env] || '').trim();
  if (v) return v;
  if (fresh) return (process.env[it.env] || '').trim();
  throw new UserError(`Нет API-ключа ${it.name} (переменная окружения ${it.env}). ${SETTINGS_HINT} Попросите пользователя добавить ключ (получить: ${it.url}) и повторите вызов — перезапуск не нужен.`);
}

// Setting a user variable via .NET also broadcasts WM_SETTINGCHANGE. The value goes through stdin, never argv.
const PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
export async function setUserEnv(name, value) {
  if (!/^[A-Z0-9_]+$/.test(name)) throw new UserError('bad name');
  const script = value == null
    ? `[Environment]::SetEnvironmentVariable('${name}', $null, 'User')`
    : `$v=[Console]::In.ReadToEnd(); [Environment]::SetEnvironmentVariable('${name}', $v, 'User')`;
  const r = await run(PS, ['-NoProfile', '-NonInteractive', '-Command', script], value == null ? undefined : value);
  if (r.code !== 0) throw new UserError('Не удалось записать переменную окружения ' + name + ': ' + r.err.trim().slice(0, 200));
  if (value == null) delete process.env[name]; else process.env[name] = value;
}

export const mask = (v) => (v ? '••••' + v.slice(-4) : '');

// ---------- HTTP helper ----------
export async function httpJson(url, { headers = {}, timeoutMs = 60000, method = 'GET', body } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  let res, text;
  try {
    res = await fetch(url, { method, headers, body, signal: ctl.signal, redirect: 'follow' });
    text = await res.text();
  } catch (e) {
    throw new UserError('Сеть: ' + (e.name === 'AbortError' ? `таймаут ${Math.round(timeoutMs / 1000)} с` : (e.cause?.code || e.message)));
  } finally { clearTimeout(t); }
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, headers: res.headers, text, json };
}

export function errText(r) {
  const j = r.json;
  const d = j && (j.detail || j.error?.message || j.error || j.message || j.msg || j.hint);
  return (typeof d === 'string' ? d : (d ? JSON.stringify(d) : r.text || '')).replace(/token=[^&\s"']+/gi, 'token=***').slice(0, 300);
}

// ---------- key checks: cheapest documented calls ----------
export async function testKey(id, key) {
  const it = byId(id);
  const fmt$ = (n) => (typeof n !== 'number' || !Number.isFinite(n) ? String(n) : n === 0 ? '$0' : '$' + (Math.abs(n) < 1 ? +n.toFixed(4) : n.toFixed(2)));
  if (id === 'scrapedo') {
    // GET /info — usage statistics, does not consume credits (limit 10 req/min).
    const r = await httpJson('https://api.scrape.do/info?token=' + encodeURIComponent(key), { timeoutMs: 20000 });
    if (r.status === 401) return { ok: false, message: 'Ключ отклонён (401): неверный токен, нет кредитов или подписка приостановлена.', credits: 0 };
    if (!r.ok || !r.json) return { ok: false, message: `Ошибка ${r.status}: ${errText(r)}`, credits: 0 };
    const j = r.json;
    const parts = [];
    if (j.IsActive === false) parts.push('подписка неактивна');
    if (j.RemainingMonthlyRequest != null) parts.push(`осталось ${j.RemainingMonthlyRequest} из ${j.MaxMonthlyRequest ?? '?'} запросов в месяц`);
    if (j.ConcurrentRequest != null) parts.push(`параллельно до ${j.ConcurrentRequest}`);
    return { ok: j.IsActive !== false, message: 'Ключ работает' + (parts.length ? ': ' + parts.join(', ') : '') + '.', credits: 0, spent: 'бесплатно (/info)' };
  }
  if (id === 'getxapi' || id === 'redditapis') {
    // GET /account/me — free on both services (30 req/min).
    const base = id === 'getxapi' ? 'https://api.getxapi.com' : 'https://api.redditapis.com';
    const r = await httpJson(base + '/account/me', { headers: { Authorization: 'Bearer ' + key }, timeoutMs: 20000 });
    if (r.status === 401 || r.status === 403) return { ok: false, message: `Ключ отклонён (${r.status}).`, credits: 0 };
    if (!r.ok || !r.json) return { ok: false, message: `Ошибка ${r.status}: ${errText(r)}`, credits: 0 };
    const j = r.json.data && typeof r.json.data === 'object' ? r.json.data : r.json;
    const bal = j.balance_total ?? j.credits_remaining;
    return { ok: true, message: 'Ключ работает' + (bal != null ? `: баланс ${fmt$(Number(bal))}` : '') + (j.total_requests != null ? `, запросов всего ${j.total_requests}` : '') + '.',
      credits: 0, spent: 'бесплатно (/account/me)' };
  }
  if (id === 'transcriptapi') {
    // No free key-check endpoint is documented. A cached transcript is free; otherwise 1 credit. 401/402 are not charged.
    const r = await httpJson('https://api.transcriptapi.io/transcript?video_id=dQw4w9WgXcQ', { headers: { Authorization: 'Bearer ' + key }, timeoutMs: 45000 });
    if (r.status === 401) return { ok: false, message: 'Ключ отклонён (401).', credits: 0 };
    if (r.status === 402) return { ok: false, message: 'Ключ верный, но кредиты закончились (402).', credits: 0 };
    if (!r.ok) return { ok: r.status === 404, message: `Ответ ${r.status}: ${errText(r)}`, credits: 0 };
    const n = Array.isArray(r.json?.transcript) ? r.json.transcript.length : 0;
    return { ok: true, message: `Ключ работает: получена тестовая расшифровка (${n} фрагм.).`, credits: 1, spent: 'до 1 кредита (из кэша — бесплатно)' };
  }
  if (id === 'openrouter') {
    // GET /api/v1/key — info about the current key, free.
    const r = await httpJson('https://openrouter.ai/api/v1/key', { headers: { Authorization: 'Bearer ' + key }, timeoutMs: 20000 });
    if (r.status === 401 || r.status === 403) return { ok: false, message: `Ключ отклонён (${r.status}).`, credits: 0 };
    if (!r.ok || !r.json) return { ok: false, message: `Ошибка ${r.status}: ${errText(r)}`, credits: 0 };
    const d = r.json.data || {};
    const parts = [];
    if (d.usage != null) parts.push(`израсходовано ${fmt$(Number(d.usage))}`);
    if (d.limit != null) parts.push(`лимит ${fmt$(Number(d.limit))}`);
    if (d.limit_remaining != null) parts.push(`осталось ${fmt$(Number(d.limit_remaining))}`);
    return { ok: true, message: 'Ключ работает' + (parts.length ? ': ' + parts.join(', ') : '') + '.', credits: 0, spent: 'бесплатно (/api/v1/key)' };
  }
  return { ok: false, message: 'Проверка для ' + (it?.name || id) + ' не реализована.', credits: 0 };
}
