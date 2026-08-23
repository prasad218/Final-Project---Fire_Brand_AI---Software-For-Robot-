"""
================================================================================
 AURA — VOICE / DYNAMIC INTERACTION MODULE
 Everything related to the RIGHT/orb side of the original integrated
 script: the always-listening voice listener (movement / introduction /
 college-info / general Q&A in English OR Kannada via a spoken language
 toggle), the drive-motor MovementController, and AURA's spoken output.
 No wake word is required -- see "wake word removed" below.

 AURA's brain (understanding + deciding what to say) and voice (speaking
 it) are the SAME single Gemini Live model now -- see aura_gemini.py.
 There is no other AI model and no other TTS engine anywhere in this
 file. Speech-TO-text (recognizing what someone said, so commands /
 canned phrases can be matched) is still the free, local
 SpeechRecognition + Google Web Speech endpoint -- that part is unrelated
 to "which AI model answers" and was left as-is. For general open-ended
 questions, that recognizer's text is used only to detect that it IS an
 open question and for the immediate on-screen transcript -- the actual
 captured AUDIO for the utterance is what gets sent to Gemini (see
 ask_and_speak in aura_gemini.py), not this recognizer's text.

 WAKE WORD REMOVED
 ----------------------------------------------------------------------
 VoiceListener._process used to require one of Config.WAKE_WORDS (e.g.
 "AURA, ...") somewhere in the recognized text before doing anything at
 all. That gate is gone -- every recognized utterance is now treated as
 a command/question directly, so people can just start talking to AURA
 without saying its name first. Config.WAKE_WORDS/_strip_wake_words are
 still used to strip a leading "AURA, " if someone says it out of habit,
 but it's no longer required. Config.SHUTDOWN_PHRASES is the one
 exception -- shutdown still requires saying "AURA" first, on purpose,
 so it can't be triggered by an unrelated nearby conversation. The
 obvious trade-off: AURA will now try to answer ANY speech its mic
 picks up (hallway chatter, a nearby conversation not meant for it,
 etc.) since there's no explicit "talking to me" signal anymore -- worth
 keeping an eye on both for odd responses and for Gemini API usage if
 that becomes a real cost concern.

 This module never imports from vivek_face.py. It only depends on
 vivek_common.py (Config, SharedState, branding/speech text, helpers),
 aura_gemini.py, and standard/third-party libraries. vivek_main.py wires
 this together with vivek_face.py.
================================================================================
"""

import re
import time
import queue
import threading
from typing import Optional, Tuple, List

from vivek_common import (
    Config, IS_LINUX, IS_WINDOWS, GPIO_AVAILABLE, SharedState,
    INTRODUCTION_SPEECH, INTRODUCTION_TRANSCRIPT_TEXT,
    KANNADA_INTRODUCTION_SPEECH, KANNADA_INTRODUCTION_TRANSCRIPT_TEXT,
    COLLEGE_INFO_SPEECH, COLLEGE_INFO_TRANSCRIPT_TEXT,
    KANNADA_COLLEGE_INFO_SPEECH, KANNADA_COLLEGE_INFO_TRANSCRIPT_TEXT,
)

# AURA's Gemini-backed brain + voice engine -- see aura_gemini.py for
# what ask_and_speak() vs speak_exact() are each used for.
from aura_gemini import AuraGeminiEngine

if IS_LINUX and GPIO_AVAILABLE:
    import Jetson.GPIO as GPIO

try:
    import speech_recognition as sr
    SR_AVAILABLE = True
except ImportError:
    SR_AVAILABLE = False
    print("[WARN] SpeechRecognition not installed -> voice commands disabled. "
          "pip install SpeechRecognition pyaudio")


def check_flac_available() -> bool:
    """SpeechRecognition needs a FLAC encoder for recognize_google().
    On Windows it ships its own bundled flac.exe and uses that
    automatically whenever a system 'flac' isn't found on PATH, so
    there's normally nothing to install here. On Linux, there's no
    bundled binary for every distro, so a missing system 'flac' is
    worth a real warning."""
    import shutil
    if IS_WINDOWS:
        return True
    if shutil.which("flac") is not None:
        return True
    print("=" * 60)
    print("[Voice] WARNING: the 'flac' command-line tool was not found.")
    print("[Voice] Voice recognition needs it. Fix: sudo apt-get install -y flac")
    print("=" * 60)
    return False


# ══════════════════════════════════════════════════════════════════════
#  SPEECH OUTPUT — a thin queue in front of AuraGeminiEngine.speak_exact.
#  Everything AURA says (introduction, college info, campus-location
#  answers, movement confirmations, the Kannada toggle, "yes, how can I
#  help you?") comes through here. General open-ended Q&A does NOT go
#  through this queue -- VoiceListener calls gemini.ask_and_speak()
#  directly instead, since that path needs the raw question audio, not
#  a text line (see _handle_utterance below).
# ══════════════════════════════════════════════════════════════════════

class SpeechEngine:
    def __init__(self, gemini: Optional[AuraGeminiEngine] = None, on_state_change=None):
        self.gemini = gemini
        self._q = queue.Queue(maxsize=12)
        self._busy = False
        self._busy_lock = threading.Lock()
        self._running = False
        self.on_state_change = on_state_change
        # "enabled" here means "the queue itself works" -- whether a line
        # actually gets SPOKEN depends on self.gemini.enabled at the
        # moment it's dequeued (checked in _worker), since that can only
        # be known once AuraGeminiEngine has finished connecting.
        self.enabled = True

    def start(self):
        if self._running:
            return
        self._running = True
        threading.Thread(target=self._worker, daemon=True).start()

    def _worker(self):
        while self._running:
            try:
                text, lang = self._q.get(timeout=0.2)
            except queue.Empty:
                continue
            if not self.gemini or not self.gemini.enabled:
                print(f"[Speech] Gemini voice unavailable -- AURA would have said: \"{text}\"")
                continue
            self._set_busy(True, text)
            try:
                ok = self.gemini.speak_exact(text, lang=lang)
                if not ok:
                    print(f"[Speech] Gemini didn't speak this line (see error above): \"{text}\"")
            except Exception as e:
                print(f"[Speech] error speaking via Gemini: {e}")
            finally:
                self._set_busy(False)

    def _set_busy(self, is_busy: bool, text: str = ""):
        with self._busy_lock:
            self._busy = is_busy
        if is_busy:
            print(f'[Speech] saying: "{text}"')
        if self.on_state_change:
            try:
                self.on_state_change(is_busy, text)
            except Exception:
                pass

    @property
    def busy(self) -> bool:
        with self._busy_lock:
            return self._busy

    def say(self, text: str, priority: bool = False, lang: str = "en") -> bool:
        if not text or not text.strip():
            return False
        if not priority and self.busy:
            return False
        try:
            self._q.put_nowait((text, lang))
            return True
        except queue.Full:
            return False

    def say_blocking(self, text: str, timeout: float = 25.0, lang: str = "en"):
        self.say(text, priority=True, lang=lang)
        start = time.time()
        while not self.busy and self._q.qsize() > 0 and time.time() - start < timeout:
            time.sleep(0.05)
        while self.busy and time.time() - start < timeout:
            time.sleep(0.1)

    def stop(self):
        self._running = False


# ══════════════════════════════════════════════════════════════════════
#  MOVEMENT — drive motors, triggered by voice commands
# ══════════════════════════════════════════════════════════════════════

class MovementController:
    def __init__(self):
        self.hw_ready = False
        self._lock = threading.Lock()
        self._auto_stop_timer: Optional[threading.Timer] = None
        if Config.ENABLE_GPIO and GPIO_AVAILABLE:
            try:
                GPIO.setmode(GPIO.BOARD)
                for pin in (Config.MOTOR_LEFT_FWD_PIN, Config.MOTOR_LEFT_BWD_PIN,
                            Config.MOTOR_RIGHT_FWD_PIN, Config.MOTOR_RIGHT_BWD_PIN):
                    GPIO.setup(pin, GPIO.OUT, initial=GPIO.LOW)
                self.hw_ready = True
                print("[Movement] GPIO motor control ready")
            except Exception as e:
                print(f"[Movement] GPIO init failed, movement simulated: {e}")
        else:
            print("[Movement] GPIO not enabled — movement will be simulated")

    def _set_pins(self, lf, lb, rf, rb):
        if not self.hw_ready:
            return
        try:
            GPIO.output(Config.MOTOR_LEFT_FWD_PIN, GPIO.HIGH if lf else GPIO.LOW)
            GPIO.output(Config.MOTOR_LEFT_BWD_PIN, GPIO.HIGH if lb else GPIO.LOW)
            GPIO.output(Config.MOTOR_RIGHT_FWD_PIN, GPIO.HIGH if rf else GPIO.LOW)
            GPIO.output(Config.MOTOR_RIGHT_BWD_PIN, GPIO.HIGH if rb else GPIO.LOW)
        except Exception as e:
            print(f"[Movement] GPIO write error: {e}")

    def move(self, direction: str):
        direction = direction.lower()
        print(f"[Movement] -> {direction.upper()}" + ("" if self.hw_ready else "  (simulated)"))
        table = {"forward": (True, False, True, False), "backward": (False, True, False, True),
                  "left": (False, True, True, False), "right": (True, False, False, True)}
        self._set_pins(*table.get(direction, (False, False, False, False)))
        if self._auto_stop_timer:
            self._auto_stop_timer.cancel()
        if direction in table:
            self._auto_stop_timer = threading.Timer(Config.MOVE_AUTO_STOP_SEC, self.move, args=("stop",))
            self._auto_stop_timer.daemon = True
            self._auto_stop_timer.start()

    def cleanup(self):
        if self._auto_stop_timer:
            self._auto_stop_timer.cancel()
        if self.hw_ready:
            try:
                self._set_pins(False, False, False, False)
            except Exception:
                pass


# ══════════════════════════════════════════════════════════════════════
#  VOICE LISTENER — always-listening (no wake word) + movement + Q&A.
#  Writes to SharedState.
#
#  RELIABILITY NOTES (read this if commands keep getting cut off):
#  - `pause_threshold` is how much silence marks the END of an
#    utterance. Too short (< ~0.8s) and a normal in-sentence breath
#    gets treated as "they're done talking", chopping the sentence.
#  - `phrase_time_limit` is the hard cap on how long one utterance can
#    run. Too short and long questions get truncated mid-word.
#  - Both are now clamped to sane minimums below, regardless of what's
#    in .env, so a too-aggressive Config value can't cause truncation.
#  - Ambient noise is recalibrated periodically so the energy threshold
#    doesn't drift and start clipping the start/end of speech over a
#    long running session.
#  - Google STT calls are retried once on transient network errors
#    instead of silently dropping the utterance.
# ══════════════════════════════════════════════════════════════════════

# Minimum silence (seconds) required before an utterance is considered
# finished. The code above this constant already documents 0.8s as the
# practical floor before a normal in-sentence breath starts getting
# mistaken for "done talking" -- this sets the floor there (down from an
# earlier, more conservative 1.0s) since that whole second is dead time
# AURA spends waiting before it even sends anything to Gemini. Raise
# this back toward 1.0-1.2s if sentences start getting cut short.
MIN_PAUSE_THRESHOLD = 0.8

# Minimum time (seconds) a single utterance is allowed to run before
# being force-cut. Raise this if longer questions get truncated.
MIN_PHRASE_TIME_LIMIT = 12

# How often (seconds) to re-run ambient noise calibration while idle.
RECALIBRATE_INTERVAL_SEC = 300

# How many times to retry a Google STT call on transient network errors.
STT_RETRY_ATTEMPTS = 2


class VoiceListener:
    def __init__(self, speech: SpeechEngine, gesture, movement: MovementController,
                 shared: SharedState, gemini: AuraGeminiEngine, shutdown_cb=None):
        self.speech = speech
        self.gesture = gesture
        self.movement = movement
        self.shared = shared
        # AURA's Gemini brain + voice engine -- see aura_gemini.py. This is
        # the ONLY AI model / TTS in the whole app now. If it's disabled
        # (no key / package / USE_GEMINI_VOICE=false), AURA can still hear
        # speech and match commands, but cannot speak or answer anything --
        # see the loud warning vivek_main.py prints at startup for this.
        self.gemini = gemini
        self.shutdown_cb = shutdown_cb
        self.enabled = SR_AVAILABLE
        self.listening = False
        self.in_conversation = False
        self.last_interaction = 0.0
        self._last_calibration = 0.0
        # Conversation language mode for general (non-canned) Q&A — "en" or
        # "kn". Toggled by saying "AURA, speak Kannada" / "speak English".
        # See KANNADA_MODE_ON_PHRASES / OFF_PHRASES in vivek_common.py.
        self.conversation_lang = "en"

        if self.enabled:
            self.recognizer = sr.Recognizer()
            self.recognizer.energy_threshold = Config.MIC_ENERGY_THRESHOLD
            self.recognizer.dynamic_energy_threshold = Config.MIC_DYNAMIC_ENERGY
            # Reliability: enforce sane minimums so mid-sentence pauses
            # don't truncate what the user is saying. A pause_threshold
            # that's too short is the #1 cause of "it only caught half
            # my sentence".
            self.recognizer.pause_threshold = max(Config.MIC_PAUSE_THRESHOLD, MIN_PAUSE_THRESHOLD)
            self.recognizer.non_speaking_duration = min(
                max(Config.MIC_NON_SPEAKING_DURATION, 0.5), self.recognizer.pause_threshold)
            # Give people real room to ask a full question instead of
            # getting force-cut partway through.
            self._phrase_time_limit = max(Config.MIC_PHRASE_TIMEOUT, MIN_PHRASE_TIME_LIMIT)
            print(f"[Voice] recognizer tuned: pause_threshold={self.recognizer.pause_threshold}s "
                  f"non_speaking_duration={self.recognizer.non_speaking_duration}s "
                  f"phrase_time_limit={self._phrase_time_limit}s")
            check_flac_available()
        else:
            print("[Voice] disabled (SpeechRecognition/pyaudio not installed)")

    def start(self):
        if not self.enabled:
            return
        self.listening = True
        threading.Thread(target=self._listen_loop, daemon=True).start()

    def stop(self):
        self.listening = False

    def _recognize_with_retry(self, audio, language: str, attempts: int = STT_RETRY_ATTEMPTS) -> str:
        """recognize_google, retried on transient network errors so a
        flaky connection doesn't just silently eat the utterance."""
        last_err = None
        for attempt in range(attempts):
            try:
                return self.recognizer.recognize_google(audio, language=language)
            except sr.UnknownValueError:
                raise
            except sr.RequestError as e:
                last_err = e
                if attempt < attempts - 1:
                    print(f"[Voice] speech API request failed (attempt {attempt + 1}/{attempts}), retrying: {e}")
                    time.sleep(0.4)
        raise last_err

    def _listen_loop(self):
        try:
            mic_kwargs = {}
            if Config.MIC_DEVICE_INDEX is not None:
                mic_kwargs["device_index"] = Config.MIC_DEVICE_INDEX
            with sr.Microphone(**mic_kwargs) as source:
                print("[Voice] calibrating microphone for ambient noise...")
                self.recognizer.adjust_for_ambient_noise(source, duration=1.5)
                self._last_calibration = time.time()
                print(f"[Voice] listening (energy threshold={self.recognizer.energy_threshold:.0f}, "
                      f"pause_threshold={self.recognizer.pause_threshold}, "
                      f"non_speaking_duration={self.recognizer.non_speaking_duration}, "
                      f"stt_language={Config.STT_LANGUAGE})")
                was_busy = False
                while self.listening:
                    if self.in_conversation and \
                            time.time() - self.last_interaction > Config.CONVERSATION_TIMEOUT:
                        self.in_conversation = False
                        self.gemini.reset()
                        self.shared.set_state("idle")
                        print("[Voice] conversation timed out")

                    if self.speech.busy:
                        was_busy = True
                        time.sleep(0.05)
                        continue
                    if was_busy:
                        time.sleep(0.6)
                        was_busy = False
                        self.shared.set_state("listening" if self.in_conversation else "idle")

                    if self.recognizer.energy_threshold > Config.MIC_ENERGY_THRESHOLD * 6:
                        self.recognizer.energy_threshold = Config.MIC_ENERGY_THRESHOLD

                    # Periodically re-calibrate ambient noise so the energy
                    # threshold doesn't drift over a long running session
                    # and start clipping the start/end of what people say.
                    if not self.speech.busy and \
                            time.time() - self._last_calibration > RECALIBRATE_INTERVAL_SEC:
                        try:
                            self.recognizer.adjust_for_ambient_noise(source, duration=0.5)
                            print(f"[Voice] re-calibrated ambient noise "
                                  f"(energy_threshold={self.recognizer.energy_threshold:.0f})")
                        except Exception as e:
                            print(f"[Voice] ambient re-calibration failed, skipping: {e}")
                        self._last_calibration = time.time()

                    try:
                        audio = self.recognizer.listen(source, timeout=1,
                                                         phrase_time_limit=self._phrase_time_limit)
                    except sr.WaitTimeoutError:
                        continue

                    try:
                        text = self._recognize_with_retry(audio, Config.STT_LANGUAGE).lower()
                    except sr.UnknownValueError:
                        continue
                    except sr.RequestError as e:
                        print(f"[Voice] recognition API error (after retries): {e}")
                        self.shared.set_state("error", "Network / speech API error")
                        time.sleep(1)
                        continue
                    except Exception as e:
                        msg = str(e)
                        if "flac" in msg.lower():
                            print(f"[Voice] recognition failed (missing 'flac' binary): {msg}")
                        else:
                            print(f"[Voice] recognition failed, skipping this utterance: {msg}")
                        self.shared.set_state("error", "Recognition error")
                        time.sleep(0.5)
                        continue

                    print(f"[Voice] heard: '{text}'")
                    self._process(text, audio)
        except OSError as e:
            print(f"[Voice] could not open microphone: {e}")
            print("[Voice] run `python3 vivek_main.py --list-mics` and set "
                  "MIC_DEVICE_INDEX in your .env to the right index.")
            self.shared.set_state("error", "Microphone unavailable")
            self.enabled = False
        except Exception as e:
            print(f"[Voice] listener crashed, voice commands disabled: {e}")
            self.shared.set_state("error", "Microphone unavailable")
            self.enabled = False

    def _match_movement(self, text: str) -> Optional[str]:
        for direction, phrases in Config.MOVE_COMMANDS.items():
            for phrase in phrases:
                if re.search(rf"\b{re.escape(phrase)}\b", text):
                    return direction
        return None

    def _match_phrase_list(self, text: str, phrases: List[str]) -> bool:
        for phrase in phrases:
            if re.search(rf"\b{re.escape(phrase)}\b", text):
                return True
        return False

    def _is_introduction_request(self, text: str) -> bool:
        return self._match_phrase_list(text, Config.INTRODUCTION_PHRASES)

    def _is_college_info_request(self, text: str) -> bool:
        return self._match_phrase_list(text, Config.COLLEGE_INFO_PHRASES)

    def _match_location_qa(self, text: str) -> Optional[str]:
        """Check `text` against Config.LOCATION_QA (checked in list order,
        so more specific phrase groups defined earlier win over more
        general ones -- see the ordering note in vivek_common.py). Returns
        the canned answer string, or None if nothing matched."""
        for entry in Config.LOCATION_QA:
            if self._match_phrase_list(text, entry["phrases"]):
                return entry["answer"]
        return None

    def _get_kannada_transcript(self, audio) -> Optional[str]:
        if audio is None:
            return None
        try:
            return self.recognizer.recognize_google(audio, language="kn-IN")
        except Exception:
            return None

    def _detect_special_request(self, text: str, audio=None) -> Tuple[Optional[str], str]:
        if self._match_phrase_list(text, Config.INTRODUCTION_PHRASES):
            return "intro", "en"
        if self._match_phrase_list(text, Config.COLLEGE_INFO_PHRASES):
            return "college", "en"
        if self._match_phrase_list(text, Config.KANNADA_INTRODUCTION_PHRASES):
            return "intro", "kn"
        if self._match_phrase_list(text, Config.KANNADA_COLLEGE_INFO_PHRASES):
            return "college", "kn"

        if Config.ENABLE_KANNADA_STT:
            kn_text = self._get_kannada_transcript(audio)
            if kn_text:
                if self._match_phrase_list(kn_text, Config.KANNADA_INTRODUCTION_PHRASES_SCRIPT):
                    return "intro", "kn"
                if self._match_phrase_list(kn_text, Config.KANNADA_COLLEGE_INFO_PHRASES_SCRIPT):
                    return "college", "kn"

        return None, "en"

    def _strip_wake_words(self, text: str) -> str:
        stripped = text
        for w in Config.WAKE_WORDS:
            stripped = re.sub(rf"\b{re.escape(w)}\b", " ", stripped)
        stripped = re.sub(r"\b(hey|hi|hello|okay)\b", " ", stripped)
        return re.sub(r"\s+", " ", stripped).strip(" ,.")

    def _process(self, text: str, audio=None):
        # Shutdown still requires saying "AURA" first (see
        # Config.SHUTDOWN_PHRASES, e.g. "aura shutdown") even though
        # nothing else below does anymore -- on purpose, so an unrelated
        # nearby conversation can't accidentally power the robot off.
        for phrase in Config.SHUTDOWN_PHRASES:
            if phrase in text:
                if self.shutdown_cb:
                    self.shutdown_cb()
                return

        # No wake word required anymore -- every recognized utterance
        # (that isn't a shutdown phrase) is treated as a command/question
        # directly. Config.WAKE_WORDS is still used below, in
        # _strip_wake_words, purely so that "AURA, ..." still works
        # exactly as before for anyone who keeps saying it out of habit
        # -- it's just no longer REQUIRED.
        if not text or not text.strip():
            return

        self.last_interaction = time.time()
        self.in_conversation = True
        self.shared.set_state("listening")

        remainder = self._strip_wake_words(text)
        if remainder:
            self._handle_utterance(remainder, audio)
        else:
            user = self.shared.get_user()
            reply = "Yes, how can I help you?"
            if user and user != "Unknown":
                reply = f"Yes {user.split('_')[0].title()}, how can I help you?"
            self.speech.say(reply, priority=True)

    def _handle_introduction(self, lang: str = "en"):
        if lang == "kn":
            transcript_text = KANNADA_INTRODUCTION_TRANSCRIPT_TEXT
            speech_text = KANNADA_INTRODUCTION_SPEECH
            print("[Voice] introduction request detected (Kannada) — speaking in Kannada")
        else:
            transcript_text = INTRODUCTION_TRANSCRIPT_TEXT
            speech_text = INTRODUCTION_SPEECH
            print("[Voice] introduction request detected (English) — speaking introduction")
        self.shared.add_message("aura", transcript_text)
        self.shared.set_state("speaking")
        self.speech.say(speech_text, priority=True, lang=lang)

    def _handle_college_info(self, lang: str = "en"):
        if lang == "kn":
            transcript_text = KANNADA_COLLEGE_INFO_TRANSCRIPT_TEXT
            speech_text = KANNADA_COLLEGE_INFO_SPEECH
            print("[Voice] college-info request detected (Kannada) — speaking in Kannada")
        else:
            transcript_text = COLLEGE_INFO_TRANSCRIPT_TEXT
            speech_text = COLLEGE_INFO_SPEECH
        self.shared.add_message("aura", transcript_text)
        self.shared.set_state("speaking")
        self.speech.say(speech_text, priority=True, lang=lang)

    def _handle_location_answer(self, answer: str):
        """Speak a canned campus-location answer (see Config.LOCATION_QA).
        The WORDING is always exactly what was configured -- matched by
        free local text search, no AI guessing involved -- only the
        VOICE reading it aloud comes from Gemini (see
        AuraGeminiEngine.speak_exact)."""
        print(f"[Voice] campus-location question matched — answering directly: \"{answer}\"")
        self.shared.add_message("aura", answer)
        self.shared.set_state("speaking")
        self.speech.say(answer, priority=True, lang="en")

    def _handle_language_toggle(self, text: str) -> bool:
        """Detect a spoken 'switch to Kannada/English' command. Returns
        True (and speaks a confirmation) if the utterance was a toggle,
        so the caller can stop processing it as a normal question."""
        if self._match_phrase_list(text, Config.KANNADA_MODE_ON_PHRASES):
            self.conversation_lang = "kn"
            self.shared.add_message("aura", Config.KANNADA_MODE_ON_REPLY)
            self.shared.set_state("speaking")
            self.speech.say(Config.KANNADA_MODE_ON_REPLY, priority=True, lang="kn")
            print("[Voice] conversation language switched to Kannada")
            return True
        if self._match_phrase_list(text, Config.KANNADA_MODE_OFF_PHRASES):
            self.conversation_lang = "en"
            self.shared.add_message("aura", Config.KANNADA_MODE_OFF_REPLY)
            self.shared.set_state("speaking")
            self.speech.say(Config.KANNADA_MODE_OFF_REPLY, priority=True)
            print("[Voice] conversation language switched to English")
            return True
        return False

    def _handle_utterance(self, text: str, audio=None):
        kind, lang = self._detect_special_request(text, audio)
        if kind == "intro":
            self.shared.add_message("user", text)
            self._handle_introduction(lang)
            return
        if kind == "college":
            self.shared.add_message("user", text)
            self._handle_college_info(lang)
            return

        location_answer = self._match_location_qa(text)
        if location_answer:
            self.shared.add_message("user", text)
            self._handle_location_answer(location_answer)
            return

        if self._handle_language_toggle(text):
            return

        direction = self._match_movement(text)
        if direction:
            self.shared.add_message("user", text)
            self.movement.move(direction)
            confirm = {"forward": "Moving forward.", "backward": "Moving backward.",
                       "left": "Turning left.", "right": "Turning right.",
                       "stop": "Stopping."}[direction]
            self.shared.set_state("speaking")
            self.shared.add_message("aura", confirm)
            self.speech.say(confirm, priority=True)
            return

        # General open-ended Q&A -- brain AND voice both come from
        # Gemini (see aura_gemini.py, ask_and_speak). In Kannada mode,
        # re-recognize the SAME audio with kn-IN STT just so a readable
        # Kannada line can be shown in the on-screen transcript ("You:
        # ...") -- Gemini itself is given the raw audio either way, not
        # this transcript, so it hears the actual words regardless of
        # what the free local recognizer made of them.
        ask_text = text
        ask_lang = "en"
        if self.conversation_lang == "kn":
            kn_text = self._get_kannada_transcript(audio)
            if kn_text and kn_text.strip():
                ask_text = kn_text.strip()
                ask_lang = "kn"
            else:
                self.shared.add_message("user", text)
                msg = "ಕ್ಷಮಿಸಿ, ದಯವಿಟ್ಟು ಮತ್ತೊಮ್ಮೆ ಹೇಳಿ."  # "Sorry, please say that again."
                self.shared.add_message("aura", msg)
                self.shared.set_state("speaking")
                self.speech.say(msg, priority=True, lang="kn")
                return

        self.shared.add_message("user", ask_text)
        self.shared.set_state("thinking")

        reply_text = None
        if self.gemini.enabled and audio is not None:
            try:
                pcm16k = audio.get_raw_data(convert_rate=Config.GEMINI_INPUT_RATE, convert_width=2)
            except Exception as e:
                print(f"[Voice] couldn't convert captured audio for Gemini: {e}")
                pcm16k = None
            if pcm16k:
                reply_text = self.gemini.ask_and_speak(pcm16k, lang=ask_lang, user_name=self.shared.get_user())

        if reply_text:
            self.shared.add_message("aura", reply_text)
            self.shared.set_state("listening" if self.in_conversation else "idle")
            return

        # Gemini is disabled or the call failed. There is no other AI
        # model or TTS engine configured in this build (see the top of
        # this file) -- say so out loud via speak_exact instead of
        # staying silent. If Gemini is FULLY unreachable this will also
        # fail to speak, in which case it's just logged to the console
        # by SpeechEngine._worker -- see the startup warning in
        # vivek_main.py for how to fix that.
        apology = ("ಕ್ಷಮಿಸಿ, ನನ್ನ AI ಮತ್ತು ಧ್ವನಿ ವ್ಯವಸ್ಥೆ ಈಗ ಲಭ್ಯವಿಲ್ಲ."
                   if ask_lang == "kn" else
                   "Sorry, my AI and voice module isn't available right now.")
        self.shared.add_message("aura", apology)
        self.shared.set_state("speaking")
        self.speech.say(apology, priority=True, lang=ask_lang)


def list_microphones():
    if not SR_AVAILABLE:
        print("SpeechRecognition/pyaudio not installed — cannot list microphones.")
        return
    print("Available microphones (use the index as MIC_DEVICE_INDEX in .env):")
    for i, name in enumerate(sr.Microphone.list_microphone_names()):
        print(f"  [{i}] {name}")


def test_gemini_voice(lang: str = "en"):
    """Quick standalone check that AURA's ONLY voice (Gemini) actually
    works end to end on this machine: connects, speaks one test line
    through speak_exact(), and exits. Run with
    `python3 vivek_main.py --test-gemini-voice` (or --test-gemini-kannada
    for the Kannada line)."""
    from vivek_common import SharedState
    from aura_gemini import AuraGeminiEngine
    shared = SharedState()
    engine = AuraGeminiEngine(shared)
    if not engine.enabled:
        print("Gemini voice module isn't enabled -- check GEMINI_API_KEY, "
              "USE_GEMINI_VOICE, and that 'google-genai' is installed "
              "(see the [Gemini] log lines above).")
        return
    text = ("ನಮಸ್ಕಾರ, ಇದು AURA ನ ಕನ್ನಡ ಧ್ವನಿಯ ಪರೀಕ್ಷೆ."
            if lang == "kn" else
            "Hello, this is a test of AURA's Gemini voice.")
    print(f"Speaking a test line through Gemini ({Config.GEMINI_MODEL}, "
          f"voice={Config.GEMINI_VOICE_NAME or 'default'})...")
    ok = engine.speak_exact(text, lang=lang)
    engine.close()
    if ok:
        print("Done. If you didn't hear anything, check Windows Sound settings "
              "(the correct playback device should be set as default) and that "
              "'sounddevice' is installed (pip install sounddevice).")
    else:
        print("Gemini didn't return any audio for this line -- see the error above.")
