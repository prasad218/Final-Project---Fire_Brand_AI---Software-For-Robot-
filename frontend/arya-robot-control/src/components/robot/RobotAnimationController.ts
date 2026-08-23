import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { RobotAction } from "../../types/robot";

export interface AnimationPose {
  bob: number;
  raisedRight: number;
  namaste: boolean;
  lookOffset: [number, number];
  tilt: number;
}

const poseRef: AnimationPose = { bob: 0, raisedRight: 0, namaste: false, lookOffset: [0, 0], tilt: 0 };

/** Procedural animation states: idle / move / turn / namaste / wave / speak / look. */
export function useRobotAnimationController(action: RobotAction): AnimationPose {
  const pose = useRef<AnimationPose>({ ...poseRef });

  useFrame(({ clock }, delta) => {
    const t = clock.getElapsedTime();
    const p = pose.current;

    const targetRaised = action === "WAVE" ? (Math.sin(t * 6) + 1) / 2 : action === "NAMASTE" ? 1 : 0;
    p.raisedRight += (targetRaised - p.raisedRight) * Math.min(1, delta * 6);
    p.namaste = action === "NAMASTE";

    p.bob = Math.sin(t * (action === "MOVING" ? 5 : 1.6)) * (action === "MOVING" ? 0.02 : 0.012);

    const targetTilt = action === "TURNING" ? Math.sin(t * 4) * 0.05 : 0;
    p.tilt += (targetTilt - p.tilt) * Math.min(1, delta * 5);

    const targetLook: [number, number] =
      action === "LOOK" ? [Math.sin(t * 1.2), Math.sin(t * 0.8) * 0.5] : [0, 0];
    p.lookOffset[0] += (targetLook[0] - p.lookOffset[0]) * Math.min(1, delta * 3);
    p.lookOffset[1] += (targetLook[1] - p.lookOffset[1]) * Math.min(1, delta * 3);
  });

  return pose.current;
}
