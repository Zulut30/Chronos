"""Check the skill metadata and the repository links an agent can follow."""

import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

import markdown
import yaml


ROOT = Path(__file__).resolve().parents[2]
SKILLS = ROOT / "chronos" / "skills"


class LocalLinks(HTMLParser):
    def __init__(self, document):
        super().__init__()
        self.document = document
        self.errors = []

    def handle_starttag(self, tag, attrs):
        attr = {"a": "href", "img": "src"}.get(tag)
        if not attr:
            return
        url = dict(attrs).get(attr)
        if not url:
            return
        parsed = urlsplit(url)
        if parsed.scheme in ("http", "https", "mailto", "data") or parsed.netloc:
            return
        if not parsed.path and not parsed.scheme:
            return
        path = unquote(parsed.path)
        base = ROOT if path.startswith("/") else self.document.parent
        target = (base / path.lstrip("/")).resolve()
        if parsed.scheme or not target.is_relative_to(ROOT) or not target.exists():
            self.errors.append(f"missing or outside repository: {url}")


def validate_skill(folder):
    entry = folder / "SKILL.md"
    if not entry.is_file():
        return ["missing SKILL.md"]
    lines = entry.read_text(encoding="utf-8-sig").splitlines()
    if not lines or lines[0] != "---" or "---" not in lines[1:]:
        return ["expected YAML frontmatter enclosed by ---"]
    end = lines.index("---", 1)
    try:
        metadata = yaml.safe_load("\n".join(lines[1:end]))
    except yaml.YAMLError as error:
        return [f"invalid YAML: {error}"]
    if not isinstance(metadata, dict):
        return ["frontmatter must be a mapping"]

    errors = []
    if metadata.get("name") != folder.name:
        errors.append(f"name must be {folder.name}")
    description = metadata.get("description")
    if not isinstance(description, str) or not description.strip() or len(description) >= 1024:
        errors.append("description must be nonblank and shorter than 1024 characters")
    for document in sorted(folder.rglob("*.md")):
        body = "\n".join(lines[end + 1:]) if document == entry else document.read_text(encoding="utf-8-sig")
        links = LocalLinks(document)
        links.feed(markdown.markdown(body, extensions=["fenced_code", "tables"]))
        errors.extend(f"{document.relative_to(folder)}: {error}" for error in links.errors)
    return errors


def main():
    folders = sorted(path for path in SKILLS.iterdir() if path.is_dir())
    if not folders:
        sys.exit("No skills found")
    errors = [f"{folder.name}: {error}" for folder in folders for error in validate_skill(folder)]
    if errors:
        sys.exit("\n".join(errors))
    print(f"Validated {len(folders)} skills, metadata and local Markdown links.")


if __name__ == "__main__":
    main()
