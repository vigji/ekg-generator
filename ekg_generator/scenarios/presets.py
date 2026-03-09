"""Clinical scenario presets.

Each preset defines a complete clinical scenario including rhythm, vitals,
and display parameters. These map to common clinical teaching cases.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ClinicalScenario:
    """A complete clinical scenario for the monitor display."""

    name: str
    rhythm: str  # key into rhythm registry
    heart_rate: Optional[float] = None  # override rhythm default if needed
    spo2: Optional[int] = None  # None = unmeasurable ("---")
    nibp_sys: Optional[int] = None
    nibp_dia: Optional[int] = None
    rhythm_overrides: dict = field(default_factory=dict)
    intubated: bool = False
    etco2: Optional[int] = None  # ETCO2 value in mmHg (None = "---")
    respiratory_rate: float = 14.0
    show_beat_markers: bool = False  # R-wave sync triangle markers


# ---------------------------------------------------------------------------
# Preset library
# ---------------------------------------------------------------------------

PRESETS: dict[str, ClinicalScenario] = {}


def _reg(s: ClinicalScenario):
    PRESETS[s.name] = s


# --- Normal / stable ---
_reg(ClinicalScenario(
    name="Normal Sinus Rhythm",
    rhythm="normal_sinus",
    heart_rate=72,
    spo2=98,
    nibp_sys=120,
    nibp_dia=80,
))

# --- Tachycardias ---
_reg(ClinicalScenario(
    name="Sinus Tachycardia",
    rhythm="sinus_tachycardia",
    heart_rate=130,
    spo2=96,
    nibp_sys=105,
    nibp_dia=70,
))

_reg(ClinicalScenario(
    name="SVT / AVNRT",
    rhythm="svt",
    heart_rate=180,
    spo2=94,
    nibp_sys=90,
    nibp_dia=60,
))

_reg(ClinicalScenario(
    name="Ventricular Tachycardia",
    rhythm="vt_monomorphic",
    heart_rate=170,
    spo2=85,
    nibp_sys=70,
    nibp_dia=40,
))

# --- Bradycardias ---
_reg(ClinicalScenario(
    name="Sinus Bradycardia",
    rhythm="sinus_bradycardia",
    heart_rate=45,
    spo2=97,
    nibp_sys=100,
    nibp_dia=65,
))

_reg(ClinicalScenario(
    name="Junctional Rhythm",
    rhythm="junctional",
    heart_rate=50,
    spo2=96,
    nibp_sys=95,
    nibp_dia=60,
))

# --- Atrial rhythms ---
_reg(ClinicalScenario(
    name="Atrial Fibrillation",
    rhythm="afib",
    heart_rate=110,
    spo2=95,
    nibp_sys=115,
    nibp_dia=75,
))

_reg(ClinicalScenario(
    name="Atrial Flutter",
    rhythm="aflutter",
    heart_rate=75,
    spo2=96,
    nibp_sys=110,
    nibp_dia=70,
))

# --- Arrest / peri-arrest ---
_reg(ClinicalScenario(
    name="Ventricular Fibrillation (Coarse)",
    rhythm="vfib_coarse",
    spo2=None,
    nibp_sys=None,
    nibp_dia=None,
))

_reg(ClinicalScenario(
    name="Ventricular Fibrillation (Fine)",
    rhythm="vfib_fine",
    spo2=None,
    nibp_sys=None,
    nibp_dia=None,
))

_reg(ClinicalScenario(
    name="Ventricular Flutter",
    rhythm="vflutter",
    spo2=None,
    nibp_sys=None,
    nibp_dia=None,
))

_reg(ClinicalScenario(
    name="Torsades de Pointes",
    rhythm="torsades",
    spo2=None,
    nibp_sys=None,
    nibp_dia=None,
))

_reg(ClinicalScenario(
    name="Asystole",
    rhythm="asystole",
    spo2=None,
    nibp_sys=None,
    nibp_dia=None,
))

_reg(ClinicalScenario(
    name="Agonal Rhythm",
    rhythm="agonal",
    heart_rate=25,
    spo2=None,
    nibp_sys=None,
    nibp_dia=None,
))

# --- Conduction / morphology ---
_reg(ClinicalScenario(
    name="STEMI",
    rhythm="stemi",
    heart_rate=85,
    spo2=96,
    nibp_sys=130,
    nibp_dia=85,
))

_reg(ClinicalScenario(
    name="Long QT Syndrome",
    rhythm="long_qt",
    heart_rate=65,
    spo2=98,
    nibp_sys=118,
    nibp_dia=76,
))

_reg(ClinicalScenario(
    name="Left Bundle Branch Block",
    rhythm="lbbb",
    heart_rate=75,
    spo2=97,
    nibp_sys=125,
    nibp_dia=80,
))

_reg(ClinicalScenario(
    name="Right Bundle Branch Block",
    rhythm="rbbb",
    heart_rate=75,
    spo2=97,
    nibp_sys=122,
    nibp_dia=78,
))

# --- Paced rhythms ---
_reg(ClinicalScenario(
    name="Paced VVI",
    rhythm="paced_vvi",
    heart_rate=70,
    spo2=97,
    nibp_sys=115,
    nibp_dia=72,
))

_reg(ClinicalScenario(
    name="Paced DDD",
    rhythm="paced_ddd",
    heart_rate=70,
    spo2=98,
    nibp_sys=120,
    nibp_dia=75,
))

_reg(ClinicalScenario(
    name="Paced AAI",
    rhythm="paced_aai",
    heart_rate=70,
    spo2=97,
    nibp_sys=118,
    nibp_dia=74,
))

# --- Other ---
_reg(ClinicalScenario(
    name="Sinus Arrhythmia",
    rhythm="sinus_arrhythmia",
    heart_rate=70,
    spo2=98,
    nibp_sys=118,
    nibp_dia=76,
))

# --- Intubated presets ---
_reg(ClinicalScenario(
    name="Normal Sinus Rhythm (Intubated)",
    rhythm="normal_sinus",
    heart_rate=72,
    spo2=99,
    nibp_sys=120,
    nibp_dia=80,
    intubated=True,
    etco2=35,
    respiratory_rate=14.0,
))

_reg(ClinicalScenario(
    name="Sinus Tachycardia (Intubated)",
    rhythm="sinus_tachycardia",
    heart_rate=130,
    spo2=97,
    nibp_sys=105,
    nibp_dia=70,
    intubated=True,
    etco2=30,
    respiratory_rate=20.0,
))

_reg(ClinicalScenario(
    name="Sinus Bradycardia (Intubated)",
    rhythm="sinus_bradycardia",
    heart_rate=45,
    spo2=98,
    nibp_sys=100,
    nibp_dia=65,
    intubated=True,
    etco2=38,
    respiratory_rate=12.0,
))


def list_presets() -> list[str]:
    return list(PRESETS.keys())


def get_preset(name: str) -> ClinicalScenario:
    if name not in PRESETS:
        raise KeyError(f"Unknown preset: {name!r}. Available: {list(PRESETS.keys())}")
    return PRESETS[name]
