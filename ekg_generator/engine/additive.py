"""Additive waveform features layered on top of base ECG signals.

Features:
- Pacing spikes (VVI, DDD, AAI)
- Fibrillatory baseline (AFib)
- Sawtooth flutter waves (atrial flutter)
- Baseline wander (respiratory artifact)
"""

import numpy as np
from scipy import signal as sp_signal


def _detect_r_peaks(ecg: np.ndarray, sampling_rate: int) -> np.ndarray:
    """Detect R-peak sample indices from an ECG signal."""
    # Minimum distance between peaks: 300ms (200 bpm max)
    min_distance = int(0.3 * sampling_rate)
    # Threshold: peaks must be at least 40% of the max amplitude
    threshold = 0.4 * np.max(ecg)
    peaks, _ = sp_signal.find_peaks(ecg, height=threshold, distance=min_distance)
    return peaks


def add_pacing_spikes(
    ecg: np.ndarray,
    beat_times: np.ndarray,
    sampling_rate: int,
    spike_type: str = "vvi",
    spike_amplitude: float = 3.0,
    spike_width_ms: float = 4.0,
    ti: tuple = (-70, -15, 0, 15, 100),
) -> np.ndarray:
    """Add pacing spikes to an ECG signal.

    Detects actual R-peaks in the ECG signal and places spikes relative
    to those, ensuring spikes are always correctly positioned before the QRS.

    Parameters
    ----------
    ecg : np.ndarray
        Base ECG signal.
    beat_times : np.ndarray
        Array of scheduled beat times in seconds (used as fallback).
    sampling_rate : int
        Sampling rate in Hz.
    spike_type : str
        "vvi" (ventricular only), "ddd" (atrial + ventricular), "aai" (atrial only).
    spike_amplitude : float
        Height of pacing spike.
    spike_width_ms : float
        Width of pacing spike in milliseconds.
    ti : tuple
        ECGSYN angular positions (used to estimate P wave offset from R peak).
    """
    result = ecg.copy()
    spike_width_samples = max(2, int(spike_width_ms * sampling_rate / 1000))

    # Detect actual R-peaks from the ECG signal
    r_peak_indices = _detect_r_peaks(ecg, sampling_rate)
    if len(r_peak_indices) == 0:
        # Fallback to scheduled beat_times if detection fails
        r_peak_indices = (beat_times * sampling_rate).astype(int)

    for r_idx in r_peak_indices:
        # Ventricular spike: 60ms before R peak
        if spike_type in ("vvi", "ddd"):
            v_idx = r_idx - int(0.06 * sampling_rate)
            if 0 <= v_idx < len(result) - spike_width_samples:
                result[v_idx:v_idx + spike_width_samples] = spike_amplitude

        # Atrial spike: before the P wave (~250ms before R)
        if spike_type in ("ddd", "aai"):
            a_idx = r_idx - int(0.25 * sampling_rate)
            if 0 <= a_idx < len(result) - spike_width_samples:
                result[a_idx:a_idx + spike_width_samples] = spike_amplitude * 0.6

    return result


def add_fibrillatory_baseline(
    ecg: np.ndarray,
    sampling_rate: int,
    amplitude: float = 0.08,
    freq_low: float = 4.0,
    freq_high: float = 8.0,
    rng: np.random.Generator | None = None,
) -> np.ndarray:
    """Add fibrillatory baseline undulation (f-waves) for AFib."""
    if rng is None:
        rng = np.random.default_rng()

    n_samples = len(ecg)
    noise = rng.standard_normal(n_samples)

    nyq = sampling_rate / 2.0
    low = freq_low / nyq
    high = min(freq_high / nyq, 0.99)
    sos = sp_signal.butter(3, [low, high], btype="band", output="sos")
    f_waves = sp_signal.sosfilt(sos, noise)

    # Normalize
    f_waves = f_waves / np.max(np.abs(f_waves)) * amplitude
    return ecg + f_waves


def add_sawtooth_flutter(
    ecg: np.ndarray,
    sampling_rate: int,
    flutter_rate: float = 300.0,
    amplitude: float = 0.3,
) -> np.ndarray:
    """Add sawtooth flutter waves for atrial flutter."""
    n_samples = len(ecg)
    t = np.arange(n_samples) / sampling_rate
    freq = flutter_rate / 60.0  # convert bpm to Hz

    # Sawtooth wave: rises slowly, drops sharply (inverted sawtooth)
    flutter = -amplitude * sp_signal.sawtooth(2 * np.pi * freq * t, width=0.7)
    return ecg + flutter


def add_baseline_wander(
    ecg: np.ndarray,
    sampling_rate: int,
    amplitude: float = 0.05,
    freq: float = 0.2,
    rng: np.random.Generator | None = None,
) -> np.ndarray:
    """Add low-frequency baseline wander (respiratory artifact)."""
    if rng is None:
        rng = np.random.default_rng()

    n_samples = len(ecg)
    t = np.arange(n_samples) / sampling_rate
    phase = rng.uniform(0, 2 * np.pi)
    wander = amplitude * np.sin(2 * np.pi * freq * t + phase)
    return ecg + wander
