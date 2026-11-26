import { afterEach, expect, it, vi } from "vite-plus/test";

const { expose, clerk } = vi.hoisted(() => ({ expose: vi.fn(), clerk: vi.fn() }));
vi.mock("@clerk/electron/preload", () => ({ exposeClerkBridge: clerk }));
vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: expose },
  ipcRenderer: { on: vi.fn(), invoke: vi.fn(), sendSync: vi.fn() },
  webFrame: {},
  webUtils: {},
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.resetModules();
});

it.each([true, false])("matches desktop capabilities to offline rehearsal = %s", async (offline) => {
  vi.stubEnv("CHRONOS_SWITCH_REHEARSAL", offline ? "1" : undefined);
  vi.stubGlobal("window", { addEventListener: vi.fn() });
  vi.stubGlobal("document", { fullscreenElement: null, addEventListener: vi.fn() });
  await import("./preload.ts");

  const bridges = new Map(expose.mock.calls.map(([name, api]) => [name, api]));
  expect(bridges.get("desktopBridge").offlineRehearsal).toBe(offline);
  expect(bridges.has("chronosPC")).toBe(!offline);
  expect(clerk).toHaveBeenCalledTimes(offline ? 0 : 1);
});
