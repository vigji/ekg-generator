"""FastAPI backend for the patient monitor simulator.

Manages state and relays parameter changes from controller to monitor via WebSocket.
"""

import json
import asyncio
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from models import MonitorState, RHYTHM_TYPES

app = FastAPI(title="Patient Monitor Simulator")

# Current monitor state (shared between all connections)
current_state = MonitorState()

# Connected WebSocket clients
monitor_clients: set[WebSocket] = set()
controller_clients: set[WebSocket] = set()

# Paths
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"


# --- Static file serving ---

@app.get("/controller")
@app.get("/controller/")
async def serve_controller():
    return FileResponse(FRONTEND_DIR / "controller" / "index.html")


@app.get("/monitor")
@app.get("/monitor/")
async def serve_monitor():
    return FileResponse(FRONTEND_DIR / "monitor" / "index.html")


# Mount static files for both UIs
app.mount("/controller/static", StaticFiles(directory=FRONTEND_DIR / "controller"), name="controller_static")
app.mount("/monitor/static", StaticFiles(directory=FRONTEND_DIR / "monitor"), name="monitor_static")


# --- REST endpoints ---

@app.get("/api/state")
async def get_state():
    """Get current monitor state."""
    return current_state.model_dump()


@app.get("/api/rhythms")
async def get_rhythms():
    """Get list of available rhythm types."""
    return JSONResponse(content=RHYTHM_TYPES)


# --- WebSocket endpoints ---

async def broadcast_state():
    """Send current state to all connected monitors."""
    state_json = json.dumps({"type": "state_update", "state": current_state.model_dump()})
    disconnected = set()
    for ws in monitor_clients:
        try:
            await ws.send_text(state_json)
        except Exception:
            disconnected.add(ws)
    monitor_clients.difference_update(disconnected)


@app.websocket("/ws/controller")
async def controller_ws(websocket: WebSocket):
    """WebSocket endpoint for the controller UI."""
    global current_state
    await websocket.accept()
    controller_clients.add(websocket)

    # Send current state on connect
    await websocket.send_text(json.dumps({
        "type": "state_update",
        "state": current_state.model_dump(),
        "rhythms": RHYTHM_TYPES,
    }))

    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)

            if msg.get("type") == "update":
                # Apply partial state update
                updates = msg.get("state", {})
                state_dict = current_state.model_dump()
                state_dict.update(updates)
                new_state = MonitorState(**state_dict)
                current_state = new_state
                # Broadcast to all monitors
                await broadcast_state()
                # Echo back to all controllers
                for ws in controller_clients:
                    try:
                        await ws.send_text(json.dumps({
                            "type": "state_update",
                            "state": current_state.model_dump(),
                        }))
                    except Exception:
                        pass

    except WebSocketDisconnect:
        controller_clients.discard(websocket)


@app.websocket("/ws/monitor")
async def monitor_ws(websocket: WebSocket):
    """WebSocket endpoint for the monitor UI."""
    await websocket.accept()
    monitor_clients.add(websocket)

    # Send current state on connect
    await websocket.send_text(json.dumps({
        "type": "state_update",
        "state": current_state.model_dump(),
    }))

    try:
        while True:
            # Monitor mostly receives, but keep connection alive
            data = await websocket.receive_text()
            msg = json.loads(data)
            if msg.get("type") == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        monitor_clients.discard(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
