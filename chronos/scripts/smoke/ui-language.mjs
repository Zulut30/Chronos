import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";

// Runs before the existing strict Russian suite, on its empty, disposable profile.
export async function verifyUiLanguage(client) {
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
    await until(selector, () => evaluate("!!" + element + "?.getClientRects().length"));
    const point = await evaluate("(() => {const e=" + element + "; e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
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
    "script", "style", "[translate=no]:not(html)", ".chat-markdown", "[data-user-message-bubble]",
    "[contenteditable=true]", ".xterm", "[data-thread-item] .truncate", "[data-item-path]", "[data-file-path]",
    ".oly-tk-card .t", ".oly-tk-card .d", ".oly-tk-item[data-sel^='p:'] > span", ".oly-tk-item[data-sel^='g:'] > span",
    "[data-oly-ps-name] h3", "[data-oly-ps-name] p", "[data-oly-ps-name] .oly-ps-cmd", ".card[data-path] .cap .name", "[data-thumb] svg",
    "#cards article > h2", "#cards article > p", ".row[data-name] .name", ".endpoint", "#path code",
    "[data-open] .name > span:first-child", ".subh .lbl", "button.mname[data-open]",
  ].join(",");
  async function scan(id, expected, loadedPanel) {
    let lines;
    await until(id + " control " + expected, async () => {
      await client.pumpFrames(1, 0);
      lines = await client.visibleLines(undefined, undefined, userContent, loadedPanel);
      return lines.some(line => line.includes(expected));
    });
    if (loadedPanel) lines = await client.visibleLines(undefined, undefined, userContent);
    const cyrillic = lines.filter(line => /\p{Script=Cyrillic}/u.test(line));
    assert.deepEqual(cyrillic, [], id + " contains Cyrillic: " + JSON.stringify(cyrillic));
  }
  await language("en");
  await scan("general", "Notifications");
  await route("/settings/appearance");
  await scan("appearance", "T3 Code");
  await until("published Olympus", () => evaluate("!!document.querySelector('[data-theme-library-card=olympus]')"));
  const original = await evaluate("JSON.parse(localStorage.getItem('t3code:environment-themes:v1')).find(t=>t.id==='olympus')");
  assert.ok(original?.variants?.dark || original?.variants?.light);
  // Import the same exported file twice through the settings dialog.
  const exportFile = { version: 1, ...original, id: "smoke-reimport", name: "Reimported Olympus" };
  const storedImports = () => evaluate("localStorage.getItem('t3code:themes:v1')");
  const before = await storedImports();
  for (let pass = 0; pass < 2; pass++) {
    const open = await client.probe("performAction", { type: "click", selector: "button", text: "Add theme" });
    assert.ok(open.ok, open.detail);
    await click("#theme-json-editor");
    await evaluate("document.querySelector('#theme-json-editor').select()");
    await client.send("Input.insertText", { text: JSON.stringify(exportFile) });
    const submit = await client.probe("performAction", { type: "click", selector: "[role=dialog] button", text: "Add theme" });
    assert.ok(submit.ok, submit.detail);
    await until("reimport selects the published theme", () => evaluate("!document.querySelector('#theme-json-editor') && localStorage.getItem('t3code:theme')==='olympus'"));
    assert.equal(await storedImports(), before, "reimport must not write another theme");
  }
  // Simulate older clients with two stored imports and a selected duplicate in both halves.
  // Reload twice to cover hydration as well as a reconnect that republishes the same theme.
  await evaluate("(() => {const theme=" + JSON.stringify(original) + ";const night=theme.appearance==='dark'?theme.colors:theme.variants.dark;const copies=[{...theme,id:'smoke-olympus-a',colors:{...theme.colors,canvas:'#012345'}}, {...theme,id:'smoke-olympus-b',label:'Imported Graphite',appearance:'dark',colors:night,variants:undefined}];localStorage.setItem('t3code:themes:v1',JSON.stringify(copies));localStorage.setItem('t3code:theme',copies[0].id);localStorage.setItem('t3code:theme-halves:v1',JSON.stringify({light:copies[0].id,dark:copies[1].id}));})()");
  for (let pass = 0; pass < 2; pass++) {
    const previousDocument = await evaluate("performance.timeOrigin");
    await client.send("Page.reload");
    await until("theme migration in the new document", () => evaluate(
      `(() => {
        if (performance.timeOrigin === ${JSON.stringify(previousDocument)} || document.readyState === 'loading' ||
            document.documentElement?.lang !== 'en' || !document.querySelector('[data-theme-library-card=olympus]')) return false;
        const halves = JSON.parse(localStorage.getItem('t3code:theme-halves:v1'));
        return localStorage.getItem('t3code:theme') === 'olympus' && halves?.light === 'olympus' && halves?.dark === 'olympus';
      })()`));
    const ids = await evaluate("Array.from(document.querySelectorAll('[data-theme-library-card]'),e=>e.dataset.themeLibraryCard)");
    assert.equal(new Set(ids).size, ids.length);
    assert(!ids.includes("smoke-olympus-b"));
    await until("redundant Graphite import removed from storage", async () =>
      !JSON.parse((await storedImports()) || "[]").some(theme => theme.id === "smoke-olympus-b"));
    const imports = JSON.parse((await storedImports()) || "[]");
    const edited = imports.find(theme => theme.id === "smoke-olympus-a");
    assert.equal(edited?.label, original.label + " (2)", "distinct edited palette retains a unique name");
    assert.equal(edited.colors.canvas, "#012345");
    await until("renamed edit is selectable", () => evaluate("!!document.querySelector('[data-theme-library-card=smoke-olympus-a]')"));
  }
  for (const [id, selector, text, loadedPanel] of [
    ["API keys", "[data-oly-ik-nav] button", "Scrape.do"],
    ["MCP", "[data-oly-mcp-nav] button", "Settings location", "#path:not([hidden]) code"],
    ["templates", "[data-oly-ps-nav-button]", "Your templates"],
  ]) {
    await route("/settings/general");
    await click(selector);
    await scan(id, text, loadedPanel);
    await click("[data-settings-section='/settings/general']");
  }
  await route("/settings/providers");
  await scan("providers", "Codex");
  await route("/usage");
  await scan("usage", "Usage");
  await route("/");
  await client.probe("ensureDraft");
  await scan("home", "What should we work on?");
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
  await language("ru");
  assert.equal(await evaluate("performance.getEntriesByType('resource').some(e=>e.name.includes('/chronos-english-'))"), false);
  return { english: true, russian: true, themes: true };
}
