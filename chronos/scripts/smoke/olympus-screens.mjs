import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function resourcesDir(exe) {
  return process.platform === "darwin"
    ? join(dirname(exe), "..", "Resources")
    : join(dirname(exe), "resources");
}

function seedChat(exe, home) {
  const dir = mkdtempSync(join(process.env.RUNNER_TEMP, "theme-demo-"));
  const resDir = resourcesDir(exe);
  const entry = process.platform === "win32"
    ? join(resDir, "server.asar/apps/server/dist/bin.mjs")
    : join(resDir, "app.asar/apps/server/dist/bin.mjs");
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
  const home = process.env.CHRONOS_HOME;
  assert.equal(resolve(home), resolve(process.env.RUNNER_TEMP, "chronos-home"));
  const source = join(resourcesDir(opts.launch), "chronos-themes/olympus.json");
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
  await act({ type: "navigate", to: thread });
  await wait({ selector: "[data-message-role=assistant] .chat-markdown :not(pre) > code" });
  for (const dark of [true, false]) {
    await scheme(dark);
    await capture("chat", dark);
  }
  return results;
}
