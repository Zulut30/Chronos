// @effect-diagnostics nodeBuiltinImport:off -- Bridge stdio tests feed PassThrough streams directly.
import * as NodeStream from "node:stream";

import { describe, expect, it, vi } from "vite-plus/test";

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

  it("aborts in-flight fetch when signal aborts", async () => {
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
    input.end();
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
});
