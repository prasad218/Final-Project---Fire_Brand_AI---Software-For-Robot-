// Vision/perception types. These map to what a future YOLO/face-recognition
// service would emit. Only mock producers exist today.

export interface DetectedObject {
  id: string;
  label: string;
  count: number;
  /** Estimated distance (meters) to the closest instance of this label,
   * from the backend's monocular size-based estimate -- not a measured
   * depth reading. Undefined if the backend hasn't computed one yet. */
  nearestDistanceM?: number;
}

export type PersonRecognitionStatus =
  | "DETECTED"
  | "RECOGNIZED"
  | "GREETED"
  | "PRESENT"
  | "LEFT";

/** Normalized (0..1) bounding box, top-left origin -- resolution-independent
 * so the frontend doesn't need to know the camera's actual pixel size. */
export interface NormalizedBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RecognizedPerson {
  id: string;
  name: string;
  status: PersonRecognitionStatus;
  firstSeenAt: number; // epoch ms
  lastSeenAt: number; // epoch ms
  /** Estimated distance (meters), from the backend's monocular
   * size-based estimate (assumed height vs. on-screen box height) --
   * not a measured depth reading. Undefined until a body box lines up
   * with this person's face. */
  distanceM?: number;
  /** Normalized body-box position, for placing a marker left/right. */
  bbox?: NormalizedBBox;
}

export interface LiveLogEntry {
  id: string;
  timestamp: string; // HH:MM:SS, cosmetic
  message: string;
}