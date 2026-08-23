"""
================================================================================
 AURA WEB — TEXT CHAT ENGINE
 Powers POST /api/chat for the React frontend's "Talk with ARYA" page.
 Mirrors VoiceListener._process / _handle_utterance in
 vivek_interaction.py -- the SAME phrase lists, SAME canned answers,
 SAME movement-command matching, SAME campus-location facts (all read
 straight from vivek_common.Config, nothing duplicated by hand) -- just
 text-in/text-out instead of audio-in/audio-out.

 Why text, not the Gemini LIVE (audio) model used by aura_gemini.py
 ----------------------------------------------------------------------
 1. The browser already turns speech into text client-side (Web Speech
    API -- see src/hooks/useSpeechRecognition.ts in the frontend)
    before anything reaches this backend, so there's no captured
    question AUDIO to hand to a Live session the way
    AuraGeminiEngine.ask_and_speak() does on the desktop app.
 2. A plain text call -- client.models.generate_content(...), NOT
    client.aio.live.connect(...) -- is simpler and is all a web chat
    box needs. If you want ARYA to actually speak the reply out loud in
    the browser, that's a `window.speechSynthesis.speak(...)` call on
    the returned text, independent of this backend call.
 Both this module and aura_gemini.py use the SAME `google-genai`
 package (already in requirements.txt) -- just two different corners
 of its API (plain generate_content vs. a Live session), controlled by
 two separate model settings (Config.GEMINI_TEXT_MODEL here,
 Config.GEMINI_MODEL for the Live/desktop path) so changing one never
 accidentally affects the other.

 This intentionally does NOT reuse VoiceListener (vivek_interaction.py)
 itself -- that class also owns a live microphone stream via
 SpeechRecognition/PyAudio, which has no place inside a stateless HTTP
 request handler. Only the matching logic is re-implemented here,
 against typed text instead of a live mic.
================================================================================
"""

import re
import time
from typing import List, Optional, Tuple

from vivek_common import (
    Config,
    INTRODUCTION_TRANSCRIPT_TEXT, KANNADA_INTRODUCTION_TRANSCRIPT_TEXT,
    COLLEGE_INFO_TRANSCRIPT_TEXT, KANNADA_COLLEGE_INFO_TRANSCRIPT_TEXT,
)
from campus_locations import find_location_answer as _find_xlsx_location

try:
    from google import genai
    from google.genai import types
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False
    genai = None
    types = None


AURA_TEXT_PERSONA = (
    "You are ARYA, the conversational module inside a humanoid campus "
    "reception/service robot (this codebase also calls the robot AURA "
    "internally -- ARYA and AURA are the same assistant, just the name "
    "shown in the web UI). Reply naturally, warmly, and concisely -- "
    "normally one to four short sentences, like a real conversation, "
    "not an essay. Never prefix your reply with your own name, never "
    "narrate stage directions or actions in asterisks, and avoid heavy "
    "markdown since replies are shown in a simple chat bubble. Do not "
    "invent facts about the college beyond what you're told below."
)


# ══════════════════════════════════════════════════════════════════════
#  Matching helpers -- deliberately free functions (not methods) since
#  they only read Config, and are handy to unit-test / reuse standalone.
#  Logic ported 1:1 from VoiceListener in vivek_interaction.py.
# ══════════════════════════════════════════════════════════════════════

def match_phrase_list(text: str, phrases: List[str]) -> bool:
    for phrase in phrases:
        if re.search(rf"\b{re.escape(phrase)}\b", text):
            return True
    return False


def match_location_qa(text: str) -> Optional[str]:
    for entry in Config.LOCATION_QA:
        if match_phrase_list(text, entry["phrases"]):
            return entry["answer"]
    # Fallback: instant lookup against the actual Campus_Locations.xlsx
    # directory (campus_locations.py) for anything the hand-typed list
    # above doesn't cover -- e.g. "where is the library", "where is
    # the placement office", "what's in room E210". Still zero AI calls,
    # so it stays just as fast as the hand-typed matches above it.
    return _find_xlsx_location(text)


def match_movement(text: str) -> Optional[str]:
    for direction, phrases in Config.MOVE_COMMANDS.items():
        for phrase in phrases:
            if re.search(rf"\b{re.escape(phrase)}\b", text):
                return direction
    return None


# The desktop app's Config.WAKE_WORDS is tuned around "AURA" (that's the
# robot's internal/spoken name -- see WELCOME_SPEECH etc. in
# vivek_common.py). The web UI's brand name is ARYA, and that's what
# people actually type/say to it here ("Arya, move front"), so the web
# chat strips BOTH "aura" and "arya" -- same robot, two names. This is
# additive (it doesn't touch Config.WAKE_WORDS, so the desktop voice app
# is completely unaffected).
CHAT_WAKE_WORDS = list(Config.WAKE_WORDS) + ["arya"]


# vivek_common.py's INTRODUCTION_TRANSCRIPT_TEXT / COLLEGE_INFO_TRANSCRIPT_TEXT
# (and their Kannada counterparts) are shared with the desktop app, where
# the robot is branded "AURA" -- but the web UI is branded "ARYA" (see
# AURA_TEXT_PERSONA above). Rather than fork those transcripts, this
# rebrands the word on the way OUT of chat_service.py only, so the
# desktop app's own strings are completely untouched. Applied to a
# handful of whole-word variants ("AURA", "Aura", "aura") since the
# transcript text only ever capitalizes it as "AURA".
def _rebrand_for_web(text: str) -> str:
    return re.sub(r"\bAURA\b", "ARYA", text)


def strip_wake_words(text: str) -> str:
    stripped = text
    for w in CHAT_WAKE_WORDS:
        stripped = re.sub(rf"\b{re.escape(w)}\b", " ", stripped)
    stripped = re.sub(r"\b(hey|hi|hello|okay)\b", " ", stripped)
    return re.sub(r"\s+", " ", stripped).strip(" ,.")


class AuraChatEngine:
    """One instance lives for the whole web_server.py process (a single
    robot, one conversation at a time -- same assumption the desktop
    app makes with its single SharedState/AuraGeminiEngine)."""

    def __init__(self, movement=None, log_cb=None):
        self.movement = movement   # vivek_interaction.MovementController, or None
        self.log_cb = log_cb       # optional callable(str) -> also appear in the vision log/feed
        self.history: List[Tuple[str, str]] = []
        self.conversation_lang = "en"

        self.enabled = False
        self._client = None
        if not GENAI_AVAILABLE:
            print("[Chat] `google-genai` not installed -- Gemini answers disabled. "
                  "pip install google-genai. Wake-word / canned answers (introduction, "
                  "college info, campus locations, movement) still work without it.")
        elif not Config.GEMINI_API_KEY:
            print("[Chat] GEMINI_API_KEY is empty in .env -- Gemini answers disabled. "
                  "Get a key at https://aistudio.google.com/apikey. Wake-word / canned "
                  "answers (introduction, college info, campus locations, movement) "
                  "still work without it.")
        else:
            try:
                self._client = genai.Client(api_key=Config.GEMINI_API_KEY)
                self.enabled = True
                print(f"[Chat] Gemini text engine ready ({Config.GEMINI_TEXT_MODEL})")
            except Exception as e:
                print(f"[Chat] Gemini client init failed: {e}")

    def _log(self, message: str):
        if self.log_cb:
            try:
                self.log_cb(message)
            except Exception:
                pass

    # ------------------------------------------------------------------
    def handle(self, raw_text: str, user_name: str = "") -> dict:
        """Returns {reply, user_text, source, lang, movement}. `source`
        tells the caller (and, if it wants, the UI) which path answered:
        "wake" | "intro" | "college" | "location" | "kannada_toggle" |
        "movement" | "gemini" | "unavailable" | "empty"."""
        text = (raw_text or "").strip()
        if not text:
            return {"reply": "", "user_text": "", "source": "empty",
                    "lang": self.conversation_lang, "movement": None}

        lower = text.lower()

        # ---- wake word alone ("Arya" / "hey Arya" / "hi Arya" / ...) --
        # Mirrors VoiceListener._process: if stripping wake words leaves
        # nothing behind, this utterance WAS just the wake word -- reply
        # with the ready-to-help line instead of falling through to
        # Gemini with an empty question.
        remainder = strip_wake_words(lower)
        if not remainder:
            name = user_name.split("_")[0].title() if user_name and user_name != "Unknown" else ""
            reply = Config.CHAT_WAKE_REPLY_NAMED.format(name=name) if name else Config.CHAT_WAKE_REPLY
            return {"reply": reply, "user_text": text, "source": "wake",
                    "lang": self.conversation_lang, "movement": None}

        # Match against the STRIPPED remainder from here on (same as
        # _handle_utterance receiving `remainder`, not the raw
        # utterance) -- so "Arya, introduce yourself" matches exactly
        # like "introduce yourself" alone does.
        working = remainder

        if match_phrase_list(working, Config.INTRODUCTION_PHRASES):
            return {"reply": _rebrand_for_web(INTRODUCTION_TRANSCRIPT_TEXT), "user_text": text,
                    "source": "intro", "lang": "en", "movement": None}
        if match_phrase_list(working, Config.KANNADA_INTRODUCTION_PHRASES):
            return {"reply": _rebrand_for_web(KANNADA_INTRODUCTION_TRANSCRIPT_TEXT), "user_text": text,
                    "source": "intro", "lang": "kn", "movement": None}
        if match_phrase_list(working, Config.COLLEGE_INFO_PHRASES):
            return {"reply": _rebrand_for_web(COLLEGE_INFO_TRANSCRIPT_TEXT), "user_text": text,
                    "source": "college", "lang": "en", "movement": None}
        if match_phrase_list(working, Config.KANNADA_COLLEGE_INFO_PHRASES):
            return {"reply": _rebrand_for_web(KANNADA_COLLEGE_INFO_TRANSCRIPT_TEXT), "user_text": text,
                    "source": "college", "lang": "kn", "movement": None}

        location_answer = match_location_qa(working)
        if location_answer:
            return {"reply": location_answer, "user_text": text,
                    "source": "location", "lang": "en", "movement": None}

        if match_phrase_list(working, Config.KANNADA_MODE_ON_PHRASES):
            self.conversation_lang = "kn"
            return {"reply": Config.KANNADA_MODE_ON_REPLY, "user_text": text,
                    "source": "kannada_toggle", "lang": "kn", "movement": None}
        if match_phrase_list(working, Config.KANNADA_MODE_OFF_PHRASES):
            self.conversation_lang = "en"
            return {"reply": Config.KANNADA_MODE_OFF_REPLY, "user_text": text,
                    "source": "kannada_toggle", "lang": "en", "movement": None}

        direction = match_movement(working)
        if direction:
            confirm = {
                "forward": "Moving forward.", "backward": "Moving backward.",
                "left": "Turning left.", "right": "Turning right.", "stop": "Stopping now.",
            }[direction]
            if self.movement:
                try:
                    self.movement.move(direction)
                except Exception as e:
                    print(f"[Chat] movement error: {e}")
            self._log(f"Voice command received: {direction.upper()}")
            return {"reply": confirm, "user_text": text, "source": "movement",
                    "lang": self.conversation_lang, "movement": direction}

        # ---- general open-ended Q&A -> Gemini (text) -------------------
        reply = self._ask_gemini(working, self.conversation_lang, user_name)
        return {"reply": reply, "user_text": text,
                "source": "gemini" if self.enabled else "unavailable",
                "lang": self.conversation_lang, "movement": None}

    # ------------------------------------------------------------------
    def _build_system_instruction(self, lang: str, user_name: str) -> str:
        parts = [AURA_TEXT_PERSONA, Config.CAMPUS_LOCATION_FACTS]
        if lang == "kn":
            parts.append("Reply ONLY in the Kannada language, written in Kannada "
                          "(ಕನ್ನಡ) script -- never in English or Romanized Kannada.")
        if user_name and user_name != "Unknown":
            parts.append(f"You are speaking with {user_name.replace('_', ' ').title()}.")
        if self.history:
            convo = "\n".join(f"{who}: {said}" for who, said in self.history[-8:])
            parts.append("Recent conversation so far, for context only -- don't repeat "
                          "it back verbatim:\n" + convo)
        return "\n\n".join(parts)

    def _ask_gemini(self, text: str, lang: str, user_name: str) -> str:
        if not self.enabled:
            return ("Sorry, my AI module isn't connected right now — ask the team to set "
                    "GEMINI_API_KEY in the backend's .env file.")
        try:
            response = self._client.models.generate_content(
                model=Config.GEMINI_TEXT_MODEL,
                contents=text,
                config=types.GenerateContentConfig(
                    system_instruction=self._build_system_instruction(lang, user_name),
                    temperature=0.6,
                    max_output_tokens=300,
                ),
            )
            reply = (getattr(response, "text", None) or "").strip()
            if not reply:
                return "Sorry, I couldn't come up with an answer for that just now."
            reply = _rebrand_for_web(reply)  # safety net -- AURA_TEXT_PERSONA already
            # tells Gemini to call itself ARYA, but this catches the rare slip.
            self.history.append(("user", text))
            self.history.append(("arya", reply))
            self.history = self.history[-12:]
            return reply
        except Exception as e:
            print(f"[Chat] Gemini call failed: {e}")
            return "Sorry, I'm having trouble reaching my AI service right now — please try again in a moment."

    def reset(self):
        """Clear conversation memory (e.g. wire this to a 'New chat'
        button later, or a conversation-timeout, same idea as the
        desktop app's VoiceListener conversation timeout)."""
        self.history = []
