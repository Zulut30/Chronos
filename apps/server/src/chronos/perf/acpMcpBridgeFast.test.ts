// @effect-diagnostics nodeBuiltinImport:off processEnvInEffect:off -- Bridge stdio tests feed PassThrough streams and spawn the native binary directly.
import * as NodeChildProcess from "node:child_process";
import * as NodeStream from "node:stream";

import { NodeHttpServer } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  OrchestratorMcpFailure,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { HttpRouter, HttpServer } from "effect/http";
import * as NetAddress from "effect/net/NetAddress";
import { vi } from "vite-plus/test";

import * as McpHttpServer from "../../mcp/McpHttpServer.ts";
import type * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as McpSessionRegistry from "../../mcp/McpSessionRegistry.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import * as McpToolAccessTestkit from "../../mcp/McpToolAccess.testkit.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { runAcpMcpBridgeFastCli, runAcpMcpStdioBridgeFast } from "./acpMcpBridgeFast.ts";

function makeHarness(
  responder: (request: Request) => Promise<Response> | Response,
  input = new NodeStream.PassThrough(),
  signal?: AbortSignal,
) {
  const written: Array<string> = [];
  const requests: Array<{ readonly headers: Headers; readonly body: string }> = [];
  const bridge = runAcpMcpStdioBridgeFast({
    endpoint: "http://127.0.0.1:1/mcp",
    authorization: "Bearer bridge-test",
    input,
    output: {
      write: (chunk: string) => {
        written.push(chunk);
      },
    },
    fetchImplementation: async (_url, init) => {
      const request = new Request("http://127.0.0.1:1/mcp", init);
      requests.push({ headers: request.headers, body: String(init?.body ?? "") });
      return responder(request);
    },
    signal,
  });
  return { input, written, requests, bridge };
}

describe("acpMcpBridgeFast", () => {
  it("forwards requests and replays the session id and protocol version", async () => {
    const { input, written, requests, bridge } = makeHarness(() => {
      const body = JSON.parse(String(requests.at(-1)?.body ?? "{}")) as { id?: number };
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id ?? null,
          result: body.id === 1 ? { protocolVersion: "2025-06-18" } : { ok: true },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json", "mcp-session-id": "session-42" },
        },
      );
    });

    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`);
    input.end();
    await bridge;

    expect(written).toHaveLength(2);
    expect(JSON.parse(written[0]!)).toMatchObject({ id: 1 });
    expect(JSON.parse(written[1]!)).toMatchObject({ id: 2, result: { ok: true } });
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer bridge-test");
    expect(requests[1]?.headers.get("mcp-session-id")).toBe("session-42");
    expect(requests[1]?.headers.get("mcp-protocol-version")).toBe("2025-06-18");
  });

  it("acknowledges notifications silently and synthesizes errors for failed requests", async () => {
    let call = 0;
    const { input, written, bridge } = makeHarness(() => {
      call += 1;
      return call === 1
        ? new Response(null, { status: 202 })
        : new Response("upstream broke", { status: 500 });
    });

    input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" })}\n`);
    input.end();
    await bridge;

    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0]!)).toMatchObject({
      id: 3,
      error: { code: -32603 },
    });
  });

  it("emits parse errors for malformed JSON-RPC input", async () => {
    const { input, written, requests, bridge } = makeHarness(
      () => new Response(null, { status: 202 }),
    );

    input.end("{not-json}\n");
    await bridge;

    expect(requests).toHaveLength(0);
    expect(JSON.parse(written[0]!)).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
  });

  it("keeps U+2028, U+2029, split UTF-8 bytes, and CRLF boundaries intact", async () => {
    const { input, written, requests, bridge } = makeHarness(
      () => {
        const body = JSON.parse(String(requests.at(-1)?.body ?? "{}")) as { id?: number };
        return Response.json({ jsonrpc: "2.0", id: body.id, result: { ok: true } });
      },
      new NodeStream.PassThrough({ objectMode: true }),
    );

    const first = JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" });
    const second = JSON.stringify({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "echo", arguments: { text: "a\u2028b\u2029c\u{1f30d}" } },
    });

    // Split CRLF across chunks, split inside emoji UTF-8 bytes, and leave last line unterminated.
    const secondBytes = Buffer.from(second);
    const split = secondBytes.indexOf(Buffer.from("\u{1f30d}")) + 2;
    input.write(Buffer.from(`${first}\r`));
    input.write(Buffer.concat([Buffer.from("\n"), secondBytes.subarray(0, split)]));
    input.end(secondBytes.subarray(split));
    await bridge;

    expect(requests.map((request) => request.body)).toEqual([first, second]);
    expect(written.map((chunk) => JSON.parse(chunk))).toEqual([
      { jsonrpc: "2.0", id: 3, result: { ok: true } },
      { jsonrpc: "2.0", id: 4, result: { ok: true } },
    ]);
  });

  it("forwards SSE messages before the HTTP response closes and bypasses the barrier for responses", async () => {
    let responseController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let serverRequestWritten: (() => void) | undefined;
    const serverRequestReachedClient = new Promise<void>((resolve) => {
      serverRequestWritten = resolve;
    });
    const input = new NodeStream.PassThrough();
    const written: Array<string> = [];
    const bridge = runAcpMcpStdioBridgeFast({
      endpoint: "http://127.0.0.1:1/mcp",
      authorization: "Bearer bridge-test",
      input,
      output: {
        write: (chunk) => {
          written.push(chunk);
          if (JSON.parse(chunk).id === "server-request-1") serverRequestWritten?.();
        },
      },
      fetchImplementation: async (_url, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          readonly id?: unknown;
          readonly method?: unknown;
          readonly result?: unknown;
        };
        if (body.method === "tools/call") {
          return new Response(
            new ReadableStream<Uint8Array>({
              start: (controller) => {
                responseController = controller;
                controller.enqueue(
                  new TextEncoder().encode(
                    'data: {"jsonrpc":"2.0","id":"server-request-1","method":"elicitation/create","params":{}}\n\n',
                  ),
                );
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          );
        }
        expect(body).toMatchObject({ id: "server-request-1", result: { action: "accept" } });
        responseController?.enqueue(
          new TextEncoder().encode('data: {"jsonrpc":"2.0","id":7,"result":{}}\n\n'),
        );
        responseController?.close();
        return new Response(null, { status: 202 });
      },
    });

    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call" })}\n`);
    await serverRequestReachedClient;
    input.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: "server-request-1", result: { action: "accept" } })}\n`,
    );
    input.end();
    await bridge;

    expect(written.map((line) => JSON.parse(line).id)).toEqual(["server-request-1", 7]);
  });

  it("forwards cancellation while a tool SSE response is still open", async () => {
    let resolveResponseController!: (
      controller: ReadableStreamDefaultController<Uint8Array>,
    ) => void;
    const responseControllerReady = new Promise<ReadableStreamDefaultController<Uint8Array>>(
      (resolve) => {
        resolveResponseController = resolve;
      },
    );
    const methods: Array<string> = [];
    const input = new NodeStream.PassThrough();
    const written: Array<string> = [];
    const bridge = runAcpMcpStdioBridgeFast({
      endpoint: "http://127.0.0.1:1/mcp",
      authorization: "Bearer bridge-test",
      input,
      output: { write: (chunk) => written.push(chunk) },
      fetchImplementation: async (_url, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { readonly method?: string };
        methods.push(body.method ?? "");
        if (body.method === "tools/call") {
          return new Response(
            new ReadableStream<Uint8Array>({
              start: resolveResponseController,
            }),
            { headers: { "content-type": "text/event-stream" } },
          );
        }
        const controller = await responseControllerReady;
        controller.enqueue(
          new TextEncoder().encode('data: {"jsonrpc":"2.0","id":7,"result":{}}\n\n'),
        );
        controller.close();
        return new Response(null, { status: 202 });
      },
    });

    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call" })}\n`);
    await responseControllerReady;
    input.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 7 } })}\n`,
    );
    input.end();
    await bridge;

    expect(methods).toEqual(["tools/call", "notifications/cancelled"]);
    expect(JSON.parse(written[0]!)).toMatchObject({ id: 7, result: {} });
  });

  it("aborts in-flight fetch and exits when signal aborts even if stdin stays open", async () => {
    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const input = new NodeStream.PassThrough();
    const bridge = runAcpMcpStdioBridgeFast({
      endpoint: "http://127.0.0.1:1/mcp",
      authorization: "Bearer bridge-test",
      input,
      output: { write: () => undefined },
      signal: controller.signal,
      fetchImplementation: (_url, init) => {
        seenSignal = init?.signal ?? undefined;
        resolveStarted();
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        });
      },
    });

    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
    await started;
    controller.abort();
    await bridge;

    expect(seenSignal?.aborted).toBe(true);
  });

  it("exits with code 2 when required environment variables are missing", async () => {
    const originalEnv = process.env;
    const originalExitCode = process.exitCode;
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      process.env = { ...originalEnv };
      delete process.env.T3_ACP_MCP_ENDPOINT;
      delete process.env.T3_ACP_MCP_AUTHORIZATION;
      process.exitCode = undefined;
      await runAcpMcpBridgeFastCli();
      expect(process.exitCode).toBe(2);
      expect(stderr).toHaveBeenCalledWith(
        "acp-mcp-bridge requires T3_ACP_MCP_ENDPOINT and T3_ACP_MCP_AUTHORIZATION.\n",
      );
    } finally {
      stderr.mockRestore();
      process.env = originalEnv;
      process.exitCode = originalExitCode;
    }
  });

  it.live(
    "relays T3 MCP tools, SSE tool_search, tool errors, and live cancellation against McpHttpServer",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const token = "bridgeIntegrationToken";
          const scope: McpInvocationContext.McpThreadInvocationScope = {
            environmentId: EnvironmentId.make("env-bridge-test"),
            requestNamespace: token,
            thread: {
              threadId: ThreadId.make("thread-bridge-test"),
              providerSessionId: token,
              providerInstanceId: ProviderInstanceId.make("antigravity"),
            },
            client: undefined,
            capabilities: new Set(["orchestration"]),
            issuedAt: 1,
          };
          const slowStarted = yield* Deferred.make<void>();
          const slowInterrupted = yield* Deferred.make<boolean>();
          const BridgeToolkit = Toolkit.make(
            Tool.make("delegate_task", {
              description: "Delegates a task.",
              success: Schema.Struct({ ok: Schema.Boolean }),
              failure: OrchestratorMcpFailure,
              failureMode: "return",
            }),
            Tool.make("preview_open", {
              description: "Opens a browser preview.",
              success: Schema.Struct({ opened: Schema.Boolean }),
              failure: OrchestratorMcpFailure,
              failureMode: "return",
            }),
            Tool.make("failing_tool", {
              description: "Returns a structured tool error.",
              success: Schema.Struct({}),
              failure: OrchestratorMcpFailure,
              failureMode: "return",
            }),
            Tool.make("cancellable_tool", {
              description: "Waits until cancelled.",
              success: Schema.Struct({}),
              failure: OrchestratorMcpFailure,
              failureMode: "return",
            }),
          );
          const serverLayer = McpHttpServer.layerMcpTransport(
            Layer.mergeAll(
              McpHttpServer.toolkitRegistration(
                BridgeToolkit,
                McpToolAccess.toLayer(BridgeToolkit, {
                  delegate_task: McpToolAccess.reads(() => Effect.succeed({ ok: true })),
                  preview_open: McpToolAccess.reads(() => Effect.succeed({ opened: true })),
                  failing_tool: McpToolAccess.reads(() =>
                    Effect.fail(
                      new OrchestratorMcpFailure({
                        code: "invalid_request",
                        message: "Tool failed intentionally.",
                      }),
                    ),
                  ),
                  cancellable_tool: McpToolAccess.reads(() =>
                    Deferred.succeed(slowStarted, undefined).pipe(
                      Effect.andThen(Effect.never),
                      Effect.onInterrupt(() =>
                        Deferred.succeed(slowInterrupted, true).pipe(Effect.asVoid),
                      ),
                    ),
                  ),
                }),
              ),
              McpHttpServer.layerToolSearch,
            ),
          ).pipe(
            Layer.provide(ServerSettings.layerTest()),
            Layer.provide(McpToolAccessTestkit.liveThreadsLayer),
            Layer.provide(
              Layer.mock(McpSessionRegistry.McpSessionRegistry)({
                resolve: (presented) => Effect.succeed(presented === token ? scope : undefined),
              }),
            ),
          );
          yield* HttpRouter.serve(serverLayer, {
            disableListenLog: true,
            disableLogger: true,
          }).pipe(Layer.build);

          const { address } = yield* HttpServer.HttpServer;
          if (!NetAddress.isInetAddress(address)) throw new Error("Expected a TCP test server");
          const endpoint = `http://127.0.0.1:${address.port}/mcp`;

          const input = new NodeStream.PassThrough();
          const messages: Array<{
            readonly id?: unknown;
            readonly method?: string;
            readonly result?: {
              readonly tools?: ReadonlyArray<{ readonly name: string }>;
              readonly structuredContent?: unknown;
              readonly isError?: boolean;
              readonly content?: ReadonlyArray<{ readonly text?: string }>;
            };
            readonly error?: { readonly code?: number; readonly message?: string };
          }> = [];
          const bridge = runAcpMcpStdioBridgeFast({
            endpoint,
            authorization: `Bearer ${token}`,
            input,
            output: {
              write: (chunk) => {
                messages.push(JSON.parse(chunk));
              },
            },
          });

          const send = (message: unknown) => {
            input.write(`${JSON.stringify(message)}\n`);
          };
          send({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: { name: "bridge-e2e", version: "1.0.0" },
            },
          });
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
          send({
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: { name: "delegate_task", arguments: {} },
          });
          send({
            jsonrpc: "2.0",
            id: 4,
            method: "tools/call",
            params: { name: "tool_search", arguments: { query: "browser" } },
          });
          send({
            jsonrpc: "2.0",
            id: 5,
            method: "tools/call",
            params: { name: "failing_tool", arguments: {} },
          });
          send({
            jsonrpc: "2.0",
            id: 6,
            method: "tools/call",
            params: { name: "nonexistent_tool", arguments: {} },
          });
          send({
            jsonrpc: "2.0",
            id: 7,
            method: "tools/call",
            params: { name: "cancellable_tool", arguments: {} },
          });

          yield* Deferred.await(slowStarted);
          send({
            jsonrpc: "2.0",
            method: "notifications/cancelled",
            params: { requestId: 7, reason: "user cancelled" },
          });
          expect(yield* Deferred.await(slowInterrupted)).toBe(true);
          send({ jsonrpc: "2.0", id: 8, method: "ping", params: {} });

          input.end();
          yield* Effect.promise(() => bridge);

          const byId = (id: number) => messages.find((entry) => entry.id === id);
          expect(byId(1)?.result).toBeDefined();
          expect(byId(2)?.result?.tools?.map((entry) => entry.name).sort()).toEqual([
            "cancellable_tool",
            "delegate_task",
            "failing_tool",
            "preview_open",
          ]);
          expect(byId(3)?.result?.structuredContent).toEqual({ ok: true });
          expect(byId(4)?.result?.structuredContent).toEqual({
            tools: [{ name: "preview_open", description: "Opens a browser preview." }],
          });
          expect(byId(5)?.result).toMatchObject({
            isError: true,
            content: [{ text: expect.stringContaining("Tool failed intentionally.") }],
          });
          expect(byId(6)?.error).toMatchObject({
            code: -32602,
            message: expect.stringContaining("nonexistent_tool"),
          });
          expect(byId(7)).toBeUndefined();
          expect(byId(8)?.result).toEqual({});
        }),
      ).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );

  it.live(
    "relays T3 MCP tools, SSE tool_search, tool errors, and live cancellation via native --chronos-acp-mcp-bridge",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const nativeBridge = process.env.CHRONOS_TEST_NATIVE_BRIDGE;
          if (!nativeBridge) return;

          const missingEnv = NodeChildProcess.spawnSync(
            nativeBridge,
            ["--chronos-acp-mcp-bridge"],
            {
              env: {},
              encoding: "utf8",
              timeout: 5_000,
              windowsHide: true,
            },
          );
          expect(missingEnv.status).toBe(2);
          expect(missingEnv.stderr).toBe(
            "acp-mcp-bridge requires T3_ACP_MCP_ENDPOINT and T3_ACP_MCP_AUTHORIZATION.\n",
          );

          const token = "nativeBridgeIntegrationToken";
          const scope: McpInvocationContext.McpThreadInvocationScope = {
            environmentId: EnvironmentId.make("env-native-bridge-test"),
            requestNamespace: token,
            thread: {
              threadId: ThreadId.make("thread-native-bridge-test"),
              providerSessionId: token,
              providerInstanceId: ProviderInstanceId.make("antigravity"),
            },
            client: undefined,
            capabilities: new Set(["orchestration"]),
            issuedAt: 1,
          };
          const slowStarted = yield* Deferred.make<void>();
          const slowInterrupted = yield* Deferred.make<boolean>();
          const BridgeToolkit = Toolkit.make(
            Tool.make("delegate_task", {
              description: "Delegates a task.",
              success: Schema.Struct({ ok: Schema.Boolean }),
              failure: OrchestratorMcpFailure,
              failureMode: "return",
            }),
            Tool.make("preview_open", {
              description: "Opens a browser preview.",
              success: Schema.Struct({ opened: Schema.Boolean }),
              failure: OrchestratorMcpFailure,
              failureMode: "return",
            }),
            Tool.make("failing_tool", {
              description: "Returns a structured tool error.",
              success: Schema.Struct({}),
              failure: OrchestratorMcpFailure,
              failureMode: "return",
            }),
            Tool.make("cancellable_tool", {
              description: "Waits until cancelled.",
              success: Schema.Struct({}),
              failure: OrchestratorMcpFailure,
              failureMode: "return",
            }),
          );
          const serverLayer = McpHttpServer.layerMcpTransport(
            Layer.mergeAll(
              McpHttpServer.toolkitRegistration(
                BridgeToolkit,
                McpToolAccess.toLayer(BridgeToolkit, {
                  delegate_task: McpToolAccess.reads(() => Effect.succeed({ ok: true })),
                  preview_open: McpToolAccess.reads(() => Effect.succeed({ opened: true })),
                  failing_tool: McpToolAccess.reads(() =>
                    Effect.fail(
                      new OrchestratorMcpFailure({
                        code: "invalid_request",
                        message: "Tool failed intentionally.",
                      }),
                    ),
                  ),
                  cancellable_tool: McpToolAccess.reads(() =>
                    Deferred.succeed(slowStarted, undefined).pipe(
                      Effect.andThen(Effect.never),
                      Effect.onInterrupt(() =>
                        Deferred.succeed(slowInterrupted, true).pipe(Effect.asVoid),
                      ),
                    ),
                  ),
                }),
              ),
              McpHttpServer.layerToolSearch,
            ),
          ).pipe(
            Layer.provide(ServerSettings.layerTest()),
            Layer.provide(McpToolAccessTestkit.liveThreadsLayer),
            Layer.provide(
              Layer.mock(McpSessionRegistry.McpSessionRegistry)({
                resolve: (presented) => Effect.succeed(presented === token ? scope : undefined),
              }),
            ),
          );
          yield* HttpRouter.serve(serverLayer, {
            disableListenLog: true,
            disableLogger: true,
          }).pipe(Layer.build);

          const { address } = yield* HttpServer.HttpServer;
          if (!NetAddress.isInetAddress(address)) throw new Error("Expected a TCP test server");
          const endpoint = `http://127.0.0.1:${address.port}/mcp`;

          const child = NodeChildProcess.spawn(nativeBridge, ["--chronos-acp-mcp-bridge"], {
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
            env: {
              ...process.env,
              T3_ACP_MCP_ENDPOINT: endpoint,
              T3_ACP_MCP_AUTHORIZATION: `Bearer ${token}`,
            },
          });
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              if (child.exitCode === null) child.kill();
            }),
          );

          let rawOut = "";
          let rawErr = "";
          child.stdout.setEncoding("utf8");
          child.stderr.setEncoding("utf8");
          child.stdout.on("data", (chunk: string) => {
            rawOut += chunk;
          });
          child.stderr.on("data", (chunk: string) => {
            rawErr += chunk;
          });

          const send = (message: unknown) => {
            child.stdin.write(`${JSON.stringify(message)}\n`);
          };
          send({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: { name: "native-bridge-e2e", version: "1.0.0" },
            },
          });
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
          send({
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: { name: "delegate_task", arguments: {} },
          });
          send({
            jsonrpc: "2.0",
            id: 4,
            method: "tools/call",
            params: { name: "tool_search", arguments: { query: "browser" } },
          });
          send({
            jsonrpc: "2.0",
            id: 5,
            method: "tools/call",
            params: { name: "failing_tool", arguments: {} },
          });
          send({
            jsonrpc: "2.0",
            id: 6,
            method: "tools/call",
            params: { name: "nonexistent_tool", arguments: {} },
          });
          send({
            jsonrpc: "2.0",
            id: 7,
            method: "tools/call",
            params: { name: "cancellable_tool", arguments: {} },
          });

          yield* Deferred.await(slowStarted);
          send({
            jsonrpc: "2.0",
            method: "notifications/cancelled",
            params: { requestId: 7, reason: "user cancelled" },
          });
          expect(yield* Deferred.await(slowInterrupted)).toBe(true);
          send({ jsonrpc: "2.0", id: 8, method: "ping", params: {} });
          child.stdin.end();

          const exitCode = yield* Effect.promise(
            () =>
              new Promise<number | null>((resolve, reject) => {
                child.once("error", reject);
                child.once("exit", (code) => resolve(code));
              }),
          );
          expect(exitCode, rawErr).toBe(0);

          const messages = rawOut
            .split(/\r?\n/u)
            .filter((line) => line.trim().length > 0)
            .map(
              (line) =>
                JSON.parse(line) as {
                  readonly id?: unknown;
                  readonly result?: {
                    readonly tools?: ReadonlyArray<{ readonly name: string }>;
                    readonly structuredContent?: unknown;
                    readonly isError?: boolean;
                    readonly content?: ReadonlyArray<{ readonly text?: string }>;
                  };
                  readonly error?: { readonly code?: number; readonly message?: string };
                },
            );
          const byId = (id: number) => messages.find((entry) => entry.id === id);
          expect(byId(1)?.result).toBeDefined();
          expect(byId(2)?.result?.tools?.map((entry) => entry.name).sort()).toEqual([
            "cancellable_tool",
            "delegate_task",
            "failing_tool",
            "preview_open",
          ]);
          expect(byId(3)?.result?.structuredContent).toEqual({ ok: true });
          expect(byId(4)?.result?.structuredContent).toEqual({
            tools: [{ name: "preview_open", description: "Opens a browser preview." }],
          });
          expect(byId(5)?.result).toMatchObject({
            isError: true,
            content: [{ text: expect.stringContaining("Tool failed intentionally.") }],
          });
          expect(byId(6)?.error).toMatchObject({
            code: -32602,
            message: expect.stringContaining("nonexistent_tool"),
          });
          expect(byId(7)).toBeUndefined();
          expect(byId(8)?.result).toEqual({});
        }),
      ).pipe(Effect.provide(NodeHttpServer.layerTest)),
  );
});
