/**
 * controller.js — Controller UI logic.
 *
 * Connects to the backend via WebSocket, sends parameter updates,
 * and keeps the UI in sync with the current monitor state.
 */

(function () {
    'use strict';

    // --- Rhythm definitions (with abbreviations for the grid) ---
    const RHYTHMS = [
        { id: 'sinus_rhythm',              abbr: 'NSR',  label: 'Sinus Rhythm' },
        { id: 'sinus_tachycardia',         abbr: 'ST',   label: 'Sinus Tach' },
        { id: 'atrial_fibrillation',       abbr: 'AFIB', label: 'A-Fib' },
        { id: 'atrial_flutter',            abbr: 'AFL',  label: 'A-Flutter' },
        { id: 'atrial_tachycardia',        abbr: 'AT',   label: 'Atrial Tach' },
        { id: 'psvt',                      abbr: 'PSVT', label: 'PSVT' },
        { id: 'junctional',               abbr: 'JR',   label: 'Junctional' },
        { id: 'av_block_1',               abbr: '1HB',  label: 'AV Block I' },
        { id: 'av_block_2',               abbr: '2HB',  label: 'AV Block II' },
        { id: 'av_block_3',               abbr: '3HB',  label: 'AV Block III' },
        { id: 'vt_monomorphic',           abbr: 'VT',   label: 'V-Tach Mono' },
        { id: 'vt_polymorphic',           abbr: 'PVT',  label: 'V-Tach Poly' },
        { id: 'ventricular_fibrillation', abbr: 'VF',   label: 'V-Fib' },
        { id: 'pacemaker',               abbr: 'PAC',  label: 'Pacemaker' },
        { id: 'agonal',                   abbr: 'AG',   label: 'Agonal' },
        { id: 'asystole',                abbr: 'ASY',  label: 'Asystole' },
    ];

    // --- State ---
    let currentState = {};
    let ws = null;

    // --- DOM refs ---
    const connStatus = document.getElementById('conn-status');
    const rhythmGrid = document.getElementById('rhythm-grid');
    const syncBtn = document.getElementById('sync-btn');
    const resetBtn = document.getElementById('reset-btn');

    const sliders = {
        heart_rate: { slider: document.getElementById('hr-slider'), display: document.getElementById('hr-display') },
        systolic:   { slider: document.getElementById('sys-slider'), display: document.getElementById('sys-display') },
        diastolic:  { slider: document.getElementById('dia-slider'), display: document.getElementById('dia-display') },
        spo2:       { slider: document.getElementById('spo2-slider'), display: document.getElementById('spo2-display') },
        etco2:      { slider: document.getElementById('etco2-slider'), display: document.getElementById('etco2-display') },
    };

    // --- Build rhythm grid ---
    function buildRhythmGrid() {
        rhythmGrid.innerHTML = '';
        RHYTHMS.forEach(r => {
            const btn = document.createElement('button');
            btn.className = 'rhythm-btn';
            btn.dataset.rhythmId = r.id;
            btn.innerHTML = `<span class="rhythm-abbr">${r.abbr}</span><span class="rhythm-name">${r.label}</span>`;
            btn.addEventListener('click', () => selectRhythm(r.id));
            rhythmGrid.appendChild(btn);
        });
    }

    function selectRhythm(rhythmId) {
        sendUpdate({ rhythm: rhythmId });
    }

    function updateRhythmHighlight(rhythmId) {
        document.querySelectorAll('.rhythm-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.rhythmId === rhythmId);
        });
    }

    // --- Slider event handlers ---
    function setupSliders() {
        for (const [key, { slider, display }] of Object.entries(sliders)) {
            // Debounced input — send on every change for real-time response
            slider.addEventListener('input', () => {
                const val = parseInt(slider.value);
                display.textContent = val;
                sendUpdate({ [key]: val });
            });
        }
    }

    function updateSlidersFromState(state) {
        for (const [key, { slider, display }] of Object.entries(sliders)) {
            if (state[key] !== undefined) {
                slider.value = state[key];
                display.textContent = state[key];
            }
        }
    }

    // --- SYNC toggle ---
    syncBtn.addEventListener('click', () => {
        sendUpdate({ sync_mode: !currentState.sync_mode });
    });

    function updateSyncButton(active) {
        syncBtn.classList.toggle('active', active);
    }

    // --- Reset ---
    resetBtn.addEventListener('click', () => {
        sendUpdate({
            rhythm: 'sinus_rhythm',
            heart_rate: 72,
            systolic: 120,
            diastolic: 80,
            spo2: 98,
            etco2: 35,
            sync_mode: false,
            respiratory_rate: 14,
        });
    });

    // --- WebSocket ---
    function sendUpdate(partialState) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'update',
                state: partialState,
            }));
        }
    }

    function applyState(state) {
        currentState = state;
        updateRhythmHighlight(state.rhythm);
        updateSlidersFromState(state);
        updateSyncButton(state.sync_mode);
    }

    function connectWebSocket() {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${protocol}//${location.host}/ws/controller`);

        ws.onopen = () => {
            connStatus.textContent = 'Connected';
            connStatus.classList.add('connected');
        };

        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'state_update' && msg.state) {
                applyState(msg.state);
            }
        };

        ws.onclose = () => {
            connStatus.textContent = 'Disconnected';
            connStatus.classList.remove('connected');
            setTimeout(connectWebSocket, 2000);
        };

        ws.onerror = () => {
            ws.close();
        };
    }

    // --- Init ---
    buildRhythmGrid();
    setupSliders();
    connectWebSocket();
})();
