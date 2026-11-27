import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { settingsDriver } from "./ui-language.mjs";

export async function checkPromptMode(client, opts) {
  assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
  assert.equal(resolve(process.env.CHRONOS_HOME), resolve(process.env.RUNNER_TEMP, "prompt-mode-profile"));
  const { route, click, key, language, until, evaluate } = settingsDriver(client);
  const writing = opts.promptMode === "write";
  const locale = writing ? "ru" : "en";
  const labels = writing
    ? ["Не менять", "Выполнение", "Планирование", "Мозговой штурм", "Охотник за багами", "Планирование дизайна"]
    : ["Keep current mode", "Execution", "Planning", "Brainstorming", "Bug hunter", "Design planning"];
  const title = writing ? "Режим ответа" : "Response mode";
  const command = "chronos-smoke-mode";
  const row = '[data-oly-ps-name="' + command + '"]';
  const trigger = "chronos-prompt-mode [role=combobox]";
  const option = "[data-chronos-settings-options] [role=option]";
  const fieldValue = "document.querySelector('form.oly-ps-form').elements.namedItem('mode').value";

  async function openEditor(create) {
    await route("/settings/general");
    await click("[data-oly-ps-nav-button]");
    if (create) {
      await until("template list", () => evaluate("!!document.querySelector('.oly-ps-pane [data-slot=settings-group]')"));
      const action = await client.probe("performAction", { type: "click", selector: ".oly-ps-pane button", text: "Новый шаблон" });
      assert.ok(action.ok, action.detail);
    } else {
      await click(row);
    }
    await until("mode trigger", () => evaluate(`!!document.querySelector('${trigger}')`));
    const tree = await client.send("Accessibility.getFullAXTree");
    assert.ok(tree.nodes.some(node => node.role?.value === "combobox" && node.name?.value === title),
      "Missing accessible combobox " + title);
  }
  async function expectValue(id, text) {
    await until("mode " + text, () => evaluate(`${fieldValue} === ${JSON.stringify(id)}
      && document.querySelector('${trigger} [data-slot=select-value]')?.textContent === ${JSON.stringify(text)}`));
  }
  async function expectMenu() {
    await until("six mode options", () => evaluate(`document.querySelectorAll('${option}').length === 6`));
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('${option}'), el => el.textContent)`), labels);
  }
  async function save() {
    await click(".oly-ps-form button[type=submit]");
    await until("saved template", () => evaluate(`!!document.querySelector('${row}') && !document.querySelector('.oly-ps-form')`));
  }

  try {
    await route("/");
    await until("workspace after onboarding", async () => {
      await client.probe("dismissOnboarding", { readyProvider: true });
      return evaluate(`!!document.querySelector("button:is([aria-label='День / ночь'],[aria-label='Day / night'])")`);
    });
    if (await evaluate("document.documentElement.lang") !== locale) await language(locale);
    if (writing) {
      await openEditor(true);
      await expectValue("", labels[0]);
      for (const [selector, text] of [["#oly-ps-name", command], ["#oly-ps-title", "Проверка режима"], ["#oly-ps-body", "Текст шаблона"]]) {
        await click(selector);
        await client.send("Input.insertText", { text });
      }
      await click(trigger);
      await expectMenu();
      await click(option + ":nth-child(3)");
      await expectValue("plan", labels[2]);
      await until("focus after pointer selection", () => evaluate(`document.activeElement.matches('${trigger}')`));
      await key("ArrowDown", 40);
      await expectMenu();
      await key("End", 35);
      await key("Enter", 13);
      await expectValue("design-plan", labels[5]);
      await save();
    }
    for (const width of [900, 1280]) {
      await client.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
      for (const dark of [false, true]) {
        await route("/");
        if ((await client.probe("getThemeState")).dark !== dark) {
          await click(writing ? "button[aria-label='День / ночь']" : "button[aria-label='Day / night']");
          await until("theme change", async () => (await client.probe("getThemeState")).dark === dark);
        }
        await openEditor(false);
        await expectValue("design-plan", labels[5]);
        await click("#oly-ps-description");
        await key("Tab", 9);
        assert.ok(await evaluate(`document.activeElement.matches('${trigger}:focus-visible')`));
        await key("ArrowDown", 40);
        await expectMenu();
        await client.pumpFrames(2, 90);
        const fits = await evaluate(`[...document.querySelectorAll('${option}')].every(el => {
          const rect = el.getBoundingClientRect(), text = document.createRange();
          text.selectNodeContents(el.querySelector('[data-slot=select-item-text]'));
          const label = text.getBoundingClientRect();
          return rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1
            && label.left >= rect.left - 1 && label.right <= rect.right + 1;
        })`);
        assert.ok(fits, "Clipped mode menu at " + width);
        const shot = await client.send("Page.captureScreenshot", { format: "png" });
        writeFileSync(join(opts.outDir, [locale, dark ? "night" : "day", width].join("-") + ".png"), Buffer.from(shot.data, "base64"));
        await key("Escape", 27);
        await until("Escape restores trigger focus", () => evaluate(`document.activeElement.matches('${trigger}[aria-expanded=false]')`));
        await expectValue("design-plan", labels[5]);
      }
    }
    if (!writing) {
      await key("ArrowDown", 40);
      await expectMenu();
      await key("Home", 36);
      await key("Enter", 13);
      await expectValue("", labels[0]);
      await save();
      await click(row);
      await expectValue("", labels[0]);
    }
    console.log("PASS template mode", opts.promptMode, locale);
  } finally {
    if (!writing) {
      await route("/");
      await language("ru");
    }
  }
}
