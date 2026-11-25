"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const slots = [
  ...Array.from({ length: 9 }, (_, i) => "key" + (i + 1)),
  ...["upper", "lower"].flatMap((knob) =>
    ["left", "press", "right"].map((move) => knob + "-" + move),
  ),
];
const actions = {
  draft: "Новый черновик с моделью",
  approve: "Одобрить один запрос",
  decline: "Отклонить запрос",
  model: "Выбрать модель",
  mode: "Выбрать режим ответа",
  next: "Следующий тред",
  previous: "Предыдущий тред",
  "scroll-up": "Прокрутить вверх",
  "scroll-down": "Прокрутить вниз",
  voice: "Начать или завершить голосовой ввод",
  tasks: "Открыть доску задач",
  stop: "Остановить активных агентов",
  "volume-up": "Увеличить громкость",
  "volume-down": "Уменьшить громкость",
  "volume-mute": "Выключить или вернуть звук",
  "media-play": "Воспроизведение или пауза",
  "media-next": "Следующая дорожка",
  "media-previous": "Предыдущая дорожка",
  program: "Запустить программу",
  url: "Открыть ссылку",
};
const osAction = (id) =>
  /^(?:volume-|media-)/.test(id) || id === "program" || id === "url";
function positionName(slot) {
  if (slot.startsWith("key")) return "Клавиша " + slot.slice(3);
  const [knob, move] = slot.split("-");
  return (knob === "upper" ? "Верхняя ручка" : "Нижняя ручка") + " · " +
    ({left: "влево", right: "вправо", press: "нажатие"})[move];
}
function check(condition, message) {
  if (!condition) throw new Error(message);
}
function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function profileId(id) {
  check(
    typeof id === "string" &&
      /^[a-z0-9][a-z0-9-]{0,47}$/.test(id) &&
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id),
    "Недопустимое имя файла профиля.",
  );
  return id;
}
function action(value) {
  check(
    plain(value) &&
      typeof value.id === "string" &&
      Object.hasOwn(actions, value.id),
    "Неизвестное действие.",
  );
  const id = value.id;
  const arg = value.arg ?? "";
  check(
    typeof arg === "string" && arg.length <= 2048 && !/[\x00-\x1f]/.test(arg),
    "Некорректный параметр.",
  );
  if (id === "url") {
    const url = URL.canParse(arg) ? new URL(arg) : null;
    check(
      url && ["https:", "http:"].includes(url.protocol) &&
        !url.username &&
        !url.password,
      "Нужна ссылка HTTP или HTTPS.",
    );
    return { id, arg: url.href };
  }
  if (id === "program") {
    check(
      /^[a-z]:\\[^:*?"<>|/]+\.exe$/i.test(arg),
      "Укажи полный локальный путь к файлу .exe без аргументов.",
    );
    return { id, arg: path.win32.normalize(arg) };
  }
  if (id === "draft") return { id, arg: arg.trim() };
  check(!arg, "Действие не принимает параметров.");
  return { id };
}
const signalPattern =
  /^mi_(?:01|00-col0[123]):(?:key-[a-f0-9]{1,4}-[0246]-[a-f0-9]{1,4}|h?wheel-(?:up|down)|button-[0-4]|consumer-[a-f0-9]{1,4})$/;
function profile(p) {
  check(
    plain(p) && (p.version === 1 || p.version === 2),
    "Неизвестная версия профиля.",
  );
  check(
    typeof p.name === "string" && !!p.name.trim() && p.name.length <= 80,
    "Введите название профиля (до 80 знаков).",
  );
  const bindings = {};
  const seen = new Map();
  check(plain(p.bindings), "Повреждены назначения профиля.");
  for (const [slot, binding] of Object.entries(p.bindings)) {
    check(slots.includes(slot) && plain(binding), "Неизвестная позиция.");
    const signal = binding.signal ?? null;
    check(
      signal === null ||
        (typeof signal === "string" && signalPattern.test(signal)),
      "Неизвестный формат сигнала.",
    );
    if (signal !== null) {
      if (seen.has(signal))
        throw Error("Один сигнал у двух позиций: «" + positionName(seen.get(signal)) + "» и «" + positionName(slot) + "».");
      seen.set(signal, slot);
    }
    const a =
      p.version === 1 && typeof binding.action === "string"
        ? { id: binding.action }
        : binding.action;
    bindings[slot] = { signal, action: a == null ? null : action(a) };
  }
  return { version: 2, id: profileId(p.id), name: p.name.trim(), bindings };
}
const initial = () =>
  profile({ version: 2, id: "default", name: "Основной", bindings: {} });
function read(file, fallback) {
  try {
    check(fs.statSync(file).size <= 128 * 1024, "Файл слишком большой.");
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + "." + crypto.randomUUID() + ".tmp";
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}
const revision = (p) =>
  crypto.createHash("sha256").update(JSON.stringify(p)).digest("hex");
function store(root) {
  const dir = path.join(root, "userdata", "keyboard");
  const file = (id) => path.join(dir, "profiles", profileId(id) + ".json");
  const state = () => {
    const s = read(path.join(dir, "settings.json"), {});
    return {
      enabled: s.enabled === true,
      active: profileId(s.active ?? "default"),
      device:
        typeof s.device === "string" && /^[a-f0-9]{64}$/.test(s.device)
          ? s.device
          : null,
      grants: Array.isArray(s.grants)
        ? s.grants.filter((x) => typeof x === "string")
        : [],
    };
  };
  function load(id) {
    const p = profile(read(file(id), id === "default" ? initial() : null));
    check(p.id === id, "Имя файла и профиль не совпадают.");
    return p;
  }
  function names() {
    const folder = path.join(dir, "profiles");
    const ids = new Set(["default"]);
    if (fs.existsSync(folder))
      for (const f of fs.readdirSync(folder))
        if (f.endsWith(".json")) ids.add(profileId(f.slice(0, -5)));
    return [...ids].map((id) => ({ id, name: load(id).name }));
  }
  return {
    state,
    load,
    names,
    dir,
    save: (p) => write(file(p.id), profile(p)),
    remove: (id) => fs.unlinkSync(file(id)),
    configure: (s) => write(path.join(dir, "settings.json"), s),
  };
}
const pendingFile = (db) => path.join(db.dir, "proposal.json");
function plan(db, changes) {
  const current = db.load(db.state().active);
  check(
    plain(changes) && Object.keys(changes).length > 0,
    "Нужны назначения по позициям.",
  );
  const draft = structuredClone(current);
  for (const [slot, a] of Object.entries(changes)) {
    check(slots.includes(slot), "Неизвестная позиция.");
    draft.bindings[slot] = {
      signal: current.bindings[slot]?.signal ?? null,
      action: a === null ? null : action(a),
    };
  }
  return { base: revision(current), profile: profile(draft) };
}
function grantKey(p, slot, a) {
  return JSON.stringify([p.id, slot, a.id, a.arg ?? ""]);
}
function mapped(p, signal, grants) {
  const binding = Object.entries(p.bindings).find(
    ([, b]) => b.signal === signal,
  );
  if (!binding || !binding[1].action) return null;
  const [slot, { action: a }] = binding;
  if (osAction(a.id) && !grants.includes(grantKey(p, slot, a))) return null;
  const native = {
    "volume-up": ["consumer-e9", "af"],
    "volume-down": ["consumer-ea", "ae"],
    "volume-mute": ["consumer-e2", "ad"],
    "media-play": ["consumer-cd", "b3"],
    "media-next": ["consumer-b5", "b0"],
    "media-previous": ["consumer-b6", "b1"],
  }[a.id];
  const code = signal.split(":")[1];
  if (
    native &&
    (code === native[0] ||
      (code.startsWith("key-") && code.endsWith("-" + native[1])))
  )
    return null;
  return a;
}
module.exports = {
  slots,
  positionName,
  actions,
  osAction,
  check,
  action,
  profile,
  profileId,
  initial,
  store,
  revision,
  signalPattern,
  pendingFile,
  read,
  write,
  plan,
  grantKey,
  mapped,
};
