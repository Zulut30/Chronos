import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { SettingsSection } from "../../components/settings/settingsLayout";

type Mode = "every" | "risk" | "none";
interface Settings {
  enabled: boolean;
  all: boolean;
  mode: Mode;
  apps: string[];
}
interface Approval {
  id: string;
  op: string;
  target: string;
  label: string;
  manual: boolean;
  proposal?: string;
}
interface State {
  settings: Settings;
  active: boolean;
  pending: Approval[];
  history: { time: number; op: string; status: string }[];
  available?: boolean;
  unavailableReason?: string;
}
declare global {
  interface Window {
    chronosPC?: {
      settings(input: unknown): Promise<State>;
      subscribe(listener: () => void): () => void;
    };
  }
}
const labels: Record<string, string> = {
  open: "Открыть",
  attach: "Подключиться",
  snapshot: "Снимок",
  windows: "Список окон",
  save: "Сохранить временный документ",
  expand: "Раскрыть меню",
  click: "Нажать",
  fill: "Заполнить поле",
  close: "Завершить сессию",
  stop: "Аварийная остановка",
};
function subscribeToControl(setState: (state: State) => void) {
  const api = window.chronosPC;
  if (!api) return;
  let generation = 0;
  function refresh() {
    generation = generation + 1;
    const id = generation;
    void api
      ?.settings({ op: "state" })
      .then((value) => {
        if (id === generation) setState(value);
      })
      .catch(() => {});
  }
  const remove = api.subscribe(refresh);
  refresh();
  return () => {
    generation = generation + 1;
    remove();
  };
}

function useControl() {
  const [state, setState] = useState<State>();
  const [error, setError] = useState("");
  useEffect(() => subscribeToControl(setState), []);
  async function send(input: unknown) {
    try {
      await window.chronosPC?.settings(input);
      setError("");
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    }
  }
  return { state, send, error };
}

function ApprovalRow({ item, send }: { item: Approval; send: (input: unknown) => Promise<void> }) {
  const [value, setValue] = useState("");
  const decide = (allow: boolean) =>
    void send({ op: "decide", id: item.id, allow, ...(item.manual && allow ? { value } : {}) });
  return (
    <div className="space-y-2 border-t py-2">
      <p className="break-all">
        {labels[item.op]} · {item.target}
        {item.label && " · " + item.label}
      </p>
      {item.proposal !== undefined && (
        <p className="max-h-20 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2">
          {item.proposal}
        </p>
      )}
      {item.manual && (
        <label className="block">
          Значение для этого поля
          <Input
            type="password"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-1"
          />
        </label>
      )}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={item.manual && !value}
          onClick={() => decide(true)}
        >
          Разрешить
        </Button>
        <Button variant="outline" size="sm" onClick={() => decide(false)}>
          Отклонить
        </Button>
      </div>
    </div>
  );
}

export function PcIndicator() {
  const { state, send, error } = useControl();
  const [expanded, setExpanded] = useState(false);
  if (!state?.active && !state?.pending.length) return null;
  return (
    <aside
      aria-label="Управление ПК"
      className="fixed right-4 bottom-4 z-[100] max-h-[65vh] w-fit max-w-[min(24rem,92vw)] space-y-2 overflow-auto rounded-lg border bg-background p-3 text-sm shadow-lg"
    >
      <div className="flex items-center gap-2">
        <span role="status">Агент управляет ПК</span>
        <Button variant="outline" size="sm" onClick={() => void send({ op: "stop" })}>
          Остановить
        </Button>
      </div>
      {state.pending.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          Запросы на подтверждение ({state.pending.length})
        </Button>
      )}
      {expanded &&
        state.pending.map((item) => <ApprovalRow key={item.id} item={item} send={send} />)}
      {error && <p role="alert">{error}</p>}
    </aside>
  );
}

function Editor({
  settings,
  send,
  isMac,
}: {
  settings: Settings;
  send: (input: unknown) => Promise<void>;
  isMac: boolean;
}) {
  const [draft, setDraft] = useState(settings);
  const [apps, setApps] = useState(settings.apps.join("\n"));
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void send({
          op: "configure",
          settings: {
            ...draft,
            apps: apps
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
          },
        });
      }}
    >
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
        />
        Разрешить агентам управлять ПК
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={draft.all}
          onChange={(e) => setDraft({ ...draft, all: e.target.checked })}
        />
        Все приложения и сайты
      </label>
      {!draft.all && (
        <label className="block">
          Разрешённые приложения и сайты
          <Textarea
            className="mt-1"
            rows={3}
            placeholder={isMac ? "TextEdit\nhttps://example.org" : "notepad.exe\nhttps://example.org"}
            value={apps}
            onChange={(e) => setApps(e.target.value)}
          />
          <small>По одному имени программы, пути к ней или адресу сайта в строке.</small>
        </label>
      )}
      <label className="flex flex-wrap items-center gap-2">
        Подтверждения
        <select
          className="rounded border bg-background p-1"
          value={draft.mode}
          onChange={(e) => setDraft({ ...draft, mode: e.target.value as Mode })}
        >
          <option value="every">Каждое действие</option>
          <option value="risk">Только опасные</option>
          <option value="none">Без подтверждения обычных действий</option>
        </select>
      </label>
      <p className="text-muted-foreground">
        Ввод паролей и платёжных данных, удаление и отправка сообщений и форм требуют разрешения.
        Если назначение кнопки или поля неоднозначно, Chronos также запросит подтверждение.
      </p>
      <Button variant="outline" size="sm" type="submit">
        Применить
      </Button>
    </form>
  );
}

export function PcSettings() {
  const { state, send, error } = useControl();
  if (!state) return null;
  const isMac = window.desktopBridge?.getClientPlatform?.() === "darwin";
  if (state.available === false) {
    return (
      <SettingsSection id="pc-control" title="Управление ПК">
        <div className="p-4 text-sm text-muted-foreground">
          {state.unavailableReason ||
            "Управление ПК недоступно на этом Mac: компонент agent-desktop не найден в сборке."}
        </div>
      </SettingsSection>
    );
  }
  return (
    <SettingsSection id="pc-control" title="Управление ПК">
      <div className="space-y-4 p-4 text-sm">
        <Editor
          key={JSON.stringify(state.settings)}
          settings={state.settings}
          send={send}
          isMac={isMac}
        />
        <p>
          Аварийная остановка всех действий ·{" "}
          <kbd>{isMac ? "⌘ + Option + Shift + F12" : "Ctrl / ⌘ + Alt + Shift + F12"}</kbd>.{" "}
          {isMac
            ? "Для управления приложениями на macOS разрешите Chronos в «Системные настройки → Конфиденциальность и безопасность → Универсальный доступ»."
            : "В Windows она также закрывает окна, которые агент открыл на отдельном рабочем столе."}
        </p>
        <Button
          variant="outline"
          size="sm"
          data-pc-stop
          disabled={!state.settings.enabled}
          onClick={() => void send({ op: "stop" })}
        >
          Остановить управление ПК
        </Button>
        {error && <p role="alert">{error}</p>}
        <details>
          <summary>Журнал действий ({state.history.length})</summary>
          <ol className="mt-2 max-h-60 overflow-auto">
            {state.history
              .slice()
              .reverse()
              .map((entry, i) => (
                <li key={i}>
                  {new Date(entry.time).toLocaleTimeString()} · {labels[entry.op] ?? "Запрос"} ·{" "}
                  {entry.status === "ok" ? "Готово" : "Не выполнено"}
                </li>
              ))}
          </ol>
        </details>
      </div>
    </SettingsSection>
  );
}
