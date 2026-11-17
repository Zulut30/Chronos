import { Button } from "../../components/ui/button";
import { useState } from "react";
import { useRenderedAppearance } from "../../hooks/useTheme";
import { deliverToComposer, useChronosWorkspace } from "./state";
import { serviceFrameUrl, serviceRequest } from "./services";
import { useServiceData } from "./useServiceData";
import styles from "./workspace.module.css";

interface Board {
  path: string;
  name: string;
  dir: string;
  location?: string;
}
interface Location {
  id: string;
  title: string;
  dir: string;
  current: boolean;
}

export function StudioPanel() {
  const appearance = useRenderedAppearance();
  const boards = useServiceData<{ boards: Board[] }>("studio", "/api/boards");
  const locations = useServiceData<{ locations: Location[] }>("studio", "/api/locations");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const bridgeError = useChronosWorkspace((state) => state.error);
  const open = async (path: string) => {
    try {
      await deliverToComposer({
        text: "",
        previewUrl: serviceFrameUrl("studio", path, appearance),
      });
      useChronosWorkspace.getState().close();
    } catch (reason) {
      setError(String(reason));
    }
  };
  const mutate = async (path: string, body: unknown) => {
    setBusy(true);
    setError("");
    try {
      const result = await serviceRequest<{ path?: string }>("studio", path, { body });
      boards.refresh();
      setEditing(null);
      if (path.endsWith("create") && result.path)
        await open(`/board?path=${encodeURIComponent(result.path)}`);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      {(error || boards.error || locations.error || bridgeError) && (
        <p role="alert">{error || boards.error || locations.error || bridgeError}</p>
      )}
      <div className={styles["chronos-row"]}>
        <input
          aria-label="Найти доску"
          placeholder="Найти доску"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            boards.refresh();
            locations.refresh();
          }}
        >
          Обновить
        </Button>
        <Button variant="outline" size="sm" onClick={() => void open("/?tab=wp")}>
          WordPress Playground
        </Button>
      </div>
      <form
        className={styles["chronos-row"]}
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void mutate("/api/board/create", { dir: data.get("dir"), name: data.get("name") });
        }}
      >
        <input name="name" aria-label="Название новой доски" placeholder="Новая доска" required />
        {locations.value && (
          <select
            aria-label="Папка доски"
            name="dir"
            defaultValue={locations.value.locations.find((item) => item.current)?.dir}
          >
            {locations.value.locations.map((item) => (
              <option value={item.dir} key={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        )}
        <Button
          variant="outline"
          size="sm"
          type="submit"
          disabled={busy || !locations.value?.locations.length}
        >
          Создать доску
        </Button>
      </form>
      {editing && (
        <form
          className={styles["chronos-row"]}
          onSubmit={(event) => {
            event.preventDefault();
            void mutate("/api/board/rename", {
              path: editing.path,
              name: new FormData(event.currentTarget).get("name"),
            });
          }}
        >
          <input
            name="name"
            aria-label="Новое название доски"
            defaultValue={editing.name}
            required
          />
          <Button variant="outline" size="sm" type="submit" disabled={busy}>
            Сохранить название
          </Button>
          <Button variant="outline" size="sm" type="button" onClick={() => setEditing(null)}>
            Отмена
          </Button>
        </form>
      )}
      <div className={styles["chronos-list"]}>
        {boards.value?.boards
          .filter((board) =>
            `${board.name} ${board.path}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
          )
          .map((board) => (
            <div key={board.path} className={styles["chronos-card"]}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void open(`/board?path=${encodeURIComponent(board.path)}`)}
              >
                {board.name}
              </Button>
              <small>{board.location ?? board.dir}</small>
              <div className={styles["chronos-row"]}>
                <Button variant="outline" size="sm" onClick={() => setEditing(board)}>
                  Переименовать
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void mutate("/api/board/delete", { path: board.path })}
                >
                  В корзину
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void deliverToComposer({
                      text: `Доска Excalidraw «${board.name}»: ${board.path} `,
                    }).then(
                      () => useChronosWorkspace.getState().close(),
                      (reason) => setError(String(reason)),
                    );
                  }}
                >
                  В сообщение
                </Button>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
