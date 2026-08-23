import type { LiveLogEntry, RecognizedPerson } from "../../types/vision";

// NOTE: MOCK SERVICE. Values are illustrative placeholders standing in for a
// future YOLO / face-recognition pipeline. Nothing here inspects a real
// camera frame.

// Real detected objects are intentionally not mocked here: until an actual
// vision pipeline is wired in, the UI shows zero objects rather than a
// fake, always-on list (see DetectedObject in ../../types/vision).

export function createInitialPeople(): RecognizedPerson[] {
  const now = Date.now();
  return [
    { id: "person-shankar", name: "Shankar", status: "RECOGNIZED", firstSeenAt: now, lastSeenAt: now },
    { id: "person-unknown-1", name: "Unknown #01", status: "DETECTED", firstSeenAt: now, lastSeenAt: now },
  ];
}

export function timestamp(): string {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

export function makeLogEntry(message: string): LiveLogEntry {
  return { id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, timestamp: timestamp(), message };
}

/** A short, believable script the live log cycles through to feel alive. */
export const LIVE_LOG_SCRIPT: string[] = [
  "Person detected",
  "Face detected",
  "Shankar recognized",
  "Greeting behaviour triggered",
  "Namaste completed",
  "Voice command received",
  "MOVE_FORWARD",
  "Robot moving",
  "Scanning environment",
  "Obstacle clearance confirmed",
];
