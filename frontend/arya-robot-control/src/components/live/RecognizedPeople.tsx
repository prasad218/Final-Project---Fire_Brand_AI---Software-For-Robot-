import { Users } from "lucide-react";
import type { RecognizedPerson } from "../../types/vision";
import { Panel } from "../common/Panel";
import styles from "./RecognizedPeople.module.css";

interface RecognizedPeopleProps {
  people: RecognizedPerson[];
}

export function RecognizedPeople({ people }: RecognizedPeopleProps) {
  return (
    <Panel title="Recognized People" icon={<Users size={14} />} accent="orange">
      <ul className={styles.list}>
        {people.map((p) => (
          <li key={p.id} className={styles.item}>
           <span>
  {p.name}
  {p.distanceM != null && <span className={styles.distance}> · ~{p.distanceM}m</span>}
</span>
            <span className={[styles.status, styles[p.status]].join(" ")}>{p.status}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
