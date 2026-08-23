import { Line } from "@react-three/drei";
import type { Vector3Like } from "../../types/robot";

interface PathRendererProps {
  trail: Vector3Like[];
  color?: string;
}

/** Draws the recent movement trail. Later this can render a planned path too. */
export function PathRenderer({ trail, color = "#38d3ff" }: PathRendererProps) {
  if (trail.length < 2) return null;
  const points: [number, number, number][] = trail.map((p) => [p.x, 0.03, p.z]);

  return <Line points={points} color={color} lineWidth={2} transparent opacity={0.6} dashed={false} />;
}
