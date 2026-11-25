import { expect } from "vite-plus/test";
import { MessageId, RunId, type ThreadId } from "@t3tools/contracts";
import type { ProviderAdapterV2Event, ProviderAdapterV2SessionRuntime } from "@t3tools/provider-core/server/ProviderAdapter";
import type * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { RunSubscriber } from "./codexRecipients.ts";

export const verifySharedRunQueues = Effect.fnUntraced(function* (
  runtime: ProviderAdapterV2SessionRuntime,
  queue: Queue.Queue<ProviderAdapterV2Event, Cause.Done>,
  first: ThreadId,
  second: ThreadId,
) {
  const subscribe = (threadId: ThreadId) => runtime.subscribeEvents!.pipe(
    Effect.provideService(RunSubscriber, { threadId, runId: threadId, root: true }),
  );
  const a = yield* subscribe(first);
  const b = yield* subscribe(second);
  const steer: ProviderAdapterV2Event = {
    type: "steer.updated",
    driver: runtime.driver,
    threadId: first,
    runId: RunId.make(first),
    messageId: MessageId.make("test-steer"),
    status: "pending",
  };
  const boundary: ProviderAdapterV2Event = {
    type: "provider_session.updated",
    driver: runtime.driver,
    providerSession: runtime.providerSession,
  };
  yield* Queue.offerAll(queue, [steer, boundary]);
  const own = yield* a.events.pipe(Stream.take(2), Stream.runCollect);
  const sibling = yield* b.events.pipe(Stream.take(1), Stream.runCollect);
  expect(own.map((event) => event.type)).toEqual([steer.type, boundary.type]);
  expect(sibling.map((event) => event.type)).toEqual([boundary.type]);
});
