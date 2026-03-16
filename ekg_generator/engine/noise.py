"""Alternative rhythm generators for non-ECGSYN rhythms.

Covers:
- Ventricular fibrillation (band-limited noise)
- Ventricular flutter (sinusoidal)
- Torsades de Pointes (amplitude-modulated sinusoid)
- Asystole (flat line with minimal noise)
"""

import numpy as np
from scipy import signal as sp_signal


def generate_vfib(
    duration: float,
    sampling_rate: int = 500,
    freq_low: float = 3.0,
    freq_high: float = 9.0,
    amplitude: float = 1.0,
    rng: np.random.Generator | None = None,
) -> np.ndarray:
    """Generate ventricular fibrillation as band-limited noise.

    Parameters
    ----------
    amplitude : float
        Peak amplitude. Use ~1.0 for coarse VF, ~0.3 for fine VF.
    """
    if rng is None:
        rng = np.random.default_rng()

    n_samples = int(duration * sampling_rate)
    white_noise = rng.standard_normal(n_samples)

    # Design band-pass filter
    nyq = sampling_rate / 2.0
    low = freq_low / nyq
    high = min(freq_high / nyq, 0.99)
    sos = sp_signal.butter(4, [low, high], btype="band", output="sos")
    filtered = sp_signal.sosfilt(sos, white_noise)

    # Normalize and scale
    filtered = filtered / np.max(np.abs(filtered)) * amplitude
    return filtered


def generate_sinusoidal(
    duration: float,
    sampling_rate: int = 500,
    heart_rate: float = 300.0,
    amplitude: float = 1.0,
    amplitude_modulation: float = 0.0,
    rng: np.random.Generator | None = None,
) -> np.ndarray:
    """Generate sinusoidal rhythm (ventricular flutter, torsades).

    Parameters
    ----------
    heart_rate : float
        Oscillation rate in bpm.
    amplitude_modulation : float
        Depth of spindle-shaped amplitude modulation (0-1).
        Use >0 for torsades de pointes effect.
    """
    if rng is None:
        rng = np.random.default_rng()

    n_samples = int(duration * sampling_rate)
    t = np.arange(n_samples) / sampling_rate
    freq = heart_rate / 60.0

    wave = amplitude * np.sin(2 * np.pi * freq * t)

    if amplitude_modulation > 0:
        # ~2 spindles per 6s sweep for realistic TdP appearance
        mod_freq = 2.0 / duration * 2
        # Use squared cosine for asymmetric envelope (near-zero between spindles)
        cos_env = np.cos(2 * np.pi * mod_freq * t)
        envelope = 1.0 - amplitude_modulation * cos_env**2
        wave = wave * envelope

        # Add slight irregularity to break pure sinusoidal uniformity
        noise = rng.normal(0, 0.04 * amplitude, n_samples)
        wave = wave + noise

    return wave


def generate_flatline(
    duration: float,
    sampling_rate: int = 500,
    noise_amplitude: float = 0.001,
    rng: np.random.Generator | None = None,
) -> np.ndarray:
    """Generate asystole (flat line with negligible noise)."""
    if rng is None:
        rng = np.random.default_rng()

    n_samples = int(duration * sampling_rate)
    return rng.normal(0, noise_amplitude, size=n_samples)
