// Board editor page for T3 Studio: Excalidraw bound to one .excalidraw file on disk (autosave + live reload on external edits).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Excalidraw, MainMenu, Sidebar, WelcomeScreen, serializeAsJSON, restoreAppState, restoreElements,
  convertToExcalidrawElements, getSceneVersion, CaptureUpdateAction, exportToBlob,
} from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import './app.css';

const qs = new URLSearchParams(location.search);
const hash = new URLSearchParams(location.hash.slice(1));
const FILE = qs.get('path') || '';
const THEME = hash.get('theme') === 'dark' ? 'dark' : 'light';
if (hash.get('olympus') === '1') document.documentElement.classList.add('oly');
document.documentElement.classList.toggle('dark', THEME === 'dark');
const HDR = { 'x-oly': '1', 'content-type': 'application/json' };
const baseName = (f) => f.split(/[\\/]/).pop().replace(/\.excalidraw$/i, '');
const dirName = (f) => f.replace(/[\\/][^\\/]*$/, '');
const boardUrl = (f) => '/board?path=' + encodeURIComponent(f) + location.hash;
const api = async (url, opts) => { const r = await fetch(url, opts); const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { status: r.status, body: j }); return j; };

// Accepts full Excalidraw elements and the simplified "skeleton" form ({type:'rectangle',x,y,width,height,label:{text}}).
function normalize(doc) {
  const els = Array.isArray(doc && doc.elements) ? doc.elements.filter((e) => e && typeof e === 'object') : [];
  const full = [], skel = [];
  for (const e of els) (typeof e.seed === 'number' && typeof e.version === 'number' && typeof e.id === 'string') ? full.push(e) : skel.push(e);
  let conv = [];
  if (skel.length) { try { conv = convertToExcalidrawElements(skel, { regenerateIds: false }); } catch (err) { console.warn('skeleton', err); } }
  const elements = restoreElements([...full, ...conv], null, { refreshDimensions: false, repairBindings: true });
  const appState = restoreAppState(doc && doc.appState, null);
  return { elements, appState, files: (doc && doc.files) || {}, hadSkeleton: skel.length > 0 };
}
const keyOf = (els, st, files) => getSceneVersion(els) + '|' + (st && st.viewBackgroundColor) + '|' + Object.keys(files || {}).length;

function Icon({ d, size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d.map((x, i) => <path key={i} d={x} />)}</svg>;
}
const I = {
  boards: ['M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 3v18'],
  plus: ['M12 5v14', 'M5 12h14'],
  pencil: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
  trash: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6'],
  grid: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M14 14h7v7h-7z', 'M3 14h7v7H3z'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  send: ['M22 2 11 13', 'M22 2 15 22l-4-9-9-4z'],
};
const blobToDataUrl = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });

function App() {
  const [api_, setApi] = useState(null);
  const [initial, setInitial] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Загрузка…');
  const [boards, setBoards] = useState([]);
  const [tick, setTick] = useState(0);
  const [docked, setDocked] = useState(() => { try { return localStorage.getItem('oly-studio-docked') === '1'; } catch { return false; } });
  const S = useRef({ mtime: 0, lastKey: null, lastText: null, timer: null, saving: false, pendingCheck: false, firstChange: true, needRefresh: false }).current;
  const name = baseName(FILE);

  useEffect(() => { document.title = name ? `${name} — Excalidraw` : 'Excalidraw'; }, [name]);
  const refreshBoards = useCallback(() => { api('/api/boards?dir=' + encodeURIComponent(dirName(FILE))).then((j) => setBoards(j.boards || [])).catch(() => {}); }, []);

  // initial load
  useEffect(() => {
    if (!FILE) { setError('Не указан файл доски. Откройте доску из списка «Студия».'); return; }
    (async () => {
      try {
        const r = await fetch('/api/board?path=' + encodeURIComponent(FILE), { cache: 'no-store' });
        if (r.status === 404) { setError('Файл доски не найден: ' + FILE); return; }
        const text = await r.text();
        S.mtime = Number(r.headers.get('x-mtime')) || 0; S.lastText = text;
        const n = normalize(JSON.parse(text));
        S.needRefresh = n.hadSkeleton;
        setInitial({ elements: n.elements, appState: { ...n.appState, theme: THEME, openSidebar: docked ? { name: 'boards' } : null }, files: n.files, scrollToContent: true });
        setStatus('Сохранено');
        fetch('/api/recent', { method: 'POST', headers: HDR, body: JSON.stringify({ path: FILE }) }).catch(() => {});
        refreshBoards();
      } catch (e) { setError('Не удалось открыть доску: ' + e.message); }
    })();
  }, []);

  const save = useCallback(async () => {
    if (!api_) return;
    clearTimeout(S.timer); S.timer = null;
    const els = api_.getSceneElementsIncludingDeleted(), st = api_.getAppState(), files = api_.getFiles();
    const text = serializeAsJSON(els, st, files, 'local');
    S.saving = true; setStatus('Сохранение…');
    try {
      const j = await api('/api/board?path=' + encodeURIComponent(FILE) + '&base=' + S.mtime, { method: 'PUT', headers: HDR, body: text });
      S.mtime = j.mtime; S.lastText = text; S.lastKey = keyOf(els, st, files); setStatus('Сохранено');
    } catch (e) {
      if (e.status === 409) { setStatus('Доска изменена извне — загружаю'); S.saving = false; await reloadFromDisk(true); return; }
      setStatus('Ошибка сохранения: ' + e.message);
    } finally { S.saving = false; if (S.pendingCheck) { S.pendingCheck = false; reloadFromDisk(false); } }
  }, [api_]);

  const reloadFromDisk = useCallback(async (force) => {
    if (!api_) return;
    if (S.saving) { S.pendingCheck = true; return; }
    try {
      const r = await fetch('/api/board?path=' + encodeURIComponent(FILE), { cache: 'no-store' });
      if (!r.ok) { if (r.status === 404) setStatus('Файл доски удалён или переименован'); return; }
      const text = await r.text();
      const mtime = Number(r.headers.get('x-mtime')) || 0;
      if (!force && text === S.lastText) { S.mtime = mtime; return; }
      const n = normalize(JSON.parse(text));
      clearTimeout(S.timer); S.timer = null;
      const fileList = Object.values(n.files || {});
      if (fileList.length) api_.addFiles(fileList);
      api_.updateScene({ elements: n.elements, appState: { viewBackgroundColor: n.appState.viewBackgroundColor }, captureUpdate: CaptureUpdateAction.NEVER });
      S.mtime = mtime; S.lastText = text;
      S.lastKey = keyOf(api_.getSceneElementsIncludingDeleted(), api_.getAppState(), api_.getFiles());
      setStatus('Обновлено с диска');
      if (n.hadSkeleton) { S.needRefresh = true; setTick((t) => t + 1); }
    } catch (e) { setStatus('Ошибка чтения: ' + e.message); }
  }, [api_, save]);

  // skeleton text was measured before the hand-drawn fonts loaded: re-measure once fonts are ready, then save the normalized file
  useEffect(() => {
    if (!api_ || !S.needRefresh) return;
    S.needRefresh = false;
    (async () => {
      for (let i = 0; i < 30 && !(document.fonts && document.fonts.check('20px Excalifont')); i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 150));
      const els = restoreElements(api_.getSceneElementsIncludingDeleted(), null, { refreshDimensions: true, repairBindings: true });
      api_.updateScene({ elements: els, captureUpdate: CaptureUpdateAction.NEVER });
      save();
    })();
  }, [api_, save, tick]);

  // live reload when someone (an AI agent) edits the file
  useEffect(() => {
    if (!api_ || !FILE) return;
    const es = new EventSource('/api/watch?path=' + encodeURIComponent(FILE));
    es.addEventListener('change', (ev) => { const d = JSON.parse(ev.data); if (!d.exists) { setStatus('Файл доски удалён или переименован'); return; } if (Math.abs(d.mtime - S.mtime) > 1) reloadFromDisk(false); refreshBoards(); });
    return () => es.close();
  }, [api_, reloadFromDisk]);

  // flush on leave
  useEffect(() => {
    const flush = () => {
      if (!S.timer || !api_) return;
      clearTimeout(S.timer); S.timer = null;
      const text = serializeAsJSON(api_.getSceneElementsIncludingDeleted(), api_.getAppState(), api_.getFiles(), 'local');
      if (text.length < 60000) fetch('/api/board?path=' + encodeURIComponent(FILE) + '&base=' + S.mtime, { method: 'PUT', headers: HDR, body: text, keepalive: true }).catch(() => {});
      else save();
    };
    const vis = () => { if (document.visibilityState === 'hidden') flush(); };
    addEventListener('pagehide', flush); document.addEventListener('visibilitychange', vis);
    return () => { removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', vis); };
  }, [api_, save]);

  const onChange = useCallback((els, st, files) => {
    const k = keyOf(els, st, files);
    if (S.firstChange) { S.firstChange = false; S.lastKey = k; return; }
    if (k === S.lastKey) return;
    S.lastKey = k; setStatus('Изменено…');
    clearTimeout(S.timer); S.timer = setTimeout(save, 700);
  }, [save]);

  const go = (f) => { if (S.timer) save(); location.href = boardUrl(f); };
  const newBoard = async () => {
    const n = prompt('Название новой доски', 'Новая доска'); if (!n) return;
    try { const j = await api('/api/board/create', { method: 'POST', headers: HDR, body: JSON.stringify({ dir: dirName(FILE), name: n }) }); go(j.path); } catch (e) { alert(e.message); }
  };
  const rename = async () => {
    const n = prompt('Новое название доски', name); if (!n || n === name) return;
    try { if (S.timer) await save(); const j = await api('/api/board/rename', { method: 'POST', headers: HDR, body: JSON.stringify({ path: FILE, name: n }) }); history.replaceState(null, '', boardUrl(j.path)); location.reload(); } catch (e) { alert(e.message); }
  };
  const remove = async () => {
    if (!confirm(`Убрать доску «${name}» в корзину (.excalidraw/.trash)?`)) return;
    try { await api('/api/board/delete', { method: 'POST', headers: HDR, body: JSON.stringify({ path: FILE }) }); location.href = '/' + location.hash; } catch (e) { alert(e.message); }
  };
  const copyPath = () => { navigator.clipboard && navigator.clipboard.writeText(FILE).then(() => setStatus('Путь скопирован'), () => {}); };
  const toHub = () => { if (S.timer) save(); location.href = '/' + location.hash; };
  // Snapshot (selection, or the whole board) as PNG + file path -> the T3 composer of the current thread.
  const sendToChat = async () => {
    if (!api_ || S.sending) return;
    S.sending = true;
    try {
      if (S.timer) await save();
      const st = api_.getAppState();
      const all = api_.getSceneElements();
      const sel = all.filter((e) => st.selectedElementIds && st.selectedElementIds[e.id]);
      const els = sel.length ? sel : all;
      let png = null;
      if (els.length) {
        setStatus('Готовлю снимок…');
        const blob = await exportToBlob({
          elements: els, files: api_.getFiles(), mimeType: 'image/png', exportPadding: 24,
          appState: { ...st, exportBackground: true, exportWithDarkMode: false, viewBackgroundColor: st.viewBackgroundColor || '#ffffff' },
          getDimensions: (w, h) => { const s = Math.max(0.25, Math.min(2, 2400 / Math.max(w, h, 1))); return { width: Math.round(w * s), height: Math.round(h * s), scale: s }; },
        });
        png = await blobToDataUrl(blob);
      }
      await api('/api/chat/send', { method: 'POST', headers: HDR, body: JSON.stringify({ board: FILE, png, selection: sel.length > 0, to: hash.get('to') || undefined }) });
      setStatus(sel.length ? 'Выделенное отправлено в чат' : 'Доска отправлена в чат');
    } catch (e) { setStatus('Не отправлено: ' + e.message); }
    finally { S.sending = false; }
  };

  // opened from the hub's "В чат" button (#…&send=1): send once the scene and fonts are ready
  useEffect(() => {
    if (!api_ || hash.get('send') !== '1') return;
    hash.delete('send');
    history.replaceState(null, '', location.pathname + location.search + '#' + hash.toString());
    (async () => {
      for (let i = 0; i < 30 && !(document.fonts && document.fonts.check('20px Excalifont')); i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 300));
      sendToChat();
    })();
  }, [api_]);

  const onDock = (d) => { setDocked(d); try { localStorage.setItem('oly-studio-docked', d ? '1' : '0'); } catch {} };
  const topRight = useCallback(() => (
    <div className="oly-top">
      <span className={'oly-status' + (/Ошибка|Не отправлено/.test(status) ? ' err' : '')} title={FILE}>{status}</span>
      <button type="button" className="oly-send" onClick={sendToChat} title="Прикрепить снимок доски (или выделенного) и путь к файлу к сообщению в текущем треде"><Icon d={I.send} />В чат</button>
      <Sidebar.Trigger name="boards" title="Доски" icon={<Icon d={I.boards} />} className="oly-trigger">Доски</Sidebar.Trigger>
    </div>
  ), [status, sendToChat]);

  if (error) return <div className="oly-error"><p>{error}</p><a href={'/' + location.hash}>Все доски</a></div>;
  if (!initial) return <div className="oly-error"><p>Загрузка доски…</p></div>;
  return (
    <Excalidraw
      excalidrawAPI={setApi}
      initialData={initial}
      onChange={onChange}
      langCode="ru-RU"
      name={name}
      renderTopRightUI={topRight}
      UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: { saveFileToDisk: true } } }}
    >
      <MainMenu>
        <MainMenu.Item icon={<Icon d={I.send} />} onSelect={sendToChat}>Отправить в чат</MainMenu.Item>
        <MainMenu.Item icon={<Icon d={I.grid} />} onSelect={toHub}>Все доски</MainMenu.Item>
        <MainMenu.Item icon={<Icon d={I.plus} />} onSelect={newBoard}>Новая доска</MainMenu.Item>
        <MainMenu.Item icon={<Icon d={I.pencil} />} onSelect={rename}>Переименовать</MainMenu.Item>
        <MainMenu.Item icon={<Icon d={I.copy} />} onSelect={copyPath}>Скопировать путь к файлу</MainMenu.Item>
        <MainMenu.Item icon={<Icon d={I.trash} />} onSelect={remove}>В корзину</MainMenu.Item>
        <MainMenu.Separator />
        <MainMenu.DefaultItems.SaveAsImage />
        <MainMenu.DefaultItems.Export />
        <MainMenu.DefaultItems.SearchMenu />
        <MainMenu.DefaultItems.Help />
        <MainMenu.DefaultItems.ClearCanvas />
        <MainMenu.Separator />
        <MainMenu.DefaultItems.ToggleTheme />
        <MainMenu.DefaultItems.ChangeCanvasBackground />
      </MainMenu>
      <WelcomeScreen>
        <WelcomeScreen.Hints.MenuHint />
        <WelcomeScreen.Hints.ToolbarHint />
        <WelcomeScreen.Center>
          <WelcomeScreen.Center.Heading>{name}</WelcomeScreen.Center.Heading>
          <div className="oly-welcome">Рисуйте — доска сохраняется в файл автоматически.<br /><code>{FILE}</code></div>
        </WelcomeScreen.Center>
      </WelcomeScreen>
      <Sidebar name="boards" docked={docked} onDock={onDock} className="oly-sidebar">
        <Sidebar.Header>Доски</Sidebar.Header>
        <div className="oly-boards">
          <button className="oly-new" onClick={newBoard}><Icon d={I.plus} /> Новая доска</button>
          {boards.map((b) => (
            <button key={b.path} className={'oly-board' + (b.path.toLowerCase() === FILE.toLowerCase() ? ' active' : '')} onClick={() => go(b.path)} title={b.path}>
              <span className="n">{b.name}</span>
              <span className="t">{new Date(b.mtime).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
            </button>
          ))}
          <button className="oly-all" onClick={toHub}>Все доски и папки →</button>
        </div>
      </Sidebar>
    </Excalidraw>
  );
}

window.EXCALIDRAW_ASSET_PATH = '/excalidraw/';
createRoot(document.getElementById('root')).render(<App />);
