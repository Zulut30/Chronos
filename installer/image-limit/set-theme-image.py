"""Embed a local image into an Olympus theme without resampling or re-encoding."""
import argparse
import base64
import json
import os
import pathlib
import re
import subprocess
from PIL import Image

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--theme', default='olympus-day', help='Published theme id')
parser.add_argument('--image', type=pathlib.Path, required=True)
parser.add_argument('--variable', default='--i', help='CSS image variable to replace')
parser.add_argument('--output', type=pathlib.Path)
parser.add_argument('--publish', action='store_true', help='Publish and activate the result')
args = parser.parse_args()
if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,47}', args.theme):
    parser.error('Invalid theme id')
if not re.fullmatch(r'--[A-Za-z][A-Za-z0-9_-]{0,63}', args.variable):
    parser.error('Invalid CSS variable')

task_home = pathlib.Path(r'C:\Users\zulut\.t3')
patch_home = task_home / 'caches' / 't3-customizations' / 'olympus-images-20261116'
manifest = json.loads((patch_home / 'patch-manifest.json').read_text(encoding='utf8'))
archive = pathlib.Path(manifest['originalArchive'])
import hashlib
with archive.open('rb') as file:
    installed_hash = hashlib.file_digest(file, 'sha256').hexdigest()
if installed_hash != manifest['patchedSha256']:
    parser.error('The local T3 patch is absent or the app was updated. Recheck the installed limit first.')

theme_file = task_home / 'userdata' / 'themes' / (args.theme + '.json')
theme = json.loads(theme_file.read_text(encoding='utf8'))
raw = args.image.read_bytes()
with Image.open(args.image) as image:
    mime = Image.MIME.get(image.format)
    dimensions = (image.width, image.height)
if mime not in {'image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif'}:
    parser.error('Use PNG, JPEG, WebP, AVIF or GIF')
url = 'url("data:' + mime + ';base64,' + base64.b64encode(raw).decode('ascii') + '")'
pattern = re.compile(re.escape(args.variable) + r'\s*:\s*url\((?:"[^"\n]*"|\x27[^\x27\n]*\x27|[^)]*)\)')
css, count = pattern.subn(lambda _: args.variable + ':' + url, theme.get('css', ''), count=1)
if not count:
    parser.error(f'{args.variable} is not present in this theme')
units = len(css.encode('utf-16-le')) // 2
if units > manifest['cssMaxCharacters']:
    parser.error(f'Image is too large for the remaining CSS budget: {units:,} / {manifest["cssMaxCharacters"]:,} characters')
theme['css'] = css
target = args.output or patch_home / 'generated' / (args.theme + '-with-image.json')
target.parent.mkdir(parents=True, exist_ok=True)
temporary = target.with_suffix('.pending')
temporary.write_text(json.dumps(theme, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
temporary.replace(target)
print(json.dumps({'file': str(target), 'imageBytes': len(raw), 'dimensions': dimensions, 'cssCharacters': units, 'limit': manifest['cssMaxCharacters']}, ensure_ascii=True))
if args.publish:
    executable = archive.parent.parent / 'T3 Code (Nightly).exe'
    environment = dict(os.environ)
    environment['ELECTRON_RUN_AS_NODE'] = '1'
    subprocess.run([str(executable), str(archive) + r'\apps\server\dist\bin.mjs',
                    'theme', 'set', str(target), '--id', args.theme], env=environment, check=True)
