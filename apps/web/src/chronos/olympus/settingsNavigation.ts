import { useRouter } from "@tanstack/react-router";
import { type RefObject, useEffect, useRef, useState } from "react";
import { settingsPanels } from "./settingsPanels";

const [{ selector: apiKeys }, { selector: mcp }, { selector: prompts }] = settingsPanels;
export const settingsSectionButtons = `[data-settings-section], ${apiKeys}, ${mcp}, ${prompts}`;

function visiblePanelButton(nav: HTMLElement) {
  const layout = nav.parentElement;
  if (layout?.classList.contains("oly-mcp-settings-active")) return mcp;
  if (layout?.classList.contains("oly-prompts-active")) return prompts;
  return nav.nextElementSibling?.hasAttribute("data-oly-ik-open") ? apiKeys : null;
}

function loadPanelModules() {
  return Promise.all([import("./settingsHost"), import("chronos-olympus:settings")]);
}

export function useOlympusSettingsNav(ref: RefObject<HTMLElement | null>, activePath: string, hash: string) {
  const router = useRouter();
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- immutable Olympus modules attach to the mounted settings layout.
  useEffect(() => {
    const layout = ref.current?.parentElement;
    if (!layout) return;
    let active = true;
    let stop: (() => void) | undefined;
    void loadPanelModules()
      .then(([host, panels]) => {
        if (active) stop = host.openSettingsHost(layout, panels.mount);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
      stop?.();
    };
  }, [attempt, ref]);
  const pendingPanel = useRef<string | null>(null);

  // The modules close on URL changes. Consume the search anchor before opening its panel.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- activate the module's DOM button after the router settles.
  useEffect(() => {
    const nav = ref.current;
    if (!nav) return;
    const panel =
      activePath === "/settings/providers" &&
      settingsPanels.find((p) => p.id === hash.replace(/^#/, ""));
    if (panel) {
      pendingPanel.current = panel.selector;
      void router.navigate({
        hash: "",
        replace: true,
        resetScroll: false,
        hashScrollIntoView: false,
      });
      return;
    }
    const selector = pendingPanel.current;
    pendingPanel.current = null;
    if (!selector || hash || activePath !== "/settings/providers") return;
    // Clearing the query remounts the native nav first, then Olympus injects its buttons.
    const openPanel = () => {
      const button = nav.querySelector<HTMLButtonElement>(selector);
      if (!button) return;
      observer.disconnect();
      button.focus({ preventScroll: true });
      button.click();
    };
    const observer = new MutationObserver(openPanel);
    observer.observe(nav, { subtree: true, childList: true });
    openPanel();
    return () => observer.disconnect();
  }, [activePath, hash, router, ref]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Olympus mounts and marks its buttons outside React.
  useEffect(() => {
    const nav = ref.current;
    if (!nav) return;

    function selectSection(event: MouseEvent) {
      const button =
        event.target instanceof Element && event.target.closest(settingsSectionButtons);
      if (!button) return;
      if (!button.matches(apiKeys)) globalThis.__olyIntegrations?.close();
      if (!button.matches(mcp)) globalThis.__olyMcpManager?.close();
    }

    const syncSelection = () => {
      const panel = visiblePanelButton(nav);
      for (const button of nav.querySelectorAll<HTMLElement>(settingsSectionButtons)) {
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
  }, [activePath, router, ref]);

  return {
    loadFailed,
    retry: () => {
      setLoadFailed(false);
      setAttempt((value) => value + 1);
    },
  };
}
