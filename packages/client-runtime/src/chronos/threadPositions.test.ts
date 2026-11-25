import { ThreadId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { threadIndex, threadPositions, upsertIndexedThread } from "./threadPositions.ts";

it("shares positions after a replacement while old and new readers see their own rows", () => {
  const row = (id: string) => ({ id: ThreadId.make(id) }) as OrchestrationV2ThreadShell;
  const rows = [row("a"), row("b")];
  const old = threadIndex(rows);
  const changed = row("b");
  const next = upsertIndexedThread(rows, changed);
  const current = threadIndex(next);
  expect(threadPositions(next)).toBe(threadPositions(rows));
  expect(old.get(changed.id)).toBe(rows[1]);
  expect(current.get(changed.id)).toBe(changed);
  expect([...current.values()]).toEqual(next);
  const appended = upsertIndexedThread(next, row("c"));
  expect(threadPositions(appended)).not.toBe(threadPositions(next));
  expect(threadIndex(appended.toReversed()).get(changed.id)).toBe(changed);
  expect(threadIndex(next.slice(0, 1)).has(changed.id)).toBe(false);
});
