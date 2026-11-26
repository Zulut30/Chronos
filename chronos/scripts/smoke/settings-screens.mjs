import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { withSmokeFrame } from "./artifacts.mjs";

export async function captureSettings(client, out, ready) {
  const act = async (step) => assert.ok((await client.probe("performAction", step)).ok);
  const wait = async (selector) => assert.ok((await ready(client, { selector })).ready, selector);
  const evaluate = async (expression) => {
    const reply = await client.send("Runtime.evaluate", { expression, returnByValue: true });
    if (reply.exceptionDetails) throw Error(reply.exceptionDetails.text);
    return reply.result.value;
  };
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
    for (const el of root.querySelectorAll("h2,h3,p,label,button,input,textarea,select,summary,[role=switch],[data-slot=input-control],[data-slot=textarea-control],[data-slot=number-field-group],[data-slot=input-group],.oly-ps-note,.oly-ps-error")) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight) continue;
      const s = getComputedStyle(el);
      const label = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("placeholder") || el.tagName).trim().slice(0,75);
      visible[[el.tagName, el.dataset.slot || "", label].join("/")] = {
        label, slot: el.dataset.slot || "", role: el.getAttribute("role"), tag: el.tagName,
        x:r.x,y:r.y,w:r.width,h:r.height,fg:rgb(s.color),border:rgb(s.borderTopColor),bg:rgb(s.backgroundColor),
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
        measurements.push({name, visible});
        writeFileSync(join(out, "measurements.json"), JSON.stringify(measurements, null, 2));
        const shot = await client.send("Page.captureScreenshot", { format: "png" });
        writeFileSync(join(out, name + ".png"), Buffer.from(shot.data, "base64"));
      };
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
      for (const [id, button, panel, loaded] of [
        ["api-keys", "[data-oly-ik-nav] button", ".oly-ik-panel", "[data-oly-ik-input]"],
        ["mcp", "[data-oly-mcp-nav] button", ".oly-mcp-pane", ".oly-mcp-pane iframe"],
        ["prompts", "[data-oly-ps-nav-button]", ".oly-ps-pane", ".oly-ps-pane [data-slot=settings-group]"],
      ]) {
        await act({ type: "click", selector: button });
        await wait(loaded);
        const guest = id === "mcp" ? {selector: loaded, prefix: "http://127.0.0.1:4523/", ready: "#search"} : null;
        await capture(id, panel, null, guest);
        if (id === "prompts") {
          await act({ type: "click", text: "Новый шаблон", selector: ".oly-ps-pane button" });
          await capture("prompt-editor", panel);
        }
      }
      await act({type:"navigate",to:"/"});
      await wait("button[aria-label='Артефакты']");
      await act({type:"click",selector:"button[aria-label='Артефакты']"});
      const gallery = "iframe[src*='artifacts.html'],webview[src*='artifacts.html']";
      await capture("artifacts", gallery, null, {selector:gallery, prefix:"http://127.0.0.1:4520/artifacts.html", ready:"#search"});
      await act({type:"closeOlympus",global:"__olyStudioShell"});
    }
  }
  // Let the normal smoke suite start with a fresh settings dialog, its default scroll, and no active guest.
  await act({type:"navigate",to:"/"});
  await wait("button[aria-label='Артефакты']");
}
