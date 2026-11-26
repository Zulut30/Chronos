import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import type { ProcessRunInput, ProcessRunner } from "../processRunner.ts";
import {
  captureIdleProcessGuard,
  idleProcessGuard,
  posixIdleTree,
  processTree,
} from "./claudeProcessGuard.ts";

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

it.effect("uses BSD-compatible ps flags with LC_ALL=C on macOS and parses single-digit days", () =>
  Effect.gen(function* () {
    const calls: Array<{
      readonly command: string;
      readonly args: ReadonlyArray<string>;
      readonly env: NodeJS.ProcessEnv | undefined;
    }> = [];
    const boot = [
      "  100     1   100 Thu Nov  5 08:00:00 2026",
      "  101   100   100 Thu Nov  5 08:00:01 2026",
    ].join("\n");
    let current = boot;
    const runner: ProcessRunner["Service"] = {
      run: (input: ProcessRunInput) => {
        calls.push({ command: input.command, args: input.args, env: input.env });
        return Effect.succeed({
          code: ChildProcessSpawner.ExitCode(0),
          stdout: current,
          stderr: "",
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdoutInvalidUtf8: false,
          stderrInvalidUtf8: false,
        });
      },
    };

    const check = yield* captureIdleProcessGuard(runner, false, "", 100, () => []);
    assert.deepEqual(calls[0], {
      command: "ps",
      args: ["-A", "-ww", "-o", "pid=", "-o", "ppid=", "-o", "pgid=", "-o", "lstart="],
      env: { LC_ALL: "C" },
    });
    assert.isTrue(yield* check);

    current = boot + "\n  102   101   100 Thu Nov  5 08:05:00 2026";
    assert.isFalse(yield* check);
  }),
);
