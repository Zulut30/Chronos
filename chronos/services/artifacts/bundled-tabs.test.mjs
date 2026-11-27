import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { bundledTabsRedirect } from "./bundled-tabs.mjs";
import { resource } from "./policy.mjs";

const id = "12345678-1234-1234-1234-123456789abc";
const url = "https://cdn.jsdelivr.net/npm/@ui-sdk/web@0.1.0-beta.17/browser/web/tabs.js";
const request = { url, method: "GET", resourceType: "script" };
const store = { file() { throw Error("Bundled modules must not resolve in the artifact database"); } };

test("only the exact pinned tabs script is redirected within the artifact's origin", () => {
  for (const other of [
    { method: "POST" }, { resourceType: "mainFrame" }, { resourceType: "xhr" },
    { url: url + "?different" }, { url: url.replace("beta.17", "beta.18") },
    { url: url.replace("cdn.jsdelivr.net", "unpkg.com") },
  ]) assert.equal(bundledTabsRedirect({ ...request, ...other }, id), undefined);
  const entry = bundledTabsRedirect(request, id);
  assert.equal(new URL(entry).hostname, id);
  assert.equal(resource(store, id.replace("1234", "5678"), entry).status, 403);
  for (const name of ["LICENSE", "missing.js", "chunks/AAAAAAAA.js", "chunks/%2e%2e%2fLICENSE"]) {
    assert.equal(resource(store, id, new URL(name, entry)).status, 404);
  }
});

test("all transitive tabs imports resolve offline for the current page and historical versions", async () => {
  for (const version of [undefined, 1]) {
    const entry = bundledTabsRedirect(request, id);
    const modules = new Set([entry]);
    for (const href of modules) {
      const response = resource(store, id, href, version);
      assert.equal(response.status, 200, href);
      assert.equal(response.headers.get("Content-Type"), "text/javascript");
      const source = await response.text();
      for (const match of source.matchAll(/(?:from\s*|import\s*\(?\s*)["']([^"']+)["']/g)) {
        assert.ok(match[1].startsWith("."), match[1]);
        modules.add(new URL(match[1], href).href);
      }
    }
    assert.equal(modules.size, 16);
  }
});

test("the standard SDK loader can resolve each lazy widget relative to its local URL", async () => {
  const browser = new URL("../", url).href;
  const loader = bundledTabsRedirect({ ...request, url: browser + "web.js" }, id);
  const css = bundledTabsRedirect({ url: browser + "web.css", method: "GET", resourceType: "stylesheet" }, id);
  assert.equal(bundledTabsRedirect({ ...request, url: browser + "web.css" }, id), undefined);
  const stylesheet = resource(store, id, css);
  assert.match(stylesheet.headers.get("Content-Type"), /^text\/css/);
  assert.equal(createHash("sha256").update(await stylesheet.text()).digest("hex"),
    "c102dae0741c094c886aadc7e4a56849dfbe37502e48e399ae339db09d533f5b");
  const source = await resource(store, id, loader).text();
  const widgets = /`(accordion\.[a-z.-]+)`\.split/.exec(source)?.[1].split(".");
  assert.ok(widgets?.includes("tabs") && widgets.includes("dialog"));
  const modules = new Set(widgets.map(widget => new URL("web/" + widget + ".js", loader).href));
  for (const href of modules) {
    const response = resource(store, id, href);
    assert.equal(response.status, 200, href);
    for (const match of (await response.text()).matchAll(/(?:from\s*|import\s*\(?\s*)["'](\.[^"']+\.js)["']/g))
      modules.add(new URL(match[1], href).href);
  }
  assert.equal(widgets.length, 56);
  assert.equal(modules.size, 142);
});
