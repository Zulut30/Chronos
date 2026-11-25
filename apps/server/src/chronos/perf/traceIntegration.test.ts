import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { makeLocalFileTracer, type EffectTraceRecord } from "@t3tools/shared/observability";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import * as Tracer from "effect/Tracer";
import { localTraceRetention } from "./localTraceRetention.ts";

it.effect("retains actual warning logs and late failures, and honors explicit full tracing", () =>
  Effect.gen(function* () {
    for (const explicit of [false, true]) {
      const records: EffectTraceRecord[] = [];
      const keepLocalSpan = yield* localTraceRetention.pipe(
        Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({
          env: explicit ? { T3CODE_TRACE_MIN_LEVEL: "Info" } : {},
        })),
      );
      const tracer = yield* makeLocalFileTracer({
        filePath: "unused", maxBytes: 8192, maxFiles: 1, batchWindowMs: 1000, keepLocalSpan,
        sink: {
          filePath: "unused",
          push: (record) => { if (record.type === "effect-span") records.push(record); },
          flush: Effect.void, flushSync: () => {}, close: () => Effect.void,
        },
      });
      yield* Effect.gen(function* () {
        for (let i = 0; i < 32; i++) yield* Effect.void.pipe(Effect.withSpan("quiet"));
        yield* Effect.logWarning("slow request").pipe(Effect.withSpan("warning-inside-info"));
        yield* Effect.logError("recoverable error").pipe(Effect.withSpan("logged-error"));
        yield* Effect.fail("late").pipe(Effect.withSpan("failed-at-end"), Effect.ignore);
      }).pipe(
        Effect.provideService(Tracer.Tracer, tracer),
        Effect.provide(Logger.layer([Logger.tracerLogger], { mergeWithExisting: false })),
      );
      assert.equal(records.filter((record) => record.name === "quiet").length, explicit ? 32 : 2);
      for (const name of ["warning-inside-info", "logged-error", "failed-at-end"]) {
        assert.isTrue(records.some((record) => record.name === name));
      }
    }
  }).pipe(Effect.provide(NodeServices.layer)),
);
