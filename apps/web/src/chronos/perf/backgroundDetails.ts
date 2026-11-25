import type { OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";

export type BackgroundThreadShell = Pick<OrchestrationV2ThreadShell, "id" | "status"> &
  Partial<Pick<OrchestrationV2ThreadShell, "pendingRuntimeRequest" | "lineage" | "pendingBackgroundTasks">>;

export function selectBackgroundDetails(
  threads: ReadonlyArray<BackgroundThreadShell>,
  previous: ReadonlyArray<ThreadId>,
  isRunning: (status: string) => boolean,
): ReadonlyArray<ThreadId> {
  const required = new Set<ThreadId>();
  const ordinary = new Set<ThreadId>();
  for (const thread of threads) {
    const running = isRunning(thread.status);
    const waiting = thread.pendingRuntimeRequest != null || thread.status === "waiting";
    if (!running && !waiting && !thread.pendingBackgroundTasks?.length) continue;
    const parent = thread.lineage?.parentThreadId;
    if (waiting || thread.pendingBackgroundTasks?.length || parent) {
      required.add(thread.id);
      if (parent) required.add(parent);
    } else {
      ordinary.add(thread.id);
    }
  }
  // Preserve existing leases when shell ordering changes during streaming.
  const selected = new Set<ThreadId>();
  for (const id of previous) if (ordinary.has(id) && !required.has(id) && selected.size < 4) selected.add(id);
  for (const id of ordinary) {
    if (selected.size >= 4) break;
    if (!required.has(id)) selected.add(id);
  }
  return [...required, ...selected];
}
