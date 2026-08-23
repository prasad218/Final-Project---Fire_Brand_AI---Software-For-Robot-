interface AryaArmsProps {
  raisedRight?: number; // 0 = resting, 1 = fully raised (wave / namaste)
  namaste?: boolean;
}

/** Two jointed arms: white upper arm, silver elbow + forearm, white hand — per reference. */
export function AryaArms({ raisedRight = 0, namaste = false }: AryaArmsProps) {
  const restAngle = 0.15;
  const raisedAngle = -2.1;
  const rightAngle = restAngle + (raisedAngle - restAngle) * raisedRight;
  const leftAngle = namaste ? -restAngle - (raisedAngle - restAngle) * raisedRight * 0.6 : restAngle;

  return (
    <group position={[0, 1.27, 0]}>
      {([-1, 1] as const).map((side) => {
        const isRight = side === 1;
        const angle = isRight ? -rightAngle : leftAngle;
        return (
          <group key={side} position={[0.3 * side, 0, 0]} rotation={[0, 0, angle]}>
            {/* upper arm */}
            <mesh position={[0, -0.13, 0]} castShadow>
              <capsuleGeometry args={[0.05, 0.16, 6, 12]} />
              <meshStandardMaterial color="#eef1f6" roughness={0.4} />
            </mesh>
            {/* elbow joint */}
            <mesh position={[0, -0.24, 0]}>
              <sphereGeometry args={[0.05, 14, 14]} />
              <meshStandardMaterial color="#b7bfcc" roughness={0.3} metalness={0.4} />
            </mesh>
            {/* forearm */}
            <mesh position={[0, -0.36, 0]} castShadow>
              <capsuleGeometry args={[0.042, 0.16, 6, 12]} />
              <meshStandardMaterial color="#c7ccd6" roughness={0.35} metalness={0.4} />
            </mesh>
            {/* hand */}
            <mesh position={[0, -0.47, 0]}>
              <sphereGeometry args={[0.045, 14, 14]} />
              <meshStandardMaterial color="#eef1f6" roughness={0.4} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
