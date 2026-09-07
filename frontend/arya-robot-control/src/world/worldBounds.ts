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

export const DOOR_POSITION = { x: 0, y: 0, z: 3.6 };
export const CORRIDOR_END_POSITION = { x: 0, y: 0, z: WORLD.corrEndZ + 2.2 };

interface RectObstacle {
  cx: number;
  cz: number;
  halfW: number;
  halfD: number;
  rotY: number;
}

const OBSTACLES: RectObstacle[] = [
  { cx: WORLD.lobbyHalfW - 1.5, cz: 3.4, halfW: 1.3, halfD: 0.45, rotY: Math.PI / 2 }, // reception desk
  { cx: -1.6, cz: 3.0, halfW: 0.3, halfD: 0.3, rotY: 0 }, // pillar planter
  { cx: 1.6, cz: 3.0, halfW: 0.3, halfD: 0.3, rotY: 0 }, // pillar planter
  { cx: -WORLD.lobbyHalfW + 1.0, cz: 1.2, halfW: 0.9, halfD: 0.5, rotY: Math.PI / 2 }, // sofa
  { cx: WORLD.lobbyHalfW - 1.6, cz: -0.6, halfW: 0.8, halfD: 0.5, rotY: -Math.PI / 2 }, // sofa
];

/** True if (x, z) is inside any furniture obstacle's footprint (inflated
 * by `pad`, the robot's collision radius). Used ONLY to decide whether to
 * trigger the steer-around behaviour — deliberately does NOT include the
 * outer walls, since treating wall-following as "an obstacle to steer
 * around" caused false triggers and pinning in the narrow corridor. */
export function isBlockedByObstacle(x: number, z: number, pad = 0.34): boolean {
  return OBSTACLES.some((o) => {
    const dx = x - o.cx;
    const dz = z - o.cz;
    const cos = Math.cos(-o.rotY);
    const sin = Math.sin(-o.rotY);
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;
    return Math.abs(lx) < o.halfW + pad && Math.abs(lz) < o.halfD + pad;
  });
}

/** True if (x, z) is inside the walkable lobby+corridor footprint AND
 * clear of furniture. Used for actual movement validity (can the robot
 * occupy this point at all) — includes both the outer walls and the
 * furniture obstacles. */
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

  if (!(inLobby || inCorr)) return false;
  return !isBlockedByObstacle(x, z, pad);
}

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