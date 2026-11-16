;(()=>{try{
// «API-ключи» in T3 Settings: a nav item after «Провайдеры»; when selected, our panel replaces the settings content
// (T3's content is only hidden via CSS and comes back when any other section is clicked). Keys are managed by the local
// integrations service (http://127.0.0.1:4522) which stores them in Windows user environment variables; values never
// reach this page — only "set / ••••last4 / last test".
if (globalThis.__olyIntegrations) return;
const API = 'http://127.0.0.1:4522';
const REGION = '[data-workspace-area="settings"]';
const PROVIDERS_BTN = '[data-slot="sidebar-menu-button"][data-settings-section="/settings/providers"]';
const SECTION_BTN = '[data-slot="sidebar-menu-button"][data-settings-section]';

// Native T3 class strings (copied from the settings screens so the panel looks and themes exactly like them).
const C = {
  page: 'mx-auto flex w-full flex-col px-5 pt-6 pb-12 sm:px-6 max-w-4xl gap-8',
  section: 'space-y-2.5',
  head: 'flex min-h-7 flex-wrap items-start justify-between gap-x-4 gap-y-1 px-3 sm:px-4',
  h2: 'flex min-h-7 items-center gap-2 text-base font-semibold text-foreground',
  group: 'relative overflow-visible text-foreground rounded-xl border border-border/60 bg-card/40 shadow-xs/5 *:not-first:border-t *:not-first:border-border/50 [&>[data-slot=settings-row]]:rounded-none',
  row: 'group/settings-row @container/settings-row rounded-xl px-3 sm:px-4 aria-disabled:opacity-64 aria-disabled:[&_*]:text-muted-foreground py-3',
  grid: 'flex flex-col gap-3 @min-[32rem]/settings-row:grid @min-[32rem]/settings-row:grid-cols-[minmax(0,1fr)_auto] @min-[32rem]/settings-row:items-center @min-[32rem]/settings-row:gap-8',
  left: 'min-w-0 flex-1 space-y-1',
  titleLine: 'flex min-h-5 items-center gap-1.5',
  h3: 'text-sm font-medium text-foreground',
  desc: 'max-w-2xl text-pretty text-xs leading-normal text-muted-foreground',
  right: 'flex w-full min-w-0 shrink-0 flex-col items-stretch gap-2 @min-[32rem]/settings-row:w-auto @min-[32rem]/settings-row:items-end',
  inputCtl: "relative inline-flex w-full rounded-lg border border-input bg-background not-dark:bg-clip-padding text-base text-foreground shadow-xs/5 ring-ring/24 transition-shadow before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] not-has-disabled:not-has-focus-visible:not-has-aria-invalid:before:shadow-[0_1px_--theme(--color-black/4%)] has-focus-visible:has-aria-invalid:border-destructive/64 has-focus-visible:has-aria-invalid:ring-destructive/16 has-aria-invalid:border-destructive/36 has-focus-visible:border-ring has-autofill:bg-foreground/4 has-disabled:opacity-64 has-[:disabled,:focus-visible,[aria-invalid]]:shadow-none has-focus-visible:ring-[3px] has-focus-visible:ring-inset sm:text-sm dark:bg-input/32 dark:has-autofill:bg-foreground/8 dark:has-aria-invalid:ring-destructive/24 dark:not-has-disabled:not-has-focus-visible:not-has-aria-invalid:before:shadow-[0_-1px_--theme(--color-white/6%)] min-w-0 flex-1 @min-[32rem]/settings-row:w-56",
  input: 'w-full min-w-0 rounded-[inherit] outline-none placeholder:text-placeholder [transition:background-color_5000000s_ease-in-out_0s] h-7.5 px-[calc(--spacing(2.5)-1px)] leading-7.5 sm:h-6.5 sm:leading-6.5',
  btnOutline: "[&_svg]:-mx-0.5 relative inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-[var(--control-radius)] border font-medium outline-none transition-[box-shadow,scale] [&:not([aria-haspopup]):not(:disabled):not([aria-disabled=true])]:will-change-[scale] [&:active:not([aria-haspopup])]:scale-[0.97] before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--control-radius)-1px)] pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 aria-disabled:cursor-not-allowed aria-disabled:opacity-64 [&_svg:not([class*='text-'])]:text-[var(--control-icon-color)] [&_svg]:pointer-events-none [&_svg]:shrink-0 h-7 gap-1 px-[calc(--spacing(2)-1px)] text-sm sm:h-6 sm:text-xs [&_svg:not([class*='size-'])]:size-4 sm:[&_svg:not([class*='size-'])]:size-3.5 [--control-icon-color:var(--contrast-muted-foreground)] border-input bg-popover not-dark:bg-clip-padding text-foreground shadow-xs/5 not-disabled:not-active:not-data-pressed:before:shadow-[0_1px_--theme(--color-black/4%)] dark:bg-input/32 dark:not-disabled:before:shadow-[0_-1px_--theme(--color-white/2%)] dark:not-disabled:not-active:not-data-pressed:before:shadow-[0_-1px_--theme(--color-white/6%)] [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed]]:bg-accent/50 dark:[:hover,[data-pressed]]:bg-input/64",
  btnGhost: "[&_svg]:-mx-0.5 relative inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-[var(--control-radius)] border font-medium outline-none transition-[box-shadow,scale] [&:not([aria-haspopup]):not(:disabled):not([aria-disabled=true])]:will-change-[scale] [&:active:not([aria-haspopup])]:scale-[0.97] before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--control-radius)-1px)] pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 aria-disabled:cursor-not-allowed aria-disabled:opacity-64 [&_svg:not([class*='text-'])]:text-[var(--control-icon-color)] [&_svg]:pointer-events-none [&_svg]:shrink-0 h-7 gap-1 px-[calc(--spacing(2)-1px)] text-sm sm:h-6 sm:text-xs [&_svg:not([class*='size-'])]:size-4 sm:[&_svg:not([class*='size-'])]:size-3.5 [--control-icon-color:currentColor] border-transparent text-muted-foreground data-pressed:bg-accent [:hover,[data-pressed]]:bg-accent [:hover,[data-pressed]]:text-foreground",
  crumb: 'flex min-w-0 items-center font-medium text-foreground truncate',
};
const ICON = {
  key: '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  ext: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
};
const svg = (d, cls = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${cls}" aria-hidden="true">${d}</svg>`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- base styles (Olympus overrides: olympus-v2/feature-css/integrations.*.css) ----------
const css = `
[data-oly-ik-open]>:not(header):not(.oly-ik-panel){display:none!important}
[data-oly-ik-open]>header nav ol>li[aria-current]:not([data-oly-ik-crumb]){display:none!important}
[data-oly-ik-open]>header>div:last-child>button:not(:last-child){display:none!important}
.oly-ik-panel{flex:1 1 auto;min-height:0;overflow-y:auto;scrollbar-gutter:stable both-edges}
.oly-ik-intro{padding:0 12px;margin:-2px 0 2px;font-size:12px;line-height:1.5;color:var(--muted-foreground);max-width:46rem}
@media (min-width:640px){.oly-ik-intro{padding:0 16px}}
.oly-ik-badge{display:inline-flex;align-items:center;gap:4px;height:18px;padding:0 6px;border-radius:999px;border:1px solid var(--border);font-size:10.5px;font-weight:500;line-height:1;color:var(--muted-foreground);white-space:nowrap}
.oly-ik-badge::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.75}
.oly-ik-badge[data-state=ok]{color:var(--success,#15803d);border-color:color-mix(in srgb,var(--success,#15803d) 35%,transparent)}
.oly-ik-badge[data-state=err]{color:var(--destructive,#dc2626);border-color:color-mix(in srgb,var(--destructive,#dc2626) 35%,transparent)}
.oly-ik-badge[data-state=set]{color:var(--foreground)}
.oly-ik-badge[data-state=none]::before{background:transparent;border:1px solid currentColor;box-sizing:border-box}
.oly-ik-link{display:inline-flex;align-items:center;gap:3px;color:var(--foreground);text-decoration:underline;text-decoration-color:color-mix(in srgb,currentColor 30%,transparent);text-underline-offset:2px;white-space:nowrap}
.oly-ik-link:hover{text-decoration-color:currentColor}
.oly-ik-link svg{width:11px;height:11px}
.oly-ik-meta{font-size:11.5px;line-height:1.45;color:var(--muted-foreground)}
.oly-ik-meta code{font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:0 4px;border-radius:4px;background:color-mix(in srgb,var(--foreground) 6%,transparent)}
.oly-ik-result{font-size:11.5px;line-height:1.45;color:var(--muted-foreground)}
.oly-ik-result[data-ok=true]{color:var(--success,#15803d)}
.oly-ik-result[data-ok=false]{color:var(--destructive,#dc2626)}
.oly-ik-field{display:flex;align-items:center;gap:6px;width:100%}
@container settings-row (min-width:32rem){.oly-ik-field{width:18rem}}
.oly-ik-field [data-slot=input-control]{flex:1 1 auto}
.oly-ik-field input{padding-right:30px!important;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.oly-ik-field input::placeholder{font-family:Inter,system-ui,sans-serif}
.oly-ik-eye{position:absolute;right:3px;top:50%;transform:translateY(-50%);width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border:0;background:transparent;border-radius:calc(var(--control-radius,6px) - 2px);color:var(--muted-foreground);cursor:pointer;z-index:1}
.oly-ik-eye:hover{color:var(--foreground);background:var(--accent)}
.oly-ik-eye svg{width:14px;height:14px}
.oly-ik-btns{display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-end}
.oly-ik-btns svg{width:14px;height:14px}
.oly-ik-btns [data-danger]{color:var(--destructive,#dc2626)}
.oly-ik-btns [data-confirm]{color:var(--destructive-foreground,#fff);background:var(--destructive,#dc2626)!important;border-color:transparent}
.oly-ik-busy{animation:oly-ik-spin 1s linear infinite}
@keyframes oly-ik-spin{to{transform:rotate(360deg)}}
.oly-ik-tools{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.oly-ik-tools code{font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:0 5px;border-radius:4px;border:1px solid var(--border);color:var(--muted-foreground)}
.oly-ik-down{display:flex;align-items:center;justify-content:space-between;gap:12px}
`;
const st = document.createElement('style');
st.id = 'oly-integrations-css';
st.textContent = css;
const addStyle = () => { const h = document.head || document.documentElement; if (h) h.appendChild(st); else setTimeout(addStyle, 10); };
addStyle();

// ---------- service ----------
async function api(path, body) {
  const opt = body ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-oly': '1' }, body: JSON.stringify(body) } : {};
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), body ? 60000 : 8000);
  try {
    const r = await fetch(API + path, { ...opt, signal: ctl.signal, cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
    return j;
  } finally { clearTimeout(t); }
}

// ---------- state ----------
const S = { open: false, path: '', items: null, down: false, busy: {}, msg: {}, demoted: [], loading: false };
const $ = (sel, root = document) => root.querySelector(sel);

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso), now = new Date();
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? 'сегодня в ' + hm : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ' ' + hm;
}
function badge(it) {
  if (!it.set) return '<span class="oly-ik-badge" data-state="none">Не задан</span>';
  const t = it.lastTest;
  if (t && t.ok) return '<span class="oly-ik-badge" data-state="ok">Работает</span>';
  if (t && !t.ok) return '<span class="oly-ik-badge" data-state="err">Ошибка</span>';
  return '<span class="oly-ik-badge" data-state="set">Задан</span>';
}

function rowHtml(it) {
  const busy = S.busy[it.id];
  const m = S.msg[it.id];
  const t = it.lastTest;
  let result = '';
  if (m) result = `<div class="oly-ik-result" data-ok="${m.ok == null ? '' : m.ok}">${esc(m.text)}</div>`;
  else if (t) result = `<div class="oly-ik-result" data-ok="${t.ok}">Проверено ${esc(fmtTime(t.at))}: ${esc(t.message)}${t.spent ? ' · ' + esc(t.spent) : ''}</div>`;
  const src = it.set ? (it.source === 'process' ? ' · задан вне T3 (системная переменная)' : ` · сохранён ${esc(it.masked)}`) : '';
  const ph = it.set ? `Заменить ключ ${it.masked}` : 'Вставьте API-ключ';
  const spin = (k, icon) => (busy === k ? svg(ICON.refresh, 'oly-ik-busy') : svg(icon));
  return `
<div data-slot="settings-row" data-oly-ik-row="${it.id}" class="${C.row}"${busy ? ' aria-busy="true"' : ''}>
 <div class="${C.grid}">
  <div class="${C.left}">
   <div class="${C.titleLine}"><h3 class="${C.h3}">${esc(it.name)}</h3>${badge(it)}</div>
   <p class="${C.desc}">${esc(it.description)} <a class="oly-ik-link" href="${esc(it.url)}" target="_blank" rel="noreferrer noopener">Получить ключ${svg(ICON.ext)}</a></p>
   <div class="oly-ik-meta"><code>${esc(it.env)}</code>${src}${it.pricing ? ' · ' + esc(it.pricing) : ''}</div>
   ${result}
  </div>
  <div class="${C.right}">
   <div class="oly-ik-field">
    <span data-slot="input-control" data-size="sm" class="${C.inputCtl}">
     <input data-slot="input" data-oly-ik-input="${it.id}" type="password" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="${esc(ph)}" aria-label="API-ключ ${esc(it.name)}" class="${C.input}">
     <button type="button" class="oly-ik-eye" data-oly-ik-act="eye" data-id="${it.id}" title="Показать/скрыть введённый ключ" aria-label="Показать введённый ключ">${svg(ICON.eye)}</button>
    </span>
   </div>
   <div class="oly-ik-btns">
    <button type="button" data-slot="button" class="${C.btnOutline}" data-oly-ik-act="save" data-id="${it.id}"${busy ? ' disabled' : ''}>${spin('save', ICON.save)}<span>Сохранить</span></button>
    <button type="button" data-slot="button" class="${C.btnGhost}" data-oly-ik-act="test" data-id="${it.id}"${busy ? ' disabled' : ''} title="Проверить ключ дешёвым запросом (введённый, иначе сохранённый)">${spin('test', ICON.check)}<span>Проверить</span></button>
    ${it.set && it.source === 'user' ? `<button type="button" data-slot="button" class="${C.btnGhost}" data-danger data-oly-ik-act="delete" data-id="${it.id}"${busy ? ' disabled' : ''}>${spin('delete', ICON.trash)}<span>Удалить</span></button>` : ''}
   </div>
  </div>
 </div>
</div>`;
}

function panelHtml() {
  const head = (title, extra = '') => `<div data-settings-scroll-target="true" class="${C.head}"><div class="flex min-w-0 items-center gap-1"><h2 class="${C.h2}">${title}</h2></div>${extra}</div>`;
  const refresh = `<button type="button" data-slot="button" class="${C.btnGhost}" data-oly-ik-act="reload" title="Обновить статусы" aria-label="Обновить статусы">${svg(ICON.refresh, S.loading ? 'oly-ik-busy' : '')}</button>`;
  let body;
  if (S.down) {
    body = `<div data-slot="settings-group" class="${C.group}"><div data-slot="settings-row" class="${C.row}"><div class="oly-ik-down"><div class="${C.left}"><h3 class="${C.h3}">Сервис ключей не запущен</h3><p class="${C.desc}">Не удалось связаться с локальным сервисом <code>127.0.0.1:4522</code> (integrations-service). Он запускается вместе с Windows; запустите <code>start-hidden.vbs</code> из папки сервиса и нажмите «Повторить».</p></div><button type="button" data-slot="button" class="${C.btnOutline}" data-oly-ik-act="reload">${svg(ICON.refresh)}<span>Повторить</span></button></div></div></div>`;
  } else if (!S.items) {
    body = `<div data-slot="settings-group" class="${C.group}"><div data-slot="settings-row" class="${C.row}"><p class="${C.desc}">Загрузка…</p></div></div>`;
  } else {
    const web = S.items.filter((x) => x.tools && x.tools.length), other = S.items.filter((x) => !x.tools || !x.tools.length);
    body = `<div data-slot="settings-group" class="${C.group}">${web.map(rowHtml).join('')}</div>`;
    if (other.length) body += `</section><section class="${C.section}">${head('Модели')}<div data-slot="settings-group" class="${C.group}">${other.map(rowHtml).join('')}</div>`;
  }
  const tools = S.items ? S.items.flatMap((x) => x.tools || []) : [];
  const agents = `<section class="${C.section}">${head('Инструменты агентов')}<div data-slot="settings-group" class="${C.group}"><div data-slot="settings-row" class="${C.row}"><div class="${C.left}"><div class="${C.titleLine}"><h3 class="${C.h3}">MCP-сервер oly-web</h3></div><p class="${C.desc}">Claude Code и Codex получают эти инструменты автоматически. Ключи читаются при каждом вызове — после сохранения перезапуск не нужен. Каждый вызов тратит кредиты сервиса (цены указаны выше).</p>${tools.length ? `<div class="oly-ik-tools">${tools.map((t) => `<code>${esc(t)}</code>`).join('')}</div>` : ''}</div></div></div></section>`;
  return `<div class="${C.page}"><section class="${C.section}">${head('API-ключи', refresh)}<p class="oly-ik-intro">Ключи веб-сервисов для ИИ-агентов: поиск и парсинг страниц, X (Twitter), Reddit, расшифровки YouTube. Хранятся в переменных окружения Windows вашего пользователя и не показываются после сохранения.</p>${body}</section>${agents}</div>`;
}

function render() {
  const p = $('.oly-ik-panel');
  if (!p) return;
  // Keep typed (unsaved) values and focus across re-renders.
  const typed = {}; let focus = null, vis = {};
  p.querySelectorAll('[data-oly-ik-input]').forEach((i) => { typed[i.dataset.olyIkInput] = i.value; vis[i.dataset.olyIkInput] = i.type === 'text'; if (i === document.activeElement) focus = i.dataset.olyIkInput; });
  const top = p.scrollTop;
  p.innerHTML = panelHtml();
  p.scrollTop = top;
  p.querySelectorAll('[data-oly-ik-input]').forEach((i) => {
    const id = i.dataset.olyIkInput;
    if (typed[id]) i.value = typed[id];
    if (vis[id]) setEye(i, true);
    if (focus === id) i.focus();
  });
}
function setEye(input, show) {
  input.type = show ? 'text' : 'password';
  const b = input.parentElement.querySelector('.oly-ik-eye');
  if (b) { b.innerHTML = svg(show ? ICON.eyeOff : ICON.eye); b.setAttribute('aria-label', show ? 'Скрыть введённый ключ' : 'Показать введённый ключ'); }
}

async function load() {
  S.loading = true; render();
  try { const j = await api('/api/keys'); S.items = j.items; S.down = false; }
  catch { S.down = true; }
  S.loading = false; render();
}

async function act(kind, id, btn) {
  const input = $(`[data-oly-ik-input="${id}"]`);
  const value = input ? input.value.trim() : '';
  if (kind === 'eye') { setEye(input, input.type === 'password'); return; }
  if (kind === 'reload') { S.msg = {}; return load(); }
  if (kind === 'delete' && !btn.hasAttribute('data-confirm')) {
    btn.setAttribute('data-confirm', ''); btn.querySelector('span').textContent = 'Точно удалить?';
    setTimeout(() => { if (btn.isConnected) { btn.removeAttribute('data-confirm'); btn.querySelector('span').textContent = 'Удалить'; } }, 3500);
    return;
  }
  if (kind === 'save' && !value) { S.msg[id] = { ok: false, text: 'Вставьте ключ в поле, затем нажмите «Сохранить».' }; render(); input && input.focus(); return; }
  S.busy[id] = kind; delete S.msg[id]; render();
  try {
    if (kind === 'save') {
      const j = await api('/api/keys', { id, value });
      S.items = j.items;
      const inp = $(`[data-oly-ik-input="${id}"]`); if (inp) inp.value = '';
      S.busy[id] = 'test'; S.msg[id] = { ok: null, text: 'Сохранено. Проверяю ключ…' }; render();
      const t = await api('/api/test', { id });
      S.items = t.items; delete S.msg[id];
    } else if (kind === 'test') {
      const t = await api('/api/test', value ? { id, value } : { id });
      if (t.items) S.items = t.items;
      if (value) S.msg[id] = { ok: t.ok, text: `Введённый ключ (не сохранён): ${t.message}${t.spent ? ' · ' + t.spent : ''}` };
    } else if (kind === 'delete') {
      const j = await api('/api/keys/delete', { id });
      S.items = j.items; S.msg[id] = { ok: null, text: 'Ключ удалён.' };
    }
  } catch (e) {
    S.msg[id] = { ok: false, text: /Failed to fetch|abort/i.test(String(e && e.message)) ? 'Сервис ключей недоступен (127.0.0.1:4522).' : String((e && e.message) || e) };
  }
  delete S.busy[id]; render();
}

// ---------- open / close ----------
function region() { return $(REGION); }
function navBtn() { return $('[data-oly-ik-nav] [data-slot="sidebar-menu-button"]'); }

function open() {
  const r = region();
  if (!r) return;
  if (!S.open) {
    S.open = true; S.path = location.pathname;
    r.setAttribute('data-oly-ik-open', '');
    // Selected state: dim T3's active item, highlight ours (restored on close).
    S.demoted = [];
    document.querySelectorAll(SECTION_BTN + '[data-active="true"]').forEach((b) => { b.setAttribute('data-active', 'false'); S.demoted.push(b); });
    const nb = navBtn(); if (nb) nb.setAttribute('data-active', 'true');
  }
  if (!$('.oly-ik-panel', r)) {
    const p = document.createElement('div');
    p.className = 'oly-ik-panel';
    p.setAttribute('data-oly-ik', '');
    r.appendChild(p);
    p.addEventListener('click', (e) => { const b = e.target.closest('[data-oly-ik-act]'); if (b) { e.preventDefault(); act(b.dataset.olyIkAct, b.dataset.id, b); } });
    p.addEventListener('keydown', (e) => { const i = e.target.closest('[data-oly-ik-input]'); if (i && e.key === 'Enter') { e.preventDefault(); act('save', i.dataset.olyIkInput); } });
  }
  const ol = $('header nav ol', r);
  if (ol && !$('[data-oly-ik-crumb]', ol)) {
    const li = document.createElement('li');
    li.setAttribute('data-oly-ik-crumb', ''); li.setAttribute('aria-current', 'page'); li.className = C.crumb; li.textContent = 'API-ключи';
    ol.appendChild(li);
  }
  render(); load();
}
function close() {
  if (!S.open) return;
  S.open = false;
  const r = region();
  if (r) { r.removeAttribute('data-oly-ik-open'); r.querySelectorAll('.oly-ik-panel,[data-oly-ik-crumb]').forEach((n) => n.remove()); }
  const nb = navBtn(); if (nb) nb.setAttribute('data-active', 'false');
  const dem = S.demoted; S.demoted = [];
  // T3 re-marks the newly selected section itself; restore ours only if the route did not change.
  const fix = () => dem.forEach((b) => { if (b.isConnected && b.getAttribute('data-active') === 'false' && b.dataset.settingsSection === location.pathname) b.setAttribute('data-active', 'true'); });
  setTimeout(fix, 60); setTimeout(fix, 400);
}

function ensureNav() {
  const prov = $(PROVIDERS_BTN);
  if (!prov) return;
  const li = prov.closest('li');
  if (!li) return;
  const existing = $('[data-oly-ik-nav]');
  if (existing && existing.previousElementSibling === li) return;
  if (existing) existing.remove();
  const mine = li.cloneNode(true);
  mine.setAttribute('data-oly-ik-nav', '');
  mine.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
  const b = mine.querySelector('[data-slot="sidebar-menu-button"]');
  b.removeAttribute('data-settings-section');
  b.setAttribute('data-active', S.open ? 'true' : 'false');
  b.removeAttribute('aria-current');
  const icon = b.querySelector('svg');
  if (icon) { icon.innerHTML = ICON.key; icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('class', (icon.getAttribute('class') || '').replace(/lucide-[\w-]+/g, '') + ' lucide-key-round'); }
  const label = [...b.querySelectorAll('span')].pop();
  if (label) label.textContent = 'API-ключи';
  b.setAttribute('title', 'API-ключи');
  b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); open(); });
  li.after(mine);
}

// Any T3 section click closes our panel (T3 then shows its own content).
document.addEventListener('click', (e) => {
  if (!S.open) return;
  const b = e.target.closest && e.target.closest(SECTION_BTN);
  if (b) close();
}, true);

let queued = false;
function tick() {
  queued = false;
  ensureNav();
  if (S.open) {
    const r = region();
    if (!r || !r.hasAttribute('data-oly-ik-open') || location.pathname !== S.path) { S.open = false; if (r) { r.removeAttribute('data-oly-ik-open'); r.querySelectorAll('.oly-ik-panel,[data-oly-ik-crumb]').forEach((n) => n.remove()); } const nb = navBtn(); if (nb) nb.setAttribute('data-active', 'false'); S.demoted = []; }
    else if (!$('.oly-ik-panel', r) || !$('[data-oly-ik-crumb]', r)) open();
  }
}
const mo = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(tick); } });
const start = () => { mo.observe(document.body, { childList: true, subtree: true }); tick(); };
if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);

globalThis.__olyIntegrations = { open, close, reload: load, state: S };
}catch(e){console.warn('oly integrations',e)}})();
