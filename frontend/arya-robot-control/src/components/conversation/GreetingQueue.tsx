import { Check, Clock, X } from "lucide-react";
import type { GreetingQueueEntry } from "../../types/conversation";
import styles from "./GreetingQueue.module.css";

interface GreetingQueueProps {
  entries: GreetingQueueEntry[];
}

const STATUS_META = {
  COMPLETED: { icon: Check, label: "Greeting completed", tone: "green" },
  IN_PROGRESS: { icon: Clock, label: "Greeting in progress", tone: "cyan" },
  WAITING: { icon: Clock, label: "Waiting", tone: "orange" },
  LEFT: { icon: X, label: "Left before greeting", tone: "muted" },
} as const;

export function GreetingQueue({ entries }: GreetingQueueProps) {
  if (entries.length === 0) {
    return <p className={styles.empty}>No one in the greeting queue.</p>;
  }

  return (
    <ul className={styles.list}>
      {entries.map((entry) => {
        const meta = STATUS_META[entry.status];
        const Icon = meta.icon;
        return (
          <li key={entry.id} className={styles.item}>
            <span className={styles.name}>{entry.personName}</span>
            <span className={[styles.status, styles[meta.tone]].join(" ")}>
              <Icon size={12} />
              {entry.status === "COMPLETED" ? "Greeting completed" : meta.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
