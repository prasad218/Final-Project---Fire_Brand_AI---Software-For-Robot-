import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Square } from "lucide-react";
import type { VoiceCommand } from "../../types/robot";
import { Panel } from "../common/Panel";
import { HoldButton } from "../common/HoldButton";
import { useRobotState, type DriveFlags } from "../../hooks/useRobotState";
import styles from "./SimulationControls.module.css";

interface SimulationControlsProps {
  onCommand: (command: VoiceCommand) => void;
}

export function SimulationControls({ onCommand }: SimulationControlsProps) {
  const { setDrive } = useRobotState();

  function hold(flag: keyof DriveFlags) {
    return {
      onHoldStart: () => setDrive({ [flag]: true } as Partial<DriveFlags>),
      onHoldEnd: () => setDrive({ [flag]: false } as Partial<DriveFlags>),
    };
  }

  return (
    <Panel title="Simulation Controls" accent="green">
      <div className={styles.pad}>
        <span />
        <HoldButton className={styles.padBtn} aria-label="Move forward" {...hold("fwd")}>
          <ArrowUp size={18} />
        </HoldButton>
        <span />

        <HoldButton className={styles.padBtn} aria-label="Turn left" {...hold("left")}>
          <ArrowLeft size={18} />
        </HoldButton>
        <button className={[styles.padBtn, styles.stop].join(" ")} onClick={() => onCommand("STOP")} aria-label="Stop">
          <Square size={16} />
        </button>
        <HoldButton className={styles.padBtn} aria-label="Turn right" {...hold("right")}>
          <ArrowRight size={18} />
        </HoldButton>

        <span />
        <HoldButton className={styles.padBtn} aria-label="Move backward" {...hold("back")}>
          <ArrowDown size={18} />
        </HoldButton>
        <span />
      </div>
      <p className={styles.hint}>Press and hold a direction to drive ARYA — release to ease to a stop. Works with WASD / arrow keys too.</p>
    </Panel>
  );
}
