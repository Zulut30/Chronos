import assert from "node:assert/strict";
import { verifyThemeLibrary } from "./theme-library.mjs";
import { setTimeout as sleep } from "node:timers/promises";

// Runs before the existing strict Russian suite, on its empty, disposable profile.
export async function check({ client, opts }) {
  async function evaluate(expression) {
    const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  async function until(label, predicate) {
    const deadline = Date.now() + 18000;
    do {
      try { if (await predicate()) return; } catch (error) {
        if (!/context.*destroyed|context.*found|No (?:target|frame) with given id|navigat|__TSR_ROUTER__|undefined.*querySelector/i.test(String(error))) throw error;
      }
      await sleep(120);
    } while (Date.now() < deadline);
    throw Error("Timed out waiting for " + label + ": " + JSON.stringify((await client.visibleLines()).slice(-65)));
  }
  async function route(to) {
    const result = await client.probe("performAction", { type: "navigate", to });
    assert.ok(result.ok, result.detail);
    if (to === "/") return;
    await until(to, () => evaluate("window.__TSR_ROUTER__?.state.location.pathname === " + JSON.stringify(to)));
  }
  async function click(selector) {
    const element = "document.querySelector(" + JSON.stringify(selector) + ")";
    let point;
    await until(selector, async () => {
      point = await evaluate(`(() => {
        const el = ${element};
        if (!el?.getClientRects().length) return null;
        el.scrollIntoView({block:'center',behavior:'instant'});
        const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
        return el.contains(document.elementFromPoint(x, y)) ? {x, y} : null;
      })()`);
      return point;
    });
    for (const type of ["mousePressed", "mouseReleased"]) {
      await client.send("Input.dispatchMouseEvent", { type, button: "left", clickCount: 1, ...point });
    }
  }
  async function language(next) {
    await route("/settings/general");
    await click("[data-ui-language-picker]");
    await click("[role=option][data-ui-language=" + next + "]");
    await until("persisted " + next, () => evaluate(
      "(async () => document.readyState !== 'loading' && !!window.__TSR_ROUTER__ && document.documentElement?.lang === " + JSON.stringify(next) +
      " && window.__chronosShellLanguage === " + JSON.stringify(next) + " && (await window.desktopBridge.getClientSettings())?.language === " + JSON.stringify(next) + ")()"));
  }
  const userContent = [
    "script", "style", "[translate=no]:not(html)", "[data-chronos-markdown]", ".chat-markdown", "[data-chronos-editor]", "[data-user-message-bubble]",
    "[contenteditable=true]", ".xterm", "[data-thread-item] .truncate", "[data-item-path]", "[data-file-path]",
    ".oly-tk-card .t", ".oly-tk-card .d", ".oly-tk-item[data-sel^='p:'] > span", ".oly-tk-item[data-sel^='g:'] > span",
    "[data-oly-ps-name] h3", "[data-oly-ps-name] p", "[data-oly-ps-name] .oly-ps-cmd", ".card[data-path] .cap .name", "[data-thumb] svg",
    "#cards article > h2", "#cards article > p", ".row[data-name] .name", ".endpoint", "#path code",
    "[data-open] .name > span:first-child", ".subh .lbl", "button.mname[data-open]",
  ].join(",");
  async function scan(id, expected, loadedPanel, prepare) {
    let lines;
    await until(id + " control " + expected, async () => {
      await client.pumpFrames(1, 0);
      if (prepare && !(await prepare())) return false;
      lines = await client.visibleLines(undefined, undefined, userContent, loadedPanel);
      return lines.some(line => line.includes(expected));
    });
    if (loadedPanel) lines = await client.visibleLines(undefined, undefined, userContent);
    const cyrillic = lines.filter(line => /\p{Script=Cyrillic}/u.test(line));
    assert.deepEqual(cyrillic, [], id + " contains Cyrillic: " + JSON.stringify(cyrillic));
  }
  try {
    await language("en");
    await scan("general", "Notifications");
    await route("/settings/appearance");
    await scan("appearance", "T3 Code");
    await verifyThemeLibrary({ client, evaluate, until });
    for (const [id, selector, text, loadedPanel] of [
      ["API keys", "[data-oly-ik-nav] button", "Scrape.do"],
      ["MCP", "[data-oly-mcp-nav] button", "Settings location", "#path:not([hidden]) code"],
      ["templates", "[data-oly-ps-nav-button]", "Your templates"],
    ]) {
      await route("/settings/general");
      await click(selector);
      await scan(id, text, loadedPanel);
      await click("[data-chronos-settings-nav] [data-settings-section='/settings/general']");
    }
    await route("/settings/providers");
    await scan("providers", "Codex");
    await route("/settings/scheduled-tasks");
    await scan("scheduler", "New task");
    const createTask = "#scheduled-tasks button:not(:disabled)";
    await until("enabled new task button", () => evaluate(
      "Array.from(document.querySelectorAll(" + JSON.stringify(createTask) + ")).some(b => b.textContent.trim() === 'New task')"));
    const opened = await client.probe("performAction", { type: "click", selector: createTask, text: "New task" });
    assert.ok(opened.ok, opened.detail);
    await scan("fixed-time schedule", "Run one missed occurrence on next startup");
    await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await route("/usage");
    await scan("usage", "Usage");
    await route("/");
    await scan("home", "What should we work on?", undefined, async () => {
      // Opening settings directly can precede the first-run redirect. Let the real
      // onboarding finish when it appears after reload, then enter the draft normally.
      const welcome = await client.probe("dismissOnboarding", { readyProvider: opts.requireProvider });
      return !welcome.wasWelcome && await client.probe("ensureDraft");
    });
    for (const [id, selector, text, loadedPanel] of [
      ["Tasks", "[data-oly-tasks]", "All projects"],
      ["Studio", "button[aria-label=Studio]", "Boards", "#view .cards [data-new]"],
      ["Skills", "[data-oly-skills] button,button[data-oly-skills]", "All skills", "#main .row[data-open], #main .empty"],
    ]) {
      await click(selector);
      await scan(id, text, loadedPanel);
      await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    }
  } finally {
    await language("ru");
  }
  assert.equal(await evaluate("performance.getEntriesByType('resource').some(e=>e.name.includes('/chronos-english-'))"), false);
  return { english: true, russian: true, themes: true };
}
