import { AryaEyes } from "./AryaEyes";

interface AryaHeadProps {
  eyesOn: boolean;
  lookOffset?: [number, number];
}

/**
 * Rounded white head with a flat face-screen sitting flush against the front
 * surface. (Previously the screen was a partial sphere offset far enough
 * forward that it poked through the head's own surface — this flat disc
 * can't ever protrude, by construction.)
 */
export function AryaHead({ eyesOn, lookOffset = [0, 0] }: AryaHeadProps) {
  return (
    <group position={[0, 1.63, 0]}>
      {/* head shell */}
      <mesh castShadow>
        <sphereGeometry args={[0.3, 32, 32]} />
        <meshStandardMaterial color="#eef1f6" roughness={0.3} metalness={0.15} />
      </mesh>

      {/* flat face-screen, flush with the head's front surface (radius 0.3) */}
      <group position={[lookOffset[0] * 0.04, lookOffset[1] * 0.03, 0.285]}>
        <mesh>
          <circleGeometry args={[0.2, 40]} />
          <meshStandardMaterial color="#050912" roughness={0.25} metalness={0.35} />
        </mesh>
        <group position={[0, 0, 0.006]}>
          <AryaEyes on={eyesOn} />
        </group>
      </group>

      {/* small forehead camera lens */}
      <mesh position={[0, 0.27, 0.11]}>
        <sphereGeometry args={[0.018, 12, 12]} />
        <meshStandardMaterial color="#0a0e18" roughness={0.15} metalness={0.6} />
      </mesh>
    </group>
  );
}
