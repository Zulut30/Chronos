import glob, json, pathlib, re, sys
SRC = pathlib.Path(sys.argv[1])
ru = json.load(open('ru.json', encoding='utf8'))
unsafe = json.load(open('unsafe.json', encoding='utf8'))
LOCALE = re.compile(r'^(de|es|fr|ja|ko|pt-BR|ru|zh|en)-[\w-]+\.js$')
ARR = re.compile(r'(?<=[\[,])`([^`$\]*[A-Za-z]{2}[^`$\]*)`(?=,\(0,[\w$]+\.jsxs?\)|\]\})')
ARR2 = re.compile(r'(?<=\]\}\),)`([^`$\]*[A-Za-z]{2}[^`$\]*)`(?=[,\]])')
found = set()
for f in sorted(glob.glob(str(SRC / '*.js'))):
    name = pathlib.Path(f).name
    if LOCALE.match(name): continue
    s = open(f, encoding='utf8').read()
    if 'jsx' not in s: continue
    for m in ARR.finditer(s): found.add(m.group(1))
    for m in ARR2.finditer(s): found.add(m.group(1))
found = {t for t in found if t.strip() and not re.fullmatch(r'[\w./:@#+-]+', t.strip()) or re.match(r'\s*[A-Z][a-z]+\s*$', t)}
new = sorted((found | set(unsafe)) - set(ru))
json.dump(new, open('extra.en.json', 'w', encoding='utf8'), ensure_ascii=False, indent=0)
print('array literals', len(found), 'extra to translate', len(new))
print(new[:40])
