# CLAUDE.md

## Project

EKG Generator — a real-time web app simulating a clinical bedside patient monitor with ECG/SpO2/ETCO2 waveforms for clinical education. Runs as two browser tabs (controller + monitor) communicating via BroadcastChannel.

## Key Info

- **Web app location**: `monitor_simulator/frontend/`
- **Tech stack**: vanilla JavaScript, HTML5 Canvas, CSS — no build tools
- **To test**: open `controller/index.html` and `monitor/index.html` in two Chrome tabs
- **Waveform code**: all rhythm handlers are in `monitor/renderer.js`
- **Legacy Python code** (`ekg_generator/`, `scripts/`): **not used** — do not modify or run

## Agent Instructions

See **AGENTS.md** for detailed instructions on working with this codebase, including:

- Web app architecture and common modification points
- How to assist non-technical users (plain language, auto-commit/push, suggest /plan mode)
- Recurring challenges and how to handle them

Always read AGENTS.md at the start of a session.
