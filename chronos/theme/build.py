"""Build the combined Olympus theme (day = light, night = dark) from sources in this folder."""
import base64
import json
import math
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent
LIGHT, DARK = ':root:not(.dark)', ':root.dark'


def split_top(text, sep):
    parts, depth, quote, cur = [], 0, None, ''
    for ch in text:
        if quote:
            cur += ch
            if ch == quote:
                quote = None
            continue
        if ch in '"\'':
            quote = ch
        elif ch in '([':
            depth += 1
        elif ch in ')]':
            depth -= 1
        if ch == sep and depth == 0:
            parts.append(cur)
            cur = ''
        else:
            cur += ch
    parts.append(cur)
    return parts


def blocks(css):
    """Yield (prelude, body) for top-level blocks; comments dropped."""
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    i, n = 0, len(css)
    while i < n:
        j = css.find('{', i)
        if j < 0:
            break
        prelude = css[i:j].strip()
        depth, k, quote = 0, j, None
        while k < n:
            ch = css[k]
            if quote:
                if ch == quote:
                    quote = None
            elif ch in '"\'':
                quote = ch
            elif ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    break
            k += 1
        yield prelude, css[j + 1:k]
        i = k + 1


def scope(css, root):
    out = []
    for prelude, body in blocks(css):
        if prelude.startswith('@'):
            out.append(prelude + '{' + scope(body, root) + '}')
            continue
        sels = []
        for sel in split_top(prelude, ','):
            sel = sel.strip()
            sels.append(root + sel[5:] if sel.startswith(':root') else root + ' ' + sel)
        out.append(','.join(sels) + '{' + body.strip() + '}')
    return '\n'.join(out)


def data_uri(path, mime):
    return 'data:' + mime + ';base64,' + base64.b64encode(path.read_bytes()).decode('ascii')


def svg(text):
    text = re.sub(r'\s+', ' ', text.strip()).replace('#', '%23').replace('"', "'")
    return 'url("data:image/svg+xml,' + text + '")'


def laurel(color, opacity):
    """Wreath open at the top; two branches rise from crossed stems at the bottom."""
    r, parts = 80, []
    for mirror in (1, -1):
        for k in range(12):
            th = math.radians(252 - k * 12.5)
            px, py = r * math.cos(th), -r * math.sin(th)
            tx, ty = math.sin(th), math.cos(th)        # growth direction (svg coords)
            nx, ny = math.cos(th), -math.sin(th)       # outward normal
            base = math.degrees(math.atan2(ty, tx))
            size = 1 - k * 0.035
            for side, turn in ((1, -32), (-1, 32)):
                cx = px + nx * side * 8 * size + tx * 3
                cy = py + ny * side * 8 * size + ty * 3
                a = base + turn
                if mirror < 0:
                    cx, a = -cx, 180 - a
                parts.append(f"<ellipse cx='{cx:.1f}' cy='{cy:.1f}' rx='{10 * size:.1f}' ry='{3.8 * size:.1f}' transform='rotate({a:.1f} {cx:.1f} {cy:.1f})'/>")
        th0, th1 = math.radians(258), math.radians(108)
        x0, y0 = mirror * r * math.cos(th0), -r * math.sin(th0)
        x1, y1 = mirror * r * math.cos(th1), -r * math.sin(th1)
        sweep = 1 if mirror > 0 else 0
        parts.append(f"<path d='M{x0 + mirror * 14:.1f} {y0 + 12:.1f} L{x0:.1f} {y0:.1f} A{r} {r} 0 0 {sweep} {x1:.1f} {y1:.1f}' fill='none' stroke-width='2'/>")
    return svg(f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='-110 -110 220 220'><g fill='{color}' stroke='{color}' opacity='{opacity}'>"
               + ''.join(parts) + "</g></svg>")


def main():
    day_meta = json.loads((ROOT / 'day.meta.json').read_text(encoding='utf8'))
    night_meta = json.loads((ROOT / 'night.meta.json').read_text(encoding='utf8'))
    day_imgs = json.loads((ROOT / 'day.imgs.json').read_text())
    night_imgs = json.loads((ROOT / 'night.imgs.json').read_text())
    day = (ROOT / 'day.src.css').read_text(encoding='utf8')
    night = (ROOT / 'night.src.css').read_text(encoding='utf8')
    for k, v in night_imgs.items():
        night = night.replace(k, v)
    day = day.replace('--i:url("@@IMG0@@");', '')
    assert '@@' not in day and '@@' not in night
    day += '\n' + (ROOT / 'day.add.css').read_text(encoding='utf8')
    night += '\n' + (ROOT / 'night.add.css').read_text(encoding='utf8')
    for f in sorted((ROOT / 'feature-css').glob('*.day.css')):
        day += '\n' + f.read_text(encoding='utf8')
    for f in sorted((ROOT / 'feature-css').glob('*.night.css')):
        night += '\n' + f.read_text(encoding='utf8')
    shared = (ROOT / 'shared.css').read_text(encoding='utf8')
    tokens = {
        '@@APOLLO@@': 'url("' + data_uri(ROOT / 'apollo-1700.webp', 'image/webp') + '")',
        '@@LAUREL_DAY@@': laurel('#1952C5', .11),
        '@@LAUREL_NIGHT@@': laurel('#E3BF5C', .09),
    }
    for name in ('halo', 'grain', 'meander', 'meander-v', 'meander-v-gold', 'grain-dark', 'motes-day-a', 'motes-day-b', 'motes-night-a', 'motes-night-b'):
        tokens['@@' + name.upper().replace('-', '_') + '@@'] = svg((ROOT / 'svg' / (name + '.svg')).read_text(encoding='utf8'))
    css = shared + '\n' + scope(day, LIGHT) + '\n' + scope(night, DARK) + '\n'
    for k, v in tokens.items():
        css = css.replace(k, v)
    assert '@@' not in css, re.findall(r'@@\w+@@', css)
    assert '\\' not in css
    theme = {
        'version': 1,
        'name': 'Olympus',
        'appearance': 'light',
        'canvas': day_meta['canvas'],
        'accent': day_meta['accent'],
        'colors': day_meta['colors'],
        'variants': {'dark': {'canvas': night_meta['canvas'], **night_meta['colors']}},
        'css': css,
    }
    out = ROOT / 'olympus.json'
    out.write_text(json.dumps(theme, ensure_ascii=False, indent=1) + '\n', encoding='utf8')
    (ROOT / 'olympus.test.css').write_text(css, encoding='utf8')
    print('css chars', len(css), 'limit 4194304')


if __name__ == '__main__':
    main()
