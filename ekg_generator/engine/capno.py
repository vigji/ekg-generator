"""Capnography (ETCO2) waveform generator.

Generates a realistic capnogram waveform with 4 phases per breath:
  Phase I   - Baseline (dead space gas, ~0 mmHg CO2)
  Phase II  - Sigmoid upstroke (alveolar gas mixing)
  Phase III - Alveolar plateau (slight upslope to ETCO2)
  Phase IV  - Sharp downstroke (inspiration begins)
"""

import numpy as np


def _single_breath(n_samples: int, etco2: float = 35.0) -> np.ndarray:
    """Generate one breath cycle capnogram.

    Parameters
    ----------
    n_samples : int
        Number of samples for this breath.
    etco2 : float
        End-tidal CO2 in mmHg (peak plateau value).

    Returns
    -------
    np.ndarray
        Single breath waveform in mmHg.
    """
    if n_samples < 10:
        return np.zeros(n_samples)

    t = np.linspace(0, 1, n_samples)

    # Smooth "mesa" capnogram using product of two tanh sigmoids.
    # This produces steep but rounded transitions (no discontinuities)
    # matching real capnogram monitors.
    steepness = 80.0
    rise_center = 0.08   # center of upstroke transition
    fall_center = 0.64   # center of downstroke transition

    rise = 0.5 * (1.0 + np.tanh(steepness * (t - rise_center)))
    fall = 0.5 * (1.0 + np.tanh(steepness * (fall_center - t)))

    # Product of two sigmoids gives a smooth mesa envelope
    envelope = rise * fall

    # Slight alveolar plateau upslope (~5%).
    # No clip — the envelope is ~0 outside the plateau so out-of-range
    # ramp values are naturally masked, avoiding any derivative kink.
    ramp = (t - rise_center) / (fall_center - rise_center)
    envelope = envelope * (1.0 + 0.05 * ramp)

    # Scale so peak equals exact etco2 value
    peak = envelope.max()
    if peak > 0:
        wave = etco2 * (envelope / peak)
    else:
        wave = np.zeros(n_samples)

    return wave


def generate_capnogram(
    duration: float,
    sampling_rate: int = 500,
    respiratory_rate: float = 14.0,
    etco2_mmhg: float = 35.0,
    rng: np.random.Generator | None = None,
) -> np.ndarray:
    """Generate a full capnography waveform (intubated patient).

    Parameters
    ----------
    duration : float
        Signal duration in seconds.
    sampling_rate : int
        Output sampling rate.
    respiratory_rate : float
        Breaths per minute.
    etco2_mmhg : float
        End-tidal CO2 value in mmHg.
    rng : np.random.Generator or None
        Random generator for breath-to-breath variability.

    Returns
    -------
    np.ndarray
        Capnogram signal in mmHg.
    """
    if rng is None:
        rng = np.random.default_rng()

    n_samples = int(duration * sampling_rate)
    capno = np.zeros(n_samples)

    breath_period = 60.0 / respiratory_rate
    pos = 0

    while pos < n_samples:
        # Small breath-to-breath variability
        period_var = breath_period * (1.0 + rng.normal(0, 0.03))
        n_breath = int(period_var * sampling_rate)
        if n_breath < 10:
            break

        etco2_var = etco2_mmhg * (1.0 + rng.normal(0, 0.02))
        breath = _single_breath(n_breath, etco2_var)

        end = min(pos + n_breath, n_samples)
        actual = end - pos
        capno[pos:end] = breath[:actual]
        pos = end

    return capno


def generate_flat_capnogram(
    duration: float,
    sampling_rate: int = 500,
    noise_amplitude: float = 0.01,
    rng: np.random.Generator | None = None,
) -> np.ndarray:
    """Generate flat capnogram (non-intubated patient, no measurable ETCO2).

    Parameters
    ----------
    duration : float
        Signal duration in seconds.
    sampling_rate : int
        Output sampling rate.
    noise_amplitude : float
        Small noise amplitude in mmHg.

    Returns
    -------
    np.ndarray
        Near-flat capnogram signal.
    """
    if rng is None:
        rng = np.random.default_rng()
    n_samples = int(duration * sampling_rate)
    return rng.normal(0, noise_amplitude, size=n_samples)
