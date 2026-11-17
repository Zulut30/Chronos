import { chronosMarkdownRichTree, chronosRichStyle } from "@t3tools/shared/markdownPipeline";
import { toHtml } from "hast-util-to-html";
import type { Root } from "hast";

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

export function chronosMessageClipboard(
  text: string,
  serializer: {
    fragment: (node: Node) => string;
    codeBlock: (source: string, language: string | null) => string;
  },
): { text: string; html: string } | null {
  if (typeof document === "undefined" || !/<(?:span\b[^>]*style|font\b|mark\b|u\b)/i.test(text))
    return null;
  const container = document.createElement("div");
  container.innerHTML = toHtml(chronosMarkdownRichTree(text) as Root);
  if (!container.querySelector("[style],mark,u")) return null;
  portableRichHtml(container);
  const html = `<meta charset="utf-8">${container.innerHTML}`;
  for (const pre of container.querySelectorAll("pre")) {
    const language =
      pre.querySelector("code")?.className.match(/(?:^|\s)language-([^\s]+)/)?.[1] ?? null;
    pre.setAttribute("data-markdown-copy", serializer.codeBlock(pre.textContent ?? "", language));
    pre.setAttribute("data-markdown-verbatim", "");
  }
  return { text: serializer.fragment(container), html };
}
