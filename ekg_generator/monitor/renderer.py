"""Frame-by-frame monitor renderer.

Renders the patient monitor display frame by frame, compositing:
- ECG sweep trace (green)
- SpO2 pleth sweep trace (cyan)
- ETCO2 capnography sweep trace (yellow)
- Numeric vitals panel
- Rhythm label

Exports to GIF (via Pillow) or MP4 (via OpenCV VideoWriter).
"""

from __future__ import annotations

import numpy as np
import cv2
from PIL import Image
from scipy.ndimage import gaussian_filter1d

from .layout import MonitorLayout, default_layout
from .sweep import SweepBuffer


# Colors (BGR for OpenCV)
BLACK = (0, 0, 0)
ECG_GREEN = (120, 255, 0)       # #00FF78 in BGR
PLETH_CYAN = (255, 200, 0)      # #00C8FF in BGR
ETCO2_YELLOW = (0, 255, 255)    # #FFFF00 in BGR
WHITE = (255, 255, 255)
RED = (80, 80, 255)             # soft red in BGR
DARK_GRAY = (40, 40, 40)
GRID_COLOR = (25, 25, 25)


def _draw_grid(frame: np.ndarray, area_x: int, area_y: int, area_w: int, area_h: int):
    """Draw subtle background grid lines."""
    # Major grid every 50px, minor every 10px
    for x in range(area_x, area_x + area_w, 50):
        cv2.line(frame, (x, area_y), (x, area_y + area_h), GRID_COLOR, 1)
    for y in range(area_y, area_y + area_h, 50):
        cv2.line(frame, (area_x, y), (area_x + area_w, y), GRID_COLOR, 1)


def _draw_sweep_trace(
    frame: np.ndarray,
    sweep: SweepBuffer,
    area_x: int,
    area_y: int,
    area_h: int,
    color: tuple,
    line_width: int = 2,
):
    """Draw a sweep trace from its buffer onto the frame."""
    segments = sweep.get_drawable_segments()
    for xs, ys in segments:
        # ys are in normalized coordinates, convert to pixel y
        points = np.column_stack([
            (xs + area_x).astype(np.int32),
            ys.astype(np.int32),
        ])
        if len(points) >= 2:
            cv2.polylines(frame, [points], False, color, line_width, cv2.LINE_AA)


def _draw_beat_markers(
    frame: np.ndarray,
    marker_visible: np.ndarray,
    ecg_area_x: int,
    ecg_area_y: int,
    trace_w: int,
):
    """Draw small white upward-pointing triangles at beat marker positions."""
    for x in range(trace_w):
        if marker_visible[x]:
            apex = (ecg_area_x + x, ecg_area_y + 2)
            left = (ecg_area_x + x - 4, ecg_area_y + 10)
            right = (ecg_area_x + x + 4, ecg_area_y + 10)
            pts = np.array([apex, left, right], dtype=np.int32)
            cv2.fillPoly(frame, [pts], WHITE)


def _put_text(frame, text, pos, font_scale, color, thickness=1):
    """Draw anti-aliased text."""
    cv2.putText(frame, text, pos, cv2.FONT_HERSHEY_SIMPLEX, font_scale, color, thickness, cv2.LINE_AA)


class MonitorRenderer:
    """Renders animated patient monitor frames."""

    def __init__(
        self,
        ecg_signal: np.ndarray,
        pleth_signal: np.ndarray,
        sampling_rate: int,
        heart_rate: float | None,
        spo2: int | None,
        nibp_sys: int | None,
        nibp_dia: int | None,
        rhythm_label: str = "",
        layout: MonitorLayout | None = None,
        fps: int = 30,
        sweep_speed: float = 25.0,
        ecg_min_range: float = 1.0,
        pleth_min_range: float = 0.3,
        etco2_signal: np.ndarray | None = None,
        etco2: int | None = None,
        etco2_min_range: float = 10.0,
        pixels_per_frame: float | None = None,
        beat_times: np.ndarray | None = None,
        show_beat_markers: bool = False,
    ):
        """
        Parameters
        ----------
        ecg_signal : np.ndarray
            Full ECG waveform.
        pleth_signal : np.ndarray
            Full SpO2 pleth waveform.
        sampling_rate : int
            Waveform sampling rate in Hz.
        heart_rate : float or None
            Displayed HR value. None shows "---".
        spo2 : int or None
            Displayed SpO2 value. None shows "---".
        nibp_sys, nibp_dia : int or None
            Displayed NIBP values. None shows "---/---".
        rhythm_label : str
            Rhythm name shown at bottom.
        layout : MonitorLayout or None
            Monitor layout. Uses default if None.
        fps : int
            Output video frame rate.
        sweep_speed : float
            Sweep speed in mm/s (25 mm/s standard). Controls how fast the trace moves.
        ecg_min_range : float
            Minimum signal range for ECG normalization.
        pleth_min_range : float
            Minimum signal range for pleth normalization.
        etco2_signal : np.ndarray or None
            Full ETCO2 capnography waveform. If None, a flat trace is shown.
        etco2 : int or None
            Displayed ETCO2 numeric value. None shows "---".
        etco2_min_range : float
            Minimum signal range for ETCO2 normalization.
        pixels_per_frame : float or None
            Pixels advanced per frame. If None, computed from sweep_speed.
            Set explicitly for circular GIF looping alignment.
        """
        self.ecg = ecg_signal
        self.pleth = pleth_signal
        self.sr = sampling_rate
        self.hr = heart_rate
        self.spo2 = spo2
        self.nibp_sys = nibp_sys
        self.nibp_dia = nibp_dia
        self.rhythm_label = rhythm_label
        self.layout = layout or default_layout()
        self.fps = fps
        self.sweep_speed = sweep_speed
        self.ecg_min_range = ecg_min_range
        self.pleth_min_range = pleth_min_range
        self.etco2_value = etco2
        self.etco2_min_range = etco2_min_range

        # ETCO2 signal: default to flat zeros matching ECG length
        if etco2_signal is not None:
            self.etco2 = etco2_signal
        else:
            self.etco2 = np.zeros_like(ecg_signal)

        # Pixels per sample: sweep_speed controls how many pixels per second
        # At 25mm/s on an ~600px trace spanning ~6 seconds
        trace_w = self.layout.ecg_area.w
        self.pixels_per_sample = sweep_speed * 3.78 / sampling_rate
        self._samples_per_pixel = 1.0 / self.pixels_per_sample

        # Pixels per frame (may be adjusted for circular looping)
        if pixels_per_frame is not None:
            self._pixels_per_frame = pixels_per_frame
        else:
            self._pixels_per_frame = (sampling_rate / fps) * self.pixels_per_sample

        # Initialize sweep buffers
        self.ecg_sweep = SweepBuffer(trace_w, gap_pixels=15)
        self.pleth_sweep = SweepBuffer(trace_w, gap_pixels=15)
        self.etco2_sweep = SweepBuffer(trace_w, gap_pixels=15)

        # Pixel tracking: use frame-index-based computation to avoid
        # floating-point accumulation error across many frames
        self._pixel_base = 0.0   # set to trace_w after prefill
        self._frame_count = 0

        # Precompute normalized signals (avoids recomputing every frame)
        lay = self.layout
        self._ecg_norm = self._normalize_to_area(
            self.ecg, lay.ecg_area.y, lay.ecg_area.h, min_range=self.ecg_min_range)
        self._pleth_norm = self._normalize_to_area(
            self.pleth, lay.pleth_area.y, lay.pleth_area.h, min_range=self.pleth_min_range)
        self._etco2_norm = self._normalize_to_area(
            self.etco2, lay.etco2_area.y, lay.etco2_area.h, min_range=self.etco2_min_range)

        # Anti-alias pleth & etco2 to prevent subsampling artifacts at
        # inflection points (ECG kept sharp for QRS fidelity)
        aa_sigma = 1.0 / self.pixels_per_sample  # ~5 samples
        if aa_sigma > 1.0:
            self._pleth_norm = gaussian_filter1d(self._pleth_norm, aa_sigma)
            self._etco2_norm = gaussian_filter1d(self._etco2_norm, aa_sigma)

        # Beat marker precomputation
        self._show_beat_markers = show_beat_markers
        if show_beat_markers and beat_times is not None:
            self._beat_at_sample = np.zeros(len(ecg_signal), dtype=bool)
            for t in beat_times:
                si = int(round(t * sampling_rate))
                if 0 <= si < len(ecg_signal):
                    self._beat_at_sample[si] = True
            self._marker_visible = np.zeros(self.layout.ecg_area.w, dtype=bool)
        else:
            self._beat_at_sample = None
            self._marker_visible = None

    def _normalize_to_area(self, signal: np.ndarray, area_y: int, area_h: int,
                           margin: float = 0.1, min_range: float = 0.0) -> np.ndarray:
        """Normalize signal values to fit within an area's pixel range.

        Parameters
        ----------
        min_range : float
            Minimum signal range to use for scaling. When the actual signal
            range is smaller than this, min_range is used instead (centered
            on the signal mean). Prevents micro-noise amplification for
            near-flat signals like asystole.
        """
        s_min = np.nanmin(signal)
        s_max = np.nanmax(signal)
        s_range = s_max - s_min

        if min_range > 0 and s_range < min_range:
            s_mean = (s_min + s_max) / 2.0
            s_min = s_mean - min_range / 2.0
            s_max = s_mean + min_range / 2.0
            s_range = min_range

        if s_range < 1e-6:
            s_range = 1.0

        margin_px = int(area_h * margin)
        usable_h = area_h - 2 * margin_px

        # Map signal: high values → low y (top of screen)
        normalized = area_y + margin_px + usable_h * (1.0 - (signal - s_min) / s_range)
        return normalized

    def render_frame(self) -> np.ndarray | None:
        """Render the next frame.

        Returns BGR frame array, or None if signal is exhausted.
        """
        lay = self.layout
        frame = np.zeros((lay.canvas_h, lay.canvas_w, 3), dtype=np.uint8)

        # Draw background grid for all trace areas
        _draw_grid(frame, lay.ecg_area.x, lay.ecg_area.y, lay.ecg_area.w, lay.ecg_area.h)
        _draw_grid(frame, lay.pleth_area.x, lay.pleth_area.y, lay.pleth_area.w, lay.pleth_area.h)
        _draw_grid(frame, lay.etco2_area.x, lay.etco2_area.y, lay.etco2_area.w, lay.etco2_area.h)

        # Separator lines
        cv2.line(frame, (0, lay.ecg_area.y2), (lay.ecg_area.w, lay.ecg_area.y2), DARK_GRAY, 1)
        cv2.line(frame, (0, lay.pleth_area.y2), (lay.pleth_area.w, lay.pleth_area.y2), DARK_GRAY, 1)
        cv2.line(frame, (lay.vitals_panel.x, 0), (lay.vitals_panel.x, lay.canvas_h), DARK_GRAY, 1)

        # Advance sweep by pixels_per_frame (pixel-driven for precise looping).
        # Compute pixel boundaries from frame index to avoid float accumulation error.
        start_px = int(self._pixel_base + self._frame_count * self._pixels_per_frame)
        end_px = int(self._pixel_base + (self._frame_count + 1) * self._pixels_per_frame)
        trace_w = lay.ecg_area.w
        sig_len = len(self._ecg_norm)

        for p in range(start_px, end_px):
            col = p % trace_w
            idx = int(p * self._samples_per_pixel) % sig_len
            self.ecg_sweep.advance(self._ecg_norm[idx])
            self.pleth_sweep.advance(self._pleth_norm[idx])
            self.etco2_sweep.advance(self._etco2_norm[idx])

            # Track beat markers in parallel with sweep
            if self._marker_visible is not None:
                self._marker_visible[col] = self._beat_at_sample[idx]
                # Clear gap ahead (same 15px gap as SweepBuffer)
                for g in range(1, 16):
                    self._marker_visible[(col + g) % trace_w] = False

        self._frame_count += 1

        # Draw traces
        _draw_sweep_trace(frame, self.ecg_sweep, lay.ecg_area.x, lay.ecg_area.y,
                          lay.ecg_area.h, ECG_GREEN, 2)
        _draw_sweep_trace(frame, self.pleth_sweep, lay.pleth_area.x, lay.pleth_area.y,
                          lay.pleth_area.h, PLETH_CYAN, 2)
        _draw_sweep_trace(frame, self.etco2_sweep, lay.etco2_area.x, lay.etco2_area.y,
                          lay.etco2_area.h, ETCO2_YELLOW, 2)

        # Draw beat markers
        if self._marker_visible is not None:
            _draw_beat_markers(frame, self._marker_visible,
                               lay.ecg_area.x, lay.ecg_area.y, trace_w)

        # Draw vitals panel
        self._draw_vitals(frame)

        return frame

    def _draw_vitals(self, frame: np.ndarray):
        """Draw the numeric vitals panel."""
        lay = self.layout

        # HR
        _put_text(frame, "HR", lay.hr_label_pos, 0.5, ECG_GREEN, 1)
        _put_text(frame, "bpm", (lay.hr_label_pos[0] + 100, lay.hr_label_pos[1]), 0.4, ECG_GREEN, 1)
        hr_text = f"{int(self.hr)}" if self.hr is not None else "---"
        _put_text(frame, hr_text, lay.hr_value_pos, 2.0, ECG_GREEN, 3)

        # SpO2
        _put_text(frame, "SpO2", lay.spo2_label_pos, 0.5, PLETH_CYAN, 1)
        _put_text(frame, "%", (lay.spo2_label_pos[0] + 100, lay.spo2_label_pos[1]), 0.4, PLETH_CYAN, 1)
        spo2_text = f"{self.spo2}" if self.spo2 is not None else "---"
        _put_text(frame, spo2_text, lay.spo2_value_pos, 2.0, PLETH_CYAN, 3)

        # ETCO2
        _put_text(frame, "ETCO2", lay.etco2_label_pos, 0.5, ETCO2_YELLOW, 1)
        _put_text(frame, "mmHg", (lay.etco2_label_pos[0] + 100, lay.etco2_label_pos[1]), 0.4, ETCO2_YELLOW, 1)
        etco2_text = f"{self.etco2_value}" if self.etco2_value is not None else "---"
        _put_text(frame, etco2_text, lay.etco2_value_pos, 2.0, ETCO2_YELLOW, 3)

        # NIBP
        _put_text(frame, "NIBP", lay.nibp_label_pos, 0.5, WHITE, 1)
        _put_text(frame, "mmHg", (lay.nibp_label_pos[0] + 100, lay.nibp_label_pos[1]), 0.4, WHITE, 1)
        if self.nibp_sys is not None and self.nibp_dia is not None:
            nibp_text = f"{self.nibp_sys}/{self.nibp_dia}"
        else:
            nibp_text = "---/---"
        _put_text(frame, nibp_text, lay.nibp_value_pos, 1.5, WHITE, 2)

        # Rhythm label at bottom of ECG area
        if self.rhythm_label:
            _put_text(frame, self.rhythm_label, lay.rhythm_label_pos, 0.45, DARK_GRAY, 1)

    def prefill(self):
        """Advance all sweep buffers through one screen-width of data.

        After calling this, the very first rendered frame will show a fully
        populated trace instead of an empty screen filling from the left.
        This makes GIF looping seamless.
        """
        trace_w = self.layout.ecg_area.w
        sig_len = len(self._ecg_norm)
        for p in range(trace_w):
            idx = int(p * self._samples_per_pixel) % sig_len
            self.ecg_sweep.advance(self._ecg_norm[idx])
            self.pleth_sweep.advance(self._pleth_norm[idx])
            self.etco2_sweep.advance(self._etco2_norm[idx])

            # Track beat markers during prefill
            if self._marker_visible is not None:
                self._marker_visible[p] = self._beat_at_sample[idx]

        self._pixel_base = float(trace_w)
        self._frame_count = 0

    def render_all_frames(self, duration: float | None = None,
                          n_frames: int | None = None) -> list[np.ndarray]:
        """Render all frames for the given duration or frame count.

        Parameters
        ----------
        duration : float or None
            Duration in seconds. Ignored if n_frames is provided.
        n_frames : int or None
            Exact number of frames to render. If None, computed from duration.

        Returns
        -------
        list of np.ndarray
            List of BGR frame arrays.
        """
        if n_frames is None:
            if duration is None:
                duration = len(self.ecg) / self.sr
            n_frames = int(duration * self.fps)

        frames = []
        for _ in range(n_frames):
            f = self.render_frame()
            if f is not None:
                frames.append(f)
        return frames


def export_gif(frames: list[np.ndarray], output_path: str, fps: int = 30, loop: int = 0):
    """Export frames to animated GIF.

    Parameters
    ----------
    frames : list of np.ndarray
        BGR frames from the renderer.
    output_path : str
        Output file path.
    fps : int
        Frame rate.
    loop : int
        Number of loops (0 = infinite).
    """
    pil_frames = []
    for f in frames:
        rgb = cv2.cvtColor(f, cv2.COLOR_BGR2RGB)
        pil_frames.append(Image.fromarray(rgb))

    duration_ms = int(1000 / fps)
    pil_frames[0].save(
        output_path,
        save_all=True,
        append_images=pil_frames[1:],
        duration=duration_ms,
        loop=loop,
        optimize=False,
    )


def export_mp4(frames: list[np.ndarray], output_path: str, fps: int = 30):
    """Export frames to MP4 video.

    Parameters
    ----------
    frames : list of np.ndarray
        BGR frames from the renderer.
    output_path : str
        Output file path.
    fps : int
        Frame rate.
    """
    h, w = frames[0].shape[:2]
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(output_path, fourcc, fps, (w, h))

    for f in frames:
        writer.write(f)

    writer.release()
