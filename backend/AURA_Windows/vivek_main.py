"""
================================================================================
 AURA (Windows build) — MAIN (run this file)
 Ties vivek_face.py (face recognition) and vivek_interaction.py (voice /
 AI interaction) together into one window:

     ┌─────────────────────────────────────┬─────────────┐
     │   80%: "Recognized People" — LIVE    │ 20%: camera │
     │   real-time table of everyone        │ feed (top)  │
     │   face-recognition has identified     ├─────────────┤
     │   this session (present/departed,    │ voice orb / │
     │   first & last seen)                 │ transcript  │
     └─────────────────────────────────────┴─────────────┘

 Run this file to start AURA. The other two files are libraries you can
 import/debug independently:
     python vivek_main.py                    # run the full robot
     python vivek_main.py --test-camera      # debug the USB camera only
     python vivek_main.py --test-gemini-voice  # speak a Gemini test line only
     python vivek_main.py --list-mics        # find your MIC_DEVICE_INDEX
     python -c "import vivek_face"           # sanity-import face module alone
     python -c "import vivek_interaction"    # sanity-import interaction module alone
================================================================================
"""

# vivek_common MUST be imported first — it sets the thread-oversubscription
# env vars (OMP_NUM_THREADS etc.) before onnxruntime/torch/cv2 get imported
# by vivek_face / vivek_interaction.
import vivek_common
from vivek_common import (
    Config, RobotState, SharedState, IS_WINDOWS,
    ROBOT_NAME, ROBOT_TAGLINE, CREDIT_ORG_LINE1,
    THANKS_LINE, COLLEGE_PROMPT, COLLEGE_LINK, WELCOME_SPEECH,
    _draw_label, _rounded_rect, _corner_brackets, _wrap_text,
)

import sys
import time
import math
import argparse
import threading
import webbrowser
from collections import deque
from typing import Optional, Tuple, Dict, List

import numpy as np
import cv2

from vivek_face import (
    FaceDatabase, TemporalVote, DetectionWorker, BoxSmoother, CameraManager,
    GestureController, test_camera, _try_import_yolo, YOLO, YOLO_AVAILABLE,
)
import vivek_face as face_mod

from vivek_interaction import (
    SpeechEngine, VoiceListener, MovementController,
    list_microphones, test_gemini_voice,
)
from aura_gemini import AuraGeminiEngine


# ══════════════════════════════════════════════════════════════════════
#  INTEGRATED APP — one window: 80% branding/welcome panel (always on),
#  20% narrow strip stacking camera-with-HUD on top of the voice
#  interaction panel below it. Identical layout/behaviour to the
#  original single-file version.
# ══════════════════════════════════════════════════════════════════════

class VivekIntegrated:
    def __init__(self):
        self.shared = SharedState()

        # AURA's ONLY brain + ONLY voice -- created first since
        # SpeechEngine below needs it. See aura_gemini.py. If this isn't
        # enabled (no GEMINI_API_KEY / package missing / USE_GEMINI_VOICE
        # false), AURA can still hear speech and drive around, but cannot
        # speak or answer anything -- _load_all() below prints a loud
        # warning about this at startup.
        self.gemini = AuraGeminiEngine(self.shared)
        self.speech = SpeechEngine(gemini=self.gemini)
        self.gesture = GestureController()
        self.movement = MovementController()
        self.face_db = FaceDatabase()
        self.temporal = TemporalVote(required=Config.REQUIRED_CONFIRM_FRAMES)
        self.person_smoother = BoxSmoother()
        self.face_smoother = BoxSmoother()

        self.person_model = None
        self.detector: Optional[DetectionWorker] = None
        self.camera = CameraManager()
        self.voice: Optional[VoiceListener] = None

        self.persons, self.faces = [], []
        self.active_person: Optional[str] = None
        self.last_seen_time = 0.0
        self._candidate_first_seen: Dict[str, float] = {}
        self._candidate_last_seen: Dict[str, float] = {}

        self._greeted_present: set = set()
        self._pending_greets: Dict[str, float] = {}
        self._was_in_conversation = False

        # ---- live "Recognized People" log (drives the 80%-wide panel) --
        # Keyed by enrolled-folder name (e.g. "vignesh"). Never deleted
        # for the lifetime of the run -- entries just flip between
        # "present" / "departed" as people arrive and leave, so the
        # panel always shows everyone recognized so far this session,
        # not just who's in frame right now. Order of insertion is kept
        # (Python dicts preserve it), and the draw code re-sorts a copy
        # for display without touching this one.
        # name -> {"first_seen": ts, "last_seen": ts, "status": "present"|
        #          "departed", "sim": float}
        self._recognition_log: Dict[str, dict] = {}
        self._recognition_lock = threading.Lock()

        self._college_btn_rect: Optional[Tuple[int, int, int, int]] = None
        self._college_btn_hover = False
        self._last_college_click = 0.0

        self.state = RobotState.IDLE
        self.running = False
        self.paused = False
        self.debug = Config.DEBUG_DEFAULT
        self._fps_times = deque(maxlen=30)
        self.win = "AURA — Face Recognition + Voice Interaction"

    # ------------------------------------------------------------------
    def _check_memory(self):
        """Warn (don't block) if free memory is low. InsightFace +
        onnxruntime + OpenCV together typically use 1.5-2.5GB, which is
        normally a non-issue on a Windows PC, but it's still worth a
        heads-up if the machine is genuinely low on RAM (e.g. a lot of
        other apps/browser tabs open)."""
        try:
            if IS_WINDOWS:
                import ctypes

                class MEMORYSTATUSEX(ctypes.Structure):
                    _fields_ = [
                        ("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                        ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                        ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                        ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                        ("sullAvailExtendedVirtual", ctypes.c_ulonglong),
                    ]
                stat = MEMORYSTATUSEX()
                stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
                ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
                avail_mb = stat.ullAvailPhys / (1024 * 1024)
            else:
                with open("/proc/meminfo") as f:
                    info = dict(
                        (parts[0].rstrip(":"), int(parts[1]))
                        for parts in (line.split() for line in f if len(line.split()) >= 2)
                    )
                avail_mb = info.get("MemAvailable", 0) / 1024
            print(f"[Init] memory check: {avail_mb:.0f}MB available")
            if avail_mb < 1200:
                print("[Init] WARNING: less than ~1.2GB free RAM available -- InsightFace, "
                      "onnxruntime, and OpenCV together typically want more headroom than "
                      "that. Consider closing other apps/browser tabs before running AURA.")
        except Exception:
            pass  # best-effort only -- never block startup over this

    def _check_gemini_voice(self):
        """AURA's only brain + only voice is Gemini now -- there is no
        other engine anymore. If it's not actually working, say so loudly and clearly at startup instead of letting the robot
        boot silently and then just never speak when someone talks to
        it."""
        if self.gemini.enabled:
            return
        print("\n" + "!" * 72)
        print("[Init] WARNING: AURA's Gemini voice module is NOT enabled.")
        print("[Init]          AURA will still see/hear speech and can still")
        print("[Init]          move/gesture, but CANNOT speak or answer any")
        print("[Init]          questions until this is fixed. Check the [Gemini]")
        print("[Init]          log line(s) above for the exact reason (missing")
        print("[Init]          GEMINI_API_KEY, 'google-genai' not installed, or")
        print("[Init]          USE_GEMINI_VOICE=false in .env).")
        print("!" * 72 + "\n")

    def _load_all(self) -> bool:
        self._check_memory()
        self._check_gemini_voice()
        print("\n[Init] loading person detector...")
        if not Config.ENABLE_PERSON_DETECTION:
            print("[Init] person detection disabled (ENABLE_PERSON_DETECTION=false) -- "
                  "skipping YOLO/torch import entirely.")
        elif _try_import_yolo():
            try:
                self.person_model = face_mod.YOLO(Config.PERSON_MODEL)
                print(f"[Init] person model ready: {Config.PERSON_MODEL}")
            except Exception as e:
                print(f"[Init] person model failed to load ({e}) -- person boxes disabled")
        else:
            print("[Init] YOLO unavailable -- person boxes disabled")

        print("[Init] loading face database...")
        self.face_db.load()

        print(f"[Init] opening USB camera (CAM_INDEX={Config.CAM_INDEX})...")
        if not self.camera.open():
            return False

        self.speech.start()
        self.detector = DetectionWorker(self.person_model, self.face_db)
        self.detector.start()

        self.voice = VoiceListener(self.speech, self.gesture, self.movement,
                                    self.shared, gemini=self.gemini, shutdown_cb=self._shutdown_request)
        self.voice.start()
        if not self.voice.enabled:
            print("[Init] WARNING: voice input disabled (no mic / SpeechRecognition). "
                  "Face recognition will still run.")
            self.shared.set_state("error", "Microphone not available")
        return True

    def _shutdown_request(self):
        print("[Voice] shutdown command received")
        self.running = False

    # ------------------------------------------------------------------
    def _in_active_conversation(self) -> bool:
        return bool(self.voice and self.voice.in_conversation)

    def _greet_arrival(self, name: str, sim: float):
        display = name.replace("_", " ").title()
        print(f"[Recognize] {display} arrived (similarity={sim:.2f}) -- greeting now")
        self.gesture.perform_namaste()
        self.speech.say(f"Namaste, {display.split()[0]}! I have recognized you.", priority=True)

    def _departed_silently(self, name: str):
        display = name.replace("_", " ").title()
        print(f"[Recognize] {display} is no longer present (silent -- no announcement)")
        if self.shared.get_user() == name:
            self.shared.set_user("")
        self._candidate_first_seen.pop(name, None)
        self._candidate_last_seen.pop(name, None)
        self.state = RobotState.PERSON_LOST

    def _touch_recognition_log(self, name: str, sim: float, now: float, status: str):
        """Create/update this person's row in the live 'Recognized People'
        log. `status` is 'present' (update last_seen to `now`) or
        'departed' (leave last_seen as whenever they were actually last
        seen -- the caller passes that same timestamp in that case)."""
        with self._recognition_lock:
            entry = self._recognition_log.get(name)
            if entry is None:
                entry = {"first_seen": now, "last_seen": now, "status": status, "sim": sim}
                self._recognition_log[name] = entry
            else:
                entry["status"] = status
                if status == "present":
                    entry["last_seen"] = now
                    entry["sim"] = sim
                else:
                    entry["last_seen"] = now  # timestamp of when they were last actually seen

    def get_recognition_log_snapshot(self) -> List[Tuple[str, dict]]:
        """Thread-safe copy for the drawing code -- most-recently-seen
        first, present people ahead of departed ones."""
        with self._recognition_lock:
            items = [(n, dict(e)) for n, e in self._recognition_log.items()]
        items.sort(key=lambda kv: (kv[1]["status"] != "present", -kv[1]["last_seen"]))
        return items

    def _process_results(self, persons, raw_faces):
        smoothed_persons = []
        for p in persons:
            key = f"p_{p['box'][0]//60}_{p['box'][1]//60}"
            smoothed_persons.append({**p, "box": self.person_smoother.update(key, p["box"])})

        faces = []
        confirmed_candidates = []
        for f in raw_faces:
            cx = (f["box"][0] + f["box"][2]) // 2
            cy = (f["box"][1] + f["box"][3]) // 2
            key = f"f_{cx//40}_{cy//40}"
            box = self.face_smoother.update(key, f["box"])
            confirmed_name, avg_sim = self.temporal.update(key, f["name"], f["similarity"])
            display_name = confirmed_name if confirmed_name else \
                ("Unknown" if f["name"] == "Unknown" else "Scanning...")
            faces.append({"box": box, "name": display_name,
                          "similarity": avg_sim if confirmed_name else f["similarity"]})
            if confirmed_name:
                confirmed_candidates.append((confirmed_name, avg_sim))

        self.persons, self.faces = smoothed_persons, faces
        now = time.time()
        seen_now = set()
        for name, _ in confirmed_candidates:
            seen_now.add(name)
            self._candidate_last_seen[name] = now
            self._candidate_first_seen.setdefault(name, now)

        for n in [n for n, t in self._candidate_last_seen.items()
                  if n != self.active_person and now - t > Config.PERSON_ABSENCE_TIMEOUT]:
            self._candidate_first_seen.pop(n, None)
            self._candidate_last_seen.pop(n, None)

        # ---- live "Recognized People" log -- updated every frame, drives
        # the panel on 80% of the screen. Independent of the greeting
        # logic below: this keeps tracking present/departed + last-seen
        # for EVERY recognized person, whether or not AURA still owes
        # them a spoken greeting.
        for name, sim in confirmed_candidates:
            self._touch_recognition_log(name, sim, now, "present")
        for name, entry in list(self._recognition_log.items()):
            if entry["status"] == "present" and name not in seen_now \
                    and now - self._candidate_last_seen.get(name, entry["last_seen"]) > Config.PERSON_ABSENCE_TIMEOUT:
                self._touch_recognition_log(name, entry["sim"], entry["last_seen"], "departed")

        # ---- GREETING (arrivals only, spoken ONCE per person per run) ---
        # Config.GREET_ONCE_PER_SESSION (default True): once AURA has
        # said "Namaste, I have recognized you" for someone, that name
        # stays in _greeted_present for the rest of this run -- it is
        # NOT cleared when they walk away, so they are never greeted out
        # loud a second time even if they come back later. The live
        # panel above still tracks their present/departed status and
        # last-seen time regardless; only the SPOKEN greeting is
        # one-time. Set GREET_ONCE_PER_SESSION=false in .env to restore
        # the old "re-greet after they've been gone a while" behavior.
        now_in_conversation = self._in_active_conversation()

        if self._was_in_conversation and not now_in_conversation:
            for name in list(self._pending_greets.keys()):
                sim = self._pending_greets.pop(name)
                if name in seen_now:
                    self._greet_arrival(name, sim)
                    self._greeted_present.add(name)
        self._was_in_conversation = now_in_conversation

        for name, sim in confirmed_candidates:
            if name in self._greeted_present or name in self._pending_greets:
                continue
            if now_in_conversation and Config.SUPPRESS_GREETING_DURING_CONVERSATION:
                self._pending_greets[name] = sim
                print(f"[Recognize] {name.replace('_', ' ').title()} arrived while a "
                      f"conversation is active -- greeting queued, will play once it ends")
            else:
                self._greet_arrival(name, sim)
                self._greeted_present.add(name)

        if not Config.GREET_ONCE_PER_SESSION:
            # Old behavior: forget the greeting once someone's been gone
            # long enough, so they get greeted again on their next visit.
            for n in [n for n in list(self._greeted_present) if n not in seen_now
                      and now - self._candidate_last_seen.get(n, 0) > Config.PERSON_ABSENCE_TIMEOUT]:
                self._greeted_present.discard(n)
        for n in [n for n in list(self._pending_greets) if n not in seen_now
                  and now - self._candidate_last_seen.get(n, 0) > Config.PERSON_ABSENCE_TIMEOUT]:
            self._pending_greets.pop(n, None)

        # ---- active_person -------------------------------------------
        recognized_this_frame = None
        if self.active_person is not None:
            active_sim = next((s for n, s in confirmed_candidates if n == self.active_person), None)
            if active_sim is not None:
                recognized_this_frame = (self.active_person, active_sim)
        elif confirmed_candidates:
            best_name = min(seen_now, key=lambda n: self._candidate_first_seen[n])
            best_sim = next(s for n, s in confirmed_candidates if n == best_name)
            recognized_this_frame = (best_name, best_sim)

        if recognized_this_frame:
            name, sim = recognized_this_frame
            self.last_seen_time = now
            if self.active_person != name:
                self.active_person = name
                self.shared.set_user(name)
            self.state = RobotState.FACE_RECOGNIZED
        elif self.active_person is not None:
            if now - self.last_seen_time > Config.PERSON_ABSENCE_TIMEOUT:
                gone = self.active_person
                self.active_person = None
                self._departed_silently(gone)
        else:
            self.state = RobotState.PERSON_DETECTED if (smoothed_persons or faces) else RobotState.SCANNING

    # ------------------------------------------------------------------
    def _on_mouse(self, event, x, y, flags, userdata):
        if self._college_btn_rect is None:
            return
        bx1, by1, bx2, by2 = self._college_btn_rect
        inside = bx1 <= x <= bx2 and by1 <= y <= by2
        self._college_btn_hover = inside
        if event == cv2.EVENT_LBUTTONDOWN and inside:
            now = time.time()
            if now - self._last_college_click < 1.0:
                return
            self._last_college_click = now
            print(f"[UI] 'Explore Our College' clicked -> opening {COLLEGE_LINK}")
            try:
                webbrowser.open(COLLEGE_LINK, new=2)
            except Exception as e:
                print(f"[UI] could not open browser: {e}")

    @staticmethod
    def _fmt_clock(ts: float) -> str:
        return time.strftime("%H:%M:%S", time.localtime(ts)) if ts else "--:--:--"

    @staticmethod
    def _fmt_ago(seconds: float) -> str:
        seconds = max(0, int(seconds))
        if seconds < 5:
            return "just now"
        if seconds < 60:
            return f"{seconds}s ago"
        minutes = seconds // 60
        if minutes < 60:
            return f"{minutes}m {seconds % 60}s ago"
        hours = minutes // 60
        return f"{hours}h {minutes % 60}m ago"

    def _draw_branding_panel(self, w, h):
        """The 80%-wide panel. Top: a compact AURA header (name, tagline,
        credits, the 'Explore Our College' button). Below that: a LIVE,
        continuously-updating table of everyone face-recognition has
        identified this session -- who's currently present, who's
        departed, and when each was first/last seen. This is the "live
        data" view -- it updates every frame straight from
        self._recognition_log, independent of whether AURA has spoken a
        greeting for that person."""
        panel = np.full((h, w, 3), Config.COL_BG, dtype=np.uint8)
        cv2.rectangle(panel, (0, 0), (w, 3), Config.COL_GOLD, -1)

        pad = 22

        # ---- compact header row: title/tagline on the left, credits +
        # the college button stacked on the right -------------------------
        header_h = 92
        cv2.putText(panel, f"{ROBOT_NAME}", (pad, 40), cv2.FONT_HERSHEY_DUPLEX,
                    1.15, Config.COL_GOLD, 2, cv2.LINE_AA)
        cv2.putText(panel, ROBOT_TAGLINE, (pad, 66), cv2.FONT_HERSHEY_DUPLEX,
                    0.5, Config.COL_TEXT, 1, cv2.LINE_AA)
        cv2.putText(panel, CREDIT_ORG_LINE1, (pad, 84), cv2.FONT_HERSHEY_DUPLEX,
                    0.36, Config.COL_CYAN, 1, cv2.LINE_AA)

        btn_w, btn_h = 210, 40
        bx2, by1 = w - pad, 16
        bx1, by2 = bx2 - btn_w, by1 + btn_h
        hover = self._college_btn_hover
        fill = (90, 210, 255) if hover else Config.COL_GOLD
        _rounded_rect(panel, (bx1, by1), (bx2, by2), 10, fill, -1)
        _rounded_rect(panel, (bx1, by1), (bx2, by2), 10, Config.COL_TEXT, 1)
        (tw, th), _ = cv2.getTextSize(COLLEGE_PROMPT, cv2.FONT_HERSHEY_DUPLEX, 0.48, 1)
        cv2.putText(panel, COLLEGE_PROMPT, (bx1 + (btn_w - tw) // 2, by1 + (btn_h + th) // 2),
                    cv2.FONT_HERSHEY_DUPLEX, 0.48, (20, 20, 20), 1, cv2.LINE_AA)
        self._college_btn_rect = (bx1, by1, bx2, by2)
        cv2.putText(panel, COLLEGE_LINK, (bx1, by2 + 16), cv2.FONT_HERSHEY_DUPLEX,
                    0.34, Config.COL_DIM, 1, cv2.LINE_AA)
        cv2.putText(panel, THANKS_LINE, (bx1, by2 + 32), cv2.FONT_HERSHEY_DUPLEX,
                    0.34, Config.COL_GOLD, 1, cv2.LINE_AA)

        cv2.line(panel, (pad, header_h), (w - pad, header_h), Config.COL_PANEL, 2, cv2.LINE_AA)

        # ---- "RECOGNIZED PEOPLE -- LIVE" section -------------------------
        log = self.get_recognition_log_snapshot()
        present_count = sum(1 for _, e in log if e["status"] == "present")

        sec_y = header_h + 34
        pulse = 0.5 + 0.5 * math.sin(time.time() * 3.2)
        dot_col = tuple(int(c) for c in (np.array(Config.COL_GREEN) * (0.5 + 0.5 * pulse)))
        cv2.circle(panel, (pad + 6, sec_y - 6), 6, dot_col, -1, cv2.LINE_AA)
        cv2.putText(panel, "RECOGNIZED PEOPLE -- LIVE", (pad + 22, sec_y), cv2.FONT_HERSHEY_DUPLEX,
                    0.62, Config.COL_TEXT, 1, cv2.LINE_AA)
        stats = f"{present_count} present now  |  {len(log)} recognized this session"
        (stw, _), _ = cv2.getTextSize(stats, cv2.FONT_HERSHEY_DUPLEX, 0.46, 1)
        cv2.putText(panel, stats, (w - pad - stw, sec_y), cv2.FONT_HERSHEY_DUPLEX,
                    0.46, Config.COL_DIM, 1, cv2.LINE_AA)

        table_top = sec_y + 20
        table_bottom = h - 16
        cv2.line(panel, (pad, table_top), (w - pad, table_top), Config.COL_PANEL, 1, cv2.LINE_AA)

        if not log:
            msg = "No one recognized yet -- scanning for faces..."
            (mw, mh), _ = cv2.getTextSize(msg, cv2.FONT_HERSHEY_DUPLEX, 0.6, 1)
            cv2.putText(panel, msg, ((w - mw) // 2, (table_top + table_bottom) // 2),
                        cv2.FONT_HERSHEY_DUPLEX, 0.6, Config.COL_DIM, 1, cv2.LINE_AA)
            return panel

        # column layout
        col_name_x = pad + 4
        col_status_x = int(w * 0.46)
        col_first_x = int(w * 0.63)
        col_last_x = int(w * 0.81)

        hy = table_top + 22
        for label, x in (("NAME", col_name_x), ("STATUS", col_status_x),
                          ("FIRST SEEN", col_first_x), ("LAST SEEN / STATUS", col_last_x)):
            cv2.putText(panel, label, (x, hy), cv2.FONT_HERSHEY_DUPLEX, 0.36, Config.COL_DIM, 1, cv2.LINE_AA)
        cv2.line(panel, (pad, hy + 8), (w - pad, hy + 8), Config.COL_PANEL, 1, cv2.LINE_AA)

        # Row height grows to fill the available space when there aren't
        # many people to show yet (so the panel doesn't look sparse with
        # just 1-2 entries), capped so it doesn't get silly with a huge
        # single row, and shrinks back down toward a compact minimum
        # once there are enough people to need it.
        available_h = max(1, table_bottom - (hy + 16))
        target_count = min(len(log), Config.RECOGNITION_LOG_MAX_ROWS) or 1
        row_h = max(40, min(56, available_h // target_count))
        rows_avail = max(1, available_h // row_h)
        max_rows = min(rows_avail, Config.RECOGNITION_LOG_MAX_ROWS, len(log))
        shown, hidden = log[:max_rows], log[max_rows:]

        # Font sizes scale gently with row height so a roomier table
        # (fewer people recognized so far) reads as intentionally
        # spacious rather than just padded with blank space.
        fscale = min(1.5, row_h / 40.0)
        name_scale, status_scale, detail_scale = 0.5 * fscale, 0.44 * fscale, 0.42 * fscale
        dot_r = int(round(5 * min(1.3, fscale)))
        text_dy = int(round(14 * min(1.25, fscale)))

        ry = hy + 16
        now = time.time()
        for i, (name, entry) in enumerate(shown):
            if i % 2 == 1:
                cv2.rectangle(panel, (pad, ry - 2), (w - pad, ry + row_h - 10),
                              (int(Config.COL_PANEL[0] * 0.5), int(Config.COL_PANEL[1] * 0.5),
                               int(Config.COL_PANEL[2] * 0.5)), -1)
            display = name.replace("_", " ").title()
            present = entry["status"] == "present"
            status_col = Config.COL_GREEN if present else Config.COL_DIM
            dot_y = ry + text_dy - 6
            cv2.circle(panel, (col_name_x + 4, dot_y), dot_r, status_col, -1, cv2.LINE_AA)
            cv2.putText(panel, display, (col_name_x + 18, ry + text_dy), cv2.FONT_HERSHEY_DUPLEX,
                        name_scale, Config.COL_TEXT, 1, cv2.LINE_AA)

            status_text = "PRESENT" if present else "DEPARTED"
            cv2.putText(panel, status_text, (col_status_x, ry + text_dy), cv2.FONT_HERSHEY_DUPLEX,
                        status_scale, status_col, 1, cv2.LINE_AA)

            cv2.putText(panel, self._fmt_clock(entry["first_seen"]), (col_first_x, ry + text_dy),
                        cv2.FONT_HERSHEY_DUPLEX, detail_scale, Config.COL_TEXT, 1, cv2.LINE_AA)

            last_text = "now" if present else self._fmt_ago(now - entry["last_seen"])
            last_col = Config.COL_CYAN if present else Config.COL_DIM
            cv2.putText(panel, f"{self._fmt_clock(entry['last_seen'])}  ({last_text})",
                        (col_last_x, ry + text_dy), cv2.FONT_HERSHEY_DUPLEX, detail_scale, last_col, 1, cv2.LINE_AA)
            ry += row_h

        if hidden:
            more_msg = f"+ {len(hidden)} more recognized earlier this session"
            cv2.putText(panel, more_msg, (col_name_x + 18, min(ry + 10, table_bottom)),
                        cv2.FONT_HERSHEY_DUPLEX, 0.4, Config.COL_DIM, 1, cv2.LINE_AA)
        elif ry < table_bottom - 50:
            # Room left below the table -- rather than stretch rows out
            # to fill it (which looks odd with small text floating in
            # big blank rows), show a quiet "still watching" indicator
            # in the leftover space so the panel reads as live/active
            # rather than just empty.
            cv2.line(panel, (pad, ry + 6), (w - pad, ry + 6), Config.COL_PANEL, 1, cv2.LINE_AA)
            scan_pulse = 0.5 + 0.5 * math.sin(time.time() * 2.4)
            scan_col = tuple(int(c) for c in (np.array(Config.COL_DIM) * (0.6 + 0.4 * scan_pulse)))
            msg = "Scanning for more faces..."
            (mw, _), _ = cv2.getTextSize(msg, cv2.FONT_HERSHEY_DUPLEX, 0.42, 1)
            cv2.circle(panel, (w // 2 - mw // 2 - 14, ry + 32), 4, scan_col, -1, cv2.LINE_AA)
            cv2.putText(panel, msg, (w // 2 - mw // 2, ry + 38),
                        cv2.FONT_HERSHEY_DUPLEX, 0.42, scan_col, 1, cv2.LINE_AA)

        return panel

    def _draw_face_panel(self, frame, w, h):
        t = time.time()
        self._fps_times.append(t)
        fps = 0.0
        if len(self._fps_times) > 1:
            span = self._fps_times[-1] - self._fps_times[0]
            fps = (len(self._fps_times) - 1) / span if span > 0 else 0.0

        if frame.shape[1] != w or frame.shape[0] != h:
            frame = cv2.resize(frame, (w, h))
        sx = w / float(Config.CAM_W)
        sy = h / float(Config.CAM_H)

        state_col = Config.STATE_COLORS.get(self.state.value, Config.COL_CYAN)
        cv2.rectangle(frame, (0, 0), (w - 1, h - 1), state_col, 2, cv2.LINE_AA)

        for p in self.persons:
            x1, y1, x2, y2 = [int(p["box"][0]*sx), int(p["box"][1]*sy), int(p["box"][2]*sx), int(p["box"][3]*sy)]
            _corner_brackets(frame, x1, y1, x2, y2, Config.COL_CYAN)

        for f in self.faces:
            x1, y1, x2, y2 = [int(f["box"][0]*sx), int(f["box"][1]*sy), int(f["box"][2]*sx), int(f["box"][3]*sy)]
            name = f["name"]
            if name not in ("Unknown", "Scanning..."):
                col = Config.COL_GREEN
                label = f"{name.replace('_', ' ').title()}"
            elif name == "Scanning...":
                col = Config.COL_CYAN
                label = "ID.."
            else:
                col = Config.COL_RED
                label = "UNKNOWN"
            _corner_brackets(frame, x1, y1, x2, y2, col, thickness=1)
            _draw_label(frame, label, (x1, max(y1 - 6, 14)), col, scale=0.4, thickness=1)

        cv2.rectangle(frame, (0, 0), (w, 22), Config.COL_PANEL, -1)
        cv2.putText(frame, "FACE RECOGNITION", (6, 16), cv2.FONT_HERSHEY_DUPLEX, 0.38, Config.COL_CYAN, 1, cv2.LINE_AA)

        bar_h = 18
        cv2.rectangle(frame, (0, h - bar_h), (w, h), Config.COL_PANEL, -1)
        cv2.putText(frame, f"{len(self.faces)}f {fps:.0f}fps",
                    (6, h - 5), cv2.FONT_HERSHEY_DUPLEX, 0.34, Config.COL_TEXT, 1, cv2.LINE_AA)
        if self.paused:
            cv2.putText(frame, "PAUSED", (w - 60, h - 5), cv2.FONT_HERSHEY_DUPLEX, 0.34, Config.COL_RED, 1, cv2.LINE_AA)

        if self.debug:
            dbg = [f"Active: {self.active_person}",
                   f"InConv: {self._in_active_conversation()}",
                   f"Greeted: {sorted(self._greeted_present)}",
                   f"Pending: {list(self._pending_greets.keys())}"]
            for i, line in enumerate(dbg):
                cv2.putText(frame, line, (6, 38 + i * 16), cv2.FONT_HERSHEY_PLAIN, 0.9,
                            Config.COL_GREEN, 1, cv2.LINE_AA)
        return frame

    def _draw_interaction_panel(self, w, h):
        panel = np.full((h, w, 3), Config.COL_BG, dtype=np.uint8)
        t = time.time()
        ui_state, subtext = self.shared.get_state()
        col = Config.UI_STATE_COLORS.get(ui_state, Config.COL_DIM)

        cv2.rectangle(panel, (0, 0), (w, 22), Config.COL_PANEL, -1)
        cv2.putText(panel, "VOICE INTERACTION", (6, 16), cv2.FONT_HERSHEY_DUPLEX, 0.38, Config.COL_PURPLE, 1, cv2.LINE_AA)
        user = self.shared.get_user()
        if user and user != "Unknown":
            label = user.split("_")[0].title()
            (tw, _), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_DUPLEX, 0.35, 1)
            cv2.putText(panel, label, (w - tw - 6, 16), cv2.FONT_HERSHEY_DUPLEX, 0.35, Config.COL_GREEN, 1, cv2.LINE_AA)

        cx, cy = w // 2, 62
        speed = {"idle": 0.4, "listening": 1.0, "thinking": 1.4, "speaking": 1.2, "error": 0.6}[ui_state]
        base_r = 22
        amp = 4 if ui_state == "idle" else 7
        r = int(base_r + amp * (0.5 + 0.5 * math.sin(t * speed * 3)))
        cv2.circle(panel, (cx, cy), r + 8, col, 2, cv2.LINE_AA)
        cv2.circle(panel, (cx, cy), r, col, -1, cv2.LINE_AA)

        label = subtext or Config.UI_STATE_LABELS.get(ui_state, "")
        (tw, _), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_DUPLEX, 0.38, 1)
        cv2.putText(panel, label, (max(cx - tw // 2, 4), cy + r + 22), cv2.FONT_HERSHEY_DUPLEX, 0.38, col, 1, cv2.LINE_AA)

        cv2.putText(panel, 'Just ask -- no wake word needed', (6, cy + r + 42),
                    cv2.FONT_HERSHEY_DUPLEX, 0.32, Config.COL_DIM, 1, cv2.LINE_AA)

        y = cy + r + 66
        cv2.line(panel, (6, y - 12), (w - 6, y - 12), Config.COL_PANEL, 1, cv2.LINE_AA)
        cv2.putText(panel, "CONVERSATION", (6, y), cv2.FONT_HERSHEY_DUPLEX, 0.32, Config.COL_DIM, 1, cv2.LINE_AA)
        y += 18
        max_chars = max(14, (w - 16) // 7)
        for role, text in self.shared.get_transcript():
            who = "You:" if role == "user" else "AURA:"
            who_col = Config.COL_CYAN if role == "user" else Config.COL_GREEN
            cv2.putText(panel, who, (6, y), cv2.FONT_HERSHEY_DUPLEX, 0.32, who_col, 1, cv2.LINE_AA)
            y += 14
            for line in _wrap_text(text, max_chars):
                if y > h - 8:
                    break
                cv2.putText(panel, line, (12, y), cv2.FONT_HERSHEY_PLAIN, 0.85, Config.COL_TEXT, 1, cv2.LINE_AA)
                y += 13
            y += 4
            if y > h - 8:
                break

        if not (self.voice and self.voice.enabled):
            cv2.putText(panel, "(mic unavailable)", (6, h - 6),
                        cv2.FONT_HERSHEY_DUPLEX, 0.3, Config.COL_RED, 1, cv2.LINE_AA)
        return panel

    # ------------------------------------------------------------------
    def run(self):
        print("=" * 60)
        print("  AURA -- INTEGRATED (face recognition + voice interaction)")
        print("=" * 60)
        if not self._load_all():
            print("[Init] FATAL -- could not start (camera unavailable). Exiting.")
            return

        # --------------------------------------------------------------
        # NOTE: startup used to auto-speak a "system ready" line AND the
        # full WELCOME_SPEECH introduction here. That's why the robot
        # announced itself the moment it launched, before anyone asked.
        # Startup is now SILENT -- AURA only introduces itself when a
        # user actually says "introduce yourself" (handled in
        # vivek_interaction.py via Config.INTRODUCTION_PHRASES). No wake
        # word needed for that or anything else anymore -- see the
        # "wake word removed" note in vivek_interaction.py.
        # --------------------------------------------------------------
        print("[Init] AURA ready (silent boot -- just start talking, no wake word needed).")

        print('\nCONTROLS: Q quit | P pause face-rec | D debug   |   no wake word needed -- just ask')
        print('          click "Explore Our College" to open the college website\n')

        headless = False
        try:
            cv2.namedWindow(self.win, cv2.WINDOW_NORMAL)
            cv2.setMouseCallback(self.win, self._on_mouse)
        except cv2.error as e:
            print(f"[Main] no display available ({e}) -- running headless")
            headless = True

        self.running = True
        self.state = RobotState.SCANNING
        frame_n = 0
        last_submit = 0.0

        win_w, win_h = Config.WINDOW_W, Config.WINDOW_H
        branding_w = int(win_w * Config.BRANDING_SPLIT)
        side_w = win_w - branding_w
        cam_h = win_h // 2
        interact_h = win_h - cam_h

        try:
            if not headless:
                branding = self._draw_branding_panel(branding_w, win_h)
                side = np.full((win_h, side_w, 3), Config.COL_BG, dtype=np.uint8)
                cv2.imshow(self.win, np.hstack([branding, side]))
                cv2.waitKey(1)
            # (no speech here -- boot is silent, see note above)

            while self.running:
                ret, frame = self.camera.cap.read()
                if not ret:
                    time.sleep(0.01)
                    continue
                frame_n += 1

                if not self.paused:
                    now = time.time()
                    if now - last_submit >= Config.INFERENCE_INTERVAL:
                        self.detector.submit(frame)
                        last_submit = now
                    persons, raw_faces = self.detector.get_result()
                    self._process_results(persons, raw_faces)
                    if frame_n % 150 == 0:
                        self.person_smoother.cleanup()
                        self.face_smoother.cleanup()

                key = 0xFF
                if not headless:
                    branding = self._draw_branding_panel(branding_w, win_h)
                    cam_panel = self._draw_face_panel(frame.copy(), side_w, cam_h)
                    interact_panel = self._draw_interaction_panel(side_w, interact_h)
                    side = np.vstack([cam_panel, interact_panel])
                    combined = np.hstack([branding, side])
                    try:
                        cv2.imshow(self.win, combined)
                    except cv2.error as e:
                        print(f"[Main] display lost, switching to headless ({e})")
                        headless = True
                    key = cv2.waitKey(1) & 0xFF
                else:
                    time.sleep(0.01)

                if key in (ord('q'), ord('Q'), 27):
                    break
                elif key in (ord('p'), ord('P')):
                    self.paused = not self.paused
                elif key in (ord('d'), ord('D')):
                    self.debug = not self.debug
        except KeyboardInterrupt:
            print("\n[Main] interrupted by user")
        finally:
            self._shutdown()

    def _shutdown(self):
        print("\n[Shutdown] stopping...")
        self.running = False
        if self.voice:
            self.voice.stop()
        if self.detector:
            self.detector.stop()
        if self.camera.cap:
            self.camera.cap.release()
        cv2.destroyAllWindows()
        self.gesture.cleanup()
        self.movement.cleanup()
        from vivek_common import GPIO_AVAILABLE
        if Config.ENABLE_GPIO and GPIO_AVAILABLE and (self.gesture.hw_ready or self.movement.hw_ready):
            try:
                import Jetson.GPIO as GPIO
                GPIO.cleanup()
            except Exception as e:
                print(f"[Shutdown] GPIO cleanup error: {e}")
        # Speak the goodbye line BEFORE closing the Gemini engine -- it's
        # the only voice AURA has now, so closing it first would silently
        # swallow this line.
        self.speech.say_blocking("Shutting down now.")
        self.speech.stop()
        if self.gemini:
            self.gemini.close()
        print("[Shutdown] complete.\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AURA (Windows) -- face recognition + voice interaction")
    parser.add_argument("--list-mics", action="store_true", help="List microphone devices and exit")
    parser.add_argument("--test-gemini-voice", action="store_true",
                         help="Speak one English test line through Gemini, then exit")
    parser.add_argument("--test-gemini-kannada", action="store_true",
                         help="Speak one Kannada test line through Gemini, then exit")
    parser.add_argument("--test-camera", action="store_true", help="Try to open the USB camera only, then exit")
    args = parser.parse_args()

    if args.list_mics:
        list_microphones()
        sys.exit(0)
    if args.test_gemini_voice:
        test_gemini_voice("en")
        sys.exit(0)
    if args.test_gemini_kannada:
        test_gemini_voice("kn")
        sys.exit(0)
    if args.test_camera:
        test_camera()
        sys.exit(0)

    VivekIntegrated().run()