import { createRoot, type Root } from "react-dom/client";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "~/components/ui/select";
import "../settingsSelect.css";

// Olympus owns the form and its named field. The React root lives exactly as long as its editor.
export function registerPromptModeSelect() {
  if (customElements.get("chronos-prompt-mode")) return;
  customElements.define("chronos-prompt-mode", class extends HTMLElement {
    private root: Root | undefined;

    connectedCallback() {
      if (this.root) return;
      const field = this.querySelector("select")!;
      const items = Array.from(field.options, ({ value, label }) => ({
        value,
        label: window.__chronosEnglishText?.(label) ?? label,
      }));
      const slot = document.createElement("div");
      this.append(slot);
      this.root = createRoot(slot);
      this.root.render(
        <Select items={items} defaultValue={field.value} onValueChange={(value, event) => {
          if (field.matches(":disabled")) return event.cancel();
          if (value !== null) field.value = value;
        }}>
          <SelectTrigger id={field.id + "-trigger"} size="sm" aria-describedby={field.getAttribute("aria-describedby") ?? undefined}>
            <SelectValue />
          </SelectTrigger>
          <SelectPopup data-chronos-settings-options="" portalContainer={this.closest<HTMLElement>(".oly-ps-pane")} align="end" alignItemWithTrigger={false}>
            {items.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectPopup>
        </Select>,
      );
    }

    disconnectedCallback() {
      // The settings dialog can be removed during the parent React root's commit.
      queueMicrotask(() => {
        if (this.isConnected) return;
        this.root?.unmount();
        this.root = undefined;
        this.querySelector("div")?.remove();
      });
    }
  });
}
