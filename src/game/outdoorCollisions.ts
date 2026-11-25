import {
  EnterableBuilding,
  HazardObstacle,
  TreeCollider,
  VillageDef,
  WallBox,
} from './types';

export interface CollisionResult2D {
  x: number;
  z: number;
  collided: boolean;
  normalX: number;
  normalZ: number;
}

export interface OutdoorCollisionContext {
  arenaRadius: number;
  buildings: readonly EnterableBuilding[];
  fenceWalls: readonly WallBox[];
  villages: readonly VillageDef[];
  obstacles: readonly HazardObstacle[];
  trees: readonly TreeCollider[];
  groundHeightAt: (x: number, z: number) => number;
}

/**
 * Local-space WallBox colliders for Mossy Forest Temple (`ruin_tower`) monolithic stone `upperAltar`.
 * Blocks all ground/courtyard penetration from back, left, and right while leaving the sloped
 * `altarRamp` (`X in [-1.52, 1.52], Z: 2.2 -> -0.2`) and `Temple Terrace` (`Y = 2.05`) climbable.
 */
export const RUIN_UPPER_ALTAR_WALLS: readonly WallBox[] = [
  { minX: -3.3, maxX: -1.52, minZ: -3.3, maxZ: -0.2, minY: 0, maxY: 1.72 },
  { minX: 1.52, maxX: 3.3, minZ: -3.3, maxZ: -0.2, minY: 0, maxY: 1.72 },
  { minX: -1.52, maxX: 1.52, minZ: -3.3, maxZ: -0.55, minY: 0, maxY: 1.72 },
  { minX: -1.52, maxX: 1.52, minZ: -0.55, maxZ: -0.2, minY: 0, maxY: 1.48 },
];

interface LocalCyl {
  x: number;
  z: number;
  r: number;
  minY: number;
  maxY: number;
}

const CABIN_PORCH_COLS: readonly LocalCyl[] = [
  { x: -2.4, z: 4.95, r: 0.18, minY: 0.18, maxY: 3.25 },
  { x: 2.4, z: 4.95, r: 0.18, minY: 0.18, maxY: 3.25 },
];

const MANOR_HAY_BALE: WallBox = {
  minX: -3.55,
  maxX: -2.25,
  minZ: -2.425,
  maxZ: -1.575,
  minY: 0.18,
  maxY: 0.98,
};

const MANOR_BARREL: LocalCyl = {
  x: -3.1,
  z: 1.9,
  r: 0.42,
  minY: 0.18,
  maxY: 1.2,
};

const VILLAGE_LAMP_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-6.2, 18],
  [6.2, 18],
  [-6.2, -18],
  [6.2, -18],
];

function worldToLocal(
  b: Pick<EnterableBuilding, 'x' | 'z' | 'rotation' | 'scale'>,
  wx: number,
  wz: number,
): { lx: number; lz: number } {
  const dx = wx - b.x;
  const dz = wz - b.z;
  const c = Math.cos(b.rotation);
  const s = Math.sin(b.rotation);
  return {
    lx: (dx * c - dz * s) / b.scale,
    lz: (dx * s + dz * c) / b.scale,
  };
}

function localToWorld(
  b: Pick<EnterableBuilding, 'x' | 'z' | 'rotation' | 'scale'>,
  lx: number,
  lz: number,
): { wx: number; wz: number } {
  const sx = lx * b.scale;
  const sz = lz * b.scale;
  const c = Math.cos(b.rotation);
  const s = Math.sin(b.rotation);
  return {
    wx: b.x + sx * c + sz * s,
    wz: b.z - sx * s + sz * c,
  };
}

function pushOutAabbXZ(
  px: number,
  pz: number,
  rad: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): CollisionResult2D | null {
  const cx = Math.max(minX, Math.min(px, maxX));
  const cz = Math.max(minZ, Math.min(pz, maxZ));
  const dx = px - cx;
  const dz = pz - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= rad * rad) return null;

  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const nz = dz / d;
    return {
      x: cx + nx * rad,
      z: cz + nz * rad,
      collided: true,
      normalX: nx,
      normalZ: nz,
    };
  }

  // Center lies inside the AABB: eject via nearest face
  const dLeft = px - minX;
  const dRight = maxX - px;
  const dTop = pz - minZ;
  const dBot = maxZ - pz;
  const minSide = Math.min(dLeft, dRight, dTop, dBot);
  if (minSide === dLeft) {
    return { x: minX - rad, z: pz, collided: true, normalX: -1, normalZ: 0 };
  }
  if (minSide === dRight) {
    return { x: maxX + rad, z: pz, collided: true, normalX: 1, normalZ: 0 };
  }
  if (minSide === dTop) {
    return { x: px, z: minZ - rad, collided: true, normalX: 0, normalZ: -1 };
  }
  return { x: px, z: maxZ + rad, collided: true, normalX: 0, normalZ: 1 };
}

function pushOutCircleXZ(
  px: number,
  pz: number,
  cx: number,
  cz: number,
  minDist: number,
  fallbackNx = 1,
  fallbackNz = 0,
): CollisionResult2D | null {
  const dx = px - cx;
  const dz = pz - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= minDist * minDist) return null;

  const d = Math.sqrt(d2);
  const nx = d > 1e-4 ? dx / d : fallbackNx;
  const nz = d > 1e-4 ? dz / d : fallbackNz;
  return {
    x: cx + nx * minDist,
    z: cz + nz * minDist,
    collided: true,
    normalX: nx,
    normalZ: nz,
  };
}

/**
 * Computes world-space center of a boulder's attached secondary sideRock matching
 * `createObstacleMesh` in Three.js (`mesh.rotation.y = obs.rotation`).
 */
export function getBoulderSideRockCenter(
  obs: Pick<HazardObstacle, 'x' | 'z' | 'rotation' | 'scale'>,
): { x: number; z: number; radius: number } {
  const c = Math.cos(obs.rotation);
  const s = Math.sin(obs.rotation);
  const ox = 0.68 * obs.scale;
  const oz = 0.34 * obs.scale;
  return {
    x: obs.x + c * ox + s * oz,
    z: obs.z - s * ox + c * oz,
    radius: 0.72 * obs.scale,
  };
}

/**
 * Computes rotated endpoints of a fallen log capsule matching `CylinderGeometry` rotated Z=PI/2
 * with Three.js `mesh.rotation.y = obs.rotation`.
 */
export function getFallenLogSegment(
  obs: Pick<HazardObstacle, 'x' | 'z' | 'rotation' | 'scale'>,
): { ax: number; az: number; bx: number; bz: number; radius: number } {
  const c = Math.cos(obs.rotation);
  const s = Math.sin(obs.rotation);
  const halfLen = 1.14 * obs.scale;
  return {
    ax: obs.x - c * halfLen,
    az: obs.z + s * halfLen,
    bx: obs.x + c * halfLen,
    bz: obs.z - s * halfLen,
    radius: 0.59 * obs.scale,
  };
}

export function resolveBuildingWallsTS(
  x: number,
  y: number,
  z: number,
  radius: number,
  buildings: readonly EnterableBuilding[],
  groundHeightAtFn: (gx: number, gz: number) => number,
): CollisionResult2D {
  let outX = x;
  let outZ = z;
  let collided = false;
  let normX = 0;
  let normZ = 0;

  for (let bi = 0; bi < buildings.length; bi++) {
    const b = buildings[bi];
    const maxReach = b.footprintRadius + radius + 1.0;
    const dxB = outX - b.x;
    const dzB = outZ - b.z;
    if (dxB * dxB + dzB * dzB > maxReach * maxReach) continue;

    const baseTerrainY = groundHeightAtFn(b.x, b.z);
    const localY = (y - baseTerrainY) / b.scale;
    const localR = Math.max(0.12, radius / b.scale);
    let { lx, lz } = worldToLocal(b, outX, outZ);

    let localHit = false;
    let lnx = 0;
    let lnz = 0;

    for (let wi = 0; wi < b.walls.length; wi++) {
      const w = b.walls[wi];
      if (localY + 0.2 < w.minY || localY - 0.25 > w.maxY) continue;
      const hit = pushOutAabbXZ(lx, lz, localR, w.minX, w.maxX, w.minZ, w.maxZ);
      if (hit) {
        lx = hit.x;
        lz = hit.z;
        lnx += hit.normalX;
        lnz += hit.normalZ;
        localHit = true;
      }
    }

    if (b.kind === 'cabin') {
      for (let ci = 0; ci < CABIN_PORCH_COLS.length; ci++) {
        const col = CABIN_PORCH_COLS[ci];
        if (localY + 0.2 < col.minY || localY - 0.25 > col.maxY) continue;
        const hit = pushOutCircleXZ(lx, lz, col.x, col.z, localR + col.r);
        if (hit) {
          lx = hit.x;
          lz = hit.z;
          lnx += hit.normalX;
          lnz += hit.normalZ;
          localHit = true;
        }
      }
    } else if (b.kind === 'manor') {
      if (localY + 0.2 >= MANOR_HAY_BALE.minY && localY - 0.25 <= MANOR_HAY_BALE.maxY) {
        const hit = pushOutAabbXZ(
          lx,
          lz,
          localR,
          MANOR_HAY_BALE.minX,
          MANOR_HAY_BALE.maxX,
          MANOR_HAY_BALE.minZ,
          MANOR_HAY_BALE.maxZ,
        );
        if (hit) {
          lx = hit.x;
          lz = hit.z;
          lnx += hit.normalX;
          lnz += hit.normalZ;
          localHit = true;
        }
      }
      if (localY + 0.2 >= MANOR_BARREL.minY && localY - 0.25 <= MANOR_BARREL.maxY) {
        const hit = pushOutCircleXZ(lx, lz, MANOR_BARREL.x, MANOR_BARREL.z, localR + MANOR_BARREL.r);
        if (hit) {
          lx = hit.x;
          lz = hit.z;
          lnx += hit.normalX;
          lnz += hit.normalZ;
          localHit = true;
        }
      }
    }

    if (localHit) {
      collided = true;
      const worldPos = localToWorld(b, lx, lz);
      outX = worldPos.wx;
      outZ = worldPos.wz;
      const c = Math.cos(b.rotation);
      const s = Math.sin(b.rotation);
      normX += lnx * c + lnz * s;
      normZ += -lnx * s + lnz * c;
    }
  }

  const nLen = Math.hypot(normX, normZ);
  if (nLen > 1e-6) {
    normX /= nLen;
    normZ /= nLen;
  }

  return { x: outX, z: outZ, collided, normalX: normX, normalZ: normZ };
}

export function resolveWorldWallsAndVillagePropsTS(
  x: number,
  y: number,
  z: number,
  radius: number,
  fenceWalls: readonly WallBox[],
  villages: readonly VillageDef[],
  groundHeightAtFn: (gx: number, gz: number) => number,
): CollisionResult2D {
  let outX = x;
  let outZ = z;
  let collided = false;
  let normX = 0;
  let normZ = 0;

  for (let wi = 0; wi < fenceWalls.length; wi++) {
    const w = fenceWalls[wi];
    const baseY = groundHeightAtFn(
      (w.minX + w.maxX) * 0.5,
      (w.minZ + w.maxZ) * 0.5,
    );
    const localY = y - baseY;
    if (localY + 0.2 < w.minY || localY - 0.25 > w.maxY) continue;
    const hit = pushOutAabbXZ(outX, outZ, radius, w.minX, w.maxX, w.minZ, w.maxZ);
    if (hit) {
      outX = hit.x;
      outZ = hit.z;
      normX += hit.normalX;
      normZ += hit.normalZ;
      collided = true;
    }
  }

  const pierHalf = 0.78;
  for (let vi = 0; vi < villages.length; vi++) {
    const v = villages[vi];
    const dxV = outX - v.centerX;
    const dzV = outZ - v.centerZ;
    if (Math.abs(dxV) > v.halfW + 4.0 || Math.abs(dzV) > v.halfD + 4.0) continue;

    const minX = v.centerX - v.halfW;
    const maxX = v.centerX + v.halfW;
    const minZ = v.centerZ - v.halfD;
    const maxZ = v.centerZ + v.halfD;
    const cx = v.centerX;
    const cz = v.centerZ;
    const sGate = v.southGateHalfW;
    const eGate = v.sideGateHalfW;

    const gatePiers: Array<[number, number]> = [
      [cx - sGate, maxZ],
      [cx + sGate, maxZ],
      [cx - sGate, minZ],
      [cx + sGate, minZ],
      [minX, cz - eGate],
      [minX, cz + eGate],
      [maxX, cz - eGate],
      [maxX, cz + eGate],
    ];

    for (let pi = 0; pi < gatePiers.length; pi++) {
      const [px, pz] = gatePiers[pi];
      if (Math.abs(outX - px) > pierHalf + radius + 0.5 || Math.abs(outZ - pz) > pierHalf + radius + 0.5) {
        continue;
      }
      const gy = groundHeightAtFn(px, pz);
      if (y + 0.2 < gy || y - 0.25 > gy + 3.9) continue;
      const hit = pushOutAabbXZ(
        outX,
        outZ,
        radius,
        px - pierHalf,
        px + pierHalf,
        pz - pierHalf,
        pz + pierHalf,
      );
      if (hit) {
        outX = hit.x;
        outZ = hit.z;
        normX += hit.normalX;
        normZ += hit.normalZ;
        collided = true;
      }
    }

    for (let li = 0; li < VILLAGE_LAMP_OFFSETS.length; li++) {
      const [ox, oz] = VILLAGE_LAMP_OFFSETS[li];
      const lx = cx + ox;
      const lz = cz + oz;
      const dxL = outX - lx;
      const dzL = outZ - lz;
      const poleMinDist = radius + 0.18;
      if (dxL * dxL + dzL * dzL >= poleMinDist * poleMinDist) continue;
      const ly = groundHeightAtFn(lx, lz);
      if (y + 0.2 < ly - 0.3 || y - 0.25 > ly + 3.2) continue;
      const hit = pushOutCircleXZ(outX, outZ, lx, lz, poleMinDist);
      if (hit) {
        outX = hit.x;
        outZ = hit.z;
        normX += hit.normalX;
        normZ += hit.normalZ;
        collided = true;
      }
    }
  }

  const nLen = Math.hypot(normX, normZ);
  if (nLen > 1e-6) {
    normX /= nLen;
    normZ /= nLen;
  }

  return { x: outX, z: outZ, collided, normalX: normX, normalZ: normZ };
}

export function resolveOutdoorObstaclesAndTreesTS(
  x: number,
  y: number,
  z: number,
  radius: number,
  obstacles: readonly HazardObstacle[],
  trees: readonly TreeCollider[],
  groundHeightAtFn: (gx: number, gz: number) => number,
): CollisionResult2D {
  let outX = x;
  let outZ = z;
  let collided = false;
  let normX = 0;
  let normZ = 0;

  for (let oi = 0; oi < obstacles.length; oi++) {
    const obs = obstacles[oi];
    const quickReach = radius + 2.6 * obs.scale;
    if (Math.abs(outX - obs.x) > quickReach || Math.abs(outZ - obs.z) > quickReach) continue;

    const obsY = groundHeightAtFn(obs.x, obs.z);
    if (obs.kind === 'log') {
      if (y >= obsY + 1.15 * obs.scale) continue;
      const seg = getFallenLogSegment(obs);
      const abx = seg.bx - seg.ax;
      const abz = seg.bz - seg.az;
      const abLen2 = abx * abx + abz * abz;
      const t =
        abLen2 > 1e-6
          ? Math.max(0, Math.min(1, ((outX - seg.ax) * abx + (outZ - seg.az) * abz) / abLen2))
          : 0;
      const cx = seg.ax + t * abx;
      const cz = seg.az + t * abz;
      const s = Math.sin(obs.rotation);
      const c = Math.cos(obs.rotation);
      const hit = pushOutCircleXZ(outX, outZ, cx, cz, radius + seg.radius, s, c);
      if (hit) {
        outX = hit.x;
        outZ = hit.z;
        normX += hit.normalX;
        normZ += hit.normalZ;
        collided = true;
      }
    } else {
      // Boulder: primary mainRock + rotated attached sideRock
      if (y < obsY + 2.15 * obs.scale) {
        const mainMinDist = radius + 1.28 * obs.scale;
        const hitMain = pushOutCircleXZ(outX, outZ, obs.x, obs.z, mainMinDist);
        if (hitMain) {
          outX = hitMain.x;
          outZ = hitMain.z;
          normX += hitMain.normalX;
          normZ += hitMain.normalZ;
          collided = true;
        }
      }
      if (y < obsY + 1.45 * obs.scale) {
        const side = getBoulderSideRockCenter(obs);
        const hitSide = pushOutCircleXZ(outX, outZ, side.x, side.z, radius + side.radius);
        if (hitSide) {
          outX = hitSide.x;
          outZ = hitSide.z;
          normX += hitSide.normalX;
          normZ += hitSide.normalZ;
          collided = true;
        }
      }
    }
  }

  for (let ti = 0; ti < trees.length; ti++) {
    const tr = trees[ti];
    const effTreeRadius = Math.max(
      tr.radius,
      (tr.kind === 'oak' ? 1.16 : 0.84) * tr.scale,
    );
    const minDist = radius + effTreeRadius;
    if (Math.abs(outX - tr.x) > minDist || Math.abs(outZ - tr.z) > minDist) continue;
    const hit = pushOutCircleXZ(outX, outZ, tr.x, tr.z, minDist);
    if (hit) {
      outX = hit.x;
      outZ = hit.z;
      normX += hit.normalX;
      normZ += hit.normalZ;
      collided = true;
    }
  }

  const nLen = Math.hypot(normX, normZ);
  if (nLen > 1e-6) {
    normX /= nLen;
    normZ /= nLen;
  }

  return { x: outX, z: outZ, collided, normalX: normX, normalZ: normZ };
}

export function resolveSolidPointTS(
  px: number,
  py: number,
  pz: number,
  radius: number,
  ctx: OutdoorCollisionContext,
): CollisionResult2D {
  let outX = px;
  let outZ = pz;
  let collided = false;
  let normX = 0;
  let normZ = 0;

  for (let pass = 0; pass < 2; pass++) {
    let passHit = false;

    const bHit = resolveBuildingWallsTS(outX, py, outZ, radius, ctx.buildings, ctx.groundHeightAt);
    if (bHit.collided) {
      outX = bHit.x;
      outZ = bHit.z;
      normX += bHit.normalX;
      normZ += bHit.normalZ;
      collided = true;
      passHit = true;
    }

    const wHit = resolveWorldWallsAndVillagePropsTS(
      outX,
      py,
      outZ,
      radius,
      ctx.fenceWalls,
      ctx.villages,
      ctx.groundHeightAt,
    );
    if (wHit.collided) {
      outX = wHit.x;
      outZ = wHit.z;
      normX += wHit.normalX;
      normZ += wHit.normalZ;
      collided = true;
      passHit = true;
    }

    const oHit = resolveOutdoorObstaclesAndTreesTS(
      outX,
      py,
      outZ,
      radius,
      ctx.obstacles,
      ctx.trees,
      ctx.groundHeightAt,
    );
    if (oHit.collided) {
      outX = oHit.x;
      outZ = oHit.z;
      normX += oHit.normalX;
      normZ += oHit.normalZ;
      collided = true;
      passHit = true;
    }

    const maxR = ctx.arenaRadius - Math.max(0.55, radius * 1.1);
    const rPos = Math.hypot(outX, outZ);
    if (rPos > maxR && rPos > 1e-4) {
      const nx = -outX / rPos;
      const nz = -outZ / rPos;
      outX = (outX / rPos) * maxR;
      outZ = (outZ / rPos) * maxR;
      normX += nx;
      normZ += nz;
      collided = true;
      passHit = true;
    }

    if (!passHit) break;
  }

  const nLen = Math.hypot(normX, normZ);
  if (nLen > 1e-6) {
    normX /= nLen;
    normZ /= nLen;
  }

  return { x: outX, z: outZ, collided, normalX: normX, normalZ: normZ };
}

/**
 * Resolves both the snake cranium sphere (centered at occipital pivot) and a forward
 * snout tip probe so the elongated snake jaw/nose never pokes visually into walls,
 * boulders, logs, temple stone blocks, or tree trunks.
 */
export function resolveHeadAndSnoutTS(
  headX: number,
  headY: number,
  headZ: number,
  heading: number,
  headRadius: number,
  snakeScale: number,
  ctx: OutdoorCollisionContext,
): CollisionResult2D {
  const baseHeadRad = headRadius * snakeScale * 1.02;
  const primary = resolveSolidPointTS(headX, headY, headZ, baseHeadRad, ctx);
  let outX = primary.x;
  let outZ = primary.z;
  let collided = primary.collided;
  let normX = primary.normalX;
  let normZ = primary.normalZ;

  const snoutReach = 0.52 * snakeScale;
  const snoutRad = 0.24 * snakeScale;
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const sx = outX + fx * snoutReach;
  const sz = outZ + fz * snoutReach;

  const snoutHit = resolveSolidPointTS(sx, headY, sz, snoutRad, ctx);
  if (snoutHit.collided) {
    outX += snoutHit.x - sx;
    outZ += snoutHit.z - sz;
    normX += snoutHit.normalX;
    normZ += snoutHit.normalZ;
    collided = true;

    const recheck = resolveSolidPointTS(outX, headY, outZ, baseHeadRad, ctx);
    if (recheck.collided) {
      outX = recheck.x;
      outZ = recheck.z;
      normX += recheck.normalX;
      normZ += recheck.normalZ;
    }
  }

  const nLen = Math.hypot(normX, normZ);
  if (nLen > 1e-6) {
    normX /= nLen;
    normZ /= nLen;
  }

  return { x: outX, z: outZ, collided, normalX: normX, normalZ: normZ };
}

/**
 * Pushes ALL active snake body segments (`0 .. segmentCount - 1`) outside every
 * solid building/temple/wall/boulder/log/tree collider so medium and giant tails
 * never pass inside geometry behind the head.
 */
export function enforceFullBodySolidClearance(
  snakeScale: number,
  segmentCount: number,
  playerPosesF32: Float32Array,
  ctx: OutdoorCollisionContext,
): void {
  const n = Math.min(segmentCount, Math.floor(playerPosesF32.length / 5));
  const minSkinRad = 0.14 * snakeScale;
  for (let i = 0; i < n; i++) {
    const off = i * 5;
    const px = playerPosesF32[off];
    const py = playerPosesF32[off + 1];
    const pz = playerPosesF32[off + 2];
    const rad = playerPosesF32[off + 4];
    const surfaceY = py - rad * 0.56;
    const effRad = Math.max(minSkinRad, rad * 0.96);
    const hit = resolveSolidPointTS(px, surfaceY, pz, effRad, ctx);
    if (hit.collided) {
      playerPosesF32[off] = hit.x;
      playerPosesF32[off + 2] = hit.z;
    }
  }
}
