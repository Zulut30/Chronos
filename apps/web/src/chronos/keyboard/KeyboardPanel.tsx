import { useEffect, useState } from "react";
import type { KeyboardProfile, KeyboardSnapshot } from "@t3tools/contracts";
import {
  SettingsPageContainer,
  SettingsSection,
} from "../../components/settings/settingsLayout";
import { Button } from "../../components/ui/button";

const keys = Array.from({ length: 9 }, (_, i) => "key" + (i + 1));
const knobs = ["upper", "lower"];
const moves = ["left", "press", "right"];
const moveNames: Record<string, string> = {
  left: "Влево",
  press: "Нажать",
  right: "Вправо",
};
function label(slot: string) {
  if (slot.startsWith("key")) return "Клавиша " + slot.slice(3);
  const [knob, move] = slot.split("-");
  return (
    (knob === "upper" ? "Верхняя ручка" : "Нижняя ручка") +
    " · " +
    moveNames[move ?? ""]
  );
}
const states: Record<string, string> = {
  off: "Выключено",
  waiting: "Ожидание устройства",
  connecting: "Подключение…",
  ready: "Подключено",
  absent: "Устройство отключено",
  error: "Ошибка слушателя",
};
const field =
  "rounded-md border border-border bg-background px-2 py-1.5 text-sm max-w-full";
type Operation =
  | "enable"
  | "device"
  | "activate"
  | "learn"
  | "cancel"
  | "create"
  | "refresh"
  | "save";
export function KeyboardPanel() {
  const api = window.desktopBridge?.keyboard;
  const [s, set] = useState<KeyboardSnapshot | null>(null);
  const [slot, pick] = useState("key5");
  const [msg, notice] = useState("");
  const [name, setName] = useState("");
  const [edit, setEdit] = useState<{ id: string; arg: string } | null>(null);
  const saved = s?.current.bindings[slot]?.action;
  const action = edit?.id ?? saved?.id ?? "";
  const arg = edit?.arg ?? saved?.arg ?? "";
  const [busy, lock] = useState(false);
  const [proposal, preview] = useState<{
    profile: KeyboardProfile;
    base: string;
  } | null>(null);
  const report = (err: unknown) =>
    notice(err instanceof Error ? err.message : String(err));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns the native learning session for the lifetime of this page
  useEffect(() => {
    if (!api) return;
    let alive = true;
    const receive = () => {
      void api
        .request("snapshot")
        .then((v) => {
          if (alive) set(v);
        })
        .catch(report);
    };
    const unsubscribe = api.subscribe((e) => {
      if (!alive) return;
      if (e.type === "signal") set((old) => old && { ...old, last: e.data });
      if (e.type === "status")
        set(
          (old) =>
            old && {
              ...old,
              status: e.data,
              learning: e.data === "ready" ? old.learning : null,
            },
        );
      if (e.type === "learned" || e.type === "error") {
        notice(e.type === "error" ? e.data : "Сигнал сохранён.");
        receive();
      }
      if (e.type === "devices") receive();
    });
    void api
      .request("open")
      .then((v) => {
        if (alive) set(v);
      })
      .catch(report);
    return () => {
      alive = false;
      unsubscribe();
      void api.request("close").catch(() => {});
    };
  }, [api]);
  async function run(op: Operation, payload?: unknown) {
    if (!api || busy) return;
    lock(true);
    notice("");
    try {
      const next = await api.request(op, payload);
      set(next);
      preview(null);
      if (op === "activate" || op === "create" || op === "save") setEdit(null);
      if (op === "save") notice("Назначения сохранены.");
    } catch (err) {
      report(err);
    }
    lock(false);
  }
  function selectSlot(next: string) {
    if (s?.learning) void run("cancel");
    pick(next);
    setEdit(null);
  }
  function position(id: string, text: string) {
    const selected = slot === id;
    return (
      <button
        type="button"
        key={id}
        aria-label={label(id)}
        aria-pressed={selected}
        title={
          s?.current.bindings[id]?.action
            ? s.actions[s.current.bindings[id]!.action!.id]
            : label(id)
        }
        onClick={() => selectSlot(id)}
        className={
          "min-h-9 rounded-md border px-2 py-1 text-sm " +
          (selected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-muted/40")
        }
      >
        {text}
      </button>
    );
  }
  return (
    <SettingsPageContainer>
      <SettingsSection id="keyboards" title="Клавиатуры">
        {!api ? (
          <p>
            Подключение макропада доступно в настольном Chronos для Windows.
          </p>
        ) : (
          <div className="space-y-5 p-3 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={s?.enabled ?? false}
                disabled={busy || !s}
                onChange={(e) => void run("enable", e.target.checked)}
              />{" "}
              Включить макропад
            </label>
            {s && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <label>
                    Устройство{" "}
                    <select
                      aria-label="Устройство"
                      className={field}
                      disabled={!s.enabled || busy}
                      value={s.device ?? ""}
                      onChange={(e) => void run("device", e.target.value)}
                    >
                      <option value="" disabled>
                        Выберите макропад
                      </option>
                      {Array.from(
                        new Set([
                          ...s.devices,
                          ...(s.device ? [s.device] : []),
                        ]),
                      ).map((id) => (
                        <option value={id} key={id}>
                          SIDE-KEYBOARD · {id.slice(0, 8)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!s.enabled || busy}
                    onClick={() => void run("refresh")}
                  >
                    Обновить
                  </Button>
                  <span role="status">{states[s.status]}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label>
                    Профиль{" "}
                    <select
                      aria-label="Профиль"
                      className={field}
                      value={s.current.id}
                      disabled={busy}
                      onChange={(e) => void run("activate", e.target.value)}
                    >
                      {s.profiles.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <input
                    className={field}
                    aria-label="Имя нового профиля"
                    placeholder="Имя нового профиля"
                    value={name}
                    maxLength={80}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!name.trim() || busy}
                    onClick={() => void run("create", name)}
                  >
                    Создать
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-5">
                  <div className="grid grid-cols-3 gap-2">
                    {keys.map((id, i) => position(id, String(i + 1)))}
                  </div>
                  <div className="space-y-3">
                    {knobs.map((k) => (
                      <fieldset key={k}>
                        <legend>
                          {k === "upper" ? "Верхняя ручка" : "Нижняя ручка"}
                        </legend>
                        <div className="flex gap-1">
                          {moves.map((m) =>
                            position(k + "-" + m, moveNames[m]!),
                          )}
                        </div>
                      </fieldset>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <strong>{label(slot)}</strong>
                  <p>
                    Сигнал позиции ·{" "}
                    {s.current.bindings[slot]?.signal ?? "требуется обучение"}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || s.status !== "ready"}
                    onClick={() =>
                      void run(s.learning ? "cancel" : "learn", slot)
                    }
                  >
                    {s.learning ? "Отменить обучение" : "Запомнить сигнал"}
                  </Button>
                  {s.learning && (
                    <p role="status">
                      Нажмите клавишу или сделайте один жест ручкой.
                    </p>
                  )}
                  <p>
                    Последний сигнал · <code>{s.last ?? "—"}</code>
                  </p>
                  <p>
                    Назначено ·{" "}
                    {s.actions[s.current.bindings[slot]?.action?.id ?? ""] ??
                      "—"}{" "}
                    {s.current.bindings[slot]?.action?.arg}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label>
                    Действие{" "}
                    <select
                      aria-label="Действие"
                      className={field}
                      value={action}
                      onChange={(e) => {
                        setEdit({ id: e.target.value, arg: "" });
                      }}
                    >
                      <option value="">Без действия</option>
                      {Object.entries(s.actions).map(([id, text]) => (
                        <option key={id} value={id}>
                          {text}
                        </option>
                      ))}
                    </select>
                  </label>
                  {["program", "url", "draft"].includes(action) && (
                    <input
                      className={field}
                      aria-label="Параметр действия"
                      placeholder={
                        action === "program"
                          ? "Полный путь к .exe"
                          : action === "url"
                            ? "https://…"
                            : "Модель или провайдер, например Claude"
                      }
                      value={arg}
                      onChange={(e) =>
                        setEdit({ id: action, arg: e.target.value })
                      }
                    />
                  )}
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run("save", {
                        base: s.revision,
                        profile: {
                          ...s.current,
                          bindings: {
                            ...s.current.bindings,
                            [slot]: {
                              signal: s.current.bindings[slot]?.signal ?? null,
                              action: action ? { id: action, arg } : null,
                            },
                          },
                        },
                      })
                    }
                  >
                    Сохранить
                  </Button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    notice("");
                    void api.request("proposal").then(preview).catch(report);
                  }}
                >
                  Предложение ИИ
                </Button>
                {proposal && (
                  <div className="space-y-2">
                    <strong>
                      Изменения в профиле «{proposal.profile.name}»
                    </strong>
                    {Object.entries(proposal.profile.bindings)
                      .filter(
                        ([id, b]) =>
                          JSON.stringify(b) !==
                          JSON.stringify(s.current.bindings[id]),
                      )
                      .map(([id, b]) => (
                        <p key={id}>
                          {label(id)} —{" "}
                          {s.actions[b.action?.id ?? ""] ?? "Без действия"}{" "}
                          {b.action?.arg}
                        </p>
                      ))}
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run("save", {
                          profile: proposal.profile,
                          base: proposal.base,
                        })
                      }
                    >
                      Подтвердить назначения
                    </Button>{" "}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => preview(null)}
                    >
                      Отмена
                    </Button>
                  </div>
                )}
              </>
            )}
            {msg && <p role="status">{msg}</p>}
          </div>
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
