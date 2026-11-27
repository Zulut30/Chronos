// @effect-diagnostics nodeBuiltinImport:off -- Pure filesystem probe for the bundled native ACP MCP bridge.
// chronos: resolve the lightweight native Rust ACP MCP stdio bridge when packaged alongside the server.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { SelfInvocation } from "@t3tools/shared/nodeRuntime";

export interface NativeAcpMcpBridgeCommand {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

export interface ResolveNativeAcpMcpBridgeInput {
  readonly self: SelfInvocation;
  readonly endpoint: string;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly platform?: NodeJS.Platform | undefined;
  readonly isElectron?: boolean | undefined;
  readonly existsSync?: ((candidate: string) => boolean) | undefined;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const DISABLED_VALUES = new Set(["0", "false", "js", "off", "no"]);

export function isLoopbackHttpEndpoint(endpoint: string): boolean {
  try {
    const parsed = new URL(endpoint);
    return parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function resolveNativeAcpMcpBridge(
  input: ResolveNativeAcpMcpBridgeInput,
): NativeAcpMcpBridgeCommand | undefined {
  if (!isLoopbackHttpEndpoint(input.endpoint)) return undefined;

  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const isElectron =
    input.isElectron ?? Boolean((process.versions as Record<string, string | undefined>).electron);
  const existsSync = input.existsSync ?? NodeFS.existsSync;

  const explicit = env.CHRONOS_ACP_MCP_BRIDGE?.trim();
  if (explicit !== undefined && explicit.length > 0) {
    if (DISABLED_VALUES.has(explicit.toLowerCase())) return undefined;
    if (existsSync(explicit)) {
      return { command: explicit, args: ["--chronos-acp-mcp-bridge"] };
    }
    return undefined;
  }

  const inhibitor = env.CHRONOS_WINDOWS_INHIBITOR?.trim();
  if (inhibitor !== undefined && inhibitor.length > 0 && existsSync(inhibitor)) {
    return { command: inhibitor, args: ["--chronos-acp-mcp-bridge"] };
  }

  if (!isElectron && input.self.entrypoint !== undefined) {
    return undefined;
  }

  const pathApi = platform === "win32" ? NodePath.win32 : NodePath.posix;
  const binName = platform === "win32" ? "t3-resource-monitor.exe" : "t3-resource-monitor";
  const dir = pathApi.dirname(input.self.command);
  const candidates: Array<string> = [];
  if (isElectron) {
    if (platform === "darwin") {
      candidates.push(pathApi.join(dir, "..", "Resources", "resource-monitor", binName));
    } else {
      candidates.push(pathApi.join(dir, "resources", "resource-monitor", binName));
    }
  } else {
    candidates.push(pathApi.join(dir, "resource-monitor", binName));
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return { command: candidate, args: ["--chronos-acp-mcp-bridge"] };
    }
  }
  return undefined;
}
