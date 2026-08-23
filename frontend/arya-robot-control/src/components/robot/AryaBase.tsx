/** Tapered skirt base with an orange rolling ring, evoking a wheeled platform. */
export function AryaBase() {
  return (
    <group position={[0, 0.42, 0]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.24, 0.42, 0.85, 28]} />
        <meshStandardMaterial color="#e4e8f0" roughness={0.4} metalness={0.08} />
      </mesh>
      {/* base ring */}
      <mesh position={[0, -0.42, 0]}>
        <cylinderGeometry args={[0.44, 0.44, 0.1, 28]} />
        <meshStandardMaterial color="#f0883e" roughness={0.4} metalness={0.3} />
      </mesh>
      {/* subtle wheel hints */}
      {[0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2].map((angle, i) => (
        <mesh
          key={i}
          position={[Math.sin(angle) * 0.4, -0.44, Math.cos(angle) * 0.4]}
          rotation={[0, angle, 0]}
        >
          <boxGeometry args={[0.1, 0.05, 0.05]} />
          <meshStandardMaterial color="#1c2230" roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}
