"""
================================================================================
 AURA (Windows build) — FACE RECOGNITION MODULE
 Everything related to the LEFT/camera side of the integrated script:
 InsightFace-based face recognition, optional YOLO person boxes, USB
 webcam handling (OpenCV DirectShow/MSMF on Windows), temporal
 voting/smoothing, and the namaste gesture controller (fires when a
 face is greeted).

 WINDOWS PORT NOTE -- CSI camera support removed on purpose. The
 original Jetson build could talk to a ribbon-cable CSI sensor via a
 GStreamer/nvarguscamerasrc pipeline (Jetson-only hardware). A Windows
 PC has no CSI header and no nvargus-daemon, so all of that (GStreamer
 pipeline builders, nvargus-daemon restart, IMX219 sensor-mode
 picking) has been deleted rather than just left as dead code. This
 build only ever opens a plain USB/UVC webcam through OpenCV
 (cv2.VideoCapture with the DirectShow/MSMF backend on Windows).

 This module never imports from vivek_interaction.py. It only depends on
 vivek_common.py (Config, RobotState, helpers) and standard/third-party
 libraries. vivek_main.py wires this together with vivek_interaction.py.
================================================================================
"""

import os
import time
import threading
from collections import deque, defaultdict
from typing import Optional, Tuple, List, Dict

import numpy as np
import cv2

from vivek_common import (
    Config, IS_WINDOWS, IS_LINUX, GPIO_AVAILABLE,
    _looks_like_gpu_oom, _print_gpu_oom_tip_once,
)

if IS_LINUX and GPIO_AVAILABLE:
    import Jetson.GPIO as GPIO

try:
    from insightface.app import FaceAnalysis
    INSIGHTFACE_AVAILABLE = True
except ImportError:
    INSIGHTFACE_AVAILABLE = False
    print("[WARN] insightface not installed -> face recognition disabled. "
          "pip install insightface onnxruntime (or onnxruntime-gpu if you have a CUDA GPU)")

# `ultralytics` (person/body-box detection) is imported LAZILY, only when
# Config.ENABLE_PERSON_DETECTION is true, since it drags in torch on
# every startup otherwise (multi-second import) even though most users
# never enable the cosmetic person boxes.
YOLO_AVAILABLE = None  # tri-state: None = not checked yet, else True/False
YOLO = None


def _try_import_yolo():
    global YOLO_AVAILABLE, YOLO
    if YOLO_AVAILABLE is not None:
        return YOLO_AVAILABLE
    try:
        from ultralytics import YOLO as _YOLO
        YOLO = _YOLO
        YOLO_AVAILABLE = True
    except ImportError:
        YOLO_AVAILABLE = False
        print("[WARN] ultralytics not installed -> person detection disabled. pip install ultralytics")
    return YOLO_AVAILABLE


# ══════════════════════════════════════════════════════════════════════
#  GESTURE — the namaste gesture fired by VivekIntegrated._greet_arrival()
#  the instant a recognized face is greeted out loud.
# ══════════════════════════════════════════════════════════════════════

class GestureController:
    def __init__(self):
        self.hw_ready = False
        if Config.ENABLE_GPIO and GPIO_AVAILABLE:
            try:
                GPIO.setmode(GPIO.BOARD)
                GPIO.setup(Config.SERVO_LEFT_PIN, GPIO.OUT)
                GPIO.setup(Config.SERVO_RIGHT_PIN, GPIO.OUT)
                self._pwm_left = GPIO.PWM(Config.SERVO_LEFT_PIN, 50)
                self._pwm_right = GPIO.PWM(Config.SERVO_RIGHT_PIN, 50)
                self._pwm_left.start(0)
                self._pwm_right.start(0)
                self.hw_ready = True
                print("[Gesture] GPIO servo control ready")
                # TODO(ARM): if you add more arm joints in Config, set up
                # + start a GPIO.PWM(...) for each new pin right here.
            except Exception as e:
                print(f"[Gesture] GPIO init failed, gesture simulated: {e}")
        else:
            print("[Gesture] GPIO not enabled — namaste will be simulated")

    def perform_namaste(self):
        print("[Gesture] Namaste!" + ("" if self.hw_ready else "  (simulated)"))
        if self.hw_ready:
            threading.Thread(target=self._run_servo_sequence, daemon=True).start()

    def _angle_to_duty(self, angle):
        return 2.5 + (angle / 18.0)

    def _run_servo_sequence(self):
        # TODO(ARM): placeholder two-servo namaste motion — replace with
        # your real arm's joint sequence once wired up.
        try:
            for al, ar in [(90, 90), (0, 180), (90, 90)]:
                self._pwm_left.ChangeDutyCycle(self._angle_to_duty(al))
                self._pwm_right.ChangeDutyCycle(self._angle_to_duty(ar))
                time.sleep(0.8)
            self._pwm_left.ChangeDutyCycle(0)
            self._pwm_right.ChangeDutyCycle(0)
        except Exception as e:
            print(f"[Gesture] servo sequence error: {e}")

    def cleanup(self):
        if self.hw_ready:
            try:
                self._pwm_left.stop()
                self._pwm_right.stop()
            except Exception:
                pass


# ══════════════════════════════════════════════════════════════════════
#  FACE DATABASE — InsightFace (ONNX)
# ══════════════════════════════════════════════════════════════════════

class FaceDatabase:
    def __init__(self):
        self.names: List[str] = []
        self.embeddings: Dict[str, np.ndarray] = {}
        self.loaded = False
        self.app = None
        self._init_app()

    def _init_app(self):
        if not INSIGHTFACE_AVAILABLE:
            print("[FaceDB] insightface not available -> recognition disabled")
            return
        det_size = (Config.DET_SIZE, Config.DET_SIZE)
        if Config.INSIGHTFACE_CTX_ID >= 0:
            try:
                self.app = FaceAnalysis(name=Config.INSIGHTFACE_PACK,
                                         providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
                self.app.prepare(ctx_id=Config.INSIGHTFACE_CTX_ID, det_size=det_size)
                actual = self._actual_providers()
                if actual and "CUDAExecutionProvider" in actual:
                    print(f"[FaceDB] InsightFace ready on GPU — pack={Config.INSIGHTFACE_PACK}")
                else:
                    print(f"[FaceDB] WARNING: requested GPU but onnxruntime has no CUDA "
                          f"provider installed (providers={actual}) — running on CPU, which "
                          f"is noticeably slower and competes with voice/AI for CPU time. "
                          f"Fix: pip uninstall onnxruntime && pip install onnxruntime-gpu "
                          f"(needs a matching CUDA/cuDNN install -- see SETUP_NOTES.md), or "
                          f"just leave INSIGHTFACE_CTX_ID=-1 in .env to use CPU on purpose.")
                return
            except Exception as e:
                if _looks_like_gpu_oom(str(e)):
                    _print_gpu_oom_tip_once()
                print(f"[FaceDB] GPU init failed ({e}), falling back to CPU")
                self.app = None
        try:
            self.app = FaceAnalysis(name=Config.INSIGHTFACE_PACK, providers=["CPUExecutionProvider"])
            self.app.prepare(ctx_id=-1, det_size=det_size)
            print(f"[FaceDB] InsightFace ready on CPU (slower)")
        except Exception as e:
            print(f"[FaceDB] InsightFace init failed entirely -> recognition disabled: {e}")
            self.app = None

    def _actual_providers(self) -> List[str]:
        try:
            for model in getattr(self.app, "models", {}).values():
                session = getattr(model, "session", None)
                if session is not None:
                    return list(session.get_providers())
        except Exception:
            pass
        return []

    def load(self) -> bool:
        if self.app is None:
            return False
        folder = Config.KNOWN_FACES_DIR
        if not os.path.isdir(folder):
            print(f"[FaceDB] '{folder}' does not exist. Create known_faces/<name>/photo1.jpg etc.")
            return False
        for person in sorted(os.listdir(folder)):
            pdir = os.path.join(folder, person)
            if not os.path.isdir(pdir):
                continue
            photos = [os.path.join(pdir, f) for f in os.listdir(pdir)
                      if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))]
            if not photos:
                continue
            embs = [e for e in (self._embed_enrollment_photo(p) for p in photos) if e is not None]
            if embs:
                self.embeddings[person] = np.vstack(embs)
                self.names.append(person)
                print(f"[FaceDB] '{person}': {len(embs)}/{len(photos)} photos usable")
            else:
                print(f"[FaceDB] WARNING: '{person}' has 0 usable photos")
        self.loaded = len(self.names) > 0
        print(f"[FaceDB] Ready — {len(self.names)} people enrolled: {', '.join(self.names)}"
              if self.loaded else "[FaceDB] No usable enrolled faces — everyone reports Unknown.")
        return self.loaded

    def _embed_enrollment_photo(self, path: str) -> Optional[np.ndarray]:
        img = cv2.imread(path)
        if img is None or self.app is None:
            return None
        try:
            faces = self.app.get(img)
        except Exception as e:
            if _looks_like_gpu_oom(str(e)):
                _print_gpu_oom_tip_once()
            return None
        if not faces:
            return None
        face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
        emb = np.array(face.normed_embedding, dtype=np.float64)
        norm = np.linalg.norm(emb)
        return emb / norm if norm > 1e-6 else None

    def match_frame(self, frame_bgr: np.ndarray) -> List[dict]:
        results = []
        if self.app is None:
            return results
        try:
            faces = self.app.get(frame_bgr)
        except Exception as e:
            if _looks_like_gpu_oom(str(e)):
                _print_gpu_oom_tip_once()
            return results
        for face in faces:
            x1, y1, x2, y2 = face.bbox
            w, h = x2 - x1, y2 - y1
            if w < Config.MIN_FACE_SIZE or h < Config.MIN_FACE_SIZE:
                continue
            if float(getattr(face, "det_score", 1.0)) < Config.MIN_DET_SCORE:
                continue
            box = [int(x1), int(y1), int(x2), int(y2)]
            emb = np.array(face.normed_embedding, dtype=np.float64)
            norm = np.linalg.norm(emb)
            if norm < 1e-6:
                continue
            emb = emb / norm
            name, sim = "Unknown", 0.0
            if self.loaded:
                best_name, best_sim = "Unknown", -1.0
                for person, mat in self.embeddings.items():
                    s = float((mat @ emb).max())
                    if s > best_sim:
                        best_sim, best_name = s, person
                name, sim = (best_name, best_sim) if best_sim >= Config.MATCH_THRESHOLD else \
                    ("Unknown", max(best_sim, 0.0))
            results.append({"box": box, "name": name, "similarity": round(sim, 3)})
        return results


class TemporalVote:
    def __init__(self, required: int = 3, window_sec: float = 4.0):
        self.required = required
        self.window_sec = window_sec
        self._history: Dict[str, deque] = defaultdict(lambda: deque(maxlen=15))

    def update(self, face_key: str, name: str, sim: float) -> Tuple[Optional[str], float]:
        now = time.time()
        h = self._history[face_key]
        h.append((name, sim, now))
        while h and now - h[0][2] > self.window_sec:
            h.popleft()
        counts, sims = defaultdict(int), defaultdict(list)
        for n, s, _ in h:
            if n != "Unknown":
                counts[n] += 1
                sims[n].append(s)
        if not counts:
            return None, 0.0
        best = max(counts, key=lambda k: counts[k])
        if counts[best] >= self.required:
            return best, round(sum(sims[best]) / len(sims[best]), 3)
        return None, 0.0


class DetectionWorker:
    def __init__(self, person_model, face_db: FaceDatabase, face_every_n: int = None):
        self.person_model = person_model
        self.face_db = face_db
        self._input_frame = None
        self._lock = threading.Lock()
        self._result = {"persons": [], "faces": []}
        self._running = False
        self._face_every_n = max(1, face_every_n if face_every_n is not None else Config.FACE_EVERY_N)
        self._cycle = 0

    def start(self):
        self._running = True
        threading.Thread(target=self._worker, daemon=True).start()

    def stop(self):
        self._running = False

    def submit(self, frame: np.ndarray):
        with self._lock:
            self._input_frame = frame.copy()

    def get_result(self):
        with self._lock:
            return list(self._result["persons"]), list(self._result["faces"])

    def _worker(self):
        while self._running:
            with self._lock:
                frame = None if self._input_frame is None else self._input_frame.copy()
                self._input_frame = None
            if frame is None:
                time.sleep(0.02)
                continue
            persons = self._detect_persons(frame)
            self._cycle += 1
            if self._cycle % self._face_every_n == 0:
                faces = self.face_db.match_frame(frame)
            else:
                with self._lock:
                    faces = list(self._result.get("faces", []))
            with self._lock:
                self._result = {"persons": persons, "faces": faces}
            time.sleep(0.01)

    def _detect_persons(self, frame) -> List[dict]:
        out = []
        if self.person_model is None:
            return out
        try:
            results = self.person_model.predict(frame, conf=Config.PERSON_CONF, classes=[0], verbose=False)
            for r in results:
                if r.boxes is None:
                    continue
                for box in r.boxes:
                    xyxy = [int(v) for v in box.xyxy[0]]
                    out.append({"box": xyxy, "conf": round(float(box.conf[0]), 3)})
        except Exception as e:
            if _looks_like_gpu_oom(str(e)):
                _print_gpu_oom_tip_once()
        return out


class BoxSmoother:
    def __init__(self, alpha=0.35, max_age=2.0):
        self.alpha = alpha
        self.max_age = max_age
        self._boxes: Dict[str, np.ndarray] = {}
        self._times: Dict[str, float] = {}

    def update(self, key: str, box: List[int]) -> List[int]:
        now = time.time()
        arr = np.array(box, dtype=np.float32)
        self._boxes[key] = arr if key not in self._boxes else \
            self.alpha * arr + (1 - self.alpha) * self._boxes[key]
        self._times[key] = now
        return [int(v) for v in self._boxes[key]]

    def cleanup(self):
        now = time.time()
        for k in [k for k, t in self._times.items() if now - t > self.max_age]:
            del self._boxes[k]
            del self._times[k]


# ══════════════════════════════════════════════════════════════════════
#  CAMERA — USB/UVC webcam ONLY (Windows build).
#
#  The original Jetson build could also talk to a CSI ribbon-cable
#  sensor through a GStreamer/nvarguscamerasrc pipeline. That entire
#  code path (pipeline builders, nvargus-daemon restart-on-crash logic,
#  IMX219 sensor-mode picking, the CSI-vs-USB auto-detect race) has
#  been removed -- a Windows PC has no CSI header, no nvargus-daemon,
#  and no GStreamer requirement to satisfy. This build always opens a
#  plain USB webcam through OpenCV's cv2.VideoCapture, preferring the
#  DirectShow backend on Windows (fastest/most reliable for USB/UVC
#  cams on Windows) and falling back to Media Foundation and the
#  platform-default backend if that fails.
# ══════════════════════════════════════════════════════════════════════

def _print_camera_diagnostics():
    print("\n[Camera] ---- diagnostics ----")
    print(f"[Camera] Config.CAM_INDEX={Config.CAM_INDEX}  CAM_W={Config.CAM_W}  "
          f"CAM_H={Config.CAM_H}  CAM_FRAMERATE={Config.CAM_FRAMERATE}")
    print("[Camera] Tips for a USB webcam on Windows:")
    print("         - Close any other app that might be using the camera")
    print("           (Zoom/Teams/Camera app/OBS/another Python process).")
    print("         - Open Windows Settings -> Privacy & security -> Camera")
    print("           and make sure 'Let desktop apps access your camera'")
    print("           is turned ON.")
    print("         - If you have more than one camera (e.g. a laptop's")
    print("           built-in webcam PLUS a USB webcam), try a different")
    print("           CAM_INDEX in .env -- 0, 1, 2... AURA tries a few")
    print("           indices automatically, but the right one being")
    print("           first just means fewer log lines to skim.")
    print("         - Device Manager -> Cameras/Imaging devices should")
    print("           show your webcam with no yellow warning icon.")
    print("[Camera] ---------------------\n")


class CameraManager:
    """Opens a USB/UVC webcam with OpenCV. Tries a small number of
    (index, backend) combinations in order and keeps the first one that
    actually delivers frames -- this is deliberately simple (no CSI/
    GStreamer branch) since this build only ever targets a USB camera
    on Windows (or Linux/macOS, via the platform-appropriate backend
    list below, if this same code is ever run there)."""

    def __init__(self):
        self.cap: Optional[cv2.VideoCapture] = None

    @staticmethod
    def _backends() -> List[int]:
        if IS_WINDOWS:
            # DirectShow first -- generally the fastest/most reliable for
            # USB webcams on Windows. Media Foundation (CAP_MSMF) and the
            # platform default are tried next in case a particular camera
            # or driver behaves better with one of those instead.
            return [cv2.CAP_DSHOW, cv2.CAP_MSMF, cv2.CAP_ANY]
        elif IS_LINUX:
            return [cv2.CAP_V4L2, cv2.CAP_ANY]
        else:
            return [cv2.CAP_ANY]

    def _try_open_capture(self, index: int, backend: int, label: str) -> bool:
        print(f"[Camera] trying: {label} ...")
        try:
            cap = cv2.VideoCapture(index, backend)
        except Exception as e:
            print(f"[Camera]   -> exception opening: {e}")
            return False
        if not cap.isOpened():
            print("[Camera]   -> failed: capture did not open")
            cap.release()
            return False

        # Ask for MJPG -- most USB webcams support it, and it's far less
        # likely to hit a slow/uncompressed-YUY2 fallback that tanks FPS
        # through DirectShow than leaving the fourcc unset.
        try:
            cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        except Exception:
            pass
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, Config.CAM_W)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, Config.CAM_H)
        try:
            cap.set(cv2.CAP_PROP_FPS, Config.CAM_FRAMERATE)
        except Exception:
            pass
        try:
            # Keep only the newest frame buffered where the backend
            # supports it, so the UI shows a live frame, not a growing
            # backlog, if processing ever falls a little behind.
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        except Exception:
            pass

        deadline = time.time() + Config.CAM_OPEN_TIMEOUT_SEC
        got_frame = False
        while time.time() < deadline:
            ret, frame = cap.read()
            if ret and frame is not None and frame.size > 0:
                got_frame = True
                break
            time.sleep(0.1)
        if not got_frame:
            print(f"[Camera]   -> opened but no frames within {Config.CAM_OPEN_TIMEOUT_SEC}s, giving up")
            cap.release()
            return False

        actual_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        actual_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        actual_fps = cap.get(cv2.CAP_PROP_FPS)
        self.cap = cap
        print(f"[Camera]   -> SUCCESS: {label}  ({actual_w}x{actual_h} @ {actual_fps:.0f}fps requested)")
        return True

    def open(self) -> bool:
        indices = list(dict.fromkeys([Config.CAM_INDEX, 0, 1, 2, 3]))
        for idx in indices:
            for backend in self._backends():
                if self._try_open_capture(idx, backend, f"USB camera index {idx} (backend={backend})"):
                    return True
        print("[Camera] ERROR: could not open any USB camera")
        _print_camera_diagnostics()
        return False


def test_camera():
    """Quick standalone check: open the camera and print what happened,
    without loading InsightFace/YOLO/Gemini at all."""
    cam = CameraManager()
    ok = cam.open()
    if ok:
        ret, frame = cam.cap.read()
        print(f"[Test] camera opened OK, frame read ok={ret}, "
              f"shape={None if frame is None else frame.shape}")
        cam.cap.release()
    else:
        print("[Test] camera failed to open — see diagnostics above.")
