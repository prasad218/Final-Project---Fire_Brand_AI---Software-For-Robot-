# AURA — Windows build

This is the Jetson/Linux AURA project, ported to run on a plain Windows
PC with a USB webcam. If you're looking for what changed and why, read
"What changed from the Jetson build" below. If you just want to get it
running, jump to "Setup, step by step".

---

## What changed from the Jetson build

### 1. Camera: CSI ribbon camera → USB webcam only
The Jetson build could open either a CSI ribbon-cable sensor (via a
GStreamer/`nvarguscamerasrc` pipeline, Jetson-only hardware) or a USB
webcam, auto-detecting which one to use. A Windows PC has no CSI
header and no `nvargus-daemon`, so **all of that CSI/GStreamer code has
been deleted**, not just left unused — `vivek_face.py`'s `CameraManager`
now only ever opens a USB/UVC webcam through OpenCV, using the
DirectShow backend first (fastest/most reliable for USB cams on
Windows), then Media Foundation, then the platform default, trying a
few camera indices automatically along the way.

If AURA can't find your camera, run:
```
python vivek_main.py --test-camera
```
and check `CAM_INDEX` in `.env` against what Windows' Camera app shows,
and that no other app (Zoom/Teams/OBS) currently has the camera open.

### 2. Voice output: `aplay` (Linux-only) → `sounddevice` (cross-platform)
This was the critical blocker. The Jetson build piped Gemini's spoken
audio into `aplay`, a Linux command-line ALSA tool that **does not
exist on Windows** — running the original code as-is on Windows would
have made AURA completely silent (or crash) every time it tried to
speak.

Fixed by replacing `_AplayStream` with `_AudioPlayer` in
`aura_gemini.py`, built on the `sounddevice` package (PortAudio
underneath — works the same way on Windows/macOS/Linux). It also keeps
**one persistent output stream open for AURA's whole run**, instead of
spawning a brand new process for every single line — this removes a
real chunk of startup latency before AURA's first word each time it
speaks, which is the main reason the voice should feel noticeably
snappier now, on top of just working at all on Windows.

### 3. "Who's been recognized" is now a live on-screen panel, not just a voice line
The big 80%-wide panel (`Config.BRANDING_SPLIT`, unchanged at 0.8) used
to show static branding text. It's now a **live-updating table** of
everyone face recognition has identified this session: name, whether
they're currently PRESENT or have DEPARTED, when they were first seen,
and when they were last seen — refreshed every frame straight from the
detection pipeline. Nobody is ever removed from this list once
recognized; their status/timestamps just keep updating.

### 4. AURA only speaks the "I recognize you" greeting once per person
Previously, AURA would re-greet the same person out loud every time
they walked away and came back into frame (after
`PERSON_ABSENCE_TIMEOUT` seconds of not being seen). Now, once AURA
has spoken that greeting for someone, it won't say it again for the
rest of the run (`GREET_ONCE_PER_SESSION=true` in `.env`, on by
default) — the live panel above keeps tracking them regardless, silently.
Set `GREET_ONCE_PER_SESSION=false` to restore the old repeat-greeting
behavior.

### 5. Jetson-only bits left in place, harmlessly
`Jetson.GPIO` (servo/motor control) is still imported *conditionally* —
it's already gated behind `Config.ENABLE_GPIO` (default `false`) and a
Linux check, so on Windows it's always skipped and movement/gestures
are simulated (logged to the console, no hardware driven). There was
nothing to change here for Windows; just don't turn `ENABLE_GPIO` on
unless this is actually wired to real robot hardware over GPIO, which a
Windows PC doesn't have.

---

## Setup, step by step

### 1. Install Python
Get Python 3.10 or 3.11 from https://python.org (3.12+ may not yet have
prebuilt wheels for every package below — 3.10/3.11 is the safe
choice). During install, tick **"Add python.exe to PATH"**.

### 2. Open a terminal in this folder
File Explorer → this folder → type `cmd` in the address bar and press
Enter (or right-click → "Open in Terminal").

### 3. Create and activate a virtual environment (recommended)
```
python -m venv .venv
.venv\Scripts\activate
```
You should see `(.venv)` at the start of your prompt. `run_aura.bat`
will auto-activate this for you on future launches if it exists.

### 4. Install dependencies
```
pip install -r requirements.txt
```

**If `PyAudio` fails to install** (a common Windows issue — it needs a
C compiler to build from source, which most Windows machines don't
have set up):
```
pip install pipwin
pipwin install pyaudio
```
If that also fails, download a prebuilt wheel matching your Python
version from https://www.lfd.uci.edu/~gohlke/pythonlibs/#pyaudio and:
```
pip install path\to\the-file-you-downloaded.whl
```

### 5. Get a Gemini API key
AURA's only brain and only voice is Gemini — without a key, it can see
and hear, but can't speak or answer anything.
1. Go to https://aistudio.google.com/apikey and create a key.
2. Open `.env` in this folder and paste it in:
   ```
   GEMINI_API_KEY=your-key-here
   ```
Never commit this file or share it with the key filled in.

### 6. Plug in your USB webcam
Check it shows up in Windows' Camera app first, and make sure Windows'
camera privacy setting allows desktop apps to use it: **Settings →
Privacy & security → Camera → "Let desktop apps access your camera"**
must be ON.

### 7. Enroll faces (optional — some are already included)
`known_faces/<PersonName>/photo1.jpg, photo2.jpg, ...` — a few clear
photos per person, different angles/lighting if possible. This project
already ships with several people enrolled under `known_faces/`; add or
remove folders as needed.

### 8. Run it
```
run_aura.bat
```
or directly:
```
python vivek_main.py
```

### Useful command-line checks
```
python vivek_main.py --test-camera          REM camera only, no AI/voice loaded
python vivek_main.py --list-mics            REM find your MIC_DEVICE_INDEX
python vivek_main.py --test-gemini-voice    REM speak one English test line
python vivek_main.py --test-gemini-kannada  REM speak one Kannada test line
```

### On-screen controls
`Q` quit · `P` pause face recognition · `D` toggle debug overlay ·
click "Explore Our College" to open the college website.

---

## Running the web backend instead (React frontend)

Everything above is the original desktop kiosk app (`vivek_main.py`) —
one PC, one cv2 window, local mic/speakers. If you're serving the
**React frontend** (`arya-robot-control`) instead, after steps 1-7
above, run:
```
python web_server.py
```
(or double-click `run_web_server.bat`) instead of `vivek_main.py` /
`run_aura.bat`, then start the frontend separately (`npm run dev` in
`arya-robot-control/`). See **`WEB_INTEGRATION.md`** for the full
picture — endpoint contract, why it's a text Gemini model instead of
the Live audio one, and why the camera never shows a local window in
this mode. Run one or the other, not both at once — they'd otherwise
compete for the same camera.

---

## Optional: GPU acceleration for face recognition (faster, not required)
By default this build runs InsightFace on CPU (`INSIGHTFACE_CTX_ID=-1`
in `.env`), which is perfectly usable. If you have an NVIDIA GPU and
want it faster:
```
pip uninstall onnxruntime
pip install onnxruntime-gpu
```
then set `INSIGHTFACE_CTX_ID=0` in `.env`. You'll also need a matching
CUDA/cuDNN install for your onnxruntime-gpu version — see
https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html.
If anything about that mismatches, AURA will print a warning and fall
back to CPU on its own rather than crash.

## Troubleshooting
- **No sound at all**: check Windows' default *output* device (Settings
  → System → Sound) is the one you expect, and that `sounddevice`
  installed correctly (`pip show sounddevice`).
- **AURA never answers**: check `GEMINI_API_KEY` is set in `.env` and
  look for a `[Gemini]` warning line in the console at startup.
- **Camera opens but the window is black/frozen**: try a different
  `CAM_INDEX` in `.env`, and close any other app that might be holding
  the camera.
- **Voice commands aren't recognized**: `SpeechRecognition`'s
  `recognize_google()` needs an internet connection (it's a free,
  keyless web endpoint, not an offline model).
