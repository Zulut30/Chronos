#!/usr/bin/env node
// MCP server (stdio, no dependencies) for T3 Studio: Excalidraw boards.
// Talks to the local studio service at http://127.0.0.1:4520 (start-hidden.vbs). See AGENTS.md.
import { artifactTools } from '../artifacts/tools.mjs'; // chronos: shared hub, lazy artifact store
import readline from 'node:readline';

const SVC = process.env.OLY_STUDIO_URL || 'http://127.0.0.1:4520';
const H = { 'x-oly': '1', 'content-type': 'application/json' };

async function call(method, p, body, raw) {
  let r;
  try { r = await fetch(SVC + p, { method, redirect: 'error', headers: H, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) }); }
  catch {
    const launchHint = process.platform === 'win32'
      ? 'Запустите studio-service\\start-hidden.vbs (или: node studio-service\\server.mjs).'
      : 'Перезапустите Chronos (или запустите: node studio-service/server.mjs).';
    throw new Error(`Сервис студии не отвечает на ${SVC}. ${launchHint}`);
  }
  const text = await r.text();
  if (!r.ok) { let e = text; try { e = JSON.parse(text).error || text; } catch {} throw new Error(`${r.status}: ${e}`); }
  return raw ? text : (text ? JSON.parse(text) : {});
}
const q = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
async function defaultDir(dir) { if (dir) return dir; const c = await call('GET', '/api/context'); return c.boardsDir; }
const brief = (b) => ({ name: b.name, path: b.path, modified: new Date(b.mtime).toISOString(), ...(b.location ? { location: b.location } : {}) });

const FORMAT = 'A board is a JSON file {"type":"excalidraw","version":2,"elements":[...],"appState":{"viewBackgroundColor":"#ffffff"},"files":{}}. '
  + 'Elements may be full Excalidraw elements or the simplified skeleton form, e.g. {"type":"rectangle","id":"a","x":0,"y":0,"width":200,"height":80,"label":{"text":"API"}}, '
  + '{"type":"ellipse"|"diamond",...}, {"type":"text","x":0,"y":120,"text":"Note","fontSize":20}, {"type":"arrow","x":200,"y":40,"width":150,"height":0,"start":{"id":"a"},"end":{"id":"b"},"label":{"text":"calls"}}. '
  + 'Colors: strokeColor/backgroundColor (hex), fillStyle "solid"|"hachure". An open board reloads live and normalizes skeletons to full elements.';

const TOOLS = [
  ...artifactTools,
  { name: 'studio_context', description: 'Current T3 context: open thread, its project and the folder where this project\'s boards live (<project>/.excalidraw, or the studio folder for threads without a project).', inputSchema: { type: 'object', properties: {} },
    run: async () => call('GET', '/api/context') },
  { name: 'list_boards', description: 'List Excalidraw boards (.excalidraw files). Without arguments: boards of the current T3 project. dir = a boards folder; all = true lists every known location (all T3 projects, the studio folder, added folders) plus recently opened boards.', inputSchema: { type: 'object', properties: { dir: { type: 'string', description: 'Absolute folder with .excalidraw files' }, all: { type: 'boolean' } } },
    run: async ({ dir, all }) => {
      if (all) { const [b, r] = await Promise.all([call('GET', '/api/boards'), call('GET', '/api/recent')]); return { boards: b.boards.map(brief), recent: r.recent.map(brief) }; }
      const d = await defaultDir(dir); return { dir: d, boards: (await call('GET', '/api/boards?' + q({ dir: d }))).boards.map(brief) };
    } },
  { name: 'read_board', description: 'Read a board file (full JSON). ' + FORMAT, inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Absolute path to the .excalidraw file' } }, required: ['path'] },
    run: async ({ path }) => call('GET', '/api/board?' + q({ path }), undefined, true) },
  { name: 'write_board', description: 'Replace the content of a board (creates the file if missing). The board updates live if it is open in T3. ' + FORMAT, inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Absolute path to the .excalidraw file' }, content: { description: 'Board JSON (object or string) with an elements array' } }, required: ['path', 'content'] },
    run: async ({ path, content }) => {
      const doc = typeof content === 'string' ? JSON.parse(content) : content;
      if (!doc || !Array.isArray(doc.elements)) throw new Error('content must contain an "elements" array');
      const full = { type: 'excalidraw', version: 2, source: 't3-studio-mcp', appState: { viewBackgroundColor: '#ffffff' }, files: {}, ...doc };
      const r = await call('PUT', '/api/board?' + q({ path }), JSON.stringify(full, null, 2));
      return { ok: true, path, elements: full.elements.length, mtime: r.mtime };
    } },
  { name: 'create_board', description: 'Create a new board. dir defaults to the current T3 project\'s boards folder. Optional content as in write_board.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, dir: { type: 'string' }, content: {} }, required: ['name'] },
    run: async ({ name, dir, content }) => call('POST', '/api/board/create', { dir: await defaultDir(dir), name, content }) },
  { name: 'open_board', description: 'Open a board in the T3 window\'s right panel (built-in browser tab, drivable with preview tools).', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    run: async ({ path }) => { const r = await call('POST', '/api/open', { board: path }); return r.delivered ? { ok: true, opened: path } : { ok: false, note: 'No T3 window is connected to the studio; open it manually: http://127.0.0.1:4520/board?path=' + encodeURIComponent(path) }; } },
];

const out = (m) => process.stdout.write(JSON.stringify(m) + '\n');
export async function handleRequest(m, out) {
  if (!m || m.jsonrpc !== '2.0') return;
  const reply = (result) => m.id !== undefined && out({ jsonrpc: '2.0', id: m.id, result });
  const fail = (code, message) => m.id !== undefined && out({ jsonrpc: '2.0', id: m.id, error: { code, message } });
  try {
    if (m.method === 'initialize') return reply({ protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 't3-studio', version: '1.0.0' },
      instructions: 'Local Excalidraw boards (.excalidraw JSON in <project>/.excalidraw) shown in T3\'s right panel. Prefer list_boards/read_board/write_board; open_board shows a board to the user.' });
    if (m.method === 'ping') return reply({});
    if (m.method === 'tools/list') return reply({ tools: TOOLS.map(({ run, ...t }) => t) });
    if (m.method === 'tools/call') {
      const t = TOOLS.find((x) => x.name === m.params?.name);
      if (!t) return fail(-32602, 'Unknown tool ' + m.params?.name);
      try {
        const r = await t.run(m.params.arguments || {});
        return reply({ content: [{ type: 'text', text: typeof r === 'string' ? r : JSON.stringify(r, null, 2) }] });
      } catch (e) { return reply({ content: [{ type: 'text', text: String(e.message || e) }], isError: true }); }
    }
    if (m.method?.startsWith('notifications/')) return;
    return fail(-32601, 'Method not found');
  } catch (e) { return fail(-32603, String(e.message || e)); }
}

if (import.meta.main) {
  const lines = readline.createInterface({ input: process.stdin });
  lines.on('line', (line) => {
    let m; try { m = JSON.parse(line); } catch { return; }
    return handleRequest(m, out);
  });
}
