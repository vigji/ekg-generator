"""Sweep-line drawing logic for the patient monitor.

Implements the classic monitor sweep: draws waveform left-to-right,
with a gap/blank region ahead of the cursor that erases old data.
"""

import numpy as np


class SweepBuffer:
    """Manages a circular sweep buffer for a waveform trace.

    The sweep draws from left to right. A blank gap ahead of the cursor
    erases old data, creating the classic monitor sweep effect.
    """

    def __init__(self, width_pixels: int, gap_pixels: int = 20):
        """
        Parameters
        ----------
        width_pixels : int
            Number of horizontal pixels in the trace area.
        gap_pixels : int
            Width of the blank gap ahead of the cursor.
        """
        self.width = width_pixels
        self.gap = gap_pixels
        # y-values for each pixel column (NaN = blank)
        self.y_values = np.full(width_pixels, np.nan)
        self.cursor = 0  # current write position

    def advance(self, y_value: float) -> int:
        """Write next y-value and advance cursor.

        Returns the current cursor position (pixel x).
        """
        pos = self.cursor % self.width
        self.y_values[pos] = y_value

        # Blank out the gap ahead
        for i in range(1, self.gap + 1):
            gap_pos = (pos + i) % self.width
            self.y_values[gap_pos] = np.nan

        self.cursor += 1
        return pos

    def get_drawable_segments(self) -> list[tuple[np.ndarray, np.ndarray]]:
        """Get line segments for drawing, splitting at NaN gaps.

        Returns list of (x_array, y_array) for contiguous segments.
        """
        segments = []
        xs = []
        ys = []

        for i in range(self.width):
            if np.isnan(self.y_values[i]):
                if len(xs) > 1:
                    segments.append((np.array(xs), np.array(ys)))
                xs = []
                ys = []
            else:
                xs.append(i)
                ys.append(self.y_values[i])

        if len(xs) > 1:
            segments.append((np.array(xs), np.array(ys)))

        return segments

    def reset(self):
        """Clear the buffer."""
        self.y_values[:] = np.nan
        self.cursor = 0
