import * as NodeTimersPromises from "node:timers/promises";

async function verifyChatSettings(client) {
  // Notifications depend on budget. Turn notifications off first and restore them last.
  const rows = ["88-rich-text", "40-files", "20-speed", "26-notifications", "22-budget",
    "10-plan-mode", "93-chat-panels", "15-lang-icons"].map(id => "#olympus-" + id);
  const globals = ["__olyRichText", "__olyFiles", "__olySpeed", "__olyNotifications", "__olyBudget",
    "__olyPlanUi", "__olyPanels", "__olyLangIcons"];
  async function waitFor(description, check) {
    const deadline = Date.now() + 15_000;
    while (!await check()) {
      if (Date.now() >= deadline) throw new Error("Timed out waiting for " + description);
      await NodeTimersPromises.setTimeout(150);
    }
  }
  async function openSettings(checked) {
    const action = await client.probe("performAction", { type: "navigate", to: "/settings/appearance" });
    if (!action.ok) throw new Error(action.detail);
    const advanced = "#appearance-interface [data-slot=collapsible-trigger]";
    await waitFor("advanced settings", async () => (await client.probe("checkReady", { allSelectors: [advanced] })).ready);
    if ((await client.probe("checkReady", { allSelectors: [advanced + '[aria-expanded="false"]'] })).ready) {
      const opened = await client.probe("performAction", { type: "click", selector: advanced });
      if (!opened.ok) throw new Error(opened.detail);
    }
    const allSelectors = rows.map((id) => id + ` [role=switch][aria-checked=${checked}]`);
    await waitFor("switches " + checked, async () => (await client.probe("checkReady", { allSelectors })).ready);
  }
  async function reloadWindow() {
    client.clearEvents();
    await client.send("Page.reload");
    // The old surface disappears during reload. Wait for the new main document before probing it.
    await waitFor("new document", () => client.events.some((event) => event.method === "Page.loadEventFired"));
    await waitFor("new router", async () => {
      const info = await client.probe("appInfo");
      return info.hasRouter && info.hasOlyCore && info.bodyTextLength > 0;
    });
  }
  async function clickSwitches(enabled) {
    for (const id of enabled ? rows : [...rows].reverse()) {
      const action = await client.probe("performAction", { type: "click", selector: id + " [role=switch]" });
      if (!action.ok) throw new Error(action.detail);
    }
  }
  await client.send("Page.bringToFront");
  for (const enabled of [true, false]) {
    console.log("Checking switches " + enabled + " -> " + !enabled);
    await openSettings(enabled);
    await clickSwitches(enabled);
    await openSettings(!enabled);
    const before = await client.probe("checkGlobals", { expected: globals });
    if (before.presentCount !== (enabled ? globals.length : 0)) throw new Error("Module changed before reload: " + JSON.stringify(before.missing));
    console.log("Reloading with switches " + !enabled);
    await reloadWindow();
    await openSettings(!enabled);
    const after = await client.probe("checkGlobals", { expected: [...globals, "__olyCore", "__olyReferences"] });
    if (JSON.stringify(after.missing) !== JSON.stringify(enabled ? globals : [])) {
      throw new Error("Unexpected modules after reload: " + JSON.stringify(after.missing));
    }
  }
}

export async function check({ client, opts, report }) {
  if (opts.verifyChatSettings) {
    try {
      await verifyChatSettings(client);
      report.chatSettings = { ok: true };
      console.log("[PASS] chat settings: switched off, reloaded, re-enabled and reloaded");
    } catch (error) {
      report.chatSettings = { ok: false, error: String(error) };
      report.ok = false;
      console.log("[FAIL] chat settings: " + error);
    }
  }
}
