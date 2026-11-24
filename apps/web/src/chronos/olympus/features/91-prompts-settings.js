;(()=>{try{
if (globalThis.__olyPromptsSettings) return;
// «Шаблоны промптов» in Settings. The page is built from the same Tailwind classes / data-slot hooks as T3's own
// settings pages (header with breadcrumbs, settings-group, settings-row, buttons, input-group), so every theme styles
// it like a native page. Own CSS below only covers the bits T3 has no class for (row hover, !command badge, select).
const navSelector = 'nav[data-workspace-area="settings-nav"]';
const api = 'http://127.0.0.1:4517/api/prompts';
const fallbackModes = {default:'Выполнение', plan:'Планирование', brainstorm:'Мозговой штурм',
  'bug-hunter':'Охотник за багами', 'design-plan':'Планирование дизайна'};
const empty = {name:'', title:'', description:'', mode:'', body:'', revision:null};
let active = null, recovered = null;

const BTN = "[&_svg]:-mx-0.5 relative inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-[var(--control-radius)] border font-medium outline-none transition-[box-shadow,scale] [&:not([aria-haspopup]):not(:disabled):not([aria-disabled=true])]:will-change-[scale] [&:active:not([aria-haspopup])]:scale-[0.97] before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--control-radius)-1px)] pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 aria-disabled:cursor-not-allowed aria-disabled:opacity-64 [&_svg:not([class*='text-'])]:text-[var(--control-icon-color)] [&_svg]:pointer-events-none [&_svg]:shrink-0 text-base sm:text-sm [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 ";
const C = {
  header:'flex h-12 shrink-0 items-center gap-3 border-b ps-5 pe-2',
  crumbNav:'min-w-0',
  crumbOl:'m-0 flex min-w-0 list-none items-center gap-2 p-0 text-sm sm:gap-3',
  crumbLi:'flex min-w-0 items-center font-medium shrink-0 text-muted-foreground',
  crumbSep:'flex shrink-0 items-center text-icon-muted',
  crumbCur:'flex min-w-0 items-center font-medium text-foreground truncate',
  headRight:'ms-auto flex shrink-0 items-center gap-1',
  bodyWrap:'min-h-0 flex flex-1 flex-col',
  scroll:'topbar-scroll-fade scrollbar-gutter-both flex-1 overflow-y-auto',
  inner:'mx-auto flex w-full flex-col px-5 pt-6 pb-12 sm:px-6 max-w-4xl gap-8',
  section:'space-y-2.5',
  secHead:'flex min-h-7 flex-wrap items-start justify-between gap-x-4 gap-y-1 px-3 sm:px-4',
  secHeadL:'flex min-w-0 items-center gap-1',
  h2:'flex min-h-7 items-center gap-2 text-base font-semibold text-foreground',
  desc:'max-w-2xl text-pretty text-xs leading-normal text-muted-foreground px-3 sm:px-4',
  group:'relative overflow-visible text-foreground rounded-xl border border-border/60 bg-card/40 shadow-xs/5 *:not-first:border-t *:not-first:border-border/50 [&>[data-slot=settings-row]]:rounded-none',
  row:'group/settings-row @container/settings-row rounded-xl px-3 sm:px-4 aria-disabled:opacity-64 aria-disabled:[&_*]:text-muted-foreground py-3',
  rowGrid:'flex flex-col gap-3 @min-[32rem]/settings-row:grid @min-[32rem]/settings-row:grid-cols-[minmax(0,1fr)_auto] @min-[32rem]/settings-row:items-center @min-[32rem]/settings-row:gap-8',
  rowText:'min-w-0 flex-1 space-y-1',
  rowTitle:'flex min-h-5 items-center gap-1.5',
  h3:'text-sm font-medium text-foreground',
  rowP:'max-w-2xl text-pretty text-xs leading-normal text-muted-foreground',
  rowCtl:'flex w-full min-w-0 shrink-0 items-center gap-2 @min-[32rem]/settings-row:w-auto @min-[32rem]/settings-row:justify-end',
  inputGroup:'relative inline-flex w-full items-center rounded-[var(--control-radius)] border text-base text-foreground ring-ring/24 transition-shadow has-[textarea]:h-auto has-[input:focus-visible,textarea:focus-visible]:border-ring has-[input:disabled,textarea:disabled]:opacity-64 has-[input:disabled,textarea:disabled,input:focus-visible,textarea:focus-visible,input[aria-invalid],textarea[aria-invalid]]:shadow-none has-[input:focus-visible,textarea:focus-visible]:ring-[3px] has-[input:focus-visible,textarea:focus-visible]:ring-inset sm:text-sm *:[[data-slot=input-control],[data-slot=textarea-control]]:contents *:[[data-slot=input-control],[data-slot=textarea-control]]:before:hidden border-input bg-background not-dark:bg-clip-padding shadow-xs/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--control-radius)-1px)] not-has-[input:disabled,textarea:disabled]:not-has-[input:focus-visible,textarea:focus-visible]:not-has-[input[aria-invalid],textarea[aria-invalid]]:before:shadow-[0_1px_--theme(--color-black/4%)] dark:bg-input/32 dark:not-has-[input:disabled,textarea:disabled]:not-has-[input:focus-visible,textarea:focus-visible]:not-has-[input[aria-invalid],textarea[aria-invalid]]:before:shadow-[0_-1px_--theme(--color-white/6%)] min-w-0',
  input:'w-full min-w-0 rounded-[inherit] outline-none placeholder:text-placeholder [transition:background-color_5000000s_ease-in-out_0s] h-7.5 px-[calc(--spacing(2.5)-1px)] leading-7.5 sm:h-6.5 sm:leading-6.5 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none [&::-webkit-search-results-button]:appearance-none [&::-webkit-search-results-decoration]:appearance-none',
  textarea:'w-full min-w-0 rounded-[inherit] outline-none placeholder:text-placeholder',
  sm:BTN + 'h-8 gap-1.5 px-[calc(--spacing(2.5)-1px)] sm:h-7 ',
  icon:BTN + 'gap-2 size-8 sm:size-7 ',
  primary:'not-disabled:inset-shadow-[0_1px_--theme(--color-white/16%)] border-primary bg-primary text-primary-foreground shadow-primary/24 shadow-xs [:active,[data-pressed]]:inset-shadow-[0_1px_--theme(--color-black/8%)] [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed]]:bg-primary/90',
  outline:'[--control-icon-color:var(--contrast-muted-foreground)] border-input bg-popover not-dark:bg-clip-padding text-foreground shadow-xs/5 not-disabled:not-active:not-data-pressed:before:shadow-[0_1px_--theme(--color-black/4%)] dark:bg-input/32 dark:not-disabled:before:shadow-[0_-1px_--theme(--color-white/2%)] dark:not-disabled:not-active:not-data-pressed:before:shadow-[0_-1px_--theme(--color-white/6%)] [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed]]:bg-accent/50 dark:[:hover,[data-pressed]]:bg-input/64',
  ghost:'[--control-icon-color:var(--contrast-muted-foreground)] border-transparent text-foreground data-pressed:bg-accent [:hover,[data-pressed]]:bg-accent',
  danger:'[--control-icon-color:currentColor] border-transparent text-muted-foreground data-pressed:bg-accent [:hover,[data-pressed]]:bg-accent [:hover,[data-pressed]]:text-destructive'
};
const ICON = {
  x:'<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  plus:'<path d="M5 12h14"/><path d="M12 5v14"/>',
  search:'<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
  right:'<path d="m9 18 6-6-6-6"/>',
  down:'<path d="m6 9 6 6 6-6"/>',
  trash:'<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  nav:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M13 8H7"/><path d="M17 12H7"/>'
};
function svg(name, cls) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries({width:'24', height:'24', viewBox:'0 0 24 24', fill:'none', stroke:'currentColor',
    'stroke-width':'2', 'stroke-linecap':'round', 'stroke-linejoin':'round', 'aria-hidden':'true'})) n.setAttribute(k, v);
  n.setAttribute('class', 'lucide' + (cls ? ' ' + cls : ''));
  n.innerHTML = ICON[name];
  return n;
}

function modes() {
  const shared = globalThis.__olyPlanUi?.modes;
  return Object.entries(fallbackModes).map(([id, fallback]) =>
    [id, shared?.find(m => m.id === id)?.title || fallback]);
}
async function request(suffix = '', payload) {
  const options = {cache:'no-store', signal:AbortSignal.timeout(8000)};
  if (payload !== undefined) Object.assign(options, {method:'POST',
    headers:{'content-type':'application/json', 'x-oly':'1'}, body:JSON.stringify(payload)});
  let response;
  try { response = await fetch(api + suffix, options); }
  catch { throw Error('Нет связи с менеджером шаблонов. Повторите попытку.'); }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Error(data?.error || 'Ошибка менеджера шаблонов (HTTP ' + response.status + ')');
  if (!data || (payload === undefined && !Array.isArray(data.prompts))) throw Error('Менеджер вернул неожиданный ответ.');
  return data;
}
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function button(text, action, variant = 'outline', iconName, size = 'sm') {
  const b = el('button', C[size] + C[variant]);
  b.type = 'button';
  b.setAttribute('data-slot', 'button');
  if (iconName) b.append(svg(iconName));
  if (text) b.append(document.createTextNode(text));
  if (action) b.onclick = action;
  return b;
}
function note(text, error = false) {
  const n = el('p', error ? 'oly-ps-error' : 'oly-ps-note', text);
  n.setAttribute('role', error ? 'alert' : 'status');
  return n;
}
function section(title, description, actions) {
  const s = el('section', C.section), head = el('div', C.secHead), left = el('div', C.secHeadL);
  const h2 = el('h2', C.h2, title);
  left.append(h2);
  head.append(left);
  if (actions?.length) { const a = el('div', 'oly-ps-tools'); a.append(...actions); head.append(a); }
  s.append(head);
  if (description) s.append(el('p', C.desc, description));
  const group = el('div', C.group);
  group.setAttribute('data-slot', 'settings-group');
  s.append(group);
  return {section:s, group, h2};
}
function settingsRow() {
  const r = el('div', C.row);
  r.setAttribute('data-slot', 'settings-row');
  return r;
}
function control(kind) {
  const wrap = el('div', C.inputGroup + ' oly-ps-field'), slot = el('span');
  wrap.setAttribute('data-slot', 'input-group');
  slot.setAttribute('data-slot', kind === 'textarea' ? 'textarea-control' : 'input-control');
  slot.setAttribute('data-size', 'sm');
  const input = el(kind, kind === 'textarea' ? C.textarea : C.input);
  if (kind === 'input') input.setAttribute('data-slot', 'input');
  slot.append(input);
  wrap.append(slot);
  if (kind === 'select') wrap.append(svg('down', 'oly-ps-chev'));
  return {wrap, input};
}
function excerpt(text) {
  const line = String(text || '').replace(/\{\{cursor\}\}/g, '').split('\n').map(x => x.trim()).find(Boolean) || '';
  return line.length > 160 ? line.slice(0, 159) + '…' : line;
}
function dirty(s) {
  return !!s?.form && Object.entries(s.initial).some(([key, value]) => s.form.elements.namedItem(key).value !== value);
}
function values(s) {
  return Object.fromEntries(Object.keys(s.initial).map(k => [k, s.form.elements.namedItem(k).value]));
}
function permit(s) {
  if (s.busy) return false;
  return !dirty(s) || window.confirm('Выйти без сохранения изменений шаблона?');
}
function crumbs(s, current) {
  const sep = () => { const li = el('li', C.crumbSep, '/'); li.setAttribute('aria-hidden', 'true'); return li; };
  const cur = text => { const li = el('li', C.crumbCur, text); li.setAttribute('aria-current', 'page'); return li; };
  s.crumbs.replaceChildren(el('li', C.crumbLi, 'Настройки'), sep());
  if (!current) { s.crumbs.append(cur('Шаблоны промптов')); return; }
  const back = el('li', C.crumbLi), link = el('button', 'oly-ps-crumb', 'Шаблоны промптов');
  link.type = 'button';
  link.title = 'К списку шаблонов';
  link.onclick = () => cancelEdit(s);
  back.append(link);
  s.crumbs.append(back, sep(), cur(current));
}
// T3 marks the open section with data-active / aria-current; while our page is shown, our item carries them instead.
function markNav(s, on) {
  if (on) {
    const native = s.nav.querySelector('[data-settings-section][data-active="true"]');
    s.nativeActive = native ? {node:native, current:native.getAttribute('aria-current')} : null;
    if (native) { native.setAttribute('data-active', 'false'); native.removeAttribute('aria-current'); }
  } else if (s.nativeActive?.node.isConnected && s.nativeActive.node.getAttribute('data-active') === 'false') {
    s.nativeActive.node.setAttribute('data-active', 'true');
    if (s.nativeActive.current !== null) s.nativeActive.node.setAttribute('aria-current', s.nativeActive.current);
  }
  s.button.setAttribute('data-active', on ? 'true' : 'false');
  if (on) s.button.setAttribute('aria-current', 'page'); else s.button.removeAttribute('aria-current');
}
function close(s, remember = false) {
  if (active !== s) return;
  if (remember && dirty(s)) recovered = {record:s.record, fields:values(s)};
  active = null;
  s.observer.disconnect();
  s.original.removeAttribute('data-oly-prompts-original');
  s.original.inert = s.wasInert;
  if (s.wasHidden === null) s.original.removeAttribute('aria-hidden');
  else s.original.setAttribute('aria-hidden', s.wasHidden);
  s.parent.classList.remove('oly-prompts-active');
  markNav(s, false);
  s.pane.remove();
}
function list(s, focusName) {
  s.form = null;
  crumbs(s, null);
  const labels = Object.fromEntries(modes());
  const create = button('Новый шаблон', () => edit(s, empty), 'outline', 'plus');
  const tools = [create];
  let search = null;
  if (s.items.length > 3) {
    const field = control('input');
    search = field.input;
    search.type = 'search';
    search.placeholder = 'Найти шаблон';
    search.setAttribute('aria-label', 'Поиск шаблонов');
    search.value = s.query;
    field.wrap.classList.add('oly-ps-search');
    field.wrap.prepend(svg('search', 'oly-ps-lead'));
    tools.unshift(field.wrap);
  } else s.query = '';
  const view = section('Ваши шаблоны',
    'Наберите «!» в сообщении и выберите шаблон: его текст вставится в поле ввода, а режим ответа переключится, если он задан.', tools);
  if (s.items.length) view.h2.append(el('span', 'oly-ps-count', String(s.items.length)));
  s.content.replaceChildren(view.section);
  if (s.skipped.length) s.content.append(note('Не удалось прочитать файлы: ' + s.skipped.join(', ')));
  function filter() {
    if (search) s.query = search.value;
    const q = s.query.toLocaleLowerCase('ru').trim();
    const matches = s.items.filter(p => ['!' + p.name, p.title, p.description, p.body, labels[p.mode] || '']
      .some(value => String(value || '').toLocaleLowerCase('ru').includes(q)));
    view.group.replaceChildren();
    for (const p of matches) {
      const row = settingsRow(), grid = el('div', C.rowGrid), text = el('div', C.rowText), head = el('div', C.rowTitle);
      row.classList.add('oly-ps-item');
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('data-oly-ps-name', p.name);
      row.setAttribute('aria-label', 'Изменить шаблон !' + p.name + (p.title ? ' — ' + p.title : ''));
      row.onclick = () => edit(s, p);
      row.onkeydown = e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); edit(s, p); return; }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        const next = e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
        if (next?.classList.contains('oly-ps-item')) { e.preventDefault(); next.focus(); }
      };
      head.append(el('h3', C.h3, p.title || '!' + p.name), el('code', 'oly-ps-cmd', '!' + p.name));
      text.append(head);
      const hint = p.description || excerpt(p.body);
      if (hint) text.append(el('p', C.rowP, hint));
      const side = el('div', C.rowCtl);
      if (p.mode) side.append(el('span', 'oly-ps-mode', labels[p.mode] || p.mode));
      side.append(svg('right', 'oly-ps-go'));
      grid.append(text, side);
      row.append(grid);
      view.group.append(row);
      if (p.name === focusName) row.focus();
    }
    if (!matches.length) {
      const row = settingsRow();
      row.append(note(s.items.length ? 'По этому запросу ничего не найдено.' : 'Шаблонов пока нет. Создайте первый — например, для ревью кода или отчёта.'));
      view.group.append(row);
    }
  }
  if (search) search.oninput = filter;
  filter();
  if (focusName === null) create.focus();
  if (focusName && !view.group.contains(document.activeElement)) (search || create).focus();
}
async function load(s, focusName) {
  s.form = null;
  crumbs(s, null);
  s.content.replaceChildren(note('Загрузка шаблонов…'));
  try {
    const data = await request();
    if (active !== s) return;
    s.items = data.prompts;
    s.skipped = data.skipped || [];
    if (recovered) {
      const draft = recovered;
      recovered = null;
      edit(s, draft.record, draft.fields);
      s.form.prepend(note('Восстановлены несохранённые изменения.'));
    } else list(s, focusName);
  } catch (e) {
    if (active === s) s.content.replaceChildren(note(e.message, true), button('Повторить', () => load(s, focusName)));
  }
}
function edit(s, record, draft) {
  const form = el('form', 'oly-ps-form'), fields = el('fieldset', 'oly-ps-fs');
  const existing = record.revision !== null;
  s.form = form;
  s.record = record;
  s.initial = {};
  form.noValidate = true;
  crumbs(s, existing ? '!' + record.name : 'Новый шаблон');
  const view = section(existing ? 'Шаблон !' + record.name : 'Новый шаблон', null, null);
  function field(key, labelText, hint, kind, wide) {
    const row = settingsRow(), text = el('div', C.rowText), head = el('div', C.rowTitle);
    const {wrap, input} = control(kind);
    const label = el('label', C.h3, labelText);
    input.name = key;
    input.id = 'oly-ps-' + key;
    label.htmlFor = input.id;
    head.append(label);
    text.append(head);
    if (hint) {
      const p = el('p', C.rowP, hint);
      p.id = 'oly-ps-hint-' + key;
      input.setAttribute('aria-describedby', p.id);
      text.append(p);
    }
    if (kind === 'select') for (const [id, title] of [['', 'Не менять'], ...modes()]) input.add(new Option(title, id));
    input.value = record[key];
    s.initial[key] = input.value;
    if (draft) input.value = draft[key];
    if (wide) { row.classList.add('oly-ps-wide'); row.append(text, wrap); }
    else { const grid = el('div', C.rowGrid), side = el('div', C.rowCtl); side.append(wrap); grid.append(text, side); row.append(grid); }
    view.group.append(row);
    return {input, wrap};
  }
  const name = field('name', 'Команда', existing ? 'Набирается в сообщении после «!». После создания не меняется.'
    : 'Что набирать в сообщении после «!», например «ревью».', 'input');
  name.input.readOnly = existing;
  name.input.spellcheck = false;
  name.input.autocomplete = 'off';
  name.wrap.prepend(el('span', 'oly-ps-prefix', '!'));
  const title = field('title', 'Заголовок', 'Название шаблона в меню «!».', 'input');
  field('description', 'Описание', 'Подсказка под названием в меню. Необязательно.', 'input');
  field('mode', 'Режим ответа', 'Режим чата, который включится при вставке шаблона.', 'select');
  const body = field('body', 'Текст шаблона', '{{cursor}} указывает место курсора после вставки.', 'textarea', true);
  body.input.rows = 10;
  const error = note('', true), actions = el('div', 'oly-ps-actions');
  const save = button('Сохранить', null, 'primary');
  save.type = 'submit';
  save.title = 'Сохранить (Ctrl+S)';
  const trash = existing ? button('В корзину', () => commit(true), 'danger', 'trash') : null;
  if (trash) { trash.classList.add('oly-ps-trash'); actions.append(trash); }
  actions.append(button('Отмена', () => cancelEdit(s), 'outline'), save);
  fields.append(view.section, error, actions);
  form.append(fields);
  form.onsubmit = e => { e.preventDefault(); commit(false); };
  s.content.replaceChildren(form);
  (existing ? title.input : name.input).focus();

  async function commit(deleting) {
    if (s.busy || active !== s || form !== s.form) return;
    if (deleting && !window.confirm('Переместить шаблон !' + record.name + ' в корзину?')) return;
    const input = deleting ? {name:record.name} : values(s);
    input.revision = record.revision;
    fields.disabled = s.busy = true;
    form.setAttribute('aria-busy', 'true');
    error.textContent = '';
    try {
      await request(deleting ? '/delete' : '', input);
    } catch (e) {
      if (active === s) {
        error.textContent = e.message;
        fields.disabled = false;
        form.removeAttribute('aria-busy');
        (deleting ? trash : save).focus();
      }
      return;
    } finally { s.busy = false; }
    if (active !== s) return;
    if (!deleting) s.query = '';
    await load(s, deleting ? null : input.name);
  }
}
function cancelEdit(s) {
  if (permit(s)) load(s, s.record.revision === null ? null : s.record.name);
}
function open(b) {
  if (active) { active.pane.focus(); return; }
  const nav = b.closest(navSelector);
  globalThis.__olyMcpManager?.close();
  globalThis.__olyIntegrations?.close();
  const original = nav.nextElementSibling;
  if (!original) return;
  const parent = nav.parentElement, modal = nav.closest('[data-app-modal]');
  const pane = el('section', 'flex min-h-0 min-w-0 flex-1 flex-col oly-ps-pane'), head = el('header', C.header);
  const crumbNav = el('nav', C.crumbNav), crumbList = el('ol', C.crumbOl), right = el('div', C.headRight);
  const body = el('div', C.bodyWrap), scroll = el('div', C.scroll), content = el('div', C.inner);
  pane.setAttribute('aria-label', 'Шаблоны промптов');
  pane.tabIndex = -1;
  crumbNav.setAttribute('aria-label', 'Навигация по настройкам');
  crumbNav.append(crumbList);
  const exit = button('', () => {
    if (!permit(s)) return;
    const native = original.querySelector('header button:is([aria-label="Закрыть"],[aria-label="Закрыть настройки"],[aria-label="Close settings"],[aria-label="Close"])');
    close(s);
    if (native) native.click(); else b.focus();
  }, 'ghost', 'x', 'icon');
  exit.setAttribute('aria-label', 'Закрыть');
  exit.title = 'Закрыть настройки';
  right.append(exit);
  head.append(crumbNav, right);
  scroll.append(content);
  body.append(scroll);
  pane.append(head, body);
  const s = {parent, original, modal, nav, pane, content, crumbs:crumbList, button:b, wasInert:original.inert,
    wasHidden:original.getAttribute('aria-hidden'), href:location.href, query:'', busy:false, items:[], skipped:[],
    observer:new MutationObserver(() => { if (!pane.isConnected || nav.nextElementSibling !== original) close(s, true); })};
  active = s;
  original.setAttribute('data-oly-prompts-original', '');
  original.inert = true;
  original.setAttribute('aria-hidden', 'true');
  parent.classList.add('oly-prompts-active');
  parent.append(pane);
  markNav(s, true);
  // Observe only the ancestor chain to catch removal of the modal without watching chat mutations.
  for (let n = parent; n; n = n.parentElement) s.observer.observe(n, {childList:true});
  pane.focus();
  load(s);
}
// Our nav item is a shallow copy of a native one (same classes and data-* hooks), so it looks and highlights the same.
function navItem(nav) {
  const proto = nav.querySelector('[data-settings-section]');
  const protoItem = proto?.closest('li');
  const wrap = protoItem ? protoItem.cloneNode(false) : el('li');
  const b = proto ? proto.cloneNode(false) : el('button');
  for (const name of ['id', 'aria-current', 'data-settings-section', 'aria-label', 'title']) b.removeAttribute(name);
  wrap.removeAttribute('id');
  wrap.setAttribute('data-oly-prompts-nav', '');
  b.type = 'button';
  b.setAttribute('data-active', 'false');
  b.setAttribute('data-oly-ps-nav-button', '');
  b.onclick = () => open(b);
  const label = el('span', proto?.querySelector('span')?.getAttribute('class') || 'truncate', 'Шаблоны промптов');
  b.append(svg('nav', 'lucide-message-square-text'), label);
  wrap.append(b);
  return wrap;
}
function mount() {
  const nav = document.querySelector(navSelector);
  if (!nav) return;
  const anchor = nav.querySelector('[data-oly-mcp-nav]') || nav.querySelector('[data-settings-section="/settings/providers"]')?.closest('li');
  if (!anchor) return;
  let wrap = nav.querySelector('[data-oly-prompts-nav]');
  if (wrap && !wrap.querySelector('[data-oly-ps-nav-button]')) { wrap.remove(); wrap = null; }
  if (!wrap) wrap = navItem(nav);
  if (anchor.nextElementSibling !== wrap) anchor.after(wrap);
  if (active?.nav === nav && !active.button.isConnected) {
    active.button = wrap.querySelector('button');
    markNav(active, true);
  }
}
function stop(e) { e.preventDefault(); e.stopImmediatePropagation(); }
let backdropDown = false;
addEventListener('pointerdown', e => { backdropDown = !!active?.modal && e.target === active.modal.parentElement; }, true);
addEventListener('click', e => {
  const s = active;
  if (!s || !(e.target instanceof Element) || s.pane.contains(e.target) || s.button.contains(e.target)) return;
  const leave = (s.nav.contains(e.target) && e.target.closest('button,a,[role=option]') &&
    !e.target.closest('[aria-label="Поиск в настройках"],[aria-label="Очистить поиск по настройкам"]')) ||
    (backdropDown && e.target === s.modal?.parentElement);
  if (!leave) return;
  if (permit(s)) close(s); else stop(e);
}, true);
addEventListener('keydown', e => {
  const s = active;
  if (!s?.form || e.isComposing) return;
  if (e.key === 'Escape') { stop(e); cancelEdit(s); }
  else if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyS' || e.key.toLowerCase() === 's')) {
    stop(e);
    if (!s.busy) s.form.requestSubmit();
  }
}, true);
addEventListener('beforeunload', e => {
  if (dirty(active) || active?.busy) { e.preventDefault(); e.returnValue = ''; }
});
window.navigation?.addEventListener('navigate', e => {
  const s = active;
  if (!s || e.destination.url === s.href || !e.cancelable || !e.destination.sameDocument) return;
  if (!permit(s)) e.preventDefault();
  else close(s);
});
function route() {
  if (active && active.href !== location.href) close(active, true);
  mount();
}
function start() {
  const core = globalThis.__olyCore;
  if (core?.onUiMount) core.onUiMount(nodes => {
    if (nodes.some(n => n.matches(navSelector) || n.closest(navSelector) || n.querySelector(navSelector))) mount();
  });
  else {
    let pending = false;
    new MutationObserver(() => {
      if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; route(); }); }
    }).observe(document.body, {childList:true, subtree:true});
  }
  if (core?.onRoute) core.onRoute(route);
  else { addEventListener('hashchange', route); addEventListener('popstate', route); }
  mount();
}
const style = el('style');
style.id = 'oly-prompts-settings-style';
style.textContent = `
.oly-prompts-active>[data-oly-prompts-original]{display:none!important}
[data-oly-prompts-nav]{list-style:none}
.oly-ps-pane{outline:none}
.oly-ps-tools{display:flex;flex:none;flex-wrap:wrap;align-items:center;gap:8px;max-width:100%}
.oly-ps-count{font-family:inherit;font-size:12px;font-weight:400;color:var(--muted-foreground);font-variant-numeric:tabular-nums}
.oly-ps-item{cursor:pointer;outline:none;transition:background-color .12s}
.oly-ps-item:hover{background:color-mix(in srgb,var(--accent) 55%,transparent)}
.oly-ps-item:focus-visible{box-shadow:inset 0 0 0 2px var(--ring)}
.oly-ps-cmd{flex:none;padding:0 5px;border-radius:var(--control-radius,4px);font:500 11.5px/18px ui-monospace,"Cascadia Mono",Consolas,monospace;color:var(--primary);background:color-mix(in srgb,var(--primary) 9%,transparent);white-space:nowrap}
.oly-ps-mode{font-size:12px;color:var(--muted-foreground);white-space:nowrap}
.oly-ps-go{flex:none;width:16px;height:16px;color:var(--muted-foreground)}
.oly-ps-item:hover .oly-ps-go{color:var(--foreground)}
.oly-ps-pane .oly-ps-field.oly-ps-search{width:220px;max-width:100%}
.oly-ps-lead{flex:none;width:14px;height:14px;margin-inline-start:9px;margin-inline-end:-3px;color:var(--muted-foreground)}
.oly-ps-pane .oly-ps-field{width:100%}
@container settings-row (min-width:32rem){.oly-ps-pane .oly-ps-field{width:300px}}
.oly-ps-pane .oly-ps-wide .oly-ps-field{width:100%;margin-top:10px}
.oly-ps-pane .oly-ps-field select{appearance:none;-webkit-appearance:none;cursor:pointer;color:inherit;background:transparent;font:inherit;padding-inline-end:28px}
.oly-ps-pane .oly-ps-field select option{color:var(--popover-foreground,var(--foreground));background:var(--popover,var(--background))}
.oly-ps-chev{position:absolute;inset-inline-end:8px;top:50%;width:14px;height:14px;transform:translateY(-50%);pointer-events:none;color:var(--muted-foreground)}
.oly-ps-prefix{flex:none;padding-inline-start:9px;margin-inline-end:-8px;font:500 13px ui-monospace,"Cascadia Mono",Consolas,monospace;color:var(--muted-foreground)}
.oly-ps-pane .oly-ps-field textarea{min-height:200px;padding:8px 9px;resize:vertical;font:inherit;line-height:1.55;background:transparent}
.oly-ps-pane .oly-ps-field input[readonly]{color:var(--muted-foreground)}
.oly-ps-fs{display:flex;flex-direction:column;gap:12px;min-width:0;margin:0;padding:0;border:0}
.oly-ps-fs:disabled{opacity:.7}
.oly-ps-actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px;padding-inline:12px}
.oly-ps-actions .oly-ps-trash{margin-inline-end:auto}
.oly-ps-note{margin:0;font-size:12px;line-height:1.5;color:var(--muted-foreground)}
.oly-ps-form>.oly-ps-note{padding-inline:12px}
.oly-ps-error{margin:0 12px;font-size:12px;color:var(--destructive-foreground,var(--destructive))}
.oly-ps-error:empty{display:none}
.oly-ps-crumb{all:unset;cursor:pointer;border-radius:3px}
.oly-ps-crumb:hover{color:var(--foreground);text-decoration:underline;text-underline-offset:3px}
.oly-ps-crumb:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
`;
(document.head || document.documentElement).append(style);
globalThis.__olyPromptsSettings = {mount, open:() => { const b = document.querySelector('[data-oly-ps-nav-button]'); if (b) open(b); }};
if (document.body) start(); else addEventListener('DOMContentLoaded', start, {once:true});
}catch(e){console.warn('oly prompts-settings',e)}})();
