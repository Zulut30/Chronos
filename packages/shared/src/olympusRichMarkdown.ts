import type { Root } from "hast";

type RichPlugin = () => (tree: Root) => void;

// Only the web build resolves this module to the extracted pair of Olympus rehype plugins.
export const richMarkdown: { pre: RichPlugin; post: RichPlugin } | undefined = undefined;
