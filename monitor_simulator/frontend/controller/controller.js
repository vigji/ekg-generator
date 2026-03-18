/**
 * controller.js — Controller UI logic.
 *
 * Communicates with the monitor via BroadcastChannel (cross-tab, same device).
 * All state is persisted to localStorage for resilience across refreshes.
 */

(function () {
    'use strict';

    // --- Rhythm definitions (with abbreviations and default HR for auto-set) ---
    const RHYTHMS = [
        { id: 'standby',                   abbr: '—',    label: 'Standby',         hrDefault: 0 },
        { id: 'sinus_rhythm',              abbr: 'NSR',  label: 'Sinus Rhythm',    hrDefault: 72 },
        { id: 'sinus_tachycardia',         abbr: 'ST',   label: 'Sinus Tach',      hrDefault: 100 },
        { id: 'atrial_fibrillation',       abbr: 'AFIB', label: 'A-Fib',           hrDefault: 80 },
        { id: 'atrial_flutter',            abbr: 'AFL',  label: 'A-Flutter',       hrDefault: 100 },
        { id: 'atrial_tachycardia',        abbr: 'AT',   label: 'Atrial Tach',     hrDefault: 120 },
        { id: 'psvt',                      abbr: 'PSVT', label: 'PSVT',            hrDefault: 150 },
        { id: 'junctional',               abbr: 'JR',   label: 'Junctional',      hrDefault: 45 },
        { id: 'av_block_1',               abbr: '1HB',  label: 'AV Block I',      hrDefault: 72 },
        { id: 'av_block_2_mobitz1',       abbr: 'M1',   label: 'Mobitz I',        hrDefault: 55 },
        { id: 'av_block_2_mobitz2',       abbr: 'M2',   label: 'Mobitz II',       hrDefault: 55 },
        { id: 'av_block_3',               abbr: '3HB',  label: 'AV Block III',    hrDefault: 35 },
        { id: 'vt_monomorphic',           abbr: 'VT',   label: 'V-Tach Mono',     hrDefault: 200 },
        { id: 'vt_polymorphic',           abbr: 'PVT',  label: 'V-Tach Poly',     hrDefault: 180 },
        { id: 'ventricular_fibrillation', abbr: 'VF',   label: 'V-Fib',           hrDefault: 72 },
        { id: 'pacemaker',               abbr: 'PAC',  label: 'Pacemaker',       hrDefault: 70 },
        { id: 'agonal',                   abbr: 'AG',   label: 'Agonal',          hrDefault: 20 },
        { id: 'asystole',                abbr: 'ASY',  label: 'Asystole',        hrDefault: 72 },
        { id: 'stemi',                    abbr: 'STEMI', label: 'Inferior STEMI', hrDefault: 72 },
        { id: 'tca_toxicity',            abbr: 'TCA',  label: 'TCA Toxicity',    hrDefault: 110 },
        { id: 'hyperkalemia',            abbr: 'HyK',  label: 'HyperK',          hrDefault: 40 },
        { id: 'wpw',                     abbr: 'WPW',  label: 'WPW',             hrDefault: 72 },
        { id: 'af_wpw',                  abbr: 'FAWPW', label: 'FA-WPW',         hrDefault: 180 },
    ];

    // --- Scale tick configs for each slider ---
    const SCALE_CONFIGS = {
        heart_rate: { min: 20,  max: 250, ticks: [20, 50, 100, 150, 200, 250] },
        systolic:   { min: 0,   max: 300, ticks: [0, 50, 100, 150, 200, 250, 300] },
        diastolic:  { min: 0,   max: 200, ticks: [0, 50, 100, 150, 200] },
        spo2:       { min: 0,   max: 100, ticks: [0, 20, 40, 60, 80, 100] },
        etco2:      { min: 0,   max: 80,  ticks: [0, 20, 40, 60, 80] },
    };

    function getHRDefault(rhythmId) {
        const r = RHYTHMS.find(r => r.id === rhythmId);
        return r ? r.hrDefault : 72;
    }

    // --- Channel ---
    const channel = MonitorChannel.create();
    let currentState = channel.loadState();

    // Enforce standby zeros (localStorage may have stale vitals)
    if (currentState.rhythm === 'standby') {
        currentState.heart_rate = 0;
        currentState.systolic = 0;
        currentState.diastolic = 0;
        currentState.spo2 = 0;
        currentState.etco2 = 0;
        currentState.respiratory_rate = 0;
    }

    // --- DOM refs ---
    const connStatus = document.getElementById('conn-status');
    const rhythmGrid = document.getElementById('rhythm-grid');
    const syncBtn = document.getElementById('sync-btn');
    const pacingBtn = document.getElementById('pacing-btn');
    const pacingControls = document.getElementById('pacing-controls');
    const pacingRateSlider = document.getElementById('pacing-rate-slider');
    const pacingRateDisplay = document.getElementById('pacing-rate-display');
    const pacingCurrentSlider = document.getElementById('pacing-current-slider');
    const pacingCurrentDisplay = document.getElementById('pacing-current-display');
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

    // Pulseless rhythms: no cardiac output → BP reads 0
    const PULSELESS_RHYTHMS = new Set([
        'standby', 'ventricular_fibrillation', 'asystole', 'vt_polymorphic', 'agonal',
    ]);

    function selectRhythm(rhythmId) {
        const wasStandby = currentState.rhythm === 'standby';
        const update = { rhythm: rhythmId, heart_rate: getHRDefault(rhythmId) };
        if (rhythmId === 'standby') {
            update.systolic = 0;
            update.diastolic = 0;
            update.spo2 = 0;
            update.etco2 = 0;
            update.respiratory_rate = 0;
        } else if (PULSELESS_RHYTHMS.has(rhythmId)) {
            update.systolic = 0;
            update.diastolic = 0;
        }
        // No auto-restore of vitals — they stay as set by the user
        sendUpdate(update);
    }

    function updateRhythmHighlight(rhythmId) {
        document.querySelectorAll('.rhythm-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.rhythmId === rhythmId);
        });
    }

    // --- Scale DOM refs ---
    const scaleEls = {
        heart_rate: document.getElementById('hr-scale'),
        systolic:   document.getElementById('sys-scale'),
        diastolic:  document.getElementById('dia-scale'),
        spo2:       document.getElementById('spo2-scale'),
        etco2:      document.getElementById('etco2-scale'),
    };

    // --- Slider event handlers ---
    function setupSliders() {
        for (const [key, { slider, display }] of Object.entries(sliders)) {
            slider.addEventListener('input', () => {
                const val = parseInt(slider.value);
                display.textContent = val;
                sendUpdate({ [key]: val });
            });
        }
    }

    function buildScales() {
        for (const [key, cfg] of Object.entries(SCALE_CONFIGS)) {
            const el = scaleEls[key];
            if (!el) continue;
            el.innerHTML = '';
            const range = cfg.max - cfg.min;
            cfg.ticks.forEach(tick => {
                const pct = ((tick - cfg.min) / range) * 100;
                const div = document.createElement('div');
                div.className = 'scale-tick';
                div.style.bottom = pct + '%';
                div.textContent = tick;
                el.appendChild(div);
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

    // --- PACING toggle ---
    pacingBtn.addEventListener('click', () => {
        sendUpdate({ pacing_mode: !currentState.pacing_mode });
    });

    pacingRateSlider.addEventListener('input', () => {
        const val = parseInt(pacingRateSlider.value);
        pacingRateDisplay.textContent = val;
        sendUpdate({ pacing_rate: val });
    });

    pacingCurrentSlider.addEventListener('input', () => {
        const val = parseInt(pacingCurrentSlider.value);
        pacingCurrentDisplay.textContent = val;
        sendUpdate({ pacing_current: val });
    });

    function updatePacingUI(state) {
        const active = state.pacing_mode;
        pacingBtn.classList.toggle('active', active);
        pacingControls.style.display = active ? 'flex' : 'none';
        if (state.pacing_rate !== undefined) {
            pacingRateSlider.value = state.pacing_rate;
            pacingRateDisplay.textContent = state.pacing_rate;
        }
        if (state.pacing_current !== undefined) {
            pacingCurrentSlider.value = state.pacing_current;
            pacingCurrentDisplay.textContent = state.pacing_current;
        }
    }

    // --- Reset ---
    resetBtn.addEventListener('click', () => {
        sendUpdate({
            rhythm: 'standby',
            heart_rate: 0,
            systolic: 0,
            diastolic: 0,
            spo2: 0,
            etco2: 0,
            sync_mode: false,
            respiratory_rate: 0,
            pacing_mode: false,
            pacing_rate: 70,
            pacing_current: 70,
        });
    });

    // --- Communication ---
    function sendUpdate(partialState) {
        Object.assign(currentState, partialState);
        applyState(currentState);
        channel.postState(currentState);
    }

    function applyState(state) {
        currentState = state;
        updateRhythmHighlight(state.rhythm);
        updateSlidersFromState(state);
        updateSyncButton(state.sync_mode);
        updatePacingUI(state);
    }

    // Respond to state requests from monitors
    channel.onState((state, type) => {
        if (type === 'state_request') {
            channel.postState(currentState);
        }
    });

    // Show connection status (controller is always "connected" since it is the source)
    connStatus.textContent = 'Connected';
    connStatus.classList.add('connected');

    // --- Init ---
    buildRhythmGrid();
    setupSliders();
    buildScales();
    applyState(currentState);
    channel.postState(currentState); // broadcast initial state to any open monitors
    channel.startHeartbeat();
})();
