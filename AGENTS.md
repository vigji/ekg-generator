# AGENTS.md — Instructions for AI Assistants Working on This Project

## Project Overview

This is an **EKG Generator**: a real-time web app that simulates a clinical bedside patient monitor with ECG, SpO2 plethysmography, and ETCO2 capnography waveforms for clinical education. It runs as a **two-tab web application** — a controller tab and a monitor tab communicating via BroadcastChannel.

Key technologies: vanilla JavaScript, HTML5 Canvas, CSS. No build tools or frameworks.

**IMPORTANT**: The web app at `monitor_simulator/frontend/` is the **only active part** of this project. The legacy Python code in `ekg_generator/` and `scripts/` is **not used** — do not modify it or run it. All waveform generation happens client-side in JavaScript.

## Web App Architecture

```
monitor_simulator/frontend/
├── index.html                    # Landing page
├── controller/
│   ├── index.html               # Controller UI (rhythm selection, vitals sliders)
│   ├── controller.js            # State management, rhythm definitions, BroadcastChannel
│   └── style.css                # Controller styling (dark medical theme)
├── monitor/
│   ├── index.html               # Patient monitor display (fullscreen clinical look)
│   ├── monitor.js               # Animation loop, state receiver, waveform scheduling
│   ├── renderer.js              # ECG/SpO2/Capno waveform generation & canvas rendering
│   └── style.css                # Monitor styling
└── shared/
    └── channel.js               # BroadcastChannel cross-tab communication + localStorage
```

### How It Works

1. **Controller tab** (`controller/index.html`) — user selects rhythm, adjusts HR/BP/SpO2/ETCO2 via sliders
2. **BroadcastChannel** — sends state updates to monitor tab in real time
3. **Monitor tab** (`monitor/index.html`) — receives state, generates waveforms procedurally in JavaScript, renders with sweep-line canvas animation
4. **Waveform generation** — `renderer.js` contains all rhythm handlers in `ECGRhythms._rhythmHandlers`, plus `PlethGenerator` and `CapnoGenerator`

### Common Modification Points

- **Changing a rhythm's waveform shape**: Edit the corresponding handler in `monitor/renderer.js` → `ECGRhythms._rhythmHandlers['rhythm_id']`
- **Adding a new rhythm**: Add entry to `RHYTHMS` array in `controller/controller.js`, then add handler in `renderer.js`
- **Changing monitor appearance/layout**: Edit `monitor/style.css` and `monitor/index.html`
- **Changing controller UI**: Edit `controller/style.css` and `controller/controller.js`
- **Testing changes**: Open both controller and monitor HTML files in Chrome tabs on the same device

### Key Patterns

- Rhythms generate one beat at a time via `ECGRhythms.generateBeat(rhythm, sampleRate, heartRate, beatIndex)`
- Each handler returns a `Float32Array` of samples for one cardiac cycle
- `_normalBeat()` builds parametric PQRST using Gaussian peaks — most rhythms use it with different params
- `_wideBeat()` extends `_normalBeat()` for ventricular morphologies
- Sample rate is 500 Hz for ECG/SpO2, 250 Hz for capnography
- Sweep speed is 200 px/sec for ECG/SpO2, 100 px/sec for capno
- State is persisted in localStorage and shared via BroadcastChannel

## Working with Non-Technical Users

This project is used by people with **no coding background** (clinicians, educators, students). They interact as end-users of the simulation — not as developers. All their feedback will be about the **visual output**: "this rhythm doesn't look right", "the heart rate should be higher".

### User Goal: They Want to See the Monitor

- **Open the web app for them.** Use Chrome DevTools MCP tools to open the controller and monitor tabs. Don't just edit code — show them the result.
- **Visually verify your changes.** After editing renderer.js, reload the monitor tab and take a screenshot to check the waveform looks correct.
- **It's your job to assess feasibility.** Proactively flag unreasonable requests. Don't wait for them to notice — they'll only see it when the output looks wrong.

### Visually Verify Your Output

**Always check the output you produce.** After modifying waveform code:

- **Open both tabs in Chrome** (controller + monitor) and select the rhythm you changed
- **Take a screenshot** to visually inspect the waveform
- **Verify clinical plausibility**: correct morphology, appropriate rate, proper wave relationships
- **Check for rendering artefacts**: clipped waveforms, discontinuities, amplitude issues
- **If something looks wrong, fix it before presenting to the user.**

### Communication Style

- **Never talk about code unprompted.** Talk about the output: what rhythm it shows, what the vitals are.
- **Never show code to non-technical users** unless they specifically ask.
- Frame everything in terms of the simulation: "I changed the flutter waves to look more like a real ECG strip" — not "I modified the harmonic coefficients in the atrial_flutter handler".

### Git: Always Commit and Push

Non-technical users **will not remember** to commit or push. You must do this for them:

- **After every meaningful change, create a git commit** with a clear message.
- **Push to the remote** after committing.
- Use plain-English commit messages (e.g., "Improve atrial flutter wave shape to match real ECG strips").

### Recommend Plan Mode

- **Suggest `/plan` for anything non-trivial.** If the request involves adding a new feature or changing multiple files, recommend plan mode first.

## Recurring Challenges

- **Users may describe clinical scenarios without knowing the rhythm name.** Map their description to the correct rhythm ID.
- **Users may provide reference ECG images.** Compare your output visually against their reference and iterate until the morphology matches.
- **Users won't spot code bugs but will spot clinical errors instantly.** A misshapen T-wave or mislabelled rhythm will be noticed. Always visually verify.
- **Changes are live immediately.** Unlike the old Python pipeline, the web app updates in real time — just reload the monitor tab after editing renderer.js.
