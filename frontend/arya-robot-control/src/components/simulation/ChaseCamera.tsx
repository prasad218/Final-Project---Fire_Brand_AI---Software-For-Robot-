import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { Vector3Like } from "../../types/robot";

interface ChaseCameraProps {
  position: Vector3Like;
  rotation: number; // degrees
}

/** Free orbit/zoom (drag to look around, scroll to zoom) with its target
 * continuously re-centred on ARYA, so she stays in view across the full
 * ~44m corridor instead of needing to be manually panned to. Frames in
 * behind her on mount/spawn so the corridor is visible immediately. */
export function ChaseCamera({ position, rotation }: ChaseCameraProps) {
  const controlsRef = useRef<import("three-stdlib").OrbitControls | null>(null);
  const { camera } = useThree();
  const framed = useRef(false);

  useEffect(() => {
    if (framed.current) return;
    framed.current = true;
    const rad = (rotation * Math.PI) / 180;
    // stand a few meters behind the robot's facing direction, looking at it
    camera.position.set(position.x - Math.sin(rad) * 4, 2.1, position.z - Math.cos(rad) * 4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame(() => {
    if (controlsRef.current) {
      controlsRef.current.target.set(position.x, 1.1, position.z);
      controlsRef.current.update();
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enablePan
      enableZoom
      minDistance={2.4}
      maxDistance={16}
      maxPolarAngle={Math.PI / 2.1}
    />
  );
}
