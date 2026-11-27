import assert from "node:assert/strict";
import { test } from "node:test";
import { trackDecorativeMotion } from "../../../apps/web/src/chronos/perf/decorativeMotion.ts";

function fixture(t, reduced = false) {
  let now = 0, end = null, callback;
  const classes = new Set();
  const media = Object.assign(new EventTarget(), { matches: reduced });
  const win = Object.assign(new EventTarget(), {
    matchMedia: () => media,
    setTimeout(fn, ms) { assert.equal(end, null); end = now + ms; callback = fn; return 1; },
    clearTimeout() { end = null; },
  });
  const doc = Object.assign(new EventTarget(), {
    hidden: false, focused: true, hasFocus: () => doc.focused,
    documentElement: { classList: { add: name => classes.add(name), remove: name => classes.delete(name) } },
  });
  t.mock.method(performance, "now", () => now);
  const stop = trackDecorativeMotion(win, doc);
  t.after(stop);
  function advance(ms) {
    const target = now + ms;
    while (end !== null && end <= target) { now = end; end = null; callback(); }
    now = target;
  }
  function input(type) { doc.dispatchEvent(new Event(type)); }
  return { doc, win, media, advance, input, stop, active: () => classes.has("chronos-motion-active") };
}

test("a single deadline follows the last input and resumes from idle", t => {
  const f = fixture(t);
  assert.ok(f.active());
  f.advance(14999);
  f.input("pointermove");
  f.advance(14999);
  assert.ok(f.active());
  f.advance(1);
  assert.ok(!f.active());
  f.input("keydown");
  assert.ok(f.active());
  f.advance(15000);
  assert.ok(!f.active());
  f.input("wheel");
  assert.ok(f.active());
});

test("hidden and unfocused windows ignore input and reactivate on foreground focus", t => {
  const f = fixture(t);
  f.doc.focused = false;
  f.win.dispatchEvent(new Event("blur"));
  f.input("pointerdown");
  assert.ok(!f.active());
  f.doc.focused = true;
  f.win.dispatchEvent(new Event("focus"));
  assert.ok(f.active());
  f.doc.hidden = true;
  f.input("visibilitychange");
  f.input("input");
  assert.ok(!f.active());
  f.doc.hidden = false;
  f.input("visibilitychange");
  assert.ok(f.active());
});

test("reduced motion takes effect at startup and on change, and disposal detaches input", t => {
  const f = fixture(t, true);
  f.input("keydown");
  assert.ok(!f.active());
  f.media.matches = false;
  f.media.dispatchEvent(new Event("change"));
  assert.ok(f.active());
  f.media.matches = true;
  f.media.dispatchEvent(new Event("change"));
  f.input("pointermove");
  assert.ok(!f.active());
  f.stop();
  f.media.matches = false;
  f.media.dispatchEvent(new Event("change"));
  f.input("keydown");
  assert.ok(!f.active());
});
