// MCP server (stdio, JSON-RPC 2.0, newline-delimited) for the T3 skills manager. No dependencies.
// Every operation goes through the local skills-manager service (server.mjs, 127.0.0.1:4517), so agents get exactly the
// same validation, trash backups and SSH handling as the in-app «Скиллы» page. No arbitrary shell or proxy access.
import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER = { name: 'oly-skills', version: '1.0.0' };
const BASE = (process.env.OLY_SKILLS_URL || 'http://127.0.0.1:4517').replace(/\/+$/, '');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const out = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const TRASH_HINT = 'старые копии не удаляются, а переносятся в корзину caches/skills-trash в каталоге данных (на серверах — ~/.skills-trash)';

const locProp = { type: 'string', description: 'Расположение: id из list_locations, или claude / codex / agents (папки пользователя), или project:claude / project:codex / project:agents (текущий проект T3 по рабочей папке)' };
const locsProp = { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Куда: список расположений (id из list_locations или те же короткие имена, что в location)' };
const nameProp = { type: 'string', description: 'Имя папки скилла, например frontend-design' };
const disabledProp = { type: 'boolean', description: 'Отключённая копия скилла. Если не указано — найдётся автоматически (сначала включённая)' };
const RO = { readOnlyHint: true, openWorldHint: false };
const TOOLS = [
  { name: 'list_locations', description: 'Где лежат скиллы: папки Claude Code / Codex / .agents этого компьютера, проектов T3 и SSH-серверов. Возвращает id для остальных инструментов.',
    inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['all', 'local', 'projects', 'servers'], description: 'Фильтр, по умолчанию all' } } }, annotations: RO },
  { name: 'list_skills', description: 'Список скиллов с описанием и состоянием (включён/отключён). Без location — папки пользователя и текущего проекта (без SSH). query — поиск по словам в имени и описании.',
    inputSchema: { type: 'object', properties: { location: locProp, query: { type: 'string' }, include_disabled: { type: 'boolean', description: 'По умолчанию true' }, refresh: { type: 'boolean', description: 'Перечитать SSH-сервер без кэша' } } }, annotations: RO },
  { name: 'read_skill', description: 'Прочитать SKILL.md скилла и список его файлов.',
    inputSchema: { type: 'object', properties: { location: locProp, name: nameProp, disabled: disabledProp }, required: ['location', 'name'] }, annotations: RO },
  { name: 'read_skill_file', description: 'Прочитать один файл внутри папки скилла (до 512 КиБ, только текст).',
    inputSchema: { type: 'object', properties: { location: locProp, name: nameProp, path: { type: 'string', description: 'Путь внутри скилла, например references/api.md' }, disabled: disabledProp }, required: ['location', 'name', 'path'] }, annotations: RO },
  { name: 'create_skill', description: 'Создать новый скилл. Без markdown — по шаблону менеджера. Существующие скиллы не перезаписывает.',
    inputSchema: { type: 'object', properties: { name: nameProp, description: { type: 'string', description: 'Когда агенту применять скилл' }, markdown: { type: 'string', description: 'Полный SKILL.md с frontmatter name/description' }, locations: locsProp }, required: ['name', 'locations'] },
    annotations: { destructiveHint: false, openWorldHint: false } },
  { name: 'write_skill_file', description: 'Изменить или добавить файл в существующем скилле (по умолчанию SKILL.md, текст до 200 000 символов). Перед записью вся прежняя папка скилла копируется в корзину.',
    inputSchema: { type: 'object', properties: { location: locProp, name: nameProp, path: { type: 'string', description: 'Путь внутри скилла, по умолчанию SKILL.md' }, content: { type: 'string', description: 'Новый полный текст файла' }, disabled: disabledProp }, required: ['location', 'name', 'content'] },
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false } },
  { name: 'set_skill_enabled', description: 'Включить или отключить скилл (отключённый переносится в соседнюю папку skills.disabled и не виден агенту).',
    inputSchema: { type: 'object', properties: { location: locProp, name: nameProp, enabled: { type: 'boolean' } }, required: ['location', 'name', 'enabled'] }, annotations: { idempotentHint: true, openWorldHint: false } },
  { name: 'copy_skill', description: 'Скопировать или синхронизировать скилл в другие расположения (в т.ч. на SSH-серверы). overwrite: true заменяет существующие копии; ' + TRASH_HINT + '.',
    inputSchema: { type: 'object', properties: { from: locProp, name: nameProp, to: locsProp, overwrite: { type: 'boolean' }, disabled: disabledProp }, required: ['from', 'name', 'to'] },
    annotations: { destructiveHint: true, openWorldHint: false } },
  { name: 'trash_skill', description: 'Удалить скилл в корзину (обратимо: папка переносится в caches/skills-trash в каталоге данных или ~/.skills-trash на сервере).',
    inputSchema: { type: 'object', properties: { location: locProp, name: nameProp, disabled: disabledProp }, required: ['location', 'name'] }, annotations: { destructiveHint: true, openWorldHint: false } },
  { name: 'search_catalog', description: 'Поиск готовых скиллов в каталоге skills.sh.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, annotations: { readOnlyHint: true, openWorldHint: true } },
  { name: 'install_skill', description: 'Установить скилл из каталога skills.sh (source и skillId — из search_catalog). overwrite: true обновляет существующие копии; ' + TRASH_HINT + '.',
    inputSchema: { type: 'object', properties: { source: { type: 'string', description: 'Репозиторий owner/repo' }, skillId: { type: 'string' }, locations: locsProp, overwrite: { type: 'boolean' }, name: { type: 'string', description: 'Другое имя папки (необязательно)' } }, required: ['source', 'skillId', 'locations'] },
    annotations: { destructiveHint: true, openWorldHint: true } },
  { name: 'check_updates', description: 'Сравнить скиллы расположения с их версиями в skills.sh/GitHub: что совпадает, что отличается, у чего нет источника.',
    inputSchema: { type: 'object', properties: { location: locProp, names: { type: 'array', items: { type: 'string' }, description: 'Только эти скиллы (по умолчанию все, до 80)' } }, required: ['location'] }, annotations: { readOnlyHint: true, openWorldHint: true } },
  { name: 'update_skill', description: 'Обновить скилл до версии из skills.sh/GitHub в указанных расположениях; ' + TRASH_HINT + '.',
    inputSchema: { type: 'object', properties: { name: nameProp, locations: locsProp }, required: ['name', 'locations'] }, annotations: { destructiveHint: true, openWorldHint: true } },
];

// ---------- service access ----------
let started = false;
async function health() { try { const r = await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(2000) }); return r.ok; } catch { return false; } }
async function ensureService() {
  if (await health()) return;
  if (!started && !process.env.OLY_SKILLS_URL && fs.existsSync(path.join(HERE, 'server.mjs'))) {
    started = true;
    spawn(process.execPath, ['server.mjs'], { cwd: HERE, detached: true, stdio: 'ignore', windowsHide: true }).unref();
    for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 400)); if (await health()) return; }
  }
  throw new Error(`Менеджер скиллов не отвечает на ${BASE}. Запустите его: ${path.join(HERE, 'start-hidden.vbs')} (или node server.mjs в этой папке), затем повторите.`);
}
function hint(status, msg) {
  if (msg === 'not found') return 'Менеджер скиллов запущен в старой версии без этой функции. Перезапустите службу skills-manager (или T3) и повторите.';
  if (/Неизвестное расположение/.test(msg)) return msg + '. Возьмите id из list_locations.';
  if (/Некорректное имя/.test(msg)) return msg + ': латиница, цифры, точка, дефис, подчёркивание; до 128 символов.';
  if (status === 409) return msg + '. Чтобы заменить существующую копию, повторите с overwrite: true (' + TRASH_HINT + ').';
  if (status === 404) return msg + '. Проверьте имя и состояние через list_skills.';
  if (/^SSH/.test(msg)) return msg + '. Проверьте, что сервер доступен по ssh без пароля (ключ, BatchMode).';
  return msg;
}
async function api(method, route, payload) {
  await ensureService();
  const init = { method, headers: { 'x-oly-skills': '1' }, signal: AbortSignal.timeout(method === 'GET' ? 120000 : 300000) };
  let url = BASE + route;
  if (method === 'GET' && payload) { const q = new URLSearchParams(); for (const [k, v] of Object.entries(payload)) if (v !== undefined && v !== null && v !== false) q.set(k, v === true ? '1' : String(v)); url += '?' + q; }
  else if (payload) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(payload); }
  const r = await fetch(url, init);
  const j = await r.json().catch(() => ({ error: 'Некорректный ответ менеджера скиллов (' + r.status + ')' }));
  if (!r.ok) throw new Error(hint(r.status, j.error || String(r.status)));
  return j;
}

// ---------- locations ----------
let locCache = null;
async function locations() { if (!locCache) locCache = await api('GET', '/api/locations'); return locCache; }
const norm = (p) => path.resolve(p).toLowerCase();
async function currentProject(agent) {
  const cwd = norm(process.cwd());
  const hits = (await locations()).filter((l) => l.kind === 'local' && l.group === 'Проекты' && l.agent === agent).map((l) => ({ l, root: norm(path.dirname(path.dirname(l.path))) }))
    .filter((x) => cwd === x.root || cwd.startsWith(x.root + path.sep)).sort((a, b) => b.root.length - a.root.length);
  if (!hits.length) throw new Error(`Текущая папка (${process.cwd()}) не относится к проекту T3. Укажите id из list_locations.`);
  return hits[0].l;
}
async function resolveLoc(v) {
  const s = String(v || '').trim();
  if (!s) throw new Error('Не указано расположение. Возьмите id из list_locations или используйте claude / codex / agents.');
  const all = await locations();
  const exact = all.find((l) => l.id === s); if (exact) return exact;
  const m = /^(project:)?(claude|codex|agents)$/i.exec(s);
  if (m) return m[1] ? currentProject(m[2].toLowerCase()) : all.find((l) => l.id === 'local:user:' + m[2].toLowerCase());
  const byLabel = all.filter((l) => l.label.toLowerCase() === s.toLowerCase()); if (byLabel.length === 1) return byLabel[0];
  throw new Error(`Неизвестное расположение «${s}». Возьмите id из list_locations.`);
}
async function listIn(l, refresh) { return api('GET', '/api/skills', { loc: l.id, refresh }); }
async function whichCopy(l, name, disabled) {
  if (typeof disabled === 'boolean') return disabled;
  const { skills } = await listIn(l);
  const copies = skills.filter((x) => x.name === name);
  if (!copies.length) throw new Error(`Скилл «${name}» не найден в ${l.label}. Проверьте имя через list_skills.`);
  return copies.every((x) => x.disabled);
}
const results = (rs, ok) => {
  const lines = rs.map((r) => (r.ok ? '✓ ' : '✗ ') + r.id + (r.ok ? '' : ' — ' + hint(/уже есть/.test(r.error || '') ? 409 : 400, r.error)));
  const text = ok + '\n' + lines.join('\n');
  if (rs.length && rs.every((r) => !r.ok)) throw new Error(text);
  return text;
};
const words = (q) => String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
const line = (s) => `- ${s.name}${s.disabled ? ' [отключён]' : ''}${s.link ? ' [ссылка]' : ''}${s.description ? ' — ' + s.description.replace(/\s+/g, ' ').slice(0, 200) : ''}`;

async function call(name, a = {}) {
  switch (name) {
    case 'list_locations': {
      const kind = a.kind || 'all';
      const ls = (await locations()).filter((l) => kind === 'all' || (kind === 'servers' ? l.kind === 'ssh' : kind === 'projects' ? l.group === 'Проекты' : l.kind === 'local' && l.group !== 'Проекты'));
      return ls.map((l) => `${l.id}\t${l.label}\t${l.path}${l.exists === false ? '\t(папки ещё нет)' : ''}`).join('\n') || 'Расположений нет.';
    }
    case 'list_skills': {
      let ls;
      if (a.location) ls = [await resolveLoc(a.location)];
      else { ls = (await locations()).filter((l) => l.id.startsWith('local:user:')); for (const ag of ['claude', 'codex', 'agents']) { try { ls.push(await currentProject(ag)); } catch {} } }
      const q = words(a.query), parts = [];
      for (const l of ls) {
        let data; try { data = await listIn(l, a.refresh); } catch (e) { parts.push(`## ${l.label} (${l.id})\nОшибка: ${e.message}`); continue; }
        const sk = data.skills.filter((s) => a.include_disabled !== false || !s.disabled).filter((s) => q.every((w) => (s.name + ' ' + s.title + ' ' + s.description).toLowerCase().includes(w)));
        if (a.location || sk.length) parts.push(`## ${l.label} (${l.id})${data.exists ? '' : ' — папки нет'}\n${sk.map(line).join('\n') || 'Нет скиллов' + (q.length ? ' по запросу' : '')}`);
      }
      return parts.join('\n\n') || 'Скиллов не найдено.';
    }
    case 'read_skill': {
      const l = await resolveLoc(a.location), disabled = await whichCopy(l, a.name, a.disabled);
      const r = await api('GET', '/api/skill', { loc: l.id, name: a.name, disabled });
      return `${l.label} / ${a.name}${disabled ? ' [отключён]' : ''}\nФайлы: ${r.files.map((f) => `${f.path} (${f.size} Б)`).join(', ')}\n\n${r.markdown}`;
    }
    case 'read_skill_file': {
      const l = await resolveLoc(a.location), disabled = await whichCopy(l, a.name, a.disabled);
      const r = await api('GET', '/api/file', { loc: l.id, name: a.name, disabled, path: a.path });
      if (r.binary) return `«${r.path}» — двоичный файл (${r.size} Б), содержимое не выводится.`;
      if (r.truncated) return `«${r.path}» слишком большой (${r.size} Б, лимит 512 КиБ).`;
      return r.text;
    }
    case 'create_skill': {
      const to = await Promise.all((a.locations || []).map(resolveLoc));
      if (!to.length) throw new Error('Укажите locations — куда создать скилл.');
      return results((await api('POST', '/api/create', { name: a.name, description: a.description, markdown: a.markdown, to: to.map((l) => l.id) })).results, `Скилл «${a.name}» создан:`);
    }
    case 'write_skill_file': {
      const l = await resolveLoc(a.location), disabled = await whichCopy(l, a.name, a.disabled);
      const r = await api('POST', '/api/write', { loc: l.id, name: a.name, disabled, path: a.path || 'SKILL.md', content: a.content });
      return `Записано: ${l.label} / ${a.name} / ${r.path}. Прежняя версия скилла сохранена: ${r.backup}`;
    }
    case 'set_skill_enabled': {
      const l = await resolveLoc(a.location);
      const { skills } = await listIn(l);
      const copies = skills.filter((x) => x.name === a.name);
      if (!copies.length) throw new Error(`Скилл «${a.name}» не найден в ${l.label}. Проверьте имя через list_skills.`);
      if (copies.some((x) => x.disabled === !a.enabled)) return `«${a.name}» уже ${a.enabled ? 'включён' : 'отключён'} в ${l.label}.`;
      await api('POST', '/api/toggle', { loc: l.id, name: a.name, enable: !!a.enabled });
      return `«${a.name}» ${a.enabled ? 'включён' : 'отключён'} в ${l.label}.`;
    }
    case 'copy_skill': {
      const from = await resolveLoc(a.from), disabled = await whichCopy(from, a.name, a.disabled);
      const to = await Promise.all((a.to || []).map(resolveLoc));
      if (!to.filter((l) => l.id !== from.id).length) throw new Error('Укажите в to хотя бы одно расположение, отличное от from.');
      return results((await api('POST', '/api/copy', { from: from.id, name: a.name, to: to.map((l) => l.id), overwrite: !!a.overwrite, disabled })).results, `Копирование «${a.name}» из ${from.label}:`);
    }
    case 'trash_skill': {
      const l = await resolveLoc(a.location), disabled = await whichCopy(l, a.name, a.disabled);
      const r = await api('POST', '/api/delete', { loc: l.id, name: a.name, disabled });
      return `«${a.name}» перенесён в корзину: ${r.trash}. Чтобы вернуть — перенесите папку обратно в ${l.path}${disabled ? '.disabled' : ''}.`;
    }
    case 'search_catalog': {
      const hits = await api('GET', '/api/search', { q: a.query || '' });
      return hits.map((h) => `- ${h.name} — source: ${h.source}, skillId: ${h.skillId}${h.installs ? `, установок: ${h.installs}` : ''}`).join('\n') || 'Ничего не найдено.';
    }
    case 'install_skill': {
      const to = await Promise.all((a.locations || []).map(resolveLoc));
      if (!to.length) throw new Error('Укажите locations — куда установить скилл.');
      return results((await api('POST', '/api/install', { source: a.source, skillId: a.skillId, name: a.name, overwrite: !!a.overwrite, to: to.map((l) => l.id) })).results, `Установка ${a.source} / ${a.skillId}:`);
    }
    case 'check_updates': {
      const l = await resolveLoc(a.location);
      const [{ skills }, hashes] = await Promise.all([listIn(l), api('GET', '/api/hashes', { loc: l.id })]);
      const names = [...new Set(skills.map((s) => s.name))].filter((n) => !a.names || a.names.includes(n)).slice(0, 80);
      if (!names.length) return 'Нет скиллов для проверки.';
      const up = await api('POST', '/api/upstream', { names });
      return names.map((n) => {
        const u = up[n], h = hashes[n] || hashes['!' + n];
        if (!u) return `- ${n}: источник в skills.sh не найден`;
        if (u.error) return `- ${n}: ${u.source ? u.source + ' — ' : ''}ошибка: ${u.error}`;
        return `- ${n}: ${u.hash === h ? 'актуален' : 'есть отличия от ' + u.source + ' (update_skill обновит)'}`;
      }).join('\n');
    }
    case 'update_skill': {
      const to = await Promise.all((a.locations || []).map(resolveLoc));
      if (!to.length) throw new Error('Укажите locations — где обновить скилл.');
      const u = (await api('POST', '/api/upstream', { names: [a.name] }))[a.name];
      if (!u || !u.source) throw new Error(`Для «${a.name}» не найден источник в skills.sh. Установите нужную версию через search_catalog + install_skill.`);
      if (u.error) throw new Error(`Источник ${u.source}: ${u.error}`);
      return results((await api('POST', '/api/install', { source: u.source, skillId: u.skillId, name: a.name, overwrite: true, to: to.map((l) => l.id) })).results, `Обновление «${a.name}» из ${u.source}:`);
    }
  }
  throw new Error('Неизвестный инструмент: ' + name);
}

async function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => id !== undefined && out({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => id !== undefined && out({ jsonrpc: '2.0', id, error: { code, message } });
  try {
    if (method === 'initialize') {
      return reply({ protocolVersion: (params && params.protocolVersion) || '2025-06-18', capabilities: { tools: {} }, serverInfo: SERVER,
        instructions: 'Менеджер скиллов T3 (те же данные, что страница «Скиллы»). Начни с list_locations / list_skills. Изменения идут через сервис менеджера: удаление и замена переносят старые копии в корзину.' });
    }
    if (method === 'ping') return reply({});
    if (method === 'tools/list') return reply({ tools: TOOLS });
    if (method === 'tools/call') {
      try { const text = await call(params && params.name, (params && params.arguments) || {}); return reply({ content: [{ type: 'text', text }] }); }
      catch (e) { return reply({ content: [{ type: 'text', text: 'Ошибка: ' + ((e && e.message) || e) }], isError: true }); }
    }
    if (method === 'resources/list') return reply({ resources: [] });
    if (method === 'prompts/list') return reply({ prompts: [] });
    if (method && method.startsWith('notifications/')) return;
    return fail(-32601, 'Method not found: ' + method);
  } catch (e) { return fail(-32603, String((e && e.message) || e)); }
}

let queue = Promise.resolve(); // process requests in order
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (l) => { l = l.trim(); if (!l) return; let msg; try { msg = JSON.parse(l); } catch { return out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  for (const m of Array.isArray(msg) ? msg : [msg]) queue = queue.then(() => handle(m)); });
// Let pending fetches and stdout drain naturally on stdin EOF (Windows libuv).
