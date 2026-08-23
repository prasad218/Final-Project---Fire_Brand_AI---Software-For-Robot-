import { useMemo } from "react";
import * as THREE from "three";
import type { Vector3Like } from "../../types/robot";
import type { NormalizedBBox } from "../../types/vision";

// Rough horizontal field of view for a typical laptop/USB webcam, used
// only to turn "where in the frame" into "what angle from ARYA" -- like
// the backend's distance estimate, this is an assumption, not a
// calibrated camera property.
const CAMERA_FOV_DEG = 60;

function makeLabelSprite(text: string, color: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.font = "600 28px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = 6;
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.1, 0.28, 1);
  return sprite;
}

interface DetectionMarkerProps {
  robotPosition: Vector3Like;
  robotRotationDeg: number;
  bbox: NormalizedBBox;
  distanceM: number;
  label: string;
  color?: string;
}

/** Places a marker on the twin's floor grid for one live detection,
 * estimated from the backend's bbox + distance -- NOT a measured
 * position (no depth sensor in this pipeline). Angle comes from where
 * the box sits left/right in frame; depth comes from the backend's
 * box-height distance estimate. */
export function DetectionMarker({
  robotPosition,
  robotRotationDeg,
  bbox,
  distanceM,
  label,
  color = "#4ee08a",
}: DetectionMarkerProps) {
  const centerX = bbox.x + bbox.w / 2;
  const angleOffsetDeg = (centerX - 0.5) * CAMERA_FOV_DEG;
  const totalRad = ((robotRotationDeg + angleOffsetDeg) * Math.PI) / 180;
  const mx = robotPosition.x + Math.sin(totalRad) * distanceM;
  const mz = robotPosition.z + Math.cos(totalRad) * distanceM;

  const labelSprite = useMemo(
    () => makeLabelSprite(`${label} · ~${distanceM}m`, color),
    [label, distanceM, color],
  );

  const guideLine = useMemo(() => {
    const points = [
      new THREE.Vector3(robotPosition.x, 0.04, robotPosition.z),
      new THREE.Vector3(mx, 0.04, mz),
    ];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineDashedMaterial({ color, dashSize: 0.15, gapSize: 0.1, transparent: true, opacity: 0.55 });
    const line = new THREE.Line(geometry, material);
    line.computeLineDistances();
    return line;
  }, [robotPosition.x, robotPosition.z, mx, mz, color]);

  return (
    <group>
      <primitive object={guideLine} />
      <mesh position={[mx, 0.02, mz]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.14, 0.19, 24]} />
        <meshBasicMaterial color={color} transparent opacity={0.85} toneMapped={false} />
      </mesh>
      <mesh position={[mx, 0.22, mz]}>
        <sphereGeometry args={[0.05, 12, 12]} />
        <meshStandardMaterial emissive={color} emissiveIntensity={1.2} color="#0c1322" />
      </mesh>
      <primitive object={labelSprite} position={[mx, 0.55, mz]} />
    </group>
  );
}