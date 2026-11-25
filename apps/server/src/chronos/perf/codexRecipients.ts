import type { ProviderAdapterV2Event } from "@t3tools/provider-core/server/ProviderAdapter";
import * as Context from "effect/Context";

interface Owner {
  readonly runId: string;
  readonly threadId: string;
  readonly root: boolean;
}

export const RunSubscriber = Context.Reference<Owner | undefined>("chronos/RunSubscriber", {
  defaultValue: () => undefined,
});

// These rows can be adopted by a later root run in routeProviderEvent, even with an old runId.
const adoptableItems = new Set(["proposed_plan", "todo_list", "command_execution", "dynamic_tool", "subagent"]);

function runOwnedRow(event: ProviderAdapterV2Event) {
  switch (event.type) {
    case "message.updated": return event.message;
    case "steer.updated": return event;
    case "node.updated":
      return event.node.kind === "plan" || event.node.kind === "todo_list" ? undefined : event.node;
    case "turn_item.updated":
      return adoptableItems.has(event.turnItem.type) ? undefined : event.turnItem;
    default: return undefined;
  }
}

// Only positive evidence of a top-level owner permits skipping other consumers.
// Plan adoption, native lineage, terminal barriers and background handoffs stay with the run router.
export function makeCodexRecipients<Q extends object>() {
  const owners = new WeakMap<Q, Owner>();
  const indexed = new WeakMap<ReadonlyMap<number, Q>, Map<string, { owner: Owner; queues: Q[] }> | null>();
  function index(current: ReadonlyMap<number, Q>) {
    const byRun = new Map<string, { owner: Owner; queues: Q[] }>();
    for (const queue of current.values()) {
      const owner = owners.get(queue);
      if (!owner) return null; // An unscoped observer needs the full stream.
      const group = byRun.get(owner.runId);
      if (group) group.queues.push(queue);
      else byRun.set(owner.runId, { owner, queues: [queue] });
    }
    return byRun;
  }
  return {
    register(queue: Q, owner: Owner | undefined) {
      if (owner) owners.set(queue, owner);
    },
    recipients(current: ReadonlyMap<number, Q>, event: ProviderAdapterV2Event): Iterable<Q> {
      if (current.size < 2 || event.driver !== "codex") return current.values();
      const entity = runOwnedRow(event);
      if (!entity?.runId) return current.values();
      let byRun = indexed.get(current);
      if (byRun === undefined) {
        byRun = index(current);
        indexed.set(current, byRun);
      }
      const match = byRun?.get(entity.runId);
      if (match?.owner.threadId !== entity.threadId) return current.values();
      return event.type === "steer.updated" || match.owner.root ? match.queues : current.values();
    },
  };
}
