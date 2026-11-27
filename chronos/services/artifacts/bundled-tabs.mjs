import { readFileSync } from "node:fs";

const source = "https://cdn.jsdelivr.net/npm/@ui-sdk/web@0.1.0-beta.17/browser/";
const entries = new Map([
  [source + "web/tabs.js", ["script", "web/tabs.js"]],
  [source + "web.js", ["script", "web.js"]],
  [source + "web.css", ["stylesheet", "web.css"]],
]);
// A colon cannot occur in a published artifact filename.
const prefix = "/chronos:vendor/ui-sdk-web/";

export function bundledTabsRedirect(request, id) {
  const entry = entries.get(request.url);
  if (request.method === "GET" && entry && request.resourceType === entry[0])
    return `chronos-artifact://${id}${prefix}${entry[1]}`;
}

export function isBundledTabsPath(pathname) {
  return pathname.startsWith(prefix);
}

export function bundledTabsFile(pathname) {
  const name = pathname.slice(prefix.length);
  if (!/^(?:web\.(?:js|css)|web\/(?:[a-z0-9-]+|chunks\/[\w-]{8})\.js)$/.test(name)) return null;
  try {
    return readFileSync(new URL("./vendor/ui-sdk-web/" + name, import.meta.url));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
