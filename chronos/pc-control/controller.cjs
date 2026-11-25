const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { makeNative } = require("./native.cjs");

const defaults = { enabled: false, all: false, apps: [], mode: "risk" };
const operations = ["open","attach","snapshot","save","expand","click","fill","close"];
const hotkey = "CommandOrControl+Alt+Shift+F12";
function policy(input) {
  if (typeof input?.enabled !== "boolean" || typeof input.all !== "boolean" ||
      !["every","risk","none"].includes(input.mode) || !Array.isArray(input.apps) || input.apps.length > 100 ||
      !input.apps.every(app => typeof app === "string" && app.trim().length > 0 && app.length <= 512 && !/[\x00-\x1f]/.test(app))) {
    throw new Error("Проверьте параметры управления ПК.");
  }
  return { enabled: input.enabled, all: input.all, mode: input.mode, apps: [...new Set(input.apps.map(app => app.trim()))] };
}
function destination(kind, target) {
  if (typeof target !== "string" || !target || target.length > 2048) throw new Error("Требуется приложение или адрес.");
  if (kind === "web") {
    const url = new URL(target);
    if (!["https:","http:"].includes(url.protocol) || url.username || url.password) throw new Error("Нужен адрес HTTP или HTTPS без учётных данных.");
    return { target: url.origin, host: url.hostname };
  }
  if (kind !== "desktop" || target.startsWith("-") || /[\x00-\x1f]/.test(target)) throw new Error("Недопустимое приложение.");
  if (process.platform === "win32" && (!/\.exe$/i.test(target) || (!/^[\w .-]+\.exe$/i.test(target) && !/^[A-Za-z]:\\/.test(target)) ||
      /(?:^|[\\/])\.\.(?:$|[\\/])/.test(target))) throw new Error("Укажите имя программы из System32 или полный путь к EXE.");
  return { target };
}
function createController({ dir, tools, socket, key, shortcut, notify, native = makeNative(tools, path.join(dir,"sessions")) }) {
  fs.mkdirSync(dir,{ recursive:true, mode:0o700 });
  const settingsFile = path.join(dir,"policy.json");
  const logFile = path.join(dir,"history.json");
  function read(file, fallback) { try { return JSON.parse(fs.readFileSync(file,"utf8")); } catch { return fallback; } }
  function save(file, value) {
    fs.writeFileSync(file + ".tmp",JSON.stringify(value),{ mode:0o600 });
    fs.renameSync(file + ".tmp",file);
  }
  let settings = { ...defaults };
  let history = read(logFile,[]);
  if (!Array.isArray(history)) history = [];
  let server, registered = false, configuring = false;
  const sessions = new Map(), pending = new Map(), active = new Set(), connections = new Set();
  const activeState = () => active.size > 0;
  function changed() { notify(); }
  function state() {
    return { settings, active: activeState(), history, pending: [...pending.values()].map(p => p.public) };
  }
  function record(op, status) {
    // No application/window titles, hosts, refs, URIs, values, stdout or errors in the journal.
    history = [...history.slice(-99), { time: Date.now(), op, status }];
    try { save(logFile,history); } catch { /* keep the bounded in-memory journal if storage is full */ }
    changed();
  }
  function approve(meta, signal) {
    return new Promise((resolve,reject) => {
      const id = randomUUID();
      const finish = (allowed, text) => {
        clearTimeout(timer);
        signal.removeEventListener("abort",cancel);
        pending.delete(id);
        changed();
        if (!allowed) reject(new Error("Действие отменено."));
        else if (meta.manual && (typeof text !== "string" || text.length === 0 || text.length > 16000)) reject(new Error("Введите значение в Chronos."));
        else resolve(text);
      };
      const cancel = () => finish(false);
      const timer = setTimeout(cancel, 120000).unref();
      signal.addEventListener("abort",cancel,{ once:true });
      pending.set(id,{ public:{ id,...meta }, finish });
      changed();
    });
  }
  async function release(s) {
    if (s.released) return;
    s.released = true;
    clearTimeout(s.timer);
    sessions.delete(s.id);
    if (s.kind === "web" && s.opened) {
      try { await native(s,"close",{},AbortSignal.timeout(8000)); } catch { /* native idle deadline remains in force */ }
    }
    if (s.owner) s.owner.stdin.end();
    if (/^[a-f0-9-]{36}$/.test(s.id)) {
      void fs.promises.rm(path.join(dir,"sessions",s.id),{ recursive:true, force:true, maxRetries:3 }).catch(() => {});
    }
  }
  function renew(s) {
    clearTimeout(s.timer);
    if (s.owner) return; // A private document can contain unsaved edits.
    s.timer = setTimeout(() => { if (!s.busy) void release(s); }, 120000).unref();
  }
  function allowed(target) {
    const normalize = text => process.platform === "win32" ? text.toLowerCase() : text;
    return settings.all || settings.apps.some(app => normalize(app) === normalize(target));
  }
  async function perform(q, signal) {
    if (!settings.enabled || signal.aborted) throw new Error("Управление ПК выключено.");
    if (!q || !operations.includes(q.op)) throw new Error("Неизвестное действие.");
    const { op } = q;
    const opening = op === "open" || op === "attach";
    let s;
    if (opening) {
      if (op === "attach" && q.kind !== "desktop") throw new Error("Можно подключить только приложение.");
      if (sessions.size >= 12) throw new Error("Закройте одну из сессий.");
      const target = destination(q.kind,q.target);
      s = { ...target, kind:q.kind, id:randomUUID(), app:process.platform === "win32" ? path.basename(target.target) : target.target,
        private:op === "open", refs:new Map() };
      // A running image name cannot authenticate the path of an arbitrary Windows executable.
      if (op === "attach" && process.platform === "win32" && path.isAbsolute(s.target)) throw new Error("Для подключения укажите имя уже открытого приложения.");
    } else {
      s = sessions.get(q.session);
      if (!s || s.busy) throw new Error("Сессия завершена или выполняет действие.");
    }
    if (!allowed(s.target)) throw new Error("Приложение или сайт отсутствует в разрешённом списке.");
    s.busy = true;
    sessions.set(s.id,s);
    try {
      let field, value;
      if (op === "click" || op === "expand" || op === "fill") {
        field = s.refs.get(q.ref);
        if (!field) throw new Error("Сделайте новый снимок и выберите элемент по ссылке.");
      }
      if (op === "fill" && q.value !== undefined && (typeof q.value !== "string" || q.value.length > 16000)) throw new Error("Недопустимое значение.");
      if (q.window !== undefined && (typeof q.window !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(q.window))) throw new Error("Недопустимое окно.");
      if (op === "expand" && s.kind !== "desktop") throw new Error("Это действие доступно только в приложении.");
      const navigation = s.kind === "web" && op === "open" && new URL(q.target).href !== s.target + "/";
      if (op === "save" && !s.document) throw new Error("Нет открытого временного документа.");
      const risk = op === "save" || navigation || op === "fill" || op === "click" || (op === "close" && s.kind === "desktop" && s.private);
      const protectedField = op === "fill" && (s.kind === "web" ? await native(s,"field",{ref:q.ref},signal) : field.secure !== false);
      const manual = op === "fill" && (protectedField || q.value === undefined || /парол|password|passcode|pin|cvv|карт|card|iban/i.test(field.name));
      if (risk || settings.mode === "every" || (settings.mode === "risk" && opening)) {
        const supplied = await approve({ op, target:navigation ? q.target : s.target, label:field?.name ?? "", manual,
          ...(op === "fill" && !manual ? { proposal:q.value } : {}) },signal);
        value = manual ? supplied : q.value;
      }
      if (signal.aborted || !settings.enabled || !allowed(s.target)) throw new Error("Действие остановлено.");
      if (opening) {
        if (op === "open") {
          // Schedule cleanup even if the native open partially succeeds.
          s.opened = true;
          await native(s,op,q,signal);
        }
        if (signal.aborted) throw new Error("Действие остановлено.");
        return { session:s.id, ...(s.document ? {document:s.document} : {}) };
      }
      if (op === "close") { await release(s); return {}; }
      if (op === "snapshot") {
        s.refs.clear();
        const fields = await native(s,op,q,signal);
        if (signal.aborted) throw new Error("Действие остановлено.");
        for (const field of fields.slice(0,2000)) s.refs.set(field.ref,field);
        return { elements: [...s.refs.values()].map(({ref,name,role}) => ({ref,name,role})) };
      }
      s.refs.clear();
      if (op === "fill" && s.kind === "web" && !manual && await native(s,"field",{ref:q.ref},signal)) throw new Error("Поле изменилось. Сделайте новый снимок.");
      await native(s,op,{ref:q.ref,value},signal);
      return {};
    } catch (error) {
      if (opening) await release(s);
      throw error;
    } finally {
      s.busy = false;
      if (sessions.has(s.id)) renew(s);
    }
  }
  function accept(client) {
    if (connections.size >= 24) { client.destroy(); return; }
    connections.add(client);
    const task = new AbortController();
    client.setTimeout(150000,() => client.destroy());
    client.once("close",() => { connections.delete(client); task.abort(); });
    client.on("error",() => {});
    client.setEncoding("utf8");
    let buffer = "";
    function onData(part) {
      buffer += part;
      if (buffer.length > 64000) { client.destroy(); return; }
      if (!buffer.includes("\n")) return;
      client.removeListener("data",onData);
      let message;
      try { message = JSON.parse(buffer.trim()); } catch { client.destroy(); return; }
      if (message.key !== key || !settings.enabled) { client.destroy(); return; }
      active.add(task); changed();
      const op = operations.includes(message.request?.op) ? message.request.op : "unknown";
      perform(message.request,task.signal)
        .then(data => { record(op,"ok"); client.end(JSON.stringify({ok:true,...data})+"\n"); })
        .catch(err => { record(op,"failed"); client.end(JSON.stringify({ok:false,error:err.message})+"\n"); })
        .finally(() => { active.delete(task); changed(); });
    }
    client.on("data",onData);
  }
  function stop() {
    settings = { ...settings, enabled:false };
    for (const task of active) task.abort();
    for (const client of connections) client.destroy();
    for (const s of sessions.values()) void release(s);
    if (server) { server.close(); server = undefined; }
    if (registered) { shortcut.unregister(hotkey); registered = false; }
    changed();
  }
  async function configure(input) {
    const next = policy(input);
    if (configuring) throw new Error("Настройки уже меняются.");
    configuring = true;
    try {
      stop();
      if (next.enabled) {
        registered = shortcut.register(hotkey,emergency);
        if (!registered) throw new Error("Не удалось зарегистрировать сочетание аварийной остановки.");
        const listener = net.createServer(accept);
        server = listener;
        await new Promise((resolve,reject) => { listener.once("error",reject); listener.listen(socket,resolve); });
        if (server !== listener) throw new Error("Включение отменено.");
      }
      save(settingsFile,next);
      settings = next;
      changed();
    } catch (err) { stop(); save(settingsFile,settings); throw err; }
    finally { configuring = false; }
  }
  function emergency() {
    stop();
    save(settingsFile,settings);
    record("stop","ok");
  }
  return {
    state, stop,
    async restore() {
      const prior = read(settingsFile,defaults);
      try { if (policy(prior).enabled) await configure(prior); else settings = policy(prior); }
      catch { stop(); }
    },
    async ui(input) {
      if (input?.op === "configure") await configure(input.settings);
      else if (input?.op === "decide") pending.get(input.id)?.finish(input.allow === true,input.value);
      else if (input?.op === "stop") emergency();
      else if (input?.op !== "state") throw new Error("Неизвестное действие настроек.");
      return state();
    },
  };
}
module.exports = { createController };
