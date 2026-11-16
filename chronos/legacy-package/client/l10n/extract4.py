"""Third pass: map still-visible English UI strings back to the template literals that produce them."""
import glob
import json
import pathlib
import re
import sys

SRC = pathlib.Path(sys.argv[1])
HERE = pathlib.Path(__file__).parent
visible = json.load(open(sys.argv[2], encoding='utf8'))
visible = [re.sub(r'^@(aria-label|placeholder|title): ', '', v) for v in visible]
final = json.load(open(HERE / 'ru-final.json', encoding='utf8'))
have = set().union(*[set(v) for v in final.values()])
LOCALE = re.compile(r'^(de|es|fr|ja|ko|pt-BR|ru|zh|en)-[\w-]+\.js$')
BODY = r'(?:[^`$\\]|\$(?!\{)|\$\{[^`{}]*\})*'
TPL = re.compile(r'`(' + BODY + r')`')
CMP = re.compile(r'(?:[!=]==?|case ?|\[|includes\(|startsWith\(|endsWith\(|has\(|get\(|indexOf\()`([^`$\\]*)`'
                 r'|`([^`$\\]*)`(?:\s*[!=]==?|:(?!`))')
lits, used = set(), set()
for fn in sorted(glob.glob(str(SRC / '*.js'))):
    name = pathlib.Path(fn).name
    if LOCALE.match(name):
        continue
    s = open(fn, encoding='utf8').read()
    if 'jsx' not in s:
        continue
    for m in TPL.finditer(s):
        t = m.group(1)
        if re.search(r'[A-Za-z]{2}', re.sub(r'\$\{[^}]*\}', '', t)) and len(t) < 300:
            lits.add(t)
    for m in CMP.finditer(s):
        used.add(m.group(1) if m.group(1) is not None else m.group(2))
server = set(json.load(open(HERE / 'server-literals.json', encoding='utf8'))) if (HERE / 'server-literals.json').exists() else set()


def rx(t):
    parts = re.split(r'\$\{[^}]*\}', t)
    return re.compile('^' + '(.+?)'.join(re.escape(p) for p in parts) + '$', re.S)


found = {}
templ = [(t, rx(t)) for t in lits if '${' in t]
exact = {t for t in lits if '${' not in t}
for v in visible:
    if v in exact:
        found.setdefault(v, set()).add(v)
        continue
    for t, r in templ:
        static = re.sub(r'\$\{[^}]*\}', '', t)
        if len(re.findall(r'[A-Za-z]{2,}', static)) and r.match(v):
            found.setdefault(v, set()).add(t)
cands = set().union(*found.values()) if found else set()
todo = sorted(t for t in cands if t not in have and t not in used)
blocked = sorted(t for t in cands if t in used and t not in have)
json.dump(todo, open(HERE / 'visible.en.json', 'w', encoding='utf8'), ensure_ascii=False, indent=0)
print('visible', len(visible), 'mapped', len(found), 'literal candidates', len(cands), 'to translate', len(todo), 'blocked(compared)', len(blocked))
print('BLOCKED', blocked[:60])
print('UNMAPPED', [v for v in visible if v not in found][:80])
