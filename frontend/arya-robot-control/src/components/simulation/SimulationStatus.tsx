import { Navigation } from "lucide-react";
import type { RobotState } from "../../types/robot";
import { Panel } from "../common/Panel";
import styles from "./SimulationStatus.module.css";

interface SimulationStatusProps {
  robot: RobotState;
}

export function SimulationStatus({ robot }: SimulationStatusProps) {
  return (
    <Panel title="Simulation Status" icon={<Navigation size={14} />} accent="green">
      <dl className={styles.grid}>
        <div>
          <dt>Position</dt>
          <dd>
            {robot.position.x.toFixed(1)}m, {robot.position.z.toFixed(1)}m
          </dd>
        </div>
        <div>
          <dt>Rotation</dt>
          <dd>{robot.rotation.toFixed(0)}&deg;</dd>
        </div>
        <div>
          <dt>Speed</dt>
          <dd>{robot.speed.toFixed(2)} m/s</dd>
        </div>
        <div>
          <dt>Action</dt>
          <dd>{robot.action}</dd>
        </div>
      </dl>
    </Panel>
  );
}
