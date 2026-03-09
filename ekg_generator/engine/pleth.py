"""SpO2 plethysmography waveform generator.

Generates a realistic pulse oximetry waveform synced to R-peaks
with a configurable delay (pulse transit time).
"""

import numpy as np
from scipy import signal as sp_signal


def _pleth_pulse(n_samples: int) -> np.ndarray:
    """Generate a single pleth pulse with a smooth, rounded shape.

    Uses an asymmetric Gaussian for a naturally rounded systolic peak
    with a subtle dicrotic notch, matching bedside-monitor appearance.

    Parameters
    ----------
    n_samples : int
        Number of samples for this pulse.

    Returns
    -------
    np.ndarray
        Single pulse waveform, peak ~1.0, starts and ends near 0.
    """
    if n_samples < 10:
        return np.zeros(n_samples)

    t = np.linspace(0, 1, n_samples)

    # Main systolic peak: split-Gaussian (different width per side)
    # gives a naturally smooth, rounded peak with fast rise and gradual decay
    peak_pos = 0.22
    sigma = np.where(t <= peak_pos, 0.08, 0.18)
    systolic = np.exp(-0.5 * ((t - peak_pos) / sigma) ** 2)

    # Exponential decay envelope ensures return to baseline
    envelope = np.where(t > peak_pos, np.exp(-1.5 * (t - peak_pos)), 1.0)

    pulse = systolic * envelope

    # Dicrotic notch: subtle dip then secondary bump
    pulse -= 0.06 * np.exp(-0.5 * ((t - 0.45) / 0.03) ** 2)
    pulse += 0.10 * np.exp(-0.5 * ((t - 0.50) / 0.05) ** 2)

    # Taper edges to ensure clean start and end at zero
    pulse *= np.minimum(t / 0.05, 1.0) * np.minimum((1 - t) / 0.10, 1.0)
    pulse = np.maximum(pulse, 0)

    # Normalize peak to 1.0
    p_max = pulse.max()
    if p_max > 0:
        pulse = pulse / p_max

    return pulse


def generate_pleth(
    duration: float,
    sampling_rate: int = 500,
    beat_times: np.ndarray | None = None,
    heart_rate: float = 70.0,
    delay_ms: float = 200.0,
    amplitude: float = 0.6,
    rng: np.random.Generator | None = None,
) -> np.ndarray:
    """Generate plethysmography waveform synced to heartbeats.

    Parameters
    ----------
    duration : float
        Signal duration in seconds.
    sampling_rate : int
        Output sampling rate.
    beat_times : np.ndarray or None
        R-peak times in seconds. If None, generates regular beat times from heart_rate.
    heart_rate : float
        Used only if beat_times is None.
    delay_ms : float
        Pulse transit time delay from R-peak in milliseconds.
    amplitude : float
        Peak amplitude of pleth wave.

    Returns
    -------
    np.ndarray
        Plethysmography signal.
    """
    if rng is None:
        rng = np.random.default_rng()

    n_samples = int(duration * sampling_rate)
    pleth = np.zeros(n_samples)

    if beat_times is None:
        rr = 60.0 / heart_rate
        beat_times = np.arange(0.2, duration, rr)

    delay_s = delay_ms / 1000.0

    for i, bt in enumerate(beat_times):
        pulse_start = bt + delay_s
        start_idx = int(pulse_start * sampling_rate)
        if start_idx >= n_samples:
            break

        # Compute local RR interval from actual adjacent beats
        if i + 1 < len(beat_times):
            rr_local = beat_times[i + 1] - beat_times[i]
        elif i > 0:
            rr_local = beat_times[i] - beat_times[i - 1]
        else:
            rr_local = 60.0 / heart_rate

        pulse_duration = min(rr_local * 0.85, 0.7)
        n_pulse = int(pulse_duration * sampling_rate)

        if n_pulse < 10:
            continue

        pulse = amplitude * _pleth_pulse(n_pulse)

        # Add to signal
        end_idx = min(start_idx + n_pulse, n_samples)
        actual_len = end_idx - start_idx
        if start_idx >= 0 and actual_len > 0:
            pleth[start_idx:end_idx] += pulse[:actual_len]

    return pleth


def generate_absent_pleth(
    duration: float,
    sampling_rate: int = 500,
    noise_amplitude: float = 0.001,
    rng: np.random.Generator | None = None,
) -> np.ndarray:
    """Generate absent/unmeasurable pleth (for VF, asystole, etc.)."""
    if rng is None:
        rng = np.random.default_rng()
    n_samples = int(duration * sampling_rate)
    return rng.normal(0, noise_amplitude, size=n_samples)
