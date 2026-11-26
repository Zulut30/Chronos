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

function patchMacosIntegrationsCopy(root: ParentNode) {
  if (window.desktopBridge?.getClientPlatform?.() !== "darwin") return;
  const intro = root.querySelector<HTMLElement>(".oly-ik-panel .oly-ik-intro");
  if (intro?.textContent?.includes("переменных окружения Windows")) {
    intro.textContent = intro.textContent.replace(
      "переменных окружения Windows вашего пользователя",
      "локальном файле профиля Chronos (~/.chronos/integrations-service/keys.env)",
    );
  }
  const down = root.querySelector<HTMLElement>(".oly-ik-panel .oly-ik-down p");
  if (down?.textContent?.includes("Windows")) {
    down.textContent =
      "Не удалось связаться с локальным сервисом 127.0.0.1:4522 (integrations-service). Он запускается вместе с Chronos — перезапустите приложение и нажмите «Повторить».";
  }
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
      if (nav.parentElement) patchMacosIntegrationsCopy(nav.parentElement);
    };

    // The modules clone nav buttons and can restore an old selection after their panel closes.
    const observer = new MutationObserver(syncSelection);
    observer.observe(nav, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-active", "aria-current"],
    });
    const layoutObserver =
      window.desktopBridge?.getClientPlatform?.() === "darwin" && nav.parentElement
        ? new MutationObserver(() => {
            if (nav.parentElement) patchMacosIntegrationsCopy(nav.parentElement);
          })
        : null;
    if (layoutObserver && nav.parentElement) {
      layoutObserver.observe(nav.parentElement, { childList: true, subtree: true });
    }
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
      layoutObserver?.disconnect();
    };
  }, [activePath, router]);

  return ref;
}
