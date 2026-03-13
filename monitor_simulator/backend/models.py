"""Pydantic models for the monitor simulator state."""

from pydantic import BaseModel, Field
from typing import Optional


class MonitorState(BaseModel):
    """Current state of the patient monitor, controlled by the operator."""

    # ECG
    rhythm: str = Field(default="sinus_rhythm", description="Current ECG rhythm type")
    heart_rate: int = Field(default=72, ge=20, le=250, description="Heart rate in bpm")
    sync_mode: bool = Field(default=False, description="SYNC marker display for cardioversion")

    # Blood pressure
    systolic: int = Field(default=120, ge=30, le=300, description="Systolic BP mmHg")
    diastolic: int = Field(default=80, ge=10, le=200, description="Diastolic BP mmHg")

    # SpO2
    spo2: int = Field(default=98, ge=50, le=100, description="Oxygen saturation %")

    # Capnography
    etco2: int = Field(default=35, ge=0, le=80, description="End-tidal CO2 mmHg")

    # Respiratory rate (derived, for capnography timing)
    respiratory_rate: int = Field(default=14, ge=4, le=40, description="Respiratory rate bpm")


# All supported rhythm types
RHYTHM_TYPES = [
    {"id": "sinus_rhythm", "label": "Sinus Rhythm"},
    {"id": "sinus_tachycardia", "label": "Sinus Tachycardia"},
    {"id": "atrial_fibrillation", "label": "Atrial Fibrillation (AF)"},
    {"id": "atrial_flutter", "label": "Atrial Flutter"},
    {"id": "atrial_tachycardia", "label": "Atrial Tachycardia (AT)"},
    {"id": "psvt", "label": "Paroxysmal SVT (PSVT)"},
    {"id": "junctional", "label": "Junctional Rhythm"},
    {"id": "vt_monomorphic", "label": "Ventricular Tachycardia (Monomorphic)"},
    {"id": "vt_polymorphic", "label": "Ventricular Tachycardia (Polymorphic)"},
    {"id": "ventricular_fibrillation", "label": "Ventricular Fibrillation (VF)"},
    {"id": "asystole", "label": "Asystole"},
    {"id": "agonal", "label": "Agonal Rhythm"},
    {"id": "pacemaker", "label": "Pacemaker Rhythm"},
    {"id": "av_block_1", "label": "AV Block I"},
    {"id": "av_block_2", "label": "AV Block II"},
    {"id": "av_block_3", "label": "AV Block III"},
]
