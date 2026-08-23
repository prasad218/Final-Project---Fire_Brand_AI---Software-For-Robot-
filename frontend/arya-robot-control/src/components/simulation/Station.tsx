import { useMemo } from "react";
import * as THREE from "three";
import type { StationDefinition } from "../../types/robot";

function makeLabelSprite(text: string, color: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.font = "600 30px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = 6;
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.9, 0.22, 1);
  return sprite;
}

interface StationProps {
  station: StationDefinition;
  selected: boolean;
  onSelect: () => void;
}

/** A slim floor beacon + floating label (a plain canvas sprite, not
 * drei's <Text> -- that pulls a font over the network via troika-three-text,
 * one fetch too many for a robot control UI that should still work
 * offline / behind a locked-down deployment network). Small enough to sit
 * in a ~3m-wide corridor or lobby without blocking the walkway. */
export function Station({ station, selected, onSelect }: StationProps) {
  const { x, z } = station.position;
  const label = useMemo(
    () => makeLabelSprite(station.name.toUpperCase(), selected ? station.color : "#90a0bd"),
    [station.name, station.color, selected],
  );

  return (
    <group position={[x, 0, z]} onClick={onSelect}>
      <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.28, 0.36, 32]} />
        <meshBasicMaterial color={station.color} transparent opacity={selected ? 0.95 : 0.45} toneMapped={false} />
      </mesh>

      <mesh position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 1, 8]} />
        <meshStandardMaterial
          color="#0c1322"
          emissive={station.color}
          emissiveIntensity={selected ? 1.1 : 0.5}
          roughness={0.3}
        />
      </mesh>
      <mesh position={[0, 1, 0]}>
        <sphereGeometry args={[0.05, 12, 12]} />
        <meshStandardMaterial emissive={station.color} emissiveIntensity={selected ? 1.4 : 0.7} color="#0c1322" />
      </mesh>

      <primitive object={label} position={[0, 1.3, 0]} />
    </group>
  );
}
