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

    _rhythmHandlers: {
        'sinus_rhythm': function(sr, hr, idx) {
            return ECGRhythms._normalBeat(sr, hr);
        },

        'sinus_tachycardia': function(sr, hr, idx) {
            return ECGRhythms._normalBeat(sr, hr, {
                pAmp: 0.15, // slightly taller P waves
                tAmp: 0.20,
            });
        },

        'atrial_fibrillation': function(sr, hr, idx) {
            // Irregular RR — vary the effective HR for this beat
            const variation = 0.7 + Math.random() * 0.6; // 70-130% of base
            const effectiveHR = hr * variation;
            const beat = ECGRhythms._normalBeat(sr, effectiveHR, {
                pAmp: 0, // no P waves in AF
            });
            // Add fibrillatory baseline
            for (let i = 0; i < beat.length; i++) {
                beat[i] += 0.03 * (Math.sin(i * 0.8) + Math.sin(i * 1.3) + Math.random() * 0.5 - 0.25);
            }
            return beat;
        },

        'atrial_flutter': function(sr, hr, idx) {
            // Sawtooth flutter waves at ~300/min with 4:1 conduction
            const rr = 60.0 / hr;
            const n = Math.round(rr * sr);
            const signal = new Float32Array(n);
            const flutterRate = 300;
            const flutterPeriod = sr * 60.0 / flutterRate;

            for (let i = 0; i < n; i++) {
                // Sawtooth flutter
                const phase = (i % flutterPeriod) / flutterPeriod;
                signal[i] = 0.15 * (1 - 2 * phase);
            }
            // Overlay QRS
            const qrs = ECGRhythms._normalBeat(sr, hr, { pAmp: 0 });
            const offset = Math.floor(0.37 * n - 0.37 * qrs.length);
            for (let i = 0; i < qrs.length && i + offset < n; i++) {
                if (i + offset >= 0) {
                    // Only overlay QRS-T, not the flat parts
                    const t = i / qrs.length;
                    if (t > 0.3 && t < 0.7) {
                        signal[i + offset] += qrs[i];
                    }
                }
            }
            return signal;
        },

        'atrial_tachycardia': function(sr, hr, idx) {
            return ECGRhythms._normalBeat(sr, hr, {
                pAmp: 0.10,
                pPos: 0.18,  // P wave closer to QRS
                pWidth: 0.03,
            });
        },

        'psvt': function(sr, hr, idx) {
            return ECGRhythms._normalBeat(sr, hr, {
                pAmp: -0.05, // retrograde P wave (inverted, small)
                pPos: 0.42,  // P after QRS
                pWidth: 0.025,
            });
        },

        'junctional': function(sr, hr, idx) {
            return ECGRhythms._normalBeat(sr, hr, {
                pAmp: -0.06, // inverted P or absent
                pPos: 0.42,
                pWidth: 0.03,
            });
        },

        'vt_monomorphic': function(sr, hr, idx) {
            return ECGRhythms._wideBeat(sr, hr);
        },

        'vt_polymorphic': function(sr, hr, idx) {
            // Varying amplitude and morphology
            const phase = Math.sin(idx * 0.4) * 0.5 + 0.5;
            return ECGRhythms._wideBeat(sr, hr, {
                rAmp: 0.4 + phase * 0.8,
                sAmp: -0.1 - phase * 0.3,
                tAmp: -0.2 - (1 - phase) * 0.2,
            });
        },

        'ventricular_fibrillation': function(sr, hr, idx) {
            // Chaotic waveform — no organized QRS
            const n = Math.round(60.0 / Math.max(hr, 100) * sr);
            const signal = new Float32Array(n);
            // Multiple overlapping sinusoids + noise
            const freq1 = 4 + Math.random() * 4;
            const freq2 = 2 + Math.random() * 3;
            const amp = 0.3 + Math.random() * 0.4;
            for (let i = 0; i < n; i++) {
                const t = i / sr;
                signal[i] = amp * (
                    0.5 * Math.sin(2 * Math.PI * freq1 * t + Math.random() * 0.5) +
                    0.3 * Math.sin(2 * Math.PI * freq2 * t + Math.random() * 0.3) +
                    0.2 * (Math.random() - 0.5)
                );
            }
            return signal;
        },

        'asystole': function(sr, hr, idx) {
            // Flatline with minimal noise
            const n = Math.round(sr * 1.5); // ~1.5 seconds per "beat"
            const signal = new Float32Array(n);
            for (let i = 0; i < n; i++) {
                signal[i] = 0.005 * (Math.random() - 0.5);
            }
            return signal;
        },

        'agonal': function(sr, hr, idx) {
            // Slow, wide, bizarre complexes
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
            // Pacing spike followed by wide QRS
            const beat = ECGRhythms._wideBeat(sr, hr, {
                rAmp: 0.7,
                rWidth: 0.03,
            });
            // Add pacing spike just before QRS
            const spikePos = Math.floor(0.33 * beat.length);
            if (spikePos < beat.length) {
                beat[spikePos] = 1.5;
                if (spikePos + 1 < beat.length) beat[spikePos + 1] = -0.3;
            }
            return beat;
        },

        'av_block_1': function(sr, hr, idx) {
            // Prolonged PR interval
            return ECGRhythms._normalBeat(sr, hr, {
                pPos: 0.15,  // P wave earlier → longer PR
                qPos: 0.36,
                rPos: 0.39,
            });
        },

        'av_block_2': function(sr, hr, idx) {
            // Mobitz Type I (Wenckebach) — progressively longer PR, then dropped beat
            const cycleLen = 4;
            const beatInCycle = idx % cycleLen;
            if (beatInCycle === cycleLen - 1) {
                // Dropped beat — just P wave
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
            // Progressive PR prolongation
            const prShift = beatInCycle * 0.03;
            return ECGRhythms._normalBeat(sr, hr, {
                pPos: 0.18 - prShift,
            });
        },

        'av_block_3': function(sr, hr, idx) {
            // Complete heart block — P waves march through at atrial rate,
            // ventricles escape at ~35 bpm
            const ventRate = 35;
            const beat = ECGRhythms._wideBeat(sr, ventRate, {
                rAmp: 0.7,
            });
            // Add P waves at the atrial rate (dissociated)
            const atrialRate = 75;
            const atrialPeriod = sr * 60.0 / atrialRate;
            const pOffset = (idx * 137) % Math.floor(atrialPeriod); // pseudo-random P placement
            for (let i = 0; i < beat.length; i++) {
                const dist = ((i + pOffset) % atrialPeriod) / sr;
                beat[i] += 0.12 * Math.exp(-Math.pow(dist / 0.04, 2) / 2);
            }
            return beat;
        },
    },

    /**
     * Returns true if the rhythm supports SYNC markers (has identifiable R waves).
     */
    supportsSyncMarker(rhythm) {
        const noSync = ['ventricular_fibrillation', 'asystole'];
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

    /**
     * Push waveform samples into the sweep buffer.
     * @param {Float32Array|number[]} samples - Waveform values in [0, 1] or [-1, 1] range
     * @param {number} sampleRate - Sample rate of the input signal
     * @param {object} opts - Options: { syncMarkerAt: fraction[] } where each fraction is position within samples to mark
     */
    pushSamples(samples, sampleRate, opts = {}) {
        // Convert sample rate to pixel rate
        const samplesPerPixel = sampleRate / this.sweepSpeed;

        for (let i = 0; i < samples.length; i++) {
            const pixelPos = Math.floor(i / samplesPerPixel);
            const bufIdx = (this.writePos + pixelPos) % this.buffer.length;
            this.buffer[bufIdx] = samples[i];
        }

        // Add sync markers
        if (opts.syncMarkerAt) {
            for (const frac of opts.syncMarkerAt) {
                const pixelPos = Math.floor((frac * samples.length) / samplesPerPixel);
                const bufIdx = (this.writePos + pixelPos) % this.buffer.length;
                this.syncMarkers.push(bufIdx);
            }
            // Keep only recent markers
            if (this.syncMarkers.length > 50) {
                this.syncMarkers = this.syncMarkers.slice(-30);
            }
        }

        const totalPixels = Math.floor(samples.length / samplesPerPixel);
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
        if (this.syncMarkers.length > 0) {
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
