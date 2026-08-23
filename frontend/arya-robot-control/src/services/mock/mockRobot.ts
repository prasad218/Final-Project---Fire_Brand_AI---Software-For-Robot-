import type { RobotAction, RobotState, VoiceCommand } from "../../types/robot";
import { DOOR_POSITION } from "../../world/worldBounds";

// NOTE: MOCK SERVICE. No hardware, no real telemetry.
// This is designed to be dropped in favour of a real API/WebSocket client
// later; the public surface (INITIAL_ROBOT_STATE / applyGesture / settleAction)
// is what callers depend on, not the implementation.

// ARYA starts just inside the entrance door, facing straight down the
// lobby into the corridor (matches the reference walkthrough: door -> lobby
// -> corridor). Forward direction in this codebase is (sin(rotation),
// cos(rotation)) in degrees, so rotation 180 faces -Z.
export const INITIAL_ROBOT_STATE: RobotState = {
  name: "ARYA",
  mode: "HOME",
  action: "IDLE",
  battery: 92,
  temperature: 42,
  speed: 0,
  position: { ...DOOR_POSITION },
  rotation: 180,
  distanceTraveledM: 0,
  cameraActive: false,
  voiceReady: true,
  online: true,
};

/** Applies a one-shot gesture command (movement now goes through the
 * continuous drive engine in useRobotState.tsx, not here). */
export function applyGesture(state: RobotState, command: VoiceCommand): RobotState {
  switch (command) {
    case "NAMASTE":
      return { ...state, action: "NAMASTE", speed: 0 };
    case "WAVE":
      return { ...state, action: "WAVE", speed: 0 };
    case "LOOK":
      return { ...state, action: "LOOK", speed: 0 };
    case "SPEAK":
      return { ...state, action: "SPEAKING", speed: 0 };
    default:
      return state;
  }
}

export function settleAction(state: RobotState): RobotState {
  // After a transient gesture plays out, ARYA returns to idle -- but only
  // if she isn't already mid-drive (the continuous drive loop owns
  // MOVING/TURNING/IDLE once a manual or autopilot move is in progress).
  if (state.action === "NAMASTE" || state.action === "WAVE" || state.action === "LOOK" || state.action === "SPEAKING") {
    return { ...state, action: "IDLE" };
  }
  return state;
}

const BATTERY_DRAIN_INTERVAL_MS = 45_000;

export function driftBattery(state: RobotState): RobotState {
  if (state.battery <= 15) return state;
  return { ...state, battery: state.battery - 1 };
}

export { BATTERY_DRAIN_INTERVAL_MS };

export type { RobotAction };