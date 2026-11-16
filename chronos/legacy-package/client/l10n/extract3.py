"""Second pass: server-literal blocklist, unsafe presentational strings, broad multi-word literals."""
import glob
import json
import pathlib
import re
import struct
import sys

SRC = pathlib.Path(sys.argv[1])
ARCHIVE = r'C:\Users\zulut\AppData\Local\Programs\t3code\resources\server.asar'
HERE = pathlib.Path(__file__).parent
ru = json.load(open(HERE / 'ru.json', encoding='utf8'))
unsafe = json.load(open(HERE / 'unsafe.json', encoding='utf8'))

# 1) every string literal in server code = data contract -> never translate
server = set()
LIT = re.compile(r'"((?:[^"\\\n]|\\.){2,300})"|\'((?:[^\'\\\n]|\\.){2,300})\'|`([^`$\\]{2,300})`')
with open(ARCHIVE, 'rb') as f:
    _, b, _, d = struct.unpack('<4I', f.read(16))
    tree = json.loads(f.read(d))
    body = 8 + b

    def walk(t, q=''):
        for k, v in t.get('files', {}).items():
            r = q + '/' + k
            if 'files' in v:
                yield from walk(v, r)
            else:
                yield r, v
    for r, v in walk(tree):
        if r.startswith('/apps/server/dist/') and '/client/' not in r and r.endswith(('.mjs', '.js')) and 'offset' in v and not v.get('unpacked'):
            f.seek(body + int(v['offset']))
            s = f.read(v['size']).decode('utf8', 'ignore')
            for m in LIT.finditer(s):
                server.add(next(g for g in m.groups() if g is not None))
print('server literals', len(server))

# 2) broad literals in client JSX bundles
LOCALE = re.compile(r'^(de|es|fr|ja|ko|pt-BR|ru|zh|en)-[\w-]+\.js$')
BODY = r'(?:[^`$\\]|\$(?!\{)|\$\{[^`{}]*\})*'
TPL = re.compile(r'`(' + BODY + r')`')
CMP = re.compile(r'(?:[!=]==?|case ?|\[|includes\(|startsWith\(|endsWith\(|has\(|get\(|indexOf\()`([^`$\\]*)`'
                 r'|`([^`$\\]*)`(?:\s*[!=]==?|:(?!`))')


def sentence(t):
    bare = re.sub(r'\$\{[^}]*\}', 'X', t).strip()
    if len(bare) > 200 or ' ' not in bare or not re.match(r'[A-Z][a-z\']', bare):
        return False
    if re.search(r'[{};=<>|]|&&|\.jsx|className|\bvar\b|\bfunction\b|=>', re.sub(r'\$\{[^}]*\}', '', t)):
        return False
    if re.search(r'(^|\s)[a-z0-9!]+(-[a-z0-9\[\]./%]+){1,}(\s|$)', bare) and re.search(r'\b(flex|size|text|bg|px|py|w|h|gap|border|rounded)-', bare):
        return False
    return True


broad, used = set(), set()
for fn in sorted(glob.glob(str(SRC / '*.js'))):
    name = pathlib.Path(fn).name
    if LOCALE.match(name):
        continue
    s = open(fn, encoding='utf8').read()
    if 'jsx' not in s:
        continue
    for m in TPL.finditer(s):
        if sentence(m.group(1)):
            broad.add(m.group(1))
    for m in CMP.finditer(s):
        used.add(m.group(1) if m.group(1) is not None else m.group(2))

blocked_first_pass = sorted(t for t in ru if t in server)
todo_unsafe = sorted(t for t in unsafe if t not in server)
todo_broad = sorted(t for t in broad if t not in ru and t not in used and t not in server and t not in unsafe)
json.dump(blocked_first_pass, open(HERE / 'blocked-server.json', 'w', encoding='utf8'), ensure_ascii=False, indent=0)
json.dump(todo_unsafe, open(HERE / 'unsafe-presentational.en.json', 'w', encoding='utf8'), ensure_ascii=False, indent=0)
json.dump(todo_broad, open(HERE / 'broad.en.json', 'w', encoding='utf8'), ensure_ascii=False, indent=0)
print('first-pass strings now blocked (server data):', len(blocked_first_pass), blocked_first_pass[:25])
print('unsafe for presentational keys:', len(todo_unsafe))
print('broad new:', len(todo_broad), 'chars', sum(map(len, todo_broad)))
print(todo_broad[:30])
