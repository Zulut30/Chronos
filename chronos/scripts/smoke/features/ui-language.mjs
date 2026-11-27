import assert from "node:assert/strict";
import { verifyThemeLibrary } from "./theme-library.mjs";
import { setTimeout as sleep } from "node:timers/promises";

// Runs before the existing strict Russian suite, on its empty, disposable profile.
export async function check({ client, opts, viewport }) {
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
  async function key(key, code) {
    for (const type of ["rawKeyDown", "keyUp"]) {
      await client.send("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode: code });
    }
  }

  async function verifyUpdateTooltip(locale) {
    if (process.env.T3CODE_DISABLE_AUTO_UPDATE !== "1") return null;
    const [title, detail] = locale === "ru"
      ? ["Обновления недоступны", "Автообновление отключено параметром T3CODE_DISABLE_AUTO_UPDATE."]
      : ["Updates unavailable", "Automatic updates are disabled by T3CODE_DISABLE_AUTO_UPDATE."];
    let point;
    await until(locale + " update button", async () => {
      point = await evaluate(`(() => {
        const button = document.querySelector('[data-app-sidebar] button[aria-label*="T3CODE_DISABLE_AUTO_UPDATE"]');
        if (!button?.checkVisibility()) return null;
        const r = button.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: button.getAttribute("aria-label") };
      })()`);
      return point;
    });
    assert.ok(point.label.includes(title) && point.label.includes(detail), point.label);
    await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
    try {
      await until(locale + " update tooltip", () => evaluate(`Array.from(document.querySelectorAll('[role="tooltip"]'))
        .some(el => el.checkVisibility() && el.textContent.includes(${JSON.stringify(title)}) && el.textContent.includes(${JSON.stringify(detail)}))`));
    } finally {
      await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
    }
    return { title, detail };
  }

  async function compactLanguagePicker(locale) {
    const search = "[data-chronos-settings-nav] input[role=combobox]";
    await client.send("Emulation.setDeviceMetricsOverride", { ...viewport, width: 900, mobile: false });
    try {
      for (const query of ["язык", "language"]) {
        await route("/settings/about");
        await click(search);
        await client.send("Input.insertText", { text: query });
        await until(query + " selects the language result", () => evaluate(
          "document.querySelector('#settings-search-result-language')?.getAttribute('aria-selected') === 'true'"));
        await key("Enter", 13);
        await until("language picker from " + query, () => evaluate(
          "window.__TSR_ROUTER__?.state.location.pathname === '/settings/general' && !!document.querySelector('#language [data-ui-language-picker]')"));
      }
      await click("[data-ui-language-picker]");
      await until("long language name", () => evaluate("!!document.querySelector('[data-ui-language=pt-BR]')"));
      const names = await evaluate(`(() => {
        const options = [...document.querySelectorAll('[data-ui-language]')];
        const names = new Intl.DisplayNames([${JSON.stringify(locale)}], { type: 'language' });
        return options.map(option => {
          const label = option.querySelector('[data-slot=select-item-text]');
          const range = document.createRange(); range.selectNodeContents(label);
          const text = range.getBoundingClientRect(), box = option.getBoundingClientRect();
          return { name: label.textContent.trim(), expected: names.of(option.dataset.uiLanguage),
            fits: text.left >= box.left - 1 && text.right <= box.right + 1 && box.left >= 0 && box.right <= innerWidth + 1 };
        });
      })()`);
      assert.ok(names.length > 2 && names.every(item => item.name === item.expected && item.fits),
        locale + " language names at 900px: " + JSON.stringify(names));
      if (locale === "ru") {
        // Exercise an actual long selected value as well as the open popup.
        await click("[role=option][data-ui-language=pt-BR]");
        try {
          await until("Portuguese (Brazil) persisted", () => evaluate(
            "(async () => (await window.desktopBridge.getClientSettings())?.language === 'pt-BR')()"));
          await until("Portuguese (Brazil) rendered", () => evaluate(
            "document.querySelector('[data-ui-language-picker] [data-slot=select-value]')?.textContent.trim() === new Intl.DisplayNames(['pt-BR'], {type:'language'}).of('pt-BR')"));
          const bounds = await evaluate(`(async () => {
            await document.fonts.ready;
            await new Promise(requestAnimationFrame);
            const value = document.querySelector('[data-ui-language-picker] [data-slot=select-value]');
            const text = document.createRange(); text.selectNodeContents(value);
            return { label: text.getBoundingClientRect().toJSON(), box: value.getBoundingClientRect().toJSON() };
          })()`);
          const { label, box } = bounds;
          assert.ok(label.left >= box.left - 1 && label.right <= box.right + 1
            && label.top >= box.top - 1 && label.bottom <= box.bottom + 1,
            "Selected Portuguese (Brazil) label at 900px: " + JSON.stringify(bounds));
        } finally {
          await language("ru");
        }
      } else {
        await key("Escape", 27);
      }
    } finally {
      await client.send("Emulation.setDeviceMetricsOverride", { ...viewport, mobile: false });
    }
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
  const updateTooltips = {};
  try {
    await language("en");
    await compactLanguagePicker("en");
    if (await evaluate("window.desktopBridge.offlineRehearsal === true")) {
      await scan("offline general settings", "Notifications");
      assert.ok(await evaluate("!window.chronosPC && !document.querySelector('#pc-control')"),
        "Offline settings must omit the unavailable computer control bridge and editor");
      await click("[data-chronos-settings-nav] input[role=combobox]");
      await client.send("Input.insertText", { text: "Computer control" });
      await until("offline settings search completed", () => evaluate(
        "!!document.querySelector('#settings-search-results, [data-chronos-settings-nav] [role=status]')"));
      assert.ok(await evaluate("!document.querySelector('#settings-search-result-pc-control, #settings-search-result-pc-control-history')"));
      await key("Escape", 27);
    } else {
      await scan("general", "Computer control");
      await until("computer control editor or availability", () => evaluate(
        "!!document.querySelector('#pc-control form, #pc-control [role=alert]') || !!document.querySelector('#pc-control [role=status]')?.textContent.includes('unavailable')"));
      if (await evaluate("!!document.querySelector('#pc-control-history button')")) {
        await click("#pc-control-history button");
        await scan("computer control action log", "No actions yet.");
      } else {
        await scan("computer control availability", "Computer control");
      }
    }
    await route("/settings/about");
    await scan("desktop updates", "About", "#app-version");
    await route("/settings/threads");
    await scan("quota settings", "Usage limits");
    await route("/settings/source-control");
    await scan("issue trackers", "Trello");
    await click("button[aria-label='Toggle Trello details']");
    await scan("Trello credentials", "Personal token");
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
      if (id === "templates") {
        const create = await client.probe("performAction", { type: "click", selector: ".oly-ps-pane button", text: "New template" });
        assert.ok(create.ok, create.detail);
        await scan("template editor", "Template name in the ! menu.");
      }
      await click("[data-chronos-settings-nav] [data-settings-section='/settings/general']");
    }
    await route("/settings/providers");
    await scan("providers", "Codex");
    await evaluate("window.__TSR_ROUTER__.navigate({to:'/settings/providers',search:{instanceId:'antigravity'},hash:'claude-idle-unload'})");
    await scan("advanced provider settings", "Unload idle Claude", "#claude-idle-unload");
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
    updateTooltips.en = await verifyUpdateTooltip("en");
    await click("button[aria-label=Artifacts]");
    await scan("artifact gallery", "Artifacts", "[data-artifact-gallery]");
    await click(".art-head button[aria-label=Close]");
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
  await compactLanguagePicker("ru");
  await route("/");
  updateTooltips.ru = await verifyUpdateTooltip("ru");
  assert.equal(await evaluate("performance.getEntriesByType('resource').some(e=>e.name.includes('/chronos-english-'))"), false);
  return { english: true, russian: true, themes: true, updateTooltips };
}
