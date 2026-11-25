#!/usr/bin/env python3
"""Compare two Chronos smoke runs (report.json + 1400x900 PNG screenshots).

Uses only Python standard library and Pillow (compatible with `python -I`).

Usage:
  python -I chronos/scripts/smoke/compare.py <baseline_dir> <current_dir> [--out <diff_dir>]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from PIL import Image, ImageChops, ImageDraw, ImageOps


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def normalize_error(err: dict[str, Any]) -> str:
    kind = err.get("kind", "error")
    text = str(err.get("text", "")).strip()
    url = str(err.get("url", "")).strip()
    return f"[{kind}] {text}" + (f" ({url})" if url else "")


def collect_masks(
    screen_id: str,
    base_screen: dict[str, Any] | None,
    curr_screen: dict[str, Any] | None,
    checks_cfg: dict[str, Any] | None,
    ignore_masks: bool,
) -> list[dict[str, Any]]:
    if ignore_masks:
        return []
    masks: list[dict[str, Any]] = []
    if checks_cfg:
        for m in checks_cfg.get("globalPixelMasks") or []:
            masks.append({**m, "source": "checks.global"})
        for scr in checks_cfg.get("screens") or []:
            if scr.get("id") == screen_id:
                for m in scr.get("pixelMasks") or []:
                    masks.append({**m, "source": "checks.screen"})
                break
    for src_name, scr in (("baseline", base_screen), ("current", curr_screen)):
        if not scr:
            continue
        for m in scr.get("dynamicMasks") or []:
            masks.append({**m, "source": f"{src_name}.dynamic"})
    return masks


def compare_images(
    base_path: Path,
    curr_path: Path,
    diff_out_path: Path | None,
    masks: list[dict[str, Any]],
    channel_threshold: int,
) -> dict[str, Any]:
    with Image.open(base_path) as im_a, Image.open(curr_path) as im_b:
        rgb_a = im_a.convert("RGB")
        rgb_b = im_b.convert("RGB")

    size_a = rgb_a.size
    size_b = rgb_b.size
    size_mismatch = size_a != size_b
    w = max(size_a[0], size_b[0])
    h = max(size_a[1], size_b[1])

    if size_mismatch:
        canvas_a = Image.new("RGB", (w, h), (0, 0, 0))
        canvas_a.paste(rgb_a, (0, 0))
        rgb_a = canvas_a
        canvas_b = Image.new("RGB", (w, h), (0, 0, 0))
        canvas_b.paste(rgb_b, (0, 0))
        rgb_b = canvas_b

    diff_rgb = ImageChops.difference(rgb_a, rgb_b)
    r_ch, g_ch, b_ch = diff_rgb.split()
    max_diff = ImageChops.lighter(ImageChops.lighter(r_ch, g_ch), b_ch)

    mask_img = Image.new("L", (w, h), 0)
    mask_draw = ImageDraw.Draw(mask_img)
    applied_masks: list[dict[str, int]] = []
    for m in masks:
        x = max(0, int(m.get("x", 0)))
        y = max(0, int(m.get("y", 0)))
        mw = int(m.get("width", m.get("w", 0)))
        mh = int(m.get("height", m.get("h", 0)))
        if mw <= 0 or mh <= 0:
            continue
        x2 = min(w, x + mw)
        y2 = min(h, y + mh)
        if x2 > x and y2 > y:
            mask_draw.rectangle([x, y, x2 - 1, y2 - 1], fill=255)
            applied_masks.append({"x": x, "y": y, "width": x2 - x, "height": y2 - y})

    # Zero out masked pixels before thresholding.
    unmasked_diff = ImageChops.subtract(max_diff, mask_img)
    changed_mask = unmasked_diff.point(lambda p: 255 if p > channel_threshold else 0)

    total_pixels = w * h
    masked_pixels = mask_img.histogram()[255]
    compared_pixels = total_pixels - masked_pixels
    changed_pixels = changed_mask.histogram()[255]
    changed_percent = (changed_pixels / compared_pixels * 100.0) if compared_pixels > 0 else 0.0
    changed_bbox = changed_mask.getbbox()

    # Also compute raw unmasked diff ratio for diagnostics.
    raw_changed_mask = max_diff.point(lambda p: 255 if p > channel_threshold else 0)
    raw_changed_pixels = raw_changed_mask.histogram()[255]
    raw_changed_percent = (raw_changed_pixels / total_pixels * 100.0) if total_pixels > 0 else 0.0

    diff_file = None
    if diff_out_path is not None:
        diff_out_path.parent.mkdir(parents=True, exist_ok=True)
        gray = ImageOps.grayscale(rgb_b).convert("RGB")
        dark_bg = Image.new("RGB", (w, h), (28, 30, 36))
        vis = Image.blend(gray, dark_bg, 0.35)

        if masked_pixels > 0:
            mask_tint = Image.new("RGB", (w, h), (70, 130, 180))
            tinted = Image.blend(vis, mask_tint, 0.30)
            vis = Image.composite(tinted, vis, mask_img)
            vis_draw = ImageDraw.Draw(vis)
            for box in applied_masks:
                vis_draw.rectangle(
                    [box["x"], box["y"], box["x"] + box["width"] - 1, box["y"] + box["height"] - 1],
                    outline=(100, 180, 230),
                    width=1,
                )

        if changed_pixels > 0:
            highlight = Image.new("RGB", (w, h), (255, 45, 85))
            vis = Image.composite(highlight, vis, changed_mask)

        vis.save(diff_out_path, format="PNG")
        diff_file = diff_out_path.name

    return {
        "baselineSize": list(size_a),
        "currentSize": list(size_b),
        "sizeMismatch": size_mismatch,
        "totalPixels": total_pixels,
        "maskedPixels": masked_pixels,
        "comparedPixels": compared_pixels,
        "changedPixels": changed_pixels,
        "changedPercent": round(changed_percent, 4),
        "rawChangedPixels": raw_changed_pixels,
        "rawChangedPercent": round(raw_changed_percent, 4),
        "changedBbox": list(changed_bbox) if changed_bbox else None,
        "maskBoxesCount": len(applied_masks),
        "diffImage": diff_file,
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compare two Chronos smoke runs (report.json + screenshots)."
    )
    parser.add_argument("baseline", type=Path, help="Baseline smoke output directory")
    parser.add_argument("current", type=Path, help="Current smoke output directory")
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Output directory for diff-report.json and diff-*.png (default: <current>/diff-vs-baseline)",
    )
    parser.add_argument(
        "--checks",
        type=Path,
        default=None,
        help="Optional checks.json for static pixelMasks (auto-detected beside compare.py if present)",
    )
    parser.add_argument(
        "--channel-threshold",
        type=int,
        default=4,
        help="Per-channel RGB difference threshold to count a pixel as changed (default: 4)",
    )
    parser.add_argument(
        "--pixel-threshold",
        type=float,
        default=1.0,
        help="Max allowed changed pixel percentage per screen before failing (default: 1.0)",
    )
    parser.add_argument(
        "--ignore-masks",
        action="store_true",
        help="Ignore dynamic and static pixel masks during image comparison",
    )
    parser.add_argument(
        "--no-diff-images",
        action="store_true",
        help="Do not write diff-*.png images",
    )
    parser.add_argument(
        "--no-fail-on-en",
        action="store_true",
        help="Report new English phrases without failing exit code",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print full JSON diff report to stdout",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    base_dir = args.baseline.resolve()
    curr_dir = args.current.resolve()
    base_report_path = base_dir / "report.json"
    curr_report_path = curr_dir / "report.json"

    if not base_report_path.is_file():
        print(f"Baseline report not found: {base_report_path}", file=sys.stderr)
        return 2
    if not curr_report_path.is_file():
        print(f"Current report not found: {curr_report_path}", file=sys.stderr)
        return 2

    checks_path = args.checks
    if checks_path is None:
        sibling_checks = Path(__file__).resolve().parent / "checks.json"
        if sibling_checks.is_file():
            checks_path = sibling_checks
    checks_cfg = load_json(checks_path) if checks_path and checks_path.is_file() else None

    out_dir = (args.out or (curr_dir / "diff-vs-baseline")).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    base = load_json(base_report_path)
    curr = load_json(curr_report_path)

    # 1. Global checks diff (globals + scheme).
    global_diffs: list[dict[str, Any]] = []
    for key in ("globals", "scheme"):
        b_ok = bool((base.get("checks") or {}).get(key, {}).get("ok"))
        c_ok = bool((curr.get("checks") or {}).get(key, {}).get("ok"))
        if b_ok != c_ok or not c_ok:
            global_diffs.append({"check": key, "baselineOk": b_ok, "currentOk": c_ok})

    base_globals_present = set((base.get("checks") or {}).get("globals", {}).get("present") or [])
    curr_globals_present = set((curr.get("checks") or {}).get("globals", {}).get("present") or [])
    removed_globals = sorted(base_globals_present - curr_globals_present)
    added_globals = sorted(curr_globals_present - base_globals_present)

    # 2. Per-screen comparison.
    base_screens = {s["id"]: s for s in (base.get("screens") or [])}
    curr_screens = {s["id"]: s for s in (curr.get("screens") or [])}
    ordered_ids: list[str] = []
    for sid in [s["id"] for s in (base.get("screens") or [])] + [
        s["id"] for s in (curr.get("screens") or [])
    ]:
        if sid not in ordered_ids:
            ordered_ids.append(sid)

    screen_diffs: list[dict[str, Any]] = []
    regressions: list[str] = []
    new_errors_total = 0
    new_en_total = 0
    visual_failures: list[str] = []

    for sid in ordered_ids:
        b_scr = base_screens.get(sid)
        c_scr = curr_screens.get(sid)

        b_ok = b_scr.get("ok") if b_scr else None
        c_ok = c_scr.get("ok") if c_scr else None
        if b_ok is True and c_ok is False:
            regressions.append(f"screen/{sid}: PASS -> FAIL")
        elif b_ok is None and c_ok is False:
            regressions.append(f"screen/{sid}: NEW FAIL")
        elif b_ok is not None and c_ok is None:
            regressions.append(f"screen/{sid}: MISSING in current run")

        b_errs = {normalize_error(e) for e in (b_scr.get("errors") or [])} if b_scr else set()
        c_errs = {normalize_error(e) for e in (c_scr.get("errors") or [])} if c_scr else set()
        new_errs = sorted(c_errs - b_errs)
        resolved_errs = sorted(b_errs - c_errs)
        new_errors_total += len(new_errs)

        b_en = set(b_scr.get("englishPhrases") or []) if b_scr else set()
        c_en = set(c_scr.get("englishPhrases") or []) if c_scr else set()
        new_en = sorted(c_en - b_en)
        removed_en = sorted(b_en - c_en)
        new_en_total += len(new_en)

        # Screenshot comparison.
        image_diff = None
        b_shot = (b_scr or {}).get("screenshot")
        c_shot = (c_scr or {}).get("screenshot")
        if b_shot and c_shot:
            bp = base_dir / b_shot
            cp = curr_dir / c_shot
            if bp.is_file() and cp.is_file():
                masks = collect_masks(sid, b_scr, c_scr, checks_cfg, args.ignore_masks)
                diff_png = None if args.no_diff_images else (out_dir / f"diff-{sid}.png")
                image_diff = compare_images(bp, cp, diff_png, masks, args.channel_threshold)
                if image_diff["sizeMismatch"] or image_diff["changedPercent"] > args.pixel_threshold:
                    visual_failures.append(
                        f"screen/{sid}: {image_diff['changedPercent']:.4f}% > {args.pixel_threshold}%"
                    )

        screen_diffs.append(
            {
                "id": sid,
                "baselineOk": b_ok,
                "currentOk": c_ok,
                "statusChanged": b_ok != c_ok,
                "newErrors": new_errs,
                "resolvedErrors": resolved_errs,
                "newEnglishPhrases": new_en,
                "removedEnglishPhrases": removed_en,
                "image": image_diff,
            }
        )

    for gd in global_diffs:
        if gd["baselineOk"] and not gd["currentOk"]:
            regressions.append(f"check/{gd['check']}: PASS -> FAIL")
        elif not gd["currentOk"]:
            regressions.append(f"check/{gd['check']}: FAIL")

    ok = (
        len(regressions) == 0
        and new_errors_total == 0
        and len(visual_failures) == 0
        and (args.no_fail_on_en or new_en_total == 0)
    )

    result = {
        "schemaVersion": 1,
        "ok": ok,
        "baseline": {
            "dir": str(base_dir),
            "version": (base.get("app") or {}).get("version"),
            "startedAt": base.get("startedAt"),
            "ok": base.get("ok"),
        },
        "current": {
            "dir": str(curr_dir),
            "version": (curr.get("app") or {}).get("version"),
            "startedAt": curr.get("startedAt"),
            "ok": curr.get("ok"),
        },
        "thresholds": {
            "channelThreshold": args.channel_threshold,
            "pixelThresholdPercent": args.pixel_threshold,
            "ignoreMasks": args.ignore_masks,
            "failOnNewEnglish": not args.no_fail_on_en,
        },
        "globals": {
            "removed": removed_globals,
            "added": added_globals,
        },
        "globalDiffs": global_diffs,
        "screens": screen_diffs,
        "summary": {
            "regressions": regressions,
            "newErrors": new_errors_total,
            "newEnglishPhrases": new_en_total,
            "visualFailures": visual_failures,
            "maxChangedPercent": max(
                (s["image"]["changedPercent"] for s in screen_diffs if s["image"]),
                default=0.0,
            ),
        },
    }

    diff_report_path = out_dir / "diff-report.json"
    diff_report_path.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(
            f"Baseline: {result['baseline']['version']} ({base_dir})\n"
            f"Current:  {result['current']['version']} ({curr_dir})"
        )
        if removed_globals or added_globals:
            print(f"Globals diff: removed={removed_globals}, added={added_globals}")
        print("")
        print(f"{'Screen':<22} {'Status':<11} {'NewErr':>6} {'NewEN':>6} {'Diff%':>9} {'Raw%':>9} {'Masks':>5}")
        print("-" * 76)
        for s in screen_diffs:
            st = f"{'OK' if s['baselineOk'] else 'FAIL' if s['baselineOk'] is False else '-'}->{'OK' if s['currentOk'] else 'FAIL' if s['currentOk'] is False else '-'}"
            img = s["image"]
            diff_pct = f"{img['changedPercent']:.4f}%" if img else "-"
            raw_pct = f"{img['rawChangedPercent']:.4f}%" if img else "-"
            masks_cnt = str(img["maskBoxesCount"]) if img else "-"
            print(
                f"{s['id']:<22} {st:<11} {len(s['newErrors']):>6} {len(s['newEnglishPhrases']):>6} {diff_pct:>9} {raw_pct:>9} {masks_cnt:>5}"
            )
            for e in s["newErrors"]:
                print(f"   + error: {e}")
            for p in s["newEnglishPhrases"]:
                print(f"   + en: {p}")
        print("-" * 76)
        print(
            f"Result: {'PASS' if ok else 'FAIL'} "
            f"(regressions={len(regressions)}, new_errors={new_errors_total}, "
            f"new_en={new_en_total}, visual_failures={len(visual_failures)}, "
            f"max_diff={result['summary']['maxChangedPercent']:.4f}%)"
        )
        print(f"Diff report: {diff_report_path}")

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
