import { useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useRobotState } from "../hooks/useRobotState";
import { useVisionFeed } from "../hooks/useVisionFeed";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { AryaRobot } from "../components/robot/AryaRobot";
import { StatusIndicator } from "../components/common/StatusIndicator";
import { ConversationPanel } from "../components/conversation/ConversationPanel";
import { VoiceInput } from "../components/conversation/VoiceInput";
import { RecognizedPeople } from "../components/conversation/RecognizedPeople";
import { GreetingManager } from "../components/conversation/GreetingManager";
import { ConversationLog } from "../components/conversation/ConversationLog";
import { makeLogEntry, timestamp } from "../services/mock/mockVision";
import { sendChatMessage } from "../services/real/chatClient";
import { sendRobotCommand } from "../services/real/robotClient";
import type { ConversationMessage, VoiceUIState } from "../types/conversation";
import type { LiveLogEntry } from "../types/vision";
import type { VoiceCommand } from "../types/robot";
import styles from "./TalkWithArya.module.css";

// Maps the movement direction the backend's chat_service.py may return
// (when an utterance turns out to be a movement command, e.g. "Arya,
// move front") back onto the frontend's VoiceCommand union, so a
// command said IN CHAT drives the same 3D avatar + backend
// MovementController that MovementControls/VoiceCommandPanel do on the
// Live Robotics page.
const DIRECTION_TO_COMMAND: Record<string, VoiceCommand> = {
  forward: "MOVE_FORWARD",
  backward: "MOVE_BACKWARD",
  left: "TURN_LEFT",
  right: "TURN_RIGHT",
  stop: "STOP",
};

// speechSynthesis.speak() can silently drop an utterance in Chrome if
// it's called in the SAME tick as cancel() -- there's no error, no
// onend, nothing; the reply just never comes out. Waiting one tick
// after cancel() before speak() reliably avoids it. This is very
// likely why replies sometimes never played at all.
const CANCEL_SETTLE_MS = 60;

// A second, separate Chrome bug: any utterance longer than ~15 seconds
// can silently stop partway through ("she starts answering then
// skips") because the underlying speech service goes idle and Chrome
// never resumes it. The standard workaround is to nudge it with a
// pause()+resume() every few seconds while something is actually
// speaking -- this is a no-op for short replies and only matters for
// longer ones (e.g. the introduction / college-info answers).
const KEEPALIVE_MS = 9000;

export function TalkWithArya() {
  const { robot, sendCommand } = useRobotState();

  // Real recognized-people + live event log + the backend's greeting
  // queue state, from the same camera pipeline Live Robotics uses.
  const { people, log, greetingActive } = useVisionFeed(true);

  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [voiceState, setVoiceState] = useState<VoiceUIState>("IDLE");
  const [pending, setPending] = useState(false);
  const [localLog, setLocalLog] = useState<LiveLogEntry[]>([]);

  // Mirrors `listening` into a ref so async callbacks (speechSynthesis
  // event handlers, the chat request's .then) always read the CURRENT
  // mic state instead of the one captured when they were created.
  const listeningRef = useRef(false);
  // Whether the mic was actually on right before ARYA started speaking
  // -- so speak() only resumes it afterward if it's supposed to.
  const wasListeningBeforeSpeakRef = useRef(false);
  // Forwards the mic's onPhrase callback to the LATEST submitToArya
  // closure (see the useSpeechRecognition call below for why this
  // indirection is needed).
  const submitToAryaRef = useRef<(text: string) => void>(() => {});
  // Only react once per real greeting, not on every render while
  // greetingActive stays the same name.
  const lastGreetedRef = useRef<string | null>(null);
  // True from the moment a real user utterance starts being handled
  // (submitToArya) until ARYA finishes SPEAKING the reply. While true,
  // greeting speech is not allowed to preempt it -- stops a greeting
  // (from vision_service.py's real face-recognition queue) from
  // cutting off or eating a real answer.
  const conversationBusyRef = useRef(false);
  // speechSynthesis timer handles, cleared/replaced on every speak() call.
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepAliveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function appendLocalLog(message: string) {
    setLocalLog((prev) => [...prev.slice(-24), makeLogEntry(message)]);
  }

  const {
    supported: voiceSupported,
    listening,
    error: micError,
    start: startListening,
    stop: stopListening,
    toggle: toggleListening,
  } = useSpeechRecognition({
    onPhrase: (transcript) => {
      submitToAryaRef.current(transcript);
    },
  });

  useEffect(() => {
    listeningRef.current = listening;
    // Don't stomp on an in-flight PROCESSING/SPEAKING state just
    // because the mic's continuous-listening loop toggled underneath it.
    setVoiceState((prev) => {
      if (prev === "PROCESSING" || prev === "SPEAKING") return prev;
      return listening ? "LISTENING" : "IDLE";
    });
  }, [listening]);

  // Clean up any pending speech timers on unmount so they don't fire
  // against an unmounted component.
  useEffect(() => {
    return () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      if (keepAliveTimerRef.current) clearInterval(keepAliveTimerRef.current);
    };
  }, []);

  /** Speaks `text` out loud (browser speechSynthesis, no audio sent to
   * the backend) -- and, critically, PAUSES speech recognition first so
   * ARYA's own voice coming out of the speakers never gets picked back
   * up by the (continuous) mic and mistaken for a new question. Only
   * resumes listening afterward if it was actually on beforehand.
   *
   * `kind` arbitrates between overlapping callers:
   *  - "reply" (a real answer to something the user said) ALWAYS wins:
   *    it cancels whatever's currently playing and takes over.
   *  - "greeting" (the real face-recognition greeting queue) is NOT
   *    allowed to interrupt a reply that's in flight or currently
   *    speaking -- it's simply skipped (logged, not spoken) rather than
   *    stomping the answer.
   */
  function speak(text: string, lang: "en" | "kn", kind: "reply" | "greeting" = "reply") {
    if (kind === "greeting" && conversationBusyRef.current) {
      appendLocalLog("Skipped greeting speech (reply in progress)");
      return;
    }

    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    if (keepAliveTimerRef.current) clearInterval(keepAliveTimerRef.current);

    wasListeningBeforeSpeakRef.current = listeningRef.current;
    if (listeningRef.current) {
      stopListening();
    }

    const settle = () => {
      if (keepAliveTimerRef.current) {
        clearInterval(keepAliveTimerRef.current);
        keepAliveTimerRef.current = null;
      }
      if (kind === "reply") {
        conversationBusyRef.current = false;
      }
      setVoiceState(wasListeningBeforeSpeakRef.current ? "LISTENING" : "IDLE");
      if (wasListeningBeforeSpeakRef.current) {
        startListening();
      }
    };

    if (!text || !("speechSynthesis" in window)) {
      settle();
      return;
    }

    window.speechSynthesis.cancel();

    // See CANCEL_SETTLE_MS above -- speaking in the same tick as
    // cancel() can silently drop the utterance in Chrome.
    settleTimerRef.current = setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang === "kn" ? "kn-IN" : "en-IN";
      utterance.onend = settle;
      utterance.onerror = settle;

      utterance.onstart = () => {
        // See KEEPALIVE_MS above -- periodically nudges Chrome's speech
        // service so long replies don't silently stop partway through.
        keepAliveTimerRef.current = setInterval(() => {
          if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
            window.speechSynthesis.pause();
            window.speechSynthesis.resume();
          }
        }, KEEPALIVE_MS);
      };

      window.speechSynthesis.speak(utterance);
    }, CANCEL_SETTLE_MS);
  }

  /** Single entry point for BOTH typed messages and recognized speech —
   * mirrors the backend's own _handle_utterance: one utterance, could
   * be a wake word, a movement command, a canned question, or an
   * open-ended one for Gemini, and the backend decides which. */
  async function submitToArya(userText: string) {
    // Marks the conversation as busy for the ENTIRE round trip, not
    // just while speaking -- a greeting that fires during "Thinking…"
    // (while awaiting the backend) would otherwise still be free to
    // speak and then get run over the instant the real reply arrives.
    conversationBusyRef.current = true;
    setPending(true);
    setVoiceState("PROCESSING");
    appendLocalLog("Thinking…");

    const result = await sendChatMessage(userText);
    const now = timestamp();

    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "USER", text: result.userText || userText, timestamp: now },
      { id: `a-${Date.now() + 1}`, role: "ARYA", text: result.reply, timestamp: now },
    ]);
    setPending(false);

    if (result.movement) {
      const command = DIRECTION_TO_COMMAND[result.movement];
      if (command) {
        sendCommand(command);
        void sendRobotCommand(command);
      }
    }

    setVoiceState("SPEAKING");
    appendLocalLog("Speaking");
    sendCommand("SPEAK");
    speak(result.reply, result.lang, "reply");
  }

  useEffect(() => {
    submitToAryaRef.current = submitToArya;
  });

  // Reacts to the backend's real, server-serialized greeting queue
  // (vision_service.py's _update_registry -> snapshot()'s
  // "greetingActive" field) -- when it starts greeting someone, play
  // the Namaste animation on the 3D avatar, log it, and say it out
  // loud, exactly once per greeting. This does NOT call
  // sendRobotCommand: the backend already triggered its own gesture
  // server-side, so this only reacts client-side, it doesn't ask the
  // backend to greet again. The backend only ever sets greetingActive
  // for a recognized (named) person, never "Unknown", so there's no
  // need to filter that out here.
  useEffect(() => {
    if (greetingActive && greetingActive !== lastGreetedRef.current) {
      lastGreetedRef.current = greetingActive;
      sendCommand("NAMASTE");
      appendLocalLog(`Namaste: ${greetingActive}`);
      const firstName = greetingActive.split(" ")[0];
      const now = timestamp();
      setMessages((prev) => [
        ...prev,
        { id: `a-greet-${Date.now()}`, role: "ARYA", text: `Namaste, ${firstName}!`, timestamp: now },
      ]);
      speak(`Namaste, ${firstName}!`, "en", "greeting");
    } else if (!greetingActive) {
      lastGreetedRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [greetingActive]);

  function handleTextSend(userText: string) {
    void submitToArya(userText);
  }

  function handleNamaste() {
    sendCommand("NAMASTE");
    void sendRobotCommand("NAMASTE");
  }

  // Real backend events (face recognized, namaste, movement, ...)
  // interleaved with local conversational ones (Thinking/Speaking),
  // sorted back into one chronological feed for the log panel.
  const combinedLog = [...log, ...localLog]
    .slice()
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0))
    .slice(-40);

  return (
    <div className={styles.page}>
      <div className={styles.layout}>
        <div className={styles.mainColumn}>
          <div className={styles.heroCard}>
            <div className={styles.heroHeader}>
              <span className={styles.heroTitle}>ARYA</span>
              <StatusIndicator label="Ready" tone="green" />
            </div>
            <div className={styles.canvasWrap}>
              <Canvas camera={{ position: [0, 1.3, 3.2], fov: 40 }} shadows>
                <ambientLight intensity={0.5} />
                <directionalLight position={[3, 5, 2]} intensity={1.1} castShadow />
                <pointLight position={[-2, 1, -1]} intensity={0.35} color="#a78bfa" />
                <AryaRobot action={robot.action} eyesOn position={[0, -1, 0]} scale={1.25} />
                <OrbitControls enablePan={false} minDistance={2} maxDistance={6} />
              </Canvas>
            </div>
            <VoiceInput state={voiceState} onToggle={toggleListening} />
            {!voiceSupported && (
              <p className={styles.voiceHint}>
                Voice input isn't supported in this browser — try Chrome or Edge, or just type
                below. Say "Arya" to wake her, or ask a question directly.
              </p>
            )}
            {micError && <p className={styles.voiceHint}>{micError}</p>}
          </div>

          <ConversationPanel messages={messages} pending={pending} onSend={handleTextSend} />
        </div>

        <div className={styles.sideColumn}>
          <RecognizedPeople people={people} />
          <GreetingManager onNamaste={handleNamaste} onLog={appendLocalLog} />
          <ConversationLog entries={combinedLog} />
        </div>
      </div>
    </div>
  );
}
