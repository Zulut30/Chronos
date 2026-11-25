import { ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { selectBackgroundDetails } from "./backgroundDetails";

it("keeps four ordinary leases stable and admits a waiting child and its parent", () => {
  const ids = "abcdef".split("").map(id => ThreadId.make(id));
  const threads = ids.map(id => ({ id, status: "running" as const }));
  const running = (s: string) => s === "running";
  const leases = selectBackgroundDetails(threads, [], running);
  expect(leases).toEqual(ids.slice(0,4));
  expect(selectBackgroundDetails(threads.toReversed(), leases, running)).toEqual(leases);
  const parent = ThreadId.make("parent");
  const child = { id: ThreadId.make("child"), status: "waiting" as const,
    lineage: { parentThreadId: parent, rootThreadId: parent, relationshipToParent: "subagent" as const } };
  expect(selectBackgroundDetails([...threads,child], leases, running)).toEqual([child.id,parent,...leases]);
});
