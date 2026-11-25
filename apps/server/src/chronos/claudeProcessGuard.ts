import * as Effect from "effect/Effect";
import type { ProcessRunner } from "../processRunner.ts";

type Tree = ReadonlySet<string>;

// Only keep identities (PID and creation time), never arguments or environment. A later
// helper, even one with a familiar MCP executable name, could be doing the agent's work.
export function processTree(table: string, root: number): Tree | undefined {
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
  const pending = [root];
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

export const captureIdleProcessGuard = Effect.fnUntraced(function* (
  runner: ProcessRunner["Service"],
  windows: boolean,
  systemRoot: string,
  pid: number | undefined,
) {
  if (pid === undefined) return Effect.succeed(false);
  const command = windows
    ? {
        command: systemRoot + "\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate | ForEach-Object { $born=if ($_.CreationDate) {$_.CreationDate.ToFileTimeUtc()} else {'?'}; '{0} {1} {2}' -f $_.ProcessId,$_.ParentProcessId,$born }",
        ],
      }
    : { command: "ps", args: ["-A", "-o", "pid=,ppid=,lstart="] };
  const read = runner
    .run({ ...command, timeout: "5 seconds", maxOutputBytes: 2 * 1024 * 1024 })
    .pipe(
      Effect.map((out) =>
        out.code === 0 && !out.stdoutTruncated ? processTree(out.stdout, pid) : undefined,
      ),
      Effect.orElseSucceed(() => undefined),
    );
  return idleProcessGuard(yield* read, read);
});
