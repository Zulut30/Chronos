// @effect-diagnostics nodeBuiltinImport:off -- Print mode needs a private home with a Windows directory junction, and a bounded CLI invocation with closed stdin.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import type { ServerProviderUsageLimits, ServerProviderUsageWindow } from "@t3tools/contracts";
import { compareSemverVersions } from "@t3tools/shared/semver";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import type { AntigravityAuth } from "../../provider/AntigravityAuth.ts";
import type {
  AntigravityExecutable,
  AntigravityInstallationError,
} from "../../provider/AntigravityInstallation.ts";

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const Report = Schema.fromJsonString(
  Schema.Struct({
    status: Schema.Literal("SUCCESS"),
    num_turns: Schema.Literal(0),
    command: Schema.Struct({
      name: Schema.Literal("usage"),
      data: Schema.Struct({
        groups: Schema.Array(
          Schema.Struct({
            name: Schema.NonEmptyString,
            buckets: Schema.Array(
              Schema.Struct({
                id: Schema.NonEmptyString,
                name: Schema.NonEmptyString,
                window: Schema.String,
                remaining_fraction: Schema.Number.check(
                  Schema.isBetween({ minimum: 0, maximum: 1 }),
                ),
                reset_time: Schema.optional(Schema.String),
              }),
            ),
          }),
        ),
      }),
    }),
  }),
);

const decodeReport = Schema.decodeUnknownSync(Report);
const familyLabels = new Map([
  ["Gemini Models", "Gemini"],
  ["Claude and GPT models", "Claude & GPT (shared)"],
]);

export function parseQuota(output: string): ReadonlyArray<ServerProviderUsageWindow> {
  const report = decodeReport(output);
  const windows = report.command.data.groups.flatMap((group) =>
    group.buckets.map((bucket): ServerProviderUsageWindow => {
      const session = bucket.window === "5h";
      const weekly = bucket.window === "weekly";
      const resetTime = bucket.reset_time ? DateTime.makeUnsafe(bucket.reset_time) : undefined;
      return {
        id: bucket.id,
        kind: session ? "session" : weekly ? "weekly" : "other",
        label: `${familyLabels.get(group.name) ?? group.name} · ${session ? "5-hour" : weekly ? "Weekly" : bucket.name}`,
        // Native /usage names model families but reports no model IDs to route a fallback.
        modelIds: [],
        usedPercent: (1 - bucket.remaining_fraction) * 100,
        // The CLI reports the Unix epoch when a bucket has no scheduled reset.
        ...(resetTime && DateTime.toEpochMillis(resetTime) !== 0
          ? { resetsAt: DateTime.formatIso(resetTime) }
          : {}),
        ...(session || weekly ? { windowDurationMins: session ? 300 : 10080 } : {}),
      };
    }),
  );
  if (!windows.length) throw new Error("Antigravity returned no quota windows.");
  return windows;
}

const networkAndRuntime =
  /^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|SSL_CERT_FILE|SSL_CERT_DIR|LANG|LC_ALL)$/i;
const runAgy = async (
  executable: string,
  args: string[],
  home: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
) => {
  const result = exec(executable, args, {
    cwd: home,
    env,
    signal,
    windowsHide: true,
    timeout: 20_000,
    killSignal: "SIGKILL",
    maxBuffer: 256 * 1024,
    encoding: "utf8",
  });
  result.child.stdin?.end();
  return (await result).stdout;
};

export async function readNativeQuota(
  input: {
    readonly acpDirectory: string;
    readonly executable: string;
    readonly environment: NodeJS.ProcessEnv;
    readonly checkedAt: string;
    readonly signal: AbortSignal;
  },
  run = runAgy,
): Promise<ServerProviderUsageLimits> {
  const unavailable = (reason: "unsupported" | "probeFailed", message: string) => ({
    checkedAt: input.checkedAt,
    windows: [],
    unavailable: { reason, message },
  });
  try {
    const token = await NodeFSP.lstat(
      NodePath.join(input.acpDirectory, "antigravity-oauth-token"),
    ).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return undefined;
    });
    if (!token) return unavailable("unsupported", "Sign in with Google to see Antigravity limits.");
    if (!token.isFile() || !(await NodeFSP.lstat(input.acpDirectory)).isDirectory()) {
      return unavailable("probeFailed", "Could not verify the Antigravity instance profile.");
    }
    const home = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "chronos-agy-quota-"));
    try {
      const gemini = NodePath.join(home, ".gemini");
      await NodeFSP.mkdir(gemini);
      // Print mode ignores ACP's --gemini-dir and --app-data-dir. Give its native file store
      // a view of exactly this ACP profile, including token refreshes performed by agy itself.
      await NodeFSP.symlink(
        input.acpDirectory,
        NodePath.join(gemini, "antigravity-cli"),
        "junction",
      );
      const env: NodeJS.ProcessEnv = {
        ...Object.fromEntries(
          Object.entries(input.environment).filter(([key]) => networkAndRuntime.test(key)),
        ),
        HOME: home,
        USERPROFILE: home,
        APPDATA: home,
        LOCALAPPDATA: home,
        SSH_CONNECTION: "127.0.0.1 0 127.0.0.1 0",
        AGY_CLI_DISABLE_AUTO_UPDATE: "true",
      };
      const reported = (await run(input.executable, ["--version"], home, env, input.signal)).trim();
      // Before v1.1.11 the CLI can send /usage to a model instead of handling it locally.
      if (!/^v?\d+\.\d+\.\d+$/.test(reported) || compareSemverVersions(reported, "1.1.11") < 0) {
        return unavailable("unsupported", "Update the Antigravity CLI to read account limits.");
      }
      const output = await run(
        input.executable,
        ["-p", "/usage", "--output-format", "json"],
        home,
        env,
        input.signal,
      );
      try {
        return { checkedAt: input.checkedAt, windows: parseQuota(output) };
      } catch {
        return unavailable("probeFailed", "Antigravity returned an unreadable quota report.");
      }
    } finally {
      await NodeFSP.rm(home, { recursive: true, force: true });
    }
  } catch {
    return unavailable(
      "probeFailed",
      "The Antigravity CLI could not read limits for this Google account.",
    );
  }
}

export const readInstanceQuota = Effect.fn("Antigravity.readInstanceQuota")(function* (input: {
  readonly installation: Effect.Effect<
    AntigravityExecutable,
    AntigravityInstallationError,
    Scope.Scope
  >;
  readonly withProcess: AntigravityAuth["withProcess"];
  readonly profileDirectory: string;
  readonly environment: NodeJS.ProcessEnv;
}) {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const read = input.installation.pipe(
    Effect.flatMap(({ executablePath }) =>
      Effect.promise((signal) =>
        readNativeQuota({
          executable: executablePath,
          acpDirectory: NodePath.join(input.profileDirectory, "antigravity-acp"),
          environment: input.environment,
          checkedAt,
          signal,
        }),
      ),
    ),
  );
  return yield* input.withProcess(Effect.void, read).pipe(
    Effect.orElseSucceed(() => ({
      checkedAt,
      windows: [],
      unavailable: {
        reason: "probeFailed" as const,
        message: "Could not start the Antigravity CLI to read limits.",
      },
    })),
    Effect.scoped,
  );
});
