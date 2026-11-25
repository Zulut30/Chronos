// @effect-diagnostics nodeBuiltinImport:off -- The test uses fake native child handles and a temporary service log directory.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { supervise } from "./Sidecars.ts";

const service = { name: "tasks-service", port: 4518, health: "/api/health" };
let baseDir: string;
beforeEach(() => {
  baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "chronos-sidecars-"));
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  NodeFS.rmSync(baseDir, { recursive: true, force: true });
});
function fixture() {
  let exit: (reason: string) => void;
  const probe = vi.fn<() => Promise<"available" | "external" | "occupied">>().mockResolvedValue("available");
  const launch = vi.fn((_service: typeof service, onExit: typeof exit) => { exit = onExit; });
  const start = () => supervise(service, { baseDir, env: {}, executable: "electron", resources: "/resources" }, { probe, launch });
  return { crash: () => exit("worker exit"), probe, launch, start };
}

describe("Chronos sidecars", () => {
  it("leaves an external service and unknown listeners alone, takes over when the port is free", async () => {
    const f = fixture();
    f.probe.mockResolvedValueOnce("external").mockResolvedValueOnce("occupied");
    const stop = f.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.launch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.launch).toHaveBeenCalledOnce();
    stop();
  });

  it("rechecks the port before restarting a crashed child and cancels retries at shutdown", async () => {
    const f = fixture();
    const stop = f.start();
    await vi.advanceTimersByTimeAsync(0);
    f.crash();
    await vi.advanceTimersByTimeAsync(999);
    expect(f.launch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.launch).toHaveBeenCalledTimes(2);
    f.crash();
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.probe).toHaveBeenCalledTimes(2);
  });

  it("does not spawn after shutdown during a pending probe", async () => {
    const f = fixture();
    const gated = Promise.withResolvers<"available">();
    f.probe.mockReturnValueOnce(gated.promise);
    const stop = f.start();
    stop();
    gated.resolve("available");
    await vi.advanceTimersByTimeAsync(0);
    expect(f.launch).not.toHaveBeenCalled();
  });
});
