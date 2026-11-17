import styles from "./workspace.module.css";
import { useEffect, useState } from "react";
import { useEnvironments } from "../../state/environments";
import { useServiceData } from "./useServiceData";
import { serviceRequest } from "./services";
import { deliverToComposer, readStored, saveStored, useChronosWorkspace } from "./state";
import { useDownloadJobs, type DownloadJob } from "./downloads";

export interface MediaModel {
  id: string;
  name?: string;
  kinds?: string[];
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  pricing?: { prompt?: string; completion?: string };
}
export const MEDIA_KINDS = {
  text: ["Текст", "chat_once", "текст"],
  image: ["Фото", "generate_image", "фото"],
  video: ["Видео", "generate_video", "видео"],
  speech: ["Озвучка", "generate_speech", "speech"],
  transcription: ["Распознавание", "transcribe_audio", "transcription"],
  audio: ["Аудио", "generate_audio", "audio"],
  decision: ["Решения", "decide", "decision"],
} as const;
export type MediaKind = keyof typeof MEDIA_KINDS;
export function modelReference(model: MediaModel, kind: MediaKind): string {
  const info = MEDIA_KINDS[kind];
  return `@openrouter:${model.id} (${info[2]}; MCP openrouter → ${info[1]})`;
}
export function modelMatchesKind(model: MediaModel, kind: MediaKind): boolean {
  if (!model.architecture && model.kinds) return model.kinds.includes(kind);
  const outputs = model.architecture?.output_modalities ?? ["text"],
    inputs = model.architecture?.input_modalities ?? [];
  if (kind === "transcription") return inputs.includes("audio") && outputs.includes("text");
  if (kind === "speech" || kind === "audio") return outputs.includes("audio");
  return outputs.includes(kind === "decision" ? "text" : kind);
}

export function OpenRouterPanel() {
  const [models, setModels] = useState<MediaModel[]>(() => {
    const cache = readStored<{ list?: MediaModel[]; data?: MediaModel[] }>(
      "oly-openrouter-catalog-v3",
      {},
    );
    return cache.list ?? cache.data ?? [];
  });
  const [kind, setKind] = useState<MediaKind>("image");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- fetches the public model catalog, cancelling when the panel closes
  useEffect(() => {
    const catalogUrl = new URL("https://openrouter.ai/api/v1/models?output_modalities=all");
    if (revision > 0) catalogUrl.searchParams.set("chronos_refresh", String(revision));
    const abort = new AbortController();
    void fetch(catalogUrl, {
      signal: abort.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        const result = (await response.json()) as { data: MediaModel[] };
        if (abort.signal.aborted) return;
        const list = result.data.map((model) => ({
          ...model,
          kinds: (Object.keys(MEDIA_KINDS) as MediaKind[]).filter((kind) =>
            modelMatchesKind(model, kind),
          ),
        }));
        setModels(list);
        saveStored("oly-openrouter-catalog-v3", { list, at: Date.now() });
        setError("");
      })
      .catch((reason) => {
        if (!abort.signal.aborted) setError(String(reason));
      });
    return () => abort.abort();
  }, [revision]);
  return (
    <div>
      <div className={styles["chronos-row"]}>
        <select
          aria-label="Тип модели"
          value={kind}
          onChange={(event) => setKind(event.target.value as MediaKind)}
        >
          {Object.entries(MEDIA_KINDS).map(([id, info]) => (
            <option key={id} value={id}>
              {info[0]}
            </option>
          ))}
        </select>
        <input
          placeholder="Найти модель"
          aria-label="Найти модель"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          onClick={() => {
            setRevision((value) => value + 1);
          }}
        >
          Обновить
        </button>
      </div>
      <p>
        Выбор добавит ссылку на модель и инструмент существующего MCP OpenRouter. Генерация
        выполняется агентом после отправки сообщения.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className={styles["chronos-list"]}>
        {models
          .filter(
            (model) =>
              modelMatchesKind(model, kind) &&
              `${model.id} ${model.name}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
          )
          .slice(0, 80)
          .map((model) => (
            <button
              key={model.id}
              onClick={() => {
                const recent = readStored<string[]>("oly-openrouter-recent", []);
                saveStored(
                  "oly-openrouter-recent",
                  [model.id, ...recent.filter((id) => id !== model.id)].slice(0, 8),
                );
                void deliverToComposer({ text: modelReference(model, kind) + " " }).then(
                  () => useChronosWorkspace.getState().close(),
                  (reason) => setError(String(reason)),
                );
              }}
            >
              <span dir="auto">{model.name ?? model.id}</span>
              <small>
                {model.id}
                {model.pricing?.completion
                  ? ` · output $${Number(model.pricing.completion) * 1e6}/M`
                  : ""}
              </small>
            </button>
          ))}
      </div>
    </div>
  );
}

interface Integration {
  id: string;
  name: string;
  description: string;
  env: string;
  masked: string;
  set: boolean;
  url: string;
  lastTest?: { message: string; ok: boolean } | null;
}
export function IntegrationsPanel() {
  const keys = useServiceData<{ items: Integration[] }>("integrations", "/api/keys");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const change = async (id: string, path: string, body: Record<string, unknown>) => {
    setBusy(id);
    setError("");
    try {
      await serviceRequest("integrations", path, { body: { id, ...body } });
      keys.refresh();
      setBusy(null);
      return true;
    } catch (reason) {
      setError(String(reason));
      setBusy(null);
      return false;
    }
  };
  return (
    <div>
      <p>
        Ключи хранятся существующим сервисом в пользовательских переменных окружения. Значения не
        записываются в настройки Chronos.
      </p>
      {(error || keys.error) && <p role="alert">{error || keys.error}</p>}
      {keys.value?.items.map((item) => (
        <form
          className={styles["chronos-card"]}
          key={item.id}
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const value = String(new FormData(form).get("key") ?? "");
            void change(item.id, "/api/keys", { value }).then((ok) => {
              if (ok) form.reset();
            });
          }}
        >
          <h3>
            {item.name} · {item.set ? item.masked : "Не задан"}
          </h3>
          <p>{item.description}</p>
          <small>{item.env}</small>
          <div className={styles["chronos-row"]}>
            <input
              name="key"
              type="password"
              autoComplete="new-password"
              aria-label={`Ключ ${item.name}`}
              required
            />
            <button disabled={busy !== null}>Сохранить ключ</button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                void change(item.id, "/api/test", {});
              }}
            >
              Проверить
            </button>
            <button
              type="button"
              disabled={busy !== null || !item.set}
              onClick={() => {
                void change(item.id, "/api/keys/delete", {});
              }}
            >
              Удалить ключ
            </button>
          </div>
          {item.lastTest && <p role="status">{item.lastTest.message}</p>}
        </form>
      ))}
    </div>
  );
}

export function MachinesPanel() {
  const { environments } = useEnvironments();
  const [aliases, setAliases] = useState<Record<string, string>>(() =>
    readStored("oly-machines-aliases", {}),
  );
  const [error, setError] = useState("");
  return (
    <div>
      {error && <p role="alert">{error}</p>}
      {environments.map((environment) => {
        const original = environment.entry.target.label;
        return (
          <form
            key={environment.environmentId}
            className={styles["chronos-card"]}
            onSubmit={(event) => {
              event.preventDefault();
              const alias = String(new FormData(event.currentTarget).get("alias") ?? "")
                .trim()
                .slice(0, 80);
              const next = { ...aliases };
              if (!alias || alias === original) delete next[original];
              else next[original] = alias;
              saveStored("oly-machines-aliases", next);
              setAliases(next);
              window.dispatchEvent(new Event("chronos:aliases"));
            }}
          >
            <label>
              {original}
              <input
                name="alias"
                aria-label={`Псевдоним ${original}`}
                defaultValue={aliases[original] ?? ""}
                placeholder="Псевдоним"
              />
            </label>
            <p>{environment.displayUrl ?? "Этот компьютер"}</p>
            <div className={styles["chronos-row"]}>
              <button>Сохранить имя</button>
              <button
                type="button"
                onClick={() => {
                  void deliverToComposer({
                    text: `@машина:«${aliases[original] ?? original}» [${original}; ${environment.displayUrl ?? "Этот компьютер"}] `,
                  }).then(
                    () => useChronosWorkspace.getState().close(),
                    (reason) => setError(String(reason)),
                  );
                }}
              >
                Упомянуть в чате
              </button>
            </div>
          </form>
        );
      })}
    </div>
  );
}

interface FileHealth {
  localEnvId: string;
  dest: string;
}
export function FilesPanel() {
  const health = useServiceData<FileHealth>("files", "/health");
  const { jobs, setJobs, error: downloadError } = useDownloadJobs();
  const [error, setError] = useState("");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- active download jobs are owned by the external service; stop monitoring when they finish or this panel closes
  useEffect(() => {
    if (!jobs.some((job) => job.state === "running")) return;
    const abort = new AbortController();
    const timer = setInterval(() => {
      void Promise.all(
        jobs.map((job) =>
          job.state === "running"
            ? serviceRequest<DownloadJob>("files", `/job?id=${encodeURIComponent(job.id)}`, {
                signal: abort.signal,
              })
            : job,
        ),
      ).then(
        (updated) =>
          setJobs((current) =>
            current.map((job) => updated.find((item) => item.id === job.id) ?? job),
          ),
        (reason) => {
          if (!abort.signal.aborted) setError(String(reason));
        },
      );
    }, 1000);
    return () => {
      clearInterval(timer);
      abort.abort();
    };
  }, [jobs, setJobs]);
  return (
    <div>
      <p>Папка загрузок: {health.value?.dest ?? "…"}</p>
      <form
        className={styles["chronos-card"]}
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const mode = String(data.get("mode"));
          const source = String(data.get("source"));
          const body =
            mode === "fetch"
              ? { url: source, name: data.get("name") || source.split("/").pop() }
              : mode === "local"
                ? {
                    envId: health.value?.localEnvId,
                    path: source,
                    isDir: data.get("directory") === "on",
                  }
                : {
                    httpBase: data.get("httpBase"),
                    path: source,
                    isDir: data.get("directory") === "on",
                  };
          void serviceRequest<DownloadJob>("files", `/${mode}`, { body }).then(
            (job) => setJobs((current) => [...current, job]),
            (reason) => setError(String(reason)),
          );
        }}
      >
        <label>
          Источник
          <select name="mode">
            <option value="local">Локальный файл или папка</option>
            <option value="ssh">Файл или папка по SSH</option>
            <option value="fetch">Подписанный URL вложения T3</option>
          </select>
        </label>
        <label>
          Абсолютный путь или URL
          <input name="source" required />
        </label>
        <label>
          Адрес HTTP окружения для SSH
          <input name="httpBase" placeholder="http://127.0.0.1:…" />
        </label>
        <label>
          Имя файла для URL
          <input name="name" />
        </label>
        <label>
          <input name="directory" type="checkbox" />
          Архивировать папку
        </label>
        <button disabled={!health.value}>Скачать</button>
      </form>
      {(error || health.error || downloadError) && (
        <p role="alert">{error || health.error || downloadError}</p>
      )}
      {jobs.map((job) => (
        <div key={job.id} className={styles["chronos-card"]}>
          <strong>{job.name}</strong> · {job.state} · {job.bytes.toLocaleString()} B
          <p>{job.error || job.path}</p>
          <button
            disabled={job.state !== "running"}
            onClick={() => {
              void serviceRequest("files", "/cancel", { body: { id: job.id } }).catch((reason) =>
                setError(String(reason)),
              );
            }}
          >
            Отменить
          </button>
          <button
            disabled={!job.path}
            onClick={() => {
              void serviceRequest("files", "/reveal", { body: { path: job.path } }).catch(
                (reason) => setError(String(reason)),
              );
            }}
          >
            Показать в папке
          </button>
        </div>
      ))}
    </div>
  );
}
