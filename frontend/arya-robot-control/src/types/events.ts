// Future event system.
// These events are the contract the eventual Vision / Voice / AI / Behaviour
// services will speak. Nothing in this phase dispatches them over a real
// transport (WebSocket, SSE, etc.) — mock services simulate them locally so
// the UI already reacts to the right shape of data.

export type AryaEventType =
  | "PERSON_DETECTED"
  | "PERSON_LEFT"
  | "FACE_DETECTED"
  | "FACE_RECOGNIZED"
  | "OBJECT_DETECTED"
  | "VOICE_COMMAND"
  | "AI_RESPONSE"
  | "GREETING_QUEUED"
  | "GREETING_STARTED"
  | "GREETING_COMPLETED"
  | "ROBOT_MOVING"
  | "ROBOT_STOPPED"
  | "ROBOT_TURNING"
  | "SYSTEM_READY"
  | "SYSTEM_ERROR";

export interface AryaEvent<TPayload = unknown> {
  type: AryaEventType;
  timestamp: number;
  payload?: TPayload;
}

export type AryaEventListener = (event: AryaEvent) => void;

/** Minimal typed pub/sub bus. Swappable later for a real WebSocket client. */
export class AryaEventBus {
  private listeners = new Set<AryaEventListener>();

  subscribe(listener: AryaEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: AryaEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }
}
