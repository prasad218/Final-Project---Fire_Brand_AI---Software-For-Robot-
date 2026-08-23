"""
================================================================================
 AURA (Windows build) — COMMON MODULE
 Shared Config, SharedState, RobotState, branding/speech text, and drawing
 helpers used by BOTH vivek_face.py (face recognition) and
 vivek_interaction.py (voice / AI interaction), plus vivek_main.py (the
 orchestrator that renders the single combined window).

 Nothing in this file should import from vivek_face.py or
 vivek_interaction.py — it only ever gets imported BY them, never the
 other way around, so there are no circular imports.
================================================================================
"""

import os
import re
import time
import platform
import threading
import subprocess
from pathlib import Path
from collections import deque
from typing import Optional, Tuple, List
from enum import Enum

import numpy as np
import cv2

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

IS_WINDOWS = platform.system() == "Windows"
IS_LINUX = platform.system() == "Linux"

# ── Thread-oversubscription guard ───────────────────────────────────────
# Must run before onnxruntime / torch / cv2 are imported anywhere in the
# process, so this module should be imported FIRST by vivek_main.py
# (before vivek_face / vivek_interaction, which pull in those libraries).
_DEFAULT_THREADS = str(min(4, os.cpu_count() or 4))
os.environ.setdefault("OMP_NUM_THREADS", os.getenv("OMP_NUM_THREADS", _DEFAULT_THREADS))
os.environ.setdefault("OPENBLAS_NUM_THREADS", os.getenv("OPENBLAS_NUM_THREADS", _DEFAULT_THREADS))
os.environ.setdefault("MKL_NUM_THREADS", os.getenv("MKL_NUM_THREADS", _DEFAULT_THREADS))
os.environ.setdefault("ORT_NUM_THREADS", os.getenv("ORT_NUM_THREADS", _DEFAULT_THREADS))


def _is_jetson() -> bool:
    try:
        if os.path.exists("/etc/nv_tegra_release"):
            return True
        model_path = "/proc/device-tree/model"
        if os.path.exists(model_path):
            with open(model_path, "r", errors="ignore") as f:
                if "jetson" in f.read().lower() or "nvidia" in f.read().lower():
                    return True
    except Exception:
        pass
    return False


IS_JETSON = _is_jetson()

GPIO_AVAILABLE = False
if IS_LINUX:
    try:
        import Jetson.GPIO as GPIO  # noqa: F401
        GPIO_AVAILABLE = True
    except Exception:
        GPIO_AVAILABLE = False


def _run_quiet(cmd, timeout=6) -> Tuple[bool, str]:
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return out.returncode == 0, (out.stdout or "") + (out.stderr or "")
    except Exception as e:
        return False, str(e)


_GPU_OOM_MARKERS = ("InsufficientMemory", "CUBLAS_STATUS_ALLOC_FAILED",
                     "NvMapMemHandleAlloc", "NvMapMemAllocInternalTagged",
                     "out of memory", "OOM")
_gpu_oom_tip_printed = False


def _looks_like_gpu_oom(text: str) -> bool:
    return bool(text) and any(m in text for m in _GPU_OOM_MARKERS)


def _print_gpu_oom_tip_once():
    global _gpu_oom_tip_printed
    if _gpu_oom_tip_printed:
        return
    _gpu_oom_tip_printed = True
    print("\n[GPU] GPU/ISP out-of-memory error detected. This is NOT a camera/wiring")
    print("[GPU] problem. Check `tegrastats`, kill stale python processes, close other")
    print("[GPU] GPU-heavy apps, or set INSIGHTFACE_CTX_ID=-1 to force CPU.\n")


# ══════════════════════════════════════════════════════════════════════
#  CONFIG  (shared by both modules — camera/face settings are only read
#  by vivek_face.py, speech/AI settings only by vivek_interaction.py,
#  but keeping them in one class keeps .env handling in one place)
# ══════════════════════════════════════════════════════════════════════

class Config:
    # ---- face recognition -------------------------------------------------
    PERSON_MODEL = os.getenv("PERSON_MODEL", "yolov8n.pt")
    KNOWN_FACES_DIR = os.getenv("KNOWN_FACES_DIR", "known_faces")
    PERSON_CONF = float(os.getenv("PERSON_CONF", "0.45"))
    ENABLE_PERSON_DETECTION = os.getenv("ENABLE_PERSON_DETECTION", "false").lower() == "true"

    INSIGHTFACE_PACK = os.getenv("INSIGHTFACE_PACK", "buffalo_s")
    DET_SIZE = int(os.getenv("DET_SIZE", "256"))
    INSIGHTFACE_CTX_ID = int(os.getenv("INSIGHTFACE_CTX_ID", "0"))
    MIN_DET_SCORE = float(os.getenv("MIN_DET_SCORE", "0.5"))
    MATCH_THRESHOLD = float(os.getenv("MATCH_THRESHOLD", "0.5"))
    MIN_FACE_SIZE = int(os.getenv("MIN_FACE_SIZE", "40"))
    REQUIRED_CONFIRM_FRAMES = int(os.getenv("REQUIRED_CONFIRM_FRAMES", "3"))

    INFERENCE_INTERVAL = float(os.getenv("INFERENCE_INTERVAL", "0.6"))
    FACE_EVERY_N = int(os.getenv("FACE_EVERY_N", "2"))

    # ---- camera (USB/UVC webcam only -- see vivek_face.CameraManager) ---
    CAM_W = int(os.getenv("CAM_W", "640"))
    CAM_H = int(os.getenv("CAM_H", "480"))
    CAM_INDEX = int(os.getenv("CAM_INDEX", "0"))
    CAM_FRAMERATE = int(os.getenv("CAM_FRAMERATE", "30"))
    CAM_OPEN_TIMEOUT_SEC = float(os.getenv("CAM_OPEN_TIMEOUT_SEC", "6.0"))

    BOX_SMOOTH_ALPHA = 0.35
    PERSON_ABSENCE_TIMEOUT = float(os.getenv("PERSON_ABSENCE_TIMEOUT", "5.0"))

    DEBUG_DEFAULT = os.getenv("DEBUG_MODE", "false").lower() == "true"

    STT_LANGUAGE = os.getenv("STT_LANGUAGE", "en-IN")
    ENABLE_KANNADA_STT = os.getenv("ENABLE_KANNADA_STT", "true").lower() == "true"

    SUPPRESS_GREETING_DURING_CONVERSATION = os.getenv(
        "SUPPRESS_GREETING_DURING_CONVERSATION", "true").lower() == "true"

    # Once AURA has spoken the "Namaste, I have recognized you" greeting
    # for a given person, don't speak it again for the rest of this run
    # -- even if they walk away and come back later. The on-screen
    # "Recognized People -- Live" panel keeps tracking their
    # present/departed status and last-seen time regardless; this only
    # controls the SPOKEN greeting. Set to false to restore the old
    # behavior (re-greet after PERSON_ABSENCE_TIMEOUT of not being seen).
    GREET_ONCE_PER_SESSION = os.getenv("GREET_ONCE_PER_SESSION", "true").lower() == "true"

    # Max rows drawn in the live "Recognized People" panel before older
    # (already-departed) entries are hidden from view. They're never
    # deleted from the underlying log, just not drawn, so the panel
    # doesn't run out of room during a long-running session.
    RECOGNITION_LOG_MAX_ROWS = int(os.getenv("RECOGNITION_LOG_MAX_ROWS", "12"))

    # ---- voice input --------------------------------------------------
    MIC_ENERGY_THRESHOLD = int(os.getenv("MIC_ENERGY_THRESHOLD", "300"))
    MIC_DYNAMIC_ENERGY = os.getenv("MIC_DYNAMIC_ENERGY", "false").lower() == "true"
    MIC_PHRASE_TIMEOUT = float(os.getenv("MIC_PHRASE_TIMEOUT", "5"))
    MIC_PAUSE_THRESHOLD = float(os.getenv("MIC_PAUSE_THRESHOLD", "0.6"))
    MIC_NON_SPEAKING_DURATION = float(os.getenv("MIC_NON_SPEAKING_DURATION", "0.4"))
    CONVERSATION_TIMEOUT = float(os.getenv("CONVERSATION_TIMEOUT", "60"))
    MIC_DEVICE_INDEX = os.getenv("MIC_DEVICE_INDEX")
    MIC_DEVICE_INDEX = int(MIC_DEVICE_INDEX) if MIC_DEVICE_INDEX not in (None, "") else None

    # WAKE_WORDS is no longer REQUIRED to trigger AURA (see
    # VoiceListener._process in vivek_interaction.py) -- every recognized
    # utterance is treated as a command/question directly now. This list
    # is kept only so _strip_wake_words can still remove "AURA, " from
    # the front of what's sent onward, for anyone who keeps saying it out
    # of habit; it's harmless either way.
    WAKE_WORDS = ["aura", "hey aura", "hi aura", "hello aura", "okay aura"]
    # Shutdown is the one exception -- it DOES still require saying
    # "AURA" first (these phrases all start with it), on purpose, so an
    # unrelated nearby conversation can't accidentally power the robot
    # off now that nothing else needs a wake word.
    SHUTDOWN_PHRASES = ["aura shutdown", "aura shut down", "aura power off",
                         "aura goodbye", "aura exit", "aura quit", "aura stop"]

    INTRODUCTION_PHRASES = [
        "introduce yourself",
        "please introduce yourself",
        "can you introduce yourself",
        "introduce yourself to us",
    ]

    KANNADA_INTRODUCTION_PHRASES = [
        "ninna parichaya heli", "nimma parichaya heli", "nim parichaya heli",
        "swalpa ninna parichaya heli", "swalpa nimma parichaya heli",
        "parichaya madi", "parichaya kodi",
    ]
    KANNADA_INTRODUCTION_PHRASES_SCRIPT = [
        "ನಿಮ್ಮ ಪರಿಚಯ ಹೇಳಿ", "ನಿನ್ನ ಪರಿಚಯ ಹೇಳಿ", "ಪರಿಚಯ ಮಾಡಿ", "ಪರಿಚಯ ಕೊಡಿ",
    ]

    COLLEGE_INFO_PHRASES = [
        "tell about vcet", "tell me about vcet", "about vcet",
        "tell about vvs", "tell me about vvs", "about vvs", "tell about the vvs",
        "tell about vivekananda college", "tell me about vivekananda college",
        "about vivekananda college", "tell about vivekananda vidyavardhaka sangha",
        "tell me about vivekananda vidyavardhaka sangha",
        "about vivekananda vidyavardhaka sangha",
        "tell about the college", "tell me about the college", "about the college",
        "tell about your college", "tell me about your college", "about your college",
        "tell about vivekananda college of engineering",
        "tell about vivekananda college of engineering and technology",
        "college information", "college details", "history of the college",
        "history of vcet", "history of vvs",
    ]

    KANNADA_COLLEGE_INFO_PHRASES = [
        "vivekananda college bagge heli", "college bagge heli", "vvs bagge heli",
        "vivekananda bagge heli", "vcet bagge heli", "nim college bagge heli",
        "vivekananda vidya vardhaka sangha bagge heli", "collegena bagge heli",
        "vivekananda engineering college bagge heli", "v c e t bagge heli",
        "v v s bagge heli", "college history heli", "college bagge tili",
    ]
    KANNADA_COLLEGE_INFO_PHRASES_SCRIPT = [
        "ವಿವೇಕಾನಂದ ಕಾಲೇಜು ಬಗ್ಗೆ ಹೇಳಿ", "ಕಾಲೇಜು ಬಗ್ಗೆ ಹೇಳಿ", "ವಿ.ವಿ.ಎಸ್ ಬಗ್ಗೆ ಹೇಳಿ",
        "ವಿವಿಎಸ್ ಬಗ್ಗೆ ಹೇಳಿ", "ವಿವೇಕಾನಂದ ವಿದ್ಯಾ ವರ್ಧಕ ಸಂಘ ಬಗ್ಗೆ ಹೇಳಿ",
        "vcet ಬಗ್ಗೆ ಹೇಳಿ",
    ]

    # ---- Campus location Q&A (English, canned + instant) ------------------
    # Answered directly, with NO AI/network round-trip at all -- these are
    # fixed facts about where things physically are on campus, not
    # something an LLM should ever be guessing or hallucinating about, and
    # skipping the AI call also means these are the fastest-possible
    # replies in the whole app. Checked in _handle_utterance BEFORE the
    # general open-ended Q&A path.
    #
    # Order matters: more specific phrase groups are listed BEFORE more
    # general ones that could otherwise match as a substring of them (e.g.
    # "computer science and design" contains "computer science" -- the
    # AIML/CD group below is checked first so it wins that case).
    #
    # Update these answers/phrases here if block names, room assignments,
    # or how people actually ask change -- everything lives in this one
    # list, nothing about locations is hard-coded anywhere else.
    LOCATION_QA = [
        {
            # AI & ML and CD (Computer Science & Design) classes -- kept
            # ABOVE the plain "Computer Science" entry on purpose, see note above.
            "phrases": [
                "where is ai ml class", "where is a i m l class", "where is aiml class",
                "where's ai ml class", "is ai ml class there", "ai ml class",
                "where is the ai and ml class", "where is artificial intelligence class",
                "where is artificial intelligence and machine learning class",
                "where is cd class", "where is c d class", "is cd class there",
                "where's cd class", "cd class",
                "where is computer science and design class",
                "where is computer science and design",
            ],
            "answer": ("The A I and M L class, and the C D class, are at Krishna "
                       "Chethana block, near Madhuchethana block."),
        },
        {
            "phrases": [
                "where is civil class", "where is civil engineering class",
                "where is mech class", "where is mechanical class",
                "where is mechanical engineering class",
                "where is civil and mech class", "where is civil and mechanical class",
                "where's civil class", "where's mech class",
            ],
            # Per Campus_Locations.xlsx: the Civil & Mechanical Departments
            # entry, and the Civil/Mech labs (Engineering Environment Lab,
            # Mechanical Design Lab, Measurement & Metrology Lab, etc.) are
            # all in Maduchethana Block -- NOT "near Krishna Chethana
            # block" as this used to say (that was from an old screenshot,
            # not the actual directory).
            "answer": "Civil and Mechanical departments and labs are in Maduchethana Block.",
        },
        {
            # Plain Computer Science (CSE) -- checked AFTER the AIML/CD
            # group above so "computer science and design" doesn't get
            # matched here first.
            "phrases": [
                "where is computer science class", "where is cse class",
                "where is computer science engineering class",
                "where is computer science", "is computer science class there",
                "where's computer science class", "computer science class",
            ],
            # Per Campus_Locations.xlsx: the CS Department is room A131,
            # 1st Floor, Sudarshana Building -- NOT "near Madhuchethana
            # block" as this used to say.
            "answer": "The Computer Science (CSE) department is room A131, 1st Floor, Sudarshana Building.",
        },
        {
            "phrases": [
                "where is krishna chethana block", "where is krishna chethana",
                "where is krishna chetana block", "where is krishna chetana",
                "where's krishna chethana block", "where's krishna chethana",
                "krishna chethana block", "krishna chetana block",
            ],
            "answer": "Krishna Chethana block is near Madhuchethana block.",
        },
        {
            "phrases": [
                "where is madhuchethana block", "where is madhuchethana",
                "where is madhu chethana block", "where is madhu chethana",
                "where is maduchethana block", "where is maduchethana",
                "where's madhuchethana block", "where's madhuchethana",
                "madhuchethana block", "madhu chethana block", "maduchethana block",
            ],
            "answer": "Madhuchethana block is near Krishna Chethana block.",
        },
        {
            "phrases": [
                "where is sudarshana block", "where is sudarshana",
                "where is sudarshan block", "where is sudarshan",
                "where's sudarshana block", "where's sudarshana",
                "sudarshana block", "sudarshan block",
            ],
            "answer": "Sudarshana block is near the entrance.",
        },
        # NOTE: the old "Placement department" / "Office" canned entries
        # that used to sit here ("near the entrance" / "near the
        # Placement department") were removed -- they conflicted with
        # Campus_Locations.xlsx, which places both in Sudarshana
        # Building, Ground Floor, with their own distinct notes ("Near
        # Student Welfare Office" and "Near reception" respectively).
        # Those questions now fall through to the Excel-backed lookup in
        # campus_locations.py (see match_location_qa in chat_service.py),
        # which answers them correctly from the actual spreadsheet.
        #
        # The entire "Added from the room-directory screenshot" block
        # that used to follow here (C Programming Lab, DBMS lab, DSA
        # lab, Java lab, Micro Controller lab, ML lab, Internet Lab,
        # Ladies/Staff washrooms, CS Staff Cabins) has ALSO been removed
        # -- it was hand-typed from an old screenshot, not
        # Campus_Locations.xlsx, and turned out to be wrong or
        # unconfirmable for nearly every room number in it once checked
        # against the real spreadsheet:
        #   A018 is "POP Lab C", not the C Programming Lab
        #   A103 is "Web Programming", not the DBMS lab (DBMS/DAA is E210,
        #     Krishna Chethana Block)
        #   A104 is "DS/DAA", not specifically "the DSA lab"
        #   A105 is "OOP Lab", not the Java lab
        #   A106 doesn't exist anywhere in the spreadsheet as "the ML
        #     lab" (the real ML Lab is E108, Krishna Chethana Block)
        #   A131 is "CS Department", not specifically "CS Staff Cabins"
        #   A134 / A135 (the washroom entries) aren't in the spreadsheet
        #     at all
        #   A136 is "CAN Lab", not the Micro Controller lab
        #   A138 is "Computer Lab 2", not "Internet Lab"
        # All of these questions now fall through to the Excel-backed
        # lookup instead, which answers correctly from the real data
        # (e.g. "where is dbms lab" -> "DBMS/DAA Lab is at room E210,
        # 2nd Floor, Krishna Chethana Block.").
    ]

    # Same facts, folded into a compact block appended to Gemini's system
    # instruction (see AuraGeminiEngine._build_system_instruction in
    # aura_gemini.py) --
    # this is what keeps answers correct if someone phrases a location
    # question in a way that doesn't match LOCATION_QA above exactly, or
    # asks about one of these places while in Kannada conversation mode
    # (where the AI, not a canned string, produces the actual reply).
    # Keep this in sync BY HAND with LOCATION_QA above if you change either.
    CAMPUS_LOCATION_FACTS = (
        "You also know these campus location facts -- use ONLY this "
        "information if asked where a block, class, lab, room, or "
        "department is, and do not guess or invent any location not "
        "listed here: "
        "Krishna Chethana block is near Madhuchethana block. "
        "Madhuchethana block is near Krishna Chethana block. "
        "Sudarshana block is near the entrance. "
        "The AI & ML class and the CD (Computer Science and Design) class "
        "are at Krishna Chethana block, near Madhuchethana block. "
        "Civil and Mechanical departments and labs are in Maduchethana Block. "
        "The Computer Science (CSE) department is room A131, 1st Floor, "
        "Sudarshana Building."
    )

    # The above CAMPUS_LOCATION_FACTS block is hand-typed and, as the
    # comment above it says, has to be kept in sync BY HAND with
    # LOCATION_QA -- which means it can (and does) drift out of date as
    # the real room directory changes. campus_locations.py loads the
    # actual Campus_Locations.xlsx directory (data/Campus_Locations.xlsx)
    # and is appended below as the AUTHORITATIVE source for anything not
    # already covered above, so Gemini stays grounded in the real,
    # current spreadsheet even where this hand-typed block is stale or
    # incomplete. See campus_locations.find_location_answer(), used by
    # chat_service.match_location_qa() as a fallback instant-answer path
    # beyond LOCATION_QA, for the same data.
    try:
        from campus_locations import CAMPUS_LOCATION_FACTS_TEXT as _XLSX_FACTS
        if _XLSX_FACTS:
            CAMPUS_LOCATION_FACTS = CAMPUS_LOCATION_FACTS.rstrip() + "\n\n" + _XLSX_FACTS
    except Exception as _e:  # pragma: no cover -- fail-open, see campus_locations.py
        print(f"[Config] campus_locations.py not loaded ({_e}); "
              "falling back to the hand-typed CAMPUS_LOCATION_FACTS only.")

    # ---- Kannada conversation-mode toggle ----------------------------------
    # Free, open-ended Kannada Q&A (not just the two canned intro/college
    # replies above) works by TOGGLING a conversation language mode, since
    # a free STT engine can't reliably auto-detect English vs. Kannada on
    # every single utterance. Say one of these (e.g. "speak Kannada" --
    # no wake word needed) to switch modes; AURA confirms out loud.
    # While in Kannada mode: your speech is recognized with kn-IN STT, the
    # AI is asked to reply in Kannada, and the reply is spoken by Gemini
    # in Kannada. Say "speak English" to switch back.
    KANNADA_MODE_ON_PHRASES = [
        "speak kannada", "speak in kannada", "talk in kannada", "talk kannada",
        "reply in kannada", "answer in kannada", "switch to kannada",
        "kannada mode", "kannada nalli matadi", "kannadalli matadi",
        "kannada nalli helu", "kannada language",
    ]
    KANNADA_MODE_ON_PHRASES_SCRIPT = [
        "ಕನ್ನಡದಲ್ಲಿ ಮಾತಾಡಿ", "ಕನ್ನಡದಲ್ಲಿ ಮಾತನಾಡಿ", "ಕನ್ನಡದಲ್ಲಿ ಹೇಳಿ", "ಕನ್ನಡ ಮಾತಾಡಿ",
    ]
    KANNADA_MODE_OFF_PHRASES = [
        "speak english", "speak in english", "talk in english", "talk english",
        "reply in english", "answer in english", "switch to english",
        "english mode", "english nalli matadi", "english language",
    ]
    KANNADA_MODE_OFF_PHRASES_SCRIPT = [
        "ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ ಮಾತಾಡಿ", "ಇಂಗ್ಲಿಷ್ ಮಾತಾಡಿ",
    ]
    KANNADA_MODE_ON_REPLY = "ಸರಿ, ಇನ್ನು ಮುಂದೆ ನಾನು ಕನ್ನಡದಲ್ಲಿ ಮಾತನಾಡುತ್ತೇನೆ."
    KANNADA_MODE_OFF_REPLY = "Okay, I'll switch back to English now."

    MOVE_COMMANDS = {
        "forward": ["go forward", "move forward", "go front", "move front", "forward", "front"],
        "backward": ["go backward", "move backward", "go back", "move back", "backward", "back"],
        "left": ["turn left", "go left", "move left", "left"],
        "right": ["turn right", "go right", "move right", "right"],
        "stop": ["stop moving", "stop", "halt", "freeze"],
    }
    MOVE_AUTO_STOP_SEC = float(os.getenv("MOVE_AUTO_STOP_SEC", "4.0"))

    # ---- Gemini voice module (AURA's ONLY brain + ONLY voice) ------------
    # ONE Gemini model does everything -- see aura_gemini.py. Gemini
    # hears the actual question audio, decides what to say, and speaks
    # it, all in one Live session (VoiceListener._handle_utterance ->
    # AuraGeminiEngine.ask_and_speak) AND speaks every other line AURA
    # says, including the introduction, college info, campus-location
    # answers, movement confirmations, and the Kannada toggle
    # confirmations (AuraGeminiEngine.speak_exact, called from
    # SpeechEngine in vivek_interaction.py). There is no separate text
    # "brain" model and no other TTS engine anywhere in this app. If
    # GEMINI_API_KEY is empty, the package isn't installed,
    # USE_GEMINI_VOICE is false, or a Gemini call fails at runtime, AURA
    # CANNOT speak or answer questions at all (it can still hear wake
    # words and commands, and drive/gesture) -- watch for the startup
    # warning in vivek_main.py.
    #
    # Don't paste a real key into this file if you ever share it (zip,
    # git, chat, etc.) -- paste it into your own local .env only. Get a
    # key at https://aistudio.google.com/apikey
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
    USE_GEMINI_VOICE = os.getenv("USE_GEMINI_VOICE", "true").lower() == "true"
    # The ONE model AURA uses for everything -- must be a Gemini LIVE
    # model (audio-native, real-time), since it both hears the question
    # and speaks the reply in the same session. Check
    # https://ai.google.dev/gemini-api/docs/live-api if this one ever
    # 404s, Live model availability changes over time. An alternative
    # current Live model if this one ever stops working:
    # gemini-2.5-flash-native-audio-preview-12-2025
    GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-live-preview")
    # One of Gemini's built-in prebuilt voices (e.g. Kore, Puck, Charon,
    # Fenrir, Aoede, Leda, Orus, Zephyr...) -- leave blank to use Gemini's
    # own default voice.
    GEMINI_VOICE_NAME = os.getenv("GEMINI_VOICE_NAME", "Kore")
    # Sample rate (Hz) of the mic audio streamed TO Gemini for open-ended
    # questions (ask_and_speak only -- speak_exact sends text, not audio).
    GEMINI_INPUT_RATE = int(os.getenv("GEMINI_INPUT_RATE", "16000"))
    # Sample rate (Hz) of the PCM audio Gemini streams BACK -- used to
    # play it back through the audio player and to work out how long to wait for
    # playback to finish. 24000 is correct for the current Live models;
    # only change this if you switch to one with a different output rate.
    GEMINI_OUTPUT_RATE = int(os.getenv("GEMINI_OUTPUT_RATE", "24000"))
    # How long AURA will wait for Gemini to finish generating+streaming
    # one reply/line before giving up. Since there's no fallback at all,
    # don't set this too low -- a slow reply is better than a cut-off one.
    GEMINI_TURN_TIMEOUT_SEC = float(os.getenv("GEMINI_TURN_TIMEOUT_SEC", "25"))

    ENABLE_GPIO = os.getenv("ENABLE_GPIO", "false").lower() == "true"
    SERVO_LEFT_PIN = int(os.getenv("SERVO_LEFT_PIN", "32"))
    SERVO_RIGHT_PIN = int(os.getenv("SERVO_RIGHT_PIN", "33"))
    MOTOR_LEFT_FWD_PIN = int(os.getenv("MOTOR_LEFT_FWD_PIN", "29"))
    MOTOR_LEFT_BWD_PIN = int(os.getenv("MOTOR_LEFT_BWD_PIN", "31"))
    MOTOR_RIGHT_FWD_PIN = int(os.getenv("MOTOR_RIGHT_FWD_PIN", "36"))
    MOTOR_RIGHT_BWD_PIN = int(os.getenv("MOTOR_RIGHT_BWD_PIN", "37"))

    # colors (BGR)
    COL_BG = (18, 14, 12)
    COL_PANEL = (46, 30, 18)
    COL_TEXT = (235, 240, 245)
    COL_DIM = (150, 138, 126)
    COL_CYAN = (255, 218, 40)
    COL_GREEN = (110, 245, 130)
    COL_RED = (70, 60, 250)
    COL_PURPLE = (245, 120, 170)
    COL_GOLD = (60, 200, 255)

    STATE_COLORS = {
        "IDLE": COL_DIM, "SCANNING": COL_CYAN, "PERSON_DETECTED": COL_CYAN,
        "FACE_RECOGNIZED": COL_GREEN, "PERSON_LOST": COL_RED,
    }
    UI_STATE_COLORS = {
        "idle": COL_DIM, "listening": COL_CYAN, "thinking": COL_PURPLE,
        "speaking": COL_GREEN, "error": COL_RED,
    }
    UI_STATE_LABELS = {
        "idle": "Listening -- just ask", "listening": "Listening...",
        "thinking": "Thinking...", "speaking": "Speaking...", "error": "Error",
    }

    # ---- layout ---------------------------------------------------------
    BRANDING_SPLIT = float(os.getenv("BRANDING_SPLIT", "0.8"))
    WINDOW_W = int(os.getenv("WINDOW_W", "1600"))
    WINDOW_H = int(os.getenv("WINDOW_H", "720"))

    # ══════════════════════════════════════════════════════════════════
    #  WEB INTEGRATION (web_server.py / vision_service.py / chat_service.py)
    #  Everything below is only used by the new FastAPI web backend that
    #  serves the React frontend (arya-robot-control). It deliberately
    #  reuses every phrase list / canned-answer / threshold above instead
    #  of duplicating them, so the web chat and the original desktop
    #  voice pipeline always agree on what counts as "the introduction
    #  question", "a movement command", etc.
    # ══════════════════════════════════════════════════════════════════

    # ONE Gemini model for the web TEXT chat (Talk with ARYA / open-ended
    # questions typed or spoken-then-transcribed-by-the-browser). This is
    # DELIBERATELY separate from GEMINI_MODEL above: GEMINI_MODEL is an
    # audio-native Live model used by the desktop app's speaker/mic loop
    # (aura_gemini.py); a browser client can't stream raw PCM into that
    # the same way, and doesn't need to -- the browser's own Web Speech
    # API already turns speech into text client-side, and the browser can
    # speak ARYA's text reply back out with speechSynthesis. So the web
    # chat just needs a plain text-in/text-out call, which is what
    # GEMINI_TEXT_MODEL + AuraChatEngine.ask() (chat_service.py) do via
    # client.models.generate_content(...) -- no Live session, no audio.
    GEMINI_TEXT_MODEL = os.getenv("GEMINI_TEXT_MODEL", "gemini-2.5-flash")

    # Reply spoken/shown the moment someone says just "Arya" (or "hey/hi/
    # hello/okay Arya") with nothing else -- mirrors the desktop app's
    # wake-word-only reply in VoiceListener._process (vivek_interaction.py,
    # "Yes, how can I help you?"), just with the exact wording requested
    # for the web chat.
    CHAT_WAKE_REPLY = os.getenv("CHAT_WAKE_REPLY", "Yes, how can I help you today?")
    CHAT_WAKE_REPLY_NAMED = os.getenv(
        "CHAT_WAKE_REPLY_NAMED", "Yes {name}, how can I help you today?")

    # FastAPI server bind address/port (web_server.py) and the frontend
    # origins allowed to call it (CORS). Comma-separated. "*" (default)
    # is fine for local development / a robot on a closed LAN; tighten
    # this to your real frontend origin(s) before exposing the backend
    # beyond your own network.
    WEB_HOST = os.getenv("WEB_HOST", "0.0.0.0")
    WEB_PORT = int(os.getenv("WEB_PORT", "8000"))
    CORS_ALLOWED_ORIGINS = os.getenv("CORS_ALLOWED_ORIGINS", "*")

    # Target framerate of the annotated MJPEG stream served to the
    # browser at GET /api/vision/mjpeg (the camera itself still captures
    # at CAM_FRAMERATE; this just throttles how often an encoded JPEG is
    # pushed out over HTTP, which is the real cost for a remote browser
    # tab, not the local capture rate).
    STREAM_FPS = float(os.getenv("STREAM_FPS", "12"))
    JPEG_QUALITY = int(os.getenv("JPEG_QUALITY", "80"))

    # How often (seconds) the /ws/vision WebSocket pushes an updated
    # {objects, people, log} snapshot to connected browser tabs.
    VISION_WS_INTERVAL = float(os.getenv("VISION_WS_INTERVAL", "0.7"))


class RobotState(Enum):
    IDLE = "IDLE"
    SCANNING = "SCANNING"
    PERSON_DETECTED = "PERSON_DETECTED"
    FACE_RECOGNIZED = "FACE_RECOGNIZED"
    PERSON_LOST = "PERSON_LOST"


# ══════════════════════════════════════════════════════════════════════
#  SHARED STATE — in-memory bridge between the face-recognition side and
#  the voice-interaction side, now that they live in separate modules
#  inside the same process. Face-rec writes current_user; voice writes
#  interaction state + transcript. Both sides only ever touch this
#  through the lock.
# ══════════════════════════════════════════════════════════════════════

class SharedState:
    def __init__(self):
        self._lock = threading.Lock()
        self.current_user = ""
        self.ui_state = "idle"
        self.ui_subtext = ""
        self.transcript = deque(maxlen=8)   # (role, text)

    def set_user(self, name: str):
        with self._lock:
            self.current_user = name or ""

    def get_user(self) -> str:
        with self._lock:
            return self.current_user

    def set_state(self, state: str, subtext: str = ""):
        with self._lock:
            self.ui_state = state if state in Config.UI_STATE_COLORS else "idle"
            self.ui_subtext = subtext

    def get_state(self) -> Tuple[str, str]:
        with self._lock:
            return self.ui_state, self.ui_subtext

    def add_message(self, role: str, text: str):
        with self._lock:
            self.transcript.append((role, text))

    def get_transcript(self) -> List[Tuple[str, str]]:
        with self._lock:
            return list(self.transcript)


# ══════════════════════════════════════════════════════════════════════
#  BRANDING / INTRO CONTENT — edit this block to change the welcome
#  screen + welcome speech. Nothing else in any file needs to change.
# ══════════════════════════════════════════════════════════════════════

ROBOT_NAME = "AURA"
ROBOT_TAGLINE = "AI POWERED HUMANOID ROBOT"
CREDIT_ORG_LINE1 = "DEVELOPED BY FIRE_BRAND_AI X (COLLABORATION) AURA TEAM"
CREDIT_ORG_LINE2 = "GUIDED BY DR. JEEVITHA RAVINDRA AND RAJANI RAI"
TEAM_FIRE_BRAND_AI = ["Shankarprasad KS", "Vignesh Rao", "Rakshitha KN", "Sowjanya"]
TEAM_AURA = ["Prekshan R Rai", "Rakshith K", "Ashwanth"]
THANKS_LINE = "Thanks for the opportunity."
COLLEGE_PROMPT = "Explore Our College"
COLLEGE_LINK = "https://vcetputtur.ac.in/"

WELCOME_SPEECH = (
    f"Hello, I am {ROBOT_NAME}, an {ROBOT_TAGLINE.lower()}. "
    f"I was developed by Fire Brand AI, in collaboration with the Aura team, "
    f"guided by Doctor Jeevitha Ravindra and Rajani Rai. "
    f"The Fire Brand AI team is Shankarprasad K S, Vignesh Rao, Rakshitha K N, and Sowjanya. "
    f"The Aura team is Prekshan R Rai, Rakshith K, and Ashwanth. "
    f"Thanks for the opportunity. "
    f"You can explore our college at vcetputtur dot a c dot i n."
)

INTRODUCTION_SPEECH = (
    f"Hello! I am {ROBOT_NAME}, an AI powered humanoid robot. "
    f"I was proudly developed by Fire Brand AI, in collaboration with the Aura team, "
    f"guided by Doctor Jeevitha Ravindra and Rajani Rai. "
    f"The Fire Brand AI team is Shankarprasad K S, Vignesh Rao, Rakshitha K N, and Sowjanya. "
    f"The Aura team is Prekshan R Rai, Rakshith K, and Ashwanth. "
    f"Together, we are shaping the future of intelligent robotics through innovation, "
    f"collaboration, and technology. "
    f"Thank you for giving us this opportunity to showcase our vision. "
    f"Welcome to the future with {ROBOT_NAME}."
)

INTRODUCTION_TRANSCRIPT_TEXT = (
    f"Hello! I am {ROBOT_NAME}, an AI-Powered Humanoid Robot, developed by "
    f"Fire Brand AI in collaboration with the Aura team, guided by Dr. Jeevitha "
    f"Ravindra and Rajani Rai. Thank you for this opportunity — welcome to the "
    f"future with {ROBOT_NAME}."
)

KANNADA_INTRODUCTION_SPEECH = (
    "ನಮಸ್ಕಾರ! ನಾನು ಔರಾ, ಒಂದು ಕೃತಕ ಬುದ್ಧಿಮತ್ತೆಯಿಂದ ಚಾಲಿತವಾದ ಮಾನವಾಕಾರದ ರೋಬೋಟ್. "
    "ನನ್ನನ್ನು ಫೈರ್ ಬ್ರ್ಯಾಂಡ್ ಎ ಐ ತಂಡ ಮತ್ತು ಔರಾ ತಂಡದ ಸಹಯೋಗದೊಂದಿಗೆ ಅಭಿವೃದ್ಧಿಪಡಿಸಲಾಗಿದೆ. "
    "ಡಾಕ್ಟರ್ ಜೀವಿತಾ ರವೀಂದ್ರ ಮತ್ತು ರಜನಿ ರೈ ಅವರ ಮಾರ್ಗದರ್ಶನದಲ್ಲಿ ಈ ಕೆಲಸ ನಡೆದಿದೆ. "
    "ಫೈರ್ ಬ್ರ್ಯಾಂಡ್ ಎ ಐ ತಂಡದಲ್ಲಿ ಶಂಕರಪ್ರಸಾದ್ ಕೆ ಎಸ್, ವಿಘ್ನೇಶ್ ರಾವ್, ರಕ್ಷಿತಾ ಕೆ ಎನ್, "
    "ಮತ್ತು ಸೌಜನ್ಯ ಇದ್ದಾರೆ. "
    "ಔರಾ ತಂಡದಲ್ಲಿ ಪ್ರೇಕ್ಷನ್ ಆರ್ ರೈ, ರಕ್ಷಿತ್ ಕೆ, ಮತ್ತು ಅಶ್ವಂತ್ ಇದ್ದಾರೆ. "
    "ಈ ಅವಕಾಶವನ್ನು ನೀಡಿದ್ದಕ್ಕಾಗಿ ಧನ್ಯವಾದಗಳು. "
    "ಔರಾ ಜೊತೆಗೆ ಭವಿಷ್ಯಕ್ಕೆ ಸ್ವಾಗತ."
)

KANNADA_INTRODUCTION_TRANSCRIPT_TEXT = (
    "ನಮಸ್ಕಾರ! ನಾನು ಔರಾ, ಒಂದು AI ಚಾಲಿತ ಮಾನವಾಕಾರದ ರೋಬೋಟ್. ಫೈರ್ ಬ್ರ್ಯಾಂಡ್ AI ಮತ್ತು "
    "ಔರಾ ತಂಡದಿಂದ ಅಭಿವೃದ್ಧಿ, ಡಾ. ಜೀವಿತಾ ರವೀಂದ್ರ ಮತ್ತು ರಜನಿ ರೈ ಅವರ ಮಾರ್ಗದರ್ಶನದಲ್ಲಿ. "
    "ಈ ಅವಕಾಶಕ್ಕೆ ಧನ್ಯವಾದಗಳು — ಔರಾ ಜೊತೆಗೆ ಭವಿಷ್ಯಕ್ಕೆ ಸ್ವಾಗತ."
)

COLLEGE_INFO_SPEECH = (
    "Let me tell you about Vivekananda Vidyavardhaka Sangha, and Vivekananda "
    "College of Engineering and Technology, located in Puttur, in the "
    "Dakshina Kannada district of Karnataka. "
    "These institutions were established with the vision of providing "
    "quality technical and value based education to rural students. "
    "Here are the key details. "
    "Establishment and background. "
    "Vivekananda Vidyavardhaka Sangha, formerly known as Puttur Education "
    "Society, was established way back in nineteen fifteen. "
    "Under this prestigious society, Vivekananda College of Engineering "
    "and Technology, or V C E T, was started in two thousand and one. "
    "This institution functions successfully under the governance of "
    "Vivekananda Vidyavardhaka Sangha, Puttur. "
    "Inspired by the ideals of Swami Vivekananda, the main goal is to "
    "provide value based education, along with global standard technical "
    "learning, to rural and economically backward students. "
    "Accreditation and affiliation. "
    "The college is affiliated with Visvesvaraya Technological University, "
    "Belagavi. "
    "It is approved by the All India Council for Technical Education, New "
    "Delhi, and the Government of Karnataka. "
    "Milestones of college growth. "
    "When it started in two thousand and one, it introduced only Computer "
    "Science, and Electronics and Communication engineering courses. "
    "Currently, the college offers several undergraduate courses, "
    "including Mechanical, Civil, and Artificial Intelligence and Machine "
    "Learning. Along with this, postgraduate courses like M B A and M C A "
    "are also available. "
    "Surrounded by a lush green environment, the spacious campus features "
    "well equipped laboratories, a library, and smart classrooms. "
    "For more information, you can visit the official website at "
    "vcetputtur dot a c dot i n."
)

COLLEGE_INFO_TRANSCRIPT_TEXT = (
    "Vivekananda Vidyavardhaka Sangha (est. 1915) and Vivekananda College "
    "of Engineering and Technology (VCET, est. 2001), Puttur — affiliated "
    "to VTU Belagavi, approved by AICTE & Govt. of Karnataka. Offers CSE, "
    "ECE, Mechanical, Civil, AI & ML (UG) and MBA, MCA (PG). "
    "More: vcetputtur.ac.in"
)

KANNADA_COLLEGE_INFO_SPEECH = (
    "ವಿವೇಕಾನಂದ ವಿದ್ಯಾ ವರ್ಧಕ ಸಂಘ, ಮತ್ತು ವಿವೇಕಾನಂದ ಇಂಜಿನಿಯರಿಂಗ್ ಮತ್ತು ತಂತ್ರಜ್ಞಾನ ಕಾಲೇಜು, "
    "ಕರ್ನಾಟಕದ ದಕ್ಷಿಣ ಕನ್ನಡ ಜಿಲ್ಲೆಯ ಪುತ್ತೂರಿನಲ್ಲಿವೆ. "
    "ಗ್ರಾಮೀಣ ಭಾಗದ ವಿದ್ಯಾರ್ಥಿಗಳಿಗೆ ಗುಣಮಟ್ಟದ ತಾಂತ್ರಿಕ ಹಾಗೂ ಸಂಸ್ಕಾರಯುತ ಶಿಕ್ಷಣವನ್ನು ನೀಡುವ "
    "ಉದ್ದೇಶದಿಂದ ಈ ಸಂಸ್ಥೆಗಳನ್ನು ಸ್ಥಾಪಿಸಲಾಯಿತು. "
    "ಇದರ ಸಂಪೂರ್ಣ ಇತಿಹಾಸ ಮತ್ತು ಪ್ರಮುಖ ವಿವರಗಳು ಈ ಕೆಳಗಿನಂತಿವೆ. "
    "ಸ್ಥಾಪನೆ ಮತ್ತು ಹಿನ್ನೆಲೆ. "
    "ವಿವೇಕಾನಂದ ವಿದ್ಯಾವರ್ಧಕ ಸಂಘವನ್ನು, ಹಳೆಯ ಹೆಸರು ಪುತ್ತೂರು ಎಜುಕೇಶನ್ ಸೊಸೈಟಿ, "
    "೧೯೧೫ ರಲ್ಲೇ ಸ್ಥಾಪಿಸಲಾಗಿತ್ತು. "
    "ಈ ಪ್ರತಿಷ್ಠಿತ ಸಂಘದ ಅಡಿಯಲ್ಲಿ ೨೦೦೧ ರಲ್ಲಿ ವಿವೇಕಾನಂದ ಇಂಜಿನಿಯರಿಂಗ್ ಕಾಲೇಜನ್ನು, "
    "ವಿ ಸಿ ಇ ಟಿ, ಪ್ರಾರಂಭಿಸಲಾಯಿತು. "
    "ಈ ಸಂಸ್ಥೆಯು ವಿವೇಕಾನಂದ ವಿದ್ಯಾವರ್ಧಕ ಸಂಘ ಪುತ್ತೂರು ಅಡಿಯಲ್ಲಿ ಅತ್ಯಂತ ಯಶಸ್ವಿಯಾಗಿ "
    "ಕಾರ್ಯನಿರ್ವಹಿಸುತ್ತಿದೆ. "
    "ಸ್ವಾಮಿ ವಿವೇಕಾನಂದರ ಉನ್ನತ ಆದರ್ಶಗಳೊಂದಿಗೆ, ಗ್ರಾಮೀಣ ಮತ್ತು ಆರ್ಥಿಕವಾಗಿ ಹಿಂದುಳಿದ "
    "ವಿದ್ಯಾರ್ಥಿಗಳಿಗೆ ನೈತಿಕ ಮೌಲ್ಯಗಳು ಹಾಗೂ ಜಾಗತಿಕ ಮಟ್ಟದ ತಾಂತ್ರಿಕ ಶಿಕ್ಷಣ ನೀಡುವುದು "
    "ಇದರ ಮುಖ್ಯ ಗುರಿಯಾಗಿದೆ. "
    "ಮಾನ್ಯತೆ ಮತ್ತು ಸಂಯೋಜನೆ. "
    "ಈ ಕಾಲೇಜು ಬೆಳಗಾವಿಯ ವಿಶ್ವೇಶ್ವರಯ್ಯ ತಾಂತ್ರಿಕ ವಿಶ್ವವಿದ್ಯಾಲಯ, ವಿ ಟಿ ಯು, "
    "ದೊಂದಿಗೆ ಸಂಯೋಜನೆಗೊಂಡಿದೆ. "
    "ಇದು ನವದೆಹಲಿಯ ಅಖಿಲ ಭಾರತ ತಾಂತ್ರಿಕ ಶಿಕ್ಷಣ ಪರಿಷತ್, ಎ ಐ ಸಿ ಟಿ ಇ, ಮತ್ತು "
    "ಕರ್ನಾಟಕ ಸರ್ಕಾರದಿಂದ ಅನುಮೋದನೆ ಪಡೆದಿದೆ. "
    "ಕಾಲೇಜಿನ ಬೆಳವಣಿಗೆಯ ಹಂತಗಳು. "
    "೨೦೦೧ ರಲ್ಲಿ ಆರಂಭವಾದಾಗ ಕೇವಲ ಕಂಪ್ಯೂಟರ್ ಸೈನ್ಸ್, ಮತ್ತು ಎಲೆಕ್ಟ್ರಾನಿಕ್ಸ್ ಆ್ಯಂಡ್ "
    "ಕಮ್ಯುನಿಕೇಶನ್ ಇಂಜಿನಿಯರಿಂಗ್ ಕೋರ್ಸ್‌ಗಳನ್ನು ಮಾತ್ರ ಪರಿಚಯಿಸಲಾಯಿತು. "
    "ಪ್ರಸ್ತುತ ಕಾಲೇಜು ಮೆಕ್ಯಾನಿಕಲ್, ಸಿವಿಲ್, ಆರ್ಟಿಫಿಶಿಯಲ್ ಇಂಟೆಲಿಜೆನ್ಸ್ ಆ್ಯಂಡ್ "
    "ಮೆಷಿನ್ ಲರ್ನಿಂಗ್ ಸೇರಿದಂತೆ ಹಲವು ಪದವಿ ಕೋರ್ಸ್‌ಗಳನ್ನು ಒದಗಿಸುತ್ತಿದೆ. "
    "ಇದರೊಂದಿಗೆ ಎಂ ಬಿ ಎ ಮತ್ತು ಎಂ ಸಿ ಎ ನಂತಹ ಸ್ನಾತಕೋತ್ತರ ಕೋರ್ಸ್‌ಗಳೂ ಇಲ್ಲಿ "
    "ಲಭ್ಯವಿವೆ. "
    "ಹಸಿರು ಪರಿಸರದಿಂದ ಆವೃತವಾಗಿರುವ ಈ ವಿಶಾಲವಾದ ಕ್ಯಾಂಪಸ್, ಸುಸಜ್ಜಿತ ಪ್ರಯೋಗಾಲಯಗಳು, "
    "ಗ್ರಂಥಾಲಯ ಹಾಗೂ ಸುಧಾರಿತ ತರಗತಿ ಕೊಠಡಿಗಳನ್ನು ಹೊಂದಿದೆ. "
    "ಹೆಚ್ಚಿನ ಮಾಹಿತಿಗಾಗಿ ನೀವು ಕಾಲೇಜಿನ ಅಧಿಕೃತ ಜಾಲತಾಣಕ್ಕೆ ಭೇಟಿ ನೀಡಬಹುದು, "
    "vcetputtur dot a c dot i n."
)

KANNADA_COLLEGE_INFO_TRANSCRIPT_TEXT = (
    "ವಿವೇಕಾನಂದ ವಿದ್ಯಾ ವರ್ಧಕ ಸಂಘ (೧೯೧೫) ಮತ್ತು ವಿವೇಕಾನಂದ ಇಂಜಿನಿಯರಿಂಗ್ ಕಾಲೇಜು "
    "(VCET, ೨೦೦೧), ಪುತ್ತೂರು — VTU ಬೆಳಗಾವಿಗೆ ಸಂಯೋಜಿತ, AICTE ಮತ್ತು ಕರ್ನಾಟಕ ಸರ್ಕಾರದ "
    "ಅನುಮೋದನೆ. CSE, ECE, Mechanical, Civil, AI & ML (UG) ಮತ್ತು MBA, MCA (PG) "
    "ಲಭ್ಯ. ಹೆಚ್ಚಿನ ಮಾಹಿತಿಗೆ: vcetputtur.ac.in"
)


# ══════════════════════════════════════════════════════════════════════
#  DRAWING HELPERS — used by both the face panel (vivek_face.py callers)
#  and the interaction panel (vivek_interaction.py callers), and by
#  vivek_main.py for the branding panel.
# ══════════════════════════════════════════════════════════════════════

def _draw_label(frame, text, org, fg_color, bg_alpha=0.55, scale=0.55,
                 thickness=1, font=cv2.FONT_HERSHEY_DUPLEX):
    (tw, th), baseline = cv2.getTextSize(text, font, scale, thickness)
    x, y = org
    pad = 4
    x1, y1 = max(x - pad, 0), max(y - th - pad, 0)
    x2, y2 = x + tw + pad, y + baseline + pad
    overlay = frame[y1:y2, x1:x2]
    if overlay.size > 0:
        shaded = np.zeros_like(overlay)
        cv2.addWeighted(shaded, bg_alpha, overlay, 1 - bg_alpha, 0, overlay)
    cv2.putText(frame, text, (x, y), font, scale, fg_color, thickness, cv2.LINE_AA)


def _rounded_rect(img, pt1, pt2, radius, color, thickness=-1):
    x1, y1 = pt1
    x2, y2 = pt2
    if x2 <= x1 or y2 <= y1:
        return
    r = max(0, min(radius, (x2 - x1) // 2, (y2 - y1) // 2))
    if thickness < 0:
        cv2.rectangle(img, (x1 + r, y1), (x2 - r, y2), color, -1, cv2.LINE_AA)
        cv2.rectangle(img, (x1, y1 + r), (x2, y2 - r), color, -1, cv2.LINE_AA)
        for cx, cy in ((x1 + r, y1 + r), (x2 - r, y1 + r), (x1 + r, y2 - r), (x2 - r, y2 - r)):
            cv2.circle(img, (cx, cy), r, color, -1, cv2.LINE_AA)
    else:
        cv2.rectangle(img, pt1, pt2, color, thickness, cv2.LINE_AA)


def _corner_brackets(frame, x1, y1, x2, y2, color, seg=None, thickness=2):
    w, h = x2 - x1, y2 - y1
    if seg is None:
        seg = max(10, min(w, h) // 4)
    corners = [((x1, y1), (1, 0), (0, 1)), ((x2, y1), (-1, 0), (0, 1)),
               ((x1, y2), (1, 0), (0, -1)), ((x2, y2), (-1, 0), (0, -1))]
    for (cx, cy), (dx, _), (_, dy) in corners:
        cv2.line(frame, (cx, cy), (cx + dx * seg, cy), color, thickness, cv2.LINE_AA)
        cv2.line(frame, (cx, cy), (cx, cy + dy * seg), color, thickness, cv2.LINE_AA)


def _wrap_text(text, max_chars):
    words = text.split()
    lines, cur = [], ""
    for w in words:
        if len(cur) + len(w) + 1 <= max_chars:
            cur = (cur + " " + w).strip()
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines or [""]