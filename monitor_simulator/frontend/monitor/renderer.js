/**
 * renderer.js — Client-side procedural waveform generation and canvas rendering.
 *
 * Generates ECG, SpO2 pleth, and capnography waveforms in real time.
 * Uses a sweep-line approach matching clinical monitor displays.
 */

// ============================================================
// ECG Waveform Generation
// ============================================================

const ECGRhythms = {
    /**
     * Generate one cardiac cycle of ECG signal.
     * Returns an array of samples normalized to [-1, 1] range.
     * @param {string} rhythm - Rhythm type identifier
     * @param {number} sampleRate - Samples per second
     * @param {number} heartRate - Current heart rate in bpm
     * @param {number} beatIndex - Which beat this is (for variation)
     * @returns {number[]} Array of ECG samples for one beat
     */
    generateBeat(rhythm, sampleRate, heartRate, beatIndex) {
        const handler = this._rhythmHandlers[rhythm] || this._rhythmHandlers['sinus_rhythm'];
        return handler(sampleRate, heartRate, beatIndex);
    },

    /**
     * Generate one paced beat.
     * @param {number} sampleRate
     * @param {number} pacingRate - pacing rate in bpm
     * @param {number} pacingCurrent - current in mA (0-200)
     * @param {boolean} capture - whether electrical capture is achieved
     * @returns {Float32Array}
     */
    generatePacedBeat(sampleRate, pacingRate, pacingCurrent, capture) {
        const rr = 60.0 / pacingRate;
        const n = Math.round(rr * sampleRate);
        const signal = new Float32Array(n);

        // Pacing spike at ~10% into the beat
        const spikePos = Math.round(0.10 * n);
        // Spike height scales with current (0 mA → 0, 200 mA → 2.5)
        const spikeHeight = (pacingCurrent / 200) * 2.5;

        // Widen spike to 3 samples so it reliably fills at least one pixel column
        for (let s = 0; s < 3 && spikePos + s < n; s++) {
            signal[spikePos + s] = spikeHeight;
        }
        // Small negative afterpotential (1 sample)
        if (spikePos + 3 < n) signal[spikePos + 3] = -spikeHeight * 0.15;

        if (capture) {
            // Gap of ~12 samples (~24ms at 500 Hz) so spike is visually separate from QRS
            const qrsStart = spikePos + 12;
            for (let i = 0; i < n; i++) {
                const t = (i - qrsStart) / sampleRate;
                if (t > 0) {
                    // Wide captured QRS complex
                    signal[i] += 0.75 * Math.exp(-Math.pow((t - 0.02) / 0.025, 2) / 2);
                    signal[i] += -0.45 * Math.exp(-Math.pow((t - 0.06) / 0.03, 2) / 2);
                    // Broad T-wave
                    signal[i] += -0.25 * Math.exp(-Math.pow((t - 0.18) / 0.06, 2) / 2);
                }
            }
        }

        return signal;
    },

    /**
     * Parametric ECG beat using Gaussian peaks for P, Q, R, S, T waves.
     */
    _normalBeat(sampleRate, heartRate, params = {}) {
        const rr = 60.0 / heartRate;
        const n = Math.round(rr * sampleRate);
        const signal = new Float32Array(n);

        // Default PQRST parameters
        const p = {
            pAmp: params.pAmp ?? 0.12,
            pPos: params.pPos ?? 0.22,
            pWidth: params.pWidth ?? 0.04,
            qAmp: params.qAmp ?? -0.10,
            qPos: params.qPos ?? 0.34,
            qWidth: params.qWidth ?? 0.012,
            rAmp: params.rAmp ?? 1.0,
            rPos: params.rPos ?? 0.37,
            rWidth: params.rWidth ?? 0.016,
            sAmp: params.sAmp ?? -0.20,
            sPos: params.sPos ?? 0.40,
            sWidth: params.sWidth ?? 0.016,
            tAmp: params.tAmp ?? 0.25,
            tPos: params.tPos ?? 0.55,
            tWidth: params.tWidth ?? 0.06,
            stElev: params.stElev ?? 0.0,
        };

        for (let i = 0; i < n; i++) {
            const t = i / sampleRate / rr; // normalized 0..1 within beat
            let v = 0;
            v += p.pAmp * Math.exp(-Math.pow((t - p.pPos) / p.pWidth, 2) / 2);
            v += p.qAmp * Math.exp(-Math.pow((t - p.qPos) / p.qWidth, 2) / 2);
            v += p.rAmp * Math.exp(-Math.pow((t - p.rPos) / p.rWidth, 2) / 2);
            v += p.sAmp * Math.exp(-Math.pow((t - p.sPos) / p.sWidth, 2) / 2);
            v += p.tAmp * Math.exp(-Math.pow((t - p.tPos) / p.tWidth, 2) / 2);
            // ST elevation
            if (t > p.sPos && t < p.tPos) v += p.stElev;
            signal[i] = v;
        }
        return signal;
    },

    /**
     * Generate wide QRS complex (for ventricular rhythms).
     */
    _wideBeat(sampleRate, heartRate, params = {}) {
        return this._normalBeat(sampleRate, heartRate, {
            pAmp: 0,
            qAmp: -0.15,
            qPos: 0.32,
            qWidth: 0.025,
            rAmp: params.rAmp ?? 0.9,
            rPos: 0.37,
            rWidth: 0.035,
            sAmp: -0.35,
            sPos: 0.43,
            sWidth: 0.03,
            tAmp: -0.3,
            tPos: 0.58,
            tWidth: 0.07,
            ...params,
        });
    },

    // Persistent phase counter for VF continuity across chunks
    _vfPhase: 0,

    _rhythmHandlers: {
        'sinus_rhythm': function(sr, hr, idx) {
            return ECGRhythms._normalBeat(sr, hr);
        },

        'sinus_tachycardia': function(sr, hr, idx) {
            return ECGRhythms._normalBeat(sr, hr, {
                pAmp: 0.15,
                tAmp: 0.20,
            });
        },

        'atrial_fibrillation': function(sr, hr, idx) {
            // Irregularly irregular RR — wide variation (50-170% of base)
            const variation = 0.50 + Math.random() * 1.20;
            const effectiveHR = hr * variation;
            const rr = 60.0 / effectiveHR;
            const n = Math.round(rr * sr);

            // Generate QRS-T at a very fast reference rate so the complex
            // always fits within even the shortest RR intervals
            const refHR = 170;
            const refBeat = ECGRhythms._normalBeat(sr, refHR, {
                pAmp: 0,
                qAmp: -0.08,
                qPos: 0.18,
                qWidth: 0.008,
                rAmp: 1.0,
                rPos: 0.21,
                rWidth: 0.012,
                sAmp: -0.18,
                sPos: 0.24,
                sWidth: 0.010,
                tAmp: 0.22,
                tPos: 0.44,
                tWidth: 0.070,
            });

            // Build output: copy refBeat then pad/trim to match actual RR
            const beat = new Float32Array(n);
            const copyLen = Math.min(refBeat.length, n);
            for (let i = 0; i < copyLen; i++) beat[i] = refBeat[i];
            // Remaining samples stay at 0 (flat baseline)

            // Subtle fibrillatory baseline
            const phase1 = idx * 31.7;
            const phase2 = idx * 47.3;
            const phase3 = idx * 19.1;
            for (let i = 0; i < n; i++) {
                const t = i / sr;
                beat[i] += 0.008 * (
                    Math.sin(2 * Math.PI * 4.1 * t + phase1) +
                    Math.sin(2 * Math.PI * 6.5 * t + phase2) +
                    Math.sin(2 * Math.PI * 8.3 * t + phase3)
                );
                beat[i] += 0.004 * (Math.random() - 0.5);
            }
            return beat;
        },

        'brady_tachy': function(sr, hr, idx) {
            // Brady-Tachy syndrome: bursts of fast AFib-like beats
            // alternating with long pauses.

            // Persistent state across calls
            const s = ECGRhythms._btState || (ECGRhythms._btState = {
                phase: 'tachy',   // 'tachy' or 'pause'
                beatsInPhase: 0,
                tachyLen: 10,     // beats in current tachy burst
                pauseLen: 0,      // pause beats remaining
            });

            if (s.phase === 'pause') {
                s.pauseLen--;
                if (s.pauseLen <= 0) {
                    s.phase = 'tachy';
                    s.beatsInPhase = 0;
                    s.tachyLen = 8 + Math.floor(Math.random() * 10); // 8-17 beats
                }
                // Return flat baseline (~2 seconds of silence)
                const n = Math.round(sr * 2.0);
                const signal = new Float32Array(n);
                for (let i = 0; i < n; i++) {
                    signal[i] = 0.003 * (Math.random() - 0.5);
                }
                return signal;
            }

            // Tachy phase: fast AFib-like beats
            s.beatsInPhase++;
            if (s.beatsInPhase >= s.tachyLen) {
                s.phase = 'pause';
                s.pauseLen = 1 + Math.floor(Math.random() * 2); // 1-2 pause chunks
            }

            // Generate AFib-like beat at fast rate
            const fastHR = 120 + Math.random() * 60; // 120-180 bpm
            const variation = 0.70 + Math.random() * 0.60;
            const beatHR = fastHR * variation;
            const rr = 60.0 / beatHR;
            const n = Math.round(rr * sr);

            // Fixed narrow QRS-T template
            const refHR = 170;
            const refBeat = ECGRhythms._normalBeat(sr, refHR, {
                pAmp: 0,
                qAmp: -0.08,
                qPos: 0.18,
                qWidth: 0.008,
                rAmp: 1.0,
                rPos: 0.21,
                rWidth: 0.012,
                sAmp: -0.18,
                sPos: 0.24,
                sWidth: 0.010,
                tAmp: 0.22,
                tPos: 0.44,
                tWidth: 0.070,
            });

            const signal = new Float32Array(n);
            const copyLen = Math.min(refBeat.length, n);
            for (let i = 0; i < copyLen; i++) signal[i] = refBeat[i];

            // Subtle noise on baseline
            for (let i = 0; i < n; i++) {
                signal[i] += 0.004 * (Math.random() - 0.5);
            }
            return signal;
        },

        'afib_aberrancy': function(sr, hr, idx) {
            // AFib with aberrancy: irregularly irregular, wide QRS
            // (small R → deep wide S → small positive T), no P waves.
            const effectiveHR = Math.max(hr, 80);
            const variation = 0.50 + Math.random() * 1.20;
            const beatHR = effectiveHR * variation;
            const rr = 60.0 / beatHR;
            const n = Math.round(rr * sr);

            // Fixed wide QRS-T template in absolute time (seconds)
            const signal = new Float32Array(n);
            for (let i = 0; i < n; i++) {
                const ts = i / sr; // absolute seconds
                let v = 0;

                // Positive R wave (well above 0.3 threshold for SYNC detection)
                v += 0.55 * Math.exp(-Math.pow((ts - 0.04) / 0.012, 2) / 2);

                // Deep wide S wave (predominantly negative QRS)
                v += -0.65 * Math.exp(-Math.pow((ts - 0.10) / 0.035, 2) / 2);

                // Small positive T wave
                v += 0.15 * Math.exp(-Math.pow((ts - 0.22) / 0.035, 2) / 2);

                // Subtle fibrillatory baseline
                const fPhase = idx * 23.7;
                v += 0.008 * (
                    Math.sin(2 * Math.PI * 4.1 * ts + fPhase) +
                    Math.sin(2 * Math.PI * 7.1 * ts + fPhase * 1.3)
                );
                v += 0.004 * (Math.random() - 0.5);

                signal[i] = v;
            }
            return signal;
        },

        'atrial_flutter': function(sr, hr, idx) {
            // Atrial flutter: continuous rounded sawtooth flutter waves at 300/min
            // with narrow QRS complexes inserted at ventricular rate.
            // Flutter waves use harmonic synthesis for organic morphology.
            const variation = 0.92 + Math.random() * 0.16; // subtle rate variation
            const effectiveHR = hr * variation;
            const rr = 60.0 / effectiveHR;
            const n = Math.round(rr * sr);
            const signal = new Float32Array(n);
            const flutterFreq = 300.0 / 60.0; // 5 Hz
            const flutterAmp = 0.16;

            // Continuous flutter waves: asymmetric rounded sawtooth via harmonics
            for (let i = 0; i < n; i++) {
                const t = i / sr;
                const phase = 2 * Math.PI * flutterFreq * t;
                let f = -Math.sin(phase)
                      + 0.40 * Math.sin(2 * phase)
                      - 0.18 * Math.sin(3 * phase)
                      + 0.08 * Math.sin(4 * phase);
                signal[i] = f / 1.45 * flutterAmp; // normalize
            }

            // Insert narrow QRS at ~37% of beat cycle
            const qrsCenterSample = Math.round(0.37 * n);
            const rVar = 1.0 + (Math.random() - 0.5) * 0.06;
            const sVar = 1.0 + (Math.random() - 0.5) * 0.10;
            const qrsHalfWidth = Math.round(0.025 * sr) * 4;

            for (let i = Math.max(0, qrsCenterSample - qrsHalfWidth);
                 i < Math.min(n, qrsCenterSample + qrsHalfWidth); i++) {
                const dt = (i - qrsCenterSample) / sr;
                // R wave
                const r = 1.1 * rVar * Math.exp(-0.5 * Math.pow(dt / 0.012, 2));
                // Q wave
                const q = -0.10 * Math.exp(-0.5 * Math.pow((dt + 0.022) / 0.008, 2));
                // S wave
                const s = -0.30 * sVar * Math.exp(-0.5 * Math.pow((dt - 0.028) / 0.014, 2));
                const qrsVal = r + q + s;
                // Blend: suppress flutter during QRS
                const envelope = Math.exp(-0.5 * Math.pow(dt / 0.035, 2));
                signal[i] = signal[i] * (1.0 - envelope) + qrsVal;
            }

            return signal;
        },

        'atrial_tachycardia': function(sr, hr, idx) {
            const effectiveHR = Math.max(hr, 120);
            return ECGRhythms._normalBeat(sr, effectiveHR, {
                pAmp: 0.18,
                pPos: 0.16,
                pWidth: 0.025,
            });
        },

        'psvt': function(sr, hr, idx) {
            // SVT: fast regular narrow-complex tachycardia. No P waves,
            // narrow QRS, S returns to baseline, flat ST, positive T.
            const effectiveHR = Math.max(hr, 150);
            const rr = 60.0 / effectiveHR;
            const n = Math.round(rr * sr);

            // Fixed QRS-T template in absolute time for consistent morphology
            const signal = new Float32Array(n);
            for (let i = 0; i < n; i++) {
                const ts = i / sr;
                let v = 0;

                // No P wave

                // Very narrow QRS: sharp R wave
                v += 1.0 * Math.exp(-Math.pow((ts - 0.04) / 0.008, 2) / 2);

                // S wave: returns to baseline
                v += -0.18 * Math.exp(-Math.pow((ts - 0.06) / 0.007, 2) / 2);

                // Positive T wave (after flat ST segment)
                v += 0.22 * Math.exp(-Math.pow((ts - 0.20) / 0.040, 2) / 2);

                // Tiny noise
                v += 0.003 * (Math.random() - 0.5);

                signal[i] = v;
            }
            return signal;
        },

        'junctional': function(sr, hr, idx) {
            return ECGRhythms._normalBeat(sr, hr, {
                pAmp: -0.06,
                pPos: 0.42,
                pWidth: 0.03,
            });
        },

        'vt_monomorphic': function(sr, hr, idx) {
            const effectiveHR = Math.max(hr, 140);
            const rr = 60.0 / effectiveHR;
            const n = Math.round(rr * sr);
            const signal = new Float32Array(n);

            // Seeded pseudo-random per beat
            const seed = (idx * 2654435761) >>> 0;
            const rand = (k) => {
                const x = Math.sin(seed + k * 9973) * 43758.5453;
                return x - Math.floor(x);
            };

            // Beat-to-beat variation
            const ampVar = 0.75 + 0.25 * rand(0);
            const driftOffset = (rand(2) - 0.5) * 0.15;
            const spikeVar = 1.6 + 0.4 * rand(3);   // how pointy the troughs are

            // Continuous sinusoid with top-bottom asymmetry:
            //   - 2nd harmonic widens positive half, narrows negative half
            //   - power function on negative half sharpens troughs into V-spikes
            let rawMin = Infinity, rawMax = -Infinity;
            for (let i = 0; i < n; i++) {
                const phase = 2 * Math.PI * i / n;
                // 2nd harmonic creates asymmetry: wide tops, narrow bottoms
                let v = Math.sin(phase) + 0.30 * Math.sin(2 * phase);
                // Sharpen negative half into pointy V-troughs
                if (v < 0) {
                    v = -Math.pow(-v, spikeVar);
                }
                signal[i] = v;
                if (v < rawMin) rawMin = v;
                if (v > rawMax) rawMax = v;
            }

            // Rescale with per-beat amplitude and drift
            const targetMax = 0.9 * ampVar;
            const targetMin = -0.7 * ampVar;
            const scale = (targetMax - targetMin) / (rawMax - rawMin);
            const offset = targetMax - rawMax * scale + driftOffset;
            for (let i = 0; i < n; i++) {
                signal[i] = signal[i] * scale + offset;
            }
            return signal;
        },

        'vt_polymorphic': function(sr, hr, idx) {
            // Torsades de Pointes — stochastic piecewise cycle generator
            // with AR(1) parameter evolution and soft peak rounding
            const n = Math.round(sr * 0.5);
            const signal = new Float32Array(n);
            const dt = 1.0 / sr;

            // Persistent state — initialize on first call
            const s = ECGRhythms._pvt || (ECGRhythms._pvt = {
                t: 0,                  // global time
                cyclePhase: 0,         // phase within current cycle [0,1)
                // AR(1) cycle parameters
                P: 0.40,               // period (seconds)
                A: 1.00,               // amplitude
                r: 0.22,               // rise fraction
                q: 0.78,               // decay exponent
                bump: 0.18,            // late-bump amplitude
                bpos: 0.84,            // late-bump position
                off: 0.0,              // vertical offset
                wig: 0.0,              // wiggle parameter
                needNewCycle: true,
            });

            // Box-Muller normal random
            function randn() {
                const u1 = Math.random() || 1e-10;
                const u2 = Math.random();
                return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
            }

            function clip(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

            // Asymmetric cycle template: piecewise power-law rise/fall
            function asymCycle(u, r, p, q, bumpAmp, bumpPos, bumpW, wig) {
                let y;
                if (u < r) {
                    y = -1.0 + 2.0 * Math.pow(u / r, p);
                } else {
                    y = 1.0 - 2.0 * Math.pow((u - r) / (1.0 - r), q);
                }
                // Late positive bump
                y += bumpAmp * Math.exp(-0.5 * Math.pow((u - bumpPos) / bumpW, 2));
                // Small early bump
                y += 0.05 * Math.exp(-0.5 * Math.pow((u - 0.08) / 0.03, 2));
                // Tiny sinusoidal wiggle
                y += 0.04 * Math.sin(2 * Math.PI * (3.0 * u + wig));
                return y;
            }

            for (let i = 0; i < n; i++) {
                // Generate new cycle parameters via AR(1) at cycle boundary
                if (s.needNewCycle) {
                    s.needNewCycle = false;
                    const xi1 = randn(), xi2 = randn(), xi3 = randn();
                    const xi4 = randn(), xi5 = randn(), xi6 = randn();

                    // Period and amplitude: AR(1) with stochastic targets
                    const Pmean = 0.18, sigP = 0.04;
                    const Amean = 0.95, sigA = 0.25;
                    s.P = clip(0.55 * s.P + 0.45 * (Pmean + sigP * xi1), 0.12, 0.32);
                    s.A = clip(0.45 * s.A + 0.55 * (Amean + sigA * xi2), 0.35, 1.35);

                    // Shape parameters
                    s.r = clip(0.55 * s.r + 0.45 * (0.22 + 0.045 * xi3 + 0.025 * Math.sin(0.9 * s.t)), 0.12, 0.34);
                    s.q = clip(0.55 * s.q + 0.45 * (0.80 + 0.20 * xi4), 0.45, 1.15);
                    s.bump = clip(0.50 * s.bump + 0.50 * (0.18 + 0.12 * xi5), 0.01, 0.38);
                    s.bpos = clip(0.65 * s.bpos + 0.35 * (0.84 + 0.05 * xi6), 0.72, 0.92);
                    s.off = 0.45 * s.off + 0.55 * (0.07 * randn());
                    s.wig = randn();
                }

                // Advance phase within cycle
                const phaseStep = dt / s.P;
                s.cyclePhase += phaseStep;

                // Cycle boundary
                if (s.cyclePhase >= 1.0) {
                    s.cyclePhase -= 1.0;
                    s.needNewCycle = true;
                }

                const u = s.cyclePhase;

                // Compute cycle waveform
                const y = asymCycle(u, s.r, 0.55, s.q, s.bump, s.bpos, 0.04, s.wig * 0.18);

                // Soft peak rounding: stronger compression for high-amplitude waves
                let v = s.off + s.A * y;
                if (v > 0.55) {
                    v = v - 0.35 * (v - 0.55) * (v - 0.55);
                }
                if (v < -0.55) {
                    v = v + 0.35 * (v + 0.55) * (v + 0.55);
                }

                // Axis rotation: slow polarity drift (Torsades characteristic)
                const axisRotation = Math.sin(2 * Math.PI * 0.12 * s.t);
                signal[i] = (v + 0.20) * (0.6 + 0.4 * axisRotation) * 1.2;

                s.t += dt;
            }

            // Simple 3-sample moving average for minimal smoothing
            for (let i = 1; i < n - 1; i++) {
                signal[i] = 0.2 * signal[i - 1] + 0.6 * signal[i] + 0.2 * signal[i + 1];
            }

            return signal;
        },

        'ventricular_fibrillation': function(sr, hr, idx) {
            // VF as random zigzag segments: sharp angular lines going
            // up and down irregularly, matching real VF strip morphology
            const n = Math.round(sr * 0.5);
            const signal = new Float32Array(n);

            // Persistent state
            if (ECGRhythms._vfCur === undefined) ECGRhythms._vfCur = 0;
            if (ECGRhythms._vfTgt === undefined) ECGRhythms._vfTgt = 0.5;
            if (ECGRhythms._vfRemain === undefined) ECGRhythms._vfRemain = 0;
            if (ECGRhythms._vfDur === undefined) ECGRhythms._vfDur = 1;
            if (ECGRhythms._vfPrev === undefined) ECGRhythms._vfPrev = 0;
            if (ECGRhythms._vfSmooth === undefined) ECGRhythms._vfSmooth = 1.0;
            if (!ECGRhythms._vfT) ECGRhythms._vfT = 0;

            const dt = 1.0 / sr;

            for (let i = 0; i < n; i++) {
                const t = ECGRhythms._vfT;

                // Amplitude envelope: wax/wane
                const env1 = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.20 * t);
                const env2 = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.31 * t + 1.7);
                const envelope = 0.25 + 0.75 * env1 * env2;

                // When we reach the target, pick a new one
                if (ECGRhythms._vfRemain <= 0) {
                    ECGRhythms._vfPrev = ECGRhythms._vfTgt;
                    // New random target: opposite sign bias with wider amplitude range
                    const sign = ECGRhythms._vfPrev > 0 ? -1 : 1;
                    ECGRhythms._vfTgt = sign * (0.1 + Math.random() * 1.0);
                    // Duration: wider range (8-50 samples) for more beat-to-beat variability
                    const dur = Math.floor(8 + Math.random() * 42);
                    ECGRhythms._vfRemain = dur;
                    ECGRhythms._vfDur = dur;
                    // Per-segment smoothness: 0.6 (sharper) to 1.8 (rounder)
                    ECGRhythms._vfSmooth = 0.6 + Math.random() * 1.2;
                }

                // Variable-smoothness interpolation via power-cosine blend
                const frac = 1 - (ECGRhythms._vfRemain / ECGRhythms._vfDur);
                const cosBlend = 0.5 * (1 - Math.cos(Math.PI * frac));
                const blend = Math.pow(cosBlend, ECGRhythms._vfSmooth);
                ECGRhythms._vfCur = ECGRhythms._vfPrev + (ECGRhythms._vfTgt - ECGRhythms._vfPrev) * blend;
                ECGRhythms._vfRemain--;

                signal[i] = envelope * ECGRhythms._vfCur;
                ECGRhythms._vfT += dt;
            }
            return signal;
        },

        'ventricular_standstill': function(sr, hr, idx) {
            // Ventricular standstill: flat baseline with only P waves, no QRS/T.
            // Atria fire regularly but ventricles don't respond.
            const pRate = Math.max(hr, 30); // P wave rate
            const rr = 60.0 / pRate;
            const n = Math.round(rr * sr);
            const signal = new Float32Array(n);

            for (let i = 0; i < n; i++) {
                const t = i / sr / rr; // normalized 0..1
                // Small upright P wave early in the cycle
                signal[i] = 0.12 * Math.exp(-Math.pow((t - 0.15) / 0.030, 2) / 2);
                // Tiny noise
                signal[i] += 0.003 * (Math.random() - 0.5);
            }
            return signal;
        },

        'fine_vf': function(sr, hr, idx) {
            // Fine VF: very low amplitude rapid irregular oscillations
            const n = Math.round(sr * 0.5);
            const signal = new Float32Array(n);
            const dt = 1.0 / sr;

            // Persistent phase for continuity
            if (!ECGRhythms._fvfPhase) ECGRhythms._fvfPhase = 0;

            for (let i = 0; i < n; i++) {
                const t = ECGRhythms._fvfPhase;
                // Multiple low-amplitude oscillations at varying frequencies
                let v = 0;
                v += 0.04 * Math.sin(2 * Math.PI * 5.2 * t);
                v += 0.03 * Math.sin(2 * Math.PI * 7.8 * t + 1.2);
                v += 0.025 * Math.sin(2 * Math.PI * 11.3 * t + 2.7);
                v += 0.02 * Math.sin(2 * Math.PI * 3.4 * t + 0.8);
                // Random amplitude modulation for irregularity
                const env = 0.6 + 0.4 * Math.sin(2 * Math.PI * 0.4 * t);
                signal[i] = v * env + 0.008 * (Math.random() - 0.5);
                ECGRhythms._fvfPhase += dt;
            }
            return signal;
        },

        'cpr': function(sr, hr, idx) {
            // CPR artifact: compression humps with distinct sharp notches.
            const effectiveHR = Math.max(hr, 100);
            const rr = 60.0 / effectiveHR;
            const n = Math.round(rr * sr);
            const signal = new Float32Array(n);

            // Persistent phase for continuous artifacts across beats
            if (!ECGRhythms._cprPhase) ECGRhythms._cprPhase = 0;

            for (let i = 0; i < n; i++) {
                const t = i / n;
                const ts = ECGRhythms._cprPhase;
                let v = 0;

                // Compression hump base
                const phase = 2 * Math.PI * t;
                v += 0.35 * (Math.sin(phase) + 0.20 * Math.sin(2 * phase));

                // Distinct sharp notches: ~4-5 per cycle at medium frequency
                v += 0.08 * Math.sin(2 * Math.PI * 5.5 * ts + idx * 5.3);
                v += 0.06 * Math.sin(2 * Math.PI * 9.2 * ts + idx * 3.7);
                v += 0.04 * Math.sin(2 * Math.PI * 3.1 * ts + idx * 7.9);

                // Tiny jitter
                v += 0.008 * (Math.random() - 0.5);

                signal[i] = v;
                ECGRhythms._cprPhase += 1 / sr;
            }
            return signal;
        },

        'standby': function(sr, hr, idx) {
            const n = Math.round(sr * 1.5);
            const signal = new Float32Array(n);
            for (let i = 0; i < n; i++) {
                signal[i] = 0.005 * (Math.random() - 0.5);
            }
            return signal;
        },

        'asystole': function(sr, hr, idx) {
            const n = Math.round(sr * 1.5);
            const signal = new Float32Array(n);
            for (let i = 0; i < n; i++) {
                signal[i] = 0.005 * (Math.random() - 0.5);
            }
            return signal;
        },

        'agonal': function(sr, hr, idx) {
            // Agonal: very slow, wide bizarre QRS — deep negative trough
            // followed by broad positive hump. No P waves. Variable morphology.
            const effectiveHR = Math.min(hr, 20);
            const rr = 60.0 / effectiveHR;
            const n = Math.round(rr * sr);
            const signal = new Float32Array(n);

            // Per-beat variation in morphology
            const negAmp = 0.40 + Math.random() * 0.40;  // negative trough depth
            const posAmp = 0.35 + Math.random() * 0.35;  // positive hump height
            const negPos = 0.12 + Math.random() * 0.04;  // trough position
            const posPos = negPos + 0.04 + Math.random() * 0.02; // hump position

            for (let i = 0; i < n; i++) {
                const t = i / n; // normalized 0..1
                let v = 0;

                // Deep negative trough (wide)
                v += -negAmp * Math.exp(-Math.pow((t - negPos) / 0.025, 2) / 2);

                // Broad positive hump (wide QRS)
                v += posAmp * Math.exp(-Math.pow((t - posPos) / 0.030, 2) / 2);

                // Tiny noise
                v += 0.003 * (Math.random() - 0.5);

                signal[i] = v;
            }
            return signal;
        },

        'pacemaker': function(sr, hr, idx) {
            // Tall spike (2.0) single sample, then wider QRS
            const beat = ECGRhythms._wideBeat(sr, hr, {
                rAmp: 0.7,
                rWidth: 0.03,
            });
            const spikePos = Math.floor(0.33 * beat.length);
            if (spikePos < beat.length) {
                beat[spikePos] = 2.0;
                if (spikePos + 1 < beat.length) beat[spikePos + 1] = -0.3;
            }
            return beat;
        },

        'av_block_1': function(sr, hr, idx) {
            return ECGRhythms._normalBeat(sr, hr, {
                pPos: 0.15,
                qPos: 0.36,
                rPos: 0.39,
            });
        },

        'av_block_2_mobitz1': function(sr, hr, idx) {
            // Wenckebach — progressive PR prolongation, 4th beat dropped
            const cycleLen = 4;
            const beatInCycle = idx % cycleLen;
            if (beatInCycle === cycleLen - 1) {
                // Dropped beat — P wave only
                const rr = 60.0 / hr;
                const n = Math.round(rr * sr);
                const signal = new Float32Array(n);
                for (let i = 0; i < n; i++) {
                    const t = i / sr / rr;
                    signal[i] = 0.12 * Math.exp(-Math.pow((t - 0.22) / 0.04, 2) / 2);
                    signal[i] += 0.003 * (Math.random() - 0.5);
                }
                return signal;
            }
            // PR increases progressively (0.02 per beat)
            const prShift = beatInCycle * 0.02;
            return ECGRhythms._normalBeat(sr, hr, {
                pPos: 0.18 - prShift,
            });
        },

        'av_block_2_mobitz2': function(sr, hr, idx) {
            // Fixed PR interval, sudden dropped beat (3:1 or 4:1)
            const conductionRatio = (idx % 7 < 4) ? 3 : 4; // alternate 3:1 and 4:1
            const beatInCycle = idx % conductionRatio;
            if (beatInCycle === conductionRatio - 1) {
                // Dropped beat — P wave only, no QRS
                const rr = 60.0 / hr;
                const n = Math.round(rr * sr);
                const signal = new Float32Array(n);
                for (let i = 0; i < n; i++) {
                    const t = i / sr / rr;
                    signal[i] = 0.12 * Math.exp(-Math.pow((t - 0.22) / 0.04, 2) / 2);
                    signal[i] += 0.003 * (Math.random() - 0.5);
                }
                return signal;
            }
            // Conducted beats — fixed PR
            return ECGRhythms._normalBeat(sr, hr, {
                pPos: 0.18,
            });
        },

        'av_block_3': function(sr, hr, idx) {
            // Complete heart block — P waves march independently at ~75 bpm,
            // ventricles escape at ~35 bpm with wide QRS + inverted T.
            // Uses persistent phase counter for continuous P wave dissociation.
            const ventRate = 35;
            const rr = 60.0 / ventRate;
            const n = Math.round(rr * sr);
            const signal = new Float32Array(n);

            // Initialize persistent P wave phase
            if (ECGRhythms._chbPPhase === undefined) ECGRhythms._chbPPhase = 0;

            const atrialRate = 75;
            const pPeriodSamples = sr * 60.0 / atrialRate;

            // 1) Continuous P waves at atrial rate (phase-continuous across beats)
            for (let i = 0; i < n; i++) {
                const pPhase = ECGRhythms._chbPPhase / pPeriodSamples;
                // P wave: small upright Gaussian bump
                const pFrac = pPhase % 1.0;
                signal[i] = 0.14 * Math.exp(-Math.pow((pFrac - 0.15) / 0.035, 2) / 2);
                ECGRhythms._chbPPhase++;
            }

            // 2) Insert ventricular escape QRS + broad inverted T
            const qrsCenterSample = Math.round(0.35 * n);
            const rVar = 1.0 + (Math.random() - 0.5) * 0.06;

            for (let i = 0; i < n; i++) {
                const dt = (i - qrsCenterSample) / sr;

                // QRS-T complex matching reference morphology:
                // small Q → tall sharp R → deep S → broad inverted T
                const q = -0.08 * Math.exp(-0.5 * Math.pow((dt + 0.022) / 0.008, 2));
                const r = 0.90 * rVar * Math.exp(-0.5 * Math.pow(dt / 0.014, 2));
                const s = -0.45 * Math.exp(-0.5 * Math.pow((dt - 0.035) / 0.020, 2));
                const t = -0.22 * Math.exp(-0.5 * Math.pow((dt - 0.16) / 0.060, 2));

                const qrsVal = q + r + s + t;

                // Narrow suppression: only mask P waves right at QRS, not during T
                const envelope = Math.exp(-0.5 * Math.pow(dt / 0.05, 2));
                signal[i] = signal[i] * (1.0 - envelope) + qrsVal;
            }

            // 3) Tiny noise for realism
            for (let i = 0; i < n; i++) {
                signal[i] += 0.003 * (Math.random() - 0.5);
            }

            return signal;
        },

        'stemi': function(sr, hr, idx) {
            // STEMI: sharp R wave, then elevated concave-upward ST segment
            // starting directly from R, smoothly into broad rounded T wave.
            const rr = 60.0 / hr;
            const n = Math.round(rr * sr);
            const signal = new Float32Array(n);

            for (let i = 0; i < n; i++) {
                const t = i / sr / rr; // normalized 0..1
                let v = 0;

                // P wave
                v += 0.12 * Math.exp(-Math.pow((t - 0.18) / 0.035, 2) / 2);

                // R wave: sharp, tall — no Q or S wave
                v += 1.00 * Math.exp(-Math.pow((t - 0.32) / 0.016, 2) / 2);

                // ST-T segment: starts directly from descending limb of R,
                // elevated and concave-upward, merging into broad rounded T.
                // R descends to ~0.20 (elevated, not back to baseline),
                // then curves upward into rounded T peak at ~0.55.
                const stStart = 0.35;  // where R descent hands off to ST
                const tPeak = 0.56;   // T wave peak
                const tEnd = 0.72;    // T wave return to baseline
                const stBase = 0.20;  // ST elevation level
                const tHeight = 0.50; // T wave peak height

                if (t > stStart && t <= tPeak) {
                    const phase = (t - stStart) / (tPeak - stStart);
                    // Concave upward: starts at stBase, accelerates into tHeight
                    v += stBase + (tHeight - stBase) * phase * phase;
                } else if (t > tPeak && t <= tEnd) {
                    // Broad rounded T descent using cosine for smooth rounded peak
                    const phase = (t - tPeak) / (tEnd - tPeak);
                    v += tHeight * 0.5 * (1 + Math.cos(Math.PI * phase));
                }

                signal[i] = v;
            }

            // Tiny noise
            for (let i = 0; i < n; i++) {
                signal[i] += 0.003 * (Math.random() - 0.5);
            }
            return signal;
        },

        'omi_lmca': function(sr, hr, idx) {
            // OMI-LMCA: normal P, sharp R, deep S wave that returns to a
            // depressed horizontal ST segment, then positive T wave.
            const rr = 60.0 / hr;
            const n = Math.round(rr * sr);
            const signal = new Float32Array(n);

            const stLevel = -0.20; // ST depression level

            for (let i = 0; i < n; i++) {
                const t = i / sr / rr; // normalized 0..1
                let v = 0;

                // P wave: normal, upright
                v += 0.10 * Math.exp(-Math.pow((t - 0.18) / 0.030, 2) / 2);

                // R wave: sharp
                v += 0.70 * Math.exp(-Math.pow((t - 0.34) / 0.014, 2) / 2);

                // S wave: deep, returns to depressed ST level (not baseline)
                v += -0.50 * Math.exp(-Math.pow((t - 0.39) / 0.016, 2) / 2);

                // Horizontal depressed ST segment from S upstroke into T wave
                const stStart = 0.41;
                const tStart = 0.54;
                const tPeak = 0.62;
                const tEnd = 0.72;

                if (t > stStart && t <= tStart) {
                    // Flat horizontal segment at depressed level
                    v += stLevel;
                } else if (t > tStart && t <= tPeak) {
                    // Smooth concave-upward rise from depressed level into T wave
                    const phase = (t - tStart) / (tPeak - tStart);
                    v += stLevel + (0.18 - stLevel) * 0.5 * (1 - Math.cos(Math.PI * phase));
                } else if (t > tPeak && t <= tEnd) {
                    // Smooth T wave descent back to baseline
                    const phase = (t - tPeak) / (tEnd - tPeak);
                    v += 0.18 * 0.5 * (1 + Math.cos(Math.PI * phase));
                }

                signal[i] = v;
            }

            // Tiny noise
            for (let i = 0; i < n; i++) {
                signal[i] += 0.003 * (Math.random() - 0.5);
            }
            return signal;
        },

        'wellens': function(sr, hr, idx) {
            // Normal sinus with deeply inverted/biphasic T-wave
            return ECGRhythms._normalBeat(sr, hr, {
                tAmp: -0.3,
                tWidth: 0.07,
            });
        },

        'de_winter': function(sr, hr, idx) {
            // J-point ST depression + tall peaked symmetric T
            const beat = ECGRhythms._normalBeat(sr, hr, {
                tAmp: 0.6,
                tWidth: 0.05,
            });
            // Add slight ST depression after QRS (between S and T)
            const rr = 60.0 / hr;
            const n = beat.length;
            for (let i = 0; i < n; i++) {
                const t = i / sr / rr;
                if (t > 0.41 && t < 0.50) {
                    beat[i] -= 0.05;
                }
            }
            return beat;
        },

        'wpw': function(sr, hr, idx) {
            // WPW: short PR, delta wave (slurred QRS upstroke), wide QRS, inverted T
            const rr = 60.0 / hr;
            const n = Math.round(rr * sr);
            const signal = new Float32Array(n);

            for (let i = 0; i < n; i++) {
                const t = i / sr / rr; // normalized 0..1
                let v = 0;

                // P wave: small, upright (short PR)
                v += 0.13 * Math.exp(-Math.pow((t - 0.19) / 0.030, 2) / 2);

                // Delta wave: sigmoid ramp from baseline into QRS
                // Starts ~0.245, reaches ~0.40 by 0.34
                const deltaCenter = 0.29;
                const deltaWidth = 0.025;
                const delta = 0.40 / (1 + Math.exp(-(t - deltaCenter) / deltaWidth));
                // Fade delta after R peak so it doesn't affect later waveform
                const deltaFade = 1 / (1 + Math.exp((t - 0.38) / 0.010));
                v += delta * deltaFade;

                // R wave: sharp peak on top of delta
                v += 0.65 * Math.exp(-Math.pow((t - 0.36) / 0.020, 2) / 2);

                // S wave: deep, below baseline
                v += -0.55 * Math.exp(-Math.pow((t - 0.43) / 0.022, 2) / 2);

                // T wave: broad, inverted (discordant repolarization)
                v += -0.20 * Math.exp(-Math.pow((t - 0.57) / 0.060, 2) / 2);

                signal[i] = v;
            }

            // Tiny noise
            for (let i = 0; i < n; i++) {
                signal[i] += 0.003 * (Math.random() - 0.5);
            }
            return signal;
        },

        'af_wpw': function(sr, hr, idx) {
            // AF with WPW: fast irregular wide-complex tachycardia.
            // Wide monophasic POSITIVE QRS (no delta wave) + negative T wave.
            // Variable morphology beat-to-beat. Very fast irregular. No P waves.
            const effectiveHR = Math.max(hr, 160);
            const variation = 0.55 + Math.random() * 0.90;
            const beatHR = effectiveHR * variation;
            const rr = 60.0 / beatHR;
            const n = Math.round(rr * sr);
            const signal = new Float32Array(n);

            // Per-beat variation
            const amp = 0.8 + Math.random() * 0.8;           // QRS height
            const qrsW = 0.04 + Math.random() * 0.03;        // QRS width (wide: 40-70ms)
            const qrsSkew = 0.4 + Math.random() * 0.5;       // asymmetry
            const tAmp = 0.25 + Math.random() * 0.20;        // T wave depth

            // QRS center at ~30% of beat, T wave after
            const qrsCenter = 0.25 + Math.random() * 0.10;
            const tCenter = qrsCenter + 0.22 + Math.random() * 0.06;

            for (let i = 0; i < n; i++) {
                const t = i / n;
                const ts = i / sr;
                let v = 0;

                // Subtle fibrillatory baseline
                const fPhase = idx * 23.7;
                v += 0.010 * (
                    Math.sin(2 * Math.PI * 4.3 * ts + fPhase) +
                    Math.sin(2 * Math.PI * 7.1 * ts + fPhase * 1.3)
                );

                // Wide positive QRS: asymmetric sub-Gaussian (between pointy and rounded)
                const dt = t - qrsCenter;
                const w = dt < 0 ? qrsW : qrsW * qrsSkew;
                v += amp * Math.exp(-Math.pow(Math.abs(dt) / w, 1.5));

                // Broad negative T wave
                const dtT = t - tCenter;
                v += -amp * tAmp * Math.exp(-Math.pow(dtT / 0.07, 2) / 2);

                signal[i] = v;
            }

            // Tiny noise
            for (let i = 0; i < n; i++) {
                signal[i] += 0.004 * (Math.random() - 0.5);
            }
            return signal;
        },

        'tca_toxicity': function(sr, hr, idx) {
            // TCA toxicity: wide-complex tachycardia with sharp biphasic
            // complexes. Tall sharp R peak followed by deep broad S/T trough.
            // No P waves. Variable amplitude.
            const effectiveHR = Math.max(hr, 110);
            const rr = 60.0 / effectiveHR;
            const n = Math.round(rr * sr);
            const signal = new Float32Array(n);

            for (let i = 0; i < n; i++) {
                const t = i / n; // normalized 0..1
                let v = 0;

                // R wave: positive, sharp
                v += 0.65 * Math.exp(-Math.pow((t - 0.12) / 0.035, 2) / 2);

                // S wave: shallow, blending smoothly with R descent
                v += -0.08 * Math.exp(-Math.pow((t - 0.22) / 0.025, 2) / 2);

                // ST-T: gradual rise from S into broad T wave
                const stStart = 0.26;
                const tPeak = 0.58;
                const tEnd = 0.78;
                if (t > stStart && t <= tPeak) {
                    const phase = (t - stStart) / (tPeak - stStart);
                    v += 0.35 * phase * phase * phase;
                } else if (t > tPeak && t <= tEnd) {
                    const phase = (t - tPeak) / (tEnd - tPeak);
                    v += 0.35 * 0.5 * (1 + Math.cos(Math.PI * phase));
                }

                signal[i] = v;
            }

            // Tiny noise
            for (let i = 0; i < n; i++) {
                signal[i] += 0.005 * (Math.random() - 0.5);
            }
            return signal;
        },

        'hyperkalemia': function(sr, hr, idx) {
            // Severe hyperkalemia: P wave with long PR, very wide negative
            // QRS, tall peaked positive T wave, slow rate.
            const rr = 60.0 / hr;
            const n = Math.round(rr * sr);
            const signal = new Float32Array(n);

            for (let i = 0; i < n; i++) {
                const t = i / n; // normalized 0..1
                let v = 0;

                // P wave: broad, flat/low amplitude
                v += 0.06 * Math.exp(-Math.pow((t - 0.05) / 0.025, 2) / 2);

                // Very wide QRS — large negative deflection (very long PR)
                v += -0.70 * Math.exp(-Math.pow((t - 0.45) / 0.08, 2) / 2);

                // Tall peaked positive T wave
                v += 0.65 * Math.exp(-Math.pow((t - 0.72) / 0.050, 2) / 2);

                signal[i] = v;
            }

            // Tiny noise
            for (let i = 0; i < n; i++) {
                signal[i] += 0.005 * (Math.random() - 0.5);
            }
            return signal;
        },
    },

    /**
     * Returns true if the rhythm supports SYNC markers (has identifiable R waves).
     */
    supportsSyncMarker(rhythm) {
        const noSync = ['standby', 'cpr', 'ventricular_fibrillation', 'fine_vf', 'ventricular_standstill', 'asystole'];
        return !noSync.includes(rhythm);
    },

    /**
     * Find approximate R-peak position within a beat (fraction 0..1).
     */
    getRPeakPosition(rhythm) {
        if (rhythm === 'pacemaker') return 0.36;
        if (rhythm.startsWith('vt_') || rhythm === 'agonal') return 0.37;
        return 0.37;
    }
};


// ============================================================
// SpO2 Plethysmography Waveform
// ============================================================

const PlethGenerator = {
    /**
     * Generate one pulse cycle of pleth waveform.
     * @param {number} sampleRate
     * @param {number} heartRate
     * @param {number} spo2 - SpO2 value (affects amplitude)
     * @returns {number[]}
     */
    generatePulse(sampleRate, heartRate, spo2) {
        const rr = 60.0 / heartRate;
        const n = Math.round(rr * sampleRate);
        const signal = new Float32Array(n);

        // Amplitude scales with SpO2 (lower SpO2 → smaller, noisier pulse)
        const ampScale = (spo2 - 40) / 60; // 0 at spo2=40, 1 at spo2=100

        for (let i = 0; i < n; i++) {
            const t = i / n;
            // Systolic upstroke (fast rise)
            const systolic = Math.exp(-Math.pow((t - 0.2) / 0.08, 2) / 2);
            // Dicrotic notch + diastolic
            const dicrotic = 0.3 * Math.exp(-Math.pow((t - 0.4) / 0.06, 2) / 2);
            const diastolic = 0.4 * Math.exp(-Math.pow((t - 0.5) / 0.12, 2) / 2);

            signal[i] = ampScale * (systolic + dicrotic + diastolic);

            // Add noise for low SpO2
            if (spo2 < 80) {
                signal[i] += 0.02 * (Math.random() - 0.5) * (1 - ampScale);
            }
        }
        return signal;
    }
};


// ============================================================
// Capnography Waveform
// ============================================================

const CapnoGenerator = {
    /**
     * Generate one breath cycle of capnography.
     * @param {number} sampleRate
     * @param {number} respiratoryRate - breaths per minute
     * @param {number} etco2 - end-tidal CO2 mmHg (controls plateau height)
     * @returns {number[]}
     */
    generateBreath(sampleRate, respiratoryRate, etco2) {
        const breathDuration = 60.0 / respiratoryRate;
        const n = Math.round(breathDuration * sampleRate);
        const signal = new Float32Array(n);

        // Normalize etco2 to 0..1 range (0 mmHg → 0, 80 mmHg → 1)
        const plateau = etco2 / 80;

        // Phase timing (fraction of breath cycle)
        const inspEnd = 0.05;     // end of inspiratory baseline
        const upStart = 0.05;     // expiratory upstroke start
        const upEnd = 0.15;       // expstroke end
        const platStart = 0.15;   // alveolar plateau start
        const platEnd = 0.55;     // plateau end
        const downStart = 0.55;   // inspiratory downstroke
        const downEnd = 0.62;     // downstroke end

        for (let i = 0; i < n; i++) {
            const t = i / n;

            if (t < inspEnd) {
                // Inspiratory baseline (near zero)
                signal[i] = 0;
            } else if (t < upEnd) {
                // Expiratory upstroke (sigmoid-like rise)
                const phase = (t - upStart) / (upEnd - upStart);
                signal[i] = plateau * 0.5 * (1 + Math.tanh(6 * (phase - 0.5)));
            } else if (t < platEnd) {
                // Alveolar plateau (slight upslope)
                const phase = (t - platStart) / (platEnd - platStart);
                signal[i] = plateau * (0.95 + 0.05 * phase);
            } else if (t < downEnd) {
                // Inspiratory downstroke (sharp drop)
                const phase = (t - downStart) / (downEnd - downStart);
                signal[i] = plateau * 0.5 * (1 + Math.tanh(-8 * (phase - 0.5)));
            } else {
                // Rest of inspiratory phase (zero)
                signal[i] = 0;
            }
        }
        return signal;
    }
};


// ============================================================
// Sweep-Line Canvas Renderer
// ============================================================

class WaveformRenderer {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {string} color - CSS color string
     * @param {number} sweepSpeed - pixels per second
     */
    constructor(canvas, color, sweepSpeed = 200) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.color = color;
        this.sweepSpeed = sweepSpeed;

        // Buffer stores waveform values (one per pixel column)
        this.buffer = null;
        this.writePos = 0;
        this.gapWidth = 12; // blank gap ahead of sweep line

        // SYNC markers: array of pixel positions where markers should appear
        this.syncMarkers = [];
        this.syncEnabled = false;

        this._resize();
        this._resizeObserver = new ResizeObserver(() => this._resize());
        this._resizeObserver.observe(canvas);
    }

    _resize() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.displayWidth = rect.width;
        this.displayHeight = rect.height;

        // Reinitialize buffer
        const newLen = Math.ceil(this.displayWidth);
        if (!this.buffer || this.buffer.length !== newLen) {
            this.buffer = new Float32Array(newLen);
            this.writePos = 0;
            this.syncMarkers = [];
        }
    }

    clearSyncMarkers() {
        this.syncMarkers = [];
    }

    /**
     * Push waveform samples into the sweep buffer.
     * @param {Float32Array|number[]} samples - Waveform values in [0, 1] or [-1, 1] range
     * @param {number} sampleRate - Sample rate of the input signal
     * @param {object} opts - Options: { syncMarkerAt: fraction[] } where each fraction is position within samples to mark
     */
    pushSamples(samples, sampleRate, opts = {}) {
        // Convert sample rate to pixel rate
        const samplesPerPixel = sampleRate / this.sweepSpeed;

        let lastPixel = -1;
        for (let i = 0; i < samples.length; i++) {
            const pixelPos = Math.floor(i / samplesPerPixel);
            const bufIdx = (this.writePos + pixelPos) % this.buffer.length;
            if (pixelPos !== lastPixel) {
                // First sample in a new pixel column — initialize
                this.buffer[bufIdx] = samples[i];
                lastPixel = pixelPos;
            } else {
                // Same pixel column — keep the sample with greater absolute value (peak-hold)
                if (Math.abs(samples[i]) > Math.abs(this.buffer[bufIdx])) {
                    this.buffer[bufIdx] = samples[i];
                }
            }
        }

        // Remove stale sync markers at pixel positions being overwritten
        const totalPixels = Math.floor(samples.length / samplesPerPixel);
        if (this.syncMarkers.length > 0) {
            this.syncMarkers = this.syncMarkers.filter(pos => {
                const dist = (pos - this.writePos + this.buffer.length) % this.buffer.length;
                return dist >= totalPixels;
            });
        }

        // Add sync markers (after eviction so new markers aren't immediately removed)
        if (opts.syncMarkerAt) {
            for (const frac of opts.syncMarkerAt) {
                const pixelPos = Math.floor((frac * samples.length) / samplesPerPixel);
                const bufIdx = (this.writePos + pixelPos) % this.buffer.length;
                this.syncMarkers.push(bufIdx);
            }
        }

        this.writePos = (this.writePos + totalPixels) % this.buffer.length;
    }

    /**
     * Render the current buffer state to the canvas.
     * @param {number} yMin - Min value in signal (for scaling)
     * @param {number} yMax - Max value in signal (for scaling)
     */
    render(yMin = -0.5, yMax = 1.2) {
        const { ctx, displayWidth, displayHeight, buffer, writePos, gapWidth } = this;
        const len = buffer.length;

        ctx.clearRect(0, 0, displayWidth, displayHeight);

        // Draw waveform trace
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 1.8;
        ctx.lineJoin = 'round';
        ctx.beginPath();

        let drawing = false;
        const yRange = yMax - yMin;
        const margin = 8;
        const plotHeight = displayHeight - margin * 2;

        for (let x = 0; x < len; x++) {
            // Skip the gap around write position
            const distToWrite = (writePos - x + len) % len;
            if (distToWrite < gapWidth || distToWrite > len - 3) {
                if (drawing) {
                    ctx.stroke();
                    ctx.beginPath();
                    drawing = false;
                }
                continue;
            }

            const val = buffer[x];
            const y = margin + plotHeight * (1 - (val - yMin) / yRange);

            if (!drawing) {
                ctx.moveTo(x, y);
                drawing = true;
            } else {
                ctx.lineTo(x, y);
            }
        }
        if (drawing) ctx.stroke();

        // Draw SYNC markers (white triangles above R peaks)
        if (this.syncEnabled && this.syncMarkers.length > 0) {
            ctx.fillStyle = '#ffffff';
            for (const pos of this.syncMarkers) {
                const distToWrite = (writePos - pos + len) % len;
                if (distToWrite < gapWidth || distToWrite > len - 3) continue;

                const val = buffer[pos];
                const y = margin + plotHeight * (1 - (val - yMin) / yRange);

                // Triangle above the peak
                const triY = Math.max(y - 10, margin);
                ctx.beginPath();
                ctx.moveTo(pos, triY);
                ctx.lineTo(pos - 5, triY - 10);
                ctx.lineTo(pos + 5, triY - 10);
                ctx.closePath();
                ctx.fill();
            }
        }
    }
}
