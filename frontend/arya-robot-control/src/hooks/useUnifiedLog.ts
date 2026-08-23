import { useEffect, useRef, useState } from "react";
import type { RobotAction, Vector3Like } from "../types/robot";
import type { PatrolLeg } from "./useRobotState";
import type { LiveLogEntry } from "../types/vision";

const MAX_ENTRIES = 60;
const DISTANCE_MILESTONE_M = 1; // log a line every extra meter driven

function nowStamp(): string {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

let clientLogSeq = 0;
function makeEntry(message: string): LiveLogEntry {
  clientLogSeq += 1;
  return { id: `client-${Date.now()}-${clientLogSeq}`, timestamp: nowStamp(), message };
}

/**
 * The backend's own log (vision/face-recognition/chat events) has no idea
 * ARYA's 3D twin is moving -- there's no physical robot reporting real
 * telemetry, so movement only exists client-side. This hook watches the
 * shared robot state for movement/patrol events and appends matching log
 * lines ("Moved 1.0m (total 4.0m)", "Automatic patrol started", ...),
 * merged in arrival order with whatever the backend sends, so one panel
 * shows both.
 */
export function useUnifiedLog(
  backendLog: LiveLogEntry[],
  action: RobotAction,
  distanceTraveledM: number,
  position: Vector3Like,
  patrolLeg: PatrolLeg,
): LiveLogEntry[] {
  const [combined, setCombined] = useState<LiveLogEntry[]>([]);
  const seenBackendIds = useRef<Set<string>>(new Set());
  const lastAction = useRef<RobotAction>(action);
  const lastMilestone = useRef(0);
  const lastPatrolLeg = useRef<PatrolLeg>(null);

  function push(message: string) {
    setCombined((prev) => [...prev.slice(-MAX_ENTRIES + 1), makeEntry(message)]);
  }

  // Pull in only the backend entries we haven't already merged (it resends
  // its whole recent buffer on every snapshot).
  useEffect(() => {
    const fresh = backendLog.filter((e) => !seenBackendIds.current.has(e.id));
    if (fresh.length === 0) return;
    fresh.forEach((e) => seenBackendIds.current.add(e.id));
    setCombined((prev) => [...prev.slice(-MAX_ENTRIES + fresh.length), ...fresh].slice(-MAX_ENTRIES));
  }, [backendLog]);

  // Drive start/stop.
  useEffect(() => {
    const prevAction = lastAction.current;
    lastAction.current = action;
    const wasDriving = prevAction === "MOVING" || prevAction === "TURNING";
    const isDriving = action === "MOVING" || action === "TURNING";
    if (!wasDriving && isDriving) {
      push(action === "MOVING" ? "ARYA started moving" : "ARYA started turning");
    } else if (wasDriving && !isDriving) {
      push(`ARYA stopped — ${distanceTraveledM.toFixed(1)}m driven this session`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  // Distance milestones, independent of exactly when it stopped/started.
  useEffect(() => {
    if (distanceTraveledM - lastMilestone.current >= DISTANCE_MILESTONE_M) {
      lastMilestone.current = Math.floor(distanceTraveledM);
      push(`Distance traveled: ${distanceTraveledM.toFixed(1)}m (position ${position.x.toFixed(1)}, ${position.z.toFixed(1)})`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [distanceTraveledM]);

  // Automatic Corridor Patrol progress.
  useEffect(() => {
    const prev = lastPatrolLeg.current;
    lastPatrolLeg.current = patrolLeg;
    if (!prev && patrolLeg === "TO_CORRIDOR_END") {
      push("Automatic patrol started — heading to corridor end");
    } else if (prev === "TO_CORRIDOR_END" && patrolLeg === "TO_DOOR") {
      push("Reached corridor end — returning to door");
    } else if (prev && !patrolLeg) {
      push("Automatic patrol complete — back at the door");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patrolLeg]);

  return combined;
}