// MCP server (stdio, JSON-RPC 2.0, newline-delimited) for the T3 task board. No dependencies.
// Lets Claude Code / Codex agents read and update tasks. Default project = the T3 project containing the agent's working directory.
import readline from 'node:readline';
import * as S from './store.mjs';

const SERVER = { name: 'oly-tasks', version: '1.0.0' };
let clientName = process.env.OLY_TASKS_AGENT || '';
const agentName = () => {
  const n = clientName.toLowerCase();
  if (process.env.OLY_TASKS_AGENT) return process.env.OLY_TASKS_AGENT;
  if (n.includes('claude')) return 'Claude Code';
  if (n.includes('codex')) return 'Codex';
  return clientName || 'ИИ-агент';
};
const out = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const STATUS_ENUM = S.STATUSES.map((s) => s.id);
const PRIORITY_ENUM = S.PRIORITIES.map((s) => s.id);
const projectProp = { type: 'string', description: 'Проект T3: id, название или путь. По умолчанию — проект текущей рабочей папки. "all" — все проекты.' };

const TOOLS = [
  { name: 'list_projects', description: 'Список проектов T3 со счётчиками задач (всего / открытых / в работе).', inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true } },
  { name: 'list_tasks', description: 'Задачи с доски «Задачи» в T3 (как Trello). Статусы: backlog (Бэклог), doing (В работе), review (На проверке), done (Готово). По умолчанию — открытые задачи проекта текущей папки.',
    inputSchema: { type: 'object', properties: { project: projectProp, status: { type: 'string', enum: STATUS_ENUM, description: 'Только этот статус' }, query: { type: 'string', description: 'Поиск по id, названию и описанию' }, include_done: { type: 'boolean', description: 'Показывать выполненные (по умолчанию нет)' } } },
    annotations: { readOnlyHint: true } },
  { name: 'get_task', description: 'Полная задача: описание/план (markdown), чек-лист, заметки, статус. Ссылки в чате выглядят как #T-12.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Id задачи, например T-12' } }, required: ['id'] }, annotations: { readOnlyHint: true } },
  { name: 'add_task', description: 'Создать задачу на доске.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string', description: 'Описание или план в markdown' }, project: projectProp,
      dueDate:{type:'string',description:'Срок YYYY-MM-DD, пустая строка снимает срок'},labels:{type:'array',items:{type:'string'},description:'Метки задачи'},priority: { type: 'string', enum: PRIORITY_ENUM }, status: { type: 'string', enum: STATUS_ENUM }, checklist: { type: 'array', items: { type: 'string' }, description: 'Пункты чек-листа' } }, required: ['title'] } },
  { name: 'update_task', description: 'Обновить задачу: сменить статус (возьми в работу — doing, сделал — review, если нужна проверка пользователем, иначе done), оставить заметку о ходе работы, отметить пункты чек-листа, поправить описание.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', enum: STATUS_ENUM }, note: { type: 'string', description: 'Заметка о ходе работы (добавляется в историю задачи)' },
      title: { type: 'string' }, description: { type: 'string' }, dueDate:{type:'string',description:'Срок YYYY-MM-DD, пустая строка снимает срок'},labels:{type:'array',items:{type:'string'},description:'Метки задачи'},priority: { type: 'string', enum: PRIORITY_ENUM },
      check_items: { type: 'array', items: { type: 'integer' }, description: 'Номера пунктов чек-листа (с 1), которые выполнены' },
      uncheck_items: { type: 'array', items: { type: 'integer' }, description: 'Номера пунктов (с 1), снова не выполненных' },
      add_checklist: { type: 'array', items: { type: 'string' }, description: 'Добавить пункты чек-листа' } }, required: ['id'] } },
];

async function projectsById() { const m = new Map(); for (const p of await S.t3Projects()) m.set(p.id, p); return m; }
async function scope(project) {
  if (project && String(project).toLowerCase() === 'all') return { ids: null, label: 'все проекты' };
  const p = await S.resolveProject(project, project ? null : (process.env.OLY_TASKS_PROJECT ? null : process.cwd()));
  if (!p && process.env.OLY_TASKS_PROJECT && !project) { const q = await S.resolveProject(process.env.OLY_TASKS_PROJECT); if (q) return { ids: [q.id], label: q.title, project: q }; }
  if (!p) {
    if (project) throw new Error(`Проект «${project}» не найден. Вызовите list_projects.`);
    return { ids: null, label: 'все проекты (текущая папка не относится к проекту T3)' };
  }
  return { ids: [p.id], label: p.title, project: p };
}
function line(t, pm) {
  const cl = t.checklist.length ? ` · чек-лист ${t.checklist.filter((c) => c.done).length}/${t.checklist.length}` : '';
  const pr = t.priority !== 'normal' ? ` · ${S.priorityLabel(t.priority)}` : '';
  const proj = pm ? ` · ${(pm.get(t.projectId) || {}).title || t.projectId}` : '';
  return `- #${t.id} [${S.statusLabel(t.status)}${pr}${cl}${proj}] ${t.title}`;
}
function full(t, pm) {
  const p = pm.get(t.projectId);
  let s = `# #${t.id} ${t.title}\nПроект: ${p ? `${p.title} (${p.root})` : t.projectId}\nСтатус: ${S.statusLabel(t.status)} (${t.status}) · Приоритет: ${S.priorityLabel(t.priority)}\nСоздана: ${t.createdAt} · Обновлена: ${t.updatedAt}\n`;
  s += `\n## Описание\n${t.description.trim() || '(нет)'}\n`;
  if (t.checklist.length) s += `\n## Чек-лист\n${t.checklist.map((c, i) => `${i + 1}. [${c.done ? 'x' : ' '}] ${c.text}`).join('\n')}\n`;
  if (t.notes.length) s += `\n## Заметки\n${t.notes.slice(-30).map((n) => `- ${n.at.slice(0, 16).replace('T', ' ')} ${n.by}: ${n.text}`).join('\n')}\n`;
  return s;
}

async function call(name, a) {
  a = a || {};
  if (name === 'list_projects') {
    const c = S.counts(); const list = (await S.t3Projects()).filter((p) => !p.archived);
    return list.map((p) => { const x = c[p.id] || { total: 0, open: 0, doing: 0 }; return `- ${p.title} — ${p.root} · задач: ${x.total}, открытых: ${x.open}, в работе: ${x.doing}`; }).join('\n') || 'Проектов нет.';
  }
  if (name === 'list_tasks') {
    const sc = await scope(a.project); const pm = await projectsById();
    let tasks = S.listTasks(sc.ids);
    const st = a.status ? S.normStatus(a.status) : null;
    if (a.status && !st) throw new Error('Неизвестный статус: ' + a.status);
    if (st) tasks = tasks.filter((t) => t.status === st); else if (!a.include_done) tasks = tasks.filter((t) => t.status !== 'done');
    if (a.query) { const q = String(a.query).toLowerCase(); tasks = tasks.filter((t) => (t.id + ' ' + t.title + ' ' + t.description).toLowerCase().includes(q)); }
    if (!tasks.length) return `Задач нет (${sc.label}).`;
    return `Задачи — ${sc.label}:\n` + tasks.map((t) => line(t, sc.ids && sc.ids.length === 1 ? null : pm)).join('\n') + '\n\nПодробности: get_task(id).';
  }
  if (name === 'get_task') { const t = S.getTask(a.id); if (!t) throw new Error('Задача не найдена: ' + a.id); return full(t, await projectsById()); }
  if (name === 'add_task') {
    const sc = await scope(a.project);
    if (!sc.project) throw new Error('Укажите project: текущая папка не относится к проекту T3.');
    const t = S.createTask({ projectId: sc.project.id, title: a.title, description: a.description, dueDate:a.dueDate,labels:a.labels,priority: a.priority, status: a.status, checklist: a.checklist, by: agentName() });
    return `Создана задача #${t.id} в проекте ${sc.project.title}.`;
  }
  if (name === 'update_task') {
    const t0 = S.getTask(a.id); if (!t0) throw new Error('Задача не найдена: ' + a.id);
    const check = [];
    for (const i of a.check_items || []) check.push({ index: Number(i) - 1, done: true });
    for (const i of a.uncheck_items || []) check.push({ index: Number(i) - 1, done: false });
    const t = S.updateTask(a.id, { status: a.status, note: a.note, by: agentName(), title: a.title, description: a.description, ...('dueDate'in a?{dueDate:a.dueDate}:{}),...('labels'in a?{labels:a.labels}:{}),priority: a.priority, check: check.length ? check : null, addChecklist: a.add_checklist });
    return `Обновлено: #${t.id} — ${S.statusLabel(t.status)}${t.checklist.length ? `, чек-лист ${t.checklist.filter((c) => c.done).length}/${t.checklist.length}` : ''}.`;
  }
  throw new Error('Неизвестный инструмент: ' + name);
}

async function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => id !== undefined && out({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => id !== undefined && out({ jsonrpc: '2.0', id, error: { code, message } });
  try {
    if (method === 'initialize') {
      clientName = (params && params.clientInfo && params.clientInfo.name) || clientName;
      return reply({ protocolVersion: (params && params.protocolVersion) || '2025-06-18', capabilities: { tools: {} }, serverInfo: SERVER,
        instructions: 'Доска задач пользователя в T3 Code. Ссылка вида #T-12 в сообщении — это задача: прочитай её через get_task, переведи в doing, по ходу оставляй заметки (update_task note), по завершении — review или done.' });
    }
    if (method === 'ping') return reply({});
    if (method === 'tools/list') return reply({ tools: TOOLS });
    if (method === 'tools/call') {
      try { const text = await call(params && params.name, params && params.arguments); return reply({ content: [{ type: 'text', text }] }); }
      catch (e) { return reply({ content: [{ type: 'text', text: 'Ошибка: ' + ((e && e.message) || e) }], isError: true }); }
    }
    if (method === 'resources/list') return reply({ resources: [] });
    if (method === 'prompts/list') return reply({ prompts: [] });
    if (method && method.startsWith('notifications/')) return;
    return fail(-32601, 'Method not found: ' + method);
  } catch (e) { return fail(-32603, String((e && e.message) || e)); }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (l) => { l = l.trim(); if (!l) return; let msg; try { msg = JSON.parse(l); } catch { return out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  for (const m of Array.isArray(msg) ? msg : [msg]) queue = queue.then(() => handle(m)); });
let queue = Promise.resolve(); // process requests in order
rl.on('close', () => { queue.then(() => process.exit(0)); });
