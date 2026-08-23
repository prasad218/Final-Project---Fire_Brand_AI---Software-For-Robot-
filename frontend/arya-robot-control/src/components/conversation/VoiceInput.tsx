import { Mic, Loader2, Volume2 } from "lucide-react";
import type { VoiceUIState } from "../../types/conversation";
import styles from "./VoiceInput.module.css";

interface VoiceInputProps {
  state: VoiceUIState;
  onToggle: () => void;
}

const STATE_LABEL: Record<VoiceUIState, string> = {
  IDLE: "Tap to speak",
  LISTENING: "Listening…",
  PROCESSING: "Processing…",
  SPEAKING: "Speaking…",
};

export function VoiceInput({ state, onToggle }: VoiceInputProps) {
  return (
    <div className={styles.wrap}>
      <button
        className={[styles.mic, styles[state.toLowerCase()]].join(" ")}
        onClick={onToggle}
        aria-label="Toggle voice input"
      >
        {state === "PROCESSING" ? <Loader2 size={22} className={styles.spin} /> : state === "SPEAKING" ? (
          <Volume2 size={22} />
        ) : (
          <Mic size={22} />
        )}
      </button>
      <span className={styles.label}>{STATE_LABEL[state]}</span>
    </div>
  );
}
