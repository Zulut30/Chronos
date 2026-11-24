import type { Plugin } from "unified";

// Only the web build resolves this module to the extracted pair of Olympus rehype plugins.
export const richMarkdown: { pre: Plugin; post: Plugin } | undefined = undefined;
