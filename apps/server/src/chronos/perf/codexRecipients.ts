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
      const entity = event.type === "message.updated" ? event.message
        : event.type === "steer.updated" ? event
        : event.type === "turn_item.updated" &&
          (event.turnItem.type === "assistant_message" || event.turnItem.type === "reasoning")
          ? event.turnItem : undefined;
      if (!entity?.runId) return current.values();
      let byRun = indexed.get(current);
      if (byRun === undefined) {
        byRun = index(current);
        indexed.set(current, byRun);
      }
      const match = byRun?.get(entity.runId);
      return match && match.owner.threadId === entity.threadId &&
        (event.type === "steer.updated" || match.owner.root) ? match.queues : current.values();
    },
  };
}
