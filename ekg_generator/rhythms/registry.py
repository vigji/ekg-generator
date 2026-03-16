"""Rhythm configuration registry.

Each rhythm is defined as a RhythmConfig dataclass specifying which engine
to use and all relevant parameters. New rhythms are added by registering
new parameter sets — no new generator code needed for McSharry-based rhythms.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class RhythmConfig:
    """Defines a cardiac rhythm entirely through model parameters."""

    name: str

    # Which generator engine to use: "ecgsyn", "noise", "sinusoidal", "flatline"
    engine: str = "ecgsyn"

    # Heart rate / timing
    heart_rate: float = 70.0
    heart_rate_std: float = 1.0
    rr_irregularity: float = 0.0  # 0=regular; >0 for AFib-style irregularity

    # McSharry ECGSYN parameters (P, Q, R, S, T)
    ti: tuple = (-70, -15, 0, 15, 100)
    ai: tuple = (1.2, -5, 30, -7.5, 0.75)
    bi: tuple = (0.25, 0.1, 0.1, 0.1, 0.4)
    lfhfratio: float = 0.5
    noise: float = 0.01

    # Noise generator params (engine="noise")
    freq_low: float = 3.0
    freq_high: float = 9.0
    amplitude: float = 1.0

    # Sinusoidal params (engine="sinusoidal")
    amplitude_modulation: float = 0.0  # for torsades spindle effect

    # Additive features
    pacing_spikes: Optional[dict] = None
    fibrillatory_baseline: bool = False
    sawtooth_flutter: Optional[dict] = None
    baseline_wander: float = 0.05

    # RR scheduling mode: "regular", "irregular", "flutter"
    rr_mode: str = "regular"
    flutter_conduction_ratio: int = 4

    def with_overrides(self, **kwargs) -> RhythmConfig:
        """Return a copy with specified fields overridden."""
        d = {f.name: getattr(self, f.name) for f in self.__dataclass_fields__.values()}
        d.update(kwargs)
        return RhythmConfig(**d)


# ---------------------------------------------------------------------------
# Global rhythm registry
# ---------------------------------------------------------------------------

_REGISTRY: dict[str, RhythmConfig] = {}


def register(config: RhythmConfig) -> None:
    _REGISTRY[config.name] = config


def get(name: str) -> RhythmConfig:
    if name not in _REGISTRY:
        raise KeyError(f"Unknown rhythm: {name!r}. Available: {list(_REGISTRY.keys())}")
    return _REGISTRY[name]


def list_rhythms() -> list[str]:
    return list(_REGISTRY.keys())


# ---------------------------------------------------------------------------
# McSharry-based rhythms (parameter variation only)
# ---------------------------------------------------------------------------

register(RhythmConfig(
    name="normal_sinus",
    heart_rate=72,
    heart_rate_std=2.0,
))

register(RhythmConfig(
    name="sinus_tachycardia",
    heart_rate=130,
    heart_rate_std=3.0,
))

register(RhythmConfig(
    name="sinus_bradycardia",
    heart_rate=45,
    heart_rate_std=1.5,
))

register(RhythmConfig(
    name="svt",
    heart_rate=180,
    heart_rate_std=1.0,
    ai=(0.0, -5, 30, -7.5, 0.75),  # P wave amplitude → 0
    bi=(0.25, 0.1, 0.1, 0.1, 0.4),
))

register(RhythmConfig(
    name="junctional",
    heart_rate=50,
    heart_rate_std=1.0,
    ai=(0.0, -5, 30, -7.5, 0.75),  # no P waves
))

register(RhythmConfig(
    name="vt_monomorphic",
    heart_rate=170,
    heart_rate_std=2.0,
    ai=(0.0, -8, 30, -12, -1.5),        # no P, deep S, discordant inverted T
    bi=(0.25, 0.25, 0.22, 0.25, 0.55),  # much wider QRS — bizarre VT morphology
))

register(RhythmConfig(
    name="stemi",
    heart_rate=85,
    heart_rate_std=2.0,
    ti=(-70, -15, 0, 15, 55),     # T very close to S — ST merges into T
    ai=(1.2, -5, 30, -3, 5.0),    # small S, huge T — tombstone ST elevation
    bi=(0.25, 0.1, 0.1, 0.1, 0.6),
))

register(RhythmConfig(
    name="long_qt",
    heart_rate=65,
    heart_rate_std=1.5,
    ti=(-70, -15, 0, 15, 145),   # T wave further delayed
    ai=(1.2, -5, 30, -7.5, 1.8),  # taller T — prolonged QT more obvious
    bi=(0.25, 0.1, 0.1, 0.1, 0.75),  # wider T wave
))

register(RhythmConfig(
    name="lbbb",
    heart_rate=75,
    heart_rate_std=2.0,
    ai=(1.2, -2, 22, -12, -2.0),      # deeper S, deeper T inversion
    bi=(0.25, 0.20, 0.20, 0.20, 0.55),  # wider QRS — pronounced LBBB
))

register(RhythmConfig(
    name="rbbb",
    heart_rate=75,
    heart_rate_std=2.0,
    ai=(1.2, -5, 30, -6, -0.5),       # broad terminal S, discordant T
    bi=(0.25, 0.1, 0.12, 0.22, 0.45),  # wide slurred terminal S wave
))

register(RhythmConfig(
    name="agonal",
    heart_rate=25,
    heart_rate_std=5.0,
    ai=(0.0, -3, 15, -5, 0.3),       # no P, reduced amplitude
    bi=(0.25, 0.2, 0.2, 0.2, 0.6),   # very wide QRS
))

register(RhythmConfig(
    name="sinus_arrhythmia",
    heart_rate=70,
    heart_rate_std=8.0,  # high HRV
    lfhfratio=1.5,
))

# PVC template (used for inserting occasional PVCs into other rhythms)
register(RhythmConfig(
    name="pvc_beat",
    heart_rate=70,
    ai=(0.0, -8, 25, -10, -2.0),    # no P, tall/wide, inverted T
    bi=(0.25, 0.18, 0.18, 0.18, 0.5),
))

# ---------------------------------------------------------------------------
# Alternative generator rhythms
# ---------------------------------------------------------------------------

register(RhythmConfig(
    name="vfib_coarse",
    engine="noise",
    heart_rate=0,
    freq_low=3.0,
    freq_high=9.0,
    amplitude=1.0,
))

register(RhythmConfig(
    name="vfib_fine",
    engine="noise",
    heart_rate=0,
    freq_low=3.0,
    freq_high=9.0,
    amplitude=0.3,
))

register(RhythmConfig(
    name="vflutter",
    engine="sinusoidal",
    heart_rate=300,
    amplitude=1.0,
    amplitude_modulation=0.0,
))

register(RhythmConfig(
    name="torsades",
    engine="sinusoidal",
    heart_rate=230,
    amplitude=1.0,
    amplitude_modulation=0.75,  # deeper spindle modulation
))

register(RhythmConfig(
    name="asystole",
    engine="flatline",
    heart_rate=0,
))

# ---------------------------------------------------------------------------
# Composite rhythms (McSharry + additive features)
# ---------------------------------------------------------------------------

register(RhythmConfig(
    name="afib",
    heart_rate=110,
    heart_rate_std=2.0,
    rr_mode="irregular",
    rr_irregularity=0.18,
    ai=(0.0, -5, 30, -7.5, 0.75),  # no P waves
    fibrillatory_baseline=True,
))

register(RhythmConfig(
    name="aflutter",
    engine="aflutter",
    heart_rate=75,  # ventricular rate
    heart_rate_std=0.5,
    rr_mode="flutter",
    flutter_conduction_ratio=4,
    baseline_wander=0.01,
))

register(RhythmConfig(
    name="paced_vvi",
    heart_rate=70,
    heart_rate_std=0.5,
    ai=(0.0, -5, 25, -8, 0.5),         # no P, slightly modified QRS
    bi=(0.25, 0.15, 0.15, 0.15, 0.5),  # wider QRS
    pacing_spikes={"type": "vvi", "spike_amplitude": 3.0},
))

register(RhythmConfig(
    name="paced_ddd",
    heart_rate=70,
    heart_rate_std=0.5,
    pacing_spikes={"type": "ddd", "spike_amplitude": 3.0},
))

register(RhythmConfig(
    name="paced_aai",
    heart_rate=70,
    heart_rate_std=0.5,
    pacing_spikes={"type": "aai", "spike_amplitude": 3.0},
))
