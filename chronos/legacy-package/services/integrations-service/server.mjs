#!/usr/bin/env node
// API-keys service for the T3 settings page «API-ключи». http://127.0.0.1:4522, no dependencies.
// GET  /api/health
// GET  /api/keys                 → integrations with status (set / masked last 4 / source / last test)
// POST /api/keys        {id, value}   → writes the Windows user env var (HKCU\Environment)
// POST /api/keys/delete {id}
// POST /api/test        {id, value?}  → cheap real call to verify the saved (or the typed, unsaved) key
// Mutations require header `x-oly: 1`. Key values are never returned, logged or written to files.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTEGRATIONS, byId, readUserEnv, setUserEnv, mask, testKey, UserError } from './keys.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.OLY_INTEGRATIONS_PORT || 4522);
const STATE = path.join(HERE, 'state.json'); // last test results only (no secrets)
const ORIGINS = new Set(['t3code://app', 'http://localhost:3773', 'http://127.0.0.1:3773']);

const loadState = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; } };
const saveState = (s) => { try { fs.writeFileSync(STATE, JSON.stringify(s, null, 1)); } catch {} };
let state = loadState();

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
    if (req.method === 'GET' && url.pathname === '/api/keys') return send(res, 200, { items: await listKeys() }, origin);
    if (req.method !== 'POST') return send(res, 404, { error: 'not found' }, origin);
    if (req.headers['x-oly'] !== '1') return send(res, 403, { error: 'Требуется заголовок x-oly: 1' }, origin);
    const body = await readBody(req);
    const it = byId(body.id);
    if (!it) throw new UserError('Неизвестная интеграция');
    if (url.pathname === '/api/keys') {
      await setUserEnv(it.env, cleanValue(body.value));
      delete state[it.id]; saveState(state);
      return send(res, 200, { ok: true, items: await listKeys() }, origin);
    }
    if (url.pathname === '/api/keys/delete') {
      await setUserEnv(it.env, null);
      delete state[it.id]; saveState(state);
      return send(res, 200, { ok: true, items: await listKeys() }, origin);
    }
    if (url.pathname === '/api/test') {
      const typed = body.value != null && String(body.value).trim() !== '';
      let key = typed ? cleanValue(body.value) : '';
      if (!key) key = ((await readUserEnv())[it.env] || process.env[it.env] || '').trim();
      if (!key) return send(res, 200, { ok: false, message: 'Ключ не задан.', credits: 0 }, origin);
      const r = await testKey(it.id, key);
      const result = { ok: !!r.ok, message: r.message, credits: r.credits || 0, spent: r.spent || '', at: new Date().toISOString(), unsaved: typed };
      if (!typed) { state[it.id] = result; saveState(state); }
      return send(res, 200, { ...result, items: await listKeys() }, origin);
    }
    return send(res, 404, { error: 'not found' }, origin);
  } catch (e) {
    const msg = e instanceof UserError ? e.message : 'Внутренняя ошибка: ' + (e?.message || e);
    return send(res, e instanceof UserError ? 400 : 500, { error: msg }, origin);
  }
});

server.on('error', (e) => { process.stderr.write('[integrations] ' + e.message + '\n'); process.exit(1); });
server.listen(PORT, '127.0.0.1', () => process.stderr.write(`[integrations] http://127.0.0.1:${PORT}\n`));
