// JSON worker for local and SSH configuration files. Never starts configured MCP commands.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { DatabaseSync } = require('node:sqlite');
const toml = require('./vendor/toml.cjs');

const MAX = 8 * 1024 * 1024;
const empty = Buffer.alloc(0);
class UserError extends Error {}
const fail = message => { throw new UserError(message); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const parseToml = text => toml.parse(text, { integersAsBigInt: 'asNeeded' });

function read(file) {
  try {
    if (fs.statSync(file).size > MAX) fail('Файл конфигурации слишком большой');
    return fs.readFileSync(file);
  } catch (e) {
    if (e.code === 'ENOENT') return empty;
    throw e;
  }
}
function parse(raw, agent) {
  const text = raw.toString('utf8').replace(/^\uFEFF/, '');
  if (!text.trim()) return {};
  const doc = agent === 'codex' ? parseToml(text) : JSON.parse(text);
  if (!record(doc)) fail('Некорректная конфигурация MCP');
  return doc;
}

function locations(home, t3Home) {
  const claude = path.join(home, '.claude.json');
  const locs = [
    { id: 'codex:user', agent: 'codex', scope: 'user', label: 'Codex · Пользователь',
      path: path.join(process.env.CODEX_HOME || path.join(home, '.codex'), 'config.toml') },
    { id: 'claude:user', agent: 'claude', scope: 'user', label: 'Claude · Пользователь', path: claude },
  ];
  let entries = {};
  try { entries = parse(read(claude), 'claude').projects ?? {}; } catch {}
  const roots = new Set(Object.keys(entries));
  let db;
  try {
    db = new DatabaseSync(path.join(t3Home, 'userdata', 'statev2.sqlite'), { readOnly: true });
    for (const row of db.prepare('SELECT workspace_root FROM projection_projects WHERE deleted_at IS NULL').all()) {
      if (typeof row.workspace_root === 'string') roots.add(row.workspace_root);
    }
  } catch {} finally { db?.close(); }
  const seen = new Set();
  const canonical = p => process.platform === 'win32' ? p.toLowerCase() : p;
  for (const project of [...roots].sort()) {
    if (!path.isAbsolute(project) || !fs.statSync(project, { throwIfNoEntry: false })?.isDirectory()) continue;
    const root = canonical(fs.realpathSync(project));
    if (root === canonical(fs.realpathSync(home))) continue;
    const key = Buffer.from(project).toString('base64url');
    if (!seen.has(root)) {
      seen.add(root);
      for (const [agent, rel, title] of [['codex', '.codex/config.toml', 'Codex'], ['claude', '.mcp.json', 'Claude']]) {
        locs.push({ id: agent + ':project:' + key, agent, scope: 'project', project,
          label: path.basename(project) + ' · ' + title, path: path.join(project, rel) });
      }
    }
    if (Object.keys(entries[project]?.mcpServers ?? {}).length) {
      locs.push({ id: 'claude:local:' + key, agent: 'claude', scope: 'local', project,
        label: path.basename(project) + ' · Claude (локально)', path: claude });
    }
  }
  return locs;
}

function summary(name, cfg, enabled) {
  const url = cfg.url && new URL(cfg.url);
  return { name, enabled: Boolean(enabled), transport: cfg.type || ('url' in cfg ? 'http' : 'stdio'),
    endpoint: url ? url.protocol + '//' + url.host : String(cfg.command ?? ''),
    envNames: Object.keys(cfg.env ?? {}), headerNames: Object.keys(cfg.headers ?? cfg.http_headers ?? {}),
    hasSecrets: Boolean(Object.keys(cfg.env ?? {}).length || Object.keys(cfg.headers ?? {}).length ||
      Object.keys(cfg.http_headers ?? {}).length || cfg.bearer_token) };
}
function validate(config, agent) {
  if (!record(config) || JSON.stringify(config).length > 100000) fail('Некорректная конфигурация MCP');
  const c = { ...config };
  if ('url' in c) {
    let u;
    try { u = new URL(c.url); } catch {}
    if (!u?.hostname || !['http:', 'https:'].includes(u.protocol)) fail('Укажите HTTP(S) адрес MCP');
    if (c.command) fail('Нельзя одновременно указывать команду и URL');
    if (agent === 'codex') {
      if (c.type != null && !['http', 'streamable-http'].includes(c.type)) fail('Codex: используйте Streamable HTTP или STDIO');
      delete c.type;
      if ('headers' in c) { c.http_headers = c.headers; delete c.headers; }
    } else {
      c.type ??= 'http';
      if (!['http','streamable-http','sse','ws'].includes(c.type)) fail('Неподдерживаемый тип транспорта Claude');
      if ('http_headers' in c) { c.headers = c.http_headers; delete c.http_headers; }
    }
  } else {
    if (typeof c.command !== 'string' || !c.command.trim()) fail('Укажите команду STDIO или URL');
    if (c.type != null && c.type !== 'stdio') fail('Для команды используется STDIO');
    if (agent === 'codex') delete c.type;
  }
  if ('args' in c && !(Array.isArray(c.args) && c.args.every(v => typeof v === 'string'))) fail('args должен быть массивом строк');
  for (const k of ['env', 'headers', 'http_headers']) {
    if (k in c && !(record(c[k]) && Object.values(c[k]).every(v => typeof v === 'string'))) fail(k + ' должен содержать строковые значения');
  }
  return c;
}

// Identify actual table headers outside comments and multiline prompt strings.
function headers(text) {
  const list = [];
  let pos = 0, multiline = '';
  for (const line of text.match(/[^\n]*(?:\n|$)/g)) {
    if (!multiline && line.trimStart().startsWith('[')) {
      try {
        let node = parseToml(line + '\n__oly_probe = 1\n');
        const keys = [];
        while (record(node) && !Object.hasOwn(node, '__oly_probe')) {
          const key = Object.keys(node)[0];
          keys.push(key); node = node[key]; if (Array.isArray(node)) node = node[0];
        }
        if (node?.__oly_probe === 1) list.push({ pos, keys });
      } catch {}
    }
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (multiline) {
        if (multiline[0] === '"' && c === '\\') { i++; continue; }
        if (line.startsWith(multiline, i)) {
          i += 2; while (line[i + 1] === multiline[0]) i++; multiline = '';
        }
      } else if (c === '#') break;
      else if (c === '"' || c === "'") {
        if (line.startsWith(c.repeat(3), i)) { multiline = c.repeat(3); i += 2; }
        else while (++i < line.length) {
          if (line[i] === c) break;
          if (c === '"' && line[i] === '\\') i++;
        }
      }
    }
    pos += line.length;
  }
  return list;
}
function tomlValue(v) {
  if (typeof v === 'string' || typeof v === 'boolean' || Number.isFinite(v)) return JSON.stringify(v);
  if (typeof v === 'bigint') return String(v);
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return '[' + v.map(tomlValue).join(', ') + ']';
  if (record(v)) return '{ ' + Object.entries(v).map(([k,x]) => JSON.stringify(k) + ' = ' + tomlValue(x)).join(', ') + ' }';
  fail('Значение не поддерживается в TOML');
}
function patchToml(raw, name, cfg, expected) {
  const original = raw.toString('utf8'), text = original.replace(/^\uFEFF/, '');
  const heads = headers(text);
  let result = text, found = false;
  for (let i = heads.length - 1; i >= 0; i--) {
    const { pos, keys } = heads[i];
    if (keys[0] === 'mcp_servers' && keys[1] === name) {
      found = true; result = result.slice(0, pos) + result.slice(heads[i + 1]?.pos ?? text.length);
    }
  }
  if (!found && Object.hasOwn(parseToml(text).mcp_servers ?? {}, name)) {
    fail('Этот TOML использует встроенную таблицу MCP; изменение остановлено, чтобы сохранить файл');
  }
  if (cfg !== undefined) {
    // Serialize this entry only. The rest of the file keeps its comments and layout.
    if (!record(cfg) || Object.values(cfg).includes(null)) fail('Значение не поддерживается в TOML');
    const entry = '[mcp_servers.' + JSON.stringify(name) + ']\n' +
      Object.entries(cfg).map(([k,v]) => JSON.stringify(k) + ' = ' + tomlValue(v) + '\n').join('');
    result = result.trimEnd() + '\n\n' + entry;
  }
  const actual = parseToml(result);
  if (!Object.keys(actual.mcp_servers ?? {}).length && !Object.keys(expected.mcp_servers ?? {}).length) {
    delete actual.mcp_servers; delete expected.mcp_servers;
  }
  const comparable = v => Array.isArray(v) ? v.map(comparable)
    : record(v) && !(v instanceof Date) ? Object.fromEntries(Object.entries(v).map(([k,x]) => [k, comparable(x)])) : v;
  if (!isDeepStrictEqual(comparable(actual), comparable(expected))) fail('Проверка TOML не пройдена; файл не изменён');
  return Buffer.from((original.startsWith('\uFEFF') ? '\uFEFF' : '') + result);
}

function atomic(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = path.join(path.dirname(file), '.oly-mcp-' + crypto.randomUUID());
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    try {
      const stat = fs.statSync(file, { throwIfNoEntry: false });
      if (stat) fs.fchmodSync(fd, stat.mode & 0o777);
      fs.writeFileSync(fd, bytes); fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } finally { fs.rmSync(tmp, { force: true }); }
}
const resolveFile = p => fs.existsSync(p) ? fs.realpathSync(p) : path.resolve(p);

function execute(req) {
  const home = process.env.OLY_MCP_TEST_HOME || os.homedir();
  const t3Home = process.env.CHRONOS_T3_HOME || path.join(home, '.t3');
  const locs = locations(home, t3Home);
  if (req.action === 'locations') return { locations: locs, node: process.versions.node };
  const loc = locs.find(l => l.id === req.location);
  if (!loc) fail('Неизвестное расположение конфигурации');
  const file = resolveFile(loc.path), raw = read(file), doc = parse(raw, loc.agent);
  const projectClaude = loc.agent === 'claude' && loc.scope !== 'user';
  const auxFile = projectClaude ? resolveFile(path.join(home, '.claude.json')) : null;
  const auxRaw = auxFile && auxFile !== file ? read(auxFile) : empty;
  const aux = auxFile === file ? doc : parse(auxRaw, 'claude');
  const target = loc.scope === 'local' ? doc.projects[loc.project] : doc;
  const activeKey = loc.agent === 'codex' ? 'mcp_servers' : 'mcpServers';
  const active = target[activeKey] ??= {};
  const root = path.join(process.env.CHRONOS_SERVICES_DATA || t3Home, 'mcp-manager');
  const stateFile = path.join(root, 'disabled.json'), stateRaw = read(stateFile);
  const state = parse(stateRaw, 'claude'), saved = state[loc.id] ??= {};
  const version = crypto.createHash('sha256').update(raw).update('\0').update(stateRaw).update('\0').update(auxRaw).digest('hex');
  if (req.action === 'list') {
    const flags = projectClaude ? aux.projects?.[loc.project]?.disabledMcpServers ?? [] : [];
    const rows = Object.entries(active).map(([n,c]) => summary(n,c,(c.enabled ?? true) && !flags.includes(n)));
    for (const [n,c] of Object.entries(saved)) if (!Object.hasOwn(active,n)) rows.push(summary(n,c,false));
    rows.sort((a,b) => { const x=a.name.toLowerCase(), y=b.name.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; });
    return { location: loc, servers: rows, version, exists: fs.existsSync(file) };
  }
  const { action, name } = req;
  if (!['add','toggle','delete'].includes(action)) fail('Неизвестное действие');
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(name)) fail('Имя MCP: латинские буквы, цифры, дефис и подчёркивание');
  if (req.version !== version) fail('Конфигурация изменилась. Обновите список и повторите действие');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const lock = path.join(root, 'write.lock');
  try { fs.closeSync(fs.openSync(lock, 'wx', 0o600)); } catch (e) {
    if (e.code === 'EEXIST') fail('Другая операция MCP ещё не завершилась');
    throw e;
  }
  const checkFiles = () => {
    if (!read(file).equals(raw) || (auxFile && auxFile !== file && !read(auxFile).equals(auxRaw))) fail('Конфигурация изменена другим процессом; повторите действие');
  };
  try {
    checkFiles();
    if (!read(stateFile).equals(stateRaw)) fail('Конфигурация изменилась. Обновите список');
    const present = Object.hasOwn(active, name), disabled = Object.hasOwn(saved, name);
    if (action === 'add') {
      if (present || disabled) fail('MCP с таким именем уже существует');
      active[name] = validate(req.config, loc.agent);
    } else {
      if (!present && !disabled) fail('MCP не найден');
      if (action === 'delete') { delete active[name]; delete saved[name]; }
      else {
        if (typeof req.enabled !== 'boolean') fail('enabled должен быть true или false');
        if (!present && (loc.agent === 'codex' || projectClaude || req.enabled)) {
          active[name] = saved[name]; delete saved[name];
        }
        if (loc.agent === 'codex') active[name].enabled = req.enabled;
        else if (projectClaude) {
          const projects = aux.projects ??= {}, settings = projects[loc.project] ??= {};
          const flags = settings.disabledMcpServers ?? [];
          if (!Array.isArray(flags)) fail('Некорректный список disabledMcpServers');
          settings.disabledMcpServers = flags.filter(n => n !== name);
          if (!req.enabled) settings.disabledMcpServers.push(name);
        } else if (!req.enabled && present) { saved[name] = active[name]; delete active[name]; }
      }
    }
    const data = loc.agent === 'codex' ? patchToml(raw,name,Object.hasOwn(active,name) ? active[name] : undefined,doc) : json(doc);
    const backup = path.join(root, 'backups', Date.now() + '-' + crypto.randomUUID());
    atomic(path.join(backup, 'config.before'), raw);
    atomic(path.join(backup, 'disabled.before'), stateRaw);
    if (auxFile && auxFile !== file) atomic(path.join(backup, 'claude-project-flags.before'), auxRaw);
    atomic(path.join(backup, 'meta.json'), json({ path:file, existed:fs.existsSync(file), action, name }));
    atomic(stateFile, json(state));
    try {
      checkFiles(); atomic(file, data);
      if (projectClaude && auxFile !== file && action === 'toggle') {
        try { atomic(auxFile, json(aux)); } catch (e) { atomic(file, raw); throw e; }
      }
    } catch (e) { atomic(stateFile, stateRaw.length ? stateRaw : Buffer.from('{}')); throw e; }
    return { ok: true, backup, restartRequired: true };
  } finally { fs.unlinkSync(lock); }
}

function main(input) {
  try {
    if (input.length > MAX) fail('Запрос слишком большой');
    console.log(JSON.stringify(execute(JSON.parse(input))));
  } catch (e) {
    console.log(JSON.stringify({ error: e instanceof UserError ? e.message : 'Не удалось прочитать или изменить конфигурацию (' + e.name + ')' }));
    process.exitCode = 1;
  }
}
if (require.main === module) main(fs.readFileSync(0));
