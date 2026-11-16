"""Extract user-facing English literals from T3 client bundles (keyed JSX/props) into strings.json."""
import collections
import glob
import json
import pathlib
import re
import sys

SRC = pathlib.Path(sys.argv[1])
OUT = pathlib.Path(__file__).parent
KEYS = (r'children|label|title|placeholder|description|tooltip|"aria-label"|text|message|heading|subtitle|hint|'
        r'emptyText|emptyMessage|confirmLabel|cancelLabel|actionLabel|buttonLabel|helperText|detail|summary|caption|ariaLabel|alt')
# Template literal body: no backtick, no backslash, ${...} allowed when it has no braces/backticks inside.
BODY = r'(?:[^`$\\]|\$(?!\{)|\$\{[^`{}]*\})*'
PAT = re.compile(r'(?<![\w$.])(' + KEYS + r'):`(' + BODY + r')`')
CMP = re.compile(r'(?:[!=]==?|case ?|\[|includes\(|startsWith\(|endsWith\(|has\(|get\(|indexOf\()`([^`$\\]*)`'
                 r'|`([^`$\\]*)`(?:\s*[!=]==?|:(?!`))')
LOCALE = re.compile(r'^(de|es|fr|ja|ko|pt-BR|ru|zh|en)-[\w-]+\.js$')


def ui_like(t):
    bare = re.sub(r'\$\{[^}]*\}', '', t).strip()
    if not re.search(r'[A-Za-z]{2}', bare):
        return False
    if re.fullmatch(r'[\w./:@#+-]+', bare) and not re.match(r'[A-Z][a-z]', bare):
        return False  # identifiers, paths, ids
    if re.search(r'(^|\s)(flex|size-|text-|bg-|px-|py-|rounded|border-|items-|gap-|w-|h-)', bare):
        return False
    if bare.startswith(('http', '/', './', '--', '.', '#', '<', '{', '[')):
        return False
    return True


def main():
    texts = {}
    strings = collections.OrderedDict()
    for f in sorted(glob.glob(str(SRC / '*.js'))):
        name = pathlib.Path(f).name
        if LOCALE.match(name):
            continue
        s = open(f, encoding='utf8').read()
        if 'jsx' not in s:
            continue
        texts[name] = s
        for m in PAT.finditer(s):
            if ui_like(m.group(2)):
                strings.setdefault(m.group(2), set()).add(name)
    used = set()
    for s in texts.values():
        for m in CMP.finditer(s):
            used.add(m.group(1) if m.group(1) is not None else m.group(2))
    unsafe = sorted(t for t in strings if t in used)
    for t in unsafe:
        strings.pop(t)
    (OUT / 'strings.json').write_text(json.dumps({t: '' for t in strings}, ensure_ascii=False, indent=0), encoding='utf8')
    (OUT / 'unsafe.json').write_text(json.dumps(unsafe, ensure_ascii=False, indent=0), encoding='utf8')
    print('files', len(texts), 'strings', len(strings), 'unsafe dropped', len(unsafe), 'chars', sum(map(len, strings)))


main()
