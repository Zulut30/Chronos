import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withSmokeFrame } from "./artifact-gallery.mjs";

export function createMcpFixture(temp) {
  const home = mkdtempSync(join(temp, "mcp-test-"));
  const project = join(home, "Demo");
  mkdirSync(project);
  mkdirSync(join(home, ".ssh"));
  writeFileSync(join(home, ".ssh/config"), "Host demo-device\n  HostName 127.0.0.1\n  Port 1\n");
  writeFileSync(join(home, ".claude.json"), JSON.stringify({
    mcpServers: {
      calendar: { type: "http", url: "https://calendar.example.invalid/mcp" },
      documents: { command: "node", args: ["--version"] },
      notes: { type: "http", url: "https://notes.example.invalid/mcp" },
    },
    projects: { [project]: {} },
  }));
  return home;
}

const frameUrl = "http://127.0.0.1:4523/";
const nav = "[data-oly-mcp-nav]";
const providers = "[data-settings-section='/settings/providers']";
const header = "[data-chronos-settings-content] > header";

export async function verifyMcpSettings({ client, opts, viewport, locale, evaluate, until, route, click, key }) {
  const english = locale === "en";
  const mcpLabel = english ? "MCP servers" : "Серверы MCP";
  const toggleTheme = english ? "Day / night" : "День / ночь";
  const folder = join(opts.outDir, "mcp-t3-style");
  mkdirSync(folder, { recursive: true });
  const initial = await client.probe("getThemeState");
  const snapshot = async (name) => {
    await client.pumpFrames(2, 120);
    const shot = await client.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(folder, name + ".png"), Buffer.from(shot.data, "base64"));
  };
  async function scheme(dark) {
    await route("/");
    if ((await client.probe("getThemeState")).dark !== dark) {
      await click(`button[aria-label="${toggleTheme}"]`);
    }
    await until("Olympus theme applied", async () => {
      const state = await client.probe("getThemeState");
      return state.themeId === "olympus" && state.dark === dark;
    });
  }
  try {
    for (const width of [900, 1280]) {
      await client.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
      for (const dark of [false, true]) {
        await scheme(dark);
        await route("/settings/providers");
        await until("Providers loaded", () => evaluate(`!!document.querySelector("${providers}[aria-current=page]") && !!document.querySelector('[data-settings-page-scroll] [role=switch]')`));
        const name = [locale, dark ? "night" : "day", width].join("-");
        const headerHeight = await evaluate(`document.querySelector('${header}').offsetHeight`);
        await snapshot(name + "-providers");
        if (width === 1280 && !dark) {
          await click("[data-chronos-settings-nav] input[role=combobox]");
          await client.send("Input.insertText", { text: "MCP" });
          await click("#settings-search-result-olympus-mcp");
        } else {
          // A click whose target is the li itself used to do nothing.
          await evaluate(`document.querySelector('${nav}').click()`);
        }
        await until("localized active MCP crumb and frame", () => evaluate(
          `document.querySelector('.oly-mcp-crumb')?.textContent === ${JSON.stringify(mcpLabel)} &&
           !!document.querySelector('${nav} button[aria-current=page]') && !!document.querySelector('.oly-mcp-pane iframe')`));
        assert.equal(await evaluate(`document.querySelector('${header}').offsetHeight`), headerHeight);
        await withSmokeFrame(client, frameUrl, async read => {
          const selected = "document.querySelector('[data-agent=claude]')";
          await until("initial server list", () => read("!!document.querySelector('#path:not([hidden]) code')"));
          await read(selected + ".click()");
          await until("fixture servers and localized device", () => read(`document.documentElement.lang === '${locale}' &&
            document.querySelector('#machine')?.selectedOptions[0]?.textContent === '${english ? "This computer" : "Этот компьютер"}' &&
            document.querySelectorAll('#list .row[data-name]').length === 3 && document.querySelector('.row[data-name=calendar]') !== null`));
          assert.equal(await read("getComputedStyle(document.querySelector('#location')).appearance"), "base-select");
          assert.equal(await read("document.documentElement.scrollWidth <= innerWidth"), true);
          await read("document.fonts.ready.then(() => true)");
          const switchSelector = '.row[data-name=notes] [role=switch]';
          if (await read(`document.querySelector('${switchSelector}').getAttribute('aria-checked') === 'true'`)) {
            await read(`document.querySelector('${switchSelector}').click()`);
            await until("disabled fixture persisted", () => read(`document.querySelector('${switchSelector}')?.getAttribute('aria-checked') === 'false' && !document.querySelector('#notice').hidden`));
            await read("document.querySelector('#notice-close').click()");
          }
          await snapshot(name + "-mcp");
          if (dark || width !== 900) return;
          await read("document.querySelector('#location').focus()");
          await key("Enter", 13);
          await until("settings location menu opens", () => read("document.querySelector('#location').matches(':open')"));
          await snapshot(name + "-location-open");
          await key("Escape", 27);
          await until("Escape leaves focus on location", () => read("document.activeElement.id === 'location' && !document.querySelector('select:open')"));
          await read("document.querySelector('#search').focus()");
          await client.send("Input.insertText", { text: "calendar" });
          assert.deepEqual(await read("[...document.querySelectorAll('#list [data-name]')].map(row=>row.dataset.name)"), ["calendar"]);
          await key("Escape", 27);
          assert.equal(await read("document.querySelectorAll('#list [data-name]').length"), 3);
          await read("document.querySelector('[data-filter=all]').focus()");
          await key("End", 35);
          assert.equal(await read("document.activeElement.dataset.filter"), "off");
          assert.deepEqual(await read("[...document.querySelectorAll('#list [data-name]')].map(row=>row.dataset.name)"), ["notes"]);
          await key("Home", 36);
          await read("document.querySelector('#add').click()");
          assert.equal(await read("document.querySelector('#editor').open"), true);
          await key("Escape", 27);
          await until("return focus to Add", () => read("document.activeElement.id === 'add'"));
        });
        const close = header + " button[aria-label='" + (english ? "Close" : "Закрыть") + "']";
        await click(close);
        await until("native close dismisses settings", () => evaluate("!document.querySelector('[data-chronos-settings-layout]')"));
      }
    }
  } finally {
    await client.send("Emulation.setDeviceMetricsOverride", { ...viewport, mobile: false });
    await scheme(initial.dark);
  }
}
