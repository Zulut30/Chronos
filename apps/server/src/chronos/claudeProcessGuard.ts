// @effect-diagnostics-next-line nodeBuiltinImport:off -- The Windows probe needs a hidden process with an immediately closed stdin and a bounded, abortable capture.
import { execFile } from "node:child_process";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { promisify } from "node:util";
import * as Effect from "effect/Effect";
import type { ProcessRunner } from "../processRunner.ts";

type Tree = ReadonlySet<string>;

// Opt-in diagnostics log only lifecycle state, never paths, arguments or prompts.
export const idleUnloadTracing = () => process.env.CHRONOS_TRACE_IDLE_UNLOAD === "1";

export function traceIdleUnload(phase: string, fields: object) {
  if (idleUnloadTracing()) {
    process.stderr.write("chronos-idle " + JSON.stringify({ phase, ...fields }) + "\n");
  }
}

// Only keep identities (PID and creation time), never arguments or environment. A later
// helper, even one with a familiar MCP executable name, could be doing the agent's work.
export function processTree(
  table: string,
  root: number,
  extraRoots: ReadonlyArray<number> = [],
): Tree | undefined {
  const children = new Map<number, number[]>();
  const identities = new Map<number, string>();
  for (const line of table.trim().split(/\r?\n/u)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/u.exec(line);
    if (!match) return undefined;
    const pid = Number(match[1]);
    const parent = Number(match[2]);
    identities.set(pid, match[3]!);
    const siblings = children.get(parent) ?? [];
    siblings.push(pid);
    children.set(parent, siblings);
  }
  if (!identities.has(root)) return undefined;
  const tree = new Set<string>();
  const pending = [root, ...extraRoots.filter((pid) => identities.has(pid))];
  for (let pid = pending.pop(); pid !== undefined; pid = pending.pop()) {
    const birth = identities.get(pid);
    if (!birth || birth === "?") return undefined;
    const key = pid + "/" + birth;
    if (tree.has(key)) continue;
    tree.add(key);
    for (const child of children.get(pid) ?? []) pending.push(child);
  }
  return tree;
}

// POSIX shutdown also kills the CLI group, groups of previously tracked jobs and the
// systemd scope. Include their live members even if a daemon has changed its parent.
export function posixIdleTree(
  table: string,
  root: number,
  tracked: ReadonlyArray<number>,
  unit?: string,
): Tree | undefined {
  const rows: string[] = [];
  const groupLeaders = new Set([root, ...tracked]);
  const roots = new Set(tracked);
  let foundScope = unit === undefined;
  for (const line of table.trim().split(/\r?\n/u)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d{4})(?:\s+(.*))?$/u.exec(
      line,
    );
    if (!match) return undefined;
    const [, pid, parent, group, birth, cgroup] = match;
    rows.push(pid + " " + parent + " " + birth);
    if (groupLeaders.has(Number(group))) roots.add(Number(pid));
    if (unit !== undefined && cgroup?.split(/[,/]/u).includes(unit)) {
      foundScope = true;
      roots.add(Number(pid));
    }
  }
  return foundScope ? processTree(rows.join("\n"), root, [...roots]) : undefined;
}

export const idleProcessGuard = (
  initial: Tree | undefined,
  read: Effect.Effect<Tree | undefined>,
) =>
  initial === undefined
    ? Effect.succeed(false)
    : read.pipe(
        Effect.map(
          (current) =>
            current !== undefined && [...current].every((identity) => initial.has(identity)),
        ),
      );

const execFileAsync = promisify(execFile);

const windowsTreeReader = Effect.fnUntraced(function* (systemRoot: string, pid: number) {
  const path = yield* Effect.serviceOption(Path.Path);
  const fs = yield* Effect.serviceOption(FileSystem.FileSystem);
  const environment = yield* HostProcess.Environment;
  const executable = yield* HostProcess.ExecutablePath;
  let monitor = environment.CHRONOS_WINDOWS_INHIBITOR;
  // A packaged Electron server can also be launched directly without the desktop bootstrap.
  if (!monitor && process.versions.electron && Option.isSome(path) && Option.isSome(fs)) {
    const candidate = path.value.join(
      path.value.dirname(executable), "resources", "resource-monitor", "t3-resource-monitor.exe",
    );
    if (yield* fs.value.exists(candidate).pipe(Effect.orElseSucceed(() => false))) monitor = candidate;
  }
  traceIdleUnload("windows-reader", { source: monitor ? "resource-monitor" : "cim" });
  const command = monitor ?? systemRoot + "/System32/WindowsPowerShell/v1.0/powershell.exe";
  const args = monitor
    ? ["--chronos-process-tree", String(pid)]
    : [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate | ForEach-Object { $born=if ($_.CreationDate) {$_.CreationDate.ToFileTimeUtc()} else {'?'}; '{0} {1} {2}' -f $_.ProcessId,$_.ParentProcessId,$born }",
      ];
  return Effect.tryPromise({
    try: async (signal) => {
      const result = execFileAsync(command, args, {
        encoding: "utf8",
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 2 * 1024 * 1024,
        signal,
      });
      result.child.stdin?.end();
      const { stdout } = await result;
      return processTree(stdout, pid);
    },
    catch: () => "snapshot unavailable",
  }).pipe(Effect.orElseSucceed(() => undefined));
});

export const captureIdleProcessGuard = Effect.fnUntraced(function* (
  runner: ProcessRunner["Service"],
  windows: boolean,
  systemRoot: string,
  pid: number | undefined,
  tracked: () => ReadonlyArray<number>,
  unit?: string,
) {
  if (pid === undefined) {
    traceIdleUnload("process-baseline", { available: false, reason: "missing-pid" });
    return Effect.succeed(false);
  }
  const read = windows ? yield* windowsTreeReader(systemRoot, pid) : runner.run({
    command: "ps",
    // Separate -o options are required for BSD ps on macOS (it treats everything after the first '=' as a column header),
    // and LC_ALL=C keeps lstart in the fixed English `Dow Mon DD HH:MM:SS YYYY` format regardless of OS locale.
    args: [
      "-A",
      "-ww",
      "-o",
      "pid=",
      "-o",
      "ppid=",
      "-o",
      "pgid=",
      "-o",
      "lstart=",
      ...(unit === undefined ? [] : ["-o", "cgroup="]),
    ],
    env: { LC_ALL: "C" },
    timeout: "5 seconds",
    maxOutputBytes: 2 * 1024 * 1024,
  }).pipe(
    Effect.map((out) =>
      out.code === 0 && !out.stdoutTruncated ? posixIdleTree(out.stdout, pid, tracked(), unit) : undefined,
    ),
    Effect.orElseSucceed(() => undefined),
  );
  const initial = yield* read;
  traceIdleUnload("process-baseline", { available: initial !== undefined, count: initial?.size });
  return idleProcessGuard(initial, read);
});
