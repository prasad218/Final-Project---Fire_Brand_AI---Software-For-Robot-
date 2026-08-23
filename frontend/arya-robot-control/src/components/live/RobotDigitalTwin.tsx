import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import { Radar } from "lucide-react";
import { AryaRobot } from "../robot/AryaRobot";
import { PathRenderer } from "../simulation/PathRenderer";
import { DetectionMarker } from "./DetectionMarker";
import type { RobotAction, Vector3Like } from "../../types/robot";
import type { RecognizedPerson } from "../../types/vision";
import { Panel } from "../common/Panel";
import styles from "./RobotDigitalTwin.module.css";

interface RobotDigitalTwinProps {
  position: Vector3Like;
  rotation: number;
  action: RobotAction;
  trail: Vector3Like[];
  distanceTraveledM: number;
  people: RecognizedPerson[];
}

const PRESENT_STATUSES = new Set(["RECOGNIZED", "GREETED", "PRESENT"]);

/**
 * Small live 3D view of ARYA driven by the same shared robot state as the
 * Simulation page. Voice commands, the movement pad, and Automatic mode
 * on this page all move this twin exactly as they would move ARYA in 3D
 * Simulation -- and now the camera's live detections are plotted on the
 * same grid, so the twin shows both "where ARYA is" and "what she's
 * currently seeing."
 */
export function RobotDigitalTwin({
  position,
  rotation,
  action,
  trail,
  distanceTraveledM,
  people,
}: RobotDigitalTwinProps) {
  // Only people currently in frame with a usable position estimate --
  // LEFT/DETECTED-without-a-body-match don't get a marker. Checks `!=
  // null` (not `!== undefined`) because the backend sends JSON `null`
  // for "no estimate yet", which is `null`, not `undefined`, in JS.
  const markers = people.filter(
    (p) => PRESENT_STATUSES.has(p.status) && p.bbox != null && p.distanceM != null,
  );
  const nearest = markers.reduce<RecognizedPerson | null>((closest, p) => {
    if (!closest || (p.distanceM ?? Infinity) < (closest.distanceM ?? Infinity)) return p;
    return closest;
  }, null);

  return (
    <Panel title="Arya Digital Twin" icon={<Radar size={14} />} accent="cyan">
      <div className={styles.statRow}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Distance traveled</span>
          <span className={styles.statValue}>{distanceTraveledM.toFixed(1)}m</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Nearest person</span>
          <span className={styles.statValue}>
            {nearest ? `${nearest.name} · ~${nearest.distanceM}m` : "None in frame"}
          </span>
        </div>
      </div>

      <div className={styles.canvasWrap}>
        <Canvas camera={{ position: [3, 3.2, 5], fov: 42 }} shadows>
          <ambientLight intensity={0.5} />
          <directionalLight position={[4, 6, 3]} intensity={1} castShadow />
          <pointLight position={[-2, 1, -2]} intensity={0.3} color="#38d3ff" />

          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[10, 8]} />
            <meshStandardMaterial color="#070b16" roughness={0.9} />
          </mesh>
          <Grid
            args={[10, 8]}
            cellSize={0.5}
            cellColor="#152036"
            sectionColor="#1e2b45"
            fadeDistance={16}
            infiniteGrid={false}
          />

          <PathRenderer trail={trail} />
          <AryaRobot action={action} eyesOn position={[position.x, 0, position.z]} rotationY={rotation} />

          {markers.map((p) => (
            <DetectionMarker
              key={p.id}
              robotPosition={position}
              robotRotationDeg={rotation}
              bbox={p.bbox!}
              distanceM={p.distanceM!}
              label={p.name}
              color={p.status === "PRESENT" || p.status === "GREETED" ? "#4ee08a" : "#f0b93b"}
            />
          ))}

          <OrbitControls enablePan={false} minDistance={2.5} maxDistance={8} maxPolarAngle={Math.PI / 2.1} />
        </Canvas>
      </div>
      <p className={styles.caption}>
        Mirrors ARYA's movement live (Controls, Voice, and Automatic all drive both views) — person
        markers are estimated from the camera's box size/position, not a measured position.
      </p>
    </Panel>
  );
}