import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";

const decorations = ["oly-spin", "oly-rise", "oly-twinkle", "oly-glint"];

export async function prepareIdleDraft(probe, send) {
  // Hosted Windows desktops can request reduced motion. Measure the same normal-motion
  // workload on both packages without changing the runner's accessibility settings.
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  });
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
      await probe("focusDraftEditor");
      assert.equal(state.reduced, false, "Benchmark requires normal motion preference");
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 40, y: 100 });
      state = await probe("draftMotion");
      if (state.focused && state.caret === "auto" && decorations.every(name => state.animations[name] === "running")) return;
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
  assert.notEqual(state.caret, null, "Draft editor lost focus during the CPU sample");
  if (expectPaused) {
    assert.equal(state.caret, "manual", "Idle caret is still blinking");
    assert.deepEqual(state.running, [], "Infinite animation still running on an idle draft");
  }
  return state;
}

export async function verifyResume(probe, send, start, end) {
  for (const name of decorations) {
    assert.ok(start.times[name] > 0 && start.times[name] === end.times[name], name + " drifted while paused");
  }
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 45, y: 102 });
  await sleep(200);
  const resumed = await probe("draftMotion");
  assert.equal(resumed.caret, "auto", "Input must restore normal caret blinking");
  for (const name of decorations) {
    assert.equal(resumed.animations[name], "running");
    assert.ok(resumed.times[name] > end.times[name], name + " did not continue from the paused phase");
  }
}
