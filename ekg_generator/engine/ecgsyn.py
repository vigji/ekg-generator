"""McSharry ECGSYN wrapper around NeuroKit2.

Generates ECG signals using the ECGSYN dynamical model (McSharry et al., 2003)
with full control over the 15 Gaussian attractor parameters (ti, ai, bi).
"""

import numpy as np
import neurokit2 as nk


def generate_ecgsyn(
    duration: float,
    sampling_rate: int = 500,
    heart_rate: float = 70,
    heart_rate_std: float = 1.0,
    ti: tuple = (-70, -15, 0, 15, 100),
    ai: tuple = (1.2, -5, 30, -7.5, 0.75),
    bi: tuple = (0.25, 0.1, 0.1, 0.1, 0.4),
    lfhfratio: float = 0.5,
    noise: float = 0.01,
    random_state: int | None = None,
) -> np.ndarray:
    """Generate an ECG signal using the McSharry ECGSYN model.

    Parameters
    ----------
    duration : float
        Signal duration in seconds.
    sampling_rate : int
        Output sampling rate in Hz.
    heart_rate : float
        Mean heart rate in bpm.
    heart_rate_std : float
        Heart rate standard deviation in bpm.
    ti : tuple of 5 floats
        Angular positions of P, Q, R, S, T extrema in degrees.
    ai : tuple of 5 floats
        Amplitudes (z-position) of P, Q, R, S, T extrema.
    bi : tuple of 5 floats
        Gaussian widths of P, Q, R, S, T peaks.
    lfhfratio : float
        LF/HF ratio for heart rate variability.
    noise : float
        Amplitude of additive noise.
    random_state : int or None
        Random seed for reproducibility.

    Returns
    -------
    np.ndarray
        ECG signal array of shape (duration * sampling_rate,).
    """
    signal = nk.ecg_simulate(
        duration=int(round(duration)),
        length=int(round(duration * sampling_rate)),
        sampling_rate=sampling_rate,
        heart_rate=heart_rate,
        heart_rate_std=heart_rate_std,
        method="ecgsyn",
        ti=ti,
        ai=ai,
        bi=bi,
        lfhfratio=lfhfratio,
        noise=noise,
        random_state=random_state,
    )
    return np.asarray(signal, dtype=np.float64)
