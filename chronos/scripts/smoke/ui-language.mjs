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
        if (!/context.*destroyed|context.*found|navigat|__TSR_ROUTER__|undefined.*querySelector/i.test(String(error))) throw error;
      }
      await sleep(120);
    } while (Date.now() < deadline);
    throw Error("Timed out waiting for " + label);
  }
  async function route(to) {
    await client.probe("performAction", { type: "navigate", to });
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
      "(async () => !!window.__TSR_ROUTER__ && document.documentElement.lang === " + JSON.stringify(next) +
      " && window.__chronosShellLanguage === " + JSON.stringify(next) + " && (await window.desktopBridge.getClientSettings()).language === " + JSON.stringify(next) + ")()"));
  }
  async function scan(id, expected) {
    let lines;
    await until(id + " control " + expected, async () => {
      lines = await client.visibleLines();
      return lines.some(line => line.includes(expected));
    });
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
  // Simulate older clients with two stored imports and a selected duplicate in both halves.
  // Reload twice to cover hydration as well as a reconnect that republishes the same theme.
  await evaluate("(() => {const theme=" + JSON.stringify(original) + ";const copies=[{...theme,id:'smoke-olympus-a'}, {...theme,id:'smoke-olympus-b',label:'Imported copy'}];localStorage.setItem('t3code:themes:v1',JSON.stringify(copies));localStorage.setItem('t3code:theme',copies[0].id);localStorage.setItem('t3code:theme-halves:v1',JSON.stringify({light:copies[0].id,dark:copies[1].id}));})()");
  for (let pass = 0; pass < 2; pass++) {
    await client.send("Page.reload");
    await until("theme migration after reload", () => evaluate(
      "document.documentElement.lang==='en' && !!document.querySelector('[data-theme-library-card=olympus]') && localStorage.getItem('t3code:theme')==='olympus' && Object.values(JSON.parse(localStorage.getItem('t3code:theme-halves:v1'))).every(id=>id==='olympus')"));
    const ids = await evaluate("Array.from(document.querySelectorAll('[data-theme-library-card]'),e=>e.dataset.themeLibraryCard)");
    assert.equal(new Set(ids).size, ids.length);
    assert(!ids.some(id => id.startsWith("smoke-olympus")));
  }
  for (const [id, selector, text] of [
    ["API keys", "[data-oly-ik-nav] button", "Scrape.do"],
    ["MCP", "[data-oly-mcp-nav] button", "New MCP server"],
    ["templates", "[data-oly-ps-nav-button]", "Your templates"],
  ]) {
    await route("/settings/general");
    await click(selector);
    await scan(id, text);
    await click("[data-settings-section='/settings/general']");
  }
  await route("/settings/providers");
  await scan("providers", "Codex");
  await route("/usage");
  await scan("usage", "Usage");
  await route("/");
  await client.probe("ensureDraft");
  await scan("home", "project");
  for (const [id, selector, text] of [
    ["Tasks", "[data-oly-tasks] button", "All projects"],
    ["Studio", "button[aria-label=Studio]", "Boards"],
    ["Skills", "[data-oly-skills] button", "All skills"],
  ]) {
    await click(selector);
    await scan(id, text);
    await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  }
  await language("ru");
  assert.equal(await evaluate("performance.getEntriesByType('resource').some(e=>e.name.includes('/chronos-english-'))"), false);
  return { english: true, russian: true, themes: true };
}
