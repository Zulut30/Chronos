;(()=>{try{
// OpenRouter in T3: (1) OpenRouter logo for the provider instance marked with accent color #6467F2,
// (2) an "OpenRouter" section in the composer's @ menu that inserts "@openrouter:<model>" references
// understood by the openrouter MCP server (generate_image / generate_video / decide / chat_once).
if (globalThis.__olyOpenRouter) return;
const ACCENT = '#6467F2';
const CATALOG_URL = 'https://openrouter.ai/api/v1/models?output_modalities=all';
const LS_CAT = 'oly-openrouter-catalog-v3', LS_RECENT = 'oly-openrouter-recent', LS_FILTER = 'oly-openrouter-filter';
const TTL = 6 * 3600e3, MAX_ITEMS = 24;
const NS = 'http://www.w3.org/2000/svg';
const LOGO_D = 'M16.778 1.844v1.919q-.569-.026-1.138-.032-.708-.008-1.415.037c-1.93.126-4.023.728-6.149 2.237-2.911 2.066-2.731 1.95-4.14 2.75-.396.223-1.342.574-2.185.798-.841.225-1.753.333-1.751.333v4.229s.768.108 1.61.333c.842.224 1.789.575 2.185.799 1.41.798 1.228.683 4.14 2.75 2.126 1.509 4.22 2.11 6.148 2.236.88.058 1.716.041 2.555.005v1.918l7.222-4.168-7.222-4.17v2.176c-.86.038-1.611.065-2.278.021-1.364-.09-2.417-.357-3.979-1.465-2.244-1.593-2.866-2.027-3.68-2.508.889-.518 1.449-.906 3.822-2.59 1.56-1.109 2.614-1.377 3.978-1.466.667-.044 1.418-.017 2.278.02v2.176L24 6.014Z';
const KIND = {
  text: { label: 'Текст', tool: 'chat_once', word: 'текст',
    icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' },
  image: { label: 'Фото', tool: 'generate_image', word: 'фото',
    icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>' },
  video: { label: 'Видео', tool: 'generate_video', word: 'видео',
    icon: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>' },
  decision: { label: 'Решения', tool: 'decide', word: 'decision',
    icon: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>' },
};
KIND.speech={label:'Озвучка',tool:'generate_speech',word:'speech',icon:KIND.text.icon};
KIND.transcription={label:'Распознавание',tool:'transcribe_audio',word:'transcription',icon:KIND.text.icon};
KIND.audio={label:'Аудио',tool:'generate_audio',word:'audio',icon:KIND.text.icon};
const FILTERS = [['all', 'Все'], ['text', 'Текст'], ['image', 'Фото'], ['video', 'Видео'], ['speech', 'Озвучка'], ['transcription', 'Речь в текст'], ['audio', 'Аудио'], ['decision', 'Решения']];
const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

// ---------- styles (base; Olympus overrides live in feature-css/openrouter.*.css) ----------
const css = `
[data-oly-or-orig]{display:none!important}
[data-oly-or-logo]{display:block;fill:currentColor;color:var(--foreground)}
.oly-or{display:flex;flex-direction:column;min-height:0;max-height:min(260px,48vh);margin:0 0 6px;border:1px solid var(--border);border-radius:calc(var(--radius,10px) + 4px);background:var(--popover,var(--card));color:var(--foreground);box-shadow:0 8px 24px -12px rgb(0 0 0/.25);overflow:hidden;font-size:13px;pointer-events:auto}
.oly-or[hidden]{display:none}
.oly-or-head{display:flex;align-items:center;gap:8px;padding:8px 10px 6px 12px;flex:none}
.oly-or-title{display:flex;align-items:center;gap:6px;font-weight:600;font-size:12px;letter-spacing:.01em}
.oly-or-title svg{width:14px;height:14px;fill:currentColor}
.oly-or-count{color:var(--muted-foreground);font-weight:400}
.oly-or-chips{display:flex;gap:2px;margin-left:auto;flex-wrap:wrap}
.oly-or-chip{height:22px;padding:0 8px;border-radius:var(--control-radius,6px);border:1px solid transparent;background:transparent;color:var(--muted-foreground);font:inherit;font-size:11.5px;cursor:pointer}
.oly-or-chip:hover{background:var(--accent);color:var(--foreground)}
.oly-or-chip[aria-pressed="true"]{border-color:var(--border);color:var(--foreground);background:var(--accent)}
.oly-or-list{overflow-y:auto;min-height:0;padding:0 6px 6px}
.oly-or-item{display:flex;align-items:center;gap:8px;height:30px;padding:0 8px;border-radius:var(--control-radius,6px);cursor:pointer;white-space:nowrap}
.oly-or-item[data-active="true"],.oly-or-item:hover{background:var(--accent)}
.oly-or-item svg.k{width:15px;height:15px;flex:none;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round;color:var(--muted-foreground)}
.oly-or-name{overflow:hidden;text-overflow:ellipsis;flex:0 1 auto;min-width:0}
.oly-or-id{color:var(--muted-foreground);font-size:11.5px;overflow:hidden;text-overflow:ellipsis;flex:1 1 0;min-width:0}
.oly-or-badge{flex:none;font-size:10.5px;color:var(--muted-foreground);border:1px solid var(--border);border-radius:999px;padding:0 6px;line-height:16px}
.oly-or-empty,.oly-or-hint{padding:4px 12px 8px;color:var(--muted-foreground);font-size:12px}
.oly-or-hint kbd{font:inherit;font-size:11px;border:1px solid var(--border);border-radius:4px;padding:0 4px}
`;
function addStyle() {
  if (document.getElementById('oly-openrouter-style')) return;
  const s = document.createElement('style'); s.id = 'oly-openrouter-style'; s.textContent = css;
  (document.head || document.documentElement).appendChild(s);
}
function svg(inner, attrs) {
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', '0 0 24 24'); el.setAttribute('aria-hidden', 'true');
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  el.innerHTML = inner; return el;
}
const logo = (cls) => svg(`<path d="${LOGO_D}"/>`, cls ? { class: cls } : {});

// ---------- (1) provider logo ----------
function patchLogos() {
  for(const original of document.querySelectorAll('[data-oly-or-orig]'))if(original.parentElement?.getAttribute('data-provider-accent-color')?.toLowerCase()!==ACCENT.toLowerCase())original.removeAttribute('data-oly-or-orig');
  for(const mine of document.querySelectorAll('[data-oly-or-logo]')){
   const host=mine.parentElement;if(host?.getAttribute('data-provider-accent-color')?.toLowerCase()===ACCENT.toLowerCase())continue;
   if(host)for(const ch of host.querySelectorAll(':scope > [data-oly-or-orig]'))ch.removeAttribute('data-oly-or-orig');mine.remove();
  }
  for (const host of document.querySelectorAll(`[data-provider-accent-color="${ACCENT}" i]`)) {
    let mine = host.querySelector(':scope > [data-oly-or-logo]');
    for (const ch of [...host.children]) {
      if (ch === mine || ch.hasAttribute('data-oly-or-orig')) continue;
      ch.setAttribute('data-oly-or-orig', '');
      if (!mine) {
        mine = logo(ch.getAttribute('class') || 'size-5 shrink-0');
        mine.setAttribute('data-oly-or-logo', '');
        host.insertBefore(mine, host.firstChild);
      }
    }
    if (!mine) { mine = logo('size-5 shrink-0'); mine.setAttribute('data-oly-or-logo', ''); host.insertBefore(mine, host.firstChild); }
  }
}

// ---------- catalog ----------
let catalog = ls.get(LS_CAT, null); let loading = null;
function kindsOf(m) {
  const out = m.architecture?.output_modalities || []; const ep = m.endpoints || []; const k = [];
  if (out.includes('text') && (!ep.length || ep.some((e) => e.includes('/chat/')))) k.push('text');
  if (out.includes('image') || ep.some((e) => e.includes('/images'))) k.push('image');
  if (out.includes('video') || ep.some((e) => e.includes('/videos'))) k.push('video');
  if (out.includes('decisions') || ep.some((e) => e.includes('/decisions'))) k.push('decision');
  for(const v of ['speech','transcription','audio'])if(out.includes(v))k.push(v);
  return k;
}
function loadCatalog() {
  if (catalog && Date.now() - catalog.at < TTL) return Promise.resolve(catalog);
  if (loading) return loading;
  loading = fetch(CATALOG_URL).then((r) => r.json()).then((j) => {
    const list = [];
    for (const m of j.data || []) {
      const kinds = kindsOf(m); if (!kinds.length) continue;
      list.push({ id: m.id, name: (m.name || m.id).replace(/^[^:]{1,40}:\s*/, ''), kinds, c: m.created || 0 });
    }
    list.sort((a, b) => b.c - a.c);
    catalog = { at: Date.now(), list }; ls.set(LS_CAT, catalog); loading = null; schedule(true); return catalog;
  }).catch((e) => { loading = null; console.warn('oly openrouter catalog', e); return catalog; });
  return loading;
}

// ---------- (2) @ section ----------
let section = null, items = [], active = 0, lastKey = '', state = null;
const editorEl = () => {
  const a = document.activeElement;
  return (a && a.closest && a.closest('[data-testid="composer-editor"]')) || document.querySelector('[data-testid="composer-editor"]');
};
function trigger(el) {
  const ed = el && el.editor; if (!ed || !ed.state) return null;
  const sel = ed.state.selection; if (!sel.empty) return null;
  const $f = sel.$from; const before = $f.parent.textBetween(0, $f.parentOffset, undefined, '￼');
  const m = /(^|\s)@([^\s@]*)$/.exec(before); if (!m) return null;
  return { ed, from: sel.from - m[2].length - 1, to: sel.from, raw: m[2] };
}
function score(m, toks) {
  const hay = (m.id + ' ' + m.name).toLowerCase();
  for (const t of toks) if (!hay.includes(t)) return -1;
  return toks.length && m.id.toLowerCase().startsWith(toks[0]) ? 2 : 1;
}
function compute(q, filter) {
  const list = catalog?.list || [];
  const pool = filter === 'all' ? list : list.filter((m) => m.kinds.includes(filter));
  const toks = q.toLowerCase().split(/[\s]+/).filter(Boolean);
  if (!toks.length) {
    const rec = ls.get(LS_RECENT, []).map((id) => pool.find((m) => m.id === id)).filter(Boolean);
    const seen = new Set(rec.map((m) => m.id));
    return [...rec, ...pool.filter((m) => !seen.has(m.id))].slice(0, MAX_ITEMS);
  }
  return pool.map((m) => [score(m, toks), m]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]).slice(0, MAX_ITEMS).map(([, m]) => m);
}
function primaryKind(m, filter) { return filter !== 'all' && m.kinds.includes(filter) ? filter : m.kinds.find((k) => k !== 'text') || m.kinds[0]; }
function build() {
  const root = document.createElement('div');
  root.className = 'oly-or'; root.setAttribute('data-oly-openrouter-section', ''); root.setAttribute('translate', 'no');
  root.innerHTML = '<div class="oly-or-head"><div class="oly-or-title"></div><div class="oly-or-chips" role="group" aria-label="Тип моделей"></div></div><div class="oly-or-list" role="listbox" aria-label="Модели OpenRouter"></div><div class="oly-or-hint"></div>';
  const title = root.querySelector('.oly-or-title');
  title.append(logo(), 'OpenRouter'); const cnt = document.createElement('span'); cnt.className = 'oly-or-count'; title.append(cnt);
  const chips = root.querySelector('.oly-or-chips');
  for (const [k, label] of FILTERS) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'oly-or-chip'; b.dataset.filter = k; b.textContent = label;
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => { ls.set(LS_FILTER, k); lastKey = ''; active = 0; schedule(true); });
    chips.append(b);
  }
  root.addEventListener('mousedown', (e) => { if (e.target.closest('.oly-or-item,.oly-or-list')) e.preventDefault(); });
  root.querySelector('.oly-or-list').addEventListener('click', (e) => {
    const it = e.target.closest('.oly-or-item'); if (it) choose(Number(it.dataset.i));
  });
  return root;
}
function render(q, filter, nativeHasItems) {
  const listEl = section.querySelector('.oly-or-list');
  for (const b of section.querySelectorAll('.oly-or-chip')) b.setAttribute('aria-pressed', String(b.dataset.filter === filter));
  section.querySelector('.oly-or-count').textContent = catalog ? '· ' + (filter === 'all' ? catalog.list.length : catalog.list.filter((m) => m.kinds.includes(filter)).length) : '';
  listEl.textContent = '';
  if (!catalog) { listEl.innerHTML = '<div class="oly-or-empty">Загружаю список моделей…</div>'; }
  else if (!items.length) { listEl.innerHTML = '<div class="oly-or-empty">Нет моделей OpenRouter по запросу.</div>'; }
  items.forEach((m, i) => {
    const k = primaryKind(m, filter);
    const row = document.createElement('div'); row.className = 'oly-or-item'; row.setAttribute('role', 'option'); row.dataset.i = i;
    row.id = 'oly-or-opt-' + i; row.setAttribute('data-active', String(i === active)); row.setAttribute('aria-selected', String(i === active));
    const name = document.createElement('span'); name.className = 'oly-or-name'; name.textContent = m.name;
    const id = document.createElement('span'); id.className = 'oly-or-id font-mono'; id.textContent = m.id;
    const badge = document.createElement('span'); badge.className = 'oly-or-badge'; badge.textContent = KIND[k].label;
    row.append(svg(KIND[k].icon, { class: 'k' }), name, id, badge); listEl.append(row);
  });
  section.querySelector('.oly-or-hint').innerHTML = nativeHasItems
    ? 'Клик — вставить модель. Для клавиатуры начните запрос с <kbd>or:</kbd>'
    : '<kbd>↑</kbd><kbd>↓</kbd> выбрать · <kbd>Enter</kbd> вставить ссылку для агента';
}
function scrollActive() { const el = section && section.querySelector(`#oly-or-opt-${active}`); if (el) el.scrollIntoView({ block: 'nearest' }); }
function choose(i) {
  const m = items[i]; if (!m || !state) return;
  const t = trigger(state.el); if (!t) return;
  const k = KIND[primaryKind(m, ls.get(LS_FILTER, 'all'))];
  const text = `@openrouter:${m.id} (${k.word}; MCP openrouter → ${k.tool})`;
  globalThis.__olyReferences?.insert(t,'model',m.id,m.name,text);
  const rec = [m.id, ...ls.get(LS_RECENT, []).filter((x) => x !== m.id)].slice(0, 8); ls.set(LS_RECENT, rec);
  hide();
}
function hide() { if (section) section.hidden = true; state = null; }
function update() {
  const layer = document.querySelector('[data-composer-drawer-layer]');
  const el = editorEl(); const t = layer && trigger(el);
  if (!t || !layer.querySelector('[data-composer-command-drawer]')) { hide(); return; }
  if(globalThis.__olyMentions?.category!=='models'&&!/^(or|openrouter):/i.test(t.raw)){hide();return}
  loadCatalog();
  if (!section) section = build();
  if (section.parentElement !== layer || layer.firstElementChild !== section) layer.insertBefore(section, layer.firstChild);
  section.hidden = false;
  const raw = t.raw; const kb = /^(or|openrouter):/i.test(raw); const q = raw.replace(/^(or|openrouter):/i, '').replace(/[,]/g, ' ');
  const filter = ls.get(LS_FILTER, 'all');
  const nativeHasItems = false && !!layer.querySelector('[data-composer-command-drawer] [data-slot="command-item"],[data-composer-command-drawer] [data-composer-item-id]');
  state = { el, kb, nativeHasItems };
  const key = [q, filter, nativeHasItems, catalog && catalog.at].join('|');
  if (key !== lastKey) { lastKey = key; items = compute(q, filter); active = 0; render(q, filter, nativeHasItems); }
}
function onKey(e) {
  if (!state || !section || section.hidden || !items.length) return;
  if (!(state.kb || !state.nativeHasItems)) return;
  if (!e.target || !e.target.closest || !e.target.closest('[data-testid="composer-editor"]')) return;
  if (e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
  const go = (d) => { active = (active + d + items.length) % items.length;
    for (const r of section.querySelectorAll('.oly-or-item')) { const on = Number(r.dataset.i) === active; r.setAttribute('data-active', String(on)); r.setAttribute('aria-selected', String(on)); }
    scrollActive(); };
  if (e.key === 'ArrowDown') go(1); else if (e.key === 'ArrowUp') go(-1);
  else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') choose(active);
  else return;
  e.preventDefault(); e.stopImmediatePropagation();
}

// ---------- loop ----------
let raf = 0;
function schedule(force) { if (force) lastKey = ''; if (raf) return; raf = requestAnimationFrame(() => { raf = 0; try { patchLogos(); update(); } catch (e) { console.warn('oly openrouter', e); } }); }
function start() {
  addStyle();
  // streaming tokens inside chat text / code / the editor do not wake patchLogos+update (typing is covered by keyup/selectionchange)
  const CONTENT_SEL = '.chat-markdown,[data-user-message-bubble],pre,code,.composer-tiptap,[contenteditable="true"],textarea,input,select,.xterm';
  const inContent = (n) => { const c = globalThis.__olyCore; if (c && typeof c.isContentSubtree === 'function') return c.isContentSubtree(n); const e = n && (n.nodeType === 1 ? n : n.parentElement); try { return !!(e && e.closest(CONTENT_SEL)); } catch (_) { return false; } };
  new MutationObserver((rs) => { if (raf) return; for (const r of rs) if (r.type === 'attributes' || !inContent(r.target)) { schedule(); return; } }).observe(document.body, { childList: true, subtree: true, characterData: true,attributes:true,attributeFilter:['data-provider-accent-color'] });
  document.addEventListener('selectionchange', () => schedule(), true);
  document.addEventListener('keyup', () => schedule(), true);
  document.addEventListener('keydown', onKey, true);
  schedule();
  setTimeout(() => { if (!catalog || Date.now() - catalog.at > TTL) loadCatalog(); }, 8000);
}
globalThis.__olyOpenRouter = { reload: () => { catalog = null; return loadCatalog(); }, accent: ACCENT,kindsOf,patchLogos };
if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
}catch(e){console.warn('oly openrouter',e)}})();
