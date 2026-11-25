// Windows has no POSIX process groups for pgrep to inspect.
export function groupProbeArgs(platform: NodeJS.Platform, pid: number): string[] | null {
  return platform === "win32" ? null : ["-g", String(pid)];
}
