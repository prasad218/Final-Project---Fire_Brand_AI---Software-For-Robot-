import { useMemo } from "react";
import { buildEnvironmentGroup } from "./CorridorEnvironment.build";

/** Builds the corridor+lobby THREE.Group once and mounts it into the R3F scene graph. */
export function CorridorEnvironment() {
  const group = useMemo(() => buildEnvironmentGroup(), []);
  return <primitive object={group} />;
}
