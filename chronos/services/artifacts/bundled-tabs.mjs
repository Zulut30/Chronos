import { readFileSync } from "node:fs";

const source = "https://cdn.jsdelivr.net/npm/@ui-sdk/web@0.1.0-beta.17/browser/web/tabs.js";
// A colon cannot occur in a published artifact filename.
const prefix = "/chronos:vendor/ui-sdk-tabs/";

export function bundledTabsRedirect(request, id) {
  if (request.method === "GET" && request.resourceType === "script" && request.url === source)
    return `chronos-artifact://${id}${prefix}tabs.js`;
}

export function isBundledTabsPath(pathname) {
  return pathname.startsWith(prefix);
}

export function bundledTabsFile(pathname) {
  const name = pathname.slice(prefix.length);
  if (!/^(?:tabs\.js|chunks\/[\w-]{8}\.js)$/.test(name)) return null;
  try {
    return readFileSync(new URL("./vendor/ui-sdk-tabs/" + name, import.meta.url));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
