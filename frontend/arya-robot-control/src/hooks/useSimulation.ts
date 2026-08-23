import { useEffect, useRef, useState } from "react";
import type { Vector3Like } from "../types/robot";
import { useRobotState } from "./useRobotState";

// The drive engine now updates position every animation frame (continuous
// movement) rather than once per discrete command, so trail points are
// sampled by distance travelled — not by "did position change" — otherwise
// a couple of seconds of driving would fill the whole buffer. At this
// spacing/length the trail can show the full ~50m door<->corridor-end round
// trip during an automatic patrol.
const MIN_POINT_SPACING = 0.25; // meters
const MAX_TRAIL_POINTS = 260;

/** Adds a movement trail + selected-station UI state on top of the shared robot state. */
export function useSimulation() {
  const {
    robot,
    sendCommand,
    setDrive,
    navigationTarget,
    driveToStation,
    cancelNavigation,
    patrolLeg,
    startPatrol,
    cancelPatrol,
  } = useRobotState();
  const [trail, setTrail] = useState<Vector3Like[]>([robot.position]);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const lastTrailPos = useRef(robot.position);

  useEffect(() => {
    const d = Math.hypot(robot.position.x - lastTrailPos.current.x, robot.position.z - lastTrailPos.current.z);
    if (d > MIN_POINT_SPACING) {
      lastTrailPos.current = robot.position;
      setTrail((prev) => [...prev.slice(-MAX_TRAIL_POINTS + 1), robot.position]);
    }
  }, [robot.position]);

  return {
    robot,
    sendCommand,
    setDrive,
    trail,
    selectedStationId,
    setSelectedStationId,
    navigationTarget,
    driveToStation,
    cancelNavigation,
    patrolLeg,
    startPatrol,
    cancelPatrol,
  };
}