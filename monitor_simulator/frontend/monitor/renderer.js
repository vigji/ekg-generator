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
            // Irregular RR — wider variation (60-150% of base)
            const variation = 0.6 + Math.random() * 0.9;
            const effectiveHR = hr * variation;
            const beat = ECGRhythms._normalBeat(sr, effectiveHR, {
                pAmp: 0,
            });
            // Tripled f-wave components for realistic fibrillatory baseline
            const phase1 = idx * 31.7;
            const phase2 = idx * 47.3;
            const phase3 = idx * 19.1;
            for (let i = 0; i < beat.length; i++) {
                const t = i / sr;
                beat[i] += 0.025 * (
                    Math.sin(2 * Math.PI * 4.1 * t + phase1) +
                    Math.sin(2 * Math.PI * 6.5 * t + phase2) +
                    Math.sin(2 * Math.PI * 8.3 * t + phase3)
                );
            }
            return beat;
        },

        'atrial_flutter': function(sr, hr, idx) {
            // Classic inverted sawtooth flutter at ~300/min with variable conduction
            // Ref: sharp negative deflection, gradual upslope back to baseline
            const variation = 0.85 + Math.random() * 0.3; // variable block (85-115%)
            const effectiveHR = hr * variation;
            const rr = 60.0 / effectiveHR;
            const n = Math.round(rr * sr);
            const signal = new Float32Array(n);
            const flutterRate = 300;
            const flutterPeriod = sr * 60.0 / flutterRate;

            for (let i = 0; i < n; i++) {
                const phase = (i % flutterPeriod) / flutterPeriod;
                // Inverted sawtooth: 30% sharp downstroke, 70% gradual upslope
                if (phase < 0.3) {
                    // Sharp negative deflection
                    signal[i] = -0.22 * Math.sin(Math.PI * phase / 0.3);
                } else {
                    // Gradual upslope back to baseline
                    const upPhase = (phase - 0.3) / 0.7;
                    signal[i] = -0.22 * Math.sin(Math.PI * (1 - upPhase) * 0.3 / 0.3) * (1 - upPhase);
                }
            }
            // Overlay narrow QRS
            const qrs = ECGRhythms._normalBeat(sr, effectiveHR, { pAmp: 0, rAmp: 1.1 });
            const offset = Math.floor(0.37 * n - 0.37 * qrs.length);
            for (let i = 0; i < qrs.length && i + offset < n; i++) {
                if (i + offset >= 0) {
                    const t = i / qrs.length;
                    if (t > 0.28 && t < 0.72) {
                        signal[i + offset] += qrs[i];
                    }
                }
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
            const effectiveHR = Math.max(hr, 150);
            // Slightly reduced amplitudes at high rates
            const rateFactor = Math.min(1, 180 / effectiveHR);
            return ECGRhythms._normalBeat(sr, effectiveHR, {
                pAmp: -0.03,  // tiny retrograde P buried in ST
                pPos: 0.44,
                pWidth: 0.02,
                rAmp: 0.85 * rateFactor + 0.15,
                rWidth: 0.014,
                tAmp: 0.18 * rateFactor + 0.05,
            });
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
            // Torsades — axis rotation flips polarity, spindle amplitude
            const effectiveHR = Math.max(hr, 180);
            const polarity = Math.sin(idx * 0.25); // flips over ~25 beats
            const envelope = 0.4 + 0.6 * Math.abs(Math.sin(idx * 0.12)); // spindle wax/wane
            return ECGRhythms._wideBeat(sr, effectiveHR, {
                qAmp: -0.15 * polarity * envelope,
                qWidth: 0.03,
                rAmp: 0.9 * polarity * envelope,
                rWidth: 0.06,
                sAmp: -0.5 * polarity * envelope,
                sWidth: 0.04,
                tAmp: -0.3 * polarity * envelope,
                tWidth: 0.06,
            });
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

        'asystole': function(sr, hr, idx) {
            const n = Math.round(sr * 1.5);
            const signal = new Float32Array(n);
            for (let i = 0; i < n; i++) {
                signal[i] = 0.005 * (Math.random() - 0.5);
            }
            return signal;
        },

        'agonal': function(sr, hr, idx) {
            const effectiveHR = Math.min(hr, 35);
            return ECGRhythms._wideBeat(sr, effectiveHR, {
                rAmp: 0.4 + Math.random() * 0.3,
                rWidth: 0.05,
                sWidth: 0.04,
                tAmp: -0.15,
                tWidth: 0.08,
            });
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
            // Complete heart block — P waves march independently at ~75 bpm
            // Ventricles escape at ~35 bpm with wide QRS
            const ventRate = 35;
            const beat = ECGRhythms._wideBeat(sr, ventRate, {
                rAmp: 0.7,
            });
            // P waves at atrial rate, dissociated via modular arithmetic
            const atrialRate = 75;
            const atrialPeriodSamples = Math.round(sr * 60.0 / atrialRate);
            const ventPeriodSamples = beat.length;
            // Use golden ratio offset for smooth dissociation across beats
            const pStartOffset = Math.round((idx * atrialPeriodSamples * 0.618) % atrialPeriodSamples);
            for (let i = 0; i < beat.length; i++) {
                const posInAtrial = (i + pStartOffset) % atrialPeriodSamples;
                const tNorm = posInAtrial / atrialPeriodSamples;
                beat[i] += 0.12 * Math.exp(-Math.pow((tNorm - 0.15) / 0.04, 2) / 2);
            }
            return beat;
        },

        'stemi': function(sr, hr, idx) {
            // ST elevation merging into broad elevated T-wave
            return ECGRhythms._normalBeat(sr, hr, {
                stElev: 0.15,
                tAmp: 0.5,
                tWidth: 0.08,
            });
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

        'tca_toxicity': function(sr, hr, idx) {
            // Sinus tach with very wide QRS, P waves partially buried
            const effectiveHR = Math.max(hr, 110);
            return ECGRhythms._normalBeat(sr, effectiveHR, {
                pAmp: 0.08,
                pPos: 0.20,
                pWidth: 0.03,
                qAmp: -0.12,
                qPos: 0.30,
                qWidth: 0.025,
                rAmp: 0.85,
                rPos: 0.37,
                rWidth: 0.04,
                sAmp: -0.30,
                sPos: 0.45,
                sWidth: 0.035,
                tAmp: -0.25,
                tPos: 0.60,
                tWidth: 0.07,
            });
        },
    },

    /**
     * Returns true if the rhythm supports SYNC markers (has identifiable R waves).
     */
    supportsSyncMarker(rhythm) {
        const noSync = ['ventricular_fibrillation', 'asystole', 'vt_polymorphic'];
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
