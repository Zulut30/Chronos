"use strict";
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { session } = require("./session.cjs");

exports.attach = function attach({
  win,
  root,
  binary,
  model,
  dialog,
  shell,
  trusted,
}) {
  const {
    store,
    check,
    profile,
    profileId,
    initial,
    revision,
    grantKey,
    mapped,
    osAction,
    signalPattern,
  } = model;
  const db = store(root);
  let config = db.state();
  let current = db.load(config.active);
  let editing = false,
    learning = null,
    last = null,
    statusError = "",
    busy = false,
    timer = null,
    closed = false;
  let found = [];
  const notify = (type, data) => {
    if (!closed && trusted())
      win.webContents.send("chronos:keyboard-event", { type, data });
  };
  const focused = () => !closed && win.isFocused() && trusted();
  const hwnd = win.getNativeWindowHandle();
  const owner = (
    hwnd.length === 8 ? hwnd.readBigUInt64LE() : hwnd.readUInt32LE()
  ).toString();
  const options = { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] };
  const listener = session(
    (device) => spawn(binary, ["listen", device, owner], options),
    (signal) => {
      if (!focused() || !config.enabled || !signalPattern.test(signal) || busy)
        return;
      if (editing) {
        last = signal;
        if (learning) {
          const slot = learning;
          learning = null;
          try {
            const next = profile({
              ...current,
              bindings: {
                ...current.bindings,
                [slot]: { ...current.bindings[slot], signal },
              },
            });
            db.save(next);
            current = next;
            notify("learned", slot);
          } catch (err) {
            notify("error", err.message);
          }
        }
        notify("signal", signal);
        return;
      }
      const a = mapped(current, signal, config.grants);
      if (!a) return;
      if (a.id === "url")
        void shell
          .openExternal(a.arg)
          .catch((err) => notify("error", err.message));
      else if (a.id === "program") {
        const proc = spawn(a.arg, [], {
          shell: false,
          detached: true,
          stdio: "ignore",
        });
        proc.on("error", (err) => notify("error", err.message));
        proc.unref();
      } else if (osAction(a.id)) listener.command(a.id);
      else notify("action", a);
    },
    (state) => notify("status", state),
  );
  const sync = () => listener.sync(config.enabled, config.device, focused());
  function changeDevices() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (closed || !config.enabled || !focused()) return;
      // Re-enumerate the collections together; Windows may replace some handles on replug.
      listener.stop("waiting");
      sync();
      notify("devices", null);
    }, 300);
  }
  const message = 0x219;
  let hooked = false;
  function hook() {
    if (config.enabled && !hooked) {
      win.hookWindowMessage(message, (wp) => {
        if (wp.readUInt32LE() === 7) changeDevices();
      });
      win.on("focus", sync);
      win.on("blur", blur);
      hooked = true;
    } else if (!config.enabled && hooked) unhook();
  }
  function unhook() {
    clearTimeout(timer);
    timer = null;
    win.removeListener("focus", sync);
    win.removeListener("blur", blur);
    if (hooked && !win.isDestroyed()) win.unhookWindowMessage(message);
    hooked = false;
  }
  function blur() {
    learning = null;
    listener.stop("waiting");
  }
  const resetDocument = () => {
    editing = false;
    learning = null;
    listener.stop();
  };
  win.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) resetDocument();
  });
  win.webContents.on("render-process-gone", resetDocument);
  win.webContents.on("did-finish-load", sync);
  win.once("closed", () => {
    closed = true;
    unhook();
    listener.stop();
  });
  async function devices() {
    found = config.enabled
      ? (
          await promisify(execFile)(binary, ["list"], {
            windowsHide: true,
            timeout: 4000,
          })
        ).stdout
          .trim()
          .split(/\s+/)
          .filter((s) => /^[a-f0-9]{64}$/.test(s))
      : [];
  }
  function snapshot() {
    return {
      enabled: config.enabled,
      device: config.device,
      devices: found,
      profiles: db.names(),
      current,
      revision: revision(current),
      actions: model.actions,
      status: listener.status(),
      last,
      learning,
      error: statusError,
    };
  }
  async function save(p, base) {
    check(
      base === revision(current) && p.id === current.id,
      "Профиль изменился. Обновите раскладку.",
    );
    const next = profile(p);
    const grants = [];
    const previous = new Set(config.grants);
    const confirm = [];
    for (const [slot, b] of Object.entries(next.bindings)) {
      if (!b.action || !osAction(b.action.id)) continue;
      const key = grantKey(next, slot, b.action);
      grants.push(key);
      if (!previous.has(key))
        confirm.push(
          slot +
            " — " +
            model.actions[b.action.id] +
            (b.action.arg ? "\n" + b.action.arg : ""),
        );
    }
    if (confirm.length) {
      const { response } = await dialog.showMessageBox(win, {
        type: "question",
        buttons: ["Отмена", "Разрешить назначение"],
        defaultId: 0,
        cancelId: 0,
        message: "Разрешить эти действия Windows?",
        detail: confirm.join("\n\n"),
      });
      check(response === 1 && !closed && trusted(), "Назначение отменено.");
    }
    // Commit grants first. A crash cannot authorize a different command or parameter.
    const other = config.grants.filter(
      (g) => !g.startsWith("[" + JSON.stringify(next.id) + ","),
    );
    const updated = { ...config, grants: [...other, ...grants] };
    db.configure(updated);
    config = updated;
    db.save(next);
    current = next;
  }
  async function request(op, payload = {}) {
    if (op === "close") {
      editing = false;
      learning = null;
      return null;
    }
    if (op === "open") {
      editing = true;
      learning = null;
    }
    check(editing && trusted(), "Откройте настройки клавиатуры.");
    if (op === "snapshot") return snapshot();
    check(!busy, "Дождитесь завершения предыдущего действия.");
    busy = true;
    try {
      statusError = "";
      switch (op) {
        case "open":
        case "refresh":
          await devices();
          break;
        case "enable":
        case "device":
        case "activate": {
          let next = { ...config };
          if (op === "enable") {
            check(typeof payload === "boolean", "Некорректное состояние.");
            next.enabled = payload;
          }
          if (op === "device") {
            await devices();
            check(found.includes(payload), "Устройство отключено.");
            next.device = payload;
          }
          if (op === "activate") {
            next.active = profileId(payload);
            db.load(next.active);
          }
          db.configure(next);
          config = next;
          current = db.load(config.active);
          learning = null;
          last = null;
          listener.stop();
          hook();
          sync();
          if (op === "enable") await devices();
          break;
        }
        case "create": {
          const id = "p-" + require("node:crypto").randomUUID();
          const p = profile({ ...initial(), id, name: payload });
          db.save(p);
          db.configure({ ...config, active: id });
          config = db.state();
          current = p;
          learning = null;
          last = null;
          break;
        }
        case "learn":
          check(
            listener.status() === "ready" && model.slots.includes(payload),
            "Подключите выбранный макропад.",
          );
          learning = payload;
          break;
        case "cancel":
          learning = null;
          break;
        case "save":
          await save(payload.profile, payload.base);
          break;
        case "proposal": {
          const proposal = model.read(model.pendingFile(db), null);
          check(proposal, "Нет предложений ИИ.");
          const p = profile(proposal.profile);
          check(
            p.id === current.id && proposal.base === revision(current),
            "Предложение устарело или относится к другому профилю.",
          );
          return { profile: p, base: proposal.base };
        }
        default:
          throw new Error("Неизвестная операция.");
      }
      return snapshot();
    } finally {
      busy = false;
    }
  }
  hook();
  sync();
  return request;
};
