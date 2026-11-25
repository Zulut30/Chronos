import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";

// Runs in the measured renderer. A frame is sampled only if the target thread owns its content.
function install(tracing) {
  const state = { tasks: [] };
  let switchIndex = 0;
  const observer = new PerformanceObserver((list) =>
    state.tasks.push(...list.getEntries().map((e) => e.duration)),
  );
  observer.observe({ type: "longtask" });
  const editor = () => document.querySelector("[data-slot=composer-host] [contenteditable=true]");
  const frames = (ready, label) =>
    new Promise((resolve, reject) => {
      const expiry = performance.now() + 7000;
      const tick = () => {
        if (ready()) resolve(performance.now());
        else if (performance.now() > expiry)
          reject(
            Error(
              "No eligible target frame: " +
                label +
                " path=" +
                location.href +
                " editor=" +
                !!editor() +
                " timeline=" +
                [...document.querySelectorAll("[data-timeline-root]")]
                  .map((e) => e.textContent.slice(0, 120))
                  .join("|")
                  .slice(0, 500),
            ),
          );
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  const row = (id) => document.querySelector('[data-thread-item$="' + id + '"] [data-sidebar-row]');
  const timeline = () => document.querySelector("[data-timeline-root]");
  const hasText = (needle) =>
    Array.from(document.querySelectorAll("[data-timeline-root]")).some((el) =>
      el.textContent.includes(needle),
    );
  const scroller = (child) => {
    for (let el = child; el; el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(el).overflowY))
        return el;
    }
    throw Error("Scrollable ancestor missing for " + child?.tagName);
  };
  const center = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + Math.min(r.height, 50) / 2 };
  };
  window.uiBench = {
    hasText,
    topOfTimeline() {
      scroller(timeline()).scrollTop = 0;
    },
    async openSettings() {
      const started = performance.now();
      void window.__TSR_ROUTER__.navigate({ to: "/settings/general" });
      return (
        (await frames(
          () =>
            location.href.includes("/settings/general") &&
            !!document.querySelector("nav[data-workspace-area=settings-nav]") &&
            !!document.querySelector("[data-oly-prompts-nav]"),
          "general settings",
        )) - started
      );
    },
    armSwitch(id) {
      const el = row(id);
      if (!el) throw Error("Missing sidebar target " + id);
      el.scrollIntoView({ block: "nearest", behavior: "instant" });
      const activate = () => {
        const start = performance.now();
        const mark = "chronos-switch-" + ++switchIndex;
        if (tracing) performance.mark(mark + "-start");
        const needle = "MARK_" + id + "_";
        state.pending = (async () => {
          const first = await frames(() => hasText(needle) && location.href.includes(id), "first " + id);
          if (tracing) performance.mark(mark + "-target");
          const ready = await frames(
            () => hasText(needle + "11_") && !!editor()?.isContentEditable,
            "ready " + id,
          );
          return { first: first - start, ready: ready - start };
        })();
        el.click();
      };
      state.activate = activate;
      return center(el);
    },
    activate: () => state.activate(),
    pending: () => state.pending,
    armInput() {
      const el = editor();
      if (!el) throw Error("Composer missing");
      el.focus();
      el.addEventListener(
        "keydown",
        (e) => {
          state.pending = frames(() => el.textContent.endsWith("z")).then((t) => t - e.timeStamp);
        },
        { once: true },
      );
    },
    beginScroll(area) {
      const el = scroller(area === "sidebar" ? document.querySelector("[data-thread-item]") : timeline());
      el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) / 2);
      const start = el.scrollTop;
      const times = [];
      let active = true;
      function tick(t) {
        if (active) {
          times.push(t);
          requestAnimationFrame(tick);
        }
      }
      requestAnimationFrame(tick);
      state.endScroll = () => {
        active = false;
        return { times, distance: Math.abs(el.scrollTop - start), height: el.scrollHeight };
      };
      return center(el);
    },
    endScroll: () => state.endScroll(),
    async fixedTimeline() {
      const el = scroller(timeline());
      const frame = () => new Promise(requestAnimationFrame);
      const step = 24;
      const count = 72;
      // Let the virtual list measure the top of the seeded, completed chat before timing.
      for (let i = 0; i < 12; i++) {
        el.scrollTo({ top: 0, behavior: "instant" });
        await frame();
      }
      if (el.scrollTop !== 0 || el.scrollHeight - el.clientHeight < step * count)
        throw Error("Seeded timeline cannot fit the fixed scroll path");
      const times = [await frame()];
      let path = 0;
      for (let i = 1; i <= count; i++) {
        const previous = el.scrollTop;
        if (Math.abs(previous - step * (i - 1)) > 1)
          throw Error("Timeline anchor moved outside the fixed scroll path: " + previous);
        el.scrollTo({ top: step * i, behavior: "instant" });
        times.push(await frame());
        path += Math.abs(el.scrollTop - previous);
      }
      if (Math.abs(path - step * count) > 1 || Math.abs(el.scrollTop - step * count) > 1)
        throw Error("Incomplete fixed scroll path: " + path + " / " + el.scrollTop);
      return { fps: (1000 * count) / (times.at(-1) - times[0]), frames: count, distance: path };
    },
    end: () => [...state.tasks, ...observer.takeRecords().map((e) => e.duration)],
  };
}
const pct = (xs, p) => xs.toSorted((a, b) => a - b)[Math.ceil(xs.length * p) - 1];

export async function measureUi({ page, evaluate, targets, streamingId, navigate, wait, verifyStreaming }) {
  await evaluate("(" + install.toString() + ")(" + Boolean(process.env.BENCH_UI_TRACE) + ")");
  assert.equal(await evaluate("document.visibilityState"), "visible");
  const summarize = (xs) => ({
    count: xs.length,
    p50: pct(xs, 0.5),
    p95: pct(xs, 0.95),
    max: Math.max(...xs),
  });
  const switches = [];
  for (let i = 0; i < 8; i++) {
    const id = targets[i % 2];
    const point = await evaluate("uiBench.armSwitch(" + JSON.stringify(id) + ")");
    await page("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    await sleep(175); // A user resting on the row can warm its projection.
    await evaluate("uiBench.activate()");
    const timing = await evaluate("uiBench.pending()");
    assert(timing?.first >= 0 && timing.ready >= timing.first);
    switches.push(timing);
  }
  async function scroll(area) {
    const point = await evaluate("uiBench.beginScroll(" + JSON.stringify(area) + ")");
    for (let i = 0; i < 35; i++) {
      await page("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        ...point,
        deltaX: 0,
        deltaY: i < 18 ? 65 : -35,
      });
      await sleep(27);
    }
    const { times, distance, height } = await evaluate("uiBench.endScroll()");
    assert(
      times.length > 2 && distance > 5,
      area + " did not scroll: " + JSON.stringify({ times: times.length, distance, height }),
    );
    return {
      fps: (1000 * (times.length - 1)) / (times.at(-1) - times[0]),
      frames: times.length,
      distance,
    };
  }
  const timeline = process.env.BENCH_FIXED_SCROLL === "1"
    ? await evaluate("uiBench.fixedTimeline()")
    : await scroll("timeline");
  const sidebar = await scroll("sidebar");
  if (streamingId) {
    await navigate(streamingId);
    await wait("visible stream", () =>
      evaluate("uiBench.hasText(" + JSON.stringify("MARK_" + streamingId + "_") + ")"),
    );
    verifyStreaming();
  }
  const input = [];
  for (let i = 0; i < 14; i++) {
    await evaluate("uiBench.armInput()");
    await page("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "z",
      code: "KeyZ",
      text: "z",
      windowsVirtualKeyCode: 90,
    });
    await page("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "z",
      code: "KeyZ",
      windowsVirtualKeyCode: 90,
    });
    const latency = await evaluate("uiBench.pending()");
    assert(Number.isFinite(latency) && latency >= 0);
    input.push(latency);
    for (const type of ["keyDown", "keyUp"])
      await page("Input.dispatchKeyEvent", {
        type,
        key: "Backspace",
        code: "Backspace",
        windowsVirtualKeyCode: 8,
      });
    await sleep(70);
  }
  if (streamingId) verifyStreaming();
  const tasks = await evaluate("uiBench.end()");
  return {
    firstMs: summarize(switches.map((t) => t.first)),
    readyMs: summarize(switches.map((t) => t.ready)),
    inputMs: summarize(input),
    timeline,
    sidebar,
    longTasks: {
      count: tasks.length,
      max: Math.max(0, ...tasks),
      blockingMs: tasks.reduce((n, t) => n + Math.max(0, t - 50), 0),
    },
  };
}
