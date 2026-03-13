# Patient Monitor Simulator

A real-time patient monitor simulator with two web interfaces:

- **Monitor** — fullscreen clinical display (for the student/audience screen)
- **Controller** — remote control panel (for the instructor)

Both connect to the same backend server via WebSocket. Parameter changes on the controller update the monitor in real time.

## Quick Start

```bash
# Install dependencies
pip3 install fastapi uvicorn[standard] websockets

# Start the server
cd monitor_simulator/backend
python3 -m uvicorn main:app --host 0.0.0.0 --port 8080
```

Then open in your browser:

- **Monitor display**: http://localhost:8080/monitor (click to go fullscreen)
- **Controller**: http://localhost:8080/controller

To use on **two different devices**, both devices must be on the same network. Use the server machine's IP address instead of `localhost` (e.g., `http://192.168.1.100:8080/monitor`).

## Controller Features

- **Rhythm grid**: tap to select from 16 ECG rhythms (NSR, AFib, VFib, Asystole, etc.)
- **Vertical sliders** for Heart Rate, Systolic BP, Diastolic BP, SpO2, EtCO2
- **SYNC mode** toggle for cardioversion markers
- **Reset** button to return to normal sinus rhythm defaults

## Monitor Features

- Dark clinical monitor display (resembles ICU bedside monitors)
- Real-time sweep-line waveforms:
  - ECG (green) with heart rate
  - SpO2 plethysmography (cyan) with saturation value
  - Capnography (yellow) with EtCO2 value
  - Blood pressure (red, numeric only)
- Click anywhere to enter fullscreen
- SYNC markers (white triangles above R-waves) when enabled
- Automatic reconnection if server connection drops

## Architecture

```
Controller (Device A) → WebSocket → FastAPI Server → WebSocket → Monitor (Device B)
```

Waveform generation happens client-side in JavaScript for smooth 60fps rendering. The server only relays parameter state changes.
