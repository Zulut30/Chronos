import * as NodeAssert from "node:assert/strict";

// These selectors describe relationships consumed by the immutable modules, including legacy classes.
// A data-chronos attribute on a different element must not make a broken legacy selector pass.
const screens = {
  settings: [
    ["80/90/91", "[data-chronos-settings-layout] > nav[data-chronos-settings-nav][data-workspace-area=settings-nav] + [data-chronos-settings-content][data-workspace-area=settings]"],
    ["80", "nav[data-chronos-settings-nav] ul > li [data-slot=sidebar-menu-button][data-settings-section='/settings/providers']"],
    ["80", "[data-oly-ik-nav] button"],
    ["90", "[data-oly-mcp-nav] button"],
    ["91", "[data-oly-ps-nav-button]"],
  ],
  chat: [
    ["05/20/30/50/55/60/70/87", "[data-slot=composer-host] [data-chronos-editor].composer-tiptap[contenteditable=true]"],
    ["05/55/87/88", "[data-message-role=assistant] .chat-markdown[data-chronos-markdown]"],
    ["26/93", "main[data-slot=sidebar-inset] [data-thread-context-drop]"],
    ["30/88/93", "[data-thread-item] [data-sidebar-row], [data-thread-item][data-sidebar-row]"],
  ],
  details: [
    ["24/25", "[data-workspace-focus-key^='details:'] [data-thread-details-card][data-chronos-thread-details]"],
  ],
  picker: [
    ["28", "[data-chronos-model-picker][data-model-picker-content] [data-model-picker-sidebar] [data-model-picker-provider]"],
  ],
};

const owners = {
  "05": ["Core"], "10": ["PlanMode", "PlanUi", "WrapModeText"], "15": ["LangIcons"],
  "20": ["Speed"], "22": ["Budget", "BudgetEvents"], "24": ["ThreadDetails"], "25": ["BgTasks"],
  "26": ["Notifications"], "28": ["ModelAccount"], "30": ["Tasks"], "40": ["Files"],
  "50/55": ["Machines", "Mentions", "References"], "60": ["Studio"], "70": ["OpenRouter"],
  "80": ["Integrations"], "87": ["RuFixes"], "88": ["RichText"], "90": ["McpManager"],
  "91": ["PromptsSettings"], "92": ["StudioShell"], "93/PanelHost": ["PanelHost", "Panels"], "extras": ["Smooth"],
};
export const globals = Object.fromEntries(Object.entries(owners).flatMap(([owner, names]) =>
  names.map(name => ["__oly" + name, owner])));
globals.__TSR_ROUTER__ = "22/26/93";
globals.desktopBridge = "50/60";

export async function verifyAnchors(ready, client, screen) {
  for (const [owner, selector] of screens[screen]) {
    const result = await ready(client, { assertions: [{ selector, visible: false }] });
    NodeAssert.ok(result.ready, "Olympus " + owner + " / " + screen + " / " + selector + ": " + result.detail);
  }
}

// Module 28 ascends at most 60 React owners from its own content element.
export async function verifyPickerContext(client) {
  const reply = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const root = document.querySelector("[data-model-picker-content]");
      const key = root && Object.keys(root).find(key => key.startsWith("__reactFiber$"));
      let fiber = key && root[key];
      for (let i = 0; fiber && i < 60; i++, fiber = fiber.return) {
        const p = fiber.memoizedProps;
        if (typeof p?.environmentId === "string" && Array.isArray(p.instanceEntries)) return true;
      }
      return false;
    })()`,
    returnByValue: true,
  });
  NodeAssert.ok(reply.result?.value, "Olympus 28 / [data-model-picker-content] / Fiber environmentId and instanceEntries");
}
