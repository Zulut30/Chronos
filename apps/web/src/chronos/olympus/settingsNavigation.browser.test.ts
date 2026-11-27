import { expect, it } from "vite-plus/test";

import { preserveSettingsSearchFocus } from "./settingsNavigation";

it.each([true, false])("keeps an active search when MCP finishes loading (editing=%s)", async (editing) => {
  const layout = document.createElement("div");
  layout.innerHTML = '<nav data-chronos-settings-nav><input role="combobox"><button>Open MCP</button></nav><section class="oly-mcp-pane"></section>';
  document.body.append(layout);
  try {
    const input = layout.querySelector("input")!;
    const frame = document.createElement("iframe");
    frame.srcdoc = "<p>MCP</p>";
    layout.addEventListener("load", preserveSettingsSearchFocus, true);
    const loaded = new Promise<void>(resolve => {
      frame.onload = () => { frame.focus(); resolve(); };
    });
    (editing ? input : layout.querySelector("button")!).focus();
    layout.querySelector("section")!.append(frame);
    await loaded;
    await new Promise(requestAnimationFrame);
    expect(document.activeElement).toBe(editing ? input : frame);
  } finally {
    layout.remove();
  }
});
