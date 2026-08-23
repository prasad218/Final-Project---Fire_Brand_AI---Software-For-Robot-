import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import type { RobotAction } from "../../types/robot";
import { useRobotAnimationController } from "./RobotAnimationController";
import { AryaHead } from "./AryaHead";
import { AryaBody } from "./AryaBody";
import { AryaArms } from "./AryaArms";
import { AryaBase } from "./AryaBase";

export interface AryaRobotProps {
  action?: RobotAction;
  eyesOn?: boolean;
  position?: [number, number, number];
  rotationY?: number; // degrees
  scale?: number;
}

/**
 * Procedural placeholder for ARYA. Once `public/models/arya.glb` exists,
 * swap the JSX below for a <primitive object={gltf.scene} /> — every
 * caller (Home, Live, Simulation, Talk) passes the same props shape.
 */
export function AryaRobot({
  action = "IDLE",
  eyesOn = true,
  position = [0, 0, 0],
  rotationY = 0,
  scale = 1,
}: AryaRobotProps) {
  const group = useRef<Group>(null);
  const pose = useRobotAnimationController(action);

  useFrame(() => {
    if (!group.current) return;
    group.current.position.y = position[1] + pose.bob;
    group.current.rotation.y = (rotationY * Math.PI) / 180;
    group.current.rotation.z = pose.tilt;
  });

  return (
    <group ref={group} position={[position[0], position[1], position[2]]} scale={scale}>
      <AryaHead eyesOn={eyesOn} lookOffset={pose.lookOffset} />
      <AryaBody active={eyesOn} />
      <AryaArms raisedRight={pose.raisedRight} namaste={pose.namaste} />
      <AryaBase />
    </group>
  );
}
