import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { SettingsSection } from "../../components/settings/settingsLayout";
import { type Settings, labels, useControl } from "./useControl";

function Editor({
  settings,
  send,
}: {
  settings: Settings;
  send: (input: unknown) => Promise<void>;
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
            placeholder={"notepad.exe\nhttps://example.org"}
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
          onChange={(e) => setDraft({ ...draft, mode: e.target.value as Settings["mode"] })}
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
  return (
    <SettingsSection id="pc-control" title="Управление ПК">
      <div className="space-y-4 p-4 text-sm">
        <Editor key={JSON.stringify(state.settings)} settings={state.settings} send={send} />
        <p>
          Аварийная остановка всех действий · <kbd>Ctrl / ⌘ + Alt + Shift + F12</kbd>. В Windows она
          также закрывает окна, которые агент открыл на отдельном рабочем столе.
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
