"""
================================================================================
 AURA WEB — VISION SERVICE
 Headless camera + detection pipeline that backs the FastAPI web backend
 (web_server.py) and, through it, the React frontend's Live Robotics page.

 "Hidden camera" note (read this first)
 ----------------------------------------------------------------------
 This module NEVER calls cv2.imshow(). The camera opens and keeps
 running continuously in a background thread the moment the web server
 starts (see start(), called from web_server.py's startup event) --
 there is no local preview window at all on the machine running this
 backend. The ONLY way to see the feed is the annotated MJPEG stream
 this module hands to web_server.py's GET /api/vision/mjpeg, which the
 React frontend's <LiveCamera> renders in the browser. That's the
 "camera should be hidden ... but running" behaviour that was asked
 for: no native window popping up and giving away that a detection
 pass is happening, but the pipeline is live the whole time the server
 is up, not just while someone's looking at the Live Robotics page.

 One model, two jobs
 ----------------------------------------------------------------------
 Config.PERSON_MODEL (yolov8n.pt, already bundled in this project) is a
 stock COCO-pretrained YOLOv8 checkpoint -- 80 general object classes,
 "person" being class 0. Rather than loading a second network for
 general "Objects Detected" panel output, ONE predict() call per
 detection cycle with NO class filter serves both jobs:
   - class 0 boxes -> person detection (fed to face recognition below)
   - every other class -> the "Objects Detected" panel (counts by label)
 This is what "add a pre-built model for object detection" +
 "use our YOLO model for person detection" collapse into in practice:
 they're the same already-pretrained model, just read two different
 ways.

 Face recognition (who's who)
 ----------------------------------------------------------------------
 Every person box is checked against InsightFace face matches (see
 vivek_face.FaceDatabase, unchanged from the desktop app -- same
 known_faces/ folder, same embeddings, same MATCH_THRESHOLD). Each
 recognized/unknown person is tracked in a small in-memory registry
 shaped exactly like the frontend's RecognizedPerson type
 (DETECTED -> RECOGNIZED -> GREETED -> PRESENT -> LEFT), using the same
 PERSON_ABSENCE_TIMEOUT / GREET_ONCE_PER_SESSION knobs the desktop
 app's on-screen panel already used -- just emitted as JSON instead of
 drawn as a cv2 table.
================================================================================
"""

import time
import threading
from collections import deque
from typing import Dict, List, Optional

import cv2
import numpy as np

from vivek_common import Config, _draw_label, _corner_brackets
from vivek_face import (
    FaceDatabase, CameraManager, BoxSmoother, GestureController,
    _try_import_yolo, _looks_like_gpu_oom, _print_gpu_oom_tip_once,
)
import vivek_face as face_mod


def _now_ms() -> int:
    return int(time.time() * 1000)


# ----------------------------------------------------------------------
# Distance/position estimate for the frontend's live "digital twin"
# markers -- there's no depth sensor or stereo camera in this project,
# so this is a single-camera monocular estimate, not a measurement:
# assume an average adult standing height, compare it to how tall the
# YOLO person box is on screen (closer -> taller box), and back out an
# approximate distance with the pinhole-camera relation
# distance = (real_height * focal_px) / box_height_px. ASSUMED_FOCAL_PX
# is a rough constant tuned for a typical laptop/USB webcam's field of
# view, not calibrated per-device, so treat this as "roughly how far",
# not a precise reading -- the frontend labels it as such.
# ----------------------------------------------------------------------
ASSUMED_PERSON_HEIGHT_M = 1.65
ASSUMED_FOCAL_PX = 700.0

# Fallback used when NO YOLO "person" body box exists this frame -- common
# in a tight close-up crop (e.g. a laptop webcam where the face fills the
# frame and no shoulders/torso are visible for YOLO to call "person" at
# all). Without this, a clearly-recognized face sitting right in front of
# the camera would show no distance and no digital-twin marker just
# because the body detector didn't also fire. Uses the face box's own
# height with a face-sized real-world constant instead of a person-sized
# one, so a face-filling frame correctly reads as "very close" rather
# than being silently dropped.
ASSUMED_FACE_HEIGHT_M = 0.22  # hairline-to-chin, average adult
ASSUMED_FACE_FOCAL_PX = 650.0


def _estimate_distance_m(box_height_px: float) -> Optional[float]:
    if box_height_px <= 1:
        return None
    meters = (ASSUMED_PERSON_HEIGHT_M * ASSUMED_FOCAL_PX) / box_height_px
    return round(max(0.3, min(meters, 15.0)), 1)


def _estimate_distance_from_face_m(box_height_px: float) -> Optional[float]:
    if box_height_px <= 1:
        return None
    meters = (ASSUMED_FACE_HEIGHT_M * ASSUMED_FACE_FOCAL_PX) / box_height_px
    return round(max(0.2, min(meters, 15.0)), 1)


def _normalized_bbox(box: List[int], frame_shape) -> dict:
    """Pixel xyxy -> normalized {x, y, w, h} (0..1, top-left origin) so
    the frontend can place a marker without knowing the camera's actual
    resolution."""
    h, w = frame_shape[0], frame_shape[1]
    x1, y1, x2, y2 = box
    return {
        "x": round(max(0.0, min(1.0, x1 / w)), 3),
        "y": round(max(0.0, min(1.0, y1 / h)), 3),
        "w": round(max(0.0, min(1.0, (x2 - x1) / w)), 3),
        "h": round(max(0.0, min(1.0, (y2 - y1) / h)), 3),
    }


class VisionService:
    """Owns the camera, the models, and the latest annotated frame +
    structured detections. Thread-safe: _init_and_run()/_loop() run on
    one background thread; every getter below is safe to call from
    FastAPI's asyncio event loop / request handlers concurrently."""

    def __init__(self, gesture: Optional[GestureController] = None):
        # Heavy objects (FaceDatabase, the YOLO model, the open camera)
        # are deliberately NOT created here -- FaceDatabase's constructor
        # alone loads InsightFace's ONNX models, which can take real
        # seconds, and .load() below re-embeds every known_faces/<name>/
        # photo on top of that. Doing that in __init__ would block
        # `python web_server.py` / `import web_server` itself before
        # uvicorn even starts listening. All of it happens inside
        # _init_and_run(), on the background thread start() spins up, so
        # the HTTP server comes up immediately and GET /api/health can
        # report "still loading" in the meantime.
        self.gesture = gesture or GestureController()
        self.face_db: Optional[FaceDatabase] = None
        self.person_model = None
        self.camera = CameraManager()

        self.person_smoother = BoxSmoother(alpha=Config.BOX_SMOOTH_ALPHA)
        self.face_smoother = BoxSmoother(alpha=Config.BOX_SMOOTH_ALPHA)

        # threading.RLock (not Lock) on purpose: _update_registry() holds
        # this while iterating self._people AND calls log_event(), which
        # also takes this lock to append to self._log -- a plain Lock
        # would deadlock on that reentrant acquisition.
        self._lock = threading.RLock()
        self._frame_lock = threading.Lock()
        self._latest_jpeg: Optional[bytes] = None

        self._objects: List[dict] = []
        self._people: Dict[str, dict] = {}
        self._log: deque = deque(maxlen=200)
        self._log_seq = 0

        self._unknown_active = False
        self._unknown_counter = 0
        self._greeted_this_session: set = set()

        # Holds the display name of whoever was JUST greeted, for a short
        # window, so the frontend's WebSocket snapshot can react to it
        # (Namaste animation + spoken "Namaste, <name>!" in the browser --
        # see TalkWithArya.tsx / LiveRobotics.tsx). This was previously
        # tracked nowhere: _update_registry() below triggered the
        # server-side gesture.perform_namaste() and a log line, but never
        # put anything in snapshot() for the browser to see, so the
        # frontend's greeting reaction never actually fired even though
        # the backend WAS greeting people. _greeting_until is a wall-clock
        # deadline (not a counter) so it naturally expires on its own --
        # no separate "consumed" flag needed, and a slow/late WS push
        # still has a few seconds to catch it.
        self._greeting_active: Optional[str] = None
        self._greeting_until: float = 0.0

        self.ready = False
        self.error: Optional[str] = None
        # starting -> loading_faces -> loading_yolo -> opening_camera -> running (or error)
        self.status = "starting"
        self._running = False
        self._thread: Optional[threading.Thread] = None

    # ------------------------------------------------------------------
    # lifecycle
    # ------------------------------------------------------------------
    def start(self):
        if self._thread is not None:
            return
        self._running = True
        self._thread = threading.Thread(target=self._init_and_run, daemon=True, name="vision-service")
        self._thread.start()

    def stop(self):
        self._running = False
        try:
            if self.camera.cap is not None:
                self.camera.cap.release()
        except Exception:
            pass

    def log_event(self, message: str) -> dict:
        self._log_seq += 1
        entry = {
            "id": f"log-{_now_ms()}-{self._log_seq}",
            "timestamp": time.strftime("%H:%M:%S"),
            "message": message,
        }
        with self._lock:
            self._log.append(entry)
        print(f"[Vision] {message}")
        return entry

    def _init_and_run(self):
        try:
            self.status = "loading_faces"
            print("[Vision] loading known faces (InsightFace) -- this can take a while "
                  "the first time / with a large known_faces/ folder...")
            self.face_db = FaceDatabase()
            self.face_db.load()
            self.log_event(
                f"Face database ready — {len(self.face_db.names)} known people enrolled"
                if self.face_db.loaded else
                "Face database has no usable enrolled photos — everyone will show as Unknown")

            self.status = "loading_yolo"
            if _try_import_yolo():
                try:
                    self.person_model = face_mod.YOLO(Config.PERSON_MODEL)
                    print(f"[Vision] object/person model ready: {Config.PERSON_MODEL}")
                    self.log_event(f"Vision model loaded ({Config.PERSON_MODEL})")
                except Exception as e:
                    print(f"[Vision] failed to load {Config.PERSON_MODEL}: {e}")
                    self.log_event("Object/person detection unavailable — model failed to load")
            else:
                self.log_event("Object/person detection unavailable — run `pip install ultralytics`")

            self.status = "opening_camera"
            print(f"[Vision] opening camera (CAM_INDEX={Config.CAM_INDEX})...")
            if not self.camera.open():
                self.status = "error"
                self.error = "Could not open any camera"
                self.log_event("Camera unavailable — see the backend console for diagnostics")
                return

            self.log_event("Camera online — vision pipeline running")
            self.status = "running"
            self.ready = True
            self._loop()
        except Exception as e:
            self.status = "error"
            self.error = str(e)
            print(f"[Vision] fatal error: {e}")

    # ------------------------------------------------------------------
    # main loop
    # ------------------------------------------------------------------
    def _loop(self):
        frame_interval = 1.0 / max(1.0, Config.STREAM_FPS)
        infer_interval = max(0.05, Config.INFERENCE_INTERVAL)
        last_infer = 0.0
        last_stream = 0.0
        cycle = 0
        cached_persons: List[dict] = []
        cached_objects_raw: List[dict] = []
        cached_faces: List[dict] = []

        while self._running:
            ok, frame = self.camera.cap.read()
            if not ok or frame is None:
                time.sleep(0.02)
                continue

            now = time.time()
            if now - last_infer >= infer_interval:
                last_infer = now
                cycle += 1
                cached_persons, cached_objects_raw = self._detect(frame)
                if cycle % max(1, Config.FACE_EVERY_N) == 0:
                    cached_faces = self._match_faces(frame)
                self._update_registry(cached_persons, cached_faces, frame.shape)
                self._update_objects(cached_objects_raw, frame.shape)

            annotated = self._annotate(frame, cached_persons, cached_faces)

            if now - last_stream >= frame_interval:
                last_stream = now
                ok2, buf = cv2.imencode(
                    ".jpg", annotated, [int(cv2.IMWRITE_JPEG_QUALITY), Config.JPEG_QUALITY])
                if ok2:
                    with self._frame_lock:
                        self._latest_jpeg = buf.tobytes()

            self._sweep_absent()
            time.sleep(0.01)

    # ------------------------------------------------------------------
    # detection
    # ------------------------------------------------------------------
    def _detect(self, frame) -> (List[dict], List[dict]):
        """One YOLO pass, no class filter. Returns (persons, objects_raw)."""
        persons: List[dict] = []
        objects_raw: List[dict] = []
        if self.person_model is None:
            return persons, objects_raw
        try:
            results = self.person_model.predict(frame, conf=Config.PERSON_CONF, verbose=False)
        except Exception as e:
            if _looks_like_gpu_oom(str(e)):
                _print_gpu_oom_tip_once()
            return persons, objects_raw

        names = getattr(self.person_model, "names", {}) or {}
        for r in results:
            if r.boxes is None:
                continue
            for box in r.boxes:
                cls_id = int(box.cls[0])
                xyxy = [int(v) for v in box.xyxy[0]]
                conf = round(float(box.conf[0]), 3)
                label = names.get(cls_id, str(cls_id)) if isinstance(names, dict) else str(cls_id)
                if cls_id == 0:
                    persons.append({"box": xyxy, "conf": conf})
                else:
                    objects_raw.append({"box": xyxy, "label": label, "conf": conf})
        return persons, objects_raw

    def _match_faces(self, frame) -> List[dict]:
        if self.face_db is None:
            return []
        try:
            return self.face_db.match_frame(frame)
        except Exception as e:
            if _looks_like_gpu_oom(str(e)):
                _print_gpu_oom_tip_once()
            return []

    def _update_objects(self, objects_raw: List[dict], frame_shape):
        counts: Dict[str, int] = {}
        nearest: Dict[str, float] = {}
        for o in objects_raw:
            label = o["label"]
            counts[label] = counts.get(label, 0) + 1
            x1, y1, x2, y2 = o["box"]
            dist = _estimate_distance_m(y2 - y1)
            if dist is not None:
                nearest[label] = min(dist, nearest.get(label, dist))
        objects = [
            {
                "id": f"obj-{label.replace(' ', '_')}",
                "label": label.replace("_", " ").title(),
                "count": count,
                "nearestDistanceM": nearest.get(label),
            }
            for label, count in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
        ]
        with self._lock:
            self._objects = objects

    # ------------------------------------------------------------------
    # recognized-people registry -- DETECTED -> RECOGNIZED -> GREETED ->
    # PRESENT -> LEFT, mirroring the desktop app's on-screen panel logic
    # (see SETUP_NOTES.md "on-screen panel" + Config.GREET_ONCE_PER_SESSION
    # / PERSON_ABSENCE_TIMEOUT) but shaped for RecognizedPerson JSON.
    # ------------------------------------------------------------------
    def _update_registry(self, persons: List[dict], faces: List[dict], frame_shape):
        now = time.time()
        now_ms = _now_ms()
        seen_keys = set()
        any_unknown = False

        for face in faces:
            name = face.get("name", "Unknown")
            # Use the containing PERSON box (full standing height) for the
            # distance estimate, not the face box itself -- a face box is
            # small and its on-screen size is a much noisier proxy for
            # "how far away" than a whole-body box is.
            person_box = self._find_person_box_for_face(face["box"], persons)
            distance_m = None
            bbox = None
            if person_box is not None:
                x1, y1, x2, y2 = person_box
                distance_m = _estimate_distance_m(y2 - y1)
                bbox = _normalized_bbox(person_box, frame_shape)
            else:
                # No matching YOLO "person" body box this frame -- fall
                # back to the face box itself so a recognized face ALWAYS
                # gets a distance/marker, not only when a full body also
                # happens to be detected (see ASSUMED_FACE_HEIGHT_M above).
                fx1, fy1, fx2, fy2 = face["box"]
                distance_m = _estimate_distance_from_face_m(fy2 - fy1)
                bbox = _normalized_bbox(face["box"], frame_shape)
            if name == "Unknown":
                any_unknown = True
                if not self._unknown_active:
                    self._unknown_active = True
                    self._unknown_counter += 1
                key = f"unknown-{self._unknown_counter}"
                display = f"Unknown #{self._unknown_counter:02d}"
            else:
                key = f"person-{name.lower().replace(' ', '-')}"
                display = name.replace("_", " ").title()
            seen_keys.add(key)

            with self._lock:
                record = self._people.get(key)
                if record is None:
                    status = "DETECTED" if name == "Unknown" else "RECOGNIZED"
                    self._people[key] = {
                        "id": key, "name": display, "status": status,
                        "firstSeenAt": now_ms, "lastSeenAt": now_ms,
                        "distanceM": distance_m, "bbox": bbox,
                        "_present": True, "_greet_ready_at": now + 1.5,
                    }
                    self.log_event(
                        (f"Face recognized: {display}" if name != "Unknown"
                         else f"{display} detected — not recognized")
                        + (f" (~{distance_m}m)" if distance_m is not None else ""))
                    continue

                was_left = record["status"] == "LEFT"
                record["lastSeenAt"] = now_ms
                record["_present"] = True
                record["distanceM"] = distance_m
                record["bbox"] = bbox
                if was_left:
                    record["status"] = "RECOGNIZED" if name != "Unknown" else "DETECTED"
                    self.log_event(f"{display} is back in frame")

                already_greeted = key in self._greeted_this_session
                if name != "Unknown" and not already_greeted and now >= record.get("_greet_ready_at", 0):
                    record["status"] = "GREETED"
                    self._greeted_this_session.add(key)
                    self.log_event(f"Namaste completed: {display}")
                    try:
                        self.gesture.perform_namaste()
                    except Exception:
                        pass
                    # See _greeting_active's docstring above -- this is
                    # the missing link that lets the browser react (play
                    # the avatar's Namaste animation + speak the greeting)
                    # to a REAL recognition instead of only the manual
                    # test button. 4s is comfortably longer than
                    # VISION_WS_INTERVAL (default 0.7s) so a connected
                    # browser tab is guaranteed to see it at least once.
                    self._greeting_active = display
                    self._greeting_until = now + 4.0
                elif already_greeted and record["status"] != "LEFT":
                    record["status"] = "PRESENT"

        if not any_unknown:
            self._unknown_active = False

        with self._lock:
            for key, record in self._people.items():
                if key not in seen_keys:
                    record["_present"] = False

    def _sweep_absent(self):
        timeout_ms = Config.PERSON_ABSENCE_TIMEOUT * 1000
        now_ms = _now_ms()
        newly_left = []
        with self._lock:
            for record in self._people.values():
                if not record.get("_present", False) and record["status"] != "LEFT":
                    if now_ms - record["lastSeenAt"] > timeout_ms:
                        record["status"] = "LEFT"
                        newly_left.append(record["name"])
        for name in newly_left:
            self.log_event(f"{name} left the frame")

    def active_user(self) -> str:
        """Most recently seen GREETED/PRESENT/RECOGNIZED person, for
        personalizing the chat wake-word reply ('Yes <name>, ...') the
        same way the desktop app's SharedState.get_user() did."""
        with self._lock:
            candidates = [
                p for p in self._people.values()
                if p.get("_present") and p["status"] in ("GREETED", "PRESENT", "RECOGNIZED")
            ]
            if not candidates:
                return ""
            candidates.sort(key=lambda p: p["lastSeenAt"], reverse=True)
            return candidates[0]["name"]

    # ------------------------------------------------------------------
    # drawing (baked into the JPEG the frontend receives -- the frontend
    # does not draw its own boxes, it just displays this stream)
    # ------------------------------------------------------------------
    @staticmethod
    def _match_person_to_face(person_box: List[int], faces: List[dict]) -> Optional[str]:
        px1, py1, px2, py2 = person_box
        for f in faces:
            if f.get("name", "Unknown") == "Unknown":
                continue
            fx1, fy1, fx2, fy2 = f["box"]
            cx, cy = (fx1 + fx2) / 2, (fy1 + fy2) / 2
            if px1 <= cx <= px2 and py1 <= cy <= py2:
                return f["name"]
        return None

    @staticmethod
    def _find_person_box_for_face(face_box: List[int], persons: List[dict]) -> Optional[List[int]]:
        """Reverse of _match_person_to_face -- given a face box, find the
        person (body) box it sits inside, so distance can be estimated
        from full standing height rather than the much smaller/noisier
        face box."""
        fx1, fy1, fx2, fy2 = face_box
        cx, cy = (fx1 + fx2) / 2, (fy1 + fy2) / 2
        for p in persons:
            px1, py1, px2, py2 = p["box"]
            if px1 <= cx <= px2 and py1 <= cy <= py2:
                return p["box"]
        return None

    def _annotate(self, frame, persons: List[dict], faces: List[dict]):
        out = frame.copy()

        for i, p in enumerate(persons):
            box = self.person_smoother.update(f"p{i}", p["box"])
            name = self._match_person_to_face(box, faces)
            color = Config.COL_GREEN if name else Config.COL_CYAN
            label = name.replace("_", " ").title() if name else "Person"
            x1, y1, x2, y2 = box
            cv2.rectangle(out, (x1, y1), (x2, y2), color, 2, cv2.LINE_AA)
            _draw_label(out, label, (x1, max(20, y1 - 6)), Config.COL_TEXT, scale=0.5)

        for i, f in enumerate(faces):
            box = self.face_smoother.update(f"f{i}", f["box"])
            x1, y1, x2, y2 = box
            is_known = f.get("name", "Unknown") != "Unknown"
            color = Config.COL_GREEN if is_known else Config.COL_GOLD
            _corner_brackets(out, x1, y1, x2, y2, color, thickness=2)
            label = f["name"].replace("_", " ").title() if is_known else "Unknown"
            _draw_label(out, label, (x1, min(out.shape[0] - 4, y2 + 18)), color, scale=0.5)

        cv2.putText(out, time.strftime("ARYA VISION — %H:%M:%S"), (10, out.shape[0] - 10),
                    cv2.FONT_HERSHEY_DUPLEX, 0.45, Config.COL_DIM, 1, cv2.LINE_AA)
        return out

    # ------------------------------------------------------------------
    # public getters (safe to call from FastAPI request handlers)
    # ------------------------------------------------------------------
    def get_jpeg(self) -> Optional[bytes]:
        with self._frame_lock:
            return self._latest_jpeg

    @staticmethod
    def _public_person(record: dict) -> dict:
        return {k: v for k, v in record.items() if not k.startswith("_")}

    def snapshot(self) -> dict:
        with self._lock:
            greeting_active = (
                self._greeting_active if time.time() < self._greeting_until else None
            )
            return {
                "ready": self.ready,
                "status": self.status,
                "error": self.error,
                "objects": list(self._objects),
                "people": [self._public_person(p) for p in self._people.values()],
                "log": list(self._log)[-40:],
                "greetingActive": greeting_active,
            } 