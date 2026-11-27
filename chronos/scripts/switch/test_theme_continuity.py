"""Only the two published legacy Olympus exports may change during a switch."""
import tempfile
import unittest
from pathlib import Path

from continuity import ORIGINAL_OLYMPUS, compare_theme_hashes, compare_themes


class ThemeContinuityTest(unittest.TestCase):
    def test_stock_requires_the_actual_package_bytes(self):
        for stock in ORIGINAL_OLYMPUS:
            before = {"olympus.json": stock, "custom.json": "custom"}
            after = {**before, "olympus.json": "package"}
            result = compare_theme_hashes(before, after, "package")
            self.assertTrue(result["ok"])
            self.assertTrue(result["stockOlympusUpdated"])
            self.assertEqual(result["byteIdentical"], 1)
            self.assertFalse(compare_theme_hashes(before, after, "other-package")["ok"])
            for name in ["custom.json", "nested/olympus.json"]:
                with self.subTest(name=name):
                    result = compare_theme_hashes({name: stock}, {name: "package"}, "package")
                    self.assertFalse(result["ok"])
                    self.assertEqual(result["unexpectedChanges"], [name])

    def test_other_changes_still_fail_alongside_a_valid_update(self):
        before = {"olympus.json": next(iter(ORIGINAL_OLYMPUS)), "custom.json": "custom"}
        for others in [{}, {"custom.json": "modified"}, {"custom.json": "custom", "new.json": "new"}]:
            with self.subTest(others=others):
                result = compare_theme_hashes(before, {"olympus.json": "package", **others}, "package")
                self.assertTrue(result["stockOlympusUpdated"])
                self.assertFalse(result["ok"])

    def test_edited_colors_must_be_preserved_byte_for_byte(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            old, new = root / "before", root / "after"
            bundle = root / "packaged.json"
            bundle.write_bytes(b'{"canvas":"#101216"}')
            for profile in [old, new]:
                themes = profile / "themes"
                themes.mkdir(parents=True)
                (themes / "olympus.json").write_bytes(b'{"canvas":"#101217"}')
            result = compare_themes(old, new, bundle)
            self.assertTrue(result["ok"])
            self.assertFalse(result["stockOlympusUpdated"])
            (new / "themes/olympus.json").write_bytes(bundle.read_bytes())
            result = compare_themes(old, new, bundle)
            self.assertFalse(result["ok"])
            self.assertEqual(result["unexpectedChanges"], ["olympus.json"])


if __name__ == "__main__":
    unittest.main()
