import styles from "./workspace.module.css";
import { useEffect, useEffectEvent, useState } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import * as DateTime from "effect/DateTime";
import { previewEnvironment } from "../../state/preview";
import { useAtomCommand } from "../../state/use-atom-command";
import { openUrlInPreview } from "../../browser/openFileInPreview";
import {
  legacySpeed,
  recordStreamSpeed,
  recordProviderSpeed,
  useStreamSpeed,
  type LegacySpeed,
} from "./speed";
import { useThreadProjection } from "../../state/entities";
import type { DraftId } from "../../composerDraftStore";
import { ChronosPlanControl } from "./planMode";
import { studioClientId } from "./studioClient";
import {
  registerChronosComposer,
  deliverToComposer,
  useChronosWorkspace,
  readStored,
  saveStored,
  type ComposerDelivery,
} from "./state";
import { localServicesAvailable, serviceRequest, serviceUrl, serviceFrameUrl } from "./services";

export function ChronosComposerBridge({
  enabled,
  threadRef,
  cwd,
  onText,
  onFiles,
}: {
  enabled: boolean;
  threadRef: ScopedThreadRef | null;
  cwd: string | null;
  onText: (text: string) => void;
  onFiles: (files: File[]) => Promise<unknown>;
}) {
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const receive = useEffectEvent(async (delivery: ComposerDelivery) => {
    if (delivery.previewUrl) {
      if (!threadRef) throw Error("Откройте тред для панели Studio.");
      const result = await openUrlInPreview({ threadRef, url: delivery.previewUrl, openPreview });
      if (AsyncResult.isFailure(result)) throw Error("Не удалось открыть Studio в правой панели.");
      return;
    }
    if (delivery.files?.length && (await onFiles(delivery.files)) === false)
      throw Error("Не удалось добавить вложение Studio.");
    if (delivery.text) onText(delivery.text);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers only the visible composer's scoped intake, rather than intercepting editor DOM or clipboard globals
  useEffect(() => {
    if (!enabled) return;
    return registerChronosComposer(threadRef?.threadId ?? "draft", (delivery) => receive(delivery));
  }, [enabled, threadRef?.threadId]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes the active workspace to the existing Studio service for its MCP defaults
  useEffect(() => {
    if (!enabled || !localServicesAvailable()) return;
    const abort = new AbortController();
    void serviceRequest("studio", "/api/context", {
      body: { threadId: threadRef?.threadId ?? null, cwd },
      signal: abort.signal,
    }).catch(() => undefined);
    return () => abort.abort();
  }, [enabled, threadRef?.threadId, cwd]);
  return null;
}

export function ChronosStudioBridge() {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns the external Studio SSE connection and closes it on unmount
  useEffect(() => {
    if (!localServicesAvailable()) return;
    const events = new EventSource(serviceUrl("studio", "/api/bridge"));
    const seen = new Set<string>();
    const abort = new AbortController();
    const handle = async (event: MessageEvent<string>, chat: boolean) => {
      try {
        const message = JSON.parse(event.data) as {
          id: string;
          to?: string;
          kind?: string;
          path?: string;
          tab?: string;
          url?: string;
          png?: string;
          title?: string;
          selection?: boolean;
        };
        if (seen.has(message.id) || document.visibilityState !== "visible") return;
        if (message.to && message.to !== studioClientId()) return;
        seen.add(message.id);
        if (seen.size > 300) seen.delete(seen.values().next().value!);
        if (!chat) {
          const path =
            message.kind === "board"
              ? `/board?path=${encodeURIComponent(message.path ?? "")}`
              : `/?tab=${message.tab === "wp" ? "wp" : "boards"}`;
          const url =
            message.kind === "url"
              ? message.url
              : serviceFrameUrl(
                  "studio",
                  path,
                  document.documentElement.classList.contains("dark") ? "dark" : "light",
                );
          if (url && /^https?:\/\//.test(url))
            await deliverToComposer({ text: "", previewUrl: url });
          return;
        }
        const files: File[] = [];
        if (message.png) {
          if (!message.png.startsWith("/api/chat/png"))
            throw Error("Некорректный адрес снимка доски.");
          const response = await fetch(serviceUrl("studio", message.png), { signal: abort.signal });
          if (!response.ok) throw Error("Снимок доски недоступен.");
          files.push(
            new File(
              [await response.blob()],
              `${(message.title ?? "board").replace(/[\\/:*?"<>|]/g, "_")}.png`,
              { type: "image/png" },
            ),
          );
        }
        await deliverToComposer({
          text: `Доска Excalidraw «${message.title ?? ""}»${message.selection ? " (выделенный фрагмент)" : ""}: ${message.path ?? ""} `,
          files,
        });
      } catch (reason) {
        useChronosWorkspace.setState({ error: String(reason) });
        useChronosWorkspace.getState().open("studio");
        console.warn("Chronos Studio delivery failed", String(reason));
      }
    };
    events.addEventListener("open", (event) => {
      if ("data" in event) void handle(event as MessageEvent<string>, false);
    });
    events.addEventListener("chat", (event) => {
      void handle(event as MessageEvent<string>, true);
    });
    return () => {
      events.close();
      abort.abort();
    };
  }, []);
  return null;
}

export function estimateTokens(text: string): number {
  let count = 0;
  for (const piece of text.match(/\p{L}[\p{L}\p{M}']*|\p{N}{1,3}|[^\s\p{L}\p{N}]+|\s+/gu) ?? []) {
    const first = piece.charCodeAt(0);
    if (/^\s+$/.test(piece)) {
      if (piece.length > 1 || piece === "\n") count++;
    } else if (first >= 48 && first <= 57) count++;
    else if (/\p{L}/u.test(piece[0]!))
      count +=
        first < 0x250
          ? piece.length <= 8
            ? 1
            : 1 + Math.ceil((piece.length - 8) / 5)
          : first >= 0x400 && first < 0x530
            ? Math.max(1, Math.ceil(piece.length / 3.6))
            : Math.max(1, Math.ceil(piece.length / (first >= 0x2e80 ? 1.18 : 2.5)));
    else count += Math.max(1, Math.ceil(piece.length / 2.2));
  }
  return count;
}

export function ChronosComposerTools({
  onPromptEdit,
  threadRef,
  draftId,
}: {
  onPromptEdit: (edit: (prompt: string) => string) => void;
  threadRef: ScopedThreadRef | null;
  draftId: DraftId | null;
}) {
  const open = useChronosWorkspace((state) => state.open);
  const thread = useThreadProjection(threadRef);
  const lastRun = thread?.projection.runs.at(-1);
  const providerTurns = thread?.projection.providerTurns;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- consumes typed provider usage updates for precise samples, never rewriting the transport
  useEffect(() => {
    if (lastRun?.modelSelection.model && providerTurns)
      recordProviderSpeed(providerTurns, lastRun.modelSelection.model);
  }, [providerTurns, lastRun?.modelSelection.model]);
  const texts =
    thread?.projection.turnItems.filter(
      (item) => item.type === "assistant_message" && item.runId === lastRun?.id,
    ) ?? [];
  const tokens = estimateTokens(
    texts.map((item) => ("text" in item ? String(item.text) : "")).join(""),
  );

  const completed = lastRun?.completedAt ? DateTime.toEpochMillis(lastRun.completedAt) : null;
  const liveRate = useStreamSpeed(lastRun?.id);
  const rate = liveRate ?? (lastRun ? legacySpeed(lastRun.modelSelection.model) : null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records text-growth telemetry in its external store without changing provider streams
  useEffect(() => {
    if (lastRun?.id && tokens > 0)
      recordStreamSpeed(
        lastRun.id,
        lastRun.modelSelection.model,
        tokens,
        performance.now(),
        completed !== null,
      );
  }, [lastRun?.id, lastRun?.modelSelection.model, tokens, completed]);
  return (
    <div className={styles["chronos-composer-tools"]}>
      {(threadRef ?? draftId) && <ChronosPlanControl target={(threadRef ?? draftId)!} />}
      {localServicesAvailable() && (
        <>
          <button type="button" onClick={() => open("tasks")}>
            # Задачи
          </button>
          <button type="button" onClick={() => open("machines")}>
            @ Машины
          </button>
          <button type="button" onClick={() => open("openrouter")}>
            @ OpenRouter
          </button>
          <select
            aria-label="Поиск через MCP"
            defaultValue=""
            onChange={(event) => {
              const kind = event.target.value;
              if (kind)
                onPromptEdit(
                  (prompt) =>
                    `${prompt}${prompt && !/\s$/.test(prompt) ? " " : ""}!${kind} (поиск через oly-web.${kind === "hn" ? "hackernews" : kind}_search) `,
                );
              event.target.value = "";
            }}
          >
            <option value="">! Поиск</option>
            {["web", "reddit", "x", "youtube", "hn"].map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label="Скорость генерации и статистика моделей"
            onClick={() => open("speed")}
          >
            {rate === null ? "≈ ток/с" : `≈ ${Math.round(rate)} ток/с`}
          </button>
        </>
      )}
    </div>
  );
}

export function SpeedPanel() {
  const [revision, setRevision] = useState(0);
  const data = readStored<LegacySpeed>("oly-speed-v2", {
    m: {},
  });
  return (
    <div data-revision={revision}>
      <p>
        Оценка скорости роста текста; паузы дольше 3 секунд исключаются. Стоимость API здесь не
        рассчитывается. Сохранены прежние измерения и калибровка локального слоя.
      </p>
      <button onClick={() => setRevision((value) => value + 1)}>Обновить</button>
      <button
        onClick={() => {
          saveStored("oly-speed-v2", { v: 2, m: {}, seen: {} });
          setRevision((value) => value + 1);
        }}
      >
        Очистить статистику
      </button>
      {Object.entries(data.m).map(([model, sample]) => (
        <p key={model} dir="auto">
          <strong>{model}</strong> ·{" "}
          {sample.r.length + sample.g.length + sample.t.length
            ? `${Math.round(legacySpeed(model) ?? 0)} ток/с · ${sample.r.length + sample.g.length + sample.t.length} измерений · калибровка ${sample.c}`
            : "Нет измерений"}
        </p>
      ))}
    </div>
  );
}
