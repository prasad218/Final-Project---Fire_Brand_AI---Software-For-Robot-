"""
================================================================================
 AURA — GEMINI LIVE ENGINE (one model does everything)

 AURA uses ONE Gemini model, Config.GEMINI_MODEL (a Live model,
 gemini-3.1-flash-live-preview by default), for EVERYTHING voice- and
 answer-related -- there is no separate text "brain" model anymore, and
 no other AI model or TTS engine anywhere in this app. This is
 deliberately audio-native and real-time: for open-ended questions, the
 user's actual question AUDIO is streamed straight to a Gemini Live
 session, which hears it, decides what to say, and streams back spoken
 audio, all in one connection -- no separate "transcribe, then think,
 then speak" round trip. This is used from two places in
 vivek_interaction.py:

   1. `ask_and_speak(pcm16_16k, lang, user_name)` -- general, open-ended
      Q&A. Streams the caller's raw captured question audio (already
      captured by the existing wake-word listener -- see
      vivek_interaction.py) into ONE Gemini Live session and plays
      whatever audio streams back, as it arrives. AURA's persona and the
      campus facts are given as the session's system instruction, so it
      answers in character and doesn't invent facts about the college.

   2. `speak_exact(text, lang)` -- everything else AURA says: the
      introduction, college info, campus-location answers, movement
      confirmations, the Kannada toggle confirmations. Sends the given
      TEXT (not audio) as one turn to a Live session with a strict
      "read this verbatim" system instruction (LIVE_TTS_SYSTEM_INSTRUCTION)
      instead of AURA's conversational persona, since these lines must
      keep their exact configured wording, not Gemini's paraphrase of
      them. A Live model is otherwise a conversational one, so it has to
      be told explicitly to just read the text instead of reacting to it.

 WHY ONE MODEL FOR EVERYTHING (again)
 ----------------------------------------------------------------------
 An earlier version of this file split "decide what to say" (a plain
 text model, gemini-2.5-flash) from "say it" (a Live model) as two
 separate network calls. That's gone now, by request, in favor of a
 single real-time Live session that hears the actual question audio and
 replies with streamed audio directly -- fewer round trips, and the Live
 model's own voice-activity detection + native audio understanding
 (accent, tone, a word the free local speech-to-text mangles) than
 handing it pre-transcribed text ever could. The trade-off: AURA's
 answers are only as controllable as a conversational audio model's
 system-instruction-following is -- see AURA_SYSTEM_PERSONA below for
 how that's constrained (short replies, no invented facts, no emojis/
 markdown since it's only ever heard, never read).

 WHAT LOCAL SPEECH-TO-TEXT IS STILL FOR
 ----------------------------------------------------------------------
 The existing voice listener (vivek_interaction.py) still runs every
 utterance through free, local speech-to-text (SpeechRecognition +
 Google's Web Speech endpoint) FIRST -- that's still how AURA detects
 movement commands, the canned intro/college/location phrases, and the
 Kannada toggle, and it's what's shown immediately on the on-screen
 "You: ..." transcript. No wake word is required anymore (see
 vivek_interaction.py) -- every recognized utterance is treated as a
 command/question directly. What changed here specifically is: once an
 utterance is identified as a general, open-ended question (not one of
 those canned matches), the ACTUAL CAPTURED AUDIO for that utterance --
 not the locally-recognized text -- is what gets sent to Gemini, so
 Gemini hears the real words regardless of what the free local
 recognizer made of them.

 NO FALLBACK
 ----------------------------------------------------------------------
 There is exactly one AI model and it does everything. If the Live call
 fails or times out for any reason (no key, package missing, network
 down, quota exhausted, the Live-preview model itself hiccups), AURA
 cannot speak OR answer that turn at all -- there's nothing else it
 falls back to. See the loud startup warning in vivek_main.py and the
 console fallback message in SpeechEngine._worker in vivek_interaction.py
 for how that shows up.

 AUDIO I/O -- WINDOWS PORT NOTE
 ----------------------------------------------------------------------
 - IN (ask_and_speak only): no new/second microphone stream. The caller
   passes the raw PCM bytes SpeechRecognition already captured for this
   utterance (`AudioData.get_raw_data(convert_rate=Config.GEMINI_INPUT_RATE,
   convert_width=2)`), streamed to Gemini in small chunks, followed by
   `audio_stream_end=True` so Gemini's own VAD finalizes the turn
   immediately instead of waiting on real-time silence.
 - OUT (both methods): the ORIGINAL Jetson/Linux build piped audio
   chunks into `aplay`, a command-line ALSA tool that doesn't exist on
   Windows at all -- that would have made AURA completely silent on a
   Windows PC (or worse, crash every time it tried to speak). This
   build replaces `_AplayStream` with `_AudioPlayer`, which uses the
   cross-platform `sounddevice` package (PortAudio underneath -- works
   on Windows/macOS/Linux the same way) and keeps ONE persistent output
   stream open for the whole app's lifetime instead of spawning a new
   process per line. That removes the process-spawn latency that used
   to happen before AURA's very first word of every single reply, which
   is the main thing that made the voice feel slow -- see _AudioPlayer
   below. Audio is still played AS IT ARRIVES, chunk by chunk, not
   after the whole reply has been generated.
 - Each call opens a fresh, short-lived Live session and closes it again
   once AURA finishes talking -- simpler and more crash-resistant than
   one long-lived session with reconnect/resume logic, at the cost of a
   small (well under a second, typically) extra connection handshake per
   line. Short-term conversation memory ("what about that one?") for the
   open-Q&A path is kept HERE as a small list of (who, text) turns and
   replayed into the system instruction on every new connection.
================================================================================
"""

import asyncio
import queue
import threading
import time
from typing import List, Optional, Tuple

from vivek_common import Config, SharedState

try:
    from google import genai
    from google.genai import types
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False
    genai = None
    types = None

try:
    import sounddevice as sd
    SOUNDDEVICE_AVAILABLE = True
except Exception:
    # sounddevice can fail two different ways: a normal ImportError if
    # the package itself isn't installed, OR an OSError('PortAudio
    # library not found') at import time if the package IS installed
    # but its native PortAudio binary is missing/broken for some reason
    # -- catching only ImportError would let that second case crash the
    # whole app at startup instead of degrading gracefully (AURA can
    # still see/hear without audio OUTPUT, so this should never be
    # fatal). On Windows, `pip install sounddevice` normally bundles a
    # working PortAudio DLL in the wheel, so this is mainly a safety
    # net for an unusual/corrupted install.
    SOUNDDEVICE_AVAILABLE = False
    sd = None


AURA_SYSTEM_PERSONA = (
    "You are AURA, the voice-interaction module inside a humanoid campus "
    "reception robot. Speak naturally, warmly, and concisely -- normally "
    "one to three short sentences, like a real spoken conversation, not "
    "an essay. Never say \"AURA:\" before your answer, never narrate "
    "actions, and never use emojis, asterisks, or markdown, since your "
    "reply is only ever heard out loud, never shown as text. Do not "
    "invent facts about the college that you were not told below."
)

# System instruction used ONLY for speak_exact() -- deliberately a
# completely different persona/instruction from AURA_SYSTEM_PERSONA
# above: here Gemini's job is to be a narrator reading a fixed script,
# not a conversational agent deciding what to say.
LIVE_TTS_SYSTEM_INSTRUCTION = (
    "You are a text-to-speech voice, not a conversational assistant. You "
    "will be given a block of text inside <speak> tags. Read that text "
    "aloud exactly as written, word for word, in a warm, natural, human "
    "narrator's voice. Do not add a greeting, introduction, sign-off, or "
    "any commentary of your own. Do not summarize, shorten, translate, "
    "or skip any part of it. Just read it aloud, start to finish, "
    "exactly as given inside the tags, and then stop."
)


class _AudioPlayer:
    """Plays raw 16-bit PCM audio through `sounddevice` (PortAudio) --
    works the same way on Windows, macOS, and Linux, unlike the
    original `aplay`-based version which only worked on Linux.

    KEPT OPEN THE WHOLE APP RUN (this is the main "make the voice
    faster" fix): opening/closing a fresh output stream (or, in the
    original code, spawning a fresh `aplay` process) for every single
    line AURA speaks adds real, noticeable startup latency before the
    first word comes out. One persistent `sounddevice.RawOutputStream`
    is opened lazily on the first line and then just reused for every
    line after that -- write() calls block only on PortAudio's own
    internal buffer, which is what naturally paces playback speed (the
    same role `aplay`'s blocking pipe write used to play), so the
    duration-estimation logic in `_receive_and_play` below still works
    unchanged."""

    def __init__(self, rate: int, channels: int = 1):
        self.rate = rate
        self.channels = channels
        self._stream = None
        self._lock = threading.Lock()

    def _ensure_stream_locked(self):
        if self._stream is not None:
            return
        if not SOUNDDEVICE_AVAILABLE:
            raise RuntimeError("'sounddevice' isn't installed -- "
                                "pip install sounddevice")
        self._stream = sd.RawOutputStream(
            samplerate=self.rate, channels=self.channels, dtype="int16",
            blocksize=0, latency="low")
        self._stream.start()

    def write(self, pcm_bytes: bytes):
        if not pcm_bytes:
            return
        with self._lock:
            try:
                self._ensure_stream_locked()
                self._stream.write(pcm_bytes)
            except Exception as e:
                print(f"[Gemini] audio playback error: {e}")
                # Drop the stream so the next write() tries to reopen it
                # fresh instead of repeating the same error forever.
                try:
                    if self._stream is not None:
                        self._stream.close()
                except Exception:
                    pass
                self._stream = None

    def close(self):
        with self._lock:
            if self._stream is not None:
                try:
                    self._stream.stop()
                    self._stream.close()
                except Exception:
                    pass
                self._stream = None


class AuraGeminiEngine:
    """AURA's only AI model, for both understanding and speaking. See
    module docstring above."""

    def __init__(self, shared: SharedState):
        self.shared = shared
        self.api_key = Config.GEMINI_API_KEY
        self.history: List[Tuple[str, str]] = []  # [("user"/"aura", text), ...] -- ask_and_speak only
        self.player = _AudioPlayer(rate=Config.GEMINI_OUTPUT_RATE, channels=1)
        self._client = None
        self.enabled = False

        if not Config.USE_GEMINI_VOICE:
            print("[Gemini] USE_GEMINI_VOICE=false -- AURA cannot speak or "
                  "answer questions until this is turned back on.")
            return
        if not GENAI_AVAILABLE:
            print("[Gemini] 'google-genai' isn't installed -- AURA cannot "
                  "speak or answer questions. pip install google-genai")
            return
        if not SOUNDDEVICE_AVAILABLE:
            print("[Gemini] 'sounddevice' isn't installed -- AURA can still "
                  "understand you, but has no way to play audio back. "
                  "pip install sounddevice")
            return
        if not self.api_key:
            print("[Gemini] GEMINI_API_KEY isn't set in .env -- AURA cannot "
                  "speak or answer questions until a key is added.")
            return

        try:
            self._client = genai.Client(api_key=self.api_key)
        except Exception as e:
            print(f"[Gemini] could not create client ({e}) -- AURA cannot "
                  f"speak or answer questions.")
            return

        self.enabled = True
        print(f"[Gemini] AURA ready -- model: {Config.GEMINI_MODEL} (live, "
              f"one model for everything), voice: "
              f"{Config.GEMINI_VOICE_NAME or 'default voice'}")

    # ------------------------------------------------------------------
    # Small helper: run an async call (via asyncio.run) on its own daemon
    # thread with a hard timeout, so a stuck network call can never hang
    # the caller (the VoiceListener thread or SpeechEngine's worker
    # thread) forever, and can never block the process from exiting
    # either. No persistent background event loop to manage -- each call
    # opens a fresh short-lived Live session rather than keeping one
    # long-running connection open for the app's whole lifetime.
    # ------------------------------------------------------------------
    def _call_with_timeout(self, fn, timeout: float, what: str):
        result_q: "queue.Queue" = queue.Queue(maxsize=1)

        def _target():
            try:
                result_q.put(("ok", fn()))
            except Exception as e:
                result_q.put(("err", e))

        threading.Thread(target=_target, daemon=True, name=f"aura-gemini-{what}").start()
        try:
            status, value = result_q.get(timeout=timeout)
        except queue.Empty:
            print(f"[Gemini] {what} call timed out after {timeout:.0f}s")
            return None
        if status == "err":
            print(f"[Gemini] {what} call failed: {value}")
            return None
        return value

    def _voice_speech_config(self):
        if not Config.GEMINI_VOICE_NAME:
            return None
        return types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                    voice_name=Config.GEMINI_VOICE_NAME)))

    # ------------------------------------------------------------------
    # Shared receive/playback loop -- used by BOTH ask_and_speak (open
    # Q&A) and speak_exact (verbatim canned lines).
    # ------------------------------------------------------------------
    async def _receive_and_play(self, session, deadline: float) -> Tuple[str, str, bool]:
        """Drains session.receive() until turn_complete or the deadline,
        playing audio chunks as they arrive, and waits for playback to
        actually finish before returning (so the mic doesn't start
        listening again while AURA is still talking). Returns
        (heard_text, reply_text, played_audio)."""
        transcript_parts: List[str] = []
        user_said: List[str] = []
        total_audio_bytes = 0
        first_audio_wall_time: Optional[float] = None
        bytes_per_sec = Config.GEMINI_OUTPUT_RATE * 2  # 16-bit mono

        async for response in session.receive():
            if time.monotonic() > deadline:
                print("[Gemini] turn timed out waiting for a reply")
                break

            server_content = getattr(response, "server_content", None)
            if server_content is None:
                continue

            in_tx = getattr(server_content, "input_transcription", None)
            if in_tx and getattr(in_tx, "text", None):
                user_said.append(in_tx.text)

            out_tx = getattr(server_content, "output_transcription", None)
            if out_tx and getattr(out_tx, "text", None):
                transcript_parts.append(out_tx.text)

            model_turn = getattr(server_content, "model_turn", None)
            if model_turn:
                for part in (getattr(model_turn, "parts", None) or []):
                    inline_data = getattr(part, "inline_data", None)
                    audio_data = getattr(inline_data, "data", None) if inline_data else None
                    if not audio_data:
                        continue
                    if first_audio_wall_time is None:
                        first_audio_wall_time = time.monotonic()
                        self.shared.set_state("speaking")
                    self.player.write(audio_data)  # play AS IT ARRIVES
                    total_audio_bytes += len(audio_data)

            if getattr(server_content, "turn_complete", False):
                break

        # Don't return (and let the caller start listening again) until
        # AURA has actually finished talking, not just finished
        # generating -- the output stream/PortAudio buffer is still
        # draining for a moment after the last chunk was written.
        if total_audio_bytes > 0 and first_audio_wall_time is not None:
            expected_duration = total_audio_bytes / bytes_per_sec
            elapsed = time.monotonic() - first_audio_wall_time
            remaining = expected_duration - elapsed + 0.2
            if remaining > 0:
                await asyncio.sleep(remaining)

        return "".join(user_said).strip(), "".join(transcript_parts).strip(), total_audio_bytes > 0

    # ------------------------------------------------------------------
    # PATH 1: general, open-ended Q&A (hearing + deciding + speaking, all
    # in one Live session)
    # ------------------------------------------------------------------
    def _build_system_instruction(self, user_name: str, lang: str) -> str:
        parts = [AURA_SYSTEM_PERSONA, Config.CAMPUS_LOCATION_FACTS]
        if lang == "kn":
            parts.append("Reply ONLY in the Kannada language, written in "
                          "Kannada (ಕನ್ನಡ) script -- never in English or "
                          "Romanized Kannada.")
        if user_name and user_name != "Unknown":
            parts.append(f"You are speaking with {user_name.replace('_', ' ').title()}.")
        if self.history:
            recent = self.history[-8:]
            convo = "\n".join(f"{who}: {text}" for who, text in recent)
            parts.append("Recent conversation so far, for context only -- "
                          "don't repeat it back:\n" + convo)
        return "\n\n".join(parts)

    def _build_config(self, user_name: str, lang: str):
        vad = types.AutomaticActivityDetection(
            disabled=False,
            start_of_speech_sensitivity=types.StartSensitivity.START_SENSITIVITY_HIGH,
            end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_LOW,
            prefix_padding_ms=120,
            silence_duration_ms=500,
        )
        return types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            system_instruction=types.Content(
                role="system",
                parts=[types.Part(text=self._build_system_instruction(user_name, lang))],
            ),
            realtime_input_config=types.RealtimeInputConfig(automatic_activity_detection=vad),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            input_audio_transcription=types.AudioTranscriptionConfig(),
            speech_config=self._voice_speech_config(),
        )

    def ask_and_speak(self, pcm16_16k: bytes, lang: str = "en", user_name: str = "") -> Optional[str]:
        """Called from the (synchronous) VoiceListener thread. Sends one
        already-captured utterance's audio to Gemini, plays the streamed
        reply as it arrives, and returns AURA's reply as text for the
        on-screen transcript -- or None if the call failed (no answer
        was produced/spoken at all)."""
        if not self.enabled or not pcm16_16k:
            return None

        def _do():
            return asyncio.run(self._ask_and_speak_async(pcm16_16k, lang, user_name))

        try:
            return self._call_with_timeout(_do, Config.GEMINI_TURN_TIMEOUT_SEC + 5, "question")
        except Exception as e:
            print(f"[Gemini] question failed: {e}")
            return None

    async def _ask_and_speak_async(self, pcm16_16k: bytes, lang: str, user_name: str) -> Optional[str]:
        config = self._build_config(user_name, lang)

        async with self._client.aio.live.connect(model=Config.GEMINI_MODEL, config=config) as session:
            # Stream the already-captured utterance in ~100ms chunks, then
            # explicitly mark the turn's audio as finished -- this lets
            # Gemini's VAD close the user's turn immediately instead of
            # waiting on real-time silence, since this whole clip arrives
            # far faster than real time. Chunk size is 100ms (not 40ms)
            # here on purpose: this whole clip is already fully captured
            # before we ever start sending it (unlike a live mic stream),
            # so there's no real-time reason to keep chunks tiny -- fewer,
            # bigger sends means fewer async round-trips through the
            # websocket before Gemini can start replying, which shaves a
            # little more off the "how fast does AURA respond" feel.
            chunk_bytes = max(1024, int(Config.GEMINI_INPUT_RATE * 2 * 0.1))
            mime = f"audio/pcm;rate={Config.GEMINI_INPUT_RATE}"
            for i in range(0, len(pcm16_16k), chunk_bytes):
                await session.send_realtime_input(
                    audio={"data": pcm16_16k[i:i + chunk_bytes], "mime_type": mime})
            await session.send_realtime_input(audio_stream_end=True)

            self.shared.set_state("thinking")
            deadline = time.monotonic() + Config.GEMINI_TURN_TIMEOUT_SEC
            heard_text, reply_text, played = await self._receive_and_play(session, deadline)

        if heard_text:
            self.history.append(("user", heard_text))
        if reply_text:
            self.history.append(("aura", reply_text))
        self.history = self.history[-12:]

        if not played and not reply_text:
            return None
        return reply_text or "..."

    # ------------------------------------------------------------------
    # PATH 2: verbatim canned lines (voice only -- content is fixed by
    # the caller, e.g. introduction / college info / campus locations /
    # movement confirmations / Kannada toggle confirmations)
    # ------------------------------------------------------------------
    def _build_tts_config(self, lang: str):
        instruction = LIVE_TTS_SYSTEM_INSTRUCTION
        if lang == "kn":
            instruction += (" The text you're given is written in Kannada "
                             "script -- read it aloud in Kannada, do not "
                             "translate it into another language.")
        return types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            temperature=0.0,  # minimize creative deviation from the script
            system_instruction=types.Content(
                role="system", parts=[types.Part(text=instruction)]),
            speech_config=self._voice_speech_config(),
        )

    def speak_exact(self, text: str, lang: str = "en") -> bool:
        """Called from SpeechEngine's worker thread. Speaks `text`
        through Gemini's voice as close to verbatim as a generative
        voice model can guarantee -- there is no fallback, so a False
        return means this line was not spoken at all (the caller just
        logs it)."""
        if not self.enabled or not text or not text.strip():
            return False

        def _do():
            return asyncio.run(self._speak_exact_async(text.strip(), lang))

        try:
            return bool(self._call_with_timeout(_do, Config.GEMINI_TURN_TIMEOUT_SEC + 5, "speak"))
        except Exception as e:
            print(f"[Gemini] speak_exact failed for \"{text[:60]}...\": {e}")
            return False

    async def _speak_exact_async(self, text: str, lang: str) -> bool:
        config = self._build_tts_config(lang)
        async with self._client.aio.live.connect(model=Config.GEMINI_MODEL, config=config) as session:
            await session.send_client_content(
                turns=types.Content(role="user", parts=[types.Part(text=f"<speak>{text}</speak>")]),
                turn_complete=True,
            )
            self.shared.set_state("speaking")
            deadline = time.monotonic() + Config.GEMINI_TURN_TIMEOUT_SEC
            _, _, played = await self._receive_and_play(session, deadline)
        return played

    # ------------------------------------------------------------------
    def reset(self):
        """Clear open-Q&A conversation memory. Call this on conversation
        timeout (see VoiceListener._listen_loop)."""
        self.history = []

    def close(self):
        """Call once, at shutdown."""
        self.player.close()
