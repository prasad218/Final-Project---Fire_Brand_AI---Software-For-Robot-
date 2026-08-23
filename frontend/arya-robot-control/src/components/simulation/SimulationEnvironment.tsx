import { Suspense, useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import type * as THREE from "three";
import { AryaRobot } from "../robot/AryaRobot";
import { Station } from "./Station";
import { PathRenderer } from "./PathRenderer";
import { STATIONS } from "./stations";
import { CorridorEnvironment } from "../../world/CorridorEnvironment";
import { CorridorLighting } from "../../world/CorridorLighting";
import { ChaseCamera } from "./ChaseCamera";
import type { RobotAction, Vector3Like } from "../../types/robot";

interface SimulationEnvironmentProps {
  position: Vector3Like;
  rotation: number;
  action: RobotAction;
  trail: Vector3Like[];
  selectedStationId: string | null;
  onSelectStation: (id: string) => void;
}

export function SimulationEnvironment({
  position,
  rotation,
  action,
  trail,
  selectedStationId,
  onSelectStation,
}: SimulationEnvironmentProps) {
  // WebGL context loss happens for real on low-memory/mobile GPUs (not
  // just under emulation) -- without handling it, a dropped context
  // leaves the canvas permanently black until the page is reloaded.
  // preventDefault() on the loss event is what tells the browser it's
  // safe to restore the context automatically once resources free up.
  const onCreated = useCallback(({ gl }: { gl: THREE.WebGLRenderer }) => {
    const canvas = gl.domElement;
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      console.warn("[SimulationEnvironment] WebGL context lost — will restore automatically.");
    });
    canvas.addEventListener("webglcontextrestored", () => {
      console.info("[SimulationEnvironment] WebGL context restored.");
    });
  }, []);

  return (
    <Canvas
      camera={{ position: [0, 2.1, position.z + 4], fov: 55, near: 0.05, far: 200 }}
      shadows
      onCreated={onCreated}
    >
      <color attach="background" args={["#dfd6c2"]} />
      <fog attach="fog" args={["#e4dcc8", 14, 46]} />

      <CorridorLighting position={position} />

      <Suspense fallback={null}>
        <CorridorEnvironment />
      </Suspense>

      {STATIONS.map((station) => (
        <Station
          key={station.id}
          station={station}
          selected={selectedStationId === station.id}
          onSelect={() => onSelectStation(station.id)}
        />
      ))}

      <PathRenderer trail={trail} />

      <AryaRobot action={action} eyesOn position={[position.x, 0, position.z]} rotationY={rotation} />

      <ChaseCamera position={position} rotation={rotation} />
    </Canvas>
  );
}
