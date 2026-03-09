"""RR interval scheduling for different rhythm types.

Supports regular intervals, irregular intervals (AFib), and
integer-ratio intervals (atrial flutter with variable block).
"""

import numpy as np


def generate_rr_regular(
    duration: float,
    heart_rate: float,
    heart_rate_std: float = 1.0,
    rng: np.random.Generator | None = None,
) -> np.ndarray:
    """Generate regular RR intervals with slight HRV.

    Returns array of beat times in seconds.
    """
    if rng is None:
        rng = np.random.default_rng()

    mean_rr = 60.0 / heart_rate
    # Estimate number of beats needed, with margin
    n_beats = int(duration / mean_rr) + 10
    rr_std = (heart_rate_std / heart_rate) * mean_rr
    rr_intervals = rng.normal(mean_rr, max(rr_std, 0.001), size=n_beats)
    rr_intervals = np.clip(rr_intervals, mean_rr * 0.7, mean_rr * 1.3)

    beat_times = np.cumsum(rr_intervals)
    # Start from a small offset so the first beat is visible
    beat_times = beat_times - beat_times[0] + 0.2
    return beat_times[beat_times < duration]


def generate_rr_irregular(
    duration: float,
    heart_rate: float,
    irregularity: float = 0.15,
    rng: np.random.Generator | None = None,
) -> np.ndarray:
    """Generate irregular RR intervals (e.g., for atrial fibrillation).

    The irregularity parameter controls the coefficient of variation of
    RR intervals. Typical AFib uses 0.15-0.20.
    """
    if rng is None:
        rng = np.random.default_rng()

    mean_rr = 60.0 / heart_rate
    n_beats = int(duration / mean_rr) + 10
    rr_std = mean_rr * irregularity
    rr_intervals = rng.normal(mean_rr, rr_std, size=n_beats)
    rr_intervals = np.clip(rr_intervals, mean_rr * 0.4, mean_rr * 2.0)

    beat_times = np.cumsum(rr_intervals)
    beat_times = beat_times - beat_times[0] + 0.2
    return beat_times[beat_times < duration]


def generate_rr_flutter(
    duration: float,
    ventricular_rate: float,
    conduction_ratio: int = 4,
    rng: np.random.Generator | None = None,
) -> np.ndarray:
    """Generate RR intervals for atrial flutter with integer conduction ratio.

    Parameters
    ----------
    ventricular_rate : float
        Approximate ventricular rate in bpm.
    conduction_ratio : int
        Atrial flutter waves per QRS (typically 2:1, 3:1, or 4:1).
    """
    if rng is None:
        rng = np.random.default_rng()

    mean_rr = 60.0 / ventricular_rate
    n_beats = int(duration / mean_rr) + 10
    # Small jitter for realism
    rr_intervals = rng.normal(mean_rr, mean_rr * 0.02, size=n_beats)
    rr_intervals = np.clip(rr_intervals, mean_rr * 0.85, mean_rr * 1.15)

    beat_times = np.cumsum(rr_intervals)
    beat_times = beat_times - beat_times[0] + 0.2
    return beat_times[beat_times < duration]
