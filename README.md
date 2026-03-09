# EKG Generator

A patient monitor simulator that generates realistic animated ECG, SpO2 plethysmography, and ETCO2 capnography waveforms for clinical education.

Outputs looping GIF or MP4 animations of a bedside monitor display with configurable rhythms, vitals, and clinical scenarios.

## Quick Start

```bash
# Install
pip install -e .

# Generate all preset scenarios
python scripts/demo.py
# → output/ directory with 24 GIF animations
```

## Generating a Single Scenario

```python
from ekg_generator.scenarios.presets import get_preset
from ekg_generator.generate import generate_scenario

scenario = get_preset("Normal Sinus Rhythm (Intubated)")
generate_scenario(scenario, "output.gif", duration=8.0, fps=25, random_state=42)
```

### Available Presets

| Preset | Rhythm | HR | SpO2 | ETCO2 |
|--------|--------|----|------|-------|
| Normal Sinus Rhythm | normal_sinus | 72 | 98 | — |
| Normal Sinus Rhythm (Intubated) | normal_sinus | 72 | 99 | 35 |
| Sinus Tachycardia | sinus_tachycardia | 130 | 96 | — |
| Sinus Tachycardia (Intubated) | sinus_tachycardia | 130 | 97 | 30 |
| Sinus Bradycardia | sinus_bradycardia | 45 | 97 | — |
| Sinus Bradycardia (Intubated) | sinus_bradycardia | 45 | 98 | 38 |
| SVT / AVNRT | svt | 180 | 94 | — |
| Ventricular Tachycardia | vt_monomorphic | 170 | 85 | — |
| Junctional Rhythm | junctional | 50 | 96 | — |
| Atrial Fibrillation | afib | 110 | 95 | — |
| Atrial Flutter | aflutter | 75 | 96 | — |
| STEMI | stemi | 85 | 96 | — |
| Long QT Syndrome | long_qt | 65 | 98 | — |
| LBBB | lbbb | 75 | 97 | — |
| RBBB | rbbb | 75 | 97 | — |
| Sinus Arrhythmia | sinus_arrhythmia | 70 | 98 | — |
| Paced VVI / DDD / AAI | paced_* | 70 | 97-98 | — |
| VFib (Coarse/Fine) | vfib_* | — | — | — |
| Ventricular Flutter | vflutter | — | — | — |
| Torsades de Pointes | torsades | — | — | — |
| Asystole | asystole | — | — | — |
| Agonal Rhythm | agonal | 25 | — | — |

## Custom Scenarios

Create a `ClinicalScenario` directly to customize any combination of rhythm, vitals, and ventilation parameters:

```python
from ekg_generator.scenarios.presets import ClinicalScenario
from ekg_generator.generate import generate_scenario

# Custom scenario: AFib with rapid ventricular response, intubated
scenario = ClinicalScenario(
    name="Rapid AFib (Intubated)",
    rhythm="afib",
    heart_rate=150,
    spo2=91,
    nibp_sys=90,
    nibp_dia=55,
    intubated=True,
    etco2=28,
    respiratory_rate=22.0,
)
generate_scenario(scenario, "rapid_afib.gif", duration=10.0, fps=25, random_state=42)
```

### ClinicalScenario Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | str | Display label on the monitor |
| `rhythm` | str | Rhythm key (see table below) |
| `heart_rate` | float or None | Override heart rate (bpm) |
| `spo2` | int or None | SpO2 percentage (None = "---") |
| `nibp_sys` | int or None | Systolic BP (None = "---/---") |
| `nibp_dia` | int or None | Diastolic BP |
| `intubated` | bool | Whether to show capnography waveform |
| `etco2` | int or None | End-tidal CO2 in mmHg |
| `respiratory_rate` | float | Breaths per minute (default 14) |
| `rhythm_overrides` | dict | Override any rhythm config parameter |

### Available Rhythms

Use these as the `rhythm` key:

- **Sinus**: `normal_sinus`, `sinus_tachycardia`, `sinus_bradycardia`, `sinus_arrhythmia`
- **Atrial**: `afib`, `aflutter`, `svt`, `junctional`
- **Ventricular**: `vt_monomorphic`, `vfib_coarse`, `vfib_fine`, `vflutter`, `torsades`
- **Paced**: `paced_vvi`, `paced_ddd`, `paced_aai`
- **Conduction**: `stemi`, `long_qt`, `lbbb`, `rbbb`
- **Other**: `agonal`, `asystole`

### Overriding Rhythm Parameters

Use `rhythm_overrides` to tweak ECG morphology without creating a new rhythm:

```python
# Normal sinus with ST elevation (custom T-wave)
scenario = ClinicalScenario(
    name="Custom ST Changes",
    rhythm="normal_sinus",
    heart_rate=80,
    spo2=95,
    nibp_sys=110,
    nibp_dia=70,
    rhythm_overrides={
        "ai": (1.2, -5, 30, -7.5, 3.0),  # large T-wave amplitude
        "ti": (-70, -15, 0, 15, 80),       # T-wave shifted closer
    },
)
```

Key overridable parameters:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `heart_rate` | varies | Heart rate in bpm |
| `heart_rate_std` | 1-2 | Beat-to-beat HR variability |
| `ti` | (-70, -15, 0, 15, 100) | Angular positions of P, Q, R, S, T waves (degrees) |
| `ai` | (1.2, -5, 30, -7.5, 0.75) | Amplitudes of P, Q, R, S, T waves |
| `bi` | (0.25, 0.1, 0.1, 0.1, 0.4) | Gaussian widths of P, Q, R, S, T waves |
| `noise` | 0.01 | ECG measurement noise amplitude |
| `baseline_wander` | 0.05 | Respiratory baseline wander amplitude |

### Output Options

```python
generate_scenario(
    scenario,
    "output.gif",       # or "output.mp4"
    duration=8.0,       # animation duration in seconds
    fps=25,             # frame rate (25 for GIF, 30 for MP4)
    format="gif",       # "gif" or "mp4"
    random_state=42,    # seed for reproducibility (None for random)
)
```

## How the ECG is Generated

The ECG signal is generated using the **McSharry ECGSYN model** (McSharry et al., IEEE Trans. Biomed. Eng., 2003), wrapped via [NeuroKit2](https://neuropsychology.github.io/NeuroKit/).

### ECGSYN Model

The model represents the ECG as a trajectory on a 2D limit cycle, where five Gaussian attractors (one for each of the P, Q, R, S, T waves) shape the waveform. Each attractor has three parameters:

- **`ti`** — angular position (degrees): controls *when* in the cardiac cycle each wave occurs
- **`ai`** — amplitude: controls the *height* of each wave (positive = upward, negative = downward)
- **`bi`** — width: controls how *broad* each wave is

By varying these 15 parameters, different cardiac morphologies are produced (e.g., removing P-waves for AFib, widening QRS for bundle branch blocks, elevating ST segments for STEMI).

### Beat Scheduling

Beat timing (R-R intervals) is generated separately by the scheduler:

- **Regular**: Gaussian jitter around the mean R-R interval
- **Irregular**: Beta-distributed R-R intervals (for AFib)
- **Flutter**: Fixed conduction ratio (e.g., 4:1 for atrial flutter)

### Additive Features

After the base ECG is generated, optional features are layered on:

- **Fibrillatory baseline** — 4-8 Hz band-limited noise (AFib f-waves)
- **Sawtooth flutter** — inverted sawtooth waves at 300 bpm (atrial flutter)
- **Pacing spikes** — narrow voltage spikes before QRS (VVI, DDD, AAI)
- **Baseline wander** — low-frequency sinusoidal drift (respiratory artifact)

### SpO2 Plethysmography

The pleth waveform is synchronized to ECG R-peaks with a configurable pulse transit time delay (default 200 ms). Each pulse uses an asymmetric Gaussian shape with a subtle dicrotic notch, matching the appearance of bedside pulse oximetry monitors.

### ETCO2 Capnography

The capnography waveform uses a smooth "mesa" shape built from the product of two sigmoid (tanh) functions, producing steep but rounded transitions matching real capnogram monitors. Each breath has a slight alveolar plateau upslope and small breath-to-breath variability.

## Project Structure

```
ekg_generator/
├── generate.py              # Main orchestrator
├── engine/
│   ├── ecgsyn.py            # McSharry ECG model (via NeuroKit2)
│   ├── pleth.py             # SpO2 plethysmography
│   ├── capno.py             # ETCO2 capnography
│   ├── noise.py             # VFib, flutter, asystole generators
│   ├── scheduler.py         # R-R interval scheduling
│   └── additive.py          # Pacing spikes, f-waves, flutter, wander
├── rhythms/
│   └── registry.py          # Rhythm parameter definitions
├── scenarios/
│   └── presets.py           # Clinical scenario presets
└── monitor/
    ├── renderer.py          # Frame-by-frame monitor rendering
    ├── layout.py            # Display layout (800x480)
    └── sweep.py             # Sweep trace buffering
```

## Dependencies

- **neurokit2** — ECGSYN model implementation
- **numpy**, **scipy** — signal processing
- **opencv-python** — frame rendering
- **Pillow** — GIF export
- **matplotlib** — (optional) for diagnostics
