#!/usr/bin/env python3
"""Trace the supplied Spotlight icons without dropping their RGBA opacity.

Install: python3 -m pip install vtracer==1.0.0a4 Pillow==11.3.0
The source APK resources stay local; only the generated SVGs enter the app.
"""

import argparse
from collections import defaultdict
from hashlib import sha256
from importlib.metadata import version
from pathlib import Path
import xml.etree.ElementTree as ET

from PIL import Image
import vtracer


ROOT = Path(__file__).resolve().parent.parent
SVG = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG)
NAMES = (
    "background_pop_bg", "background_pop_bg_left", "black", "blue",
    "circular_normal", "circular_pressed", "custom_normal", "custom_pressed",
    "dazzle_spotlight_menu_bg", "dazzle_spotlight_picture_normal",
    "dazzle_spotlight_picture_pressed", "dazzle_spotlight_quit_normal",
    "dazzle_spotlight_quit_presse", "dazzle_spotlight_shape_normal",
    "dazzle_spotlight_shape_pressed", "horizontal_line", "line", "red",
    "seekbar_click_focus", "seekbar_click_normal", "selection",
    "square_normal", "square_pressed", "star_normal", "star_pressed",
    "triangle_normal", "triangle_pressed", "zoom_normal", "zoom_pressed",
)


def trace_image(source, resources):
    with Image.open(source) as source_image:
        image = source_image.convert("RGBA")
    width, height = image.size
    if not image.getbbox():
        raise ValueError(f"Empty icon: {source}")
    config = vtracer.Config(
        mode="pixel", hierarchical="cutout", filter_speckle=0,
        color_precision=8, layer_difference=1, path_precision=3, optimize=0,
    )
    # VTracer drops partial alpha. Trace RGB independently; exact source-alpha
    # scanline contours below retain antialiased edges and the 20% menu panels.
    rgb = image.convert("RGB").convert("RGBA")
    traced = ET.fromstring(vtracer.convert_pixels(rgb.tobytes(), width, height, config))
    root = ET.Element(f"{{{SVG}}}svg", {
        "viewBox": f"0 0 {width} {height}", "width": str(width), "height": str(height),
    })
    ET.SubElement(root, f"{{{SVG}}}metadata", {
        "data-source": source.relative_to(resources).as_posix(),
        "data-source-sha256": sha256(source.read_bytes()).hexdigest(),
        "data-generator": "vtracer-1.0.0a4-rgba",
    })
    alpha = image.getchannel("A")
    if alpha.getextrema() != (255, 255):
        mask_id = "spotlight-source-alpha"
        defs = ET.SubElement(root, f"{{{SVG}}}defs")
        mask = ET.SubElement(defs, f"{{{SVG}}}mask", {
            "id": mask_id, "x": "0", "y": "0",
            "width": str(width), "height": str(height),
            "maskUnits": "userSpaceOnUse", "maskContentUnits": "userSpaceOnUse",
            "style": "mask-type:alpha",
        })
        runs = defaultdict(list)
        values = alpha.tobytes()
        for y in range(height):
            x = 0
            while x < width:
                opacity = values[y * width + x]
                end = x + 1
                while end < width and values[y * width + end] == opacity:
                    end += 1
                if opacity:
                    runs[opacity].append(f"M{x},{y}h{end - x}v1h{x - end}Z")
                x = end
        for opacity, contours in sorted(runs.items()):
            ET.SubElement(mask, f"{{{SVG}}}path", {
                "d": "".join(contours), "fill": "#fff",
                "fill-opacity": format(opacity / 255, ".12g"),
            })
        drawing = ET.SubElement(root, f"{{{SVG}}}g", {"mask": f"url(#{mask_id})"})
    else:
        drawing = root
    drawing.extend(traced)
    return ET.tostring(root, encoding="unicode") + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "ss/apkxa/res/Spotlight/res")
    parser.add_argument("--output", type=Path, default=ROOT / "app/fcboard/assets/spotlight")
    parser.add_argument("--history", type=Path, default=ROOT / "history.md")
    parser.add_argument("names", nargs="*", default=NAMES)
    args = parser.parse_args()
    if version("vtracer") != "1.0.0a4" or version("Pillow") != "11.3.0":
        parser.error("Install the pinned wheel versions in the script's install instruction")
    if not args.source.is_dir():
        parser.error(f"Missing original APK resource directory: {args.source}")
    args.output.mkdir(parents=True, exist_ok=True)
    for name in args.names:
        if name not in NAMES:
            parser.error(f"Unknown Spotlight asset: {name}")
        candidates = list(args.source.glob(f"drawable*/{name}.png"))
        if not candidates:
            parser.error(f"Missing source PNG: {name}")
        # Prefer the original highest-density resource over upscaling an icon.
        def pixels(source):
            with Image.open(source) as image:
                return image.width * image.height, source.as_posix()
        source = max(candidates, key=pixels)
        text = trace_image(source, args.source)
        destination = args.output / f"{name}.svg"
        destination.write_text(text, encoding="utf8")
        with args.history.open("a", encoding="utf8") as history:
            history.write(f"- P8 SVG: {destination.name} traced from {source.relative_to(args.source)} with pinned VTracer RGB contours + original alpha mask; {len(text)} bytes.\n")
        print(f"{name}: {source.parent.name} -> {len(text)} SVG bytes", flush=True)


if __name__ == "__main__":
    main()
