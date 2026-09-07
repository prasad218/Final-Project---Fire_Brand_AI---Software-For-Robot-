import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RobotMode, RobotState, VoiceCommand, Vector3Like } from "../types/robot";
import { applyGesture, INITIAL_ROBOT_STATE, settleAction } from "../services/mock/mockRobot";
import { AryaEventBus, type AryaEvent } from "../types/events";
import { isWalkable, DOOR_POSITION, CORRIDOR_END_POSITION } from "../world/worldBounds";

export interface NavigationTarget {
  stationId: string;
  position: Vector3Like;
}

export interface DriveFlags {
  fwd: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
}

export type PatrolLeg = "TO_CORRIDOR_END" | "TO_DOOR" | null;

interface RobotStateContextValue {
  robot: RobotState;
  setMode: (mode: RobotMode) => void;
  sendCommand: (command: VoiceCommand) => void;
  setDrive: (partial: Partial<DriveFlags>) => void;
  eventBus: AryaEventBus;
  navigationTarget: NavigationTarget | null;
  driveToStation: (stationId: string, position: Vector3Like) => void;
  cancelNavigation: () => void;
  patrolLeg: PatrolLeg;
  startPatrol: () => void;
  cancelPatrol: () => void;
}

const RobotStateContext = createContext<RobotStateContextValue | null>(null);

const MAX_SPEED = 1.6;
const MAX_TURN = 100;
const ACCEL = 3.2;
const TURN_ACCEL = 4.5;

const AUTO_MOVE_SPEED = 1.3;
const AUTO_TURN_SPEED = 140;
const ARRIVE_DISTANCE = 0.25;
const ARRIVE_HEADING = 4;

// Obstacle-avoidance tuning (walls, pillars, reception desk, anything
// isWalkable() rejects). Used by BOTH manual/voice drive and the
// autopilot/patrol branch below, so neither one just freezes when
// blocked.
const AVOID_LOOKAHEAD = 0.9;
const AVOID_PROBE_ANGLE = 35;
const AVOID_TURN_SPEED = 110;
const AVOID_SLOWDOWN = 0.35;

const GESTURE_COMMANDS = new Set<VoiceCommand>(["NAMASTE", "WAVE", "LOOK", "SPEAK"]);
const BATTERY_DRAIN_INTERVAL_MS = 45_000;

function forwardVector(rotationDeg: number) {
  const rad = (rotationDeg * Math.PI) / 180;
  return { x: Math.sin(rad), z: Math.cos(rad) };
}

function headingToDeg(dx: number, dz: number) {
  const deg = (Math.atan2(dx, dz) * 180) / Math.PI;
  return (deg + 360) % 360;
}

function angleDiffDeg(from: number, to: number) {
  return ((to - from + 540) % 360) - 180;
}

/** Given a current heading, checks straight ahead for an obstacle/wall.
 * If blocked, picks whichever of {left probe, right probe} is clear and
 * returns a turn direction (+1 = left, -1 = right) to steer that way;
 * returns null if the way ahead is clear. */
function pickAvoidTurn(x: number, z: number, rotation: number): 1 | -1 | null {
  const fv = forwardVector(rotation);
  const aheadX = x + fv.x * AVOID_LOOKAHEAD;
  const aheadZ = z + fv.z * AVOID_LOOKAHEAD;
  if (isWalkable(aheadX, aheadZ)) return null;

  const leftFv = forwardVector(rotation + AVOID_PROBE_ANGLE);
  const rightFv = forwardVector(rotation - AVOID_PROBE_ANGLE);
  const leftClear = isWalkable(x + leftFv.x * AVOID_LOOKAHEAD, z + leftFv.z * AVOID_LOOKAHEAD);
  const rightClear = isWalkable(x + rightFv.x * AVOID_LOOKAHEAD, z + rightFv.z * AVOID_LOOKAHEAD);

  if (leftClear && !rightClear) return 1;
  if (rightClear && !leftClear) return -1;
  return 1; // both/neither clear — default to steering left
}

export function RobotStateProvider({ children }: { children: ReactNode }) {
  const [robot, setRobot] = useState<RobotState>(INITIAL_ROBOT_STATE);
  const eventBusRef = useRef(new AryaEventBus());
  const gestureSettleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gestureActiveRef = useRef(false);

  const [navigationTarget, setNavigationTargetState] = useState<NavigationTarget | null>(null);
  const navigationTargetRef = useRef<NavigationTarget | null>(null);
  const [patrolLeg, setPatrolLeg] = useState<PatrolLeg>(null);
  const patrolLegRef = useRef<PatrolLeg>(null);

  const driveRef = useRef<DriveFlags>({ fwd: false, back: false, left: false, right: false });
  const curSpeedRef = useRef(0);
  const curTurnRef = useRef(0);
  const lastBatteryDrainRef = useRef(performance.now());

  const emit = useCallback((event: AryaEvent) => eventBusRef.current.emit(event), []);

  const setNavigationTarget = useCallback((target: NavigationTarget | null) => {
    navigationTargetRef.current = target;
    setNavigationTargetState(target);
  }, []);

  const setPatrol = useCallback((leg: PatrolLeg) => {
    patrolLegRef.current = leg;
    setPatrolLeg(leg);
  }, []);

  const setMode = useCallback((mode: RobotMode) => {
    setRobot((prev) => ({ ...prev, mode, cameraActive: mode === "LIVE" }));
  }, []);

  const hardStopDrive = useCallback(() => {
    driveRef.current = { fwd: false, back: false, left: false, right: false };
    curSpeedRef.current = 0;
    curTurnRef.current = 0;
  }, []);

  const cancelNavigation = useCallback(() => {
    setNavigationTarget(null);
  }, [setNavigationTarget]);

  const cancelPatrol = useCallback(() => {
    setPatrol(null);
    setNavigationTarget(null);
  }, [setPatrol, setNavigationTarget]);

  const setDrive = useCallback(
    (partial: Partial<DriveFlags>) => {
      if (navigationTargetRef.current) setNavigationTarget(null);
      if (patrolLegRef.current) setPatrol(null);
      driveRef.current = { ...driveRef.current, ...partial };
    },
    [setNavigationTarget, setPatrol],
  );

  const sendCommand = useCallback(
    (command: VoiceCommand) => {
      if (GESTURE_COMMANDS.has(command)) {
        gestureActiveRef.current = true;
        setRobot((prev) => applyGesture(prev, command));
        if (gestureSettleTimer.current) clearTimeout(gestureSettleTimer.current);
        gestureSettleTimer.current = setTimeout(() => {
          gestureActiveRef.current = false;
          setRobot((prev) => settleAction(prev));
        }, 900);
        return;
      }

      if (navigationTargetRef.current) setNavigationTarget(null);
      if (patrolLegRef.current) setPatrol(null);
      gestureActiveRef.current = false;

      switch (command) {
        case "MOVE_FORWARD":
          driveRef.current = { ...driveRef.current, fwd: true, back: false };
          emit({ type: "ROBOT_MOVING", timestamp: Date.now(), payload: { command } });
          break;
        case "MOVE_BACKWARD":
          driveRef.current = { ...driveRef.current, fwd: false, back: true };
          emit({ type: "ROBOT_MOVING", timestamp: Date.now(), payload: { command } });
          break;
        case "TURN_LEFT":
          driveRef.current = { ...driveRef.current, left: true, right: false };
          emit({ type: "ROBOT_TURNING", timestamp: Date.now(), payload: { command } });
          break;
        case "TURN_RIGHT":
          driveRef.current = { ...driveRef.current, left: false, right: true };
          emit({ type: "ROBOT_TURNING", timestamp: Date.now(), payload: { command } });
          break;
        case "STOP":
          hardStopDrive();
          emit({ type: "ROBOT_STOPPED", timestamp: Date.now() });
          break;
      }
    },
    [emit, hardStopDrive, setNavigationTarget, setPatrol],
  );

  const driveToStation = useCallback(
    (stationId: string, position: Vector3Like) => {
      hardStopDrive();
      setPatrol(null);
      setNavigationTarget({ stationId, position });
    },
    [hardStopDrive, setPatrol, setNavigationTarget],
  );

  const startPatrol = useCallback(() => {
    hardStopDrive();
    setPatrol("TO_CORRIDOR_END");
    setNavigationTarget({ stationId: "patrol", position: CORRIDOR_END_POSITION });
  }, [hardStopDrive, setPatrol, setNavigationTarget]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    function tick(now: number) {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      setRobot((prev) => {
        let { x, z } = prev.position;
        let rotation = prev.rotation;
        let speed = 0;
        let action = prev.action;

        const target = navigationTargetRef.current;
        if (target) {
          const dx = target.position.x - x;
          const dz = target.position.z - z;
          const distance = Math.hypot(dx, dz);

          if (distance < ARRIVE_DISTANCE) {
            if (patrolLegRef.current === "TO_CORRIDOR_END") {
              patrolLegRef.current = "TO_DOOR";
              setPatrolLeg("TO_DOOR");
              navigationTargetRef.current = { stationId: "patrol", position: DOOR_POSITION };
              setNavigationTargetState(navigationTargetRef.current);
              action = "MOVING";
              speed = 0;
            } else {
              if (patrolLegRef.current === "TO_DOOR") {
                patrolLegRef.current = null;
                setPatrolLeg(null);
              }
              navigationTargetRef.current = null;
              setNavigationTargetState(null);
              action = "IDLE";
              speed = 0;
              emit({ type: "ROBOT_STOPPED", timestamp: Date.now() });
            }
          } else {
            // Obstacle check comes FIRST, before the heading-seek logic —
            // this is the fix. Previously, hitting something here just
            // set action = "IDLE" and stopped dead with no steering.
            const avoidTurn = pickAvoidTurn(x, z, rotation);

            if (avoidTurn !== null) {
              rotation = (rotation + avoidTurn * AVOID_TURN_SPEED * dt + 360) % 360;
              action = "TURNING";
              speed = 0;
              emit({ type: "ROBOT_TURNING", timestamp: Date.now(), payload: { command: avoidTurn === 1 ? "TURN_LEFT" : "TURN_RIGHT" } });
            } else {
              const desiredHeading = headingToDeg(dx, dz);
              const diff = angleDiffDeg(rotation, desiredHeading);

              if (Math.abs(diff) > ARRIVE_HEADING) {
                const turnStep = Math.min(AUTO_TURN_SPEED * dt, Math.abs(diff)) * Math.sign(diff);
                rotation = (rotation + turnStep + 360) % 360;
                action = "TURNING";
                speed = 0;
              } else {
                const fv = forwardVector(rotation);
                const moveStep = Math.min(AUTO_MOVE_SPEED * dt, distance);
                const nx = x + fv.x * moveStep;
                const nz = z + fv.z * moveStep;
                if (isWalkable(nx, nz)) {
                  x = nx; z = nz;
                  action = "MOVING";
                  speed = AUTO_MOVE_SPEED;
                } else {
                  action = "IDLE";
                  speed = 0;
                }
              }
            }
          }
          curSpeedRef.current = 0;
          curTurnRef.current = 0;
        } else {
          const di = driveRef.current;
          let targetSpeed = (di.fwd ? MAX_SPEED : 0) + (di.back ? -MAX_SPEED : 0);
          let targetTurn = (di.left ? MAX_TURN : 0) + (di.right ? -MAX_TURN : 0);

          if (targetSpeed > 0) {
            const avoidTurn = pickAvoidTurn(x, z, rotation);
            if (avoidTurn !== null) {
              targetTurn = avoidTurn * AVOID_TURN_SPEED;
              targetSpeed *= AVOID_SLOWDOWN;
              action = "TURNING";
              emit({ type: "ROBOT_TURNING", timestamp: Date.now(), payload: { command: avoidTurn === 1 ? "TURN_LEFT" : "TURN_RIGHT" } });
            }
          }

          curSpeedRef.current += (targetSpeed - curSpeedRef.current) * Math.min(1, ACCEL * dt);
          curTurnRef.current += (targetTurn - curTurnRef.current) * Math.min(1, TURN_ACCEL * dt);
          if (Math.abs(curSpeedRef.current) < 0.01) curSpeedRef.current = 0;
          if (Math.abs(curTurnRef.current) < 0.05) curTurnRef.current = 0;

          rotation = (rotation + curTurnRef.current * dt + 360) % 360;
          const fv = forwardVector(rotation);
          const nx = x + fv.x * curSpeedRef.current * dt;
          const nz = z + fv.z * curSpeedRef.current * dt;
          if (isWalkable(nx, nz)) {
            x = nx; z = nz;
          } else if (isWalkable(nx, z)) {
            x = nx;
          } else if (isWalkable(x, nz)) {
            z = nz;
          }
          speed = Math.abs(curSpeedRef.current);

          const moving = Math.abs(curSpeedRef.current) > 0.02;
          const turning = Math.abs(curTurnRef.current) > 2;
          if (moving) action = "MOVING";
          else if (turning) action = "TURNING";
          else if (!gestureActiveRef.current) action = "IDLE";
        }

        let battery = prev.battery;
        if (now - lastBatteryDrainRef.current > BATTERY_DRAIN_INTERVAL_MS) {
          lastBatteryDrainRef.current = now;
          if (battery > 15) battery -= 1;
        }

        const stepDistance = Math.hypot(x - prev.position.x, z - prev.position.z);
        const distanceTraveledM = prev.distanceTraveledM + stepDistance;

        return { ...prev, position: { x, y: 0, z }, rotation, speed, action, battery, distanceTraveledM };
      });

      raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [emit]);

  const value = useMemo(
    () => ({
      robot,
      setMode,
      sendCommand,
      setDrive,
      eventBus: eventBusRef.current,
      navigationTarget,
      driveToStation,
      cancelNavigation,
      patrolLeg,
      startPatrol,
      cancelPatrol,
    }),
    [robot, setMode, sendCommand, setDrive, navigationTarget, driveToStation, cancelNavigation, patrolLeg, startPatrol, cancelPatrol],
  );

  return <RobotStateContext.Provider value={value}>{children}</RobotStateContext.Provider>;
}

export function useRobotState(): RobotStateContextValue {
  const ctx = useContext(RobotStateContext);
  if (!ctx) throw new Error("useRobotState must be used within a RobotStateProvider");
  return ctx;
} 