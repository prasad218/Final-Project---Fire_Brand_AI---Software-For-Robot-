import { useCallback, useEffect, useRef, useState } from "react";

// TypeScript's default DOM lib doesn't ship types for the Web Speech API,
// so we declare the minimal shape we actually use.
interface SpeechRecognitionResultLike {
  transcript: string;
}
interface SpeechRecognitionResultListLike {
  length: number;
  [index: number]: { [index: number]: SpeechRecognitionResultLike; isFinal: boolean };
}
interface SpeechRecognitionEventLike extends Event {
  results: SpeechRecognitionResultListLike;
}
interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface UseSpeechRecognitionOptions {
  /** Called with the recognized text every time the browser finalizes a phrase. */
  onPhrase: (transcript: string) => void;
}

/**
 * Wraps the browser's Web Speech API so spoken commands ("Arya, turn left")
 * actually reach the app, instead of the mic button being a purely visual
 * toggle. Falls back gracefully (supported === false) on browsers that
 * don't implement SpeechRecognition (e.g. Firefox).
 */
export function useSpeechRecognition({ onPhrase }: UseSpeechRecognitionOptions) {
  const [supported] = useState(() => getSpeechRecognitionConstructor() !== null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const wantListeningRef = useRef(false);
  const onPhraseRef = useRef(onPhrase);

  useEffect(() => {
    onPhraseRef.current = onPhrase;
  }, [onPhrase]);

  useEffect(() => {
    const Ctor = getSpeechRecognitionConstructor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-IN";

    recognition.onresult = (event) => {
      // A successful result proves the mic/permission are fine -- clear
      // any stale error banner left over from an earlier benign
      // stop/restart cycle (see onerror below).
      setError(null);
      const lastResult = event.results[event.results.length - 1];
      const text = lastResult?.[0]?.transcript ?? "";
      if (text.trim()) onPhraseRef.current(text.trim());
    };

    // The Web Speech API fires `onerror` for a lot of routine, EXPECTED
    // situations, not just real permission/hardware failures:
    //  - "aborted": fires every time recognition.stop() is called
    //    programmatically (which speak() in TalkWithArya.tsx does before
    //    every single ARYA reply, to stop her own voice from being
    //    picked up as a new question -- see that file). Without
    //    filtering this out, the scary "check microphone permission"
    //    banner appeared after EVERY reply and just stayed there
    //    forever, even while listening was working perfectly.
    //  - "no-speech": fires constantly in continuous mode during normal
    //    silence between phrases -- not an error a user should see.
    // Only "not-allowed" / "service-not-allowed" (permission genuinely
    // denied) and "audio-capture" (no mic hardware found) are real,
    // user-actionable problems worth surfacing.
    const BENIGN_ERRORS = new Set(["aborted", "no-speech"]);
    recognition.onerror = (event) => {
      if (BENIGN_ERRORS.has(event.error)) return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError("Microphone permission was denied — allow mic access in your browser's address bar and try again.");
      } else if (event.error === "audio-capture") {
        setError("No microphone found — check that one is connected and not in use by another app.");
      } else {
        setError(`Voice recognition error (${event.error}) — try toggling the mic off and on again.`);
      }
    };

    // The browser auto-stops recognition after a pause in speech. Restart
    // it automatically as long as the user hasn't paused listening.
    recognition.onend = () => {
      if (wantListeningRef.current) {
        try {
          recognition.start();
        } catch {
          // Already running — safe to ignore.
        }
      } else {
        setListening(false);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      wantListeningRef.current = false;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.stop();
    };
  }, []);

  const start = useCallback(() => {
    if (!recognitionRef.current) return;
    setError(null);
    wantListeningRef.current = true;
    try {
      recognitionRef.current.start();
    } catch {
      // start() throws if already started — state below is already correct.
    }
    setListening(true);
  }, []);

  const stop = useCallback(() => {
    if (!recognitionRef.current) return;
    wantListeningRef.current = false;
    recognitionRef.current.stop();
    setListening(false);
  }, []);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  return { supported, listening, error, start, stop, toggle };
}
