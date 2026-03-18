/**
 * monitor.js — BroadcastChannel client and animation loop for the patient monitor.
 *
 * Receives state updates from the controller tab and drives waveform rendering.
 */

(function () {
    'use strict';

    // --- Channel ---
    const channel = MonitorChannel.create();

    // --- State ---
    // Start with "just powered on" defaults — flat traces, no values
    // Real values come only when the controller connects and sends state.
    let state = {
        rhythm: 'standby',
        heart_rate: 0,
        systolic: 0,
        diastolic: 0,
        spo2: 0,
        etco2: 0,
        respiratory_rate: 0,
        sync_mode: false,
        pacing_mode: false,
        pacing_rate: 70,
        pacing_current: 70,
    };

    // --- Waveform renderers ---
    const ecgRenderer = new WaveformRenderer(
        document.getElementById('ecg-canvas'), '#00ff41', 200
    );
    const spo2Renderer = new WaveformRenderer(
        document.getElementById('spo2-canvas'), '#00d4ff', 200
    );
    const capnoRenderer = new WaveformRenderer(
        document.getElementById('capno-canvas'), '#ffdd00', 100
    );

    // --- Waveform generation state ---
    const SAMPLE_RATE = 500;
    let ecgBeatIndex = 0;
    let ecgSamplesRemaining = [];
    let ecgRPeakPositions = []; // absolute sample indices of R-peaks within ecgSamplesRemaining
    let plethSamplesRemaining = [];
    let capnoSamplesRemaining = [];

    // --- DOM elements ---
    const hrValue = document.getElementById('hr-value');
    const spo2Value = document.getElementById('spo2-value');
    const etco2Value = document.getElementById('etco2-value');
    const bpSys = document.getElementById('bp-sys');
    const bpDia = document.getElementById('bp-dia');

    // --- Update numeric displays ---
    function updateNumerics() {
        // Standby: all zeros
        if (state.rhythm === 'standby') {
            hrValue.textContent = '0';
            spo2Value.textContent = '0';
            etco2Value.textContent = '0';
            bpSys.textContent = '0';
            bpDia.textContent = '0';
            return;
        }
        // For lethal rhythms show dashes for HR/SpO2
        const noHR = ['ventricular_fibrillation', 'fine_vf', 'ventricular_standstill', 'asystole'];
        if (state.pacing_mode && state.pacing_current >= 60) {
            hrValue.textContent = state.pacing_rate;
            spo2Value.textContent = state.spo2;
        } else if (noHR.includes(state.rhythm) || state.heart_rate === 0) {
            hrValue.textContent = '---';
            spo2Value.textContent = '---';
        } else {
            hrValue.textContent = state.heart_rate;
            spo2Value.textContent = state.spo2;
        }
        etco2Value.textContent = state.etco2 || '---';
        bpSys.textContent = state.systolic || '---';
        bpDia.textContent = state.diastolic || '---';
    }

    // --- Waveform generation (called each frame) ---
    // We generate beats/breaths lazily and feed samples to renderers at the right rate.

    let lastFrameTime = performance.now();

    function generateAndPush(dt) {
        // How many samples correspond to this frame's elapsed time
        const samplesToGenerate = Math.round(SAMPLE_RATE * dt);

        // --- ECG ---
        const CAPTURE_THRESHOLD = 60; // mA — below this, pacing fails to capture
        while (ecgSamplesRemaining.length < samplesToGenerate) {
            const beatStartIdx = ecgSamplesRemaining.length;
            let beat;

            if (state.pacing_mode) {
                const capture = state.pacing_current >= CAPTURE_THRESHOLD;
                beat = ECGRhythms.generatePacedBeat(
                    SAMPLE_RATE, state.pacing_rate, state.pacing_current, capture
                );
                if (!capture) {
                    // Failure to capture: overlay underlying rhythm
                    const underlying = ECGRhythms.generateBeat(
                        state.rhythm, SAMPLE_RATE, state.heart_rate, ecgBeatIndex
                    );
                    // Resample underlying to match paced beat length
                    for (let i = 0; i < beat.length && i < underlying.length; i++) {
                        beat[i] += underlying[i];
                    }
                }
            } else {
                beat = ECGRhythms.generateBeat(
                    state.rhythm, SAMPLE_RATE, state.heart_rate, ecgBeatIndex
                );
            }
            ecgBeatIndex++;

            // Find R-peaks in this beat/chunk
            const MULTI_CYCLE = ['vt_polymorphic', 'vt_monomorphic'];
            if (MULTI_CYCLE.includes(state.rhythm)) {
                // Multi-cycle chunks: find all local maxima
                const PEAK_THRESH = 0.10;
                const MIN_PEAK_GAP = Math.round(SAMPLE_RATE * 0.08);
                let lastPeakIdx = -MIN_PEAK_GAP;
                for (let i = 1; i < beat.length - 1; i++) {
                    if (beat[i] > PEAK_THRESH &&
                        beat[i] >= beat[i - 1] && beat[i] >= beat[i + 1] &&
                        (i - lastPeakIdx) >= MIN_PEAK_GAP) {
                        ecgRPeakPositions.push(beatStartIdx + i);
                        lastPeakIdx = i;
                    }
                }
            } else {
                // Single-beat rhythms: mark only the highest positive sample
                let maxVal = -Infinity, maxIdx = 0;
                for (let i = 0; i < beat.length; i++) {
                    if (beat[i] > maxVal) { maxVal = beat[i]; maxIdx = i; }
                }
                if (maxVal > 0.3) {
                    ecgRPeakPositions.push(beatStartIdx + maxIdx);
                }
            }

            ecgSamplesRemaining.push(...beat);
        }
        const ecgChunk = new Float32Array(ecgSamplesRemaining.splice(0, samplesToGenerate));

        // Shift R-peak positions relative to the extracted chunk
        const syncOpts = {};
        ecgRenderer.syncEnabled = state.sync_mode;
        if (state.sync_mode && ECGRhythms.supportsSyncMarker(state.rhythm)) {
            const peaks = [];
            const remaining = [];
            for (const pos of ecgRPeakPositions) {
                if (pos < samplesToGenerate) {
                    // This R-peak is within the current chunk
                    peaks.push(pos / ecgChunk.length);
                } else {
                    // Keep for future chunks, adjusted for consumed samples
                    remaining.push(pos - samplesToGenerate);
                }
            }
            ecgRPeakPositions = remaining;
            if (peaks.length > 0) syncOpts.syncMarkerAt = peaks;
        } else {
            // Still consume/shift positions even when sync is off
            ecgRPeakPositions = ecgRPeakPositions
                .map(p => p - samplesToGenerate)
                .filter(p => p >= 0);
        }
        ecgRenderer.pushSamples(ecgChunk, SAMPLE_RATE, syncOpts);

        // --- SpO2 Pleth ---
        while (plethSamplesRemaining.length < samplesToGenerate) {
            const noPleth = ['standby', 'ventricular_fibrillation', 'fine_vf', 'ventricular_standstill', 'asystole'];
            if (noPleth.includes(state.rhythm) || state.spo2 <= 0) {
                // Flatline
                const n = Math.round(SAMPLE_RATE * 0.5);
                for (let i = 0; i < n; i++) plethSamplesRemaining.push(0.002 * (Math.random() - 0.5));
            } else {
                const pulse = PlethGenerator.generatePulse(SAMPLE_RATE, state.heart_rate, state.spo2);
                plethSamplesRemaining.push(...pulse);
            }
        }
        const plethChunk = new Float32Array(plethSamplesRemaining.splice(0, samplesToGenerate));
        spo2Renderer.pushSamples(plethChunk, SAMPLE_RATE);

        // --- Capnography ---
        const capnoSR = 250; // lower sample rate for capno
        const capnoSamples = Math.round(capnoSR * dt);
        while (capnoSamplesRemaining.length < capnoSamples) {
            // Use default respiratory rate of 14 if etco2 is set but RR is missing
            const effectiveRR = (state.respiratory_rate > 0)
                ? state.respiratory_rate
                : (state.etco2 > 0 ? 14 : 0);
            if (effectiveRR <= 0) {
                // No respiratory rate and no etco2 — flatline
                const n = Math.round(capnoSR * 0.5);
                for (let i = 0; i < n; i++) capnoSamplesRemaining.push(0);
            } else {
                const breath = CapnoGenerator.generateBreath(capnoSR, effectiveRR, state.etco2);
                capnoSamplesRemaining.push(...breath);
            }
        }
        const capnoChunk = new Float32Array(capnoSamplesRemaining.splice(0, capnoSamples));
        capnoRenderer.pushSamples(capnoChunk, capnoSR);
    }

    // --- Animation loop ---
    function animate(now) {
        const dt = Math.min((now - lastFrameTime) / 1000, 0.1); // cap at 100ms
        lastFrameTime = now;

        generateAndPush(dt);

        // Render all waveforms
        // Widen Y range when pacing to fit tall spikes
        const ecgYMax = state.pacing_mode ? 2.8 : 1.8;
        ecgRenderer.render(-0.6, ecgYMax);
        spo2Renderer.render(-0.1, 1.2);
        capnoRenderer.render(-0.1, 1.2);

        requestAnimationFrame(animate);
    }

    // --- Handle state updates from controller ---
    channel.onState((newState, type) => {
        if (type === 'state_request') return; // not for us
        if (!newState) return;

        const oldRhythm = state.rhythm;
        const oldHR = state.heart_rate;
        const oldSync = state.sync_mode;
        const oldPacing = state.pacing_mode;
        const oldPacingRate = state.pacing_rate;
        const oldPacingCurrent = state.pacing_current;
        Object.assign(state, newState);
        updateNumerics();

        // Clear SYNC markers when SYNC is turned off
        if (oldSync && !state.sync_mode) {
            ecgRenderer.clearSyncMarkers();
        }

        // If rhythm, HR, or pacing changed, flush waveform buffers
        const pacingChanged = state.pacing_mode !== oldPacing
            || state.pacing_rate !== oldPacingRate
            || state.pacing_current !== oldPacingCurrent;
        if (state.rhythm !== oldRhythm || state.heart_rate !== oldHR || pacingChanged) {
            ecgSamplesRemaining = [];
            ecgRPeakPositions = [];
            plethSamplesRemaining = [];
            capnoSamplesRemaining = [];
            ecgBeatIndex = 0;
        }
    });

    // --- Fullscreen on click ---
    document.getElementById('monitor').addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
        }
    });

    // --- Start ---
    // Show "just powered on" state (flat traces, dashes) until controller connects.
    // Only request state via BroadcastChannel — don't fall back to localStorage.
    updateNumerics();
    channel._bc.postMessage({ type: 'state_request' });
    channel.startConnectionMonitor();
    requestAnimationFrame(animate);
})();
