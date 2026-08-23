import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group, Mesh, MeshBasicMaterial } from "three";

interface AryaEyesProps {
  on: boolean;
  intensity?: number;
}

/** Two glowing filled eyes with a soft outer ring, matching ARYA's reference look. */
export function AryaEyes({ on, intensity = 1 }: AryaEyesProps) {
  const group = useRef<Group>(null);
  const pupils = useRef<(Mesh | null)[]>([]);
  const rings = useRef<(Mesh | null)[]>([]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const targetPupilOpacity = on ? 0.95 + Math.sin(t * 2.4) * 0.05 : 0;
    const targetRingOpacity = on ? 0.45 : 0;
    const targetScale = on ? 1 : 0.2;

    pupils.current.forEach((mesh) => {
      if (!mesh) return;
      const mat = mesh.material as MeshBasicMaterial;
      mat.opacity += (targetPupilOpacity * intensity - mat.opacity) * 0.15;
      mesh.scale.setScalar(mesh.scale.x + (targetScale - mesh.scale.x) * 0.15);
    });
    rings.current.forEach((mesh) => {
      if (!mesh) return;
      const mat = mesh.material as MeshBasicMaterial;
      mat.opacity += (targetRingOpacity * intensity - mat.opacity) * 0.15;
    });
  });

  return (
    <group ref={group} position={[0, 0, 0.06]}>
      {[-0.11, 0.11].map((x, i) => (
        <group key={i} position={[x, 0, 0]}>
          {/* soft white outer ring, like the reference's eye housing */}
          <mesh ref={(el) => { rings.current[i] = el; }}>
            <ringGeometry args={[0.058, 0.074, 32]} />
            <meshBasicMaterial color="#e8edf6" transparent opacity={0} toneMapped={false} />
          </mesh>
          {/* filled glowing blue pupil */}
          <mesh ref={(el) => { pupils.current[i] = el; }} position={[0, 0, 0.001]}>
            <circleGeometry args={[0.05, 32]} />
            <meshBasicMaterial color="#38d3ff" transparent opacity={0} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
