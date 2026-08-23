import { Activity } from "lucide-react";
import type { RobotState } from "../../types/robot";
import { Panel } from "../common/Panel";
import { StatusIndicator } from "../common/StatusIndicator";
import styles from "./RobotStatus.module.css";

interface RobotStatusProps {
  robot: RobotState;
}

export function RobotStatus({ robot }: RobotStatusProps) {
  return (
    <Panel title="Arya Status" icon={<Activity size={14} />} accent="cyan">
      <div className={styles.headline}>
        <StatusIndicator label={robot.online ? "ONLINE" : "OFFLINE"} tone={robot.online ? "green" : "red"} />
        <span className={styles.action}>{robot.action}</span>
      </div>

      <dl className={styles.grid}>
        <div>
          <dt>Battery</dt>
          <dd>{robot.battery}%</dd>
        </div>
        <div>
          <dt>Speed</dt>
          <dd>{robot.speed.toFixed(2)} m/s</dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd>{robot.mode}</dd>
        </div>
        <div>
          <dt>Camera</dt>
          <dd className={robot.cameraActive ? styles.good : styles.dim}>
            {robot.cameraActive ? "ACTIVE" : "STANDBY"}
          </dd>
        </div>
        <div>
          <dt>Voice</dt>
          <dd className={robot.voiceReady ? styles.good : styles.dim}>{robot.voiceReady ? "READY" : "OFF"}</dd>
        </div>
        <div>
          <dt>Temp</dt>
          <dd>{robot.temperature}&deg;C</dd>
        </div>
      </dl>

      <div className={styles.battery}>
        <div className={styles.batteryFill} style={{ width: `${robot.battery}%` }} />
      </div>
    </Panel>
  );
}
