import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { DirectionalLight } from "three";
import type { Vector3Like } from "../types/robot";

interface CorridorLightingProps {
  position: Vector3Like;
}

/** Warm indoor lighting: soft ambient bounce + an overhead light that tracks
 * the robot (standing in for the corridor's own ceiling strip lights), so
 * shadows stay tight and correctly lit as the robot roams the ~44m corridor. */
export function CorridorLighting({ position }: CorridorLightingProps) {
  const sun = useRef<DirectionalLight>(null);
  const target = useRef<DirectionalLight>(null);

  useFrame(() => {
    if (sun.current) {
      sun.current.position.set(position.x + 0.6, position.y + 5.5, position.z + 1.4);
      sun.current.target.position.set(position.x, position.y, position.z);
      sun.current.target.updateMatrixWorld();
    }
  });

  return (
    <>
      <hemisphereLight args={["#fff6e6", "#2a241c", 0.65]} />
      <directionalLight
        ref={sun}
        position={[0, 5.5, 2]}
        intensity={0.95}
        color="#fff2df"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-3.4}
        shadow-camera-right={3.4}
        shadow-camera-top={3.4}
        shadow-camera-bottom={-3.4}
        shadow-camera-near={1}
        shadow-camera-far={14}
        shadow-bias={-0.0015}
      />
      <directionalLight ref={target} position={[-4, 3, -4]} intensity={0.3} color="#d8e4ea" />
    </>
  );
}
