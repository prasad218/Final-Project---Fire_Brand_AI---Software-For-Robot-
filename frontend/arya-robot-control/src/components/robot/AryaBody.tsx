interface AryaBodyProps {
  active: boolean;
}

/** Torso: slim neck, chest shell with a glowing display, orange shoulder pauldrons, and a waist band. */
export function AryaBody({ active }: AryaBodyProps) {
  return (
    <group position={[0, 1.12, 0]}>
      {/* neck */}
      <mesh position={[0, 0.4, 0]}>
        <cylinderGeometry args={[0.07, 0.08, 0.14, 20]} />
        <meshStandardMaterial color="#d9dee8" roughness={0.4} metalness={0.15} />
      </mesh>

      {/* upper torso shell */}
      <mesh castShadow>
        <cylinderGeometry args={[0.24, 0.28, 0.5, 24]} />
        <meshStandardMaterial color="#eef1f6" roughness={0.35} metalness={0.1} />
      </mesh>

      {/* chest display */}
      <mesh position={[0, 0.02, 0.24]}>
        <boxGeometry args={[0.26, 0.18, 0.02]} />
        <meshStandardMaterial
          color="#050912"
          emissive="#38d3ff"
          emissiveIntensity={active ? 0.5 : 0.15}
          roughness={0.2}
        />
      </mesh>

      {/* orange shoulder pauldrons - larger + rounder, per reference */}
      {[-0.29, 0.29].map((x, i) => (
        <mesh key={i} position={[x, 0.19, 0]} castShadow>
          <sphereGeometry args={[0.135, 20, 20]} />
          <meshStandardMaterial color="#f0883e" roughness={0.4} metalness={0.35} />
        </mesh>
      ))}

      {/* waist band — deliberately larger than both neighbors and offset off
          their exact edges so it doesn't z-fight with the skirt or torso */}
      <mesh position={[0, -0.26, 0]}>
        <cylinderGeometry args={[0.285, 0.285, 0.05, 24]} />
        <meshStandardMaterial color="#f0883e" roughness={0.4} metalness={0.3} />
      </mesh>
    </group>
  );
}
