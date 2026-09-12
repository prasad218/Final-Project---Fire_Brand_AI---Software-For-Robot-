import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RobotMode, RobotState, VoiceCommand, Vector3Like } from "../types/robot";
import { applyGesture, INITIAL_ROBOT_STATE, settleAction } from "../services/mock/mockRobot";
import { AryaEventBus, type AryaEvent } from "../types/events";
import { isWalkable, obstacleRepulsion, DOOR_POSITION, CORRIDOR_END_POSITION } from "../world/worldBounds";

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

interface MoveNudge {
  remaining: number;
  dir: 1 | -1;
  elapsed: number;
}

interface TurnNudge {
  remainingDeg: number;
  dir: 1 | -1; // +1 left, -1 right
}

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

const OBSTACLE_INFLUENCE_RADIUS = 1.4;
const REPULSION_TURN_GAIN = 3;

// "Arya, move forward/backward" — a bounded NUDGE, not a continuous drive:
// walks a short fixed distance and stops itself.
const MOVE_NUDGE_DISTANCE = 1.2; // meters — roughly 2-3 steps
const MOVE_NUDGE_SPEED = 1.4; // m/s
const MOVE_NUDGE_MAX_SEC = 3;

// "Arya, turn left/right" — same idea: a bounded turn, not a timed
// continuous spin. At MAX_TURN (100°/s), the old 4-second auto-stop could
// rotate up to 400° — more than a full circle — before stopping, which
// looked like the robot "completely turning" instead of just turning.
const TURN_NUDGE_DEGREES = 30;
const TURN_NUDGE_SPEED = 90; // deg/s

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

function blendWithRepulsion(x: number, z: number, desiredHeading: number): { heading: number; repMag: number } {
  const { rx, rz } = obstacleRepulsion(x, z, OBSTACLE_INFLUENCE_RADIUS);
  const repMag = Math.hypot(rx, rz);
  if (repMag < 0.03) return { heading: desiredHeading, repMag: 0 };
  const repHeading = headingToDeg(rx, rz);
  const diffRep = angleDiffDeg(desiredHeading, repHeading);
  const blend = Math.min(1, repMag);
  const heading = (desiredHeading + diffRep * blend + 360) % 360;
  return { heading, repMag };
}

const GESTURE_COMMANDS = new Set<VoiceCommand>(["NAMASTE", "WAVE", "LOOK", "SPEAK"]);
const BATTERY_DRAIN_INTERVAL_MS = 45_000;

export function RobotStateProvider({ children }: { children: ReactNode }) {
  const [robot, setRobot] = useState<RobotState>(INITIAL_ROBOT_STATE);
  const eventBusRef = useRef(new AryaEventBus());
  const gestureSettleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gestureActiveRef = useRef(false);
  const moveNudgeRef = useRef<MoveNudge | null>(null);
  const nudgeTurnRef = useRef(0);
  const turnNudgeRef = useRef<TurnNudge | null>(null);

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
    moveNudgeRef.current = null;
    nudgeTurnRef.current = 0;
    turnNudgeRef.current = null;
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
      moveNudgeRef.current = null;
      nudgeTurnRef.current = 0;
      turnNudgeRef.current = null;
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

      // Every new command clears ALL prior drive state first — so nothing
      // from a previous command can linger and combine with the new one.
      driveRef.current = { fwd: false, back: false, left: false, right: false };
      moveNudgeRef.current = null;
      nudgeTurnRef.current = 0;
      turnNudgeRef.current = null;

      switch (command) {
        case "MOVE_FORWARD":
          moveNudgeRef.current = { remaining: MOVE_NUDGE_DISTANCE, dir: 1, elapsed: 0 };
          emit({ type: "ROBOT_MOVING", timestamp: Date.now(), payload: { command } });
          break;
        case "MOVE_BACKWARD":
          moveNudgeRef.current = { remaining: MOVE_NUDGE_DISTANCE, dir: -1, elapsed: 0 };
          emit({ type: "ROBOT_MOVING", timestamp: Date.now(), payload: { command } });
          break;
        case "TURN_LEFT":
          turnNudgeRef.current = { remainingDeg: TURN_NUDGE_DEGREES, dir: 1 };
          emit({ type: "ROBOT_TURNING", timestamp: Date.now(), payload: { command } });
          break;
        case "TURN_RIGHT":
          turnNudgeRef.current = { remainingDeg: TURN_NUDGE_DEGREES, dir: -1 };
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
            const desiredHeading = headingToDeg(dx, dz);
            const { heading: steerHeading, repMag } = blendWithRepulsion(x, z, desiredHeading);
            const diff = angleDiffDeg(rotation, steerHeading);
            const turnStep = Math.max(-AUTO_TURN_SPEED * dt, Math.min(AUTO_TURN_SPEED * dt, diff));
            rotation = (rotation + turnStep + 360) % 360;

            const turnFactor = Math.max(0.25, 1 - Math.abs(diff) / 90);
            const speedFactor = Math.max(0.3, 1 - repMag * 0.6);
            const moveSpeed = AUTO_MOVE_SPEED * turnFactor * speedFactor;
            const fv = forwardVector(rotation);
            const moveStep = Math.min(moveSpeed * dt, distance);
            const nx = x + fv.x * moveStep;
            const nz = z + fv.z * moveStep;

            if (isWalkable(nx, nz)) {
              x = nx; z = nz;
              action = Math.abs(diff) > 15 ? "TURNING" : "MOVING";
              speed = moveSpeed;
            } else if (isWalkable(nx, z)) {
              x = nx;
              action = "MOVING";
              speed = moveSpeed;
            } else if (isWalkable(x, nz)) {
              z = nz;
              action = "MOVING";
              speed = moveSpeed;
            } else {
              action = "TURNING";
              speed = 0;
            }
          }
          curSpeedRef.current = 0;
          curTurnRef.current = 0;
        } else if (turnNudgeRef.current) {
          // Bounded voice "turn left/right" — rotates a fixed amount then
          // stops on its own, instead of a timed continuous spin (which
          // at full turn speed could exceed a full 360° before stopping).
          const turnNudge = turnNudgeRef.current;
          const step = Math.min(TURN_NUDGE_SPEED * dt, turnNudge.remainingDeg);
          rotation = (rotation + step * turnNudge.dir + 360) % 360;
          turnNudge.remainingDeg -= step;

          if (turnNudge.remainingDeg <= 0.05) {
            turnNudgeRef.current = null;
            action = "IDLE";
            speed = 0;
            emit({ type: "ROBOT_STOPPED", timestamp: Date.now() });
          } else {
            action = "TURNING";
            speed = 0;
          }
          curSpeedRef.current = 0;
          curTurnRef.current = 0;
        } else if (moveNudgeRef.current) {
          // Bounded voice "move forward/backward" — walks a fixed
          // distance then stops on its own. Forward steering is DAMPED
          // (nudgeTurnRef eases toward the target turn rate, same
          // technique as manual drive's curTurnRef) instead of snapping
          // rotation straight to the raw repulsion direction every frame.
          // Backward never steers at all, since turning while reversing
          // pushes the robot INTO what's behind it.
          const nudge = moveNudgeRef.current;
          let repMag = 0;
          if (nudge.dir === 1) {
            const { rx, rz } = obstacleRepulsion(x, z, OBSTACLE_INFLUENCE_RADIUS);
            repMag = Math.hypot(rx, rz);
            let targetTurnRate = 0;
            if (repMag > 0.03) {
              const repHeading = headingToDeg(rx, rz);
              const diff = angleDiffDeg(rotation, repHeading);
              targetTurnRate = Math.max(-AUTO_TURN_SPEED, Math.min(AUTO_TURN_SPEED, diff * 2));
            }
            nudgeTurnRef.current += (targetTurnRate - nudgeTurnRef.current) * Math.min(1, TURN_ACCEL * dt);
            rotation = (rotation + nudgeTurnRef.current * dt + 360) % 360;
          } else {
            nudgeTurnRef.current = 0;
          }

          const speedFactor = Math.max(0.3, 1 - repMag * 0.6);
          const moveSpeed = MOVE_NUDGE_SPEED * speedFactor;
          const fv = forwardVector(rotation);
          const moveStep = Math.min(moveSpeed * dt, nudge.remaining);
          const nx = x + fv.x * moveStep * nudge.dir;
          const nz = z + fv.z * moveStep * nudge.dir;

          let moved = 0;
          if (isWalkable(nx, nz)) {
            x = nx; z = nz; moved = moveStep;
          } else if (isWalkable(nx, z)) {
            x = nx; moved = moveStep;
          } else if (isWalkable(x, nz)) {
            z = nz; moved = moveStep;
          }

          nudge.remaining -= moved;
          nudge.elapsed += dt;

          if (nudge.remaining <= 0.02 || nudge.elapsed > MOVE_NUDGE_MAX_SEC) {
            moveNudgeRef.current = null;
            nudgeTurnRef.current = 0;
            action = "IDLE";
            speed = 0;
            emit({ type: "ROBOT_STOPPED", timestamp: Date.now() });
          } else {
            action = "MOVING";
            speed = moveSpeed;
          }
          curSpeedRef.current = 0;
          curTurnRef.current = 0;
        } else {
          const di = driveRef.current;
          let targetSpeed = (di.fwd ? MAX_SPEED : 0) + (di.back ? -MAX_SPEED : 0);
          let targetTurn = (di.left ? MAX_TURN : 0) + (di.right ? -MAX_TURN : 0);

          if (targetSpeed > 0) {
            const { rx, rz } = obstacleRepulsion(x, z, OBSTACLE_INFLUENCE_RADIUS);
            const repMag = Math.hypot(rx, rz);
            if (repMag > 0.03) {
              const repHeading = headingToDeg(rx, rz);
              const diff = angleDiffDeg(rotation, repHeading);
              targetTurn += Math.max(-MAX_TURN, Math.min(MAX_TURN, diff * REPULSION_TURN_GAIN));
              targetSpeed *= Math.max(0.3, 1 - repMag * 0.6);
              action = "TURNING";
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