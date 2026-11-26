// @effect-diagnostics globalFetch:off -- Zero-Effect fast path relays JSON-RPC over native fetch.
// chronos: zero-Effect ACP MCP stdio bridge fast path so each long-lived ACP agent bridge stays lightweight.
import { ignoreMacosTypeOfServiceEinval } from "../../outboundHttp.ts";

interface JsonRpcEnvelope {
  readonly id?: unknown;
  readonly method?: unknown;
  readonly error?: unknown;
  readonly result?: unknown;
}

export interface AcpMcpStdioBridgeFastOptions {
  readonly endpoint: string;
  readonly authorization: string;
  readonly input: NodeJS.ReadableStream;
  readonly output: { write(chunk: string): unknown };
  readonly fetchImplementation?: ((url: string, init?: RequestInit) => Promise<Response>) | undefined;
  readonly signal?: AbortSignal | undefined;
}

const SSE_EVENT_SEPARATOR = /(?:\r\n|\r(?!\n)|\n){2}/u;
// A separator is at most four characters, so one that a new chunk completes starts within the
// last three characters already read.
const SEPARATOR_OVERLAP = 3;

function asEnvelope(value: unknown): JsonRpcEnvelope | null {
  return typeof value === "object" && value !== null ? (value as JsonRpcEnvelope) : null;
}

function protocolVersionOf(entry: unknown): string | null {
  const result = asEnvelope(entry)?.result;
  const version =
    typeof result === "object" && result !== null
      ? (result as { readonly protocolVersion?: unknown }).protocolVersion
      : undefined;
  return typeof version === "string" && version.length > 0 ? version : null;
}

function sseEventData(rawEvent: string): string {
  return rawEvent
    .split(/\r\n|\r|\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");
}

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {}
}

async function consumeResponsePayloads(
  response: Response,
  signal: AbortSignal | undefined,
  onPayload: (payload: unknown) => void,
): Promise<void> {
  if (response.status === 202 || response.status === 204) {
    await discardResponseBody(response);
    return;
  }
  const body = response.body;
  if (body === null) return;

  const reader = body.getReader();
  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  if (signal !== undefined) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    const mediaType = (response.headers.get("content-type") ?? "").split(";", 1)[0]!.trim();
    if (mediaType.toLowerCase() === "text/event-stream") {
      const decoder = new TextDecoder();
      let eventParts: string[] = [];
      let unscanned = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        let text = unscanned + decoder.decode(value, { stream: true });
        let separator = SSE_EVENT_SEPARATOR.exec(text);
        while (separator !== null) {
          eventParts.push(text.slice(0, separator.index));
          const data = sseEventData(eventParts.join(""));
          eventParts = [];
          text = text.slice(separator.index + separator[0].length);
          if (data.length > 0) onPayload(JSON.parse(data));
          separator = SSE_EVENT_SEPARATOR.exec(text);
        }
        const scannedLength = Math.max(0, text.length - SEPARATOR_OVERLAP);
        eventParts.push(text.slice(0, scannedLength));
        unscanned = text.slice(scannedLength);
      }
    }

    const decoder = new TextDecoder();
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        text += decoder.decode();
        break;
      }
      text += decoder.decode(value, { stream: true });
    }
    if (text.trim().length > 0) {
      onPayload(JSON.parse(text));
    }
  } finally {
    if (signal !== undefined) signal.removeEventListener("abort", onAbort);
    try {
      await reader.cancel();
    } catch {}
    try {
      reader.releaseLock();
    } catch {}
  }
}

export async function runAcpMcpStdioBridgeFast(
  options: AcpMcpStdioBridgeFastOptions,
): Promise<void> {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  let sessionId: string | null = null;
  let protocolVersion: string | null = null;
  const running = new Set<Promise<void>>();

  const writeMessage = (message: unknown): void => {
    options.output.write(`${JSON.stringify(message)}\n`);
  };

  const handleServerPayload = (payload: unknown): void => {
    for (const entry of Array.isArray(payload) ? payload : [payload]) {
      protocolVersion = protocolVersionOf(entry) ?? protocolVersion;
      writeMessage(entry);
    }
  };

  const respondWithError = (requestId: unknown, message: string, code = -32603): void => {
    writeMessage({
      jsonrpc: "2.0",
      id: requestId ?? null,
      error: { code, message },
    });
  };

  const forward = async (line: string, envelope: JsonRpcEnvelope): Promise<void> => {
    try {
      const response = await fetchImplementation(options.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: options.authorization,
          ...(sessionId === null ? {} : { "mcp-session-id": sessionId }),
          ...(protocolVersion === null ? {} : { "mcp-protocol-version": protocolVersion }),
        },
        body: line,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      sessionId = response.headers.get("mcp-session-id") ?? sessionId;
      if (!response.ok) {
        if (envelope.id !== undefined) {
          respondWithError(
            envelope.id,
            `T3 Code MCP endpoint responded with HTTP ${response.status}.`,
          );
        }
        await discardResponseBody(response);
        return;
      }
      await consumeResponsePayloads(response, options.signal, handleServerPayload);
    } catch (error) {
      if (options.signal?.aborted) return;
      if (envelope.id === undefined) return;
      respondWithError(
        envelope.id,
        `T3 Code MCP bridge request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  // Order only session establishment; SSE responses must bypass it to avoid deadlock.
  let sessionBarrier: Promise<void> = Promise.resolve();
  let sessionBarrierPending = false;

  const track = (task: Promise<void>): void => {
    const wrapped = task.finally(() => {
      running.delete(wrapped);
    });
    running.add(wrapped);
  };

  const dispatch = (line: string): void => {
    if (line.trim().length === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      respondWithError(null, "Parse error", -32700);
      return;
    }
    const envelope = asEnvelope(parsed);
    if (envelope === null) return;
    const isResponse = envelope.id !== undefined && ("result" in envelope || "error" in envelope);
    const isSessionHandshake =
      envelope.method === "initialize" || envelope.method === "notifications/initialized";
    if (isResponse) {
      track(forward(line, envelope));
      return;
    }
    if (isSessionHandshake) {
      const prior = sessionBarrier;
      const next = prior.catch(() => undefined).then(() => forward(line, envelope));
      sessionBarrier = next;
      sessionBarrierPending = true;
      const wrapped = next.finally(() => {
        running.delete(wrapped);
        if (sessionBarrier === next) sessionBarrierPending = false;
      });
      running.add(wrapped);
      return;
    }
    const task = sessionBarrierPending
      ? sessionBarrier.catch(() => undefined).then(() => forward(line, envelope))
      : forward(line, envelope);
    track(task);
  };

  // node:readline also splits on U+2028/U+2029, which JSON.stringify leaves raw inside strings.
  const decoder = new TextDecoder();
  let buffered = "";
  const signal = options.signal;
  let onAbort: (() => void) | undefined;
  const abortedPromise: Promise<"aborted"> | null =
    signal === undefined
      ? null
      : signal.aborted
        ? Promise.resolve("aborted")
        : new Promise<"aborted">((resolve) => {
            onAbort = () => resolve("aborted");
            signal.addEventListener("abort", onAbort, { once: true });
          });

  try {
    const iterator = options.input[Symbol.asyncIterator]();
    while (true) {
      if (signal?.aborted) break;
      const next =
        abortedPromise === null
          ? await iterator.next()
          : await Promise.race([iterator.next(), abortedPromise]);
      if (next === "aborted" || next.done) break;
      const chunk = next.value;
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Uint8Array);
      buffered += decoder.decode(bytes, { stream: true });
      let start = 0;
      for (let i = 0; i < buffered.length; i += 1) {
        const ch = buffered.charCodeAt(i);
        if (ch === 10) {
          dispatch(buffered.slice(start, i));
          start = i + 1;
        } else if (ch === 13) {
          if (i + 1 < buffered.length) {
            dispatch(buffered.slice(start, i));
            if (buffered.charCodeAt(i + 1) === 10) i += 1;
            start = i + 1;
          } else {
            break;
          }
        }
      }
      if (start > 0) buffered = buffered.slice(start);
    }
    if (!signal?.aborted) {
      buffered += decoder.decode();
      let start = 0;
      for (let i = 0; i < buffered.length; i += 1) {
        const ch = buffered.charCodeAt(i);
        if (ch === 10 || ch === 13) {
          dispatch(buffered.slice(start, i));
          if (ch === 13 && i + 1 < buffered.length && buffered.charCodeAt(i + 1) === 10) i += 1;
          start = i + 1;
        }
      }
      if (start < buffered.length) {
        dispatch(buffered.slice(start));
      }
    }
  } catch {
  } finally {
    if (signal !== undefined && onAbort !== undefined) {
      signal.removeEventListener("abort", onAbort);
    }
  }

  while (running.size > 0) {
    await Promise.all([...running]);
  }
}

export async function runAcpMcpBridgeFastCli(): Promise<void> {
  ignoreMacosTypeOfServiceEinval();
  const endpoint = process.env.T3_ACP_MCP_ENDPOINT;
  const authorization = process.env.T3_ACP_MCP_AUTHORIZATION;
  if (endpoint === undefined || authorization === undefined) {
    process.stderr.write(
      "acp-mcp-bridge requires T3_ACP_MCP_ENDPOINT and T3_ACP_MCP_AUTHORIZATION.\n",
    );
    process.exitCode = 2;
    return;
  }
  await runAcpMcpStdioBridgeFast({
    endpoint,
    authorization,
    input: process.stdin,
    output: process.stdout,
  });
}
