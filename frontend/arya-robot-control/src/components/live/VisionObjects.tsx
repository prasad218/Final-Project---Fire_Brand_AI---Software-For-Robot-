import { ScanLine } from "lucide-react";
import type { DetectedObject } from "../../types/vision";
import { Panel } from "../common/Panel";
import styles from "./VisionObjects.module.css";

interface VisionObjectsProps {
  objects: DetectedObject[];
}

export function VisionObjects({ objects }: VisionObjectsProps) {
  return (
    <Panel title="Objects Detected" icon={<ScanLine size={14} />} accent="cyan">
      {objects.length > 0 ? (
        <ul className={styles.list}>
          {objects.map((o) => (
            <li key={o.id} className={styles.item}>
             <span>
  {o.label}
  {o.nearestDistanceM != null && <span className={styles.distance}> · ~{o.nearestDistanceM}m</span>}
</span>
              <span className={styles.count}>&times; {o.count}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>No objects detected — vision model not connected yet.</p>
      )}
    </Panel>
  );
}
