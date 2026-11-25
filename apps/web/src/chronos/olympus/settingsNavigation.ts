import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

const apiKeys = "[data-oly-ik-nav] button";
const mcp = "[data-oly-mcp-nav] button";
const prompts = "[data-oly-ps-nav-button]";
const sections = `[data-settings-section], ${apiKeys}, ${mcp}, ${prompts}`;

function visiblePanelButton(nav: HTMLElement) {
  const layout = nav.parentElement;
  if (layout?.classList.contains("oly-mcp-settings-active")) return mcp;
  if (layout?.classList.contains("oly-prompts-active")) return prompts;
  return nav.nextElementSibling?.hasAttribute("data-oly-ik-open") ? apiKeys : null;
}

export function useOlympusSettingsNav(activePath: string) {
  const ref = useRef<HTMLElement>(null);
  const router = useRouter();

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Olympus mounts and marks its buttons outside React.
  useEffect(() => {
    const nav = ref.current;
    if (!nav) return;

    function selectSection(event: MouseEvent) {
      const button = event.target instanceof Element && event.target.closest(sections);
      if (!button) return;
      if (!button.matches(apiKeys)) globalThis.__olyIntegrations?.close();
      if (!button.matches(mcp)) globalThis.__olyMcpManager?.close();
    }

    const syncSelection = () => {
      const panel = visiblePanelButton(nav);
      for (const button of nav.querySelectorAll<HTMLElement>(sections)) {
        const active = panel
          ? button.matches(panel)
          : button.dataset.settingsSection === activePath;
        if (button.dataset.active !== String(active)) button.dataset.active = String(active);
        if (active && button.getAttribute("aria-current") !== "page") {
          button.setAttribute("aria-current", "page");
        } else if (!active && button.hasAttribute("aria-current")) {
          button.removeAttribute("aria-current");
        }
      }
    };

    // The modules clone nav buttons and can restore an old selection after their panel closes.
    const observer = new MutationObserver(syncSelection);
    observer.observe(nav, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-active", "aria-current"],
    });
    nav.addEventListener("click", selectSection, true);
    const unsubscribe = router.subscribe("onBeforeLoad", ({ fromLocation, toLocation }) => {
      if (fromLocation?.href === toLocation.href) return;
      globalThis.__olyIntegrations?.close();
      globalThis.__olyMcpManager?.close();
    });
    syncSelection();
    return () => {
      unsubscribe();
      nav.removeEventListener("click", selectSection, true);
      observer.disconnect();
    };
  }, [activePath, router]);

  return ref;
}
