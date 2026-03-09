# AGENTS.md — Instructions for AI Assistants Working on This Project

## Project Overview

This is an **EKG Generator**: a Python project that produces realistic animated ECG, SpO2 plethysmography, and ETCO2 capnography waveforms for clinical education. It outputs looping GIF or MP4 animations of a bedside monitor display.

Key technologies: Python, NumPy, SciPy, OpenCV, Pillow, NeuroKit2.

## Working with Non-Technical Users

This project may be used and modified by people with **no coding background** (e.g., clinicians, educators, students). These users interact with you as end-users of the simulation output — not as developers. They will never ask about code, never look at code, and never care about code. All their questions and feedback will be about the **visual output**: "this rhythm doesn't look right", "the heart rate should be higher", "can you make one for VFib?". Adapt your behaviour accordingly:

### User Goal: They Want the Output Files

Non-technical users care about one thing: **the final GIF/MP4 animation files**. They do not know or care how the code works. They will judge your work entirely on whether the output *looks clinically correct*. Their feedback will always be about the visuals — waveform shape, vital sign values, monitor appearance — never about the code that produced them.

- **Always tell them exactly where output files are saved.** After generating, say something like: "Your animation is saved at `output/normal_sinus_rhythm.gif`. You can find all generated files in the `output/` folder."
- **Ask early where they want files saved** if they have a preference. If they want a different output folder, configure it for them.
- **Run the generation for them.** Don't just make code changes and leave it — execute the script so they get their files immediately.
- **It's your job to assess feasibility.** These users have no way to judge whether a request is technically reasonable. You are the only one who can catch problems. Proactively flag when something is unreasonable, would produce poor results, or would break existing functionality. Explain in plain terms why, and suggest alternatives. Do not wait for them to notice something is wrong in the code — they never will. They'll only see it when the output looks bad.

### Visually Verify Your Output

**Always check the output you produce.** After generating an animation:

- **Open and view the output image/GIF** using the Read tool to visually inspect it.
- **Verify clinical plausibility**: Does the heart rate match what was requested? Are the waveforms the right shape? Is the SpO2 pleth synchronized to the ECG? Does the capnography look like a real capnogram?
- **Check for rendering artefacts**: overlapping text, clipped waveforms, blank frames, garbled labels.
- **If something looks wrong, fix it before presenting to the user.** They will notice clinical inaccuracies immediately.

### Guiding Their Requests

- **Translate intent into action.** When a non-technical user says something vague like "make the heart rate faster" or "add a new rhythm", figure out what they mean in code terms and do it. Don't ask them to specify function names or parameters — that's your job.
- **Ask clarifying questions in plain language.** Instead of "which parameter in ClinicalScenario do you want to modify?", ask "what heart rate should the monitor show?" or "should the patient be intubated in this scenario?".
- **Offer the available presets first.** Many requests can be fulfilled by pointing them to an existing preset or a small tweak to one. Check `ekg_generator/scenarios/presets.py` and the README preset table before writing new code.
- **Show them what changed.** After making edits, briefly explain in non-technical terms what you did and where the output file is (e.g., "I updated the heart rate to 150 bpm and generated the new animation. It's saved at `output/sinus_tachycardia.gif`.").

### Setting Reasonable Expectations

- **Be honest about what is and isn't feasible.** If they ask for something outside the scope of this project (e.g., "add 12-lead ECG", "make it interactive in real-time", "add sound"), explain clearly what would be involved and whether it's a small change or a major new feature. Don't let them believe a 5-minute task is ahead when it's actually days of work.
- **Explain constraints simply.** For example: "The ECG model generates a single-lead waveform using a mathematical model. Adding a true 12-lead display would require modelling each lead separately, which is a significant undertaking."
- **Redirect impossible requests kindly.** If they ask for something that can't work (e.g., "make the SpO2 waveform show 105%"), explain why it doesn't make clinical or technical sense and suggest a valid alternative.
- **Break large requests into steps.** If they want multiple changes at once, do them incrementally so each step can be verified.

### Recommend Plan Mode

- **Suggest `/plan` for anything non-trivial.** If the user's request involves adding a new feature, changing multiple files, or anything beyond a simple parameter tweak, recommend entering plan mode first: "This is a bigger change — let me use /plan to outline what needs to happen before we start coding."
- Plan mode helps non-technical users understand the scope before committing to changes they may not fully grasp.

### Git: Always Commit and Push

Non-technical users **will not remember** to commit or push their changes. You must do this for them:

- **After every meaningful change, create a git commit** with a clear, descriptive message. Do not wait for the user to ask.
- **Push to the remote** after committing, so their work is backed up.
- Use plain-English commit messages that a non-coder can understand (e.g., "Add new preset for atrial fibrillation with rapid rate" rather than "feat: add afib_rvr preset to scenarios/presets.py").
- If there are uncommitted changes at the start of a session, mention it to the user and offer to commit them.

### Communication Style

- **Never talk about code unprompted.** These users don't want to hear about functions, modules, or parameters. Talk about the output: what rhythm it shows, what the vitals are, where the file is.
- If you must reference a file, say what it does in plain terms: "the file where patient scenarios are defined" — not "presets.py".
- **Never show code to non-technical users** unless they specifically ask. They don't need to see it and it will only confuse them.
- Don't overwhelm with options — suggest the best approach and offer alternatives only if asked.
- Frame everything in terms of the simulation output: "I changed the monitor to show a heart rate of 150" not "I updated the heart_rate parameter in the ClinicalScenario dataclass".

## Project Architecture (for AI reference)

```
ekg_generator/
├── generate.py              # Main orchestrator — ties everything together
├── engine/
│   ├── ecgsyn.py            # McSharry ECG model (via NeuroKit2)
│   ├── pleth.py             # SpO2 pleth waveform generation
│   ├── capno.py             # ETCO2 capnography waveform
│   ├── noise.py             # VFib, flutter, asystole signal generators
│   ├── scheduler.py         # Beat timing (R-R intervals)
│   └── additive.py          # Pacing spikes, f-waves, flutter waves, baseline wander
├── rhythms/
│   └── registry.py          # All rhythm parameter definitions
├── scenarios/
│   └── presets.py           # Clinical scenario presets (ClinicalScenario dataclass)
└── monitor/
    ├── renderer.py          # Frame-by-frame monitor image rendering
    ├── layout.py            # Display layout constants (800x480)
    └── sweep.py             # Sweep-line trace buffer
```

### Common Modification Points

- **Adding a new preset**: Edit `ekg_generator/scenarios/presets.py`. Add a new `ClinicalScenario` to the `PRESETS` dict.
- **Adding a new rhythm**: Edit `ekg_generator/rhythms/registry.py`. Define new ECGSYN parameters (ti, ai, bi arrays + scheduling config).
- **Changing monitor appearance**: Edit `ekg_generator/monitor/renderer.py` and `layout.py`.
- **Changing waveform shape**: Edit the relevant engine file (`ecgsyn.py`, `pleth.py`, `capno.py`).
- **Running the generator**: `python scripts/demo.py` generates all presets into `output/`.

### Key Patterns

- Rhythms are defined as parameter dicts in `registry.py` and looked up by string key.
- `ClinicalScenario` is a dataclass that bundles rhythm + vitals + ventilation config.
- `generate_scenario()` is the main entry point: scenario in, animation file out.
- The monitor renderer draws each frame with OpenCV, then Pillow or OpenCV encodes to GIF/MP4.
- `random_state` parameter enables reproducible output — always use a seed for consistency.

## Recurring Challenges with Non-Technical Users

_This section is updated over time as new patterns emerge. AI assistants should add notes here when they encounter recurring difficulties._

- **Users may describe clinical scenarios without knowing the rhythm name.** Map their clinical description (e.g., "the patient's heart is going really fast and irregular") to the correct rhythm key (e.g., `afib` with elevated heart_rate). When in doubt, ask about the clinical context.
- **Users may not understand that changes require re-running the script.** Always remind them to run the demo script after changes, or better yet, run it for them.
- **Users may confuse what this tool can and cannot do.** This generates static animations (GIF/MP4) — it is not an interactive real-time simulator. Set this expectation early.
- **Users only care about the output files.** Don't explain code changes in detail. Focus on: what the output looks like, where it's saved, and whether it matches what they asked for.
- **Users won't spot code bugs but will spot clinical errors instantly.** A misshapen T-wave, an impossible vital sign, or a mislabelled rhythm will be noticed. Always visually verify output before delivering it.
- **Users may not know where to find their files.** Always give the full path to the output and remind them which folder to look in.
