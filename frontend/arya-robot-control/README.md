# ARYA — Robot Control Center

**Phase 2: live backend connected.**

ARYA is an AI-powered robotic software platform developed by the Fire Brand AI
team. This repository is the **frontend and 3D simulation experience** for
ARYA. As of Phase 2, real object detection, person detection, face
recognition, and Gemini-backed conversation are wired in through the backend
in `AURA_Windows/` (`web_server.py` + `vision_service.py` + `chat_service.py`)
— see `src/config.ts` and `src/services/real/` for the client side of that
wiring, and the backend's `WEB_INTEGRATION.md` for the full contract.

3D telemetry (position/rotation/battery/trail) is still a client-side
simulation — there's no physical robot chassis in this project yet — driven
by `src/services/mock/mockRobot.ts`. Everything perception- and
conversation-related (`src/services/mock/mockVision.ts` timestamp/log
helpers aside) now talks to the real backend instead. The architecture is
still shaped so any remaining mock piece can be swapped out later without
touching the UI layer above it.

**Running both halves together:**
1. Backend: `cd AURA_Windows`, follow `SETUP_NOTES.md` to install deps and
   set `GEMINI_API_KEY` in `.env`, then `python web_server.py` (defaults to
   `http://localhost:8000`).
2. Frontend: `npm install`, copy `.env.example` to `.env` if the backend
   isn't on `localhost:8000`, then `npm run dev`.

---

## Technology stack

- React 19 + TypeScript
- Vite
- Three.js + React Three Fiber + @react-three/drei
- lucide-react (icons)
- Plain CSS Modules with a shared design-token system (no CSS framework)

## Getting started

```bash
npm install
npm run dev       # start the dev server
npm run build     # type-check + production build
npm run preview   # preview the production build
```

---

## Experience map

Opening the app plays a full-screen boot sequence, then lands on Home, where
the user picks one of three primary experiences. There are **no other
top-level pages** — a "Logs" view lives inside each experience that needs it,
and Settings is a small modal opened from the header, not a page.

```
Boot  →  Home  →  ┬─ Live Robotics   (camera, voice, movement, vision, logs)
                   ├─ 3D Simulation  (orbit-able station, movement, trail)
                   └─ Talk with ARYA (conversation, greeting manager, logs)
```

### Boot (`src/pages/Boot.tsx`)
Cinematic init screen. A simulated progress bar drives five system-module
checks (Core System, Vision Engine, Voice Interface, Behaviour Engine,
Simulation Engine); ARYA's eyes glow on as progress crosses a threshold, then
the screen hands off to Home with a "Namaste! I am ARYA." greeting.

### Home (`src/pages/Home.tsx`)
Hero with an orbiting 3D ARYA and the three `ExperienceCard`s that route into
each mode.

### Live Robotics (`src/pages/LiveRobotics.tsx`)
- `LiveCamera` renders the backend's already-annotated MJPEG stream
  (`GET /api/vision/mjpeg`) — real YOLO object/person boxes and InsightFace
  name labels baked in server-side. It does **not** use
  `navigator.mediaDevices.getUserMedia()`: the camera runs headless on the
  backend (see `vision_service.py`), never in a visible window, and keeps
  capturing whether or not this page is open.
- `useVisionFeed` (a WebSocket to `GET /ws/vision`) supplies real
  `objects`/`people`/`log` to `VisionObjects`, `RecognizedPeople`, and
  `LiveRobotLog` — no mock perception data on this page anymore.
- `VoiceCommandPanel` uses the browser's real Web Speech API
  (`useSpeechRecognition`) to match a spoken phrase to a movement command.
- `MovementControls`/`VoiceCommandPanel` send `VoiceCommand` values
  (`MOVE_FORWARD`, `TURN_LEFT`, `STOP`, …) into the shared robot state (3D
  avatar, still simulated client-side) AND to the backend's
  `POST /api/robot/command` (`services/real/robotClient.ts`), so the command
  is logged server-side and would drive real hardware if `ENABLE_GPIO=true`
  on the robot's own machine.

### 3D Simulation (`src/pages/Simulation.tsx`)
A real, orbit/zoom/pan-able React Three Fiber scene (`SimulationEnvironment`)
with four pre-built stations (Vision, Control, Lab, Library), a `StationMap`
side panel, a directional pad that actually moves the 3D ARYA through a
simple `{x, z}` coordinate system, and a `PathRenderer` movement trail.

### Talk with ARYA (`src/pages/TalkWithArya.tsx`)
A large orbit-able 3D ARYA, a `ConversationPanel` wired to the backend's
`POST /api/chat` (`services/real/chatClient.ts`) — wake word ("Arya" →
"Yes, how can I help you today?"), the introduction / college-info / campus
location canned answers, movement commands, and an open-ended Gemini
fallback all come from there (see the backend's `chat_service.py`).
`VoiceInput`'s mic is the real Web Speech API (`useSpeechRecognition`): a
recognized phrase is sent straight to the same `/api/chat` flow, and ARYA's
text reply is spoken back with the browser's `speechSynthesis` — no audio is
sent to or from the backend, only text. `RecognizedPeople` and the live log
come from the same `useVisionFeed` WebSocket Live Robotics uses. The
`GreetingManager`'s "Test Namaste" button remains a manual UI walkthrough of
the queue state machine described below, separate from the backend's own
automatic greet-on-recognition behaviour.

---

## The Greeting Manager

`src/components/conversation/GreetingManager.tsx` implements the **state
machine and queue UI** for ARYA's future greeting behaviour, per the intended
flow:

```
Person detected → Face recognized → already greeted?
  no  → add to queue
  before greeting → re-check the person is still present
    present → perform Namaste → mark completed
    left    → drop from queue, never greeted
```

Only the UI/state layer exists today (`GreetingManagerState`,
`GreetingQueueEntry` in `types/conversation.ts`); the "Test Namaste" button
walks through `READY → CHECKING_PRESENCE → GREETING → READY` so the full
interaction is visible before real perception is wired in.

---

## 3D ARYA robot

`src/components/robot/AryaRobot.tsx` composes `AryaHead`, `AryaEyes`,
`AryaBody`, `AryaArms`, and `AryaBase` — a **procedural placeholder** (white
shell, orange accents, glowing blue eyes, tapered wheeled base) built from
primitive Three.js geometry, not a flat image.

To swap in a real model later:

1. Drop `arya.glb` (or `.gltf`) into `public/models/`.
2. In `AryaRobot.tsx`, replace the composed `<AryaHead />`/`<AryaBody />`/…
   JSX with `useGLTF("/models/arya.glb")` and `<primitive object={gltf.scene} />`.
3. Every caller (Home, Live, Simulation, Talk) already passes the same
   `{ action, eyesOn, position, rotationY, scale }` props — nothing else
   changes.

Animation states (idle, move, turn, namaste, wave, look, speak) are driven
procedurally by `RobotAnimationController.ts` via `useFrame`, independent of
whether the visual is procedural geometry or a loaded model.

---

## Global state, mock services, and the future event system

- **`src/hooks/useRobotState.tsx`** — a `RobotStateProvider` holding the
  single `RobotState` object (`types/robot.ts`) consumed everywhere, plus a
  typed `AryaEventBus` (`types/events.ts`) that future services can publish
  to. `sendCommand()` still drives the client-side 3D simulation; Live
  Robotics/Talk with ARYA additionally forward commands to the backend (see
  `services/real/robotClient.ts`).
- **`src/services/mock/`** — `mockRobot` (3D telemetry simulation, still
  authoritative — no physical chassis exists yet) and a couple of small
  timestamp/log-entry formatting helpers reused by the real hook below.
  `mockVision`'s fake people/log generators and `mockConversation`'s
  `getMockResponse` are no longer wired into any page.
- **`src/services/real/`** — the live counterparts: `chatClient.ts`
  (`POST /api/chat`), `robotClient.ts` (`POST /api/robot/command`), plus
  `src/hooks/useVisionFeed.ts` (`GET /ws/vision`) for objects/people/log.
  `src/config.ts` resolves the backend's base URL from `VITE_API_BASE_URL`.
- **`src/types/events.ts`** — the `AryaEventType` union (`PERSON_DETECTED`,
  `FACE_RECOGNIZED`, `GREETING_STARTED`, `ROBOT_MOVING`, `SYSTEM_READY`, …).
  Not yet published by the backend over a transport of its own — Live
  Robotics/Talk with ARYA currently get their real data via `useVisionFeed`
  and `chatClient` directly rather than through this bus — but the shape is
  still here for a future push-based event stream to adopt.

## Backend integration

```
                    ARYA UI  (this repo)
                       |
              services/real/* + useVisionFeed
                       |
              ┌────────┴────────┐
              │   web_server.py │   FastAPI (AURA_Windows/)
              └────────┬────────┘
                       |
       +---------------+---------------+
       |               |               |
  vision_service     chat_service   MovementController /
  (YOLO + face)     (Gemini text)   GestureController
       |               |               |
 known_faces/    canned Q&A +      simulated, or real
 yolov8n.pt      Gemini fallback   GPIO if ENABLE_GPIO=true
```

The UI still never imports Gemini, YOLO, or hardware SDKs directly —
everything arrives through `services/real/*` and `useVisionFeed`, so the
backend can change its internals freely without touching this repo. See
`AURA_Windows/WEB_INTEGRATION.md` for the full endpoint contract.

---

## Project structure

```
src/
  components/
    layout/       Header, Sidebar, Footer
    robot/        AryaRobot + parts, RobotStatus, RobotAnimationController
    live/         Camera, voice, movement, vision, people, log — Live Robotics
    simulation/   3D environment, stations, path, map, status — Simulation
    conversation/ Conversation, voice input, greeting manager — Talk
    common/       Button, Panel, Modal, StatusIndicator, ExperienceCard, …
  pages/          Boot, Home, LiveRobotics, Simulation, TalkWithArya
  services/mock/  mockRobot, mockVision, mockConversation
  types/          robot.ts, vision.ts, conversation.ts, events.ts
  hooks/          useRobotState, useMockRobot, useSimulation
  styles/         tokens.css (design tokens), global.css (resets + primitives)
```

## Notes on implementation choices

- **Refs + `useFrame` for animation, not `useState`.** ARYA's pose (bob,
  tilt, raised-arm amount, look offset) is mutated on a ref inside
  `useFrame` rather than stored in React state, which is the standard React
  Three Fiber pattern — it updates the 3D scene every frame without
  triggering a React re-render 60 times a second. A generic React linter
  will flag "ref access during render," but this is intentional and
  standard for R3F.
- **Responsive**: primary target is 1920×1080 down to 1366×768; the sidebar
  collapses and grids stack to a single column under ~1150px / 900px for
  tablet and mobile.
- **Accessibility**: interactive controls use semantic `<button>`s with
  `aria-label`s where icon-only, visible focus rings (`:focus-visible`), and
  `prefers-reduced-motion` is respected globally.
