"use strict";
const { createInterface } = require("node:readline");

// A child belongs to one selected device, profile and focus lifetime. Stale lines and exits
// from a process being stopped cannot act on the next session.
function session(start, onSignal, onState) {
  let child = null;
  let key = null;
  let status = "off";
  function state(next) {
    status = next;
    onState(next);
  }
  function stop(next = "off") {
    const old = child;
    child = null;
    key = null;
    if (old) {
      old.stdin.end();
      old.kill();
    }
    if (status !== next) state(next);
  }
  function sync(enabled, device, focused) {
    if (!enabled || !device || !focused) {
      stop(enabled ? "waiting" : "off");
      return;
    }
    if (key === device && child) return;
    stop("waiting");
    const mine = start(device);
    child = mine;
    key = device;
    let terminal = "waiting";
    state("connecting");
    const lines = createInterface({ input: mine.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      if (child !== mine) return;
      if (line === "ready") state("ready");
      else if (line === "absent") {
        terminal = "absent";
        state(terminal);
      } else if (status === "ready") onSignal(line);
    });
    mine.stdin.on("error", () => {}); // EOF can race removal.
    const finish = (failed) => {
      lines.close();
      if (child !== mine) return;
      child = null;
      key = null;
      state(failed ? "error" : terminal);
    };
    mine.once("error", () => finish(true));
    mine.once("exit", (code) => finish(code !== 0));
  }
  return {
    sync,
    stop,
    status: () => status,
    command: (id) => child?.stdin.write(id + "\n"),
  };
}
module.exports = { session };
