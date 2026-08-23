import { useState } from "react";
import { Modal } from "./Modal";
import styles from "./SettingsModal.module.css";

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [simSpeed, setSimSpeed] = useState(50);

  return (
    <Modal title="Settings" onClose={onClose}>
      <div className={styles.field}>
        <label htmlFor="robot-name">Robot Name</label>
        <input id="robot-name" defaultValue="ARYA" disabled />
      </div>

      <div className={styles.field}>
        <label htmlFor="language">Language</label>
        <select id="language" defaultValue="English" disabled>
          <option>English</option>
        </select>
      </div>

      <div className={styles.field}>
        <label htmlFor="voice">Voice</label>
        <select id="voice" defaultValue="Default" disabled>
          <option>Default</option>
        </select>
      </div>

      <div className={styles.field}>
        <label htmlFor="sim-speed">Simulation Speed</label>
        <input
          id="sim-speed"
          type="range"
          min={0}
          max={100}
          value={simSpeed}
          onChange={(e) => setSimSpeed(Number(e.target.value))}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="theme">Theme</label>
        <select id="theme" defaultValue="Dark" disabled>
          <option>Dark</option>
        </select>
      </div>

      <p className={styles.note}>
        Live vision (object/person detection, face recognition) and chat are connected to
        ARYA's backend. The controls above are placeholders for a future phase.
      </p>
    </Modal>
  );
}
