# ARYA — complete project (frontend + backend)

This zip contains both halves of the ARYA robot project:

```
frontend/arya-robot-control/   React + Three.js UI (Vite)
backend/AURA_Windows/          Python backend — vision, face recognition, chat
```

They are two separate processes that talk over HTTP/WebSocket on
`localhost:8000` by default — there's no build step that merges them.

## What's new in THIS pass (3D Simulation rework)

- **Fixed voice/typed movement commands** ("Arya, turn left", the
  on-screen pad, and movement said in chat) — these used to nudge the
  robot a fixed ~45° or ~0.6m and stop. They now drive continuously
  (smooth accel/decel, real wall collision) until told to stop or
  overridden, so "turn left" actually turns instead of twitching.
  Rewritten in `frontend/.../src/hooks/useRobotState.tsx`.
- **The 3D Simulation environment is now the actual building** — a
  wood-panelled reception lobby opening into a two-tone corridor with
  doors, signage, lockers, and a window at the far end — instead of an
  abstract dark grid. ARYA spawns at the door and walks the corridor.
  See `frontend/.../src/world/`.
- **Three drive modes** on the Simulation page: **Controls** (hold the
  on-screen pad or WASD/arrows), **Voice** (say "Arya, move forward" /
  "turn left" / "stop"), and **Automatic**, which now has a one-click
  **Corridor Patrol** — ARYA drives herself door → corridor end →
  back to the door, hands-off — alongside the existing "drive to a
  named point" auto-navigate list.
- **A real live map**, not just a text list — `CorridorMiniMap` draws
  the actual floorplan with ARYA's live position, heading, and travel
  trail, visible in every drive mode.
- **"VCET Live Demo"** — the live camera / object detection / face
  recognition page (previously "Live Robotics") is relabelled
  throughout the app to match your campus deployment.
- **Mobile**: added a bottom tab bar so navigation still works below
  ~900px (the sidebar hides itself there and previously had no
  replacement); the Simulation page, mode tabs, and live map all now
  fit a phone screen. Also fixed a WebGL context-loss case (the canvas
  could go permanently black under memory pressure, which matters more
  on phones/low-end GPUs than desktops) — it now recovers on its own.
- Replaced a station-label component that silently depended on
  fetching a font over the network (`drei`'s `<Text>`) with a
  self-contained canvas-drawn label, so the 3D view still renders
  correctly on a locked-down or offline deployment network.

The previous pass's backend work (vision/face-recognition pipeline,
chat, FastAPI server) is unchanged — see the section below.

## What's new in the previous pass (backend wiring)

The backend was genuinely unfinished before that pass — object
detection, person detection, face recognition, and chat were not
reachable from the frontend at all (the frontend was 100% mock data;
see its own README's "Phase 1" note). That pass added:

- **`backend/AURA_Windows/vision_service.py`** — a *headless* camera +
  detection pipeline (no `cv2.imshow` window, ever). Runs the
  already-bundled `yolov8n.pt` once per cycle with no class filter, so
  one model serves both general **object detection** and **person
  detection** (class 0). Every person box is checked against
  **InsightFace** using your existing `known_faces/` folder, and
  tracked through DETECTED → RECOGNIZED → GREETED → PRESENT → LEFT.
  The camera runs continuously in the background the moment the
  backend starts — the *only* way to see it is the annotated stream it
  serves to the browser, which is what "camera hidden but running"
  means here.
- **`backend/AURA_Windows/chat_service.py`** — text chat engine reusing
  your exact wake-word / introduction / college-info / campus-location
  / movement-command matching logic (all read straight from
  `vivek_common.Config`, nothing duplicated by hand), with a Gemini
  **text** fallback for open-ended questions. Say/type "Arya" alone and
  she replies "Yes, how can I help you today?"; ask her something else
  and, once you set `GEMINI_API_KEY` in `backend/AURA_Windows/.env`,
  she answers via Gemini.
- **`backend/AURA_Windows/web_server.py`** — the FastAPI app tying it
  together: `GET /api/vision/mjpeg` (live annotated camera),
  `WS /ws/vision` (objects/people/log), `POST /api/chat`,
  `POST /api/robot/command`. Full contract in
  `backend/AURA_Windows/WEB_INTEGRATION.md`.
- **Frontend wiring** (`frontend/arya-robot-control/src/services/real/`,
  `src/hooks/useVisionFeed.ts`, and updated `LiveCamera`,
  `LiveRobotics`, `TalkWithArya`, `ConversationPanel`) — replaces the
  mock vision/chat data and the browser's own `getUserMedia()` camera
  with the real backend above. Movement commands (buttons, voice, or
  said in chat — "Arya, move front") still drive the 3D avatar
  client-side *and* now also reach the backend's `MovementController`.
  3D avatar telemetry (position/battery/trail) is still a client-side
  simulation, unchanged — there's no physical chassis in this project
  to report real telemetry from.

## Quick start

**1. Backend**
```
cd backend/AURA_Windows
python -m venv .venv && .venv\Scripts\activate      (Windows)
pip install -r requirements.txt
```
Open `.env`, paste your key into `GEMINI_API_KEY=` (get one at
https://aistudio.google.com/apikey). Then:
```
python web_server.py
```
or double-click `run_web_server.bat`. Watch the console for
`Camera online` / any `[WARN]` lines — see `SETUP_NOTES.md` for camera
troubleshooting and `WEB_INTEGRATION.md` for everything web-specific
(this step can take a little while the first run — see the
`known_faces/` startup-cost note in `WEB_INTEGRATION.md`).

**2. Frontend** (separate terminal)
```
cd frontend/arya-robot-control
npm install
npm run dev
```
Open the printed `localhost` URL. If the backend isn't on
`localhost:8000`, copy `.env.example` to `.env` first and set
`VITE_API_BASE_URL`. To try it on a phone on the same network, run
`npm run dev -- --host` instead and open the printed Network URL.

For a production deploy, `npm run build` then serve the `dist/`
folder from any static host — set `VITE_API_BASE_URL` (and
`VITE_WS_BASE_URL` if needed) to wherever the backend is reachable
before building.

**3. Try it**
- **3D Simulation** — drive ARYA from the door, down the corridor,
  and back using Controls, Voice, or the one-click Automatic Corridor
  Patrol.
- **VCET Live Demo** — the camera feed is the backend's real annotated
  stream; "Objects Detected" and "Recognized People" are real YOLO +
  InsightFace output, not placeholders.
- **Talk with ARYA** — type or (in Chrome/Edge) speak. Say "Arya" alone
  for the wake reply, or ask a real question once `GEMINI_API_KEY` is
  set.

## What's still a simulation

- The 3D avatar's position/rotation/battery/trail (no physical robot
  in this project).
- GPIO/motor/servo output — present and correctly wired
  (`MovementController`/`GestureController`, reused as-is from the
  original desktop app) but only actually drives hardware if
  `ENABLE_GPIO=true` *and* this runs on the robot's own board.

See each project's own README (`frontend/arya-robot-control/README.md`)
and setup docs (`backend/AURA_Windows/SETUP_NOTES.md`,
`backend/AURA_Windows/WEB_INTEGRATION.md`) for everything else.
