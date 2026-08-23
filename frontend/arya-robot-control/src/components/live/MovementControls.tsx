import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Square } from "lucide-react";
import type { VoiceCommand, RobotAction } from "../../types/robot";
import { Panel } from "../common/Panel";
import { HoldButton } from "../common/HoldButton";
import styles from "./MovementControls.module.css";

interface MovementControlsProps {
  onCommand: (command: VoiceCommand) => void;
  action: RobotAction;
}

// This panel also relays to the real backend/hardware (see LiveRobotics'
// handleCommand), so releasing ANY held direction sends a full STOP rather
// than just clearing that one axis -- the safe default for real motors,
// even though it means two directions can't be combined into an arc here
// (use the pure-simulation Controls tab for that).
export function MovementControls({ onCommand, action }: MovementControlsProps) {
  function hold(command: VoiceCommand) {
    return {
      onHoldStart: () => onCommand(command),
      onHoldEnd: () => onCommand("STOP"),
    };
  }

  return (
    <Panel title="Movement Controls" accent="cyan">
      <div className={styles.pad}>
        <span />
        <HoldButton className={styles.padBtn} aria-label="Move forward" {...hold("MOVE_FORWARD")}>
          <ArrowUp size={18} />
        </HoldButton>
        <span />

        <HoldButton className={styles.padBtn} aria-label="Turn left" {...hold("TURN_LEFT")}>
          <ArrowLeft size={18} />
        </HoldButton>
        <button
          className={[styles.padBtn, styles.stop].join(" ")}
          onClick={() => onCommand("STOP")}
          aria-label="Stop"
        >
          <Square size={16} />
        </button>
        <HoldButton className={styles.padBtn} aria-label="Turn right" {...hold("TURN_RIGHT")}>
          <ArrowRight size={18} />
        </HoldButton>

        <span />
        <HoldButton className={styles.padBtn} aria-label="Move backward" {...hold("MOVE_BACKWARD")}>
          <ArrowDown size={18} />
        </HoldButton>
        <span />
      </div>

      <p className={styles.currentAction}>
        Current action: <strong>{action}</strong>
      </p>
    </Panel>
  );
}
