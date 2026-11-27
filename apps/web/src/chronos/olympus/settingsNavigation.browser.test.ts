import { expect, it } from "vite-plus/test";

import { openSettingsHost } from "./settingsHost";

it.each([true, false])("keeps an active search when MCP finishes loading (editing=%s)", async (editing) => {
  const layout = document.createElement("div");
  layout.innerHTML = '<nav data-chronos-settings-nav data-workspace-area="settings-nav"><input role="combobox"><button>Open MCP</button></nav><section class="oly-mcp-pane"></section>';
  document.body.append(layout);
  let stop: (() => void) | undefined;
  try {
    const input = layout.querySelector("input")!;
    (editing ? input : layout.querySelector("button")!).focus();
    let frame!: HTMLIFrameElement;
    await new Promise<void>((resolve) => {
      stop = openSettingsHost(layout, (scope) => {
        frame = scope.document.createElement("iframe") as HTMLIFrameElement;
        frame.srcdoc = "<p>MCP</p>";
        frame.onload = () => { frame.focus(); resolve(); };
        layout.querySelector("section")!.append(frame);
      });
    });
    expect(document.activeElement).toBe(editing ? input : frame);
  } finally {
    stop?.();
    layout.remove();
  }
});
