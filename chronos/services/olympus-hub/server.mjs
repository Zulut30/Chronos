import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, linkSync, rmSync } from 'node:fs';
import { timingSafeEqual, randomBytes, randomUUID } from 'node:crypto';
import { servicesData } from '../paths.mjs';
import { join } from 'node:path';
import { handleRequest as web } from '../integrations-service/mcp.mjs';
import { handleRequest as studio } from '../studio-service/mcp.mjs';

const address = '127.0.0.1';
const port = Number(process.env.OLY_HUB_PORT || 4524);
const authority = address + ':' + port;
const state = join(servicesData, 'olympus-hub');
const file = join(state, 'credentials.json');
function credentials() {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  mkdirSync(state, { recursive: true, mode: 0o700 });
  const tmp = join(state, '.' + randomUUID());
  try {
    const keys = Object.fromEntries(['oly-web', 't3-studio'].map(name => [name, randomBytes(32).toString('hex')]));
    writeFileSync(tmp, JSON.stringify(keys), { flag: 'wx', mode: 0o600, flush: true });
    try { linkSync(tmp, file); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  } finally { rmSync(tmp, { force: true }); }
  return JSON.parse(readFileSync(file, 'utf8'));
}
const keys = credentials();
const endpoints = new Map();
for (const [name, handler] of [['oly-web', web], ['t3-studio', studio]]) {
  if (!/^[a-f0-9]{64}$/.test(keys[name])) throw Error('Missing hub credentials');
  endpoints.set('/mcp/' + name, { handler, authorization: Buffer.from('Bearer ' + keys[name]) });
}
const versions = ['2025-06-18', '2025-03-26'];
const MAX_BYTES = 32 * 1024 * 1024;

function finish(res, status, payload) {
  if (res.destroyed || res.writableEnded) return;
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  res.writeHead(status, headers);
  res.end(payload === undefined ? undefined : JSON.stringify(payload));
}

async function handle(req, res) {
  if (req.headers.host !== authority || (req.headers.origin !== undefined && req.headers.origin !== 'http://' + authority)) return finish(res, 403);
  const endpoint = endpoints.get(req.url);
  if (!endpoint) return finish(res, 404);
  const auth = Buffer.from(req.headers.authorization || '');
  if (auth.length !== endpoint.authorization.length || !timingSafeEqual(auth, endpoint.authorization)) return finish(res, 401);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return finish(res, 405);
  }
  const version = req.headers['mcp-protocol-version'];
  if (version && !versions.includes(version)) return finish(res, 400);
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') return finish(res, 415);
  if (Number(req.headers['content-length']) > MAX_BYTES) return finish(res, 413);
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_BYTES) return finish(res, 413);
    chunks.push(chunk);
  }
  let msg;
  try { msg = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return finish(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  if (msg?.jsonrpc !== '2.0' || Array.isArray(msg)) return finish(res, 400);
  if (msg.id === undefined) return finish(res, typeof msg.method === 'string' && msg.method.startsWith('notifications/') ? 202 : 400);
  if (!['string', 'number'].includes(typeof msg.id)) return finish(res, 400);
  if (msg.method === undefined && ('result' in msg || 'error' in msg)) return finish(res, 202);
  if (typeof msg.method !== 'string') return finish(res, 400);
  if (msg.method === 'initialize') {
    if (!msg.params || typeof msg.params.protocolVersion !== 'string') return finish(res, 400);
    if (!versions.includes(msg.params.protocolVersion)) msg.params.protocolVersion = versions[0];
  }
  const response = await endpoint.handler(msg, result => result);
  if (!response) return finish(res, 400);
  finish(res, 200, response);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(() => finish(res, 500));
});
server.headersTimeout = 15000;
server.requestTimeout = 120000;
server.listen(port, address);
