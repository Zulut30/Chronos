// Language is applied to the app's controls. Values authored in chats, projects, files,
// templates, boards and skill documents are outside the translation surface.
const attributes = ["aria-label", "placeholder", "title", "alt", "label"];
const alwaysSkip = [
  "script", "style", "pre", "code", ".chat-markdown", "[data-user-message-bubble]",
  "[contenteditable=true]", ".composer-tiptap", ".xterm", "[translate=no]:not(html)",
  "[data-oly-ps-name] h3", "[data-oly-ps-name] p", ".oly-tk-card .t", ".oly-tk-card .d",
  ".oly-tk-label", ".oly-tk-md", ".oly-tk-n .x", ".oly-tk-n .w b",
  ".oly-tk-item[data-sel^='p:'] > span", ".oly-tk-item[data-sel^='g:'] > span",
  "[data-thread-item] .truncate", "[data-testid=sidebar-project-folder] .truncate", "[data-slot=project-monogram]", "[data-file-path]", "[data-item-path]",
].join(",");
const frameUserText = [
  ".name > span:first-child", ".subh .lbl", "button.mname[data-open]", ".md", ".skill-md", ".file-content",
  ".cap .name", "[data-thumb] svg", ".row[data-name] .name", ".endpoint", "#cards article > h2", "#cards article > p",
  ".board-name", ".board-title", ".server-name", ".artifact-title",
].join(",");
const chrome = [
  "[class^='oly-']", "[class*=' oly-']", "[id^='oly-']", "[data-oly-ik-open]",
  "[data-oly-ik-row]", "[data-oly-ik-nav]", "[data-oly-ik-crumb]", "[data-oly-mcp-nav]",
  "[data-oly-studio]", "[data-oly-studio-launch]", "[data-oly-skills]", "[data-oly-tasks]", "[data-oly-prompts-nav]", "[data-oly-ps-nav-button]", "[data-oly-ps-nav]", "[data-oly-ps-crumb]",
].join(",");

const servicePorts = new Set(["4517", "4520", "4523"]);
function tellFrame(frame) {
  const url = new URL(frame.src, location.href);
  if (url.hostname !== "127.0.0.1" || !servicePorts.has(url.port)) return;
  if (!["/", "/index.html", "/artifacts.html", "/board"].includes(url.pathname)) return;
  if (url.pathname === "/board") {
    if (!url.searchParams.has("ui-language")) {
      url.searchParams.set("ui-language", "en");
      frame.src = url.href;
    }
    return;
  }
  frame.contentWindow?.postMessage({ type: "chronos:ui-language", language: "en" }, url.origin);
}

const escapeRegex = s => s.replace(/[.*+?^$\u007b\u007d()|[\]\\]/g, "\\$&");

export function installEnglish({ exact, templates }) {
  const embedded = window !== window.top;
  const skip = embedded ? alwaysSkip + "," + frameUserText : alwaysSkip;
  const patterns = Object.entries(templates)
    .sort(([a], [b]) => b.replace(/\{\d+\}/g, "").length - a.replace(/\{\d+\}/g, "").length)
    .map(([source, target]) => [
      new RegExp("^" + source.split(/\{\d+\}/g).map(escapeRegex).join("(.*?)") + "$", "u"),
      target,
    ]);
  const translate = raw => {
    if (!raw || !/[а-яё]/iu.test(raw)) return raw;
    const text = raw.trim().replace(/\s+/gu, " ");
    let value = Object.hasOwn(exact, text) ? exact[text] : undefined;
    if (value === undefined && text.length < 1000) {
      for (const [pattern, target] of patterns) {
        const match = pattern.exec(text);
        if (!match) continue;
        // Captures may be filenames or user-entered titles, even when they coincide with a label.
        value = target.replace(/\{(\d+)\}/g, (_, i) => match[Number(i)]);
        break;
      }
    }
    return value === undefined ? raw : raw.replace(raw.trim(), () => value);
  };
  if (embedded) {
    document.title = translate(document.title);
  } else {
    window.__chronosEnglishText = translate;
    const confirm = window.confirm.bind(window);
    window.confirm = text => confirm(translate(text));
    if (window.Notification) {
      window.__chronosOlympusNotification = class extends Notification {
        constructor(title, options) {
          super(title, options?.body ? { ...options, body: translate(options.body) } : options);
        }
      };
    }
  }
  function visit(node) {
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!el || el.closest(skip)) return;
    if (node.nodeType === Node.TEXT_NODE) {
      if (el.matches("textarea, input") || (!embedded && !el.closest(chrome))) return;
      // The immutable API key panel puts the masked key state and the service rate
      // in a single text node beside the environment variable. Each field is UI copy.
      const value = el.matches(".oly-ik-meta")
        ? node.data.split(/(\s*·\s*)/u).map(translate).join("")
        : translate(node.data);
      if (value !== node.data) node.data = value;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (!embedded && !el.closest(chrome) &&
          !el.getAttributeNames().some(name => name.startsWith("data-oly-"))) return;
      for (const key of attributes) {
        const old = el.getAttribute(key);
        const next = translate(old);
        if (old !== next) el.setAttribute(key, next);
      }
    }
  }
  function walk(root) {
    if (root.nodeType === Node.TEXT_NODE) return visit(root);
    if (root.nodeType !== Node.ELEMENT_NODE || root.closest(skip)) return;
    visit(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: node => node.nodeType === Node.ELEMENT_NODE && node.matches(skip)
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    while (walker.nextNode()) visit(walker.currentNode);
  }
  document.addEventListener("load", event => {
    if (event.target instanceof HTMLIFrameElement) tellFrame(event.target);
  }, true);
  document.querySelectorAll("iframe").forEach(tellFrame);
  if (embedded) document.documentElement.lang = "en";
  walk(document.body);
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "childList") record.addedNodes.forEach(walk);
      else visit(record.target);
    }
  }).observe(document.body, {
    childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: attributes,
  });
}
