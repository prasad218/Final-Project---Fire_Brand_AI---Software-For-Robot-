import { Terminal } from "lucide-react";
import type { LiveLogEntry } from "../../types/vision";
import { Panel } from "../common/Panel";
import styles from "./ConversationLog.module.css";

interface ConversationLogProps {
  entries: LiveLogEntry[];
}

export function ConversationLog({ entries }: ConversationLogProps) {
  return (
    <Panel title="Talk Live Log" icon={<Terminal size={14} />} accent="neutral">
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
