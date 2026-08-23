import { Users } from "lucide-react";
import type { RecognizedPerson } from "../../types/vision";
import { Panel } from "../common/Panel";
import styles from "./RecognizedPeople.module.css";

interface RecognizedPeopleProps {
  people: RecognizedPerson[];
}

const DISPLAY_STATUS: Partial<Record<RecognizedPerson["status"], string>> = {
  RECOGNIZED: "PRESENT",
};

export function RecognizedPeople({ people }: RecognizedPeopleProps) {
  return (
    <Panel title="Recognized People" icon={<Users size={14} />} accent="purple">
      <ul className={styles.list}>
        {people.map((p) => (
          <li key={p.id} className={styles.item}>
            <span>{p.name}</span>
            <span className={[styles.status, styles[p.status]].join(" ")}>
              {DISPLAY_STATUS[p.status] ?? p.status}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
