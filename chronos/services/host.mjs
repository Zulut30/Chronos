import { createWriteStream } from "node:fs";
import http from "node:http";
import net from "node:net";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

const SERVICE_CONFIG = {
  "skills-manager": { envKey: "OLY_SKILLS_PORT", defaultPort: 4517, health: "/api/health" },
  "tasks-service": { envKey: "OLY_TASKS_PORT", defaultPort: 4518, health: "/api/health" },
  "files-service": { envKey: "OLY_FILES_PORT", defaultPort: 4519, health: "/health" },
  "studio-service": { envKey: "OLY_STUDIO_PORT", defaultPort: 4520, health: "/api/health" },
  "integrations-service": { envKey: "OLY_INTEGRATIONS_PORT", defaultPort: 4522, health: "/api/health" },
  "mcp-manager": { envKey: "OLY_MCP_PORT", defaultPort: 4523, health: "/api/health" },
  "olympus-hub": { envKey: "OLY_HUB_PORT", defaultPort: 4524, health: "/mcp/oly-web" },
};

const STUDIO_STATIC_ORIGINS = new Set(["t3code://app", "http://localhost:3773", "http://127.0.0.1:3773"]);
const IDLE_SLEEP_MS = (() => {
  const raw = process.env.CHRONOS_SERVICE_IDLE_MS;
  if (raw === undefined || raw === "") return 5 * 60_000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 5 * 60_000;
})();

// Worker copies on Windows have case-sensitive keys. Service settings use uppercase,
// and each worker still needs a private copy for changes such as API-key updates.
const baseEnv = process.platform === "win32"
  ? Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k.toUpperCase(), v]))
  : { ...process.env };

const proxies = new Map();
let activeStudioWorker;

function allocateLoopbackPort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function waitForPort(port, isAlive, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function attempt() {
      if (!isAlive()) return reject(new Error("Service worker exited before listening"));
      const sock = net.connect({ host: "127.0.0.1", port });
      const retry = () => {
        sock.destroy();
        if (!isAlive()) return reject(new Error("Service worker exited before listening"));
        if (Date.now() >= deadline) return reject(new Error("Timed out waiting for service worker"));
        setTimeout(attempt, 15).unref();
      };
      sock.once("connect", () => {
        sock.destroy();
        resolve();
      });
      sock.once("error", retry);
    }
    attempt();
  });
}

function studioCorsHeaders(req, publicPort) {
  const origin = req.headers.origin;
  const allowed =
    origin &&
    (STUDIO_STATIC_ORIGINS.has(origin) ||
      origin === `http://127.0.0.1:${publicPort}` ||
      origin === `http://localhost:${publicPort}`);
  return allowed
    ? { "Access-Control-Allow-Origin": origin, Vary: "Origin", "Access-Control-Allow-Private-Network": "true" }
    : {};
}

function validStudioHost(req, publicPort) {
  const host = String(req.headers.host || "");
  return host === `127.0.0.1:${publicPort}` || host === `localhost:${publicPort}`;
}

function startProxy(name) {
  if (proxies.has(name)) return;
  const meta = SERVICE_CONFIG[name];
  if (!meta) return;
  const publicPort = Number(baseEnv[meta.envKey] || meta.defaultPort);
  const log = createWriteStream(join(baseEnv.CHRONOS_T3_HOME, "logs", "services", name + ".log"), {
    flags: "a",
    mode: 0o600,
  });
  log.on("error", () => {});

  const state = {
    name,
    meta,
    publicPort,
    server: null,
    worker: null,
    workerPort: 0,
    waking: null,
    sleeping: false,
    inFlight: 0,
    idleTimer: null,
    // Studio-only idle bridge & context buffer so 60-studio.js does not keep studio-service awake at idle.
    bridgeClients: new Set(),
    bridgeKeepAlive: null,
    upstreamBridge: null,
    pendingContext: null,
  };

  function clearIdle() {
    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
      state.idleTimer = null;
    }
  }

  function scheduleIdle() {
    clearIdle();
    if (IDLE_SLEEP_MS <= 0 || !state.worker || state.waking || state.inFlight > 0) return;
    state.idleTimer = setTimeout(() => {
      state.idleTimer = null;
      if (!state.worker || state.waking || state.inFlight > 0) return;
      sleepWorker();
    }, IDLE_SLEEP_MS);
    state.idleTimer.unref();
  }

  function closeUpstreamBridge() {
    const req = state.upstreamBridge;
    state.upstreamBridge = null;
    if (req) {
      try { req.destroy(); } catch {}
    }
  }

  function sleepWorker() {
    const worker = state.worker;
    if (!worker) return;
    state.sleeping = true;
    state.worker = null;
    state.workerPort = 0;
    if (name === "studio-service" && activeStudioWorker === worker) activeStudioWorker = undefined;
    closeUpstreamBridge();
    try { log.write(new Date().toISOString() + " Sleeping idle worker\n"); } catch {}
    void worker.terminate();
  }

  function attachStudioBridge(workerPort) {
    if (name !== "studio-service" || state.bridgeClients.size === 0 || state.upstreamBridge) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, 1500);
      timer.unref();
      const up = http.request(
        {
          hostname: "127.0.0.1",
          port: workerPort,
          path: "/api/bridge",
          method: "GET",
          headers: { host: `127.0.0.1:${workerPort}`, accept: "text/event-stream" },
        },
        (res) => {
          res.setEncoding("utf8");
          let buf = "";
          res.on("data", (chunk) => {
            buf += chunk;
            let idx;
            while ((idx = buf.indexOf("\n\n")) !== -1) {
              const frame = buf.slice(0, idx + 2);
              buf = buf.slice(idx + 2);
              if (frame.startsWith("event: hello")) {
                finish();
                continue;
              }
              if (frame.startsWith(":")) continue;
              for (const client of state.bridgeClients) {
                if (!client.destroyed && !client.writableEnded) {
                  try { client.write(frame); } catch {}
                }
              }
            }
          });
          res.on("end", () => {
            if (state.upstreamBridge === up) state.upstreamBridge = null;
            finish();
          });
          res.on("error", () => {
            if (state.upstreamBridge === up) state.upstreamBridge = null;
            finish();
          });
        },
      );
      up.on("error", () => {
        if (state.upstreamBridge === up) state.upstreamBridge = null;
        finish();
      });
      state.upstreamBridge = up;
      up.end();
    });
  }

  function replayStudioContext(workerPort) {
    const ctx = state.pendingContext;
    if (name !== "studio-service" || !ctx) return Promise.resolve();
    return new Promise((resolve) => {
      const up = http.request(
        {
          hostname: "127.0.0.1",
          port: workerPort,
          path: "/api/context",
          method: "POST",
          headers: {
            host: `127.0.0.1:${workerPort}`,
            "content-type": "application/json",
            "x-oly": "1",
            "content-length": Buffer.byteLength(ctx),
          },
        },
        (res) => {
          res.resume();
          res.on("end", resolve);
          res.on("error", resolve);
        },
      );
      up.on("error", resolve);
      up.end(ctx);
    });
  }

  async function ensureWorker() {
    clearIdle();
    if (state.worker && state.workerPort > 0) {
      if (name === "studio-service") {
        await attachStudioBridge(state.workerPort);
      }
      return state.workerPort;
    }
    if (state.waking) return state.waking;
    state.waking = (async () => {
      const workerPort = await allocateLoopbackPort();
      let alive = true;
      const env = { ...baseEnv, [meta.envKey]: String(workerPort) };
      const worker = new Worker(new URL("./" + name + "/server.mjs", import.meta.url), {
        env,
        stdout: true,
        stderr: true,
        workerData: { serviceCwd: join(import.meta.dirname, name) },
        resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 4 },
      });
      state.sleeping = false;
      state.worker = worker;
      state.workerPort = workerPort;
      if (name === "studio-service") {
        activeStudioWorker = worker;
        worker.on("message", (message) => {
          if (message?.kind === "artifact-open" && process.connected) process.send(message, () => {});
        });
      }
      worker.stdout.pipe(log, { end: false });
      worker.stderr.pipe(log, { end: false });
      worker.on("error", (error) => {
        try { log.write((error?.stack || String(error)) + "\n"); } catch {}
      });
      worker.once("exit", () => {
        alive = false;
        const wasSleeping = state.sleeping;
        state.sleeping = false;
        if (state.worker === worker) {
          state.worker = null;
          state.workerPort = 0;
        }
        if (name === "studio-service" && activeStudioWorker === worker) {
          activeStudioWorker = undefined;
          closeUpstreamBridge();
        }
        clearIdle();
        if (!wasSleeping) {
          try { log.write(new Date().toISOString() + " Worker exited\n"); } catch {}
        }
      });
      try {
        await waitForPort(workerPort, () => alive && state.worker === worker);
        if (name === "studio-service") {
          await attachStudioBridge(workerPort);
          await replayStudioContext(workerPort);
        }
        return workerPort;
      } catch (error) {
        if (state.worker === worker) {
          state.worker = null;
          state.workerPort = 0;
        }
        void worker.terminate();
        throw error;
      }
    })();
    try {
      return await state.waking;
    } finally {
      state.waking = null;
      scheduleIdle();
    }
  }

  function rewriteRequestHeaders(req, workerPort) {
    const headers = { ...req.headers };
    if (headers.host === `127.0.0.1:${publicPort}`) headers.host = `127.0.0.1:${workerPort}`;
    else if (headers.host === `localhost:${publicPort}`) headers.host = `localhost:${workerPort}`;
    if (headers.origin === `http://127.0.0.1:${publicPort}`) headers.origin = `http://127.0.0.1:${workerPort}`;
    else if (headers.origin === `http://localhost:${publicPort}`) headers.origin = `http://localhost:${workerPort}`;
    return headers;
  }

  function rewriteResponseHeaders(upstreamHeaders, workerPort) {
    const headers = { ...upstreamHeaders };
    delete headers["transfer-encoding"];
    const acao = headers["access-control-allow-origin"];
    if (acao === `http://127.0.0.1:${workerPort}`) headers["access-control-allow-origin"] = `http://127.0.0.1:${publicPort}`;
    else if (acao === `http://localhost:${workerPort}`) headers["access-control-allow-origin"] = `http://localhost:${publicPort}`;
    return headers;
  }

  const server = http.createServer((req, res) => {
    const pathname = (req.url || "/").split("?")[0];

    // Hold Studio SSE bridge in host so idle desktop windows keep studio-service asleep.
    if (name === "studio-service" && req.method === "GET" && pathname === "/api/bridge") {
      if (!validStudioHost(req, publicPort)) {
        res.writeHead(421);
        res.end("bad host");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        ...studioCorsHeaders(req, publicPort),
      });
      res.write('event: hello\ndata: {"ok":true}\n\n');
      state.bridgeClients.add(res);
      if (!state.bridgeKeepAlive) {
        state.bridgeKeepAlive = setInterval(() => {
          for (const client of state.bridgeClients) {
            if (!client.destroyed && !client.writableEnded) {
              try { client.write(": ka\n\n"); } catch {}
            }
          }
        }, 25_000);
        state.bridgeKeepAlive.unref();
      }
      if (state.worker && state.workerPort > 0) void attachStudioBridge(state.workerPort);
      res.on("close", () => {
        state.bridgeClients.delete(res);
        if (state.bridgeClients.size === 0) {
          if (state.bridgeKeepAlive) {
            clearInterval(state.bridgeKeepAlive);
            state.bridgeKeepAlive = null;
          }
          closeUpstreamBridge();
        }
      });
      return;
    }

    // Handle CORS preflight for Studio context updates while asleep so 60-studio.js stays idle.
    if (name === "studio-service" && req.method === "OPTIONS" && pathname === "/api/context" && !state.worker && !state.waking) {
      if (!validStudioHost(req, publicPort)) {
        res.writeHead(421);
        res.end("bad host");
        return;
      }
      res.writeHead(204, {
        ...studioCorsHeaders(req, publicPort),
        "Access-Control-Allow-Methods": "GET,POST,PUT",
        "Access-Control-Allow-Headers": "content-type,x-oly",
        "Access-Control-Max-Age": "600",
      });
      res.end();
      return;
    }

    // Buffer Studio context updates while asleep, and remember the latest context across sleep/wake.
    if (name === "studio-service" && req.method === "POST" && pathname === "/api/context") {
      if (!validStudioHost(req, publicPort)) {
        res.writeHead(421);
        res.end("bad host");
        return;
      }
      if (req.headers["x-oly"] !== "1") {
        res.writeHead(403, { "Content-Type": "application/json; charset=utf-8", ...studioCorsHeaders(req, publicPort) });
        res.end(JSON.stringify({ error: "Нужен заголовок x-oly: 1" }));
        return;
      }
      const chunks = [];
      let bytes = 0;
      req.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes <= 65_536) chunks.push(chunk);
      });
      req.on("end", () => {
        if (bytes > 65_536) {
          res.writeHead(413, { "Content-Type": "application/json; charset=utf-8", ...studioCorsHeaders(req, publicPort) });
          res.end(JSON.stringify({ error: "Слишком большой запрос" }));
          return;
        }
        const raw = Buffer.concat(chunks).toString("utf8");
        try {
          if (raw) JSON.parse(raw);
        } catch {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8", ...studioCorsHeaders(req, publicPort) });
          res.end(JSON.stringify({ error: "Некорректный JSON" }));
          return;
        }
        state.pendingContext = raw;
        if (state.worker && state.workerPort > 0) {
          void replayStudioContext(state.workerPort);
        }
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          ...studioCorsHeaders(req, publicPort),
        });
        res.end('{"ok":true}');
      });
      return;
    }

    req.pause();
    state.inFlight++;
    clearIdle();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      state.inFlight = Math.max(0, state.inFlight - 1);
      scheduleIdle();
    };
    res.once("close", finish);
    res.once("finish", finish);

    ensureWorker()
      .then((workerPort) => {
        if (req.destroyed || res.destroyed) {
          req.resume();
          finish();
          return;
        }
        const up = http.request(
          {
            hostname: "127.0.0.1",
            port: workerPort,
            path: req.url,
            method: req.method,
            headers: rewriteRequestHeaders(req, workerPort),
          },
          (upRes) => {
            const headers = rewriteResponseHeaders(upRes.headers, workerPort);
            const rewriteHealthPort =
              req.method === "GET" &&
              pathname === meta.health &&
              upRes.statusCode === 200 &&
              String(headers["content-type"] || "").includes("application/json");
            if (rewriteHealthPort) {
              const chunks = [];
              let size = 0;
              upRes.on("data", (c) => {
                size += c.length;
                if (size <= 65_536) chunks.push(c);
              });
              upRes.on("end", () => {
                let body = Buffer.concat(chunks);
                try {
                  const data = JSON.parse(body.toString("utf8"));
                  if (data && data.port === workerPort) {
                    data.port = publicPort;
                    body = Buffer.from(JSON.stringify(data), "utf8");
                  }
                } catch {}
                headers["content-length"] = String(body.length);
                if (!res.headersSent) res.writeHead(upRes.statusCode || 200, headers);
                res.end(body);
              });
              upRes.on("error", () => {
                if (!res.destroyed) res.destroy();
              });
              return;
            }
            if (!res.headersSent) res.writeHead(upRes.statusCode || 502, headers);
            upRes.pipe(res);
          },
        );
        up.on("error", () => {
          if (!res.headersSent) {
            res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: "Service unavailable" }));
          } else if (!res.destroyed) {
            res.destroy();
          }
        });
        req.on("aborted", () => up.destroy());
        req.pipe(up);
        req.resume();
      })
      .catch((error) => {
        try { log.write((error?.stack || String(error)) + "\n"); } catch {}
        req.resume();
        if (!res.headersSent) {
          res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Service failed to start" }));
        }
        finish();
      });
  });

  state.server = server;
  proxies.set(name, state);

  server.once("error", (error) => {
    try { log.write((error?.stack || String(error)) + "\n"); } catch {}
    if (proxies.get(name) === state) proxies.delete(name);
    log.end();
    if (process.connected) process.send(name, () => {});
  });
  server.listen(publicPort, "127.0.0.1");
}

function shutdown() {
  for (const state of proxies.values()) {
    if (state.idleTimer) clearTimeout(state.idleTimer);
    if (state.bridgeKeepAlive) clearInterval(state.bridgeKeepAlive);
    if (state.upstreamBridge) {
      try { state.upstreamBridge.destroy(); } catch {}
    }
    for (const client of state.bridgeClients) {
      try { client.end(); } catch {}
    }
    try { state.server?.close(); } catch {}
    if (state.worker) {
      state.sleeping = true;
      void state.worker.terminate();
    }
  }
  process.exit(0);
}

process.on("message", (name) => {
  if (name?.kind === "artifact-delivered") {
    activeStudioWorker?.postMessage(name);
    return;
  }
  if (typeof name === "string" && name in SERVICE_CONFIG) startProxy(name);
});
process.once("disconnect", shutdown);
