import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, closeSync, mkdirSync, openSync } from "node:fs";
import { get } from "node:http";
import { join } from "node:path";

export interface Service {
  name: string;
  port: number;
  health: string;
  identity?: string;
}

export const services: Service[] = [
  { name: "skills-manager", port: 4517, health: "/api/health" },
  { name: "tasks-service", port: 4518, health: "/api/health", identity: "oly-tasks" },
  { name: "files-service", port: 4519, health: "/health", identity: "oly-files" },
  { name: "studio-service", port: 4520, health: "/api/health", identity: "t3-studio" },
  { name: "integrations-service", port: 4522, health: "/api/health", identity: "oly-integrations" },
  { name: "mcp-manager", port: 4523, health: "/api/health", identity: "oly-mcp-manager" },
  { name: "olympus-hub", port: 4524, health: "/mcp/oly-web" },
];

type PortState = "available" | "external" | "occupied";

export function probe(service: Service, signal: AbortSignal): Promise<PortState> {
  return new Promise((resolve) => {
    const req = get({ hostname: "127.0.0.1", port: service.port, path: service.health, signal }, (res) => {
      if (service.name === "olympus-hub" || res.statusCode !== 200) {
        resolve(service.name === "olympus-hub" && res.statusCode === 401 ? "external" : "occupied");
        res.destroy();
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        body += chunk;
        if (body.length > 4096) { resolve("occupied"); res.destroy(); }
      });
      res.on("error", () => resolve("occupied"));
      res.on("end", () => {
        try {
          const data = JSON.parse(body);
          const matches = service.identity ? data.service === service.identity : data.port === service.port;
          resolve(matches && data.ok === true ? "external" : "occupied");
        } catch { resolve("occupied"); }
      });
    });
    req.on("error", (err: NodeJS.ErrnoException) => resolve(err.code === "ECONNREFUSED" ? "available" : "occupied"));
  });
}

interface Options {
  baseDir: string;
  resources: string;
  executable: string;
  env: NodeJS.ProcessEnv;
}
function launch(service: Service, options: Options, log: string): ChildProcess {
  const cwd = join(options.resources, service.name);
  const fd = openSync(log, "a", 0o600);
  try {
    const env = { ...options.env };
    for (const key of Object.keys(env)) {
      if (/^OLY_(?:.*_PORT|TASKS_DIR|T3_DB|STUDIO_DATA|PROMPTS_DIR|PROMPTS_TRASH|MCP_TEST_HOME|USAGE_ROOT)$/.test(key)) delete env[key];
    }
    return spawn(options.executable, [join(cwd, "server.mjs")], {
      cwd, windowsHide: true, stdio: ["ignore", fd, fd],
      env: { ...env, ELECTRON_RUN_AS_NODE: "1", CHRONOS_T3_HOME: options.baseDir,
        CHRONOS_SERVICES_DATA: options.baseDir },
    });
  } finally { closeSync(fd); }
}

const production = { probe, launch };
export function supervise(service: Service, options: Options, deps = production) {
  const controller = new AbortController();
  let child: ReturnType<typeof launch> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let backoff = 1000;
  let lastStatus = "";
  const dir = join(options.baseDir, "logs", "services");
  const log = join(dir, service.name + ".log");
  function status(message: string) {
    if (message === lastStatus) return;
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      appendFileSync(log, new Date().toISOString() + " " + message + "\n", { mode: 0o600 });
      lastStatus = message;
    } catch { /* A read-only profile must not prevent the application opening. */ }
  }
  function schedule(ms: number) {
    if (!controller.signal.aborted) timer = setTimeout(() => { void check(); }, ms);
  }
  function retry() {
    schedule(backoff);
    backoff = Math.min(30_000, backoff * 2);
  }
  async function check() {
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(1500)]);
      const state = await deps.probe(service, signal);
      if (controller.signal.aborted) return;
      if (state !== "available") {
        status(state === "external" ? "Using existing service" : "Port occupied, waiting");
        backoff = 1000;
        schedule(30_000);
        return;
      }
      status("Starting bundled service");
      const started = Date.now();
      const owned = deps.launch(service, options, log);
      child = owned;
      owned.once("error", () => status("Child process error"));
      owned.once("close", (code, signal) => {
        child = undefined;
        if (controller.signal.aborted) return;
        status("Service stopped (" + (signal ?? code) + "), retrying");
        if (Date.now() - started >= 30_000) backoff = 1000;
        retry();
      });
    } catch {
      if (!controller.signal.aborted) { status("Service unavailable, retrying"); retry(); }
    }
  }
  void check();
  return () => {
    controller.abort();
    clearTimeout(timer);
    child?.kill();
  };
}
