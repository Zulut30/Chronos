import { describe, expect, it } from "@effect/vitest";

import { isLoopbackHttpEndpoint, resolveNativeAcpMcpBridge } from "./nativeAcpMcpBridge.ts";

describe("nativeAcpMcpBridge", () => {
  it("recognizes loopback plain HTTP endpoints only", () => {
    expect(isLoopbackHttpEndpoint("http://127.0.0.1:43123/mcp")).toBe(true);
    expect(isLoopbackHttpEndpoint("http://localhost:43123/mcp")).toBe(true);
    expect(isLoopbackHttpEndpoint("http://[::1]:43123/mcp")).toBe(true);
    expect(isLoopbackHttpEndpoint("https://127.0.0.1:43123/mcp")).toBe(false);
    expect(isLoopbackHttpEndpoint("http://192.168.1.5:43123/mcp")).toBe(false);
    expect(isLoopbackHttpEndpoint("not-a-url")).toBe(false);
  });

  it("returns undefined for dev node invocations without explicit override", () => {
    const resolved = resolveNativeAcpMcpBridge({
      self: { command: "/usr/bin/node", entrypoint: "/repo/apps/server/dist/bin.mjs" },
      endpoint: "http://127.0.0.1:43123/mcp",
      env: {},
      platform: "linux",
      isElectron: false,
      existsSync: () => true,
    });
    expect(resolved).toBeUndefined();
  });

  it("resolves packaged Windows, macOS Electron, and SEA CLI resource-monitor binaries", () => {
    const winBin = "C:\\Chronos\\resources\\resource-monitor\\t3-resource-monitor.exe";
    expect(
      resolveNativeAcpMcpBridge({
        self: {
          command: "C:\\Chronos\\Chronos.exe",
          entrypoint: "C:\\Chronos\\resources\\server.asar\\apps\\server\\dist\\bin.mjs",
        },
        endpoint: "http://127.0.0.1:43123/mcp",
        env: {},
        platform: "win32",
        isElectron: true,
        existsSync: (p) => p === winBin,
      }),
    ).toEqual({ command: winBin, args: ["--chronos-acp-mcp-bridge"] });

    const macBin = "/Applications/Chronos.app/Contents/Resources/resource-monitor/t3-resource-monitor";
    expect(
      resolveNativeAcpMcpBridge({
        self: {
          command: "/Applications/Chronos.app/Contents/MacOS/Chronos",
          entrypoint: "/Applications/Chronos.app/Contents/Resources/app.asar/apps/server/dist/bin.mjs",
        },
        endpoint: "http://127.0.0.1:43123/mcp",
        env: {},
        platform: "darwin",
        isElectron: true,
        existsSync: (p) => p === macBin,
      }),
    ).toEqual({ command: macBin, args: ["--chronos-acp-mcp-bridge"] });

    const cliBin = "/opt/chronos/resource-monitor/t3-resource-monitor";
    expect(
      resolveNativeAcpMcpBridge({
        self: { command: "/opt/chronos/t3", entrypoint: undefined },
        endpoint: "http://127.0.0.1:43123/mcp",
        env: {},
        platform: "linux",
        isElectron: false,
        existsSync: (p) => p === cliBin,
      }),
    ).toEqual({ command: cliBin, args: ["--chronos-acp-mcp-bridge"] });
  });

  it("honors explicit CHRONOS_ACP_MCP_BRIDGE opt-out and path overrides", () => {
    const winBin = "C:\\Chronos\\resources\\resource-monitor\\t3-resource-monitor.exe";
    expect(
      resolveNativeAcpMcpBridge({
        self: { command: "C:\\Chronos\\Chronos.exe", entrypoint: "bin.mjs" },
        endpoint: "http://127.0.0.1:43123/mcp",
        env: { CHRONOS_ACP_MCP_BRIDGE: "js", CHRONOS_WINDOWS_INHIBITOR: winBin },
        platform: "win32",
        isElectron: true,
        existsSync: () => true,
      }),
    ).toBeUndefined();

    expect(
      resolveNativeAcpMcpBridge({
        self: { command: "/usr/bin/node", entrypoint: "bin.mjs" },
        endpoint: "http://127.0.0.1:43123/mcp",
        env: { CHRONOS_ACP_MCP_BRIDGE: "/custom/t3-resource-monitor" },
        platform: "linux",
        isElectron: false,
        existsSync: (p) => p === "/custom/t3-resource-monitor",
      }),
    ).toEqual({ command: "/custom/t3-resource-monitor", args: ["--chronos-acp-mcp-bridge"] });
  });
});
