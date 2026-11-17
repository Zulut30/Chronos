import type { ReactNode } from "react";
import type { Root, RootContent } from "mdast";
import { localServicesAvailable } from "./services";
import { useChronosWorkspace } from "./state";

const PREFIX = "https://chronos.invalid/tasks/";
export function remarkChronosTaskReferences() {
  return (tree: Root) => {
    const visit = (node: Root | RootContent) => {
      if (
        node.type === "link" ||
        node.type === "linkReference" ||
        node.type === "code" ||
        node.type === "inlineCode" ||
        !("children" in node)
      )
        return;
      const children: RootContent[] = [];
      for (const child of node.children) {
        if (child.type !== "text") {
          visit(child);
          children.push(child);
          continue;
        }
        let from = 0;
        for (const match of child.value.matchAll(/(?<![\w/])#(T-\d+)\b/g)) {
          if (match.index > from)
            children.push({ type: "text", value: child.value.slice(from, match.index) });
          children.push({
            type: "link",
            url: PREFIX + match[1],
            children: [{ type: "text", value: match[0] }],
          });
          from = match.index + match[0].length;
        }
        if (from === 0) children.push(child);
        else if (from < child.value.length)
          children.push({ type: "text", value: child.value.slice(from) });
      }
      // All replacements retain their parent's phrasing/content category.
      node.children = children as typeof node.children;
    };
    visit(tree);
  };
}
export function chronosTaskLink(href: string | undefined, children: ReactNode) {
  if (!href?.startsWith(PREFIX)) return null;
  const id = href.slice(PREFIX.length);
  if (!/^T-\d+$/.test(id)) return null;
  return (
    <button
      type="button"
      disabled={!localServicesAvailable()}
      onClick={() => useChronosWorkspace.getState().open("tasks", { taskId: id })}
    >
      {children}
    </button>
  );
}
