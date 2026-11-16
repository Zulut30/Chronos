// Task board service for T3 Code — HTTP on 127.0.0.1:4518, no dependencies. Storage in store.mjs.
import http from 'node:http';
import * as S from './store.mjs';

const PORT = Number(process.env.OLY_TASKS_PORT || 4518);
const ORIGINS = new Set(['t3code://app', 'http://localhost:3773', 'http://127.0.0.1:3773']);
const VERSION = 1;

function send(res, code, body, req) {
  const h = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  const o = req && req.headers.origin;
  if (o && ORIGINS.has(o)) { h['access-control-allow-origin'] = o; h.vary = 'Origin'; }
  res.writeHead(code, h); res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const parts = [];
    req.on('data', (c) => { size += c.length; if (size > 1e6) { reject(new Error('Слишком большой запрос')); req.destroy(); } else parts.push(c); });
    req.on('end', () => { try { resolve(parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {}); } catch { reject(new Error('Неверный JSON')); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname; const m = req.method;
    if (m === 'OPTIONS') {
      const o = req.headers.origin; const h = { 'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE', 'access-control-allow-headers': 'content-type,x-oly', 'access-control-max-age': '600', 'access-control-allow-private-network': 'true' };
      if (o && ORIGINS.has(o)) { h['access-control-allow-origin'] = o; h.vary = 'Origin'; }
      res.writeHead(204, h); return res.end();
    }
    if (m !== 'GET' && req.headers['x-oly'] !== '1') return send(res, 403, { error: 'forbidden' }, req);
    const seg = p.split('/').filter(Boolean).map(decodeURIComponent);
    if (seg[0] !== 'api') return send(res, 404, { error: 'not found' }, req);

    if (seg[1] === 'health') return send(res, 200, { ok: true, service: 'oly-tasks', version: VERSION, data: S.DATA }, req);
    if (seg[1] === 'meta') return send(res, 200, { statuses: S.STATUSES, priorities: S.PRIORITIES }, req);
    if (seg[1] === 'projects' && m === 'GET') {
      const list = await S.t3Projects(); const c = S.counts();
      return send(res, 200, list.map((x) => ({ ...x, ...(c[x.id] || { total: 0, open: 0, doing: 0 }) })), req);
    }
    if (seg[1] === 'thread' && seg[2] && m === 'GET') return send(res, 200, { threadId: seg[2], projectId: await S.threadProject(seg[2]) }, req);

    if (seg[1] === 'groups') {
      if (m === 'GET') return send(res, 200, S.listGroups(), req);
      if (m === 'PUT' || m === 'POST') return send(res, 200, S.saveGroup(await readBody(req)), req);
      if (m === 'DELETE' && seg[2]) return send(res, 200, { ok: S.deleteGroup(seg[2]) }, req);
    }
    if (seg[1] === 'tasks') {
      const id = seg[2];
      if (!id && m === 'GET') {
        const pr = url.searchParams.get('projects');
        return send(res, 200, S.listTasks(pr ? pr.split(',').filter(Boolean) : null), req);
      }
      if (!id && m === 'POST') return send(res, 200, S.createTask(await readBody(req)), req);
      if (id && seg[3] === 'move' && m === 'POST') { const b = await readBody(req); return send(res, 200, S.moveTask(id, b.status, b.beforeId), req); }
      if (id && m === 'GET') { const t = S.getTask(id); return t ? send(res, 200, t, req) : send(res, 404, { error: 'Задача не найдена' }, req); }
      if (id && m === 'PATCH') return send(res, 200, S.updateTask(id, await readBody(req)), req);
      if (id && m === 'DELETE') return send(res, 200, { ok: S.deleteTask(id) }, req);
    }
    return send(res, 404, { error: 'not found' }, req);
  } catch (e) {
    return send(res, 400, { error: String((e && e.message) || e) }, req);
  }
});
server.on('error', (e) => { console.error('tasks service:', e.message); process.exit(1); });
server.listen(PORT, '127.0.0.1', () => console.log(`tasks service on http://127.0.0.1:${PORT} (data: ${S.DATA})`));
