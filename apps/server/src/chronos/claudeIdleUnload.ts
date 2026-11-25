import type { ProviderSessionId, ThreadId } from "@t3tools/contracts";
import { isOrchestrationV2WorkActive } from "@t3tools/contracts";
import type { ProviderAdapterV2SessionRuntime } from "@t3tools/provider-core/server/ProviderAdapter";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import { ProjectionStoreV2 } from "../orchestration-v2/ProjectionStore.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { TerminalManager } from "../terminal/Manager.ts";

interface IdleEntry {
  readonly runtime: ProviderAdapterV2SessionRuntime;
  readonly attachedThreadIds: ReadonlySet<ThreadId>;
  readonly busyTurns: ReadonlySet<string>;
  readonly idleGeneration: number;
  readonly chronosIdleSince?: number;
}

interface IdleRelease {
  readonly providerSessionId: ProviderSessionId;
  readonly reason: "idle_timeout";
  readonly onlyIfIdleGeneration: number;
  readonly gracefulSubscribers: true;
  readonly keepIf: Effect.Effect<boolean>;
}

// One clock for the live sessions. Removing a runtime also removes its deadline.
export const makeClaudeIdleUnload = Effect.fnUntraced(function* <Entry extends IdleEntry, E>(
  sessions: Ref.Ref<Map<string, Entry>>,
  withOpenLock: (id: ProviderSessionId, effect: Effect.Effect<void, E>) => Effect.Effect<void, E>,
  release: (input: IdleRelease) => Effect.Effect<void, E>,
) {
  const settings = yield* Effect.serviceOption(ServerSettingsService);
  const terminals = yield* Effect.serviceOption(TerminalManager);
  const store = yield* ProjectionStoreV2;
  const entries = Ref.get(sessions);
  const minutes = Option.isSome(settings)
    ? settings.value.getSettings.pipe(
        Effect.map((s) => s.claudeIdleUnloadMinutes ?? 0),
        Effect.orElseSucceed(() => 0),
      )
    : Effect.succeed(0);

  const touch = (runtime: ProviderAdapterV2SessionRuntime) =>
    Clock.currentTimeMillis.pipe(
      Effect.flatMap((at) =>
        Ref.update(sessions, (live) => {
          const key = String(runtime.providerSessionId);
          const entry = live.get(key);
          if (entry?.runtime !== runtime || entry.busyTurns.size > 0) return live;
          return new Map(live).set(key, {
            ...entry,
            chronosIdleSince: at,
            idleGeneration: entry.idleGeneration + 1,
          });
        }),
      ),
    );

  const hasWork = Effect.fnUntraced(function* (entry: IdleEntry) {
    if (Option.isNone(terminals)) return true;
    for (const threadId of entry.attachedThreadIds) {
      if (yield* terminals.value.hasActiveSubprocess({ threadId, includeOpenShells: true }))
        return true;
      const records = yield* store.getThreadRecords(
        threadId,
        ["runs", "runtimeRequests", "providerThreads", "subagents", "turnItems"],
        {
          runStatuses: ["preparing", "queued", "starting", "running", "waiting"],
          runtimeRequestStatuses: ["pending"],
          turnItemTypes: ["command_execution", "dynamic_tool", "subagent"],
          turnItemStatuses: ["pending", "running", "waiting"],
          omitSettledSubagents: true,
        },
      );
      if (
        records.runs.length ||
        records.runtimeRequests.length ||
        records.turnItems.length ||
        records.providerThreads.some(
          (thread) => (thread.pendingBackgroundTasks?.length ?? 0) > 0,
        ) ||
        records.subagents.some(
          (task) =>
            isOrchestrationV2WorkActive(task.status) ||
            task.completionDelivery?.state === "pending" ||
            task.completionDelivery?.state === "claimed",
        )
      )
        return true;
    }
    return false;
  });

  const sweep = Effect.gen(function* () {
    const live = yield* entries;
    if (
      ![...live.values()].some(
        (entry) => entry.chronosIdleSince !== undefined && entry.busyTurns.size === 0,
      )
    )
      return;
    const delay = yield* minutes;
    if (delay === 0) return;
    const now = yield* Clock.currentTimeMillis;
    for (const entry of live.values()) {
      const { runtime } = entry;
      const since = entry.chronosIdleSince;
      if (since === undefined || entry.busyTurns.size > 0 || now - since < delay * 60_000) continue;
      const id = runtime.providerSessionId;
      // Hold the same lock as open through scope close and persistence. A queued opener
      // either refreshed the stamp first, or receives a new runtime after teardown.
      yield* withOpenLock(
        id,
        Effect.gen(function* () {
          const current = (yield* entries).get(String(id));
          if (
            current?.runtime !== runtime ||
            current.busyTurns.size ||
            current.idleGeneration !== entry.idleGeneration
          )
            return;
          const keepIf = Effect.gen(function* () {
            if (yield* hasWork(current)) return true;
            if (runtime.hasPendingBackgroundWork && (yield* runtime.hasPendingBackgroundWork))
              return true;
            if (!runtime.canUnloadIdleSession || !(yield* runtime.canUnloadIdleSession))
              return true;
            // Probes yield. Recheck config and the activity token under the manager's request permit.
            const timeout = yield* minutes;
            return (
              timeout === 0 ||
              (yield* Clock.currentTimeMillis) - since < timeout * 60_000 ||
              (runtime.hasPendingBackgroundWork !== undefined &&
                (yield* runtime.hasPendingBackgroundWork))
            );
          }).pipe(Effect.catchCause(() => Effect.succeed(true)));
          yield* release({
            providerSessionId: id,
            reason: "idle_timeout",
            gracefulSubscribers: true,
            onlyIfIdleGeneration: current.idleGeneration,
            keepIf,
          });
          if ((yield* entries).get(String(id))?.runtime !== runtime) {
            yield* Effect.logInfo("chronos.claude.idle-unloaded", {
              providerSessionId: id,
              threadIds: [...current.attachedThreadIds],
              idleMs: now - since,
            });
          } else if ((yield* entries).get(String(id))?.idleGeneration === current.idleGeneration) {
            yield* touch(runtime);
          }
        }),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("chronos.claude.idle-unload-failed", { providerSessionId: id, cause }),
        ),
      );
    }
  });
  yield* sweep.pipe(Effect.repeat(Schedule.spaced("30 seconds")), Effect.forkScoped);
  return { touch };
});
