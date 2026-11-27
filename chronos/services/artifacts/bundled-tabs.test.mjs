import assert from "node:assert/strict";
import { test } from "node:test";
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
