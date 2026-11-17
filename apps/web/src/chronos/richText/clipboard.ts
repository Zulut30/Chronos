import { chronosMarkdownRichTree, chronosRichStyle } from "@t3tools/shared/markdownPipeline";

const RICH = "[data-chronos-rich],mark,u";

export function restoreRichSelectionAncestors(range: Range, container: Element): void {
  let ancestor =
    range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
  if (!ancestor?.closest(RICH) || ancestor.closest("pre,code")) return;
  const markdown = ancestor.closest(".chat-markdown");
  while (ancestor && ancestor !== markdown && markdown?.contains(ancestor)) {
    const shell = ancestor.cloneNode(false);
    while (container.firstChild) shell.appendChild(container.firstChild);
    container.replaceChildren(shell);
    ancestor = ancestor.parentElement;
  }
}

export function portableRichHtml(container: Element): void {
  for (const element of [container, ...container.querySelectorAll("*")]) {
    if (element.closest("pre,code")) continue;
    if (!element.matches(`${RICH},span[style]`)) continue;
    let style = chronosRichStyle(element.getAttribute("style") ?? "", true);
    if (element.localName === "mark") style += ";background-color:#FFE58F";
    if (element.localName === "u") style += ";text-decoration:underline";
    if (style) element.setAttribute("style", style.replace(/^;/, ""));
    else element.removeAttribute("style");
    for (const attribute of element.getAttributeNames()) {
      if (/^(?:class|id|data-|on)/.test(attribute)) element.removeAttribute(attribute);
    }
  }
}

interface HtmlNode {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HtmlNode[];
}
function dom(node: HtmlNode): Node {
  if (node.type === "text") return document.createTextNode(node.value ?? "");
  if (node.type !== "element") {
    const fragment = document.createDocumentFragment();
    node.children?.forEach((child) => fragment.appendChild(dom(child)));
    return fragment;
  }
  const element = document.createElement(node.tagName ?? "span");
  for (const [name, value] of Object.entries(node.properties ?? {})) {
    if (typeof value === "string" && ["style", "href", "src", "alt", "title"].includes(name))
      element.setAttribute(name, value);
  }
  node.children?.forEach((child) => element.appendChild(dom(child)));
  return element;
}

export function chronosMessageClipboard(text: string): { text: string; html: string } | null {
  if (typeof document === "undefined" || !/<(?:span\b[^>]*style|font\b|mark\b|u\b)/i.test(text))
    return null;
  const container = document.createElement("div");
  container.appendChild(dom(chronosMarkdownRichTree(text) as HtmlNode));
  if (!container.querySelector("[style],mark,u")) return null;
  portableRichHtml(container);
  const plain = container.innerText || container.textContent || "";
  return { text: plain, html: `<meta charset="utf-8">${container.innerHTML}` };
}
