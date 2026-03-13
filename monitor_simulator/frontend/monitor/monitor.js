/**
 * monitor.js — WebSocket client and animation loop for the patient monitor.
 *
 * Connects to the backend, receives state updates, and drives waveform rendering.
 */

(function () {
    'use strict';

    // --- State ---
    let state = {
        rhythm: 'sinus_rhythm',
        heart_rate: 72,
        sync_mode: false,
        systolic: 120,
        diastolic: 80,
        spo2: 98,
        etco2: 35,
        respiratory_rate: 14,
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
        // For lethal rhythms, show dashes
        const noHR = ['ventricular_fibrillation', 'asystole'];
        if (noHR.includes(state.rhythm)) {
            hrValue.textContent = '---';
            spo2Value.textContent = '---';
        } else {
            hrValue.textContent = state.heart_rate;
            spo2Value.textContent = state.spo2;
        }
        etco2Value.textContent = state.etco2;
        bpSys.textContent = state.systolic;
        bpDia.textContent = state.diastolic;
    }

    // --- Waveform generation (called each frame) ---
    // We generate beats/breaths lazily and feed samples to renderers at the right rate.

    let lastFrameTime = performance.now();

    function generateAndPush(dt) {
        // How many samples correspond to this frame's elapsed time
        const samplesToGenerate = Math.round(SAMPLE_RATE * dt);

        // --- ECG ---
        while (ecgSamplesRemaining.length < samplesToGenerate) {
            const beat = ECGRhythms.generateBeat(
                state.rhythm, SAMPLE_RATE, state.heart_rate, ecgBeatIndex
            );
            ecgBeatIndex++;
            // Convert to array for easier manipulation
            ecgSamplesRemaining.push(...beat);
        }
        const ecgChunk = new Float32Array(ecgSamplesRemaining.splice(0, samplesToGenerate));
        const syncOpts = {};
        if (state.sync_mode && ECGRhythms.supportsSyncMarker(state.rhythm)) {
            // Mark R-peak positions
            const rPeakFrac = ECGRhythms.getRPeakPosition(state.rhythm);
            // Find peaks in this chunk
            const peaks = [];
            let maxVal = -Infinity, maxIdx = 0;
            for (let i = 1; i < ecgChunk.length - 1; i++) {
                if (ecgChunk[i] > ecgChunk[i-1] && ecgChunk[i] > ecgChunk[i+1] && ecgChunk[i] > 0.5) {
                    peaks.push(i / ecgChunk.length);
                }
            }
            if (peaks.length > 0) syncOpts.syncMarkerAt = peaks;
        }
        ecgRenderer.pushSamples(ecgChunk, SAMPLE_RATE, syncOpts);

        // --- SpO2 Pleth ---
        while (plethSamplesRemaining.length < samplesToGenerate) {
            const noPleth = ['ventricular_fibrillation', 'asystole'];
            if (noPleth.includes(state.rhythm)) {
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
            const breath = CapnoGenerator.generateBreath(capnoSR, state.respiratory_rate, state.etco2);
            capnoSamplesRemaining.push(...breath);
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
        ecgRenderer.render(-0.6, 1.8);
        spo2Renderer.render(-0.1, 1.2);
        capnoRenderer.render(-0.1, 1.2);

        requestAnimationFrame(animate);
    }

    // --- WebSocket connection ---
    function connectWebSocket() {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${location.host}/ws/monitor`);

        ws.onopen = () => {
            console.log('Monitor connected to server');
        };

        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'state_update') {
                const oldRhythm = state.rhythm;
                const oldHR = state.heart_rate;
                Object.assign(state, msg.state);
                updateNumerics();

                // If rhythm or HR changed, flush waveform buffers for immediate response
                if (state.rhythm !== oldRhythm || state.heart_rate !== oldHR) {
                    ecgSamplesRemaining = [];
                    plethSamplesRemaining = [];
                    ecgBeatIndex = 0;
                }
            }
        };

        ws.onclose = () => {
            console.log('Monitor disconnected, reconnecting in 2s...');
            setTimeout(connectWebSocket, 2000);
        };

        ws.onerror = (err) => {
            console.error('WebSocket error:', err);
            ws.close();
        };

        // Keep-alive ping
        setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, 30000);
    }

    // --- Fullscreen on click ---
    document.getElementById('monitor').addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
        }
    });

    // --- Start ---
    updateNumerics();
    connectWebSocket();
    requestAnimationFrame(animate);
})();
