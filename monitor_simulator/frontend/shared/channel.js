/**
 * channel.js — BroadcastChannel-based cross-tab communication for the monitor simulator.
 *
 * Replaces the WebSocket backend with direct browser-to-browser messaging
 * between controller and monitor tabs (same origin, same device).
 */

const MonitorChannel = (function () {
    'use strict';

    const CHANNEL_NAME = 'ekg-monitor';
    const STORAGE_KEY = 'ekg-monitor-state';
    const HEARTBEAT_INTERVAL = 2000; // ms

    const DEFAULT_STATE = {
        rhythm: 'standby',
        heart_rate: 0,
        systolic: 0,
        diastolic: 0,
        spo2: 0,
        etco2: 0,
        respiratory_rate: 0,
        sync_mode: false,
        art_mode: false,
        pacing_mode: false,
        pacing_rate: 70,
        pacing_current: 70,
    };

    class Channel {
        constructor() {
            this._bc = new BroadcastChannel(CHANNEL_NAME);
            this._stateCallbacks = [];
            this._connectionCallbacks = [];
            this._heartbeatTimer = null;
            this._lastHeartbeat = 0;
            this._connectionCheckTimer = null;

            this._bc.onmessage = (event) => this._handleMessage(event.data);
        }

        // --- State persistence ---

        loadState() {
            try {
                const stored = localStorage.getItem(STORAGE_KEY);
                if (stored) {
                    return { ...DEFAULT_STATE, ...JSON.parse(stored) };
                }
            } catch (e) { /* ignore */ }
            return { ...DEFAULT_STATE };
        }

        saveState(state) {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            } catch (e) { /* ignore */ }
        }

        // --- Controller API ---

        /**
         * Post a full state update to all listeners and persist it.
         */
        postState(state) {
            this.saveState(state);
            this._bc.postMessage({ type: 'state_update', state: state });
        }

        /**
         * Start sending heartbeats so monitors know the controller is alive.
         */
        startHeartbeat() {
            this._heartbeatTimer = setInterval(() => {
                this._bc.postMessage({ type: 'heartbeat', timestamp: Date.now() });
            }, HEARTBEAT_INTERVAL);
        }

        stopHeartbeat() {
            if (this._heartbeatTimer) {
                clearInterval(this._heartbeatTimer);
                this._heartbeatTimer = null;
            }
        }

        // --- Monitor API ---

        /**
         * Register a callback for state updates.
         */
        onState(callback) {
            this._stateCallbacks.push(callback);
        }

        /**
         * Register a callback for connection status changes.
         * Called with true (connected) or false (disconnected).
         */
        onConnection(callback) {
            this._connectionCallbacks.push(callback);
        }

        /**
         * Request the current state from the controller.
         * Falls back to localStorage if no controller responds.
         */
        requestState() {
            this._bc.postMessage({ type: 'state_request' });
            // Fall back to localStorage after a short delay
            setTimeout(() => {
                if (this._lastHeartbeat === 0) {
                    const state = this.loadState();
                    this._stateCallbacks.forEach(cb => cb(state));
                }
            }, 500);
        }

        /**
         * Start monitoring for controller heartbeats.
         */
        startConnectionMonitor() {
            this._connectionCheckTimer = setInterval(() => {
                const alive = (Date.now() - this._lastHeartbeat) < HEARTBEAT_INTERVAL * 2;
                this._connectionCallbacks.forEach(cb => cb(alive));
            }, HEARTBEAT_INTERVAL);
        }

        stopConnectionMonitor() {
            if (this._connectionCheckTimer) {
                clearInterval(this._connectionCheckTimer);
                this._connectionCheckTimer = null;
            }
        }

        // --- Internal ---

        _handleMessage(msg) {
            switch (msg.type) {
                case 'state_update':
                    this._lastHeartbeat = Date.now();
                    this._stateCallbacks.forEach(cb => cb(msg.state));
                    break;
                case 'heartbeat':
                    this._lastHeartbeat = msg.timestamp;
                    break;
                case 'state_request':
                    // Controller responds to this — handled by controller.js
                    this._stateCallbacks.forEach(cb => cb(null, 'state_request'));
                    break;
            }
        }

        destroy() {
            this.stopHeartbeat();
            this.stopConnectionMonitor();
            this._bc.close();
        }
    }

    return {
        create() { return new Channel(); },
        DEFAULT_STATE: { ...DEFAULT_STATE },
    };
})();
