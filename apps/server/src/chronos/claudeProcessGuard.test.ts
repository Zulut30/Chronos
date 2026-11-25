import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { idleProcessGuard, posixIdleTree, processTree } from "./claudeProcessGuard.ts";

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

it("counts reparented POSIX processes owned by the group, tracker or systemd scope", () => {
  const birth = "Wed Nov 25 08:00:00 2026";
  const base = "100 1 100 " + birth + " /app/t3.scope";
  const extras = ["201 1 100", "202 1 202", "203 1 203", "204 1 204"];
  const table = [
    base,
    ...extras.map(
      (row, index) => row + " " + birth + (index === 2 ? " /app/t3.scope/nested" : " /other"),
    ),
  ].join("\n");
  const expected = new Set([100, 201, 202, 203].map((id) => id + "/" + birth));
  assert.deepEqual(posixIdleTree(table, 100, [202], "t3.scope"), expected);
  assert.isUndefined(posixIdleTree(table, 100, [], "missing.scope"));
});
