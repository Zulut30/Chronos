#!/usr/bin/env node
// OpenRouter MCP server (stdio, no dependencies) for T3 Code agents.
// Tools: list_models, model_info, generate_image, generate_video, get_video, decide, chat_once.
// API key: env OPENROUTER_API_KEY, else the Windows user variable of the same name (HKCU\Environment).
// The key is never written to files, logs or tool results.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readEnvFile } from '../integrations-service/user-env.mjs';
import {writeReceipt} from './usage-ledger.mjs';
import {audioTools} from './audio-tools.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai').replace(/\/+$/, '');
const VERSION = '1.1.0';
const log = (...a) => process.stderr.write('[openrouter-mcp] ' + a.join(' ') + '\n');

// ---------- API key ----------
let keyCache = null;
// Fallback for processes started before the user variable was set: read HKCU\Environment directly.
function readUserEnvVar(name) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(readEnvFile()[name] || '');
    const p = spawn('reg.exe', ['query', 'HKCU\\Environment', '/v', name], { windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => resolve(''));
    p.on('close', () => {
      const m = new RegExp('^\\s*' + name + '\\s+REG_(?:EXPAND_)?SZ\\s+(.+?)\\s*$', 'mi').exec(out);
      resolve(m ? m[1] : '');
    });
  });
}
async function apiKey() {
  if (keyCache) return keyCache;
  const k = (process.env.OPENROUTER_API_KEY || '').trim() || (await readUserEnvVar('OPENROUTER_API_KEY')).trim();
  if (!k) throw new UserError('Нет ключа OpenRouter: задайте пользовательскую переменную окружения OPENROUTER_API_KEY.');
  keyCache = k;
  return k;
}

class UserError extends Error {}

// ---------- HTTP ----------
async function api(method, p, { body, auth = true, raw = false, timeoutMs = 300000 } = {}) {
  const headers = { 'X-Title': 'T3 Code' };
  if (auth) headers.Authorization = 'Bearer ' + (await apiKey());
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal });
  } catch (e) {
    throw new UserError('Сеть: ' + (e.name === 'AbortError' ? 'таймаут запроса' : e.message));
  } finally { clearTimeout(t); }
  if (!res.ok) {
    let msg = res.status + ' ' + res.statusText;
    try { const j = await res.json(); if (j?.error?.message) msg = res.status + ': ' + j.error.message; } catch {}
    if (res.status === 401) keyCache = null;
    throw new UserError('OpenRouter ' + msg);
  }
  if (raw) return res;
  const result=await res.json();
  if(auth&&((method==='POST'&&body?.model)||method==='GET'&&/^\/api\/v1\/videos\/[^/]+$/.test(p))){
   try{writeReceipt(result,body?.model||result.model,{id:result.id||result.data?.id})}catch{log('usage receipt could not be saved')}
  }
  return result;
}

// ---------- catalog ----------
let catalog = null; let catalogAt = 0;
const KINDS = ['text', 'image', 'video', 'decision', 'speech', 'transcription', 'embedding', 'rerank', 'audio'];
function kindsOf(m) {
  const out = new Set(m.architecture?.output_modalities || []);
  const ep = m.endpoints || [];
  const k = new Set();
  if (ep.some((e) => e.includes('/videos')) || out.has('video')) k.add('video');
  if (ep.some((e) => e.includes('/images')) || out.has('image')) k.add('image');
  if (ep.some((e) => e.includes('/decisions')) || out.has('decisions')) k.add('decision');
  if (out.has('speech')) k.add('speech');
  if (out.has('transcription')) k.add('transcription');
  if (out.has('embeddings')) k.add('embedding');
  if (out.has('rerank')) k.add('rerank');
  if (out.has('audio')) k.add('audio');
  if (out.has('text') && (ep.length === 0 || ep.some((e) => e.includes('/chat/completions')))) k.add('text');
  if (k.size === 0) k.add('text');
  return [...k];
}
async function getCatalog() {
  if (catalog && Date.now() - catalogAt < 10 * 60e3) return catalog;
  const j = await api('GET', '/api/v1/models?output_modalities=all', { auth: false, timeoutMs: 60000 });
  catalog = (j.data || []).map((m) => ({ ...m, kinds: kindsOf(m) }));
  catalogAt = Date.now();
  return catalog;
}
async function findModel(id) {
  const c = await getCatalog();
  const m = c.find((x) => x.id === id) || c.find((x) => x.canonical_slug === id);
  if (!m) {
    const near = c.filter((x) => x.id.includes(id.split('/').pop() || id)).slice(0, 5).map((x) => x.id);
    throw new UserError('Модель «' + id + '» не найдена в каталоге OpenRouter.' + (near.length ? ' Похожие: ' + near.join(', ') : ''));
  }
  return m;
}
const price = (m) => {
  const p = m.pricing || {};
  const parts = [];
  if (+p.prompt) parts.push('вход $' + (+p.prompt * 1e6).toFixed(2) + '/M');
  if (+p.completion) parts.push('выход $' + (+p.completion * 1e6).toFixed(2) + '/M');
  if (+p.image_output) parts.push('изобр. $' + (+p.image_output * 1e6).toFixed(2) + '/M');
  return parts.join(', ');
};

// ---------- files ----------
function resolveOutDir(outDir) {
  const base = process.cwd();
  const dir = outDir ? path.resolve(base, outDir) : path.join(base, 'openrouter-media');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'file'; }
function stamp() { const d = new Date(); const z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`; }
function uniquePath(dir, name, ext) {
  let p = path.join(dir, `${name}.${ext}`); let i = 2;
  while (fs.existsSync(p)) p = path.join(dir, `${name}-${i++}.${ext}`);
  return p;
}
function toImageUrl(src) {
  if (/^(https?:|data:)/i.test(src)) return src;
  const p = path.resolve(process.cwd(), src);
  if (!fs.existsSync(p)) throw new UserError('Файл не найден: ' + p);
  const ext = path.extname(p).slice(1).toLowerCase();
  const mime = MIME[ext];
  if (!mime) throw new UserError('Неподдерживаемый формат изображения: ' + p + ' (нужен png/jpg/webp/gif)');
  return `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;
}
const imagePart = (src) => ({ type: 'image_url', image_url: { url: toImageUrl(src) } });
const costLine = (u) => (u && u.cost !== undefined ? `Стоимость: $${Number(u.cost).toFixed(4)}` : '');
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined && o[k] !== null && o[k] !== '').map((k) => [k, o[k]]));

// ---------- tools ----------
const tools = {
  list_models: {
    description: 'Список моделей OpenRouter. kind: text (чат/рассуждения), image (генерация фото), video (генерация видео), decision (Decisions API: структурные ответы да/нет, выбор, оценка), speech, transcription, embedding, rerank, all. query — фильтр по подстроке id/названия.',
    inputSchema: { type: 'object', properties: {
      kind: { type: 'string', enum: ['all', ...KINDS], default: 'all' },
      query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 500, default: 60 } } },
    async run(a) {
      const kind = a.kind || 'all'; const q = (a.query || '').toLowerCase().split(/\s+/).filter(Boolean);
      let list = (await getCatalog()).filter((m) => kind === 'all' || m.kinds.includes(kind));
      if (q.length) list = list.filter((m) => q.every((t) => (m.id + ' ' + m.name).toLowerCase().includes(t)));
      list.sort((x, y) => (y.created || 0) - (x.created || 0));
      const total = list.length; list = list.slice(0, a.limit || 60);
      return `Найдено ${total} (показано ${list.length}), новые сверху:\n` +
        list.map((m) => `${m.id} — ${m.name} [${m.kinds.join(',')}]${price(m) ? ' — ' + price(m) : ''}`).join('\n');
    },
  },
  model_info: {
    description: 'Подробности о модели OpenRouter: тип, контекст, цены, поддерживаемые параметры (для фото — aspect_ratio/resolution/n…, для видео — длительности, разрешения, соотношения сторон, кадры).',
    inputSchema: { type: 'object', required: ['model'], properties: { model: { type: 'string' } } },
    async run(a) {
      const m = await findModel(a.model);
      const info = { id: m.id, name: m.name, kinds: m.kinds, context_length: m.context_length, pricing: m.pricing,
        input_modalities: m.architecture?.input_modalities, endpoints: m.endpoints, supported_parameters: m.supported_parameters,
        description: m.description };
      try {
        if (m.kinds.includes('video')) {
          const v = (await api('GET', '/api/v1/videos/models', { auth: false })).data?.find((x) => x.id === m.id);
          if (v) Object.assign(info, pick(v, ['supported_durations', 'supported_resolutions', 'supported_aspect_ratios', 'supported_sizes', 'supported_frame_images', 'generate_audio', 'seed', 'pricing_skus']));
        }
        if (m.kinds.includes('image')) {
          const v = (await api('GET', '/api/v1/images/models', { auth: false })).data?.find((x) => x.id === m.id);
          if (v) info.image_parameters = v.supported_parameters;
        }
      } catch {}
      return JSON.stringify(info, null, 1);
    },
  },
  generate_image: {
    description: 'Сгенерировать/отредактировать изображение моделью OpenRouter (kind=image) и сохранить файл(ы) в папку проекта (по умолчанию <папка проекта>/openrouter-media). Используй, когда пользователь упоминает @openrouter:<модель> с типом «фото». Возвращает пути к файлам.',
    inputSchema: { type: 'object', required: ['model', 'prompt'], properties: {
      model: { type: 'string', description: 'id модели, напр. google/gemini-3.1-flash-image' },
      prompt: { type: 'string' },
      aspect_ratio: { type: 'string', description: '1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 21:9, auto…' },
      resolution: { type: 'string', description: '512, 768, 1K, 1.5K, 2K, 4K' },
      size: { type: 'string', description: 'напр. 2K или 2048x2048 (не вместе с resolution/aspect_ratio)' },
      quality: { type: 'string', enum: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'] },
      n: { type: 'integer', minimum: 1, maximum: 10 },
      output_format: { type: 'string', enum: ['png', 'jpeg', 'webp', 'svg', 'gif'] },
      background: { type: 'string', enum: ['auto', 'transparent', 'opaque'] },
      seed: { type: 'integer' },
      input_images: { type: 'array', items: { type: 'string' }, description: 'Референсы/исходники для редактирования: локальные пути или URL (до 16)' },
      out_dir: { type: 'string', description: 'Папка для сохранения (абсолютная или относительно папки проекта)' },
      file_name: { type: 'string', description: 'Имя файла без расширения' } } },
    async run(a) {
      const m = await findModel(a.model);
      const dir = resolveOutDir(a.out_dir);
      const base = a.file_name ? slug(a.file_name) : `${stamp()}-${slug(m.id.split('/').pop())}`;
      const saved = []; let usage; let text = '';
      const viaImages = (m.endpoints || []).some((e) => e.includes('/images'));
      if (viaImages) {
        const body = { model: m.id, prompt: a.prompt, ...pick(a, ['aspect_ratio', 'resolution', 'size', 'quality', 'n', 'output_format', 'background', 'seed']) };
        if (a.input_images?.length) body.input_references = a.input_images.slice(0, 16).map(imagePart);
        const r = await api('POST', '/api/v1/images', { body, timeoutMs: 600000 });
        usage = r.usage;
        for (const d of r.data || []) {
          if (!d.b64_json) continue;
          const ext = EXT[d.media_type] || a.output_format?.replace('jpeg', 'jpg') || 'png';
          const p = uniquePath(dir, base, ext); fs.writeFileSync(p, Buffer.from(d.b64_json, 'base64')); saved.push(p);
        }
      } else if (m.kinds.includes('image')) {
        const content = [{ type: 'text', text: a.prompt }, ...(a.input_images || []).map(imagePart)];
        const body = { model: m.id, modalities: ['image', 'text'], messages: [{ role: 'user', content }] };
        const ic = pick(a, ['aspect_ratio', 'quality']); if (Object.keys(ic).length) body.image_config = ic;
        if (a.seed !== undefined) body.seed = a.seed;
        const r = await api('POST', '/api/v1/chat/completions', { body, timeoutMs: 600000 });
        usage = r.usage; const msg = r.choices?.[0]?.message || {};
        text = typeof msg.content === 'string' ? msg.content : '';
        for (const im of msg.images || []) {
          const url = im.image_url?.url || '';
          const mm = /^data:([^;]+);base64,(.*)$/s.exec(url);
          const p0 = (ext) => uniquePath(dir, base, ext);
          if (mm) { const p = p0(EXT[mm[1]] || 'png'); fs.writeFileSync(p, Buffer.from(mm[2], 'base64')); saved.push(p); }
          else if (/^https?:/.test(url)) { const res = await fetch(url); const ct = res.headers.get('content-type') || ''; const p = p0(EXT[ct.split(';')[0]] || 'png'); fs.writeFileSync(p, Buffer.from(await res.arrayBuffer())); saved.push(p); }
        }
      } else {
        throw new UserError(`Модель ${m.id} не генерирует изображения (тип: ${m.kinds.join(', ')}). Найди подходящую: list_models kind=image.`);
      }
      if (!saved.length) throw new UserError('OpenRouter не вернул изображение.' + (text ? ' Ответ модели: ' + text.slice(0, 500) : ''));
      return ['Сохранено:', ...saved, costLine(usage), text ? 'Комментарий модели: ' + text.slice(0, 1000) : ''].filter(Boolean).join('\n');
    },
  },
  generate_video: {
    description: 'Запустить генерацию видео моделью OpenRouter (kind=video; асинхронно) и сохранить mp4 в папку проекта (по умолчанию <папка проекта>/openrouter-media). Ждёт до wait_seconds; если видео ещё не готово — вернёт job_id: тогда вызывай get_video(job_id) пока статус не completed. Параметры модели смотри в model_info.',
    inputSchema: { type: 'object', required: ['model', 'prompt'], properties: {
      model: { type: 'string', description: 'id модели, напр. google/veo-3.1-fast' },
      prompt: { type: 'string' },
      duration: { type: 'integer', description: 'секунды (см. supported_durations)' },
      resolution: { type: 'string', description: '360p, 480p, 720p, 768p, 1080p, 1K, 2K, 4K' },
      aspect_ratio: { type: 'string', description: '16:9, 9:16, 1:1, 4:3, 3:4, 3:2, 2:3, 21:9, 9:21' },
      size: { type: 'string', description: 'WIDTHxHEIGHT' },
      first_frame: { type: 'string', description: 'Первый кадр: локальный путь или URL (image-to-video)' },
      last_frame: { type: 'string', description: 'Последний кадр: путь или URL' },
      reference_images: { type: 'array', items: { type: 'string' }, description: 'Референсы (пути/URL)' },
      generate_audio: { type: 'boolean' }, seed: { type: 'integer' },
      wait_seconds: { type: 'integer', minimum: 0, maximum: 1800, default: 45, description: 'Сколько ждать готовности в этом вызове' },
      out_dir: { type: 'string' }, file_name: { type: 'string' } } },
    async run(a) {
      const m = await findModel(a.model);
      if (!m.kinds.includes('video')) throw new UserError(`Модель ${m.id} не генерирует видео. Найди подходящую: list_models kind=video.`);
      const body = { model: m.id, prompt: a.prompt, ...pick(a, ['duration', 'resolution', 'aspect_ratio', 'size', 'generate_audio', 'seed']) };
      const frames = [];
      if (a.first_frame) frames.push({ ...imagePart(a.first_frame), frame_type: 'first_frame' });
      if (a.last_frame) frames.push({ ...imagePart(a.last_frame), frame_type: 'last_frame' });
      if (frames.length) body.frame_images = frames;
      if (a.reference_images?.length) body.input_references = a.reference_images.map(imagePart);
      const job = await api('POST', '/api/v1/videos', { body });
      return pollVideo(job.id, a, m.id);
    },
  },
  get_video: {
    description: 'Проверить/дождаться задачу генерации видео OpenRouter по job_id и скачать результат в папку проекта.',
    inputSchema: { type: 'object', required: ['job_id'], properties: {
      job_id: { type: 'string' }, wait_seconds: { type: 'integer', minimum: 0, maximum: 1800, default: 45 },
      out_dir: { type: 'string' }, file_name: { type: 'string' } } },
    async run(a) { return pollVideo(a.job_id, a, ''); },
  },
  decide: {
    description: 'Decisions API OpenRouter (модели kind=decision, напр. google/gemini-decision-1, ~perplexity/pplx-decider-latest): структурные ответы по входному состоянию. questions — объект {имя: вопрос}; типы: {"type":"noul","criteria":{"true":"…","false":"…"}} (да/нет, ответ — вероятность), {"type":"choice","criteria":{"вариант":"когда выбирать"}}, {"type":"score","criteria":["низко…","…высоко"]}, {"type":"box","instructions":"что найти"} (только TypeSafe Jev). Изображения: assets {ключ: путь}, ссылайся на ключ в state/criteria.',
    inputSchema: { type: 'object', required: ['model', 'state', 'questions'], properties: {
      model: { type: 'string' },
      state: { description: 'Входное состояние: строка, объект или массив' },
      questions: { type: 'object', additionalProperties: { type: 'object' } },
      assets: { type: 'object', additionalProperties: { type: 'string' }, description: '{ключ: путь к png/jpg}' } } },
    async run(a) {
      const m = await findModel(a.model);
      if (!m.kinds.includes('decision')) throw new UserError(`Модель ${m.id} не поддерживает Decisions API. Найди подходящую: list_models kind=decision.`);
      const body = { model: m.id, state: a.state, questions: a.questions };
      if (a.assets && Object.keys(a.assets).length) {
        body.assets = {};
        for (const [k, p] of Object.entries(a.assets)) {
          const abs = path.resolve(process.cwd(), p); const ext = path.extname(abs).slice(1).toLowerCase();
          if (!['png', 'jpg', 'jpeg'].includes(ext)) throw new UserError('assets: нужен png/jpg — ' + abs);
          body.assets[k] = { type: 'image', format: ext, data_base64: fs.readFileSync(abs).toString('base64') };
        }
      }
      const r = await api('POST', '/api/alpha/decisions', { body });
      return JSON.stringify({ model: r.model, provider: r.provider, answers: r.answers, cost: r.usage?.cost }, null, 1);
    },
  },
  chat_once: {
    description: 'Один запрос к текстовой модели OpenRouter (kind=text, в т.ч. рассуждающие модели) — «спросить другую модель». Используй, когда пользователь упоминает @openrouter:<модель> с типом «текст». Возвращает ответ модели.',
    inputSchema: { type: 'object', required: ['model', 'prompt'], properties: {
      model: { type: 'string' }, prompt: { type: 'string' }, system: { type: 'string' },
      images: { type: 'array', items: { type: 'string' }, description: 'Пути/URL изображений для мультимодальных моделей' },
      max_tokens: { type: 'integer' }, temperature: { type: 'number' },
      reasoning_effort: { type: 'string', enum: ['minimal', 'low', 'medium', 'high', 'xhigh'] } } },
    async run(a) {
      const m = await findModel(a.model);
      const content = a.images?.length ? [{ type: 'text', text: a.prompt }, ...a.images.map(imagePart)] : a.prompt;
      const messages = [...(a.system ? [{ role: 'system', content: a.system }] : []), { role: 'user', content }];
      const body = { model: m.id, messages, ...pick(a, ['max_tokens', 'temperature']) };
      if (a.reasoning_effort) body.reasoning = { effort: a.reasoning_effort };
      const r = await api('POST', '/api/v1/chat/completions', { body, timeoutMs: 600000 });
      const msg = r.choices?.[0]?.message || {};
      const out = typeof msg.content === 'string' ? msg.content : (msg.content || []).map((c) => c.text || '').join('');
      return `${out || '(пустой ответ)'}\n\n— ${r.model || m.id}${r.usage ? `, токены ${r.usage.prompt_tokens}/${r.usage.completion_tokens}` : ''}${r.usage?.cost !== undefined ? `, $${Number(r.usage.cost).toFixed(4)}` : ''}`;
    },
  },
};

async function pollVideo(id, a, modelId) {
  const until = Date.now() + Math.max(0, a.wait_seconds ?? 45) * 1000;
  let st;
  for (;;) {
    st = await api('GET', '/api/v1/videos/' + encodeURIComponent(id));
    if (['completed', 'failed', 'cancelled', 'expired'].includes(st.status) || Date.now() >= until) break;
    await new Promise((r) => setTimeout(r, Math.min(10000, Math.max(1000, until - Date.now()))));
  }
  if (st.status === 'completed') {
    const dir = resolveOutDir(a.out_dir);
    const n = Math.max(1, (st.unsigned_urls || st.urls || []).length);
    const base = a.file_name ? slug(a.file_name) : `${stamp()}-${slug((modelId || st.model || 'video').split('/').pop())}`;
    const saved = [];
    for (let i = 0; i < n; i++) {
      const res = await api('GET', `/api/v1/videos/${encodeURIComponent(id)}/content?index=${i}`, { raw: true, timeoutMs: 600000 });
      const ext = EXT[(res.headers.get('content-type') || '').split(';')[0]] || 'mp4';
      const p = uniquePath(dir, base, ext); fs.writeFileSync(p, Buffer.from(await res.arrayBuffer())); saved.push(p);
    }
    return ['Видео готово. Сохранено:', ...saved, costLine(st.usage)].filter(Boolean).join('\n');
  }
  if (['failed', 'cancelled', 'expired'].includes(st.status)) {
    throw new UserError(`Генерация видео: ${st.status}${st.error ? ' — ' + (st.error.message || JSON.stringify(st.error)) : ''}`);
  }
  return `Видео ещё генерируется (статус: ${st.status}). job_id: ${id}\nВызови get_video с job_id="${id}" (wait_seconds до 45–120), пока не будет completed.`;
}

Object.assign(tools,audioTools({api,findModel,resolveOutDir,uniquePath,slug,stamp,UserError,writeReceipt}));

// ---------- MCP stdio (JSON-RPC 2.0, newline-delimited) ----------
const PROTOCOLS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];
const INSTRUCTIONS = 'Сервер OpenRouter для T3 Code. Пользователь отмечает модели в сообщении как «@openrouter:<id модели>» ' +
  '(напр. @openrouter:google/veo-3.1-fast). Для фото-моделей вызывай generate_image, для видео — generate_video (затем get_video), ' +
  'для decision-моделей — decide, для текстовых — chat_once. Для speech — generate_speech, transcription — transcribe_audio, audio — generate_audio. Файлы сохраняются в папку проекта (openrouter-media), ' +
  'передавай out_dir = корень текущего проекта, если рабочая папка сервера может отличаться. Параметры модели — model_info.';
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
async function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => id !== undefined && send({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => id !== undefined && send({ jsonrpc: '2.0', id, error: { code, message } });
  switch (method) {
    case 'initialize': {
      const want = params?.protocolVersion;
      return reply({ protocolVersion: PROTOCOLS.includes(want) ? want : '2025-06-18', capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'openrouter', title: 'OpenRouter', version: VERSION }, instructions: INSTRUCTIONS });
    }
    case 'ping': return reply({});
    case 'tools/list':
      return reply({ tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) });
    case 'tools/call': {
      const t = tools[params?.name];
      if (!t) return fail(-32602, 'Unknown tool: ' + params?.name);
      try {
        const text = await t.run(params.arguments || {});
        return reply({ content: [{ type: 'text', text }] });
      } catch (e) {
        if (!(e instanceof UserError)) log('tool error', params.name, e && e.stack ? e.stack.split('\n')[0] : String(e));
        return reply({ content: [{ type: 'text', text: 'Ошибка: ' + (e?.message || String(e)) }], isError: true });
      }
    }
    default:
      if (method?.startsWith('notifications/')) return;
      return fail(-32601, 'Method not found: ' + method);
  }
}

if (process.argv.includes('--check')) {
  // Setup check: reads the key (without printing it) and asks OpenRouter about it.
  try {
    const r = await api('GET', '/api/v1/key');
    const d = r.data || {};
    console.log('OK: ключ OpenRouter работает' + (d.limit_remaining != null ? `; остаток лимита: $${d.limit_remaining}` : '') + (d.usage != null ? `; потрачено: $${d.usage}` : ''));
  } catch (e) { console.log('Ошибка: ' + e.message); process.exitCode = 1; }
} else {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
      Promise.resolve(handle(msg)).catch((e) => log('handler', String(e)));
    }
  });
  process.stdin.on('end', () => process.exit(0));
}
