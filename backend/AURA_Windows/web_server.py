"""
================================================================================
 AURA WEB — FastAPI backend for the React frontend (arya-robot-control)

 Run with:
     python web_server.py
 or, for auto-reload during development:
     uvicorn web_server:app --host 0.0.0.0 --port 8000 --reload

 This is a NEW, separate entry point from vivek_main.py -- it does not
 replace it. vivek_main.py (the original desktop app: one cv2 window,
 local mic + speakers, Gemini LIVE audio) still runs exactly as before
 if that single-PC kiosk experience is ever needed again. This file is
 what makes AURA's vision (object detection, person detection, face
 recognition) and Gemini-backed chat reachable from a browser running
 the ARYA React UI over HTTP/WebSocket, instead of a local window +
 speakers -- see WEB_INTEGRATION.md for the full endpoint contract and
 the frontend wiring.

 Endpoints
 ----------------------------------------------------------------------
   GET  /api/health          status of the vision + chat engines
   GET  /api/faces           enrolled known-face names
   GET  /api/vision/mjpeg    live annotated camera stream (MJPEG)
   GET  /api/vision/state    one-shot {objects, people, log} snapshot
   WS   /ws/vision            pushes that same snapshot ~every 0.7s
   WS   /ws/vision-client     client-camera frame in -> annotated frame out
   POST /api/chat            {message} -> ARYA's reply (see chat_service.py)
   POST /api/robot/command   {command} -> movement/gesture (simulated
                              unless ENABLE_GPIO=true and this is
                              actually running on the robot's hardware)
================================================================================
"""

# vivek_common MUST be imported first -- see the note at the top of it
# (sets thread-oversubscription env vars before onnxruntime/torch/cv2
# get imported by vivek_face).
import vivek_common
from vivek_common import Config

import asyncio
from typing import Optional

import cv2
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel

from vivek_face import GestureController
from vivek_interaction import MovementController
from vision_service import VisionService
from chat_service import AuraChatEngine

app = FastAPI(title="AURA Web Backend")

_origins_raw = Config.CORS_ALLOWED_ORIGINS.strip()
origins = ["*"] if _origins_raw == "*" else [o.strip() for o in _origins_raw.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- shared singletons --------------------------------------------------
# Lightweight to construct (GPIO check only, gated behind Config.ENABLE_GPIO
# -- see GestureController/MovementController in vivek_face.py /
# vivek_interaction.py) so it's fine to build these at import time, unlike
# VisionService's heavy models (see vision_service.py's own note on this).
gesture = GestureController()
movement = MovementController()
vision = VisionService(gesture=gesture)
chat = AuraChatEngine(movement=movement, log_cb=lambda m: vision.log_event(m))


@app.on_event("startup")
def _on_startup():
    print(f"[Web] AURA web backend up — vision loading in the background "
          f"(check GET /api/health for progress)")
    vision.start()


@app.on_event("shutdown")
def _on_shutdown():
    vision.stop()
    try:
        movement.cleanup()
    except Exception:
        pass
    try:
        gesture.cleanup()
    except Exception:
        pass


# ══════════════════════════════════════════════════════════════════════
#  health / faces
# ══════════════════════════════════════════════════════════════════════

@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "vision": {"ready": vision.ready, "state": vision.status, "error": vision.error},
        "chat": {"gemini_enabled": chat.enabled, "model": Config.GEMINI_TEXT_MODEL},
        "faces_known": len(vision.face_db.names) if vision.face_db else 0,
    }


@app.get("/api/faces")
def faces():
    if vision.face_db is None:
        return {"names": []}
    return {"names": [n.replace("_", " ").title() for n in sorted(vision.face_db.names)]}


# ══════════════════════════════════════════════════════════════════════
#  vision -- MJPEG stream + polling snapshot + WebSocket push
# ══════════════════════════════════════════════════════════════════════

_PLACEHOLDER_JPEG: Optional[bytes] = None


def _placeholder_jpeg() -> bytes:
    """Shown in place of a real frame while the camera/models are still
    loading (see VisionService.status) or if the camera failed to open
    -- so the frontend's <img> tag always has SOMETHING to render
    instead of a broken-image icon."""
    global _PLACEHOLDER_JPEG
    if _PLACEHOLDER_JPEG is None:
        img = np.zeros((360, 640, 3), dtype=np.uint8)
        img[:] = (18, 14, 12)
        text = "ARYA camera starting..." if vision.status != "error" else "ARYA camera unavailable"
        cv2.putText(img, text, (48, 180), cv2.FONT_HERSHEY_DUPLEX, 0.75, (210, 210, 210), 1, cv2.LINE_AA)
        ok, buf = cv2.imencode(".jpg", img)
        _PLACEHOLDER_JPEG = buf.tobytes() if ok else b""
    return _PLACEHOLDER_JPEG


async def _mjpeg_generator():
    boundary = b"--frame"
    interval = 1.0 / max(1.0, Config.STREAM_FPS)
    while True:
        frame = vision.get_jpeg() or _placeholder_jpeg()
        yield (boundary + b"\r\nContent-Type: image/jpeg\r\nContent-Length: "
               + str(len(frame)).encode() + b"\r\n\r\n" + frame + b"\r\n")
        await asyncio.sleep(interval)


@app.get("/api/vision/mjpeg")
def vision_mjpeg():
    return StreamingResponse(
        _mjpeg_generator(), media_type="multipart/x-mixed-replace; boundary=frame")


@app.get("/api/vision/state")
def vision_state():
    return JSONResponse(vision.snapshot())


@app.websocket("/ws/vision")
async def ws_vision(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            await websocket.send_json({"type": "vision_update", **vision.snapshot()})
            await asyncio.sleep(Config.VISION_WS_INTERVAL)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[Web] /ws/vision error: {e}")


@app.websocket("/ws/vision-client")
async def ws_vision_client(websocket: WebSocket):
    """Receives JPEG frames captured by a BROWSER's own camera
    (frontend: hooks/useClientCamera.ts), runs each one through
    VisionService.process_client_frame (same YOLO + InsightFace
    pipeline the server webcam uses), and streams the annotated JPEG
    back so "My Camera" mode looks identical to "Server Webcam" mode.
    Detection is CPU/GPU-bound and synchronous, so it's offloaded to a
    worker thread via asyncio.to_thread to avoid blocking the event
    loop (and therefore every other request/socket this server
    handles) while a frame is being processed.
    """
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_bytes()
            frame = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
            if frame is None:
                continue
            annotated_jpeg = await asyncio.to_thread(vision.process_client_frame, frame)
            if annotated_jpeg:
                await websocket.send_bytes(annotated_jpeg)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[Web] /ws/vision-client error: {e}")


# ══════════════════════════════════════════════════════════════════════
#  chat
# ══════════════════════════════════════════════════════════════════════

class ChatRequest(BaseModel):
    message: str
    user_name: str = ""


@app.post("/api/chat")
def api_chat(req: ChatRequest):
    user_name = req.user_name or vision.active_user()
    result = chat.handle(req.message, user_name=user_name)
    return result


# ══════════════════════════════════════════════════════════════════════
#  robot command -- movement (MovementController) + gestures (GestureController)
# ══════════════════════════════════════════════════════════════════════

_MOVE_DIRECTIONS = {
    "MOVE_FORWARD": "forward", "MOVE_BACKWARD": "backward",
    "TURN_LEFT": "left", "TURN_RIGHT": "right", "STOP": "stop",
}


class CommandRequest(BaseModel):
    command: str


@app.post("/api/robot/command")
def api_robot_command(req: CommandRequest):
    cmd = (req.command or "").upper()

    if cmd in _MOVE_DIRECTIONS:
        direction = _MOVE_DIRECTIONS[cmd]
        movement.move(direction)
        vision.log_event(f"Robot command: {cmd}")
        return {"ok": True, "message": f"{direction} executed"
                                        + ("" if movement.hw_ready else " (simulated)")}

    if cmd == "NAMASTE":
        gesture.perform_namaste()
        vision.log_event("Namaste gesture triggered")
        return {"ok": True, "message": "Namaste" + ("" if gesture.hw_ready else " (simulated)")}

    if cmd in ("WAVE", "LOOK", "SPEAK"):
        vision.log_event(f"Robot command: {cmd} (simulated — no dedicated hardware for this gesture yet)")
        return {"ok": True, "message": f"{cmd.title()} (simulated)"}

    return {"ok": False, "message": f"Unknown command: {req.command}"}


if __name__ == "__main__":
    import uvicorn
    print(f"[Web] starting AURA web backend on http://{Config.WEB_HOST}:{Config.WEB_PORT}")
    uvicorn.run(app, host=Config.WEB_HOST, port=Config.WEB_PORT)
