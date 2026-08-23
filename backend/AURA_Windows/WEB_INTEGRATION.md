# AURA Web Integration

This document covers the **new** web backend (`web_server.py` +
`vision_service.py` + `chat_service.py`) that serves the React frontend
(`arya-robot-control`) — object detection, person detection, face
recognition, and Gemini-backed chat, all reachable from a browser
instead of the original desktop app's local cv2 window + speakers.

It does **not** replace `vivek_main.py`. That's still here, unchanged,
and still the way to run AURA as a standalone kiosk app on one PC with
its own screen/mic/speakers, exactly as documented in `SETUP_NOTES.md`.
The two entry points share the same models/config/known_faces but
never run in the same process — pick one per launch, depending on
whether you want the local kiosk experience or the browser UI.

```
vivek_main.py        -> desktop kiosk: cv2 window, local mic+speakers,
                         Gemini LIVE (audio) model
web_server.py         -> FastAPI backend for the React frontend:
                         MJPEG stream + WebSocket + REST, Gemini TEXT model
```

## Why two different Gemini calls exist

`aura_gemini.py` (used by `vivek_main.py`) streams the actual captured
question **audio** into a Gemini **Live** session and plays back
streamed **audio** — that's `Config.GEMINI_MODEL`
(`gemini-3.1-flash-live-preview` by default).

`chat_service.py` (used by `web_server.py`) takes **text** (the
browser's own Web Speech API already turned speech into text before it
reaches this backend) and calls Gemini's plain
`client.models.generate_content(...)` — that's the separate
`Config.GEMINI_TEXT_MODEL` (`gemini-2.5-flash` by default). If you ever
want ARYA to speak her web-chat replies out loud, that's the browser's
`window.speechSynthesis` doing it client-side (see
`TalkWithArya.tsx`) — no audio travels to/from this backend at all.

Both use the same `GEMINI_API_KEY` and the same `google-genai` package
— just two different corners of that SDK, controlled by two separate
model settings so changing one never affects the other.

## Running it

```
cd AURA_Windows
# one-time setup: see SETUP_NOTES.md (Python venv, pip install -r
# requirements.txt, GEMINI_API_KEY in .env)
python web_server.py
```

or, for auto-reload while developing:

```
uvicorn web_server:app --host 0.0.0.0 --port 8000 --reload
```

`run_web_server.bat` does the same as `run_aura.bat` did for the
desktop app — activates `.venv` if present, then runs the line above.

The server starts listening immediately; the camera, YOLO model, and
InsightFace face database all load in a **background thread** (this
can take anywhere from a few seconds to a couple of minutes the first
time, mostly spent re-embedding every photo under `known_faces/` — see
the "known_faces startup cost" note below). Poll `GET /api/health`
while that's happening — `vision.state` walks through
`loading_faces -> loading_yolo -> opening_camera -> running` (or
`error`, with `vision.error` set, if the camera couldn't be opened).
`GET /api/vision/mjpeg` shows a "camera starting..." placeholder frame
until it's ready.

Then, in the frontend folder:

```
cd ../arya-robot-control
npm install        # if you haven't already
cp .env.example .env   # only needed if the backend isn't on localhost:8000
npm run dev
```

## Camera: hidden, but always running

`vision_service.py` never calls `cv2.imshow()`. The camera opens once,
in a background thread, the moment `web_server.py` starts, and keeps
capturing + running detection for as long as the process is up —
**not** just while someone has the Live Robotics page open. The only
way to see the feed at all is the annotated MJPEG stream this backend
serves at `GET /api/vision/mjpeg`, which the frontend's `<LiveCamera>`
displays. There is no local preview window on the machine running the
backend — that's the "camera should be hidden but running" behaviour.

## One model, two detection jobs

`Config.PERSON_MODEL` (`yolov8n.pt`, already bundled in this project)
is a stock COCO-pretrained YOLOv8 checkpoint — 80 general object
classes, with "person" as class 0. `vision_service.py` runs it **once**
per detection cycle with no class filter:
- class 0 boxes → person detection → each one is checked against
  InsightFace (`vivek_face.FaceDatabase`, same `known_faces/` folder,
  same `MATCH_THRESHOLD` as the desktop app) to decide RECOGNIZED vs.
  Unknown, and tracked in the `/ws/vision` `people` list.
- every other class → counted by label → the `/ws/vision` `objects`
  list ("Objects Detected" panel).

No second model, no `ENABLE_PERSON_DETECTION=true` needed in `.env` —
the web backend always loads this model, independent of that flag
(which still only affects the desktop app's optional cosmetic person
boxes).

## Endpoint contract

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | `{status, vision: {ready, state, error}, chat: {gemini_enabled, model}, faces_known}` |
| GET | `/api/faces` | `{names: string[]}` — enrolled `known_faces/` folder names |
| GET | `/api/vision/mjpeg` | Live annotated camera stream (`multipart/x-mixed-replace`) |
| GET | `/api/vision/state` | One-shot `{ready, status, error, objects, people, log}` snapshot |
| WS | `/ws/vision` | Pushes that same snapshot every `VISION_WS_INTERVAL` seconds (default 0.7s) |
| POST | `/api/chat` | `{message, user_name?}` → `{reply, user_text, source, lang, movement}` |
| POST | `/api/robot/command` | `{command}` (a `VoiceCommand` value, e.g. `MOVE_FORWARD`, `NAMASTE`) → `{ok, message}` |

`objects` / `people` / `log` in the vision snapshot match the
frontend's `DetectedObject` / `RecognizedPerson` / `LiveLogEntry` types
(`src/types/vision.ts`) field-for-field — no mapping layer needed on
either side.

`source` in a chat reply is one of `wake | intro | college | location |
kannada_toggle | movement | gemini | unavailable | empty` — see
`chat_service.py`'s `AuraChatEngine.handle()` for exactly what each one
means; it mirrors `VoiceListener._handle_utterance` in
`vivek_interaction.py` step for step, just against typed text.

## Config additions

Everything new lives in `vivek_common.py`'s `Config` class (same
pattern as everything else in this project) and `.env` — see the "Web
backend" section near the bottom of `.env`:
`GEMINI_TEXT_MODEL`, `CHAT_WAKE_REPLY` / `CHAT_WAKE_REPLY_NAMED`,
`WEB_HOST` / `WEB_PORT` / `CORS_ALLOWED_ORIGINS`, `STREAM_FPS` /
`JPEG_QUALITY` / `VISION_WS_INTERVAL`.

## `known_faces/` startup cost

This project ships with a lot of enrolled people. `FaceDatabase.load()`
(unchanged from the desktop app, `vivek_face.py`) re-embeds every photo
under `known_faces/<name>/` on every startup — there's no cache file.
With this many people/photos that can take real time (tens of seconds
to a couple of minutes on CPU). This happens in the background thread
so the server itself is responsive immediately either way; if you want
faster iteration while developing, temporarily move most of
`known_faces/` elsewhere and put a few folders back for a quick smoke
test.

## Deliberately out of scope here

- **3D avatar telemetry** (position/rotation/battery/trail) stays a
  pure client-side simulation in the frontend
  (`services/mock/mockRobot.ts`) — there's no physical robot chassis in
  this project to report real telemetry from.
- **GPIO/motors/servos**: `MovementController`/`GestureController` are
  reused as-is from the desktop app. They're simulated (just logged)
  unless `ENABLE_GPIO=true` in `.env` AND this is actually running on
  the robot's own hardware — nothing web-specific changed there.
