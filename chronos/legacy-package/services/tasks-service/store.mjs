// Task board storage for T3 Code (shared by the HTTP service and the MCP server). No dependencies.
// Data: ~/.t3/tasks/{meta.json, groups.json, trash.json, projects/<projectId>.json}. Projects come from T3's SQLite (read-only).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME = os.homedir();
export const DATA = process.env.OLY_TASKS_DIR || path.join(HOME, '.t3', 'tasks');
export const T3_DB = process.env.OLY_T3_DB || path.join(HOME, '.t3', 'userdata', 'statev2.sqlite');
export const STATUSES = [
  { id: 'backlog', label: 'Бэклог' },
  { id: 'doing', label: 'В работе' },
  { id: 'review', label: 'На проверке' },
  { id: 'done', label: 'Готово' },
];
export const PRIORITIES = [
  { id: 'urgent', label: 'Срочно' },
  { id: 'high', label: 'Высокий' },
  { id: 'normal', label: 'Обычный' },
  { id: 'low', label: 'Низкий' },
];
const ST_ALIASES = { backlog: 'backlog', todo: 'backlog', 'бэклог': 'backlog', 'беклог': 'backlog', doing: 'doing', in_progress: 'doing', 'in progress': 'doing', progress: 'doing', wip: 'doing', 'в работе': 'doing', review: 'review', 'на проверке': 'review', 'проверка': 'review', done: 'done', closed: 'done', completed: 'done', 'готово': 'done', 'сделано': 'done' };
const PR_ALIASES = { urgent: 'urgent', critical: 'urgent', 'срочно': 'urgent', 'срочный': 'urgent', high: 'high', 'высокий': 'high', normal: 'normal', medium: 'normal', 'обычный': 'normal', 'средний': 'normal', low: 'low', 'низкий': 'low' };
export const normStatus = (s) => (s == null ? null : ST_ALIASES[String(s).trim().toLowerCase()] || null);
export const normPriority = (s) => (s == null ? null : PR_ALIASES[String(s).trim().toLowerCase()] || null);
export const statusLabel = (s) => (STATUSES.find((x) => x.id === s) || {}).label || s;
export const priorityLabel = (s) => (PRIORITIES.find((x) => x.id === s) || {}).label || s;

const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const TASK_RE = /^T-(\d{1,9})$/i;
const LIM = { title: 300, description: 50000, item: 500, items: 200, note: 8000, notes: 500, by: 60, group: 80 };

// ---------- files ----------
function ensureDirs() { fs.mkdirSync(path.join(DATA, 'projects'), { recursive: true }); }
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (e) {
    if (e.code !== 'ENOENT') { try { fs.copyFileSync(file, file + '.corrupt-' + Date.now()); } catch {} }
    return fallback;
  }
}
function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function writeJson(file, value) {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1));
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) { if (i > 25 || (e.code !== 'EPERM' && e.code !== 'EBUSY' && e.code !== 'EACCES')) throw e; sleepSync(20); }
  }
}
// Cross-process lock (HTTP service and any number of MCP servers write the same files).
function withLock(fn) {
  ensureDirs();
  const lock = path.join(DATA, '.lock');
  const t0 = Date.now();
  for (;;) {
    try { fs.mkdirSync(lock); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 10000) { fs.rmdirSync(lock); continue; } } catch {}
      if (Date.now() - t0 > 5000) throw new Error('Хранилище задач занято, повторите попытку');
      sleepSync(15);
    }
  }
  try { return fn(); } finally { try { fs.rmdirSync(lock); } catch {} }
}
const projFile = (pid) => path.join(DATA, 'projects', pid + '.json');
const loadProject = (pid) => { const d = readJson(projFile(pid), null); return d && Array.isArray(d.tasks) ? d : { projectId: pid, tasks: [] }; };
const saveProject = (d) => writeJson(projFile(d.projectId), d);
function allProjectFiles() {
  try { return fs.readdirSync(path.join(DATA, 'projects')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter((x) => ID_RE.test(x)); } catch { return []; }
}

// ---------- T3 projects / threads (read-only SQLite) ----------
let sqliteMod = null;
async function sqlite() {
  if (!sqliteMod) {
    const origEmit = process.emitWarning;
    process.emitWarning = (w, ...a) => (String(w).includes('SQLite') ? undefined : origEmit.call(process, w, ...a));
    sqliteMod = await import('node:sqlite');
  }
  return sqliteMod;
}
async function query(sql, ...params) {
  const { DatabaseSync } = await sqlite();
  const db = new DatabaseSync(T3_DB, { readOnly: true });
  try { return db.prepare(sql).all(...params); } finally { db.close(); }
}
function projectIcon(r){
 let custom;try{custom=JSON.parse(r.project_icon_json||'null')}catch{}
 if(custom)return custom;
 if(r.favicon_path){try{const f=path.isAbsolute(r.favicon_path)?r.favicon_path:path.resolve(r.root||'',r.favicon_path);const ext=path.extname(f).slice(1).toLowerCase();const mime={svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',ico:'image/x-icon'}[ext];if(mime&&fs.statSync(f).size<=512*1024)return {kind:'image',background:/white|light/i.test(path.basename(f))?'#132849':null,url:'data:'+mime+';base64,'+fs.readFileSync(f).toString('base64')}}catch{}}
 return null;
}
function dueDate(value){if(value==null||value==='')return null;const s=String(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)throw new Error('Неверная дата срока');return s}
function labels(value){return [...new Set((Array.isArray(value)?value:String(value||'').split(',')).map(x=>String(x).trim().slice(0,40)).filter(Boolean))].slice(0,12)}
let projCache = { at: 0, list: [] };
export async function t3Projects() {
  if (Date.now() - projCache.at < 5000) return projCache.list;
  let rows = [];
  try { rows = await query('select project_id id, title, workspace_root root, deleted_at, archived_at, pinned_at, favicon_path, project_icon_json from projection_projects'); } catch (e) { rows = []; }
  const list = rows.filter((r) => !r.deleted_at).map((r) => ({ id: r.id, title: r.title || path.basename(r.root || '') || r.id, root: r.root || '', archived: !!r.archived_at, pinned: !!r.pinned_at,icon:projectIcon(r) }));
  list.sort((a, b) => (b.pinned - a.pinned) || a.title.localeCompare(b.title, 'ru'));
  projCache = { at: Date.now(), list };
  return list;
}
export async function threadProject(threadId) {
  if (!ID_RE.test(threadId || '')) return null;
  try {
    const r = (await query('select project_id from orchestration_v2_projection_threads where thread_id = ?', threadId))[0]
      || (await query('select project_id from projection_threads where thread_id = ?', threadId))[0];
    return r ? r.project_id : null;
  } catch { return null; }
}
const normPath = (p) => path.resolve(String(p)).replace(/[\\/]+$/, '').toLowerCase();
/** Resolve a project from an id, a title, a path, or (default) a working directory. */
export async function resolveProject(ref, cwd) {
  const list = await t3Projects();
  if (ref) {
    const s = String(ref).trim();
    const byId = list.find((p) => p.id === s); if (byId) return byId;
    const low = s.toLowerCase();
    const byTitle = list.find((p) => p.title.toLowerCase() === low) || list.find((p) => p.title.toLowerCase().includes(low));
    if (byTitle) return byTitle;
    if (/[\\/]/.test(s)) return projectForPath(s, list);
    return null;
  }
  return cwd ? projectForPath(cwd, list) : null;
}
async function projectForPath(p, list) {
  const target = normPath(p);
  let best = null;
  for (const pr of list) { if (!pr.root) continue; const r = normPath(pr.root); if ((target === r || target.startsWith(r + path.sep)) && (!best || r.length > normPath(best.root).length)) best = pr; }
  if (best) return best;
  try { // T3 worktrees: match the thread's worktreePath
    const rows = await query("select project_id, json_extract(payload_json,'$.worktreePath') wt from orchestration_v2_projection_threads where json_extract(payload_json,'$.worktreePath') is not null");
    let hit = null, len = 0;
    for (const r of rows) { const w = normPath(r.wt); if ((target === w || target.startsWith(w + path.sep)) && w.length > len) { hit = r.project_id; len = w.length; } }
    if (hit) return list.find((x) => x.id === hit) || null;
  } catch {}
  return null;
}

// ---------- groups ----------
export function listGroups() { const g = readJson(path.join(DATA, 'groups.json'), []); return Array.isArray(g) ? g : []; }
export function saveGroup(input) {
  const name = String(input.name || '').trim().slice(0, LIM.group);
  if (!name) throw new Error('Укажите название группы');
  const projectIds = [...new Set((Array.isArray(input.projectIds) ? input.projectIds : []).filter((x) => ID_RE.test(String(x))))];
  return withLock(() => {
    const groups = listGroups();
    let g = input.id && groups.find((x) => x.id === input.id);
    if (g) { g.name = name; g.projectIds = projectIds; } else { g = { id: 'g' + Date.now().toString(36), name, projectIds }; groups.push(g); }
    writeJson(path.join(DATA, 'groups.json'), groups);
    return g;
  });
}
export function deleteGroup(id) {
  return withLock(() => { const groups = listGroups(); const next = groups.filter((g) => g.id !== id); writeJson(path.join(DATA, 'groups.json'), next); return groups.length !== next.length; });
}

// ---------- tasks ----------
export function listTasks(projectIds) {
  const ids = projectIds && projectIds.length ? projectIds.filter((x) => ID_RE.test(x)) : allProjectFiles();
  const out = [];
  for (const pid of ids) for (const t of loadProject(pid).tasks) out.push(t);
  const si = (s) => STATUSES.findIndex((x) => x.id === s);
  out.sort((a, b) => si(a.status) - si(b.status) || a.order - b.order || a.num - b.num);
  return out;
}
function locate(id) {
  const m = TASK_RE.exec(String(id || '').trim().replace(/^#/, ''));
  if (!m) return null;
  const num = Number(m[1]);
  for (const pid of allProjectFiles()) { const d = loadProject(pid); const i = d.tasks.findIndex((t) => t.num === num); if (i >= 0) return { d, i, t: d.tasks[i] }; }
  return null;
}
export function getTask(id) { const r = locate(id); return r ? r.t : null; }
const clean = (s, n) => String(s == null ? '' : s).replace(/\r\n/g, '\n').slice(0, n);
function cleanChecklist(list, prev) {
  if (!Array.isArray(list)) return prev || [];
  return list.slice(0, LIM.items).map((x, i) => {
    const o = typeof x === 'string' ? { text: x } : x || {};
    return { id: ID_RE.test(String(o.id || '')) ? String(o.id) : 'c' + Date.now().toString(36) + i, text: clean(o.text, LIM.item).trim(), done: !!o.done };
  }).filter((x) => x.text);
}
const now = () => new Date().toISOString();
function nextOrder(d, status) { let m = 0; for (const t of d.tasks) if (t.status === status && t.order > m) m = t.order; return m + 1024; }

export function createTask(input) {
  const projectId = String(input.projectId || '');
  if (!ID_RE.test(projectId)) throw new Error('Не указан проект');
  const title = clean(input.title, LIM.title).trim();
  if (!title) throw new Error('Укажите название задачи');
  const status = normStatus(input.status) || 'backlog';
  const priority = normPriority(input.priority) || 'normal';
  return withLock(() => {
    const meta = readJson(path.join(DATA, 'meta.json'), { version: 1, nextNum: 1 });
    const num = meta.nextNum || 1; meta.nextNum = num + 1; writeJson(path.join(DATA, 'meta.json'), meta);
    const d = loadProject(projectId);
    const t = { id: 'T-' + num, num, projectId, title, description: clean(input.description, LIM.description), priority, status,
      dueDate:dueDate(input.dueDate),labels:labels(input.labels),checklist: cleanChecklist(input.checklist), notes: [], createdAt: now(), updatedAt: now(), order: input.top ? topOrder(d, status) : nextOrder(d, status) };
    if (input.note) t.notes.push({ at: now(), by: clean(input.by || 'Пользователь', LIM.by), text: clean(input.note, LIM.note) });
    d.tasks.push(t); saveProject(d);
    return t;
  });
}
function topOrder(d, status) { let m = Infinity; for (const t of d.tasks) if (t.status === status && t.order < m) m = t.order; return m === Infinity ? 1024 : m - 1024; }

/** Partial update. Fields: title, description, priority, status, checklist (full list), check {index|id, done}, addChecklist, note, by, projectId. */
export function updateTask(id, patch) {
  return withLock(() => {
    const r = locate(id); if (!r) throw new Error('Задача не найдена: ' + id);
    let { d, i, t } = r;
    if (patch.title != null) { const v = clean(patch.title, LIM.title).trim(); if (v) t.title = v; }
    if ('dueDate' in patch) t.dueDate=dueDate(patch.dueDate);
    if ('labels' in patch) t.labels=labels(patch.labels);
    if (patch.description != null) t.description = clean(patch.description, LIM.description);
    if (patch.priority != null) { const p = normPriority(patch.priority); if (!p) throw new Error('Неизвестный приоритет: ' + patch.priority); t.priority = p; }
    if (patch.checklist != null) t.checklist = cleanChecklist(patch.checklist, t.checklist);
    if (patch.addChecklist) for (const s of [].concat(patch.addChecklist)) { const txt = clean(s, LIM.item).trim(); if (txt && t.checklist.length < LIM.items) t.checklist.push({ id: 'c' + Date.now().toString(36) + t.checklist.length, text: txt, done: false }); }
    if (patch.check != null) for (const c of [].concat(patch.check)) {
      const item = c.id != null ? t.checklist.find((x) => x.id === c.id) : t.checklist[Number(c.index)];
      if (!item) throw new Error('Нет такого пункта чек-листа'); item.done = c.done !== false;
    }
    if (patch.status != null) {
      const s = normStatus(patch.status); if (!s) throw new Error('Неизвестный статус: ' + patch.status);
      if (s !== t.status) { t.status = s; t.order = nextOrder(d, s); }
    }
    if (patch.note) { t.notes.push({ at: now(), by: clean(patch.by || 'Пользователь', LIM.by), text: clean(patch.note, LIM.note) }); if (t.notes.length > LIM.notes) t.notes.splice(0, t.notes.length - LIM.notes); }
    if (patch.projectId && patch.projectId !== t.projectId) {
      if (!ID_RE.test(patch.projectId)) throw new Error('Неверный проект');
      d.tasks.splice(i, 1); saveProject(d);
      const nd = loadProject(patch.projectId); t.projectId = patch.projectId; t.order = nextOrder(nd, t.status); nd.tasks.push(t); d = nd;
    }
    t.updatedAt = now(); saveProject(d);
    return t;
  });
}
/** Move a card to a column, before another card (or to the end). */
export function moveTask(id, status, beforeId) {
  return withLock(() => {
    const r = locate(id); if (!r) throw new Error('Задача не найдена: ' + id);
    const { d, t } = r; const s = normStatus(status) || t.status;
    const col = d.tasks.filter((x) => x.status === s && x !== t).sort((a, b) => a.order - b.order);
    const bi = beforeId ? col.findIndex((x) => x.id.toLowerCase() === String(beforeId).toLowerCase()) : -1;
    let order;
    if (bi < 0) order = col.length ? col[col.length - 1].order + 1024 : 1024;
    else if (bi === 0) order = col[0].order - 1024;
    else order = (col[bi - 1].order + col[bi].order) / 2;
    if (bi > 0 && Math.abs(col[bi].order - col[bi - 1].order) < 1e-6) { col.forEach((x, k) => { x.order = (k + 1) * 1024; }); order = bi * 1024 + 512; }
    t.status = s; t.order = order; t.updatedAt = now(); saveProject(d);
    return t;
  });
}
export function deleteTask(id) {
  return withLock(() => {
    const r = locate(id); if (!r) return false;
    r.d.tasks.splice(r.i, 1); saveProject(r.d);
    const trashFile = path.join(DATA, 'trash.json'); const trash = readJson(trashFile, []);
    trash.push({ ...r.t, deletedAt: now() }); writeJson(trashFile, trash.slice(-500));
    return true;
  });
}
export function counts(projectIds) {
  const out = {};
  for (const t of listTasks(projectIds)) { const c = out[t.projectId] || (out[t.projectId] = { total: 0, open: 0, doing: 0 }); c.total++; if (t.status !== 'done') c.open++; if (t.status === 'doing') c.doing++; }
  return out;
}
