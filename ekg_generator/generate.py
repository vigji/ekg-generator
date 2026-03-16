"""Main orchestrator: scenario → waveform → renderer → file.

This module ties together all layers:
1. Look up rhythm config from registry
2. Generate ECG signal via the appropriate engine
3. Apply additive features
4. Generate SpO2 pleth
5. Render animated monitor and export
"""

from __future__ import annotations

import numpy as np
from scipy.signal import butter, sosfiltfilt

from .rhythms.registry import RhythmConfig, get as get_rhythm
from .engine.ecgsyn import generate_ecgsyn
from .engine.noise import generate_vfib, generate_sinusoidal, generate_flatline, generate_aflutter
from .engine.scheduler import generate_rr_regular, generate_rr_irregular, generate_rr_flutter
from .engine.additive import (
    add_pacing_spikes,
    add_fibrillatory_baseline,
    add_sawtooth_flutter,
    add_baseline_wander,
)
from .engine.pleth import generate_pleth, generate_absent_pleth
from .engine.capno import generate_capnogram, generate_flat_capnogram
from .monitor.renderer import MonitorRenderer, export_gif, export_mp4
from .scenarios.presets import ClinicalScenario


SAMPLING_RATE = 500


def _highpass_filter(ecg: np.ndarray, sr: int, cutoff: float = 0.5) -> np.ndarray:
    """Remove DC offset / very-low-frequency drift from ECG.

    Uses a 2nd-order Butterworth highpass with zero-phase filtering.
    """
    sos = butter(2, cutoff, btype="high", fs=sr, output="sos")
    return sosfiltfilt(sos, ecg)


def _compute_actual_hr(beat_times: np.ndarray) -> float | None:
    """Compute actual heart rate from beat times as 60 / mean(diff)."""
    if beat_times is None or len(beat_times) < 2:
        return None
    intervals = np.diff(beat_times)
    return 60.0 / np.mean(intervals)


def generate_ecg_signal(
    config: RhythmConfig,
    duration: float,
    sampling_rate: int = SAMPLING_RATE,
    random_state: int | None = None,
) -> tuple[np.ndarray, np.ndarray | None]:
    """Generate ECG signal from a rhythm config.

    Returns
    -------
    ecg : np.ndarray
        The ECG signal.
    beat_times : np.ndarray or None
        Beat times in seconds (None for non-beat rhythms like VF/asystole).
    """
    rng = np.random.default_rng(random_state)

    # Generate beat times for scheduling
    beat_times = None
    if config.engine in ("ecgsyn", "aflutter"):
        if config.rr_mode == "irregular":
            beat_times = generate_rr_irregular(
                duration, config.heart_rate, config.rr_irregularity, rng=rng
            )
        elif config.rr_mode == "flutter":
            beat_times = generate_rr_flutter(
                duration, config.heart_rate, config.flutter_conduction_ratio, rng=rng
            )
        else:
            beat_times = generate_rr_regular(
                duration, config.heart_rate, config.heart_rate_std, rng=rng
            )

    # Generate base ECG
    if config.engine == "ecgsyn":
        ecg = generate_ecgsyn(
            duration=duration,
            sampling_rate=sampling_rate,
            heart_rate=config.heart_rate,
            heart_rate_std=config.heart_rate_std,
            ti=config.ti,
            ai=config.ai,
            bi=config.bi,
            lfhfratio=config.lfhfratio,
            noise=config.noise,
            random_state=int(rng.integers(0, 2**31)),
        )
    elif config.engine == "noise":
        ecg = generate_vfib(
            duration=duration,
            sampling_rate=sampling_rate,
            freq_low=config.freq_low,
            freq_high=config.freq_high,
            amplitude=config.amplitude,
            rng=rng,
        )
    elif config.engine == "sinusoidal":
        ecg = generate_sinusoidal(
            duration=duration,
            sampling_rate=sampling_rate,
            heart_rate=config.heart_rate,
            amplitude=config.amplitude,
            amplitude_modulation=config.amplitude_modulation,
            rng=rng,
        )
    elif config.engine == "aflutter":
        ecg = generate_aflutter(
            duration=duration,
            sampling_rate=sampling_rate,
            beat_times=beat_times,
            rng=rng,
        )
    elif config.engine == "flatline":
        ecg = generate_flatline(
            duration=duration,
            sampling_rate=sampling_rate,
            rng=rng,
        )
    else:
        raise ValueError(f"Unknown engine: {config.engine!r}")

    # Highpass filter to remove DC offset / drift (skip for flatline/aflutter)
    if config.engine not in ("flatline", "aflutter"):
        ecg = _highpass_filter(ecg, sampling_rate)

    # Apply additive features
    if config.fibrillatory_baseline:
        ecg = add_fibrillatory_baseline(ecg, sampling_rate, rng=rng)

    if config.sawtooth_flutter is not None:
        ecg = add_sawtooth_flutter(
            ecg, sampling_rate,
            flutter_rate=config.sawtooth_flutter.get("rate", 300),
            amplitude=config.sawtooth_flutter.get("amplitude", 0.3),
            beat_times=beat_times,
        )

    if config.pacing_spikes is not None and beat_times is not None:
        ecg = add_pacing_spikes(
            ecg, beat_times, sampling_rate,
            spike_type=config.pacing_spikes.get("type", "vvi"),
            spike_amplitude=config.pacing_spikes.get("spike_amplitude", 3.0),
            ti=config.ti,
        )

    if config.baseline_wander > 0:
        ecg = add_baseline_wander(ecg, sampling_rate, amplitude=config.baseline_wander, rng=rng)

    return ecg, beat_times


def generate_scenario(
    scenario: ClinicalScenario,
    output_path: str,
    duration: float = 8.0,
    fps: int = 30,
    format: str = "gif",
    random_state: int | None = None,
):
    """Generate a complete monitor animation from a clinical scenario.

    Parameters
    ----------
    scenario : ClinicalScenario
        The clinical scenario to render.
    output_path : str
        Output file path.
    duration : float
        Animation duration in seconds. For GIF output, the actual duration
        is snapped to a whole number of sweep cycles for seamless looping.
    fps : int
        Output frame rate.
    format : str
        "gif" or "mp4".
    random_state : int or None
        Random seed for reproducibility.
    """
    # Get rhythm config and apply overrides
    config = get_rhythm(scenario.rhythm)
    overrides = dict(scenario.rhythm_overrides)
    if scenario.heart_rate is not None:
        overrides["heart_rate"] = scenario.heart_rate
    if overrides:
        config = config.with_overrides(**overrides)

    sweep_speed = 25.0
    px_per_mm = 3.78
    trace_w = 600  # default layout trace width
    pixels_per_sample = sweep_speed * px_per_mm / SAMPLING_RATE
    samples_per_pixel = 1.0 / pixels_per_sample

    # Sweep period: time for the cursor to cross the full trace width
    sweep_duration = trace_w / (sweep_speed * px_per_mm)  # ~6.35s

    # For GIF: snap duration to whole sweeps so cursor wraps to position 0
    # This ensures seamless looping (no gap-position jump on restart)
    if format == "gif":
        n_sweeps = max(1, round(duration / sweep_duration))
        n_frames = round(n_sweeps * sweep_duration * fps)
        pixels_per_frame = n_sweeps * trace_w / n_frames
    else:
        n_sweeps = None
        n_frames = int(duration * fps)
        pixels_per_frame = None  # use default from renderer

    # Signal length: for GIF, use circular length so modular indexing wraps
    # the last sweep back to the same data as the prefill (first sweep).
    # Generate slightly more than needed and trim.
    if n_sweeps is not None:
        circular_len = int(n_sweeps * trace_w * samples_per_pixel)
        signal_duration = circular_len / SAMPLING_RATE + 1.0  # +1s buffer
    else:
        signal_duration = duration + sweep_duration + 1.0  # prefill + animation + buffer

    # Generate ECG
    ecg, beat_times = generate_ecg_signal(config, signal_duration, SAMPLING_RATE, random_state)

    # Generate pleth
    has_pulse = config.engine in ("ecgsyn", "aflutter") and config.heart_rate > 30
    if has_pulse and scenario.spo2 is not None:
        pleth = generate_pleth(
            signal_duration, SAMPLING_RATE, beat_times,
            heart_rate=config.heart_rate,
            rng=np.random.default_rng(random_state),
        )
    else:
        pleth = generate_absent_pleth(signal_duration, SAMPLING_RATE)

    # Generate ETCO2 capnography
    rng_capno = np.random.default_rng(random_state)
    if scenario.intubated and scenario.etco2 is not None:
        etco2_signal = generate_capnogram(
            signal_duration, SAMPLING_RATE,
            respiratory_rate=scenario.respiratory_rate,
            etco2_mmhg=scenario.etco2,
            rng=rng_capno,
        )
        display_etco2 = scenario.etco2
    else:
        etco2_signal = generate_flat_capnogram(signal_duration, SAMPLING_RATE, rng=rng_capno)
        display_etco2 = None

    # Trim signals to circular length for seamless GIF wrapping
    if n_sweeps is not None:
        ecg = ecg[:circular_len]
        pleth = pleth[:circular_len]
        etco2_signal = etco2_signal[:circular_len]
        if beat_times is not None:
            beat_times = beat_times[beat_times < circular_len / SAMPLING_RATE]

    # Determine display HR from actual signal, not config
    if config.engine in ("ecgsyn", "aflutter"):
        display_hr = _compute_actual_hr(beat_times)
    elif config.engine == "sinusoidal":
        display_hr = config.heart_rate  # deterministic, matches exactly
    else:
        display_hr = None  # noise/flatline: unmeasurable

    # Render
    renderer = MonitorRenderer(
        ecg_signal=ecg,
        pleth_signal=pleth,
        sampling_rate=SAMPLING_RATE,
        heart_rate=display_hr,
        spo2=scenario.spo2,
        nibp_sys=scenario.nibp_sys,
        nibp_dia=scenario.nibp_dia,
        rhythm_label=scenario.name,
        fps=fps,
        etco2_signal=etco2_signal,
        etco2=display_etco2,
        pixels_per_frame=pixels_per_frame,
        beat_times=beat_times if scenario.show_beat_markers else None,
        show_beat_markers=scenario.show_beat_markers,
    )

    # Prefill sweep buffers so frame 0 is fully populated
    renderer.prefill()
    frames = renderer.render_all_frames(n_frames=n_frames)

    if format == "gif":
        export_gif(frames, output_path, fps=fps)
    elif format == "mp4":
        export_mp4(frames, output_path, fps=fps)
    else:
        raise ValueError(f"Unknown format: {format!r}")

    return output_path
