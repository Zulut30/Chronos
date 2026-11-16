import collections
import json
import random
import re

PH = re.compile(r'\$\{[^}]*\}')
src = list(json.load(open('strings.json', encoding='utf8')))
ru = {}
for i in range(1, 7):
    ru.update(json.load(open(f'chunks/part{i}.ru.json', encoding='utf8')))
bad = []
for t in src:
    v = ru.get(t)
    if (not v or '`' in v or chr(92) in v or v.count('${') != t.count('${')
            or collections.Counter(PH.findall(t)) != collections.Counter(PH.findall(v))):
        bad.append(t)
same = sum(1 for t in src if ru.get(t) == t)
print('total', len(src), 'bad', len(bad), 'unchanged', same, bad[:5])
json.dump({t: ru[t] for t in src if t not in bad}, open('ru.json', 'w', encoding='utf8'), ensure_ascii=False, indent=0)
r = random.Random(11)
for t in r.sample(src, 25):
    print(repr(t), '=>', repr(ru.get(t)))
