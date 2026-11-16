#!/usr/bin/env node
// MCP server (stdio, no dependencies) for T3 Studio: Excalidraw boards + WordPress Playground sites.
// Talks to the local studio service at http://127.0.0.1:4520 (start-hidden.vbs). See AGENTS.md.
import readline from 'node:readline';

const SVC = process.env.OLY_STUDIO_URL || 'http://127.0.0.1:4520';
const H = { 'x-oly': '1', 'content-type': 'application/json' };

async function call(method, p, body, raw) {
  let r;
  try { r = await fetch(SVC + p, { method, headers: H, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) }); }
  catch { throw new Error(`Сервис студии не отвечает на ${SVC}. Запустите studio-service\\start-hidden.vbs (или: node studio-service\\server.mjs).`); }
  const text = await r.text();
  if (!r.ok) { let e = text; try { e = JSON.parse(text).error || text; } catch {} throw new Error(`${r.status}: ${e}`); }
  return raw ? text : (text ? JSON.parse(text) : {});
}
const q = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
async function defaultDir(dir) { if (dir) return dir; const c = await call('GET', '/api/context'); return c.boardsDir; }
const brief = (b) => ({ name: b.name, path: b.path, modified: new Date(b.mtime).toISOString(), ...(b.location ? { location: b.location } : {}) });
const siteBrief = (s) => ({ id: s.id, name: s.name, status: s.status, url: s.url, adminUrl: s.adminUrl, project: s.root, mounts: s.mounts, dataDir: s.dataDir, php: s.php, wp: s.wp });

const FORMAT = 'A board is a JSON file {"type":"excalidraw","version":2,"elements":[...],"appState":{"viewBackgroundColor":"#ffffff"},"files":{}}. '
  + 'Elements may be full Excalidraw elements or the simplified skeleton form, e.g. {"type":"rectangle","id":"a","x":0,"y":0,"width":200,"height":80,"label":{"text":"API"}}, '
  + '{"type":"ellipse"|"diamond",...}, {"type":"text","x":0,"y":120,"text":"Note","fontSize":20}, {"type":"arrow","x":200,"y":40,"width":150,"height":0,"start":{"id":"a"},"end":{"id":"b"},"label":{"text":"calls"}}. '
  + 'Colors: strokeColor/backgroundColor (hex), fillStyle "solid"|"hachure". An open board reloads live and normalizes skeletons to full elements.';

const TOOLS = [
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
  { name: 'wp_list', description: 'List local WordPress Playground sites managed by the studio, with status and URLs.', inputSchema: { type: 'object', properties: {} },
    run: async () => ({ sites: (await call('GET', '/api/wp/sites')).sites.map(siteBrief) }) },
  { name: 'wp_create', description: 'Create a persistent local WordPress Playground site. project_dir is mounted into WordPress (mount_as: plugin | theme | wp-content | none). store: server (studio folder, default) | project (<project>/.wordpress). Does not start it.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, project_dir: { type: 'string' }, mount_as: { type: 'string', enum: ['plugin', 'theme', 'wp-content', 'none'] }, slug: { type: 'string' }, php: { type: 'string' }, wp: { type: 'string' }, store: { type: 'string', enum: ['server', 'project'] } }, required: ['name'] },
    run: async (a) => ({ site: siteBrief((await call('POST', '/api/wp/sites', { name: a.name, root: a.project_dir, mountAs: a.mount_as || (a.project_dir ? 'plugin' : 'none'), slug: a.slug, php: a.php, wp: a.wp, store: a.store })).site) }) },
  { name: 'wp_start', description: 'Start a site and wait until WordPress answers (first start downloads WordPress, up to a few minutes). Logged in as admin automatically.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, wait: { type: 'boolean', description: 'default true' } }, required: ['id'] },
    run: async ({ id, wait = true }) => {
      await call('POST', '/api/wp/start', { id });
      const end = Date.now() + 5 * 60000; let s;
      do { s = (await call('GET', '/api/wp/sites')).sites.find((x) => x.id === id); if (!wait || s.status !== 'starting') break; await new Promise((r) => setTimeout(r, 2000)); } while (Date.now() < end);
      return { ...siteBrief(s), ...(s.status === 'error' ? { log: (await call('GET', '/api/wp/log?' + q({ id }))).log } : {}) };
    } },
  { name: 'wp_stop', description: 'Stop a site (its files and database are kept).', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run: async ({ id }) => siteBrief((await call('POST', '/api/wp/stop', { id })).site) },
  { name: 'wp_status', description: 'Status of one site (or all), with the last log lines.', inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
    run: async ({ id }) => {
      const sites = (await call('GET', '/api/wp/sites')).sites.filter((s) => !id || s.id === id);
      return Promise.all(sites.map(async (s) => ({ ...siteBrief(s), log: (await call('GET', '/api/wp/log?' + q({ id: s.id, n: 15 }))).log })));
    } },
  { name: 'wp_open', description: 'Open a running site\'s wp-admin in the T3 window\'s right panel.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run: async ({ id }) => { const r = await call('POST', '/api/open', { site: id }); return { ok: !!r.delivered }; } },
];

const out = (m) => process.stdout.write(JSON.stringify(m) + '\n');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (!m || m.jsonrpc !== '2.0') return;
  const reply = (result) => m.id !== undefined && out({ jsonrpc: '2.0', id: m.id, result });
  const fail = (code, message) => m.id !== undefined && out({ jsonrpc: '2.0', id: m.id, error: { code, message } });
  try {
    if (m.method === 'initialize') return reply({ protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 't3-studio', version: '1.0.0' },
      instructions: 'Local Excalidraw boards (.excalidraw JSON in <project>/.excalidraw) and WordPress Playground sites shown in T3\'s right panel. Prefer list_boards/read_board/write_board; open_board shows a board to the user.' });
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
});
