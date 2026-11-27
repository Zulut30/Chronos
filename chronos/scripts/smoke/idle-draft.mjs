import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";

const decorations = ["oly-spin", "oly-rise", "oly-twinkle", "oly-glint"];

export async function prepareIdleDraft(probe, send) {
  await send("Page.bringToFront");
  let state;
  const until = Date.now() + 60000;
  do {
    await probe("dismissOnboarding", { readyProvider: true });
    await probe("ensureDraft");
    state = await probe("draftMotion");
    if (state.draft && state.theme === "olympus" && !state.dark) {
      await probe("performAction", { type: "click", selector: "button[aria-label='День / ночь'], button[aria-label='Day / night']" });
    }
    if (state.draft && state.dark && state.theme === "olympus") {
      assert.equal(state.reduced, false, "Benchmark requires normal motion preference");
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 40, y: 100 });
      state = await probe("draftMotion");
      if (state.focused && decorations.every(name => state.animations[name] === "running")) return;
    }
    await sleep(250);
  } while (Date.now() < until);
  throw Error("Expected four running decorations in the focused dark Olympus draft: " + JSON.stringify(state));
}

export async function readIdleDraft(probe, expectPaused) {
  const state = await probe("draftMotion");
  assert.ok(state.draft && state.focused && state.dark && state.theme === "olympus" && !state.reduced,
    "Lost the foreground dark draft: " + JSON.stringify(state));
  for (const name of decorations) {
    assert.ok(["running", "paused"].includes(state.animations[name]), "Missing decoration: " + name);
    if (expectPaused) assert.equal(state.animations[name], "paused", name);
  }
  if (expectPaused) assert.deepEqual(state.running, [], "Infinite animation still running on an idle draft");
  return state;
}

export async function verifyResume(probe, send, start, end) {
  for (const name of decorations) {
    assert.ok(start.times[name] > 0 && start.times[name] === end.times[name], name + " drifted while paused");
  }
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 45, y: 102 });
  await sleep(200);
  const resumed = await probe("draftMotion");
  for (const name of decorations) {
    assert.equal(resumed.animations[name], "running");
    assert.ok(resumed.times[name] > end.times[name], name + " did not continue from the paused phase");
  }
}
