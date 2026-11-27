// Preload for the isolated server's main isolate only. Timer resolution is subtracted from lag.
const { isMainThread } = require("node:worker_threads");
const fs = require("node:fs");
const path = require("node:path");
const { monitorEventLoopDelay } = require("node:perf_hooks");
const root = process.env.CHRONOS_BENCH_ROOT;
if (isMainThread && root && process.argv.includes("serve")) {
  const lag = monitorEventLoopDelay({ resolution: 10 });
  lag.enable();
  const probe = setInterval(() => {
    for (const phase of ["start", "end"]) {
      const marker = path.join(root, "probe-" + phase);
      if (!fs.existsSync(marker)) continue;
      fs.unlinkSync(marker);
      const cpu = process.cpuUsage();
      const mem = process.memoryUsage();
      const sample = { pid: process.pid, time: performance.now(), cpu: cpu.user + cpu.system,
        rss: mem.rss, memory: mem, p95: lag.percentile(95) / 1e6 - 10, count: lag.count };
      fs.writeFileSync(marker + ".tmp", JSON.stringify(sample));
      fs.renameSync(marker + ".tmp", marker + ".json");
      lag.reset();
      if (phase === "end") { lag.disable(); clearInterval(probe); }
    }
  }, 100);
  probe.unref();
}
