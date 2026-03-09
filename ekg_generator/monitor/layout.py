"""Monitor layout definitions.

Defines the regions of the simulated patient monitor:
- ECG trace area
- SpO2 pleth trace area
- ETCO2 capnography trace area
- Numeric vitals panel
"""

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class Rect:
    """A rectangle defined by (x, y, width, height)."""
    x: int
    y: int
    w: int
    h: int

    @property
    def x2(self) -> int:
        return self.x + self.w

    @property
    def y2(self) -> int:
        return self.y + self.h


@dataclass(frozen=True)
class MonitorLayout:
    """Layout regions for the patient monitor display."""
    canvas_w: int
    canvas_h: int
    ecg_area: Rect
    pleth_area: Rect
    etco2_area: Rect
    vitals_panel: Rect
    hr_label_pos: tuple[int, int]
    hr_value_pos: tuple[int, int]
    spo2_label_pos: tuple[int, int]
    spo2_value_pos: tuple[int, int]
    etco2_label_pos: tuple[int, int]
    etco2_value_pos: tuple[int, int]
    nibp_label_pos: tuple[int, int]
    nibp_value_pos: tuple[int, int]
    rhythm_label_pos: tuple[int, int]


def default_layout() -> MonitorLayout:
    """Create the default 800x480 monitor layout with 3 trace areas."""
    w, h = 800, 480
    panel_w = 200
    trace_w = w - panel_w

    # 3-trace layout: ECG ~42%, SpO2 ~27%, ETCO2 ~31%
    ecg_h = 201
    pleth_h = 130
    etco2_h = h - ecg_h - pleth_h  # 149

    return MonitorLayout(
        canvas_w=w,
        canvas_h=h,
        ecg_area=Rect(0, 0, trace_w, ecg_h),
        pleth_area=Rect(0, ecg_h, trace_w, pleth_h),
        etco2_area=Rect(0, ecg_h + pleth_h, trace_w, etco2_h),
        vitals_panel=Rect(trace_w, 0, panel_w, h),
        # HR - top of panel
        hr_label_pos=(trace_w + 15, 25),
        hr_value_pos=(trace_w + 15, 78),
        # SpO2
        spo2_label_pos=(trace_w + 15, 140),
        spo2_value_pos=(trace_w + 15, 193),
        # ETCO2
        etco2_label_pos=(trace_w + 15, 255),
        etco2_value_pos=(trace_w + 15, 308),
        # NIBP
        nibp_label_pos=(trace_w + 15, 370),
        nibp_value_pos=(trace_w + 15, 418),
        # Rhythm label
        rhythm_label_pos=(10, h - 10),
    )
