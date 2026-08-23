import { MapPin } from "lucide-react";
import { Panel } from "../common/Panel";
import { STATIONS } from "./stations";
import styles from "./StationMap.module.css";

interface StationMapProps {
  selectedStationId: string | null;
  onSelect: (id: string) => void;
}

export function StationMap({ selectedStationId, onSelect }: StationMapProps) {
  return (
    <Panel title="Station Map" icon={<MapPin size={14} />} accent="green">
      <ul className={styles.list}>
        {STATIONS.map((station) => (
          <li key={station.id}>
            <button
              className={[styles.item, selectedStationId === station.id ? styles.active : ""].join(" ")}
              onClick={() => onSelect(station.id)}
              style={{ ["--dot" as string]: station.color }}
            >
              <span className={styles.dot} />
              {station.name}
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
