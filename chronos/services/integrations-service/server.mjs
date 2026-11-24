#!/usr/bin/env node
// API-keys service for the T3 settings page «API-ключи». http://127.0.0.1:4522, no dependencies.
// GET  /api/health
// GET  /api/keys                 → integrations with status (set / masked last 4 / source / last test)
// POST /api/keys        {id, value}   → writes the Windows user env var (HKCU\Environment)
// POST /api/keys/delete {id}
// POST /api/test        {id, value?}  → cheap real call to verify the saved (or the typed, unsaved) key
// Mutations require header `x-oly: 1`. Key values are never returned, logged or written to files.
import { t3Home, serviceDir } from '../paths.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { INTEGRATIONS, byId, readUserEnv, setUserEnv, mask, testKey, UserError } from './keys.mjs';

const HERE = serviceDir('integrations-service');
fs.mkdirSync(HERE, { recursive: true });
const PORT = Number(process.env.OLY_INTEGRATIONS_PORT || 4522);
const STATE = path.join(HERE, 'state.json'); // last test results only (no secrets)
const ORIGINS = new Set(['t3code://app', 'http://localhost:3773', 'http://127.0.0.1:3773']);

const loadState = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; } };
const saveState = (s) => { try { fs.writeFileSync(STATE, JSON.stringify(s, null, 1)); } catch {} };
let state = loadState();

const balanceTtl = 5 * 60_000;
const receiptDir = path.join(process.env.OLY_USAGE_ROOT || path.join(t3Home, 'userdata', 'openrouter-usage'), 'storage', 'message', 'openrouter-mcp');

async function todaysReceipts(now) {
  const start = new Date(now).setHours(0, 0, 0, 0);
  const byModel = new Map();
  let known = 0, unknown = 0, total = 0;
  try {
    const files = await fs.promises.opendir(receiptDir);
    for await (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.json')) continue;
      let r;
      try { r = JSON.parse(await fs.promises.readFile(path.join(receiptDir, file.name), 'utf8')); }
      catch { return { todayUsd: null, byModel: [], unavailable: true }; }
      const at = r?.time?.created;
      if (r?.olyOpenrouterReceipt !== true || !Number.isFinite(at) || at < start || at > now) continue;
      if (!Number.isFinite(r.cost) || r.cost < 0) { unknown++; continue; }
      known++;
      total += r.cost;
      const model = r.modelID || 'Модель не указана';
      byModel.set(model, (byModel.get(model) || 0) + r.cost);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') return { todayUsd: null, byModel: [], unavailable: true };
  }
  return { todayUsd: known || !unknown ? total : null, known, unknown,
    byModel: Array.from(byModel, ([model, usd]) => ({ model, usd })).sort((a, b) => b.usd - a.usd) };
}

let balanceCache, pendingBalances;
function invalidateBalances() { balanceCache = pendingBalances = undefined; }
async function balances(refresh) {
  const now = Date.now();
  if (pendingBalances) return pendingBalances;
  if (!refresh && balanceCache?.expiresAt > now && new Date(balanceCache.checkedAt).toDateString() === new Date(now).toDateString()) return balanceCache;
  const pending = (async () => {
    const registry = await readUserEnv();
    const items = await Promise.all(INTEGRATIONS.map(async ({ id, name, env }) => {
      const key = (registry[env] || process.env[env] || '').trim();
      if (!key) return null;
      if (id === 'transcriptapi') {
        const last = state[id];
        const status = last?.status ?? (Number(last?.message?.match(/\b(401|402)\b/)?.[1]) || null);
        return { id, name, manual: true, lastTest: last ? { ok: last.ok === true, at: last.at, status } : null, status };
      }
      if (!['scrapedo', 'getxapi', 'redditapis', 'openrouter'].includes(id)) return null;
      try {
        const result = await testKey(id, key);
        return { id, name, ok: result.ok, status: result.status ?? null, metrics: result.metrics ?? null };
      } catch { return { id, name, ok: false, status: null, metrics: null }; }
    }));
    const checkedAt = Date.now();
    return { checkedAt, expiresAt: checkedAt + balanceTtl, items: items.filter(Boolean), receipts: await todaysReceipts(checkedAt) };
  })();
  pendingBalances = pending;
  try {
    const result = await pending;
    if (pendingBalances === pending) balanceCache = result;
    return result;
  } finally { if (pendingBalances === pending) pendingBalances = undefined; }
}

async function listKeys() {
  const reg = await readUserEnv();
  return INTEGRATIONS.map((it) => {
    const r = (reg[it.env] || '').trim();
    const p = (process.env[it.env] || '').trim();
    const v = r || p;
    return { id: it.id, name: it.name, env: it.env, description: it.description, url: it.url, docs: it.docs, pricing: it.pricing,
      tools: it.tools, set: !!v, source: r ? 'user' : (p ? 'process' : null), masked: mask(v), lastTest: state[it.id] || null };
  });
}

// Older manual tests stored only the locally formatted success message.
function savedMetrics(id, last) {
  if (last?.metrics) return last.metrics;
  if (!last?.ok || typeof last.message !== 'string') return null;
  const numberAfter = prefix => {
    const match = last.message.match(new RegExp(prefix + '([0-9]+(?:\\.[0-9]+)?)'));
    return match ? Number(match[1]) : null;
  };
  if (id === 'scrapedo') return { remainingReq: numberAfter('осталось '), maxReq: numberAfter(' из ') };
  if (id === 'openrouter') return { usedUsd: numberAfter('израсходовано \\$'), limitUsd: numberAfter('лимит \\$'), remainingUsd: numberAfter('осталось \\$') };
  return { balanceUsd: numberAfter('баланс \\$') };
}

async function savedBalances() {
  const registry = await readUserEnv();
  const items = [];
  for (const { id, name, env } of INTEGRATIONS) {
    if (id === 'transcriptapi' || !(registry[env] || process.env[env] || '').trim()) continue;
    const cached = balanceCache?.items.find(item => item.id === id);
    const last = state[id];
    if (cached && (!last?.at || balanceCache.checkedAt >= Date.parse(last.at))) {
      if (cached.ok) items.push({ id, name, metrics: cached.metrics, at: balanceCache.checkedAt });
    } else if (last?.ok) {
      items.push({ id, name, metrics: savedMetrics(id, last), at: last.at });
    }
  }
  return { items };
}

function send(res, code, obj, origin) {
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (origin && ORIGINS.has(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h.Vary = 'Origin';
  }
  res.writeHead(code, h);
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > 16384) { reject(new UserError('Слишком большой запрос')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new UserError('Неверный JSON')); } });
    req.on('error', reject);
  });
}

function cleanValue(v) {
  const s = String(v ?? '').trim();
  if (!s) throw new UserError('Пустой ключ');
  if (s.length > 1024 || /[\r\n\t\0]/.test(s) || /\s/.test(s)) throw new UserError('Ключ не должен содержать пробелов и переносов строк');
  return s;
}

const server = http.createServer(async (req, res) => {
  if (!['127.0.0.1:' + PORT, 'localhost:' + PORT].includes(req.headers.host)) { res.writeHead(403); return res.end(); }
  const origin = req.headers.origin;
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'OPTIONS') {
    const h = { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type, x-oly',
      'Access-Control-Max-Age': '600', 'Access-Control-Allow-Private-Network': 'true' };
    if (origin && ORIGINS.has(origin)) { h['Access-Control-Allow-Origin'] = origin; h.Vary = 'Origin'; }
    res.writeHead(204, h); return res.end();
  }
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, service: 'oly-integrations', port: PORT }, origin);
    if (req.method === 'GET' && url.pathname === '/api/balances/saved') {
      if (origin && !ORIGINS.has(origin)) return send(res, 403, { error: 'Недоступно для этого источника' }, origin);
      return send(res, 200, await savedBalances(), origin);
    }
    if (req.method === 'GET' && url.pathname === '/api/balances') {
      if (origin && !ORIGINS.has(origin)) return send(res, 403, { error: 'Недоступно для этого источника' }, origin);
      return send(res, 200, await balances(url.searchParams.get('refresh') === '1'), origin);
    }
    if (req.method === 'GET' && url.pathname === '/api/keys') return send(res, 200, { items: await listKeys() }, origin);
    if (req.method !== 'POST') return send(res, 404, { error: 'not found' }, origin);
    if (req.headers['x-oly'] !== '1') return send(res, 403, { error: 'Требуется заголовок x-oly: 1' }, origin);
    const body = await readBody(req);
    const it = byId(body.id);
    if (!it) throw new UserError('Неизвестная интеграция');
    if (url.pathname === '/api/keys') {
      await setUserEnv(it.env, cleanValue(body.value));
      delete state[it.id]; saveState(state); invalidateBalances();
      return send(res, 200, { ok: true, items: await listKeys() }, origin);
    }
    if (url.pathname === '/api/keys/delete') {
      await setUserEnv(it.env, null);
      delete state[it.id]; saveState(state); invalidateBalances();
      return send(res, 200, { ok: true, items: await listKeys() }, origin);
    }
    if (url.pathname === '/api/test') {
      const typed = body.value != null && String(body.value).trim() !== '';
      let key = typed ? cleanValue(body.value) : '';
      if (!key) key = ((await readUserEnv())[it.env] || process.env[it.env] || '').trim();
      if (!key) return send(res, 200, { ok: false, message: 'Ключ не задан.', credits: 0 }, origin);
      const r = await testKey(it.id, key);
      const result = { ok: !!r.ok, status: r.status ?? null, message: r.message, credits: r.credits || 0, spent: r.spent || '', at: new Date().toISOString(), unsaved: typed };
      if (!typed) { state[it.id] = { ...result, metrics: r.metrics ?? null }; saveState(state); invalidateBalances(); }
      return send(res, 200, { ...result, items: await listKeys() }, origin);
    }
    return send(res, 404, { error: 'not found' }, origin);
  } catch (e) {
    const msg = e instanceof UserError ? e.message : 'Внутренняя ошибка: ' + (e?.message || e);
    return send(res, e instanceof UserError ? 400 : 500, { error: msg }, origin);
  }
});

server.on('error', (e) => { process.stderr.write('[integrations] ' + e.message + '\n'); process.exit(1); });
server.listen(PORT, '127.0.0.1', () => process.stderr.write(`[integrations] http://127.0.0.1:${server.address().port}\n`));
