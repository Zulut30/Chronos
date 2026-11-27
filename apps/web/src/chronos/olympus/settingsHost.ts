import "./settingsHost.css";
import { registerPromptModeSelect } from "./promptModeSelect";

function scopedListener(target: EventTarget, signal: AbortSignal) {
  return (name: string, listener: EventListener, options?: boolean | AddEventListenerOptions) =>
    target.addEventListener(name, listener, {
      ...(typeof options === "boolean" ? { capture: options } : options),
      signal,
    });
}

function patchMacosIntegrationsCopy(root: ParentNode) {
  const intro = root.querySelector<HTMLElement>(".oly-ik-panel .oly-ik-intro");
  // The immutable module may have mounted either before or after the English observer.
  if (intro?.textContent?.includes("Windows")) {
    const copy = "Ключи веб-сервисов для ИИ-агентов: поиск и парсинг страниц, X (Twitter), Reddit, расшифровки YouTube. Хранятся в локальном файле профиля Chronos (~/.chronos/integrations-service/keys.env) и не показываются после сохранения.";
    intro.textContent = window.__chronosEnglishText?.(copy) ?? copy;
  }
  const down = root.querySelector<HTMLElement>(".oly-ik-panel .oly-ik-down p");
  if (down?.textContent?.includes("Windows")) {
    down.textContent =
      "Не удалось связаться с локальным сервисом 127.0.0.1:4522 (integrations-service). Он запускается вместе с Chronos — перезапустите приложение и нажмите «Повторить».";
  }
}

export function openSettingsHost(
  layout: HTMLElement,
  mount: (scope: ReturnType<typeof createScope>) => void,
) {
  const lifetime = new AbortController();
  registerPromptModeSelect();
  const scope = createScope(layout, lifetime.signal);
  layout.dataset.chronosSettings = "";
  try {
    mount(scope);
  } catch (error) {
    lifetime.abort();
    delete layout.dataset.chronosSettings;
    throw error;
  }
  const isMac = window.desktopBridge?.getClientPlatform?.() === "darwin";
  const feedback = new MutationObserver(() => {
    if (isMac) patchMacosIntegrationsCopy(layout);
    const mcp = layout.querySelector(".oly-mcp-error");
    if (mcp) mcp.setAttribute("role", mcp.querySelector("button") ? "alert" : "status");
    for (const message of layout.querySelectorAll(
      ".oly-ik-down, .oly-ik-result, .oly-ik-panel [data-slot=settings-row] > p:only-child",
    )) {
      message.setAttribute(
        "role",
        message.matches(".oly-ik-down, [data-ok=false]") ? "alert" : "status",
      );
    }
  });
  feedback.observe(layout, { childList: true, subtree: true });
  const modules = scope.globalThis;
  globalThis.__olyIntegrations = modules.__olyIntegrations;
  globalThis.__olyMcpManager = modules.__olyMcpManager;
  globalThis.__olyPromptsSettings = modules.__olyPromptsSettings;
  return () => {
    feedback.disconnect();
    modules.__olyIntegrations?.close();
    modules.__olyMcpManager?.close();
    lifetime.abort();
    delete layout.dataset.chronosSettings;
    if (globalThis.__olyIntegrations === modules.__olyIntegrations)
      globalThis.__olyIntegrations = undefined;
    if (globalThis.__olyMcpManager === modules.__olyMcpManager)
      globalThis.__olyMcpManager = undefined;
    if (globalThis.__olyPromptsSettings === modules.__olyPromptsSettings)
      globalThis.__olyPromptsSettings = undefined;
  };
}

// Olympus owns its DOM, including its styles and observers. The original modules can use their
// built-in DOM/route fallback here, observing only this layout while the dialog is mounted.
function createScope(layout: HTMLElement, signal: AbortSignal) {
  const modules: Pick<
    typeof globalThis,
    "__olyIntegrations" | "__olyMcpManager" | "__olyPromptsSettings"
  > = {
    __olyIntegrations: undefined,
    __olyMcpManager: undefined,
    __olyPromptsSettings: undefined,
  };
  Object.defineProperty(modules, "__olyPlanUi", {
    get: () => Reflect.get(globalThis, "__olyPlanUi"),
  });
  const styles: HTMLElement[] = [];
  const observers = new Set<MutationObserver>();
  signal.addEventListener(
    "abort",
    () => {
      for (const observer of observers) observer.disconnect();
      for (const style of styles) style.remove();
    },
    { once: true },
  );
  const navigation: EventTarget | undefined = Reflect.get(window, "navigation");
  return {
    globalThis: modules,
    window: {
      confirm: window.confirm.bind(window),
      navigation: navigation && { addEventListener: scopedListener(navigation, signal) },
    },
    addEventListener: scopedListener(window, signal),
    requestAnimationFrame: (callback: FrameRequestCallback) =>
      requestAnimationFrame((time) => {
        if (!signal.aborted) callback(time);
      }),
    MutationObserver: class extends MutationObserver {
      override observe(target: Node, options?: MutationObserverInit) {
        observers.add(this);
        super.observe(target, options);
      }
      override disconnect() {
        observers.delete(this);
        super.disconnect();
      }
    },
    document: {
      body: layout,
      head: document.head,
      documentElement: document.documentElement,
      get activeElement() {
        return document.activeElement;
      },
      querySelector: layout.querySelector.bind(layout),
      querySelectorAll: layout.querySelectorAll.bind(layout),
      createElement(tag: string) {
        const node = document.createElement(tag);
        if (tag === "style") styles.push(node);
        if (tag === "iframe" || tag === "button" || tag === "input") {
          const focus = node.focus.bind(node);
          node.focus = (options) => {
            // MCP focuses its frame on load and Prompts focuses a control after fetching.
            // Keep typing in the sidebar when a panel finishes loading in the background.
            if (
              node.closest(".oly-mcp-pane, .oly-ps-pane") &&
              document.activeElement?.closest("nav[data-workspace-area=settings-nav] :is([role=combobox], [role=option])")
            ) return;
            focus(options);
          };
        }
        return node;
      },
      createElementNS: document.createElementNS.bind(document),
      createTextNode: document.createTextNode.bind(document),
      addEventListener: scopedListener(document, signal),
    },
  };
}
