import { expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import { makeThreadChannels } from "./threadChannels.ts";

it("isolates mixed commits, shares active channels and releases the last reference", async () => {
  const channels = makeThreadChannels((event: string) => event[0]!);
  const first = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const bus = yield* channels.acquire("a");
    const a = yield* PubSub.subscribe(bus);
    const b = yield* PubSub.subscribe(yield* channels.acquire("b"));
    yield* Effect.scoped(Effect.gen(function* () {
      expect(yield* channels.acquire("a")).toBe(bus);
    }));
    yield* channels.publish(["a1", "b2", "c3", "a4"]);
    expect(yield* PubSub.takeAll(a)).toEqual(["a1", "a4"]);
    expect(yield* PubSub.takeAll(b)).toEqual(["b2"]);
    return bus;
  })));
  expect(await Effect.runPromise(Effect.scoped(channels.acquire("a")))).not.toBe(first);
});
