// Diagnostic preload for ram-audit.mjs: observes main-isolate heap and Worker thread counts.
const wt = require("node:worker_threads");
const fs = require("node:fs");
const path = require("node:path");
const v8 = require("node:v8");

const root = process.env.CHRONOS_RAM_DIAG_ROOT;
if (wt.isMainThread && root) {
  const OriginalWorker = wt.Worker;
  let spawned = 0;
  const alive = new Map();
  let nextId = 1;
  function classify(spec, opts) {
    if (opts && opts.eval) {
      const s = String(spec);
      if (s.includes("wal_checkpoint")) return "sqlite-checkpoint";
      if (s.includes("DatabaseSync")) return opts.workerData?.readOnly ? "sqlite-reader" : "sqlite-writer";
      if (s.includes("child_process")) return "spawn-worker";
      return "eval-worker";
    }
    return path.basename(String(spec));
  }
  class TrackedWorker extends OriginalWorker {
    constructor(spec, opts) {
      super(spec, opts);
      const id = nextId++;
      const kind = classify(spec, opts);
      spawned++;
      alive.set(id, kind);
      this.once("exit", () => alive.delete(id));
    }
  }
  wt.Worker = TrackedWorker;

  const timer = setInterval(() => {
    const marker = path.join(root, "diag-trigger");
    if (!fs.existsSync(marker)) return;
    try { fs.unlinkSync(marker); } catch {}
    const byKind = {};
    for (const kind of alive.values()) byKind[kind] = (byKind[kind] || 0) + 1;
    const mem = process.memoryUsage();
    const heap = v8.getHeapStatistics();
    const out = {
      pid: process.pid,
      memoryMiB: Object.fromEntries(Object.entries(mem).map(([k, v]) => [k, Number((v / 1048576).toFixed(3))])),
      v8MiB: {
        usedHeap: Number((heap.used_heap_size / 1048576).toFixed(3)),
        totalHeap: Number((heap.total_heap_size / 1048576).toFixed(3)),
        heapLimit: Number((heap.heap_size_limit / 1048576).toFixed(3)),
        malloced: Number((heap.malloced_memory / 1048576).toFixed(3)),
        peakMalloced: Number((heap.peak_malloced_memory / 1048576).toFixed(3)),
        external: Number((heap.external_memory / 1048576).toFixed(3)),
        physicalTotal: Number((heap.total_physical_size / 1048576).toFixed(3)),
      },
      workersSpawned: spawned,
      workersAlive: alive.size,
      workersByKind: byKind,
      fffLoaded: Object.keys(require.cache).some((k) => k.includes("fff")),
    };
    fs.writeFileSync(marker + ".tmp", JSON.stringify(out, null, 2));
    fs.renameSync(marker + ".tmp", marker + ".json");
  }, 150);
  timer.unref();
}
