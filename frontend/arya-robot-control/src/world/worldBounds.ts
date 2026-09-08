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
  { cx: -1.6, cz: 3.0, halfW: 0.35, halfD: 0.35, rotY: 0 }, // pillar planter
  { cx: 1.6, cz: 3.0, halfW: 0.35, halfD: 0.35, rotY: 0 }, // pillar planter
  { cx: -WORLD.lobbyHalfW + 1.0, cz: 1.2, halfW: 0.9, halfD: 0.5, rotY: Math.PI / 2 }, // sofa
  { cx: WORLD.lobbyHalfW - 1.6, cz: -0.6, halfW: 0.8, halfD: 0.5, rotY: -Math.PI / 2 }, // sofa
];

/** True if (x, z) is inside any furniture obstacle's footprint (inflated
 * by `pad`). Used for movement validity — can the robot occupy this exact
 * point. */
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
 * clear of furniture. */
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

/** Repulsion vector pointing AWAY from every obstacle within
 * `influenceRadius` of (x, z), stronger the closer you are (1 at the
 * obstacle's padded edge, fading to 0 at the influence radius). This
 * replaces the old binary "probe left/right, freeze if both blocked"
 * check — that approach could get stuck when an obstacle (like a pillar)
 * sat almost directly on the path to the target, because both probes
 * would come back "blocked" and there was no fallback except stopping.
 * A continuous field has no such dead end: it always produces SOME
 * steering direction, even when very close to an obstacle. */
export function obstacleRepulsion(x: number, z: number, influenceRadius = 1.4): { rx: number; rz: number } {
  let rx = 0;
  let rz = 0;
  for (const o of OBSTACLES) {
    const dx = x - o.cx;
    const dz = z - o.cz;
    const cos = Math.cos(-o.rotY);
    const sin = Math.sin(-o.rotY);
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;
    const clx = Math.max(-o.halfW, Math.min(o.halfW, lx));
    const clz = Math.max(-o.halfD, Math.min(o.halfD, lz));
    const nlx = lx - clx;
    const nlz = lz - clz;
    const cos2 = Math.cos(o.rotY);
    const sin2 = Math.sin(o.rotY);
    const wx = nlx * cos2 - nlz * sin2;
    const wz = nlx * sin2 + nlz * cos2;
    const dist = Math.hypot(wx, wz);
    if (dist > 0.001 && dist < influenceRadius) {
      const strength = (influenceRadius - dist) / influenceRadius;
      rx += (wx / dist) * strength;
      rz += (wz / dist) * strength;
    } else if (dist <= 0.001) {
      // query point is exactly on/inside the box surface — push out along
      // the box's local +X as a safe fallback direction.
      rx += cos2;
      rz += sin2;
    }
  }
  return { rx, rz };
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