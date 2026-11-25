import { expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import { makeSnapshotSizer } from "./snapshotBytes.ts";

it("encodes each snapshot identity once and counts UTF-8 bytes", async () => {
  let calls = 0;
  const size = makeSnapshotSizer((value) => Effect.sync(() => {
    calls++;
    return JSON.stringify(value);
  }));
  const event = { text: "привет" };
  const result = await Effect.runPromise(Effect.all([size(event), size(event), size({ ...event })]));
  expect(result).toEqual(Array(3).fill(Buffer.byteLength(JSON.stringify(event))));
  expect(calls).toBe(2);
});
