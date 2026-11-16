"""Prepare a reversible, version-checked patch of T3's bundled theme limits."""
import copy
import hashlib
import json
import pathlib
import re
import shutil
import struct

RESOURCE = pathlib.Path(r'C:\Users\zulut\AppData\Local\Programs\t3code\resources')
ARCHIVE = RESOURCE / 'server.asar'
PATCH = pathlib.Path(r'C:\Users\zulut\.t3\caches\t3-customizations\olympus-images-20261116')
CSS_LIMIT = 4 * 1024 * 1024
OLD_GUIDE = 'A background image must be embedded as a data: address. `css` holds 50,000 characters, so keep the image near 30 KB.'
NEW_GUIDE = 'Local Olympus patch: embed images as data: addresses. CSS accepts 4,194,304 characters (about 3 MiB of image bytes minus other CSS). External files remain blocked.'


def digest_file(path):
    with path.open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def read_header(file):
    first = file.read(16)
    size_size, size, header_size, json_size = struct.unpack('<4I', first)
    assert size_size == 4 and header_size + 4 == size
    data = json.loads(file.read(json_size))
    return data, 8 + size


def files(tree, prefix=''):
    for name, node in tree.get('files', {}).items():
        path = prefix + '/' + name
        if 'files' in node:
            yield from files(node, path)
        else:
            yield path, node


def integrity(data, block_size):
    return {
        'algorithm': 'SHA256',
        'hash': hashlib.sha256(data).hexdigest(),
        'blockSize': block_size,
        'blocks': [hashlib.sha256(data[i:i + block_size]).hexdigest()
                   for i in range(0, len(data), block_size)] or [hashlib.sha256(b'').hexdigest()],
    }


PATCH.mkdir(parents=True, exist_ok=True)
backup = PATCH / 'server.original.asar'
if not backup.exists():
    shutil.copy2(ARCHIVE, backup)
assert digest_file(ARCHIVE) == digest_file(backup), 'Installed archive changed; inspect before patching.'

with ARCHIVE.open('rb') as source:
    original_tree, body_offset = read_header(source)
    tree = copy.deepcopy(original_tree)
    changed = {}
    checks = {'server_limit': 0, 'client_palette_limit': 0, 'client_contract_limit': 0, 'guide': 0}
    original_entries = dict(files(original_tree))
    for path, node in files(tree):
        if 'offset' not in node or '/node_modules/' in path or not path.endswith(('.js', '.mjs')):
            continue
        source.seek(body_offset + int(node['offset']))
        data = source.read(node['size'])
        text = data.decode('utf8')
        revised = text
        replacements = []
        if path.endswith('/ManagedEndpointRuntime--5XAAKR8.mjs'):
            old = 'const THEME_CSS_MAX_LENGTH = 5e4;'
            assert revised.count(old) == 1
            revised = revised.replace(old, f'const THEME_CSS_MAX_LENGTH = {CSS_LIMIT};')
            checks['server_limit'] += 1
            replacements.append('Shared server ThemeFile/EnvironmentTheme schema limit')
        elif path.endswith('/client/assets/themePalette-BrFetdG-.js'):
            old = 'function Ji(e){return typeof e==`string`&&e.length<=5e4}'
            assert revised.count(old) == 1
            revised = revised.replace(old, f'function Ji(e){{return typeof e==`string`&&e.length<={CSS_LIMIT}}}')
            checks['client_palette_limit'] += 1
            replacements.append('Client import/storage/palette CSS validation')
        elif path.endswith('/client/assets/utils-BTU7ae6Y.js'):
            old = 'Vz=5e4,Hz={version:j(M(1))'
            assert revised.count(old) == 1
            revised = revised.replace(old, f'Vz={CSS_LIMIT},Hz={{version:j(M(1))')
            checks['client_contract_limit'] += 1
            replacements.append('Client environment schema CSS validation')
        if path.endswith(('/client/assets/themePalette-BrFetdG-.js', '/relayTracing-CeJ93I6Y.mjs')):
            assert revised.count(OLD_GUIDE) == 1
            revised = revised.replace(OLD_GUIDE, NEW_GUIDE)
            checks['guide'] += 1
            replacements.append('Theme tool guide limit description')
        if revised != text:
            changed[path] = (revised.encode('utf8'), replacements)
    assert checks == {'server_limit': 1, 'client_palette_limit': 1, 'client_contract_limit': 1, 'guide': 2}, checks
    assert len(changed) == 4

    # Keep every directory, symlink, unpacked flag and integrity record. Recompute only
    # changed file hashes; relocate packed offsets in their original physical order.
    packed = [(path, node) for path, node in files(tree) if 'offset' in node and not node.get('unpacked')]
    packed.sort(key=lambda entry: int(original_entries[entry[0]]['offset']))
    position = 0
    manifest = []
    for path, node in packed:
        old = original_entries[path]
        node['offset'] = str(position)
        if path in changed:
            data, reasons = changed[path]
            source.seek(body_offset + int(old['offset']))
            old_data = source.read(old['size'])
            node['size'] = len(data)
            if 'integrity' in node:
                node['integrity'] = integrity(data, node['integrity'].get('blockSize', 4194304))
            manifest.append({'path': path, 'changes': reasons, 'oldSha256': hashlib.sha256(old_data).hexdigest(), 'newSha256': hashlib.sha256(data).hexdigest()})
        position += node['size']

    json_header = json.dumps(tree, ensure_ascii=False, separators=(',', ':')).encode('utf8')
    padded_size = (4 + len(json_header) + 3) // 4 * 4
    header_pickle = struct.pack('<II', padded_size, len(json_header)) + json_header + b'\0' * (padded_size - 4 - len(json_header))
    archive_prefix = struct.pack('<II', 4, len(header_pickle)) + header_pickle
    staging = PATCH / 'server.asar'
    with staging.open('wb') as output:
        output.write(archive_prefix)
        for path, node in packed:
            if path in changed:
                output.write(changed[path][0])
            else:
                old = original_entries[path]
                source.seek(body_offset + int(old['offset']))
                remaining = old['size']
                while remaining:
                    chunk = source.read(min(remaining, 1024 * 1024))
                    assert chunk, path
                    output.write(chunk)
                    remaining -= len(chunk)

# Verify every packed file, not only the four modified bundles.
with staging.open('rb') as candidate, ARCHIVE.open('rb') as original:
    staged_tree, staged_offset = read_header(candidate)
    total = 0
    for path, node in files(staged_tree):
        if 'offset' not in node or node.get('unpacked'):
            continue
        candidate.seek(staged_offset + int(node['offset']))
        data = candidate.read(node['size'])
        assert len(data) == node['size'], path
        if 'integrity' in node:
            assert integrity(data, node['integrity']['blockSize']) == node['integrity'], path
        if path not in changed:
            old = original_entries[path]
            original.seek(body_offset + int(old['offset']))
            assert data == original.read(old['size']), path
        total += 1

# Native files stay outside asar; stage copies for the isolated CLI checks.
unpacked = pathlib.Path(str(ARCHIVE) + '.unpacked')
if unpacked.exists():
    shutil.copytree(unpacked, pathlib.Path(str(staging) + '.unpacked'), dirs_exist_ok=True)
report = {'version': '0.1.10-nightly.20261116.4774', 'cssMaxCharacters': CSS_LIMIT,
          'originalArchive': str(ARCHIVE), 'backup': str(backup), 'stagedArchive': str(staging),
          'originalSha256': digest_file(backup), 'patchedSha256': digest_file(staging),
          'verifiedPackedFiles': total, 'files': manifest, 'remoteFilePolicyChanged': False}
(PATCH / 'patch-manifest.json').write_text(json.dumps(report, indent=2), encoding='utf8')
print(json.dumps(report, indent=2))
