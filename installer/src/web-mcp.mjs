#!/usr/bin/env node
import {hackernewsSearch} from './hackernews.mjs';
// MCP server "oly-web" (stdio, JSON-RPC 2.0, newline-delimited, no dependencies) for Claude Code / Codex agents in T3.
// Web data: Google search + page scraping (Scrape.do), X/Twitter (GetXAPI), Reddit (RedditAPIs), YouTube transcripts (TranscriptAPI).
// Keys: process env first, then HKCU\Environment (keys added in T3 → Настройки → API-ключи work without restarting).
// Key values are never written to stdout/stderr, files or tool results.
import readline from 'node:readline';
import { byId, getKey, httpJson, errText, UserError, SETTINGS_HINT, INTEGRATIONS, readUserEnv } from './keys.mjs';

const SERVER = { name: 'oly-web', version: '1.0.0' };
const DEFAULT_MAX = 20000, HARD_MAX = 100000;
const out = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');

// ---------- helpers ----------
const clip = (s, n) => (s.length > n ? s.slice(0, n) + `\n\n…[обрезано: показано ${n} из ${s.length} символов; увеличьте max_chars при необходимости]` : s);
const maxChars = (a) => Math.min(HARD_MAX, Math.max(500, Number(a.max_chars) || DEFAULT_MAX));
const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const short = (s, n = 400) => { s = one(s); return s.length > n ? s.slice(0, n) + '…' : s; };
const num = (n) => (n == null ? '?' : Number(n) >= 1000 ? (Number(n) / 1000).toFixed(Number(n) >= 10000 ? 0 : 1) + 'k' : String(n));
const req = (a, k) => { const v = a[k]; if (v == null || String(v).trim() === '') throw new UserError(`Не указан параметр ${k}`); return String(v).trim(); };

// Authenticated call with one retry using a fresh registry key after an auth error (key replaced in settings).
async function call(id, build, { timeoutMs = 60000, authCodes = [401, 403] } = {}) {
  let key = await getKey(id);
  let r = await httpJson(...build(key, timeoutMs));
  if (authCodes.includes(r.status)) {
    const fresh = await getKey(id, { fresh: true }).catch(() => '');
    if (fresh && fresh !== key) { key = fresh; r = await httpJson(...build(key, timeoutMs)); }
  }
  return r;
}
function fail(id, r, extra = {}) {
  const it = byId(id);
  const m = errText(r);
  const map = {
    401: `ключ отклонён или ${id === 'scrapedo' ? 'закончились кредиты / подписка приостановлена' : 'неверный'}. ${SETTINGS_HINT}`,
    402: `закончились кредиты/баланс — пополните аккаунт ${it.name}.`,
    403: `ключ неверный. ${SETTINGS_HINT}`,
    429: 'слишком много запросов — подождите несколько секунд и повторите.',
    ...extra,
  };
  const hint = map[r.status] || (r.status >= 500 ? 'временная ошибка сервиса — можно повторить.' : '');
  return new UserError(`${it.name}: HTTP ${r.status}${hint ? ' — ' + hint : ''}${m ? `\nОтвет: ${m}` : ''}`);
}
const bearer = (url, opts = {}) => (key, timeoutMs) => [url, { headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' }, timeoutMs, ...opts }];
const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v != null && v !== '') p.set(k, String(v)); return p.toString(); };

// Minimal HTML → readable text (used for format "text"; markdown comes from Scrape.do output=markdown).
function htmlToText(html) {
  let s = html.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|section|article|header|footer|li|tr|h[1-6]|blockquote|pre|table|ul|ol|nav|main|aside)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, '');
  const ent = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', laquo: '«', raquo: '»' };
  s = s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const c = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(c) ? String.fromCodePoint(c) : m; }
    return ent[e.toLowerCase()] ?? m;
  });
  return s.split('\n').map((l) => l.replace(/[ \t\f\v ]+/g, ' ').trim()).filter((l, i, a) => l || (a[i - 1] && a[i - 1] !== '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
const titleOf = (html) => one((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '');

// ---------- Scrape.do ----------
async function webSearch(a) {
  const q = req(a, 'query');
  const page = Math.max(1, Math.min(10, Number(a.page) || 1));
  const params = { q, gl: a.country, hl: a.language, time_period: a.time_period, start: (page - 1) * 10 || undefined, device: a.device };
  const r = await call('scrapedo', (key, t) => ['https://api.scrape.do/plugin/google/search?' + qs({ token: key, ...params }), { timeoutMs: t }], { timeoutMs: 90000 });
  if (!r.ok || !r.json) throw fail('scrapedo', r, { 429: 'запрос этой страницы уже выполняется или превышен лимит параллельности — повторите позже.' });
  const j = r.json, L = [];
  L.push(`Google: «${q}»${page > 1 ? ` (стр. ${page})` : ''}`);
  const ao = j.ai_overview;
  if (ao) {
    const t = typeof ao === 'string' ? ao : (ao.text || (Array.isArray(ao.text_blocks) ? ao.text_blocks.map((b) => b.snippet || b.text || '').join(' ') : ''));
    if (t) L.push('\nAI Overview: ' + short(t, 800));
  }
  const kg = j.knowledge_graph;
  if (kg && (kg.title || kg.description)) L.push(`\nКарточка: ${one(kg.title)}${kg.type ? ' (' + one(kg.type) + ')' : ''} — ${short(kg.description, 300)}`);
  const org = Array.isArray(j.organic_results) ? j.organic_results : [];
  L.push('');
  org.forEach((o, i) => {
    L.push(`${o.position ?? i + 1}. ${one(o.title)}\n   ${o.link}${o.date ? `\n   Дата: ${one(o.date)}` : ''}${o.snippet ? `\n   ${short(o.snippet, 350)}` : ''}`);
  });
  if (!org.length) L.push('Органических результатов нет.');
  const ts = Array.isArray(j.top_stories) ? j.top_stories.slice(0, 5) : [];
  if (ts.length) L.push('\nНовости:\n' + ts.map((s) => `- ${one(s.title)} — ${s.link}${s.source ? ` (${one(s.source)}${s.date ? ', ' + one(s.date) : ''})` : ''}`).join('\n'));
  const rq = Array.isArray(j.related_questions) ? j.related_questions.slice(0, 5) : [];
  if (rq.length) L.push('\nПохожие вопросы:\n' + rq.map((x) => `- ${one(x.question)}${x.snippet ? ': ' + short(x.snippet, 200) : ''}`).join('\n'));
  const rs = Array.isArray(j.related_searches) ? j.related_searches.slice(0, 8) : [];
  if (rs.length) L.push('\nПохожие запросы: ' + rs.map((x) => one(x.query || x.title || x)).filter(Boolean).join(' · '));
  L.push(`\n[Scrape.do: 10 кредитов за запрос${r.headers.get('scrape.do-remaining-credits') ? `, осталось ${r.headers.get('scrape.do-remaining-credits')}` : ''}. Следующая страница: page=${page + 1}. Для чтения страницы — scrape_page.]`);
  return clip(L.join('\n'), maxChars(a));
}

async function scrapePage(a) {
  let target = req(a, 'url');
  if (!/^https?:\/\//i.test(target)) target = 'https://' + target;
  const format = ['markdown', 'text', 'html'].includes(a.format) ? a.format : 'markdown';
  const params = { url: target, render: a.render_js ? 'true' : undefined, super: a.super_proxy ? 'true' : undefined, geoCode: a.country,
    output: format === 'markdown' ? 'markdown' : undefined, waitSelector: a.render_js && a.wait_selector ? a.wait_selector : undefined,
    customWait: a.render_js && a.wait_ms ? Math.min(35000, Number(a.wait_ms)) : undefined, timeout: 90000 };
  const r = await call('scrapedo', (key, t) => ['https://api.scrape.do/?' + qs({ token: key, ...params }), { timeoutMs: t }], { timeoutMs: 110000 });
  const cost = r.headers.get('scrape.do-request-cost'), left = r.headers.get('scrape.do-remaining-credits');
  const status = r.headers.get('scrape.do-target-status') || r.headers.get('scrape.do-initial-status-code');
  if (!r.ok) {
    if (r.status === 404 || r.status === 410 || (r.status === 400 && !r.json)) {
      throw new UserError(`Целевая страница вернула ${r.status} (Scrape.do списывает кредиты за 2xx/400/404/410).${r.text ? '\n' + clip(htmlToText(r.text), 1500) : ''}`);
    }
    throw fail('scrapedo', r, { 502: 'не удалось загрузить страницу. Повторите; для защищённых сайтов попробуйте render_js=true или super_proxy=true.' });
  }
  let body = r.text;
  let head = `URL: ${target}`;
  if (format === 'text') { const t = titleOf(body); if (t) head += `\nЗаголовок: ${t}`; body = htmlToText(body); }
  if (format === 'markdown' && /^\s*<(!doctype|html)/i.test(body)) body = htmlToText(body); // non-HTML responses come back raw
  const meta = `[Scrape.do: ${cost ? cost + ' кредит(ов)' : 'стоимость в заголовке не указана'}${left ? `, осталось ${left}` : ''}${status ? `, статус страницы ${status}` : ''}${a.render_js ? ', JS-рендеринг' : ''}]`;
  return clip(`${head}\n${meta}\n\n${body.trim() || '(пустой ответ — попробуйте render_js=true)'}`, maxChars(a));
}

// ---------- GetXAPI (X / Twitter) ----------
const X = 'https://api.getxapi.com';
function fmtTweet(t, i) {
  if (!t) return '';
  const au = t.author || {};
  const m = [`♥${num(t.likeCount)}`, `↻${num(t.retweetCount)}`, `💬${num(t.replyCount)}`, t.viewCount != null ? `👁${num(t.viewCount)}` : ''].filter(Boolean).join(' ');
  const q = t.quoted_tweet ? `\n   ↳ цитата @${t.quoted_tweet.author?.userName || '?'}: ${short(t.quoted_tweet.text, 200)}` : '';
  const media = Array.isArray(t.media) && t.media.length ? ` [медиа: ${t.media.length}]` : '';
  return `${i != null ? i + 1 + '. ' : ''}@${au.userName || '?'}${au.name ? ` (${one(au.name)})` : ''} · ${t.createdAt || ''} · ${m}\n   ${one(t.text)}${media}${q}\n   ${t.url || t.twitterUrl || ''} · id ${t.id}`;
}
const cursorLine = (j) => (j.has_more && j.next_cursor ? `\n[Ещё результаты: cursor="${j.next_cursor}"]` : '\n[Больше результатов нет]');
const handle = (s) => String(s).trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '').split(/[/?#]/)[0];
const tweetId = (s) => { const m = /status(?:es)?\/(\d+)/.exec(String(s)); return m ? m[1] : String(s).trim(); };

async function xSearch(a) {
  const q = req(a, 'query');
  const product = a.product === 'Top' ? 'Top' : 'Latest';
  const r = await call('getxapi', bearer(`${X}/twitter/tweet/advanced_search?` + qs({ q, product, cursor: a.cursor })));
  if (!r.ok || !r.json) throw fail('getxapi', r);
  const tw = r.json.tweets || [];
  const L = [`X: «${q}» (${product}), твитов: ${tw.length}`, ...tw.map(fmtTweet)];
  if (!tw.length) L.push('Ничего не найдено.');
  return clip(L.join('\n') + cursorLine(r.json) + '\n[GetXAPI: $0.001]', maxChars(a));
}
async function xUser(a) {
  const u = handle(req(a, 'username'));
  const r = await call('getxapi', bearer(`${X}/twitter/user/info?` + qs({ userName: u })));
  if (!r.ok || !r.json) throw fail('getxapi', r, { 404: `пользователь @${u} не найден.` });
  const d = r.json.data || r.json;
  return [`@${d.userName} — ${one(d.name)}${d.isBlueVerified || d.isVerified ? ' ✓' : ''}${d.protected ? ' (закрытый)' : ''}`,
    d.description ? one(d.description) : '', `Подписчики: ${num(d.followers)} · подписки: ${num(d.following)} · твитов: ${num(d.statusesCount)} · медиа: ${num(d.mediaCount)}`,
    d.location ? `Локация: ${one(d.location)}` : '', d.url ? `Сайт: ${d.url}` : '', `Создан: ${d.createdAt || '?'} · id ${d.id}`,
    Array.isArray(d.pinnedTweetIds) && d.pinnedTweetIds.length ? `Закреплённые: ${d.pinnedTweetIds.join(', ')}` : '', '[GetXAPI: $0.001]'].filter(Boolean).join('\n');
}
async function xUserTweets(a) {
  const u = a.user_id ? null : handle(req(a, 'username'));
  const r = await call('getxapi', bearer(`${X}/twitter/user/tweets?` + qs({ userName: u, userId: a.user_id, cursor: a.cursor })));
  if (!r.ok || !r.json) throw fail('getxapi', r, { 404: 'пользователь не найден.' });
  const tw = r.json.tweets || [];
  return clip([`Твиты @${r.json.userName || u || a.user_id} (без ретвитов ленты), ${tw.length}:`, ...tw.map(fmtTweet)].join('\n') + cursorLine(r.json) + '\n[GetXAPI: $0.001]', maxChars(a));
}
async function xTweet(a) {
  const id = tweetId(req(a, 'id'));
  const L = [];
  if (!a.cursor) {
    const r = await call('getxapi', bearer(`${X}/twitter/tweet/detail?` + qs({ id })));
    if (!r.ok || !r.json) throw fail('getxapi', r, { 404: 'твит не найден.' });
    L.push(fmtTweet(r.json.data || r.json));
  }
  let cost = a.cursor ? 0 : 0.001;
  if (a.replies || a.cursor) {
    const r = await call('getxapi', bearer(`${X}/twitter/tweet/replies?` + qs({ id, cursor: a.cursor })));
    if (!r.ok || !r.json) throw fail('getxapi', r);
    cost += 0.001;
    const rp = r.json.replies || [];
    L.push(`\nОтветы (${rp.length}${r.json.reply_count != null ? ` из ${r.json.reply_count}` : ''}):`, ...rp.map(fmtTweet));
    L.push(cursorLine(r.json).trim());
  }
  return clip(L.join('\n') + `\n[GetXAPI: $${cost.toFixed(3)}]`, maxChars(a));
}

// ---------- RedditAPIs ----------
const R = 'https://api.redditapis.com/api/reddit';
function fmtPost(p, i) {
  const when = p.created || (p.created_utc ? new Date(p.created_utc * 1000).toISOString() : '');
  const link = p.permalink ? 'https://www.reddit.com' + p.permalink : p.url || '';
  const ext = p.link_url && !p.is_self && p.link_url !== link ? `\n   Ссылка: ${p.link_url}` : '';
  return `${i + 1}. [r/${p.subreddit}] ${one(p.title)}\n   u/${p.author} · ${when} · ▲${num(p.upvotes ?? p.score)} · 💬${num(p.comments ?? p.num_comments)} · id ${p.id}\n   ${link}${ext}${p.text ? `\n   ${short(p.text, 500)}` : ''}`;
}
const redditAfter = (j) => (j.after ? `\n[Ещё: after="${j.after}"]` : `\n[Конец списка${j.listing_status ? ' (' + j.listing_status + ')' : ''}]`);
const T_ENUM = ['hour', 'day', 'week', 'month', 'year', 'all'];
const sub = (s) => String(s).trim().replace(/^\/?r\//i, '').replace(/\/$/, '');

async function redditSearch(a) {
  const q = req(a, 'query');
  const r = await call('redditapis', bearer(`${R}/search?` + qs({ q, subreddit: a.subreddit ? sub(a.subreddit) : undefined, sort: a.sort, t: T_ENUM.includes(a.time) ? a.time : undefined,
    limit: Math.min(100, Number(a.limit) || 25), after: a.after })), { timeoutMs: 60000 });
  if (!r.ok || !r.json) throw fail('redditapis', r);
  const ps = r.json.posts || [];
  return clip([`Reddit: «${q}»${a.subreddit ? ' в r/' + sub(a.subreddit) : ''}, постов: ${ps.length}`, ...ps.map(fmtPost)].join('\n') + redditAfter(r.json) + '\n[RedditAPIs: $0.0015]', maxChars(a));
}
async function redditPosts(a) {
  const s = sub(req(a, 'subreddit'));
  const r = await call('redditapis', bearer(`${R}/posts?` + qs({ subreddit: s, sort: a.sort, t: T_ENUM.includes(a.time) ? a.time : undefined,
    limit: Math.min(100, Number(a.limit) || 25), after: a.after })), { timeoutMs: 60000 });
  if (!r.ok || !r.json) throw fail('redditapis', r, { 404: `сабреддит r/${s} не найден.` });
  const ps = r.json.posts || [];
  return clip([`r/${s} (${a.sort || 'new'}), постов: ${ps.length}`, ...ps.map(fmtPost)].join('\n') + redditAfter(r.json) + '\n[RedditAPIs: $0.0015]', maxChars(a));
}
async function redditComments(a) {
  const raw = req(a, 'post');
  const m = /comments\/([a-z0-9]+)/i.exec(raw);
  const id = (m ? m[1] : raw).replace(/^t3_/i, '');
  if (!/^[a-z0-9]+$/i.test(id)) throw new UserError('post: укажите id поста (например 1abcde) или ссылку на пост Reddit');
  const r = await call('redditapis', bearer(`${R}/post/${id}/comments?` + qs({ limit: Math.min(500, Number(a.limit) || 100), depth: a.depth ? Math.min(10, Number(a.depth)) : undefined, sort: a.sort })), { timeoutMs: 60000 });
  if (!r.ok || !r.json) throw fail('redditapis', r, { 404: 'пост не найден.' });
  const j = r.json, p = j.post?.data || j.post || {};
  const L = [];
  if (p.title) L.push(fmtPost(p, 0).replace(/^1\. /, ''), '');
  let shown = 0, more = 0;
  const walk = (arr, depth) => {
    for (const c of arr || []) {
      const k = c.kind, d = c.data || c;
      if (k === 'more') { more += Number(d.count) || 0; continue; }
      if (!d || d.body == null) continue;
      shown++;
      const sc = d.upvotes ?? d.score;
      L.push(`${'  '.repeat(depth)}- u/${d.author}${sc != null ? ` ▲${num(sc)}` : ''}: ${short(d.body, 700)}`);
      const rep = d.replies;
      if (rep && typeof rep === 'object') walk(rep.data?.children || rep.children || (Array.isArray(rep) ? rep : []), depth + 1);
    }
  };
  walk(j.comments, 0);
  if (!shown) L.push('Комментариев нет.');
  if (more) L.push(`\n[Свёрнуто ещё ~${more} комментариев (API отдаёт до 100 за вызов)]`);
  return clip(L.join('\n') + '\n[RedditAPIs: $0.0015]', maxChars(a));
}

// ---------- TranscriptAPI (YouTube) ----------
const T = 'https://api.transcriptapi.io';
function videoId(s) {
  s = String(s).trim();
  const m = /(?:v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/|\/v\/)([\w-]{11})/.exec(s);
  if (m) return m[1];
  if (/^[\w-]{11}$/.test(s)) return s;
  throw new UserError('video: укажите ссылку YouTube или id из 11 символов');
}
const ts = (sec) => { sec = Math.floor(sec); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
async function ytTranscript(a) {
  const id = videoId(req(a, 'video'));
  const r = await call('transcriptapi', bearer(`${T}/transcript?` + qs({ video_id: id, language: a.language, translate_to: a.translate_to })), { timeoutMs: 110000 });
  if (!r.ok || !r.json) throw fail('transcriptapi', r, { 404: `у видео нет доступных субтитров (отключены, приватное, удалено или 18+). Кредит возвращён.${r.json?.retryable ? ' Можно повторить.' : ''}`,
    422: 'неверный параметр (проверьте video/language).' });
  const seg = Array.isArray(r.json.transcript) ? r.json.transcript : [];
  if (!seg.length) return `Видео ${id}: расшифровка пустая.`;
  const dur = seg.at(-1).start + (seg.at(-1).duration || 0);
  let body;
  if (a.timestamps) body = seg.map((x) => `[${ts(x.start)}] ${one(x.text)}`).join('\n');
  else {
    // Paragraphs of ~60 s with a timestamp at the start of each.
    const paras = []; let cur = [], t0 = seg[0].start;
    for (const x of seg) { if (x.start - t0 >= 60 && cur.length) { paras.push(`[${ts(t0)}] ` + cur.join(' ')); cur = []; t0 = x.start; } cur.push(one(x.text)); }
    if (cur.length) paras.push(`[${ts(t0)}] ` + cur.join(' '));
    body = paras.join('\n\n');
  }
  const head = `YouTube ${id} — https://www.youtube.com/watch?v=${id}\nДлительность ≈ ${ts(dur)}, фрагментов: ${seg.length}${r.json.translated_to ? `, перевод: ${r.json.translated_to}` : ''}\n[TranscriptAPI: 1 кредит, из кэша — бесплатно${a.translate_to ? '; перевод — доп. кредиты' : ''}]`;
  return clip(head + '\n\n' + body, maxChars(a));
}
async function ytSearch(a) {
  const q = req(a, 'query');
  const r = await call('transcriptapi', bearer(`${T}/search?` + qs({ q, limit: Math.min(50, Number(a.limit) || 10) })), { timeoutMs: 60000 });
  if (!r.ok || !r.json) throw fail('transcriptapi', r);
  const j = r.json;
  const items = Array.isArray(j) ? j : (j.results || j.videos || j.items || []);
  if (!Array.isArray(items) || !items.length) return clip(`YouTube: «${q}» — результатов нет.\n` + JSON.stringify(j).slice(0, 2000), maxChars(a));
  const L = [`YouTube: «${q}», видео: ${items.length}`];
  items.forEach((v, i) => {
    const id = v.video_id || v.videoId || v.id;
    const ch = v.channel_title || v.channelTitle || v.channel?.title || v.channel_name || v.channel || '';
    const extra = [v.duration || v.length_text || v.lengthText, v.views ?? v.view_count ?? v.viewCount, v.published || v.published_time || v.publishedTime].filter((x) => x != null && x !== '').join(' · ');
    L.push(`${i + 1}. ${one(v.title)}${typeof ch === 'string' && ch ? ' — ' + one(ch) : ''}\n   https://www.youtube.com/watch?v=${id}${extra ? '\n   ' + extra : ''}`);
  });
  return clip(L.join('\n') + '\n[TranscriptAPI: 1 кредит; расшифровка — youtube_transcript]', maxChars(a));
}

async function keysStatus() {
  const reg = await readUserEnv();
  const lines = INTEGRATIONS.filter((x) => x.tools.length).map((it) => {
    const set = !!((process.env[it.env] || '').trim() || (reg[it.env] || '').trim());
    return `${set ? '✓' : '✗'} ${it.name} (${it.env}) — ${set ? 'ключ задан' : 'нет ключа'}; инструменты: ${it.tools.join(', ')}; цена: ${it.pricing}`;
  });
  return lines.join('\n') + `\n\n${SETTINGS_HINT}`;
}

// ---------- tool table ----------
const S = (p, r = []) => ({ type: 'object', properties: p, required: r, additionalProperties: false });
const MAXP = { max_chars: { type: 'integer', description: `Максимум символов в ответе (по умолчанию ${DEFAULT_MAX}, до ${HARD_MAX})` } };
const RO = { readOnlyHint: true, openWorldHint: true };
const TOOLS = [
 {name:'hackernews_search',handler:hackernewsSearch,annotations:RO,description:'Поиск публикаций Hacker News через публичный Algolia API, без ключа и платы. Возвращает статьи и ссылки на обсуждения.',inputSchema:S({query:{type:'string'},limit:{type:'integer',minimum:1,maximum:30},sort:{type:'string',enum:['relevance','date']}},['query'])},
  { name: 'web_search', handler: webSearch, annotations: RO,
    description: 'Поиск Google (через Scrape.do SERP API): органическая выдача, новости, похожие вопросы, AI Overview. 10 кредитов Scrape.do за страницу. Для чтения найденной страницы используйте scrape_page.',
    inputSchema: S({ query: { type: 'string', description: 'Поисковый запрос (поддерживает операторы Google: site:, "", -)' },
      country: { type: 'string', description: 'Страна выдачи, код gl: us, ru, de…' }, language: { type: 'string', description: 'Язык интерфейса hl: en, ru…' },
      time_period: { type: 'string', enum: ['last_hour', 'last_day', 'last_week', 'last_month', 'last_year'], description: 'Ограничить по времени' },
      page: { type: 'integer', description: 'Страница выдачи 1–10 (по 10 результатов)' }, device: { type: 'string', enum: ['desktop', 'mobile'] }, ...MAXP }, ['query']) },
  { name: 'scrape_page', handler: scrapePage, annotations: RO,
    description: 'Загрузить веб-страницу через Scrape.do (прокси, обход блокировок) и вернуть текст. По умолчанию markdown. Стоимость: 1 кредит; render_js — 5; super_proxy — 10; оба — 25 (некоторые домены дороже).',
    inputSchema: S({ url: { type: 'string', description: 'Адрес страницы' },
      format: { type: 'string', enum: ['markdown', 'text', 'html'], description: 'markdown (по умолчанию), text — чистый текст, html — сырой HTML (обрезается)' },
      render_js: { type: 'boolean', description: 'Рендерить JavaScript в браузере (для SPA/динамических страниц)' },
      wait_selector: { type: 'string', description: 'С render_js: CSS-селектор, который дождаться (до 10 с)' },
      wait_ms: { type: 'integer', description: 'С render_js: доп. ожидание после загрузки, мс (до 35000)' },
      super_proxy: { type: 'boolean', description: 'Резидентные/мобильные прокси для сложных сайтов (дороже)' },
      country: { type: 'string', description: 'Гео прокси (geoCode), напр. us, de' }, ...MAXP }, ['url']) },
  { name: 'x_search', handler: xSearch, annotations: RO,
    description: 'Поиск твитов в X (Twitter) через GetXAPI, ~20 за страницу, $0.001. Поддерживает операторы расширенного поиска: from:user, since:2026-01-01, min_faves:100, lang:ru, -filter:replies и т. д.',
    inputSchema: S({ query: { type: 'string', description: 'Запрос с операторами X' }, product: { type: 'string', enum: ['Latest', 'Top'], description: 'Latest (по умолчанию) или Top' },
      cursor: { type: 'string', description: 'Курсор следующей страницы из прошлого ответа' }, ...MAXP }, ['query']) },
  { name: 'x_user', handler: xUser, annotations: RO, description: 'Профиль пользователя X: описание, подписчики, число твитов, дата создания. $0.001.',
    inputSchema: S({ username: { type: 'string', description: 'Имя без @ или ссылка на профиль' } }, ['username']) },
  { name: 'x_user_tweets', handler: xUserTweets, annotations: RO, description: 'Последние твиты пользователя X (его собственные посты), ~20 за страницу. $0.001.',
    inputSchema: S({ username: { type: 'string', description: 'Имя без @' }, user_id: { type: 'string', description: 'Или числовой id (быстрее)' },
      cursor: { type: 'string', description: 'Курсор следующей страницы' }, ...MAXP }) },
  { name: 'x_tweet', handler: xTweet, annotations: RO, description: 'Твит по id или ссылке; с replies=true — ещё и ответы (~20, +$0.001). С cursor — следующая страница ответов.',
    inputSchema: S({ id: { type: 'string', description: 'Id твита или ссылка x.com/…/status/…' }, replies: { type: 'boolean', description: 'Загрузить ответы' },
      cursor: { type: 'string', description: 'Курсор следующей страницы ответов' }, ...MAXP }, ['id']) },
  { name: 'reddit_search', handler: redditSearch, annotations: RO, description: 'Поиск постов Reddit через RedditAPIs (до 100 за вызов, $0.0015).',
    inputSchema: S({ query: { type: 'string' }, subreddit: { type: 'string', description: 'Искать только в этом сабреддите (без r/)' },
      sort: { type: 'string', enum: ['relevance', 'new', 'hot', 'top', 'comments'] }, time: { type: 'string', enum: T_ENUM, description: 'Период (по умолчанию all)' },
      limit: { type: 'integer', description: '1–100, по умолчанию 25' }, after: { type: 'string', description: 'Курсор следующей страницы' }, ...MAXP }, ['query']) },
  { name: 'reddit_posts', handler: redditPosts, annotations: RO, description: 'Посты сабреддита (new/hot/top/rising/controversial/best). $0.0015.',
    inputSchema: S({ subreddit: { type: 'string', description: 'Имя без r/' }, sort: { type: 'string', enum: ['new', 'hot', 'top', 'rising', 'controversial', 'best'] },
      time: { type: 'string', enum: T_ENUM, description: 'Только для top/controversial' }, limit: { type: 'integer', description: '1–100, по умолчанию 25' },
      after: { type: 'string', description: 'Курсор следующей страницы' }, ...MAXP }, ['subreddit']) },
  { name: 'reddit_comments', handler: redditComments, annotations: RO, description: 'Пост Reddit и дерево комментариев (до 100 за вызов). $0.0015.',
    inputSchema: S({ post: { type: 'string', description: 'Id поста (1abcde) или ссылка на пост' }, sort: { type: 'string', enum: ['confidence', 'top', 'new', 'controversial', 'old', 'qa'] },
      limit: { type: 'integer', description: '1–500, по умолчанию 100' }, depth: { type: 'integer', description: 'Глубина 1–10' }, ...MAXP }, ['post']) },
  { name: 'youtube_transcript', handler: ytTranscript, annotations: RO,
    description: 'Расшифровка (субтитры) ролика YouTube через TranscriptAPI. 1 кредит, повтор из кэша бесплатно; без субтитров — кредит возвращается.',
    inputSchema: S({ video: { type: 'string', description: 'Ссылка YouTube (watch, youtu.be, shorts) или id из 11 символов' },
      language: { type: 'string', description: 'Код языка субтитров (по умолчанию en, затем любой доступный)' },
      translate_to: { type: 'string', description: 'Перевести (ИИ): ru, de… — доп. кредиты' },
      timestamps: { type: 'boolean', description: 'Каждый фрагмент с меткой времени (иначе абзацы по ~60 с)' }, ...MAXP }, ['video']) },
  { name: 'youtube_search', handler: ytSearch, annotations: RO, description: 'Поиск видео на YouTube через TranscriptAPI. 1 кредит.',
    inputSchema: S({ query: { type: 'string' }, limit: { type: 'integer', description: '1–50, по умолчанию 10' }, ...MAXP }, ['query']) },
  { name: 'web_keys_status', handler: keysStatus, annotations: { readOnlyHint: true }, description: 'Какие API-ключи веб-сервисов заданы (без значений) и какие инструменты доступны.',
    inputSchema: S({}) },
];

// ---------- JSON-RPC ----------
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  const { id, method, params } = msg;
  const reply = (result) => id !== undefined && out({ jsonrpc: '2.0', id, result });
  const error = (code, message) => id !== undefined && out({ jsonrpc: '2.0', id, error: { code, message } });
  try {
    if (method === 'initialize') {
      return reply({ protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: SERVER,
        instructions: 'Веб-данные для агента: web_search (Google) и scrape_page (чтение страниц) — Scrape.do; x_* — X/Twitter; reddit_* — Reddit; youtube_* — YouTube. hackernews_search — Hacker News, бесплатно и без ключа. Остальные вызовы используют настроенные API (цена в описании). Указание !web, !reddit, !x, !youtube или !hn в сообщении выбирает соответствующий источник поиска; запрос — следующий за указанием текст. Если ключа нет — инструмент вернёт, какой ключ нужен; ' + SETTINGS_HINT });
    }
    if (method === 'notifications/initialized' || method?.startsWith('notifications/')) return;
    if (method === 'ping') return reply({});
    if (method === 'tools/list') return reply({ tools: TOOLS.map(({ handler, ...t }) => t) });
    if (method === 'tools/call') {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return error(-32602, 'Unknown tool: ' + params?.name);
      try {
        const text = await tool.handler(params.arguments || {});
        return reply({ content: [{ type: 'text', text }] });
      } catch (e) {
        const m = e instanceof UserError ? e.message : 'Внутренняя ошибка: ' + (e?.message || e);
        return reply({ content: [{ type: 'text', text: 'Ошибка: ' + m }], isError: true });
      }
    }
    if (method === 'resources/list') return reply({ resources: [] });
    if (method === 'prompts/list') return reply({ prompts: [] });
    return error(-32601, 'Method not found: ' + method);
  } catch (e) { return error(-32603, String(e?.message || e)); }
});
