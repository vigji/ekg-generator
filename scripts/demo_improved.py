#!/usr/bin/env python3
"""Generate all preset clinical scenarios with _improved suffix.

Outputs sit alongside the originals for side-by-side comparison.
"""

import os
import sys
import time

# Add project root to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ekg_generator.scenarios.presets import list_presets, get_preset
from ekg_generator.generate import generate_scenario


def main():
    output_dir = os.path.join(os.path.dirname(__file__), "..", "output")
    os.makedirs(output_dir, exist_ok=True)

    presets = list_presets()
    print(f"Generating {len(presets)} improved preset scenarios...\n")

    for i, name in enumerate(presets, 1):
        scenario = get_preset(name)
        # Create safe filename with _improved suffix
        safe_name = name.lower().replace(" ", "_").replace("/", "_").replace("(", "").replace(")", "")
        output_path = os.path.join(output_dir, f"{safe_name}_improved.gif")

        print(f"[{i}/{len(presets)}] {name}...", end=" ", flush=True)
        t0 = time.time()

        try:
            generate_scenario(
                scenario,
                output_path,
                duration=8.0,
                fps=25,
                format="gif",
                random_state=42,
            )
            dt = time.time() - t0
            size_kb = os.path.getsize(output_path) / 1024
            print(f"OK ({dt:.1f}s, {size_kb:.0f} KB)")
        except Exception as e:
            print(f"FAILED: {e}")

    print(f"\nDone! Output in: {os.path.abspath(output_dir)}")


if __name__ == "__main__":
    main()
