"""Compare the three supplied Codex states with native DSH DPR=2 controls.

Usage: python3 scripts/compare-ui.py compact.png expanded.png composer.png
Requires Pillow and numpy. Source screenshots stay outside the repository.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json
import sys
import numpy as np

if len(sys.argv) != 4:
    raise SystemExit(__doc__)
art = Path(__file__).resolve().parents[1] / "artifacts"
metrics = json.loads((art / "ui-measurements.json").read_text())
references = [Image.open(path).convert("RGB") for path in sys.argv[1:]]
rows = [
    ("editor-compact", "划选后的紧凑框", 0, (215, 56, 807, 148)),
    ("editor", "展开编辑框", 1, (199, 54, 791, 226)),
    ("annotations", "聊天框详情卡", 2, (49, 44, 817, 330)),
    ("batch-chip", "聊天框胶囊", 2, (49, 338, 227, 402)),
    ("marker", "蓝色编号", 0, (849, 106, 903, 160)),
]
font_path = "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"
font = ImageFont.truetype(font_path, 22)
small = ImageFont.truetype(font_path, 18)
title = ImageFont.truetype(font_path, 30)
canvas = Image.new("RGB", (2560, 1600), "#f6f7f9")
draw = ImageDraw.Draw(canvas)
draw.text((24, 20), "Codex / dsh 0.2.0：三种状态逐像素对照", font=title, fill="#17191d")
draw.text((24, 65), "参考按 2x 推定，dsh 为 Chrome DPR=2；原尺寸裁切，对齐左上角，无缩放。", font=small, fill="#5e636c")
for x, label in [(180, "Codex 参考"), (990, "dsh 原生渲染"), (1800, "逐像素差值：越亮表示差异越大")]:
    draw.text((x, 112), label, font=font, fill="#17191d")
stats = {}
y = 158
for name, label, reference_index, bounds in rows:
    reference = references[reference_index].crop(bounds)
    m = metrics[name]
    w, h = round(m["width"] * 2), round(m["height"] * 2)
    native = Image.open(art / f"pixel-{name}@2x.png").convert("RGB").crop((24, 24, 24 + w, 24 + h))
    cw, ch = max(reference.width, w), max(reference.height, h)
    aligned = []
    for source in [reference, native]:
        layer = Image.new("RGB", (cw, ch), "white")
        layer.paste(source, (0, 0))
        aligned.append(layer)
    diff = np.abs(np.asarray(aligned[0], dtype=np.int16) - np.asarray(aligned[1], dtype=np.int16)).max(axis=2)
    heat = Image.fromarray(np.stack([diff, diff * .6, diff * .08], axis=2).astype(np.uint8))
    draw.text((24, y + 12), label, font=small, fill="#17191d")
    for x, layer in [(180, aligned[0]), (990, aligned[1]), (1800, heat)]:
        draw.rounded_rectangle((x - 8, y - 8, x + cw + 8, y + ch + 8), radius=8, fill="white", outline="#e2e5e9")
        canvas.paste(layer, (x, y))
    draw.text((180, y + ch + 14), f"参考 {reference.width}×{reference.height}px；dsh {w}×{h}px", font=small, fill="#5e636c")
    stats[name] = {
        "referenceBoundsPx": bounds, "referenceScaleAssumption": 2,
        "dshDeviceScaleFactor": 2, "dshLayoutSize": [m["width"], m["height"]],
        "referenceSizePx": list(reference.size), "dshSizePx": [w, h],
        "meanAbsoluteChannelMaxDifference": float(diff.mean()),
        "pixelsWithChannelDifferenceOver16Pct": round(float((diff > 16).mean() * 100), 2),
    }
    y += ch + 68
draw.text((24, y + 4), "保留 dsh 字体、主题蓝色与描边；按要求移除语音入口。光标闪烁帧可能与参考不同。", font=small, fill="#17191d")
draw.text((24, y + 34), "差值包含字形、光标、图标、主题色、阴影和定位误差，不能换算为整体相似度。参考轮廓定位约 ±1px。", font=small, fill="#5e636c")
canvas.crop((0, 0, 2560, y + 74)).save(art / "UI三态像素对比.png")
(art / "pixel-differences-v2.json").write_text(json.dumps(stats, ensure_ascii=False, indent=2))
print(json.dumps({name: value["dshLayoutSize"] for name, value in stats.items()}, ensure_ascii=False))
