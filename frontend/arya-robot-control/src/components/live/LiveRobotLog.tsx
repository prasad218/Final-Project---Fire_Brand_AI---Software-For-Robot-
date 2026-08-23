import { Terminal } from "lucide-react";
import type { LiveLogEntry } from "../../types/vision";
import { Panel } from "../common/Panel";
import styles from "./LiveRobotLog.module.css";

interface LiveRobotLogProps {
  entries: LiveLogEntry[];
  title?: string;
}

export function LiveRobotLog({ entries, title = "Live Log" }: LiveRobotLogProps) {
  return (
    <Panel title={title} icon={<Terminal size={14} />} accent="neutral">
      <div className={styles.stream}>
        {entries.length === 0 && <p className={styles.empty}>Awaiting activity…</p>}
        {entries
          .slice()
          .reverse()
          .map((entry) => (
            <div key={entry.id} className={styles.row}>
              <span className={styles.time}>{entry.timestamp}</span>
              <span className={styles.message}>{entry.message}</span>
            </div>
          ))}
      </div>
    </Panel>
  );
}
