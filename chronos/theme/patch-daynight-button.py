"""Stage server.asar with a Day / night button in the sidebar footer (on top of the image-limit patch)."""
import copy
import hashlib
import json
import pathlib
import struct

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
REPLACEMENT = 'P=(0,Z.jsxs)(`div`,{className:`flex shrink-0 items-center`,children:[A,N,(0,Z.jsx)(_B,{label:`Day / night`,onClick:' + TOGGLE + ',children:' + ICON + '})]})'


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
assert installed == v1['patchedSha256'], 'Installed archive is not the verified image-limit build; stop.'
staging = HERE / 'server.asar'

with ARCHIVE.open('rb') as source:
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

    packed = [(p, n) for p, n in files(tree) if 'offset' in n and not n.get('unpacked')]
    packed.sort(key=lambda e: int(original_entries[e[0]]['offset']))
    position = 0
    for path, n in packed:
        n['offset'] = str(position)
        if path == TARGET:
            n['size'] = len(new_data)
            if 'integrity' in n:
                n['integrity'] = integrity(new_data, n['integrity'].get('blockSize', 4194304))
        position += n['size']
    header = json.dumps(tree, ensure_ascii=False, separators=(',', ':')).encode('utf8')
    padded = (4 + len(header) + 3) // 4 * 4
    pickle = struct.pack('<II', padded, len(header)) + header + b'\0' * (padded - 4 - len(header))
    with staging.open('wb') as out:
        out.write(struct.pack('<II', 4, len(pickle)) + pickle)
        for path, n in packed:
            if path == TARGET:
                out.write(new_data)
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
with staging.open('rb') as cand, ARCHIVE.open('rb') as orig:
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
        if path == TARGET:
            assert data == new_data
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
    'files': [{'path': TARGET, 'changes': ['Day / night toggle in the sidebar row above the thread list'],
               'oldSha256': hashlib.sha256(old_data).hexdigest(), 'newSha256': hashlib.sha256(new_data).hexdigest()}],
}
(HERE / 'patch-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf8')
(HERE / 'main-patched.js').write_bytes(new_data)
print(json.dumps(manifest, indent=2))
