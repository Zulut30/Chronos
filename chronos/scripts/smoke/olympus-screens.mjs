import { verifyAnchors, verifyPickerContext, globals } from "./verify-seams.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function seedChat(exe, home) {
  const dir = mkdtempSync(join(process.env.RUNNER_TEMP, "theme-demo-"));
  const entry = join(dirname(exe), "resources/server.asar/apps/server/dist/bin.mjs");
  const cli = (...args) => execFileSync(exe, [entry, ...args, "--base-dir", home], {
    cwd: dir, encoding: "utf8", timeout: 60000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", T3CODE_HOME: home },
  });
  const settings = join(home, "userdata", "settings.json");
  const saved = JSON.parse(readFileSync(settings, "utf8"));
  saved.providerInstances = { ...saved.providerInstances, palette: {
    enabled: true, driver: "acpRegistry", displayName: "Палитра",
    config: { source: "local", commandPath: process.execPath, commandArgs: [join(import.meta.dirname, "theme-chat.mjs")] },
  } };
  writeFileSync(settings + ".tmp", JSON.stringify(saved));
  renameSync(settings + ".tmp", settings);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  cli("project", "add", dir, "--title", "Пример");
  const { threadId, status } = JSON.parse(cli("thread", "start", dir, "Как выглядит встроенный код?",
    "--title", "Оформление чата", "--provider", "palette", "--model", "default", "--wait", "--json"));
  assert.equal(status, "completed");
  const { origin } = JSON.parse(readFileSync(join(home, "userdata/server-runtime.json"), "utf8"));
  return fetch(origin + "/.well-known/t3/environment").then((r) => r.json())
    .then(({ environmentId }) => "/" + environmentId + "/" + threadId);
}

export async function verifyOlympusScreens({ client, opts, checks, ready, settle, classify }) {
  // This test provisions a provider and a project. Only enable it on the disposable hosted runner.
  assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
  const globalState = await client.probe("checkGlobals", { expected: Object.keys(globals) });
  assert.ok(globalState.ok, globalState.missing.map(name => "Olympus " + globals[name] + " / " + name).join("\n"));
  const home = process.env.CHRONOS_HOME;
  assert.equal(resolve(home), resolve(process.env.RUNNER_TEMP, "chronos-home"));
  const source = join(dirname(opts.launch), "resources/chronos-themes/olympus.json");
  assert.deepEqual(readFileSync(join(home, "userdata/themes/olympus.json")), readFileSync(source));
  const folder = join(opts.outDir, "theme");
  mkdirSync(folder, { recursive: true });
  const results = [];
  async function act(spec) {
    const res = await client.probe("performAction", spec);
    assert.ok(res.ok, res.detail);
  }
  async function wait(spec) {
    const result = await ready(client, spec);
    assert.ok(result.ready, result.detail);
  }
  async function scheme(dark) {
    const state = await client.probe("getThemeState");
    assert.equal(state.themeId, "olympus", "fresh installation should select Olympus");
    if (state.dark !== dark) {
      await act({ type: "click", selector: "button[aria-label='День / ночь']" });
      await settle(client);
    }
  }
  async function capture(id, dark, config = {}) {
    await settle(client, config.settleMs);
    const state = await client.probe("olympusColors");
    assert.equal(state.themeId, "olympus");
    assert.equal(state.dark, dark);
    assert.equal(state.canvas, dark ? "#101216" : "#f3efe6");
    if (dark) {
      assert.equal(state.card, "#1d2229");
      assert.ok(state.glass);
      if (id === "chat") {
        assert.equal(state.inlineBackground, "rgb(36, 42, 51)");
        assert.equal(state.inlineForeground, "rgb(228, 212, 170)");
      }
    }
    const inspected = await client.probe("inspectScreen", {
      englishScan: checks.englishScan, cleanProfile: true, excludeEnglishSelectors: config.excludeEnglishSelectors,
      allowedEnglish: [...(config.allowedEnglish || []), ...(config.cleanAllowedEnglish || [])],
    });
    const name = (dark ? "night-" : "day-") + id;
    const errors = classify(client.events, checks.localServicePorts, false).errors;
    const result = { name, ...state, unexpectedEnglish: inspected.unexpectedEnglishPhrases, errors };
    results.push(result);
    writeFileSync(join(folder, "palette.json"), JSON.stringify(results, null, 2));
    await client.probe("freezeInfiniteAnimations");
    const shot = await client.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(folder, name + ".png"), Buffer.from(shot.data, "base64"));
    assert.deepEqual(errors, [], name + " console: " + JSON.stringify(errors));
    assert.deepEqual(result.unexpectedEnglish, [], name + " English: " + JSON.stringify(result.unexpectedEnglish));
  }

  async function focus(selector) {
    await wait({ selector });
    const result = await client.send("Runtime.evaluate", {
      expression: `document.querySelector(${JSON.stringify(selector)}).focus()`,
    });
    assert.ok(!result.exceptionDetails);
  }
  async function press(key, windowsVirtualKeyCode, modifiers = 0) {
    for (const type of ["rawKeyDown", "keyUp"]) {
      await client.send("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode, modifiers });
    }
  }

  await act({ type: "navigate", to: "/settings/general" });
  await wait({ selector: "[data-oly-ps-nav-button]" });
  await verifyAnchors(ready, client, "settings");
  await focus("[data-settings-section='/settings/providers']");
  for (const selector of ["[data-oly-ik-nav] button", "[data-oly-mcp-nav] button", "[data-oly-ps-nav-button]"]) {
    await press("ArrowDown", 40);
    await wait({ selector: selector + ":focus" });
  }
  await press("ArrowUp", 38);
  await wait({ selector: "[data-oly-mcp-nav] button:focus" });

  // Select each injected panel through the native search, including consecutive results on the same route.
  const settingsSearch = "nav[data-workspace-area=settings-nav] input[role=combobox]";
  for (const [name, result, pane, navButton] of [
    ["API-ключи", "olympus-api-keys", ".oly-ik-panel", "[data-oly-ik-nav] button"],
    ["Серверы MCP", "olympus-mcp", ".oly-mcp-pane", "[data-oly-mcp-nav] button"],
    ["Шаблоны промптов", "olympus-prompts", ".oly-ps-pane", "[data-oly-ps-nav-button]"],
  ]) {
    await focus(settingsSearch);
    await client.send("Input.insertText", { text: name });
    await wait({ selector: `#settings-search-result-${result}[aria-selected=true]` });
    await press("Enter", 13);
    await wait({ allSelectors: [pane, `${navButton}[aria-current=page]`] });
  }

  await act({ type: "navigate", to: "/" });
  await focus("[data-oly-tasks]");
  await act({ type: "click", selector: "[data-oly-tasks]" });
  await wait({ allSelectors: [".oly-tk-dialog:focus-within", ".oly-tk-dialog [data-sel='all']"] });
  await press("Tab", 9, 8); // Shift+Tab from the dialog goes to its last control.
  await wait({ selector: ".oly-tk-dialog :focus" });
  await press("Tab", 9);
  await wait({ selector: ".oly-tk-dialog [data-sel='all']:focus" });
  await press("Escape", 27);
  await wait({ selector: "[data-oly-tasks]:focus" });

  for (const dark of [false, true]) {
    await act({ type: "navigate", to: "/" });
    await wait({ selector: "button[aria-label='День / ночь']" });
    await scheme(dark);
    for (const id of ["home", "settings-appearance", "usage", "tasks", "studio"]) {
      const screen = checks.screens.find((s) => s.id === id);
      client.clearEvents();
      for (const step of screen.setup || []) await act(step);
      if (screen.setupWaitFor) await wait(screen.setupWaitFor);
      await act(screen.action);
      if (screen.ensureDraft) await client.probe("ensureDraft");
      await wait(screen.waitFor);
      if (id === "usage") {
        await act({ type: "click", selector: "button", text: "Лимиты" });
        await wait({ assertions: [{ selector: "button[aria-pressed=true], button[data-pressed]", text: "Лимиты" }] });
        assert.ok(await client.probe("limitsSelected"), "limits view should be selected");
      }
      await capture(id, dark, screen);
      for (const step of screen.teardown || []) await act(step);
    }
  }
  const thread = await seedChat(opts.launch, home);
  // Pin the file manager in the disposable profile even when the runner has other editors.
  const preference = await client.send("Runtime.evaluate", {
    expression: 'localStorage.setItem("t3code:last-editor", JSON.stringify("file-manager"))',
  });
  assert.ok(!preference.exceptionDetails);
  await act({ type: "navigate", to: thread });
  await wait({ selector: "[data-message-role=assistant] .chat-markdown :not(pre) > code" });
  await wait({ assertions: [{
    selector: "button[data-toolbar-control][aria-label='Открыть в Проводнике']",
    text: "Открыть в Проводнике",
  }] });
  for (const dark of [true, false]) {
    await scheme(dark);
    await capture("chat", dark);
  }
  await verifyAnchors(ready, client, "chat");
  const card = "[data-thread-details-card]";
  const wasOpen = (await client.probe("checkReady", { selector: card })).ready;
  if (!wasOpen) await act({ type: "click", selector: "[data-thread-panel-toggle] button" });
  await verifyAnchors(ready, client, "details");
  if (!wasOpen) await act({ type: "click", selector: "[data-thread-panel-toggle] button" });

  await act({ type: "click", selector: "[data-chat-provider-model-picker]" });
  await verifyAnchors(ready, client, "picker");
  await verifyPickerContext(client);
  await press("Escape", 27);
  return results;
}
