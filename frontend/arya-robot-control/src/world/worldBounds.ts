// Shared corridor/lobby footprint — reused by the environment mesh builder,
// the drive engine's wall collision, the minimap, and the automatic
// "corridor patrol" waypoints. Change dimensions here only.

export const WORLD = {
  lobbyHalfW: 5.4,
  lobbyFrontZ: 9.2, // entrance / door wall
  lobbyBackZ: -2.2, // opening into the corridor
  corrHalfW: 1.5,
  corrEndZ: -42, // far window wall
  wallH: 3.1,
  lobbyWallH: 3.6,
  bandH: 0.85,
} as const;

export const DOOR_POSITION = { x: 0, y: 0, z: 3.6 }; // just inside the entrance, clear of the chase camera's follow distance
export const CORRIDOR_END_POSITION = { x: 0, y: 0, z: WORLD.corrEndZ + 2.2 };

/** True if (x, z) is inside the walkable lobby+corridor footprint. */
export function isWalkable(x: number, z: number, pad = 0.34): boolean {
  const inLobby =
    x > -WORLD.lobbyHalfW + pad &&
    x < WORLD.lobbyHalfW - pad &&
    z > WORLD.lobbyBackZ + 0.05 &&
    z < WORLD.lobbyFrontZ - pad;
  const inCorr =
    x > -WORLD.corrHalfW + pad &&
    x < WORLD.corrHalfW - pad &&
    z <= WORLD.lobbyBackZ + 0.05 &&
    z > WORLD.corrEndZ + pad;
  return inLobby || inCorr;
}

/** Line segments (world-space) describing the building footprint, for the minimap. */
export const FLOORPLAN_SEGMENTS: [number, number, number, number][] = (() => {
  const { lobbyHalfW: lw, lobbyFrontZ: cf, lobbyBackZ: cb, corrHalfW: ch, corrEndZ: ce } = WORLD;
  return [
    [-lw, cf, -lw, cb],
    [lw, cf, lw, cb],
    [-lw, cf, -1.3, cf],
    [1.3, cf, lw, cf],
    [-lw, cb, -ch, cb],
    [ch, cb, lw, cb],
    [-ch, cb, -ch, ce],
    [ch, cb, ch, ce],
    [-ch, ce, ch, ce],
  ];
})();
