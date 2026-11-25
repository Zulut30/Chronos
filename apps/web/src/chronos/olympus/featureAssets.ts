import { featureIds, featureKey, type FeatureId } from "./featureFlags.ts";

// ESM dependencies may be evaluated before main, or first requested after a settings change.
// Take one synchronous snapshot per window, whichever Olympus entry runs first.
const flags = JSON.stringify(featureIds.map((id) => [id, featureKey(id)]));
const snapshot = `globalThis.__chronosOlympusDisabled ??= (() => {
  const disabled = new Set();
  try {
    for (const [id, key] of ${flags}) {
      if (localStorage.getItem(key) === "0") disabled.add(id);
    }
  } catch {}
  if (disabled.has("22-budget")) disabled.add("26-notifications");
  return disabled;
})();\n`;

const enabled = (id: FeatureId) => `!globalThis.__chronosOlympusDisabled.has("${id}")`;

function guardedBlock(id: FeatureId, source: string) {
  // Upstream's four send/resume paths call the Olympus resolver unconditionally.
  const fallback = id === "10-plan-mode" ? " else { globalThis.__olyPlanMode = fallback => fallback; }" : "";
  return `if (${enabled(id)}) {\n${source}\n}${fallback}\n`;
}

export function featureBlock(file: string, source: string) {
  const id = featureIds.find((id) => file === id + ".js");
  return id ? guardedBlock(id, source) : source;
}

export function standaloneFeature(file: string, source: string) {
  if (file === "88-rich-markdown.chat.js") {
    // Both shared markdown entry points already omit their hooks and extra schema when undefined.
    return snapshot + source + `\nexport const richMarkdown = ${enabled("88-rich-text")} ? {pre: __olyRichPre, post: __olyRichPost} : undefined;\n`;
  }
  const block = featureBlock(file, source);
  return block === source ? source : snapshot + block;
}

export function assemblePrologue(imports: string, read: (path: string) => string) {
  return snapshot + imports.trimEnd().split(/\r?\n/).map((line) => {
    if (!line.trim()) return "\n";
    const file = /^import "\.\/features\/([\w.-]+\.js)";$/.exec(line)?.[1];
    if (!file) throw new Error("Unexpected Olympus prologue line: " + line);
    return featureBlock(file, read("./features/" + file));
  }).join("");
}
