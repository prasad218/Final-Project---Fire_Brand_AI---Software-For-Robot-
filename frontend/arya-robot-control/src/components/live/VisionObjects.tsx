import type { DetectedObject } from "../../types/vision";

interface VisionObjectsProps {
  objects: DetectedObject[];
}

/**
 * Intentionally disabled — the "Objects Detected" panel has been
 * removed from the Live Robotics UI per product request. The
 * component is kept as a no-op (rather than deleted) so
 * LiveRobotics.tsx doesn't need to change if it still imports and
 * renders <VisionObjects objects={objects} /> somewhere.
 */
export function VisionObjects(_props: VisionObjectsProps) {
  return null;
}