import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./upstream-plan.mjs", import.meta.url));

test("previews a whole nightly and an isolated pick without modifying the feature branch", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "chronos-plan-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trimEnd();
  const write = (name, text) => writeFileSync(join(cwd, name), text);
  const commitAll = (message) => {
    git("add", "-A");
    git("commit", "-qm", message);
    return git("rev-parse", "HEAD");
  };
  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
  const report = (...args) => {
    const result = run(...args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };

  git("init", "-q", "-b", "t3");
  git("config", "user.name", "Chronos Test");
  git("config", "user.email", "chronos@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  git("config", "core.hooksPath", "unused-hooks");
  write("shared file", "base\n");
  const base = commitAll("base");
  write("shared file", "upstream\n");
  commitAll("earlier T3 change");
  write("incoming", "feature\n");
  const target = commitAll("independent T3 feature");
  git("switch", "-qc", "chronos", base);
  mkdirSync(join(cwd, "chronos"));
  write("chronos/version.json", JSON.stringify({ upstream: "fixture", upstreamCommit: base }));
  write("shared file", "chronos\n");
  const head = commitAll("fork");
  write("shared file", "local\n");
  write("chronos/new feature", "new\n");
  const before = git("status", "--porcelain=v1");

  assert.match(report("surface"), /\(1\)\s+"shared file"/);
  assert.match(report("feature"), /\(1\)\s+"chronos\/new feature"[\s\S]+\(1\)\s+"shared file"/);
  assert.match(report("feature", base), /"chronos\/version.json"/);
  write("staged-only", "staged\n");
  git("add", "--", "staged-only");
  rmSync(join(cwd, "staged-only"));
  assert.match(report("feature"), /"staged-only"/);
  git("restore", "--staged", "--", "staged-only");
  const nightly = report("nightly", target);
  assert.match(nightly, /с обеих сторон \(1\)\s+"shared file"/);
  assert.match(nightly, /пробном переносе Git \(1\)\s+"shared file"/);
  assert.match(report("pick", target), /изменении T3: 1[\s\S]+пробном переносе Git \(0\)/);
  assert.match(report("nightly", base), /уже входит/);
  assert.notEqual(run("pick", "unknown-ref").status, 0);
  assert.equal(git("rev-parse", "HEAD"), head);
  assert.equal(git("status", "--porcelain=v1"), before);
  assert.equal(git("branch", "--show-current"), "chronos");

  git("cherry-pick", "-x", target);
  assert.match(report("pick", target), /не меняет содержимое HEAD/);
});
