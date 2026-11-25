import { expect, it } from "vite-plus/test";
import * as Exit from "effect/Exit";
import type * as Tracer from "effect/Tracer";
import { makeLocalTraceRetention } from "./localTraceRetention.ts";

it("keeps failed exits and warning/error logs even between sampled successes", () => {
  const keep = makeLocalTraceRetention();
  const span = (level: string, exit: Exit.Exit<unknown, unknown> = Exit.void): Pick<Tracer.Span, "events" | "status"> => ({
    status: { _tag: "Ended", startTime: 0n, endTime: 1n, exit },
    events: [["message", 0n, { "effect.logLevel": level }]],
  });
  expect(Array.from({ length: 32 }, () => keep(span("Info"))).filter(Boolean)).toHaveLength(2);
  for (const level of ["Warning", "Error", "Fatal"]) expect(keep(span(level))).toBe(true);
  expect(keep(span("Info", Exit.fail("late failure")))).toBe(true);
});
