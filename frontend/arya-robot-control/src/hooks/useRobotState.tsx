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
  /** Movement commands latch on continuously until STOP or a new command
   * overrides them (used by voice + typed chat, and by the Live page's
   * hold buttons which relay to real hardware); gesture commands
   * (NAMASTE/WAVE/LOOK/SPEAK) play a short one-shot animation. */
  sendCommand: (command: VoiceCommand) => void;
  /** Press-and-hold movement for the on-screen D-pad / WASD: moves only
   * while the corresponding flag is true, and axes can combine into an arc. */
  setDrive: (partial: Partial<DriveFlags>) => void;
  eventBus: AryaEventBus;
  navigationTarget: NavigationTarget | null;
  driveToStation: (stationId: string, position: Vector3Like) => void;
  cancelNavigation: () => void;
  /** Automatic "Corridor Patrol": door -> corridor end -> door, hands-off. */
  patrolLeg: PatrolLeg;
  startPatrol: () => void;
  cancelPatrol: () => void;
}

const RobotStateContext = createContext<RobotStateContextValue | null>(null);

// Manual/voice drive tuning — smooth accel/decel like a real differential
// drive base, instead of a one-shot nudge per command.
const MAX_SPEED = 1.6; // m/s
const MAX_TURN = 100; // deg/s
const ACCEL = 3.2;
const TURN_ACCEL = 4.5;

// Autopilot tuning (station drive + corridor patrol).
const AUTO_MOVE_SPEED = 1.3; // m/s
const AUTO_TURN_SPEED = 140; // deg/s
const ARRIVE_DISTANCE = 0.25; // meters
const ARRIVE_HEADING = 4; // degrees

const GESTURE_COMMANDS = new Set<VoiceCommand>(["NAMASTE", "WAVE", "LOOK", "SPEAK"]);
const BATTERY_DRAIN_INTERVAL_MS = 45_000;

/** Forward vector for a given yaw (degrees): (sin, cos) — rotation 180
 * faces -Z, matching INITIAL_ROBOT_STATE and ChaseCamera's convention. */
function forwardVector(rotationDeg: number) {
  const rad = (rotationDeg * Math.PI) / 180;
  return { x: Math.sin(rad), z: Math.cos(rad) };
}

/** Heading (degrees) to face to move straight toward (dx, dz), matching forwardVector. */
function headingToDeg(dx: number, dz: number) {
  const deg = (Math.atan2(dx, dz) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Shortest signed angle (deg) from `from` to `to`, in (-180, 180]. */
function angleDiffDeg(from: number, to: number) {
  return ((to - from + 540) % 360) - 180;
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
  const curSpeedRef = useRef(0); // signed, +forward / -backward
  const curTurnRef = useRef(0); // signed deg/s, +left / -right
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
      // A manual drive input always takes priority over autopilot/patrol.
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

      // Movement commands latch on continuously: voice/chat has no natural
      // "release", so "Arya, turn left" should actually keep turning until
      // told to stop, not nudge a few degrees and quit.
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

  // ---------------------------------------------------------------------
  // Single continuous game loop — drives BOTH manual/voice input and
  // waypoint autopilot/patrol, so they never fight and every consumer
  // (buttons, voice, chat, automatic patrol) sees the same smooth, real
  // motion instead of a one-shot nudge.
  // ---------------------------------------------------------------------
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
              // First leg complete — turn around and head back to the door.
              patrolLegRef.current = "TO_DOOR";
              setPatrolLeg("TO_DOOR");
              navigationTargetRef.current = { stationId: "patrol", position: DOOR_POSITION };
              setNavigationTargetState(navigationTargetRef.current);
              action = "MOVING";
              speed = 0;
            } else {
              // Patrol's second leg, or a plain single-station drive, complete.
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
            const diff = angleDiffDeg(rotation, desiredHeading);

            if (Math.abs(diff) > ARRIVE_HEADING) {
              const turnStep = Math.min(AUTO_TURN_SPEED * dt, Math.abs(diff)) * Math.sign(diff);
              rotation = (rotation + turnStep + 360) % 360;
              action = "TURNING";
              speed = 0;
            } else {
              const fv = forwardVector(rotation);
              const moveStep = Math.min(AUTO_MOVE_SPEED * dt, distance);
              x += fv.x * moveStep;
              z += fv.z * moveStep;
              action = "MOVING";
              speed = AUTO_MOVE_SPEED;
            }
          }
          curSpeedRef.current = 0;
          curTurnRef.current = 0;
        } else {
          // Manual / voice-latched continuous drive with smooth accel/decel.
          const di = driveRef.current;
          const targetSpeed = (di.fwd ? MAX_SPEED : 0) + (di.back ? -MAX_SPEED : 0);
          const targetTurn = (di.left ? MAX_TURN : 0) + (di.right ? -MAX_TURN : 0);
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
          // else: a gesture is mid-animation — leave `action` alone.
        }

                let battery = prev.battery;
        if (now - lastBatteryDrainRef.current > BATTERY_DRAIN_INTERVAL_MS) {
          lastBatteryDrainRef.current = now;
          if (battery > 15) battery -= 1;
        }

        // Distance actually driven this frame, from BOTH branches above
        // (manual/voice drive and autopilot/patrol alike) -- so
        // distanceTraveledM is one running total no matter which mode
        // moved the robot.
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
