import { expect, it } from "vite-plus/test";
import { MessageId, ProviderDriverKind, RunId, ThreadId } from "@t3tools/contracts";
import type { ProviderAdapterV2Event } from "@t3tools/provider-core/server/ProviderAdapter";
import { makeCodexRecipients } from "./codexRecipients.ts";

it.each([4, 8, 16])("delivers one steer per run under %i concurrent subscriptions", (n) => {
  const router = makeCodexRecipients<object>();
  const queues = new Map<number, object>();
  const events: ProviderAdapterV2Event[] = [];
  for (let i = 0; i < n; i++) {
    const queue = {};
    const threadId = ThreadId.make("thread-" + i);
    const runId = RunId.make("run-" + i);
    router.register(queue, { threadId, runId, root: true });
    queues.set(i, queue);
    events.push({
      driver: ProviderDriverKind.make("codex"), type: "steer.updated", threadId, runId,
      messageId: MessageId.make("message-" + i), status: "pending",
    });
  }
  const received = events.flatMap((event) => [...router.recipients(queues, event)]);
  expect(received).toHaveLength(n);
  received.forEach((queue, i) => expect(queue).toBe(queues.get(i)));
});

it("targets root text, preserving child, background, unscoped and released subscriptions", () => {
  const router = makeCodexRecipients<object>();
  const all = new Map([[1, {}], [2, {}]]);
  const [a, b] = [...all.values()] as [object, object];
  router.register(a, { threadId: "a", runId: "1", root: true });
  router.register(b, { threadId: "b", runId: "2", root: false });
  const event = (type: string, threadId: string, runId: string, kind = "assistant_message") =>
    ({ driver: "codex", type, message: { threadId, runId }, turnItem: { threadId, runId, type: kind } }) as unknown as ProviderAdapterV2Event;
  const text = event("turn_item.updated", "a", "1");
  expect([...router.recipients(all, text)]).toEqual([a]);
  for (const ambiguous of [event("message.updated", "b", "2"), event("message.updated", "b", "1"),
    event("turn_item.updated", "a", "1", "command_execution"), event("turn.terminal", "a", "1")]) {
    expect([...router.recipients(all, ambiguous)]).toEqual([a, b]);
  }
  expect([...router.recipients(new Map([...all, [3, {}]]), text)]).toHaveLength(3);
  expect([...router.recipients(new Map([[2, b]]), text)]).toEqual([b]);
});
