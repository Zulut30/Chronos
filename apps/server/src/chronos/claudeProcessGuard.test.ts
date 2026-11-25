import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { idleProcessGuard, processTree } from "./claudeProcessGuard.ts";

it.effect(
  "idle process check admits startup MCP, pins new jobs and fails closed on a missing tree",
  () =>
    Effect.gen(function* () {
      const boot = "100 1 root\n101 100 mcp\n102 101 worker\n200 1 unrelated";
      const initial = processTree(boot, 100);
      const safe = (table: string) =>
        idleProcessGuard(initial, Effect.succeed(processTree(table, 100)));
      assert.isTrue(yield* safe(boot));
      assert.isTrue(yield* safe(boot.replace("102 101 worker\n", "")));
      assert.isFalse(yield* safe(boot + "\n205 101 tool-job"));
      assert.isFalse(yield* safe(boot.replace("101 100 mcp", "101 100 reused-pid")));
      assert.isFalse(yield* safe("999 1 other"));
      assert.isFalse(yield* safe("partial snapshot"));
      assert.isFalse(yield* idleProcessGuard(undefined, Effect.succeed(initial)));
    }),
);
