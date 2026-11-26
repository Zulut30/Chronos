import { readFile } from "node:fs/promises";

// Excalidraw has its own language packs. Select its native English pack and translate
// the small Studio toolbar wrapped around it, leaving scene data and vendor files intact.
let cached;
export function englishBoard() {
  cached ??= Promise.all([
    readFile(new URL("../studio-service/public/excalidraw/app.js", import.meta.url), "utf8"),
    readFile(new URL("./olympus-en.json", import.meta.url), "utf8"),
  ]).then(([source, catalog]) => {
    const marker = 'langCode:"ru-RU"';
    if (!source.includes(marker)) throw Error("Missing Studio board locale");
    const { exact } = JSON.parse(catalog);
    return source.replace(marker, 'langCode:"en"').replace(
      /"((?:[^"\\\r\n]|\\u[\da-f]{4})*?\\u04[\da-f]{2}(?:[^"\\\r\n]|\\u[\da-f]{4})*)"/gi,
      (token) => {
        const value = JSON.parse(token);
        const key = value.trim();
        return Object.hasOwn(exact, key) ? JSON.stringify(value.replace(key, () => exact[key])) : token;
      },
    );
  }).catch(error => { cached = undefined; throw error; });
  return cached;
}
