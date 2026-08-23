import { useState } from "react";
import { Mic, MicOff } from "lucide-react";
import type { VoiceCommand } from "../../types/robot";
import { Panel } from "../common/Panel";
import { useSpeechRecognition } from "../../hooks/useSpeechRecognition";
import styles from "./VoiceCommandPanel.module.css";

interface VoiceCommandPanelProps {
  onCommand: (command: VoiceCommand) => void;
}

const COMMAND_PHRASES: Record<VoiceCommand, string> = {
  MOVE_FORWARD: "Arya, move front",
  MOVE_BACKWARD: "Arya, move back",
  TURN_LEFT: "Arya, turn left",
  TURN_RIGHT: "Arya, turn right",
  STOP: "Arya, stop",
  NAMASTE: "Arya, namaste",
  WAVE: "Arya, wave",
  LOOK: "Arya, look around",
  SPEAK: "Arya, say hello",
};

const COMMAND_REPLIES: Record<VoiceCommand, string> = {
  MOVE_FORWARD: "Moving forward.",
  MOVE_BACKWARD: "Moving backward.",
  TURN_LEFT: "Turning left.",
  TURN_RIGHT: "Turning right.",
  STOP: "Stopping now.",
  NAMASTE: "Namaste!",
  WAVE: "Hello there!",
  LOOK: "Looking around.",
  SPEAK: "Hello, I am ARYA.",
};

// Keyword groups used to match a spoken phrase to a command. Checked in
// order, so more specific / conflicting phrases (STOP, TURN_*) are matched
// before the broader MOVE_* keywords.
const COMMAND_KEYWORDS: { command: VoiceCommand; keywords: string[] }[] = [
  { command: "STOP", keywords: ["stop"] },
  { command: "TURN_LEFT", keywords: ["turn left", "left"] },
  { command: "TURN_RIGHT", keywords: ["turn right", "right"] },
  { command: "MOVE_FORWARD", keywords: ["move front", "move forward", "forward", "front"] },
  { command: "MOVE_BACKWARD", keywords: ["move back", "move backward", "backward", "back"] },
  { command: "NAMASTE", keywords: ["namaste"] },
  { command: "WAVE", keywords: ["wave"] },
  { command: "LOOK", keywords: ["look around", "look"] },
  { command: "SPEAK", keywords: ["say hello", "speak"] },
];

/** Matches a raw spoken transcript (e.g. "arya turn left") to a VoiceCommand. */
function matchCommand(transcript: string): VoiceCommand | null {
  const text = transcript.toLowerCase();
  for (const { command, keywords } of COMMAND_KEYWORDS) {
    if (keywords.some((keyword) => text.includes(keyword))) return command;
  }
  return null;
}

interface Exchange {
  you: string;
  arya: string;
}

export function VoiceCommandPanel({ onCommand }: VoiceCommandPanelProps) {
  const [exchange, setExchange] = useState<Exchange | null>(null);

  const { supported, listening, error, toggle } = useSpeechRecognition({
    onPhrase: (transcript) => {
      const command = matchCommand(transcript);
      if (command) {
        onCommand(command);
        setExchange({ you: transcript, arya: COMMAND_REPLIES[command] });
      } else {
        setExchange({ you: transcript, arya: "Sorry, I didn't catch that command." });
      }
    },
  });

  function handleQuickCommand(command: VoiceCommand) {
    onCommand(command);
    setExchange({ you: COMMAND_PHRASES[command], arya: COMMAND_REPLIES[command] });
  }

  return (
    <Panel title="Voice Command" icon={<Mic size={14} />} accent="purple">
      <button className={styles.listenRow} onClick={toggle} disabled={!supported}>
        <span className={[styles.mic, listening ? styles.micActive : ""].join(" ")}>
          {listening ? <Mic size={16} /> : <MicOff size={16} />}
        </span>
        <span className={styles.listenLabel}>
          {!supported
            ? "Voice input not supported in this browser"
            : listening
              ? "Listening…"
              : "Voice paused — tap to start"}
        </span>
      </button>

      {error && <p className={styles.hint}>{error}</p>}
      {!supported && (
        <p className={styles.hint}>Try Chrome or Edge for live voice commands, or use the buttons below.</p>
      )}

      {exchange ? (
        <div className={styles.exchange}>
          <p className={styles.you}>
            <span>You:</span> "{exchange.you}"
          </p>
          <p className={styles.arya}>
            <span>ARYA:</span> "{exchange.arya}"
          </p>
        </div>
      ) : (
        <p className={styles.hint}>Say "Arya, turn left" or try a command below.</p>
      )}

      <div className={styles.quickGroup}>
        <span className={styles.groupLabel}>Movement</span>
        <div className={styles.quickRow}>
          {(["MOVE_FORWARD", "MOVE_BACKWARD", "TURN_LEFT", "TURN_RIGHT", "STOP"] as VoiceCommand[]).map((cmd) => (
            <button key={cmd} className={styles.quickBtn} onClick={() => handleQuickCommand(cmd)}>
              {cmd.replace("_", " ").charAt(0) + cmd.replace("_", " ").slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.quickGroup}>
        <span className={styles.groupLabel}>Gestures</span>
        <div className={styles.quickRow}>
          {(["NAMASTE", "WAVE", "LOOK", "SPEAK"] as VoiceCommand[]).map((cmd) => (
            <button key={cmd} className={styles.quickBtn} onClick={() => handleQuickCommand(cmd)}>
              {cmd.charAt(0) + cmd.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>
    </Panel>
  );
}
