import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { seedQuotaNotices } from "./settings-quota.mjs";
import { withSmokeFrame } from "./artifact-gallery.mjs";

async function seedGallery(executable) {
  if (!executable || process.env.RUNNER_ENVIRONMENT !== "github-hosted" || process.platform !== "win32") return null;
  const home = process.env.CHRONOS_HOME;
  if (!home || resolve(home) !== resolve(process.env.RUNNER_TEMP, "settings-profile")) return null;
  const entry = join(dirname(executable), "resources/chronos-services/artifacts/store.mjs");
  const {openArtifacts} = await import(pathToFileURL(entry).href);
  const store = openArtifacts(home);
  try {
    const input = {
      source:join(home, "example.html"), title:"Пример документа", description:"Два файла и две версии для проверки выбора.",
      label:"Первая версия", icon:"📄", capabilities:[],
      files:{"index.html":"<!doctype html><html lang=ru><title>Пример</title><p>Пример документа</p></html>", "notes.txt":"Заметки"}
    };
    const {id} = store.publish(input);
    store.publish({...input, expectedVersion:1, label:"Вторая версия"});
    return id;
  } finally { store.close(); }
}

async function captureSettings(client, out, ready, {executable, updatesOnly = false} = {}) {
  const sample = updatesOnly ? null : await seedGallery(executable);
  const act = async (step) => {
    const result = await client.probe("performAction", step);
    assert.ok(result.ok, result.detail);
  };
  const wait = async (selector) => assert.ok((await ready(client, { selector })).ready, selector);
  const evaluate = async (expression) => {
    const reply = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (reply.exceptionDetails) throw Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text);
    return reply.result.value;
  };
  // The initial route can redirect to onboarding after the renderer has hydrated.
  const deadline = Date.now() + 45000;
  while (!await evaluate(`!!document.querySelector("button[aria-label='День / ночь']")`)) {
    if (Date.now() > deadline) throw Error("Onboarding did not reach the workspace: " + (await client.probe("appInfo")).pathname);
    await client.probe("dismissOnboarding", { readyProvider: true });
    await client.pumpFrames(1, 200);
  }
  if (sample) {
    const deadline = Date.now() + 15000;
    while (!await evaluate("window.__olyStudio?.ws?.readyState === WebSocket.OPEN")) {
      if (Date.now() > deadline) throw Error("Settings fixture has no open local connection");
      await client.pumpFrames(1, 100);
    }
  }
  const quotaCases = sample ? await seedQuotaNotices(evaluate) : [];
  // Resolve CSS colors in Chromium, including oklch and alpha. Store no input values.
  function inspect(root) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    function rgb(value) {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    }
    const visible = {};
    for (const el of root.querySelectorAll("h2,h3,p,label,button,input,textarea,select,summary,[role=switch],[role=option],[data-slot=input-control],[data-slot=textarea-control],[data-slot=number-field-group],[data-slot=input-group],.oly-ps-note,.oly-ps-error")) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight) continue;
      const s = getComputedStyle(el);
      const label = (el.getAttribute("aria-label") || el.labels?.[0]?.innerText || el.innerText || el.getAttribute("placeholder") || el.tagName).trim().slice(0,75);
      const field = el.matches("input,select,textarea") ? el : el.querySelector("input,select,textarea");
      visible[[el.tagName, el.dataset.slot || "", field?.name || label].join("/")] = {
        label, slot: el.dataset.slot || "", role: el.getAttribute("role"), tag: el.tagName,
        x:r.x,y:r.y,w:r.width,h:r.height,fg:rgb(s.color),border:rgb(s.borderTopColor),borderWidth:parseFloat(s.borderTopWidth),bg:rgb(s.backgroundColor),
        selected:el.hasAttribute("data-selected"), highlighted:el.hasAttribute("data-highlighted"),
        focus:el.matches(":focus-visible"), disabled:el.matches(":disabled,[aria-disabled=true]")
      };
    }
    return visible;
  }
  const measurements = [];
  for (const width of [1280, 900]) {
    await client.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
    for (const dark of [false, true]) {
      await act({ type: "navigate", to: "/" });
      await wait("button[aria-label='День / ночь']");
      if ((await client.probe("getThemeState")).dark !== dark) {
        await act({ type: "click", selector: "button[aria-label='День / ночь']" });
        await client.pumpFrames(2, 150);
      }
      assert.equal((await client.probe("getThemeState")).dark, dark);
      const capture = async (id, selector, focus = null, guest = null) => {
        await wait(selector);
        if (focus) {
          await client.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
          await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
          await evaluate(`document.querySelector(${JSON.stringify(focus)}).focus()`);
        }
        await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:"start",behavior:"instant"})`);
        await client.pumpFrames(3, 160);
        const name = (dark ? "night" : "day") + "-" + width + "-" + id;
        const visible = await evaluate(`(${inspect})(document.querySelector(${JSON.stringify(selector)}))`);
        if (guest) {
          const offset = await evaluate(`document.querySelector(${JSON.stringify(guest.selector)}).getBoundingClientRect().toJSON()`);
          const inside = await withSmokeFrame(client, guest.prefix, async read => {
            for (let i = 0; i < 40; i++) {
              if (await read(`!!document.querySelector(${JSON.stringify(guest.ready)})`)) return read(`(${inspect})(document.body)`);
              await client.pumpFrames(1, 100);
            }
            throw Error("Missing frame control " + guest.ready);
          });
          for (const [key, node] of Object.entries(inside)) {
            visible["frame/" + key] = { ...node, x: node.x + offset.x, y: node.y + offset.y };
          }
        }
        if (id === "prompt-editor" && process.env.CHRONOS_SETTINGS_STAGE === "after") {
          const fields = Object.values(visible).filter(node => node.slot === "input-group");
          assert.ok(fields.length && fields.every(node => node.borderWidth >= 1.5),
            "Prompt field boundaries must remain visible at fractional display scaling");
        }
        measurements.push({name, visible});
        writeFileSync(join(out, "measurements.json"), JSON.stringify(measurements, null, 2));
        const shot = await client.send("Page.captureScreenshot", { format: "png" });
        writeFileSync(join(out, name + ".png"), Buffer.from(shot.data, "base64"));
      };
      if (updatesOnly) {
        await act({type:"navigate",to:"/settings/about"});
        await capture("macos-updates", "#app-version");
        continue;
      }
      await act({ type: "navigate", to: "/settings/general" });
      await wait("#pc-control form");
      await capture("pc-control", "#pc-control");
      await capture("pc-focus", "#pc-control", "#pc-control :is([role=switch],input[type=checkbox])");
      const enabled = "#pc-control :is([role=switch],input[type=checkbox])";
      await act({type:"click", selector:enabled});
      await capture("pc-draft-enabled", "#pc-control");
      await act({type:"click", selector:enabled});
      const log = "#pc-control-history button, #pc-control summary";
      await act({ type: "click", selector: log });
      await capture("pc-log", "#pc-control-history, #pc-control details");
      await capture("native-notifications", "#notifications");
      await act({type:"navigate",to:"/settings/scheduled-tasks"});
      await wait("#scheduled-tasks button");
      await act({type:"click",selector:"#scheduled-tasks button",text:"Новая задача"});
      await wait("#scheduled-task-title");
      if (!(await evaluate('!!document.querySelector("#scheduled-task-catch-up")'))) {
        await act({type:"click",selector:"[role=dialog] button",text:"В заданное время"});
      }
      await capture("scheduled-catch-up", "div:has(> #scheduled-task-catch-up)");
      await capture("scheduled-catch-up-focus", "div:has(> #scheduled-task-catch-up)", "#scheduled-task-catch-up");
      for (const type of ["rawKeyDown","keyUp"]) await client.send("Input.dispatchKeyEvent",{type,key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
      await evaluate('window.__TSR_ROUTER__.navigate({to:"/settings/providers",search:{instanceId:"antigravity"}})');
      await wait('section[aria-label="Настройка Antigravity"]');
      if (await evaluate('!!document.querySelector("#claude-low-memory-unload")')) {
        await capture("claude-low-memory", "#claude-low-memory-unload");
        await capture("claude-low-memory-focus", "#claude-low-memory-unload", "#claude-low-memory-unload [role=switch]");
      }
      await capture("antigravity-sandbox", 'section[aria-label="Настройка Antigravity"]');
      await act({type:"navigate",to:"/settings/threads"});
      await capture("quota-settings", "#usage-limits");
      for (const {route, knownReset} of quotaCases) {
        await act({type:"navigate",to:route});
        const notice = '[role=alert][data-chat-composer-collapsed-controls]';
        await wait(notice);
        assert.match(await evaluate(`document.querySelector(${JSON.stringify(notice)}).textContent`), /Antigravity/);
        await capture(knownReset ? "quota-reset" : "quota-unknown-reset", notice);
        if (!knownReset && process.env.CHRONOS_SETTINGS_STAGE === "after") {
          const readable = await evaluate(`(() => {
            const message = document.querySelector("[data-chronos-quota-description]");
            if (!message || !message.textContent.includes("Повторите попытку")) return false;
            const rect = message.getBoundingClientRect();
            return rect.top >= 0 && rect.bottom <= innerHeight && message.scrollWidth <= message.clientWidth;
          })()`);
          assert.ok(readable, "The complete quota instruction must fit in the visible composer");
        }
      }
      await act({type:"navigate",to:"/settings/general"});
      await wait("[data-oly-ik-nav] button");
      for (const [id, button, panel, loaded] of [
        ["api-keys", "[data-oly-ik-nav] button", ".oly-ik-panel", "[data-oly-ik-input]"],
        ["mcp", "[data-oly-mcp-nav] button", ".oly-mcp-pane", ".oly-mcp-pane iframe"],
        ["prompts", "[data-oly-ps-nav-button]", ".oly-ps-pane", ".oly-ps-pane [data-slot=settings-group]"],
      ]) {
        await act({ type: "click", selector: button });
        await wait(loaded);
        const guest = id === "mcp" ? {selector: loaded, prefix: "http://127.0.0.1:4523/", ready: "#search"} : null;
        await capture(id, panel, null, guest);
        if (id === "api-keys") await capture("api-focus", panel, "[data-oly-ik-input]");
        if (id === "prompts") {
          await act({ type: "click", text: "Новый шаблон", selector: ".oly-ps-pane button" });
          await capture("prompt-editor", panel);
        }
      }
      await act({type:"navigate",to:"/"});
      await wait("button[aria-label='Артефакты']");
      await act({type:"click",selector:"button[aria-label='Артефакты']"});
      const native = "[data-artifact-gallery]";
      const guest = "iframe[src*='artifacts.html'],webview[src*='artifacts.html']";
      await wait(native + "," + guest);
      if (await evaluate(`!!document.querySelector("${native}")`)) {
        if (sample) await wait(`article[data-id="${sample}"] .art-cover`);
        await capture("artifacts", native);
        const sort = native + " [data-slot=select-trigger]";
        if (await evaluate(`!!document.querySelector(${JSON.stringify(sort)})`)) {
          await act({type:"click",selector:sort});
          await wait("[role=option]");
          await capture("artifacts-sort", "[data-slot=select-popup]");
          const options = await evaluate(`[...document.querySelectorAll('[data-chronos-settings-options] [role=option]')].map(el => ({name:el.textContent.trim(), selected:el.getAttribute('aria-selected')}))`);
          assert.equal(options.length, 2);
          assert.ok(options.every(option => option.name));
          assert.equal(options.filter(option => option.selected === "true").length, 1);
          for (const type of ["rawKeyDown","keyUp"]) await client.send("Input.dispatchKeyEvent",{type,key:"ArrowDown",code:"ArrowDown",windowsVirtualKeyCode:40});
          await capture("artifacts-sort-keyboard", "[data-slot=select-popup]");
          for (const type of ["rawKeyDown","keyUp"]) await client.send("Input.dispatchKeyEvent",{type,key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
        }
        if (sample) {
          await act({type:"click",selector:`article[data-id="${sample}"] .art-cover`});
          await wait("[data-artifact-view] .art-controls");
          await capture("artifact-version", "[data-artifact-view]");
          await act({type:"click",selector:".art-segment button",text:"Код"});
          await wait(".art-code pre");
          await capture("artifact-source", "[data-artifact-view]");
        }
        await act({type:"click",selector:'.art-head button[aria-label="Закрыть"]'});
      } else {
        await capture("artifacts", guest, null, {selector:guest, prefix:"http://127.0.0.1:4520/artifacts.html", ready:"#search"});
        await act({type:"closeOlympus",global:"__olyStudioShell"});
      }
    }
  }
  // Let the normal smoke suite start with a fresh settings dialog, its default scroll, and no active guest.
  await act({type:"navigate",to:"/"});
  await wait("button[aria-label='Артефакты']");
}

export async function prepare({ client, opts, viewport, ready }) {
  if (opts.settingsScreens || opts.macSettingsScreens) {
    await captureSettings(client, opts.outDir, ready, {
      executable: opts.launch, updatesOnly: opts.macSettingsScreens,
    });
    await client.send("Emulation.setDeviceMetricsOverride", { ...viewport, mobile: false });
  }
  // Settings-only globals exist while their real panel host is mounted.
  const action = await client.probe("performAction", { type: "navigate", to: "/settings/general" });
  assert.ok(action.ok, action.detail);
  const mounted = await ready(client, { selector: "[data-oly-ps-nav-button]" });
  assert.ok(mounted.ready, "Olympus settings did not mount");
}
