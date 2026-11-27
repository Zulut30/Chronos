// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off -- Native child handles, log descriptors and retry timers must also stop synchronously on Electron exit.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";

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
    const req = NodeHttp.get({ hostname: "127.0.0.1", port: service.port, path: service.health, signal }, (res) => {
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
type OnExit = (reason: string) => void;
type Launch = (service: Service, onExit: OnExit) => void;

export function createServiceHost(options: Options & { platform: NodeJS.Platform; showArtifact?: (id:string,confirmDelete:boolean)=>boolean }) {
  const env = { ...options.env };
  for (const key of Object.keys(env)) {
    const name = options.platform === "win32" ? key.toUpperCase() : key;
    if (/^OLY_(?:.*_PORT|TASKS_DIR|T3_DB|STUDIO_DATA|PROMPTS_DIR|PROMPTS_TRASH|MCP_TEST_HOME|USAGE_ROOT)$/.test(name)) delete env[key];
  }
  const workers = new Map<string, OnExit>();
  let host: NodeChildProcess.ChildProcess | undefined;
  function startHost() {
    const proc = NodeChildProcess.spawn(
      options.executable,
      ["--max-old-space-size=192", "--max-semi-space-size=2", NodePath.join(options.resources, "host.mjs")],
      {
      cwd: options.resources, windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { ...env, ELECTRON_RUN_AS_NODE: "1", CHRONOS_T3_HOME: options.baseDir,
        CHRONOS_SERVICES_DATA: options.baseDir },
      },
    );
    proc.on("message", (message) => {
      if (typeof message === "object" && message && "kind" in message && message.kind === "artifact-open" &&
          "request" in message && typeof message.request === "string" && "id" in message && typeof message.id === "string" &&
          /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(message.id)) {
        const delivered = options.showArtifact?.(message.id,"confirmDelete" in message && message.confirmDelete === true) ?? false;
        if (proc.connected) proc.send({kind:"artifact-delivered",request:message.request,delivered},()=>{});
        return;
      }
      if (typeof message !== "string") return;
      const stopped = workers.get(message);
      workers.delete(message);
      stopped?.("worker exit");
    });
    proc.on("error", () => { /* close follows spawn failure */ });
    proc.once("close", (code, signal) => {
      host = undefined;
      const stopped = [...workers.values()];
      workers.clear();
      for (const notify of stopped) notify("host " + (signal ?? code));
    });
    return proc;
  }
  const launch: Launch = (service, onExit) => {
    host ??= startHost();
    const proc = host;
    workers.set(service.name, onExit);
    proc.send(service.name, (error) => { if (error) proc.kill(); });
  };
  return { launch, stop: () => host?.kill() };
}

export function supervise(service: Service, options: Options, deps: { probe: typeof probe; launch: Launch }) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let backoff = 1000;
  let lastStatus = "";
  const dir = NodePath.join(options.baseDir, "logs", "services");
  const log = NodePath.join(dir, service.name + ".log");
  function status(message: string) {
    if (message === lastStatus) return;
    try {
      NodeFS.mkdirSync(dir, { recursive: true, mode: 0o700 });
      NodeFS.appendFileSync(log, new Date().toISOString() + " " + message + "\n", { mode: 0o600 });
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
      deps.launch(service, (reason) => {
        if (controller.signal.aborted) return;
        status("Service stopped (" + reason + "), retrying");
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
  };
}
