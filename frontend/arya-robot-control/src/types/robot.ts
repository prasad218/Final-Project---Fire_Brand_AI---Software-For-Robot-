// Core robot state types.
// This shape is designed to be filled later by a real WebSocket/API
// source without requiring any change to the components that consume it.

export type RobotMode = "HOME" | "LIVE" | "SIMULATION" | "TALK";

export type RobotAction =
  | "IDLE"
  | "MOVING"
  | "TURNING"
  | "STOPPED"
  | "NAMASTE"
  | "WAVE"
  | "LISTENING"
  | "SPEAKING"
  | "LOOK";

export type VoiceCommand =
  | "MOVE_FORWARD"
  | "MOVE_BACKWARD"
  | "TURN_LEFT"
  | "TURN_RIGHT"
  | "STOP"
  | "NAMASTE"
  | "WAVE"
  | "LOOK"
  | "SPEAK";

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export interface RobotState {
  name: string;
  mode: RobotMode;
  action: RobotAction;
  battery: number; // 0 - 100
  temperature: number; // celsius, cosmetic telemetry
  speed: number; // m/s
  position: Vector3Like;
  rotation: number; // degrees, yaw
  /** Running total of meters actually driven (Controls, Voice, and
   * Automatic all accumulate into this the same way) -- resets only on
   * a full page reload, not between drive modes. */
  distanceTraveledM: number;
  cameraActive: boolean;
  voiceReady: boolean;
  online: boolean;
}

export type SystemModuleId =
  | "CORE_SYSTEM"
  | "VISION_ENGINE"
  | "VOICE_INTERFACE"
  | "BEHAVIOUR_ENGINE"
  | "SIMULATION_ENGINE";

export type SystemModuleStatus = "PENDING" | "INITIALIZING" | "OK";

export interface SystemModule {
  id: SystemModuleId;
  label: string;
  status: SystemModuleStatus;
}

export interface StationDefinition {
  id: string;
  name: string;
  position: Vector3Like;
  color: string;
}

export interface WaypointDefinition {
  id: string;
  stationId: string;
  position: Vector3Like;
}
