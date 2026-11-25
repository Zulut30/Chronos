import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

const services = new Set(["skills-manager", "tasks-service", "files-service", "studio-service",
  "integrations-service", "mcp-manager", "olympus-hub"]);
const running = new Set();

// Each entry is a worker main module. Its process.exit(), globals and uncaught
// JS errors stay inside the worker. Desktop re-probes the port before restarting it.
process.on("message", (name) => {
  if (!services.has(name) || running.has(name)) return;
  const log = createWriteStream(join(process.env.CHRONOS_T3_HOME, "logs", "services", name + ".log"),
    { flags: "a", mode: 0o600 });
  log.on("error", () => {});
  const stopped = () => {
    running.delete(name);
    log.end();
    if (process.connected) process.send(name, () => {});
  };
  try {
    const worker = new Worker(new URL("./" + name + "/server.mjs", import.meta.url),
      { stdout: true, stderr: true, workerData: { serviceCwd: join(import.meta.dirname, name) } });
    running.add(name);
    worker.stdout.pipe(log, { end: false });
    worker.stderr.pipe(log, { end: false });
    worker.on("error", error => log.write(error.stack + "\n"));
    worker.once("exit", stopped);
  } catch (error) {
    log.write(error.stack + "\n");
    stopped();
  }
});
process.once("disconnect", () => process.exit(0));
