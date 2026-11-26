import { freemem, totalmem } from "node:os";
import type { ProviderSessionId, ThreadId } from "@t3tools/contracts";
import { isOrchestrationV2WorkActive } from "@t3tools/contracts";
import type { ProviderAdapterV2SessionRuntime } from "@t3tools/provider-core/server/ProviderAdapter";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import { ProjectionStoreV2 } from "../orchestration-v2/ProjectionStore.ts";
import { ThreadViewers } from "../orchestration-v2/ThreadViewers.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { ProcessRunner } from "../processRunner.ts";
import { captureIdleProcessGuard } from "./claudeProcessGuard.ts";
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

// Opt-in diagnostics log only lifecycle state, never prompts, paths or process arguments.
export function traceIdleUnload(phase: string, fields: object) {
  if (process.env.CHRONOS_TRACE_IDLE_UNLOAD === "1")
    process.stderr.write("chronos-idle " + JSON.stringify({ phase, ...fields }) + "\n");
}

const MINUTE = 60_000;
const MIB = 1024 ** 2;

function windowsMemoryIsLow() {
  if (process.platform !== "win32") return false;
  const configured = process.env.CHRONOS_CLAUDE_LOW_MEMORY_MIB;
  // libuv reads Windows' available physical memory, including reclaimable standby pages.
  const threshold =
    configured === undefined ? Math.min(2048, totalmem() / MIB / 10) : Number(configured);
  return Number.isFinite(threshold) && threshold > 0 && freemem() / MIB < threshold;
}

// One clock for the live sessions. Removing a runtime also removes its deadline.
export const makeClaudeIdleUnload = Effect.fnUntraced(function* <Entry extends IdleEntry, E>(
  sessions: Ref.Ref<Map<string, Entry>>,
  withOpenLock: (id: ProviderSessionId, effect: Effect.Effect<void, E>) => Effect.Effect<void, E>,
  release: (input: IdleRelease) => Effect.Effect<void, E>,
  memoryIsLow = windowsMemoryIsLow,
) {
  const settings = yield* Effect.serviceOption(ServerSettingsService);
  const terminals = yield* Effect.serviceOption(TerminalManager);
  const viewers = yield* Effect.serviceOption(ThreadViewers);
  const runner = yield* Effect.serviceOption(ProcessRunner);
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

  const due = (entry: IdleEntry, age: number, timeout: number) =>
    timeout > 0 &&
    (age >= timeout * MINUTE ||
      (age >= MINUTE &&
        Option.isSome(viewers) &&
        entry.attachedThreadIds.size > 0 &&
        !Array.from(entry.attachedThreadIds).some(viewers.value.isViewed) &&
        memoryIsLow()));

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
    if (delay === 0) {
      traceIdleUnload("disabled", { settings: Option.isSome(settings) });
      return;
    }
    const now = yield* Clock.currentTimeMillis;
    if (process.env.CHRONOS_TRACE_IDLE_UNLOAD === "1") {
      traceIdleUnload("sweep", {
        delay, terminals: Option.isSome(terminals), viewers: Option.isSome(viewers),
        sessions: [...live.values()].map(e => ({ busy: e.busyTurns.size, age: now - (e.chronosIdleSince ?? now), due: due(e, now - (e.chronosIdleSince ?? now), delay) })),
      });
    }
    for (const entry of live.values()) {
      const { runtime } = entry;
      const since = entry.chronosIdleSince;
      if (since === undefined || entry.busyTurns.size > 0 || !due(entry, now - since, delay)) continue;
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
            if (yield* hasWork(current)) {
              traceIdleUnload("protected", { by: "thread-work" });
              return true;
            }
            if (runtime.hasPendingBackgroundWork && (yield* runtime.hasPendingBackgroundWork))
              return true;
            if (!runtime.canUnloadIdleSession || !(yield* runtime.canUnloadIdleSession)) {
              traceIdleUnload("protected", { by: "adapter", driver: runtime.driver });
              return true;
            }
            // Probes yield. Recheck config and the activity token under the manager's request permit.
            if (runtime.hasPendingBackgroundWork && (yield* runtime.hasPendingBackgroundWork))
              return true;
            const timeout = yield* minutes;
            const latest = (yield* entries).get(String(id));
            const age = (yield* Clock.currentTimeMillis) - since;
            return (
              latest?.runtime !== runtime ||
              latest.idleGeneration !== entry.idleGeneration ||
              !due(latest, age, timeout)
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
            yield* Effect.logInfo(runtime.driver === "claudeAgent" ? "chronos.claude.idle-unloaded" : "chronos.acp.idle-unloaded", {
              providerSessionId: id,
              threadIds: [...current.attachedThreadIds],
              idleMs: now - since,
              trigger: now - since < delay * MINUTE ? "low_memory" : "timeout",
            });
          } else if (
            now - since >= delay * MINUTE &&
            (yield* entries).get(String(id))?.idleGeneration === current.idleGeneration
          ) {
            // An early probe must not push the ordinary idle deadline further out.
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
  const capture = (processTree: { pid: number; tracked: () => ReadonlyArray<number>; unit?: string }) =>
    Option.isSome(runner)
      ? captureIdleProcessGuard(
          runner.value, process.platform === "win32", process.env.SystemRoot ?? "C:\\Windows",
          processTree.pid, processTree.tracked, processTree.unit,
        )
      : Effect.succeed(Effect.succeed(false));
  return { touch, capture };
});
