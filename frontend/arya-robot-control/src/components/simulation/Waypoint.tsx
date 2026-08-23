import type { Vector3Like } from "../../types/robot";

interface WaypointProps {
  position: Vector3Like;
  color?: string;
}

/** A small pulsing marker used for future waypoint / path-planning visuals. */
export function Waypoint({ position, color = "#38d3ff" }: WaypointProps) {
  return (
    <mesh position={[position.x, 0.05, position.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.08, 0.12, 24]} />
      <meshBasicMaterial color={color} transparent opacity={0.8} toneMapped={false} />
    </mesh>
  );
}
