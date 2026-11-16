"""Stage server.asar with a Day / night button in the sidebar footer (on top of the image-limit patch)."""
import copy
import hashlib
import json
import pathlib
import struct
import re
import subprocess
import tempfile

RESOURCE = pathlib.Path(r'C:\Users\zulut\AppData\Local\Programs\t3code\resources')
ARCHIVE = RESOURCE / 'server.asar'
V1 = pathlib.Path(r'C:\Users\zulut\.t3\caches\t3-customizations\olympus-images-20261116')
HERE = pathlib.Path(__file__).parent
TARGET = '/apps/server/dist/client/assets/main-lxHaZZx7.js'
ANCHOR = 'P=(0,Z.jsxs)(`div`,{className:`flex shrink-0 items-center`,children:[A,N]})'
ICON = ('(0,Z.jsxs)(`span`,{className:`olympus-mode-icon`,children:[(0,Z.jsx)(de,{className:`olympus-moon`}),'
        '(0,Z.jsx)(fe,{className:`olympus-sun`}),(0,Z.jsx)(`style`,{children:'
        '`.olympus-mode-icon{display:inline-flex}.olympus-mode-icon svg{width:16px;height:16px}.olympus-sun{display:none}.dark .olympus-sun{display:block}.dark .olympus-moon{display:none}`})]})')
TOGGLE = '()=>{let{resolvedTheme:__olyR}=uc();oc(__olyR===`dark`?`light`:`dark`)||K2()}'
REPLACEMENT = 'P=(0,Z.jsxs)(`div`,{className:`flex shrink-0 items-center`,children:[A,N,(0,Z.jsx)(_B,{label:`День / ночь`,onClick:' + TOGGLE + ',children:' + ICON + '})]})'


def digest_file(path):
    with path.open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def read_header(file):
    size_size, size, header_size, json_size = struct.unpack('<4I', file.read(16))
    assert size_size == 4 and header_size + 4 == size
    return json.loads(file.read(json_size)), 8 + size


def files(tree, prefix=''):
    for name, node in tree.get('files', {}).items():
        path = prefix + '/' + name
        if 'files' in node:
            yield from files(node, path)
        else:
            yield path, node


def integrity(data, block_size):
    return {'algorithm': 'SHA256', 'hash': hashlib.sha256(data).hexdigest(), 'blockSize': block_size,
            'blocks': [hashlib.sha256(data[i:i + block_size]).hexdigest() for i in range(0, len(data), block_size)]
            or [hashlib.sha256(b'').hexdigest()]}


v1 = json.loads((V1 / 'patch-manifest.json').read_text(encoding='utf8'))
installed = digest_file(ARCHIVE)
BASE = V1 / 'server.asar'  # always rebuild from the verified image-limit build
assert digest_file(BASE) == v1['patchedSha256'], 'Base archive changed; stop.'
staging = HERE / 'server.asar'

with BASE.open('rb') as source:
    original_tree, body = read_header(source)
    tree = copy.deepcopy(original_tree)
    original_entries = dict(files(original_tree))
    node = original_entries[TARGET]
    source.seek(body + int(node['offset']))
    old_data = source.read(node['size'])
    text = old_data.decode('utf8')
    assert text.count(ANCHOR) == 1, 'Anchor changed; T3 build differs.'
    for name in ('uc', 'oc', 'fe', 'de', 'K2', '_B'):
        assert (f' as {name}' in text[:200000]) or (f'function {name}(' in text), name
    new_data = text.replace(ANCHOR, REPLACEMENT).encode('utf8')

    # Russian UI: replace keyed template literals (see ru-l10n/extract.py) in every client asset.
    MAPS = json.loads((HERE.parent / 'ru-l10n' / 'ru-final.json').read_text(encoding='utf8'))
    PRESENTATIONAL = {'children', 'placeholder', '"aria-label"', 'ariaLabel', 'tooltip', 'description', 'heading', 'subtitle', 'hint',
                      'actionLabel', 'confirmLabel', 'cancelLabel', 'buttonLabel', 'helperText', 'emptyText', 'emptyMessage', 'caption', 'alt'}
    KEYS = (r'children|label|title|placeholder|description|tooltip|"aria-label"|text|message|heading|subtitle|hint|'
            r'emptyText|emptyMessage|confirmLabel|cancelLabel|actionLabel|buttonLabel|helperText|detail|summary|caption|ariaLabel|alt')
    BODY = r'(?:[^`$\\]|\$(?!\{)|\$\{[^`{}]*\})*'
    PAT = re.compile(r'(?<![\w$.])(' + KEYS + r'):`(' + BODY + r')`')
    TPL = re.compile(r'`(' + BODY + r')`')
    LOCALE = re.compile(r'/(de|es|fr|ja|ko|pt-BR|ru|zh|en)-[\w-]+\.js$')

    def fit(en, v):
        lead = en[:len(en) - len(en.lstrip())]
        trail = en[len(en.rstrip()):]
        return lead + v.strip() + trail

    def ru_sub(m):
        key, en = m.group(1), m.group(2)
        table = MAPS['presentational'] if key in PRESENTATIONAL else MAPS['label'] if key == 'label' else MAPS['strict']
        v = table.get(en)
        return m.group(1) + ':`' + fit(en, v) + '`' if v else m.group(0)

    def broad_sub(m):
        v = MAPS['broad'].get(m.group(1))
        return '`' + fit(m.group(1), v) + '`' if v else m.group(0)
    # Built-in gt dictionary: default to Russian unless the user picked a language.
    LANG_OLD = 'I9=Lae(Pd().language,navigator.languages,j9,A9)'
    assert text.count(LANG_OLD) == 1
    _rt = json.loads((HERE.parent / 'ru-l10n' / 'runtime-final.json').read_text(encoding='utf8'))
    for extra in sorted((HERE.parent / 'ru-l10n').glob('runtime-extra-*.json')):
        _x = json.loads(extra.read_text(encoding='utf8'))
        _rt['exact'].update(_x.get('exact', {}))
        _rt['patterns'] = _x.get('patterns', []) + _rt['patterns']
    RUNTIME = (HERE.parent / 'ru-l10n' / 'runtime-translator.js').read_text(encoding='utf8').replace(
        '__OLY_RU__', json.dumps(_rt, ensure_ascii=False, separators=(',', ':')))
    new_data = new_data.decode('utf8').replace(LANG_OLD, 'I9=Lae((__l=>!__l||__l===`en`?`ru`:__l)(Pd().language),navigator.languages,j9,A9)').encode('utf8')
    new_data = (new_data.decode('utf8') + chr(10) + RUNTIME).encode('utf8')
    EXTRAS = (HERE.parent / 'ru-l10n' / 'extras.js').read_text(encoding='utf8')
    for feat in sorted((HERE.parent / 'ru-l10n' / 'features').glob('*.js')):
        EXTRAS += chr(10) + feat.read_text(encoding='utf8')
    new_data = (EXTRAS + chr(10) + new_data.decode('utf8')).encode('utf8')
    changed = {TARGET: new_data}
    replaced_total = 0
    for path, n in original_entries.items():
        if not path.startswith('/apps/server/dist/client/assets/') or not path.endswith('.js') or LOCALE.search(path):
            continue
        if path == TARGET:
            body_text = new_data.decode('utf8')
        else:
            source.seek(body + int(n['offset'])); body_text = source.read(n['size']).decode('utf8')
        if 'jsx' not in body_text:
            continue
        if path.endswith('/utils-BTU7ae6Y.js'):
            continue  # core schemas/data: translating here broke terminal init (TDZ); runtime translator covers its UI text
        out = PAT.sub(ru_sub, body_text)
        out = TPL.sub(broad_sub, out)
        if path.endswith('/_chat-CZ9dvfEY.js'):
            n_plan = out.count('interactionMode:$t') - out.count('runtimeMode:v,interactionMode:$t}});e._tag')
            out = out.replace('interactionMode:$t', 'interactionMode:(globalThis.__olyPlan===!0?`plan`:$t)')
            out = out.replace("text:`/compact`,attachments:[],idleCompaction:`onReturn`},modelSelection:rt,runtimeMode:v,interactionMode:(globalThis.__olyPlan===!0?`plan`:$t)", "text:`/compact`,attachments:[],idleCompaction:`onReturn`},modelSelection:rt,runtimeMode:v,interactionMode:$t")
            assert out.count('globalThis.__olyPlan') == 9, out.count('globalThis.__olyPlan')
        if out != body_text:
            changed[path] = out.encode('utf8'); replaced_total += 1
    check_dir = pathlib.Path(tempfile.mkdtemp(prefix='t3ru-'))
    for path, data in changed.items():
        f = check_dir / (pathlib.Path(path).stem + '.mjs'); f.write_bytes(data)
        r = subprocess.run(['node', '--check', str(f)], capture_output=True, text=True)
        assert r.returncode == 0, (path, r.stderr[:500])
    print('translated files', replaced_total, 'syntax-checked', len(changed))

    packed = [(p, n) for p, n in files(tree) if 'offset' in n and not n.get('unpacked')]
    packed.sort(key=lambda e: int(original_entries[e[0]]['offset']))
    position = 0
    for path, n in packed:
        n['offset'] = str(position)
        if path in changed:
            n['size'] = len(changed[path])
            if 'integrity' in n:
                n['integrity'] = integrity(changed[path], n['integrity'].get('blockSize', 4194304))
        position += n['size']
    header = json.dumps(tree, ensure_ascii=False, separators=(',', ':')).encode('utf8')
    padded = (4 + len(header) + 3) // 4 * 4
    pickle = struct.pack('<II', padded, len(header)) + header + b'\0' * (padded - 4 - len(header))
    with staging.open('wb') as out:
        out.write(struct.pack('<II', 4, len(pickle)) + pickle)
        for path, n in packed:
            if path in changed:
                out.write(changed[path])
                continue
            old = original_entries[path]
            source.seek(body + int(old['offset']))
            remaining = old['size']
            while remaining:
                chunk = source.read(min(remaining, 1 << 20))
                assert chunk, path
                out.write(chunk)
                remaining -= len(chunk)

# Verify every packed file against the installed archive.
with staging.open('rb') as cand, BASE.open('rb') as orig:
    staged_tree, staged_body = read_header(cand)
    total = 0
    for path, n in files(staged_tree):
        if 'offset' not in n or n.get('unpacked'):
            continue
        cand.seek(staged_body + int(n['offset']))
        data = cand.read(n['size'])
        assert len(data) == n['size'], path
        if 'integrity' in n:
            assert integrity(data, n['integrity']['blockSize']) == n['integrity'], path
        if path in changed:
            assert data == changed[path]
        else:
            old = original_entries[path]
            orig.seek(body + int(old['offset']))
            assert data == orig.read(old['size']), path
        total += 1

manifest = {
    'version': v1['version'], 'originalArchive': str(ARCHIVE), 'stagedArchive': str(staging),
    'installedBeforeSha256': installed, 'patchedSha256': digest_file(staging),
    'pristineBackup': v1['backup'], 'pristineSha256': v1['originalSha256'],
    'imageLimitArchive': str(V1 / 'server.asar'), 'imageLimitSha256': v1['patchedSha256'],
    'verifiedPackedFiles': total,
    'files': [{'path': TARGET, 'changes': ['Day / night toggle in the sidebar row above the thread list', 'Russian UI strings']}]
             + [{'path': p, 'changes': ['Russian UI strings']} for p in changed if p != TARGET],
}
(HERE / 'patch-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf8')
(HERE / 'main-patched.js').write_bytes(new_data)
print(json.dumps(manifest, indent=2))
