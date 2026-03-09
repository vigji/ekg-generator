#!/usr/bin/env python3
"""Generate side-by-side comparison images: our generated ECG vs LITFL references.

Creates before/after comparison images showing the original GIF frame,
the improved GIF frame, and the LITFL clinical reference ECG.
Output goes to output/comparisons/.
"""

import os
import sys

import numpy as np
from PIL import Image

# Add project root to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

PROJECT_ROOT = os.path.join(os.path.dirname(__file__), "..")
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "output")
LITFL_DIR = os.path.join(OUTPUT_DIR, "litfl_ecg", "images")
COMP_DIR = os.path.join(OUTPUT_DIR, "comparisons")

# Mapping: (preset_name, safe_filename, litfl_case_image)
COMPARISONS = [
    ("Ventricular Tachycardia", "ventricular_tachycardia", "case_119_d.png"),
    ("Atrial Flutter", "atrial_flutter", "case_042_d.png"),
    ("SVT / AVNRT", "svt___avnrt", "case_016_b.png"),
    ("STEMI", "stemi", "case_005_e.png"),
    ("Left Bundle Branch Block", "left_bundle_branch_block", "case_003_b.png"),
]


def extract_frame(gif_path: str, frame_index: int = 50) -> Image.Image:
    """Extract a single frame from a GIF."""
    gif = Image.open(gif_path)
    try:
        gif.seek(frame_index)
    except EOFError:
        gif.seek(0)
    return gif.convert("RGB")


def create_comparison(
    original_frame: Image.Image,
    improved_frame: Image.Image,
    litfl_image: Image.Image,
    title: str,
) -> Image.Image:
    """Create a 3-panel comparison image: original | improved | LITFL reference."""
    # Target panel width
    panel_w = 600
    padding = 10
    header_h = 40

    # Resize all panels to same width, preserving aspect ratio
    panels = []
    labels = ["Original", "Improved", "LITFL Reference"]
    for img in [original_frame, improved_frame, litfl_image]:
        ratio = panel_w / img.width
        new_h = int(img.height * ratio)
        panels.append(img.resize((panel_w, new_h), Image.LANCZOS))

    max_h = max(p.height for p in panels)
    total_w = panel_w * 3 + padding * 4
    total_h = max_h + header_h + padding * 2

    canvas = Image.new("RGB", (total_w, total_h), (30, 30, 30))

    # Try to add text labels
    try:
        from PIL import ImageDraw, ImageFont

        draw = ImageDraw.Draw(canvas)
        try:
            font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 18)
        except OSError:
            font = ImageFont.load_default()

        # Title
        draw.text((total_w // 2, 5), title, fill=(255, 255, 255), anchor="mt", font=font)

        for i, (panel, label) in enumerate(zip(panels, labels)):
            x = padding + i * (panel_w + padding)
            y = header_h
            canvas.paste(panel, (x, y))
            draw.text(
                (x + panel_w // 2, header_h - 5),
                label,
                fill=(200, 200, 200),
                anchor="mb",
                font=font,
            )
    except ImportError:
        # No ImageDraw available, just paste panels
        for i, panel in enumerate(panels):
            x = padding + i * (panel_w + padding)
            canvas.paste(panel, (x, header_h))

    return canvas


def main():
    os.makedirs(COMP_DIR, exist_ok=True)

    found = 0
    for preset_name, safe_name, litfl_file in COMPARISONS:
        original_gif = os.path.join(OUTPUT_DIR, f"{safe_name}.gif")
        improved_gif = os.path.join(OUTPUT_DIR, f"{safe_name}_improved.gif")
        litfl_path = os.path.join(LITFL_DIR, litfl_file)

        # Check which files exist
        missing = []
        if not os.path.exists(original_gif):
            missing.append(f"original GIF: {original_gif}")
        if not os.path.exists(improved_gif):
            missing.append(f"improved GIF: {improved_gif}")
        if not os.path.exists(litfl_path):
            missing.append(f"LITFL ref: {litfl_path}")

        if missing:
            print(f"SKIP {preset_name}: missing {', '.join(missing)}")
            continue

        print(f"Comparing {preset_name}...", end=" ", flush=True)

        original_frame = extract_frame(original_gif)
        improved_frame = extract_frame(improved_gif)
        litfl_image = Image.open(litfl_path).convert("RGB")

        comp = create_comparison(original_frame, improved_frame, litfl_image, preset_name)
        out_path = os.path.join(COMP_DIR, f"{safe_name}_comparison.png")
        comp.save(out_path)
        print(f"OK -> {out_path}")
        found += 1

    if found == 0:
        print("\nNo comparisons generated. Make sure original and improved GIFs exist.")
        print("Run: python scripts/demo.py && python scripts/demo_improved.py")
    else:
        print(f"\nGenerated {found} comparison images in {os.path.abspath(COMP_DIR)}")


if __name__ == "__main__":
    main()
