import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { installOlympusTheme } from "../../../apps/desktop/src/chronos/OlympusTheme.ts";

const source = fileURLToPath(new URL("../../brand/themes/olympus.json", import.meta.url));

function profile(t) {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "chronos-theme-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const themes = path.join(dir, "themes");
  fs.mkdirSync(themes);
  return {
    dir, themes, current: path.join(themes, "olympus.json"), settings: path.join(dir, "settings.json"),
    offer: path.join(dir, "theme-updates", "olympus-graphite.json"),
    install: () => installOlympusTheme(dir, source),
  };
}

test("published Olympus keeps the shared/day stylesheet and uses Graphite cards and inline code", () => {
  const theme = JSON.parse(fs.readFileSync(source, "utf8"));
  const start = theme.css.indexOf(":root.dark");
  assert.ok(start > 0);
  assert.equal(createHash("sha256").update(theme.css.slice(0, start)).digest("hex"),
    "780134a6b09aefab824f25afff5be72aadfa2e3815742a5430b3a8e85a158798");
  assert.equal(theme.name, "Olympus");
  assert.equal(theme.canvas, "#F3EFE6");
  assert.equal(theme.variants.dark.canvas, "#101216");
  assert.equal(theme.variants.dark.surface, "#1D2229");
  assert.doesNotMatch(theme.css.slice(start), /--card\s*:/);
  assert.match(theme.css.slice(start), /--oly-ic-bg:\s*#242A33/i);
  assert.doesNotMatch(theme.css.slice(start), /\b(?:Didot|Bodoni|Cormorant|Georgia|Times)\b/i);
  assert.doesNotMatch(theme.css.slice(start), /\bInter\s*,/);
});

test("fresh profile receives one active Olympus, repeated launch keeps settings", (t) => {
  const p = profile(t);
  p.install();
  assert.deepEqual(fs.readFileSync(p.current), fs.readFileSync(source));
  assert.deepEqual(JSON.parse(fs.readFileSync(p.settings)), { defaultTheme: "olympus" });
  fs.writeFileSync(p.settings, '{"defaultTheme":"other","defaultAppearance":"light"}');
  p.install();
  assert.equal(fs.readFileSync(p.settings, "utf8"), '{"defaultTheme":"other","defaultAppearance":"light"}');
  assert.deepEqual(fs.readdirSync(p.themes), ["olympus.json"]);
});

test("existing profile with an edited Olympus keeps its copy and gets one unpublished update", (t) => {
  const p = profile(t);
  fs.writeFileSync(p.current, "user edition");
  p.install();
  p.install();
  assert.equal(fs.readFileSync(p.current, "utf8"), "user edition");
  assert.deepEqual(fs.readFileSync(p.offer), fs.readFileSync(source));
  assert.equal(fs.existsSync(p.settings), false);
});

test("a custom palette matching the original export size survives two launches", (t) => {
  const p = profile(t);
  // A color edit keeps the byte count of the original export, including its line endings.
  const edited = Buffer.from('{"variants":{"dark":{"canvas":"#081531"}}}'.padEnd(377698));
  fs.writeFileSync(p.current, edited);
  p.install();
  p.install();
  assert.deepEqual(fs.readFileSync(p.current), edited);
  assert.deepEqual(fs.readFileSync(p.offer), fs.readFileSync(source));
});

test("upgrade of a profile without a theme preserves its implicit appearance", (t) => {
  const p = profile(t);
  fs.writeFileSync(path.join(p.dir, "statev2.sqlite"), "");
  p.install();
  assert.deepEqual(fs.readFileSync(p.current), fs.readFileSync(source));
  assert.equal(fs.existsSync(p.settings), false);
});

test("theme fits only outside the catalog when space or file slots run out", (t) => {
  for (const count of [1, 32]) {
    const p = profile(t);
    for (let i = 0; i < count; i++) fs.writeFileSync(path.join(p.themes, i + ".json"), Buffer.alloc(count === 1 ? 2000000 : 5));
    p.install();
    assert.equal(fs.existsSync(p.current), false);
    assert.equal(fs.existsSync(p.settings), false);
    assert.deepEqual(fs.readFileSync(p.offer), fs.readFileSync(source));
  }
});
