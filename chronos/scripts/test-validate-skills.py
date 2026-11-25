"""Regression cases for paths that exist but send an agent to the wrong skill."""

import runpy
import tempfile
import unittest
from pathlib import Path


validator = runpy.run_path(str(Path(__file__).with_name("validate-skills.py")))


class RoutingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.router = self.root / "chronos/skills/chronos-router/SKILL.md"
        self.router.parent.mkdir(parents=True)
        self.installed = set(validator["REQUIRED"])
        for name in ("AGENTS.md", "CLAUDE.md"):
            (self.root / name).write_text(
                "<!-- chronos: begin fork instructions -->\n"
                "[Router](chronos/skills/chronos-router/SKILL.md)\n"
                "<!-- chronos: end fork instructions -->", encoding="utf-8"
            )
        self.rows = [
            f"| Task | [{name}](../{name}/SKILL.md) |"
            for name in sorted(self.installed - {"chronos-router"})
        ] + [f"| Task | `{name}` |" for name in sorted(validator["PENDING"])]

    def errors(self):
        self.router.write_text("\n".join(self.rows), encoding="utf-8")
        return validator["validate_routing"](self.root, self.installed)

    def test_pending_routes_work_before_their_branches_land(self):
        self.assertEqual(self.errors(), [])

    def test_detects_a_link_to_another_installed_skill(self):
        self.rows = [row.replace("(../chronos-ui/", "(../chronos-ci/") for row in self.rows]
        self.assertIn("router sends chronos-ui to ../chronos-ci/SKILL.md", self.errors())

    def test_detects_missing_package_route_and_agent_entry(self):
        self.installed.remove("chronos-ci")
        self.rows = [row for row in self.rows if "[chronos-ui]" not in row]
        (self.root / "CLAUDE.md").write_text("@AGENTS.md", encoding="utf-8")
        errors = self.errors()
        self.assertIn("missing required skill: chronos-ci", errors)
        self.assertIn("no router table entry for chronos-ui", errors)
        self.assertIn("CLAUDE.md: missing fork entry point to chronos-router", errors)


if __name__ == "__main__":
    unittest.main()
