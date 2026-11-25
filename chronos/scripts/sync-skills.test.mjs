import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import { syncSkills } from "./sync-skills.mjs";

NodeTest.test(
  "backs up changed and retired packages, preserving unowned skills and stable installs",
  (t) => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "chronos-skills-test-"));
    t.after(() => NodeFS.rmSync(root, { recursive: true, force: true }));
    const source = NodePath.join(root, "source");
    const profile = NodePath.join(root, "profile");
    const installed = NodePath.join(profile, "skills");
    const writeSkill = (parent, name, text) => {
      const directory = NodePath.join(parent, name);
      NodeFS.mkdirSync(directory, { recursive: true });
      NodeFS.writeFileSync(NodePath.join(directory, "SKILL.md"), text);
    };
    writeSkill(source, "chronos-a", "new");
    writeSkill(source, "chronos-b", "retire later");
    writeSkill(source, "unrelated", "ignore");
    writeSkill(installed, "chronos-a", "previous");
    writeSkill(installed, "chronos-external", "independent");
    writeSkill(installed, "unrelated", "untouched");
    const first = syncSkills(source, profile);
    NodeAssert.deepEqual(first.replaced, ["chronos-a"]);
    NodeAssert.deepEqual(first.installed, ["chronos-b"]);
    NodeAssert.equal(
      NodeFS.readFileSync(NodePath.join(first.backup, "replaced/chronos-a/SKILL.md"), "utf8"),
      "previous",
    );
    NodeAssert.equal(
      NodeFS.readFileSync(NodePath.join(installed, "chronos-a/SKILL.md"), "utf8"),
      "new",
    );
    NodeAssert.equal(syncSkills(source, profile).backup, null);
    NodeFS.renameSync(NodePath.join(source, "chronos-b"), NodePath.join(root, "retired"));
    NodeFS.mkdirSync(NodePath.join(source, "chronos-a/references"));
    NodeFS.writeFileSync(NodePath.join(source, "chronos-a/references/notes.md"), "v2");
    const next = syncSkills(source, profile);
    NodeAssert.deepEqual(next.removed, ["chronos-b"]);
    NodeAssert.equal(NodeFS.existsSync(NodePath.join(installed, "chronos-b")), false);
    NodeAssert.equal(
      NodeFS.readFileSync(NodePath.join(next.backup, "removed/chronos-b/SKILL.md"), "utf8"),
      "retire later",
    );
    NodeAssert.equal(
      NodeFS.readFileSync(NodePath.join(installed, "chronos-a/references/notes.md"), "utf8"),
      "v2",
    );
    NodeAssert.equal(
      NodeFS.readFileSync(NodePath.join(installed, "unrelated/SKILL.md"), "utf8"),
      "untouched",
    );
    NodeAssert.equal(
      NodeFS.readFileSync(NodePath.join(installed, "chronos-external/SKILL.md"), "utf8"),
      "independent",
    );
    NodeAssert.equal(syncSkills(source, profile).backup, null);
    const state = NodePath.join(profile, "chronos-skill-sync");
    NodeFS.writeFileSync(NodePath.join(state, "sync.lock"), "another sync");
    NodeAssert.throws(() => syncSkills(source, profile), { code: "EEXIST" });
    NodeAssert.equal(
      NodeFS.readFileSync(NodePath.join(state, "sync.lock"), "utf8"),
      "another sync",
    );
  },
);
