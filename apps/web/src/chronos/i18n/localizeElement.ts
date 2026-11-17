// chronos: localizes interface text as React elements are created. Upstream components keep their
// English literals; this layer swaps text children and a few text props for the Russian catalog
// and shows the product as Chronos. No DOM observation: it runs inside the jsx() calls of the web
// app's own modules (see jsxRuntime.ts and vitePlugin.ts). See chronos/README.md.
import { createContext, createElement, useContext, type ReactNode } from "react";

import { isChronosCatalogActive, localizeChronosText } from "./catalog";

const TEXT_PROPS = ["title", "placeholder", "aria-label", "alt"] as const;

// Elements whose contents are user or machine text, never interface copy.
const VERBATIM_TAGS = new Set(["pre", "code", "kbd", "samp", "textarea", "script", "style"]);
const VERBATIM_CLASS = /(?:^|\s)(?:chat-markdown|font-mono|xterm)(?:\s|$)/;
// Host elements that only accept plain strings as text children.
const STRING_ONLY_TAGS = new Set(["option", "title"]);

/** Set below elements that hold user content: matched strings there stay as written. */
const VerbatimContext = createContext(false);

function ChronosText({ source, text }: { source: string; text: string }): string {
  return useContext(VerbatimContext) ? source : text;
}

type Props = Record<string, unknown>;

/** User-entered and agent text (thread titles, messages, questions) sets its text direction. */
function isUserText(props: Props): boolean {
  return props.dir != null || Boolean(props.contentEditable) || "data-user-message-bubble" in props;
}

function isVerbatimHost(type: string, props: Props): boolean {
  if (VERBATIM_TAGS.has(type) || isUserText(props)) return true;
  const className = props.className;
  return typeof className === "string" && VERBATIM_CLASS.test(className);
}

/**
 * Host elements (`"span"`) get context-aware text, so strings under user content stay as written.
 * Components get plain strings: Base UI renders its DOM through React.createElement, which this
 * layer never sees, so text handed to a component is localized when that component is created.
 */
export function localizeElementProps(type: unknown, props: unknown): unknown {
  if (props === null || typeof props !== "object") return props;
  const source = props as Props;
  const host = typeof type === "string";
  if (!host && isUserText(source)) return props;
  const translate = isChronosCatalogActive();
  const patch: Props = {};
  let patched = false;
  const set = (key: string, value: unknown) => {
    patch[key] = value;
    patched = true;
  };
  const result = () => (patched ? { ...source, ...patch } : props);

  for (const name of TEXT_PROPS) {
    const value = source[name];
    if (typeof value !== "string") continue;
    const text = localizeChronosText(value, translate);
    if (text !== value) set(name, text);
  }

  const children = source.children;
  if (children == null || typeof children === "boolean") return result();

  if (host && isVerbatimHost(type, source)) {
    if (typeof children === "object") {
      // Children go in props, so React does not treat a static list as a keyed one.
      const provided = { value: true, children: children as ReactNode };
      set("children", createElement(VerbatimContext.Provider, provided));
    }
    return result();
  }

  const wrap = host && !STRING_ONLY_TAGS.has(type);
  const localize = (child: unknown, key: string | undefined): unknown => {
    if (typeof child !== "string") return child;
    const text = localizeChronosText(child, translate);
    if (text === child) return child;
    return wrap ? createElement(ChronosText, { source: child, text, key }) : text;
  };

  if (typeof children === "string") {
    const localized = localize(children, undefined);
    if (localized !== children) set("children", localized);
  } else if (Array.isArray(children)) {
    let changed = false;
    const localized = children.map((child: unknown, index) => {
      const value = localize(child, `chronos-text-${index}`);
      if (value !== child) changed = true;
      return value;
    });
    if (changed) set("children", localized);
  }
  return result();
}
