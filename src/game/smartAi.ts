import {
  ARENA_RADIUS,
  VILLAGES,
  buildingLocalToWorld,
  getBuildingAtPosition,
  resolveBuildingWallCollision,
  resolveWorldWallsCollision,
  surfaceHeightAt,
  worldToBuildingLocal,
} from './buildings';
import {
  EnterableBuilding,
  Hatchling,
  HazardObstacle,
  PreyItem,
  TreeCollider,
  VillageDef,
  Villager,
} from './types';
import { snakeCoreWasm } from '../wasm/snakeCoreWasm';

export interface DoorRoute {
  approachLx: number;
  approachLz: number;
  approachX: number;
  approachZ: number;
  entryX: number;
  entryZ: number;
}

interface BuildingNavInfo {
  building: EnterableBuilding;
  doors: DoorRoute[];
}

interface HatchlingNavState {
  prevX: number;
  prevY: number;
  prevZ: number;
  prevHeading: number;
  prevTotalDist: number;
  stallTime: number;
  evadeTime: number;
  evadeDir: 1 | -1;
  overrideMotion: boolean;
  smartHeading: number;
  smartSpeed: number;
  desiredTargetVillagerId: number | null;
  desiredTargetPreyId: number | null;
  enforceTargets: boolean;
}

interface HumanNavState {
  prevX: number;
  prevY: number;
  prevZ: number;
  stallTime: number;
  evadeTime: number;
  evadeDir: 1 | -1;
}

function normAngle(a: number): number {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
}

function turnToward(cur: number, target: number, maxDelta: number): number {
  const diff = normAngle(target - cur);
  if (Math.abs(diff) <= maxDelta) return normAngle(target);
  return normAngle(cur + Math.sign(diff) * maxDelta);
}

function buildDoorNavInfo(buildings: readonly EnterableBuilding[]): BuildingNavInfo[] {
  return buildings.map((b) => {
    const doors: DoorRoute[] = [];
    if (b.kind === 'cabin') {
      const fApp = buildingLocalToWorld(b, 0, 7.1);
      const fEnt = buildingLocalToWorld(b, 0, 1.4);
      doors.push({
        approachLx: 0,
        approachLz: 7.1,
        approachX: fApp.wx,
        approachZ: fApp.wz,
        entryX: fEnt.wx,
        entryZ: fEnt.wz,
      });

      const sApp = buildingLocalToWorld(b, -5.8, 0);
      const sEnt = buildingLocalToWorld(b, -1.5, 0);
      doors.push({
        approachLx: -5.8,
        approachLz: 0,
        approachX: sApp.wx,
        approachZ: sApp.wz,
        entryX: sEnt.wx,
        entryZ: sEnt.wz,
      });
    } else if (b.kind === 'manor') {
      const fApp = buildingLocalToWorld(b, 0, 5.8);
      const fEnt = buildingLocalToWorld(b, 0, 1.4);
      doors.push({
        approachLx: 0,
        approachLz: 5.8,
        approachX: fApp.wx,
        approachZ: fApp.wz,
        entryX: fEnt.wx,
        entryZ: fEnt.wz,
      });

      const rApp = buildingLocalToWorld(b, 0, -5.8);
      const rEnt = buildingLocalToWorld(b, 0, -1.4);
      doors.push({
        approachLx: 0,
        approachLz: -5.8,
        approachX: rApp.wx,
        approachZ: rApp.wz,
        entryX: rEnt.wx,
        entryZ: rEnt.wz,
      });
    } else {
      const fApp = buildingLocalToWorld(b, 0, 4.6);
      const fEnt = buildingLocalToWorld(b, 0, 0.9);
      doors.push({
        approachLx: 0,
        approachLz: 4.6,
        approachX: fApp.wx,
        approachZ: fApp.wz,
        entryX: fEnt.wx,
        entryZ: fEnt.wz,
      });
    }
    return { building: b, doors };
  });
}

function nearestVillageGate(x: number, z: number, v: VillageDef): { x: number; z: number } {
  const gates = [
    { x: v.centerX, z: v.centerZ + v.halfD },
    { x: v.centerX, z: v.centerZ - v.halfD },
    { x: v.centerX - v.halfW, z: v.centerZ },
    { x: v.centerX + v.halfW, z: v.centerZ },
  ];
  let best = gates[0];
  let bestD2 = Infinity;
  for (let i = 0; i < gates.length; i++) {
    const g = gates[i];
    const d2 = (g.x - x) ** 2 + (g.z - z) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = g;
    }
  }
  return best;
}

const CANDIDATE_OFFSETS = [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 1.85, -1.85, 2.45, -2.45, Math.PI];

export class SmartAiController {
  private readonly buildingNav: BuildingNavInfo[];
  private readonly buildingById = new Map<number, BuildingNavInfo>();
  private readonly hatchStates = new Map<number, HatchlingNavState>();
  private readonly humanStates = new Map<number, HumanNavState>();
  private readonly activeIds = new Set<number>();

  constructor(buildings: readonly EnterableBuilding[]) {
    this.buildingNav = buildDoorNavInfo(buildings);
    for (const info of this.buildingNav) {
      this.buildingById.set(info.building.id, info);
    }
  }

  public reset(): void {
    this.hatchStates.clear();
    this.humanStates.clear();
  }

  private getOrCreateHatchState(h: Hatchling): HatchlingNavState {
    let st = this.hatchStates.get(h.id);
    if (!st) {
      st = {
        prevX: h.x,
        prevY: h.y,
        prevZ: h.z,
        prevHeading: h.heading,
        prevTotalDist: h.totalDist,
        stallTime: 0,
        evadeTime: 0,
        evadeDir: h.id % 2 === 0 ? 1 : -1,
        overrideMotion: false,
        smartHeading: h.heading,
        smartSpeed: h.speed,
        desiredTargetVillagerId: null,
        desiredTargetPreyId: null,
        enforceTargets: false,
      };
      this.hatchStates.set(h.id, st);
    }
    return st;
  }

  private getOrCreateHumanState(v: Villager): HumanNavState {
    let st = this.humanStates.get(v.id);
    if (!st) {
      st = {
        prevX: v.x,
        prevY: v.y,
        prevZ: v.z,
        stallTime: 0,
        evadeTime: 0,
        evadeDir: v.id % 2 === 0 ? 1 : -1,
      };
      this.humanStates.set(v.id, st);
    }
    return st;
  }

  private isPositionBlocked(
    x: number,
    y: number,
    z: number,
    radius: number,
    obstacles: readonly HazardObstacle[],
    trees: readonly TreeCollider[],
    checkTrees = false,
  ): boolean {
    if (Math.hypot(x, z) > ARENA_RADIUS - 2.0) return true;
    const bHit = resolveBuildingWallCollision(x, y, z, radius);
    if (bHit.collided) return true;
    const wHit = resolveWorldWallsCollision(x, y, z, radius);
    if (wHit.collided) return true;
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      const r = o.radius + radius;
      if ((x - o.x) ** 2 + (z - o.z) ** 2 < r * r) return true;
    }
    if (checkTrees) {
      for (let i = 0; i < trees.length; i++) {
        const t = trees[i];
        const r = t.radius + radius;
        if ((x - t.x) ** 2 + (z - t.z) ** 2 < r * r) return true;
      }
    }
    return false;
  }

  private isDirectLineBlocked(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    z1: number,
    probeRadius = 0.36,
  ): boolean {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.8) return false;
    const steps = Math.min(28, Math.max(3, Math.ceil(dist / 0.85)));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const px = x0 + dx * t;
      const pz = z0 + dz * t;
      const bHit = resolveBuildingWallCollision(px, y0, pz, probeRadius);
      if (bHit.collided) return true;
      const wHit = resolveWorldWallsCollision(px, y0, pz, probeRadius);
      if (wHit.collided) return true;
    }
    return false;
  }

  private pickClearHeading(
    x: number,
    y: number,
    z: number,
    desiredHeading: number,
    preferredDir: 1 | -1,
    probeDist: number,
    radius: number,
    obstacles: readonly HazardObstacle[],
    trees: readonly TreeCollider[],
  ): { heading: number; blockedStraight: boolean } {
    const check = (ang: number, d: number) =>
      this.isPositionBlocked(
        x + Math.sin(ang) * d,
        y,
        z + Math.cos(ang) * d,
        radius,
        obstacles,
        trees,
        true,
      );

    const straightBlocked =
      check(desiredHeading, probeDist * 0.55) || check(desiredHeading, probeDist);
    if (!straightBlocked) {
      return { heading: desiredHeading, blockedStraight: false };
    }

    for (let i = 1; i < CANDIDATE_OFFSETS.length; i++) {
      const off = CANDIDATE_OFFSETS[i];
      const signed = i % 2 === 1 ? Math.abs(off) * preferredDir : -Math.abs(off) * preferredDir;
      const cand = normAngle(desiredHeading + signed);
      if (!check(cand, probeDist * 0.55) && !check(cand, probeDist)) {
        return { heading: cand, blockedStraight: true };
      }
    }

    for (let i = 1; i < CANDIDATE_OFFSETS.length; i++) {
      const off = CANDIDATE_OFFSETS[i];
      const signed = i % 2 === 1 ? Math.abs(off) * preferredDir : -Math.abs(off) * preferredDir;
      const cand = normAngle(desiredHeading + signed);
      if (!check(cand, probeDist * 0.5)) {
        return { heading: cand, blockedStraight: true };
      }
    }

    return { heading: normAngle(desiredHeading + preferredDir * 1.4), blockedStraight: true };
  }

  /**
   * Computes local-space corner-around-wall waypoints to reach an open doorway cleanly,
   * never pushing against a cabin/manor back or side exterior wall.
   */
  private getDoorWaypointForBuilding(
    fromX: number,
    fromZ: number,
    bInfo: BuildingNavInfo,
  ): { tx: number; tz: number } {
    const b = bInfo.building;
    const loc = worldToBuildingLocal(b, fromX, fromZ);
    const inFootprint = Math.abs(loc.lx) < 4.0 && Math.abs(loc.lz) < 3.25;
    if (inFootprint) {
      const spot = b.interiorSpot;
      const w = buildingLocalToWorld(b, spot.x, spot.z);
      return { tx: w.wx, tz: w.wz };
    }

    let bestDoor = bInfo.doors[0];
    let bestScore = Infinity;
    for (let i = 0; i < bInfo.doors.length; i++) {
      const d = bInfo.doors[i];
      const dist = Math.hypot(d.approachLx - loc.lx, d.approachLz - loc.lz);
      if (dist < bestScore) {
        bestScore = dist;
        bestDoor = d;
      }
    }

    // If aligned outside the doorway threshold, head straight through the doorway inside!
    const distApproachLocal = Math.hypot(loc.lx - bestDoor.approachLx, loc.lz - bestDoor.approachLz);
    if (distApproachLocal < 2.35) {
      return { tx: bestDoor.entryX, tz: bestDoor.entryZ };
    }

    if (b.kind === 'cabin') {
      // If behind the solid -Z rear wall, route around the NW corner first when heading to -X side door
      if (loc.lz < -3.25 && bestDoor.approachLx < -4.0) {
        if (loc.lx > -4.9) {
          const corner = buildingLocalToWorld(b, -5.65, -4.4);
          return { tx: corner.wx, tz: corner.wz };
        }
      } else if (loc.lx > 3.9 && bestDoor.approachLz > 5.0) {
        if (loc.lz < 4.9) {
          const corner = buildingLocalToWorld(b, 5.4, 5.4);
          return { tx: corner.wx, tz: corner.wz };
        }
      } else if (loc.lz < -3.25 && bestDoor.approachLz > 5.0) {
        const cornerLx = loc.lx >= 0 ? 5.4 : -5.65;
        const corner = buildingLocalToWorld(b, cornerLx, -4.4);
        return { tx: corner.wx, tz: corner.wz };
      }
    } else if (b.kind === 'manor') {
      if (Math.abs(loc.lx) > 4.2 && Math.abs(loc.lz) < 4.6) {
        const cornerLx = loc.lx >= 0 ? 5.5 : -5.5;
        const cornerLz = bestDoor.approachLz >= 0 ? 5.3 : -5.3;
        const corner = buildingLocalToWorld(b, cornerLx, cornerLz);
        return { tx: corner.wx, tz: corner.wz };
      }
    }

    return { tx: bestDoor.approachX, tz: bestDoor.approachZ };
  }

  public preStep(
    dt: number,
    headX: number,
    headY: number,
    headZ: number,
    headHeading: number,
    isBoosting: boolean,
    stealthTimer: number,
    buildings: readonly EnterableBuilding[],
    villagers: readonly Villager[],
    preyItems: readonly PreyItem[],
    hatchlings: readonly Hatchling[],
    obstacles: readonly HazardObstacle[],
    trees: readonly TreeCollider[],
  ): void {
    // 1. Snapshot prev positions before WASM step
    this.activeIds.clear();
    for (let i = 0; i < hatchlings.length; i++) {
      const h = hatchlings[i];
      this.activeIds.add(h.id);
      const st = this.getOrCreateHatchState(h);
      st.prevX = h.x;
      st.prevY = h.y;
      st.prevZ = h.z;
      st.prevHeading = h.heading;
      st.prevTotalDist = h.totalDist;
      st.overrideMotion = false;
      st.enforceTargets = false;
      st.desiredTargetVillagerId = h.targetVillagerId;
      st.desiredTargetPreyId = h.targetPreyId;
      if (st.evadeTime > 0) st.evadeTime = Math.max(0, st.evadeTime - dt);
    }
    for (const key of this.hatchStates.keys()) {
      if (!this.activeIds.has(key)) this.hatchStates.delete(key);
    }

    this.activeIds.clear();
    for (let i = 0; i < villagers.length; i++) {
      const v = villagers[i];
      this.activeIds.add(v.id);
      const st = this.getOrCreateHumanState(v);
      st.prevX = v.x;
      st.prevY = v.y;
      st.prevZ = v.z;
      if (st.evadeTime > 0) st.evadeTime = Math.max(0, st.evadeTime - dt);
    }
    for (const key of this.humanStates.keys()) {
      if (!this.activeIds.has(key)) this.humanStates.delete(key);
    }

    // 2. Smart Hatchling Target Selection & Anti-Wall Steering Plan
    for (let i = 0; i < hatchlings.length; i++) {
      const h = hatchlings[i];
      const st = this.getOrCreateHatchState(h);
      const hLoc = getBuildingAtPosition(h.x, h.z, h.y, buildings);
      const distToMother = Math.hypot(h.x - headX, h.z - headZ);

      let targetV: Villager | undefined;
      if (h.targetVillagerId !== null) {
        for (let vi = 0; vi < villagers.length; vi++) {
          if (villagers[vi].id === h.targetVillagerId) {
            targetV = villagers[vi];
            break;
          }
        }
      }

      // If current target villager is indoors/behind wall while hatchling is outside, switch to reachable open outdoor human or prey first!
      if (targetV && targetV.state !== 'ko') {
        const vLoc = getBuildingAtPosition(targetV.x, targetV.z, targetV.y, buildings);
        const sameBuilding = vLoc.building && hLoc.building && vLoc.building.id === hLoc.building.id;
        const targetBlocked =
          (vLoc.isIndoors && !sameBuilding) ||
          this.isDirectLineBlocked(h.x, h.y, h.z, targetV.x, targetV.z, 0.35);

        if (targetBlocked) {
          let bestOutdoorV: Villager | null = null;
          let bestOutdoorVD2 = 34 * 34;
          for (let vi = 0; vi < villagers.length; vi++) {
            const cand = villagers[vi];
            if (cand.state === 'ko' || cand.id === targetV.id) continue;
            const d2 = (cand.x - h.x) ** 2 + (cand.z - h.z) ** 2;
            if (d2 >= bestOutdoorVD2) continue;
            const cLoc = getBuildingAtPosition(cand.x, cand.z, cand.y, buildings);
            if (cLoc.isIndoors) continue;
            if (!this.isDirectLineBlocked(h.x, h.y, h.z, cand.x, cand.z, 0.35)) {
              bestOutdoorVD2 = d2;
              bestOutdoorV = cand;
            }
          }

          if (bestOutdoorV) {
            h.targetVillagerId = bestOutdoorV.id;
            h.targetPreyId = null;
            st.desiredTargetVillagerId = bestOutdoorV.id;
            st.desiredTargetPreyId = null;
            st.enforceTargets = true;
            targetV = bestOutdoorV;
          } else {
            let bestPrey: PreyItem | null = null;
            let bestPD2 = 30 * 30;
            for (let pi = 0; pi < preyItems.length; pi++) {
              const p = preyItems[pi];
              const d2 = (p.x - h.x) ** 2 + (p.z - h.z) ** 2;
              if (d2 < bestPD2 && !this.isDirectLineBlocked(h.x, h.y, h.z, p.x, p.z, 0.32)) {
                bestPD2 = d2;
                bestPrey = p;
              }
            }
            if (bestPrey) {
              h.targetVillagerId = null;
              h.targetPreyId = bestPrey.id;
              st.desiredTargetVillagerId = null;
              st.desiredTargetPreyId = bestPrey.id;
              st.enforceTargets = true;
              targetV = undefined;
            }
          }
        }
      }

      let desiredHeading = h.heading;
      let needsDetour = false;
      let escortSpeed = Math.max(4.6, h.speed);

      if (distToMother > 34 && (!targetV || Math.hypot(targetV.x - h.x, targetV.z - h.z) > 6.0)) {
        // Mother-snake escort: keep brood near player instead of wandering across the huge map alone
        const flankAng = headHeading + (i % 2 === 0 ? 2.15 : -2.15);
        const anchorX = headX + Math.sin(flankAng) * (6.0 + (i % 3) * 2.0);
        const anchorZ = headZ + Math.cos(flankAng) * (6.0 + (i % 3) * 2.0);
        desiredHeading = Math.atan2(anchorX - h.x, anchorZ - h.z);
        needsDetour = true;
        escortSpeed = Math.max(6.8, h.speed * 1.2);
      } else if (targetV && targetV.state !== 'ko') {
        const vLoc = getBuildingAtPosition(targetV.x, targetV.z, targetV.y, buildings);
        const targetDist = Math.hypot(targetV.x - h.x, targetV.z - h.z);
        const sameBuilding = vLoc.building && hLoc.building && vLoc.building.id === hLoc.building.id;
        if (vLoc.isIndoors) {
          st.enforceTargets = true;
        }
        if (
          vLoc.building &&
          !sameBuilding &&
          (this.isDirectLineBlocked(h.x, h.y, h.z, targetV.x, targetV.z, 0.35) || vLoc.isIndoors)
        ) {
          const bNav = this.buildingById.get(vLoc.building.id);
          if (bNav) {
            const wp = this.getDoorWaypointForBuilding(h.x, h.z, bNav);
            desiredHeading = Math.atan2(wp.tx - h.x, wp.tz - h.z);
            needsDetour = true;
          }
        } else if (targetDist > 1.65) {
          desiredHeading = Math.atan2(targetV.x - h.x, targetV.z - h.z);
          if (vLoc.isIndoors) {
            needsDetour = true;
          } else if (this.isDirectLineBlocked(h.x, h.y, h.z, targetV.x, targetV.z, 0.35)) {
            const mx = (h.x + targetV.x) * 0.5;
            const mz = (h.z + targetV.z) * 0.5;
            for (let bi = 0; bi < this.buildingNav.length; bi++) {
              const info = this.buildingNav[bi];
              const b = info.building;
              if (Math.hypot(b.x - mx, b.z - mz) < b.footprintRadius + 3.5) {
                const wp = this.getDoorWaypointForBuilding(h.x, h.z, info);
                desiredHeading = Math.atan2(wp.tx - h.x, wp.tz - h.z);
                needsDetour = true;
                break;
              }
            }
          }
        }
      } else if (h.targetPreyId !== null) {
        for (let pi = 0; pi < preyItems.length; pi++) {
          const p = preyItems[pi];
          if (p.id === h.targetPreyId) {
            desiredHeading = Math.atan2(p.x - h.x, p.z - h.z);
            break;
          }
        }
      } else if (distToMother > 11.5) {
        const escortAng = headHeading + (i % 2 === 0 ? 2.3 : -2.3);
        const anchorX = headX + Math.sin(escortAng) * (5.5 + (i % 3) * 1.8);
        const anchorZ = headZ + Math.cos(escortAng) * (5.5 + (i % 3) * 1.8);
        desiredHeading = Math.atan2(anchorX - h.x, anchorZ - h.z);
        needsDetour = true;
      }

      const steered = this.pickClearHeading(
        h.x,
        h.y,
        h.z,
        desiredHeading,
        st.evadeDir,
        2.5,
        0.3,
        obstacles,
        trees,
      );
      if (steered.blockedStraight) needsDetour = true;

      if (needsDetour) {
        st.overrideMotion = true;
        st.smartHeading = steered.heading;
        st.smartSpeed = escortSpeed;
        if (targetV || h.targetPreyId !== null) {
          st.enforceTargets = true;
        }
        h.heading = steered.heading;
      } else {
        h.heading = turnToward(h.heading, steered.heading, Math.min(Math.PI, 8.5 * dt));
      }
    }

    // 3. Smarter Human Squad Coordination (pre-step alerts)
    if (stealthTimer <= 0.05) {
      for (let i = 0; i < villagers.length; i++) {
        const v = villagers[i];
        if (v.state === 'ko' || (v.stunTimer ?? 0) > 0.05) continue;
        const isAlertSource =
          v.state === 'pursue' ||
          v.state === 'windup' ||
          v.state === 'attack' ||
          v.state === 'fleeing' ||
          v.state === 'seeking_shelter';
        if (!isAlertSource) continue;

        const dHead = Math.hypot(v.x - headX, v.z - headZ);
        if (dHead > 36) continue;

        for (let j = 0; j < villagers.length; j++) {
          if (i === j) continue;
          const ally = villagers[j];
          if (
            ally.state === 'patrol' &&
            (ally.role === 'spearman' || ally.role === 'crossbow') &&
            (ally.stunTimer ?? 0) <= 0.05
          ) {
            const d2 = (ally.x - v.x) ** 2 + (ally.z - v.z) ** 2;
            if (d2 < 24 * 24) {
              ally.state = 'pursue';
              ally.stateTimer = 0;
            }
          }
        }
      }
    }

    void headY;
    void isBoosting;
  }

  public postStep(
    dt: number,
    headX: number,
    headY: number,
    headZ: number,
    headHeading: number,
    isBoosting: boolean,
    stealthTimer: number,
    buildings: readonly EnterableBuilding[],
    villagers: readonly Villager[],
    hatchlings: readonly Hatchling[],
    obstacles: readonly HazardObstacle[],
    trees: readonly TreeCollider[],
  ): void {
    const exp = snakeCoreWasm.getExports();

    // 1. Apply smart detour motion & stall recovery for Hatchlings
    for (let i = 0; i < hatchlings.length; i++) {
      const h = hatchlings[i];
      const st = this.getOrCreateHatchState(h);

      // Keep smart target choice locked if WASM reverted to a walled target during this tick
      if (st.enforceTargets) {
        h.targetVillagerId = st.desiredTargetVillagerId;
        h.targetPreyId = st.desiredTargetPreyId;
      }

      const stepMoved = Math.hypot(h.x - st.prevX, h.z - st.prevZ);
      const expected = Math.max(0.5, h.speed) * dt;
      const distToMother = Math.hypot(h.x - headX, h.z - headZ);

      let moveFromX = h.x;
      let moveFromY = h.y;
      let moveFromZ = h.z;
      let baseTotalDist = h.totalDist;
      let moveHeading = h.heading;
      let moveSpeed = Math.max(4.6, h.speed);
      let applySmartStep = false;

      if (st.overrideMotion) {
        // Replace WASM's wall-pinned or orbit step with clean waypoint steering from prevX/prevZ
        moveFromX = st.prevX;
        moveFromY = st.prevY;
        moveFromZ = st.prevZ;
        baseTotalDist = st.prevTotalDist;
        moveHeading = turnToward(st.prevHeading, st.smartHeading, Math.min(Math.PI, 10.5 * dt));
        moveSpeed = st.smartSpeed;
        applySmartStep = true;
        st.stallTime = 0;
      } else {
        if (stepMoved < expected * 0.45 && distToMother > 2.4) {
          st.stallTime += dt;
        } else {
          st.stallTime = Math.max(0, st.stallTime - dt * 1.5);
        }

        if (st.stallTime > 0.14 || st.evadeTime > 0) {
          if (st.stallTime > 0.14) {
            st.evadeTime = 0.55;
            if (st.stallTime > 0.45) {
              st.evadeDir = st.evadeDir === 1 ? -1 : 1;
              st.stallTime = 0.15;
            }
          }

          let goalX = headX;
          let goalZ = headZ;
          if (h.targetVillagerId !== null) {
            const tv = villagers.find((vv) => vv.id === h.targetVillagerId);
            if (tv && tv.state !== 'ko') {
              const tvLoc = getBuildingAtPosition(tv.x, tv.z, tv.y, buildings);
              const hLoc = getBuildingAtPosition(h.x, h.z, h.y, buildings);
              if (tvLoc.building && (!hLoc.building || hLoc.building.id !== tvLoc.building.id)) {
                const bNav = this.buildingById.get(tvLoc.building.id);
                if (bNav) {
                  const wp = this.getDoorWaypointForBuilding(h.x, h.z, bNav);
                  goalX = wp.tx;
                  goalZ = wp.tz;
                }
              } else {
                goalX = tv.x;
                goalZ = tv.z;
              }
            }
          }
          const clear = this.pickClearHeading(
            h.x,
            h.y,
            h.z,
            Math.atan2(goalX - h.x, goalZ - h.z),
            st.evadeDir,
            2.2,
            0.3,
            obstacles,
            trees,
          );
          moveHeading = clear.heading;
          moveSpeed = Math.max(4.6, h.speed * 0.92);
          applySmartStep = true;
        }
      }

      if (applySmartStep) {
        const moveStep = Math.max(0.02, moveSpeed * dt);
        let nx = moveFromX + Math.sin(moveHeading) * moveStep;
        let nz = moveFromZ + Math.cos(moveHeading) * moveStep;

        const rClamp = Math.hypot(nx, nz);
        if (rClamp > ARENA_RADIUS - 2.0) {
          const s = (ARENA_RADIUS - 2.0) / rClamp;
          nx *= s;
          nz *= s;
        }
        let ny = surfaceHeightAt(nx, nz, moveFromY, buildings);
        const bHit = resolveBuildingWallCollision(nx, ny, nz, 0.28);
        if (bHit.collided) {
          nx = bHit.x;
          nz = bHit.z;
        }
        const wHit = resolveWorldWallsCollision(nx, ny, nz, 0.28);
        if (wHit.collided) {
          nx = wHit.x;
          nz = wHit.z;
        }
        ny = surfaceHeightAt(nx, nz, moveFromY, buildings);

        const actualDelta = Math.hypot(nx - moveFromX, nz - moveFromZ);
        h.x = nx;
        h.y = ny;
        h.z = nz;
        h.heading = moveHeading;
        h.totalDist = baseTotalDist + actualDelta;

        const spView = snakeCoreWasm.getHatchlingSpineView(i);
        spView[0] = nx;
        spView[1] = ny;
        spView[2] = nz;
        spView[3] = h.totalDist;
        exp.wasm_recompute_hatchling_poses(i);
      }
    }

    // 2. Smarter Human AI (Doorway Shelter, Gate Navigation, Crossbow Kiting, Spearman Flanking & Evasion)
    const snakeFx = Math.sin(headHeading);
    const snakeFz = Math.cos(headHeading);

    for (let i = 0; i < villagers.length; i++) {
      const v = villagers[i];
      if (v.state === 'ko' || v.grabbed || (v.stunTimer ?? 0) > 0.05) continue;
      if (v.state === 'windup' || v.state === 'attack' || v.state === 'hiding' || v.state === 'patrol') {
        continue;
      }

      const st = this.getOrCreateHumanState(v);
      const moved = Math.hypot(v.x - st.prevX, v.z - st.prevZ);
      const vSpeed = Math.max(2.2, v.speed);
      if (moved < vSpeed * dt * 0.35) {
        st.stallTime += dt;
      } else {
        st.stallTime = Math.max(0, st.stallTime - dt * 1.5);
      }

      const dxH = headX - v.x;
      const dzH = headZ - v.z;
      const distToHead = Math.hypot(dxH, dzH);
      let overrideDir: number | null = null;
      let moveScale = 0;
      let stepFromPrev = false;

      // A. Smart Doorway Entry for shelter-seeking civilians
      if (v.state === 'seeking_shelter' && v.targetBuildingId !== null) {
        const bNav = this.buildingById.get(v.targetBuildingId);
        if (bNav) {
          const vLoc = getBuildingAtPosition(v.x, v.z, v.y, buildings);
          if (!vLoc.isIndoors) {
            const pLoc = worldToBuildingLocal(bNav.building, st.prevX, st.prevZ);
            const inDoorHall = Math.abs(pLoc.lx) < 3.6 && Math.abs(pLoc.lz) < 3.0;
            const blockedDirect =
              !inDoorHall ||
              this.isDirectLineBlocked(
                st.prevX,
                st.prevY,
                st.prevZ,
                bNav.building.x,
                bNav.building.z,
                0.38,
              );
            if (blockedDirect || st.stallTime > 0.14) {
              const wp = this.getDoorWaypointForBuilding(st.prevX, st.prevZ, bNav);
              const want = Math.atan2(wp.tx - st.prevX, wp.tz - st.prevZ);
              const clear = this.pickClearHeading(
                st.prevX,
                st.prevY,
                st.prevZ,
                want,
                st.evadeDir,
                2.2,
                v.radius,
                obstacles,
                trees,
              );
              overrideDir = clear.heading;
              moveScale = 1.05;
              stepFromPrev = true;
            }
          }
        }
      }

      // B. Smart Village Gate Exit for fleeing civilians
      if (overrideDir === null && v.state === 'fleeing' && st.stallTime > 0.16) {
        const homeVil =
          v.homeVillageId !== undefined && v.homeVillageId >= 0
            ? VILLAGES[v.homeVillageId]
            : VILLAGES[0];
        if (homeVil) {
          const gate = nearestVillageGate(v.x, v.z, homeVil);
          const want = Math.atan2(gate.x - v.x, gate.z - v.z);
          const clear = this.pickClearHeading(
            v.x,
            v.y,
            v.z,
            want,
            st.evadeDir,
            2.2,
            v.radius,
            obstacles,
            trees,
          );
          overrideDir = clear.heading;
          moveScale = 1.15;
        }
      }

      // C. Crossbow Kiting & Defensive Spacing (overcomes WASM pursue forward step)
      if (
        overrideDir === null &&
        v.role === 'crossbow' &&
        (v.state === 'pursue' || v.state === 'recover') &&
        stealthTimer <= 0.05 &&
        distToHead < 8.6 &&
        distToHead > 0.5
      ) {
        const awayHeading = Math.atan2(-dxH, -dzH);
        const strafeBias = st.evadeDir * 0.36;
        const clear = this.pickClearHeading(
          v.x,
          v.y,
          v.z,
          normAngle(awayHeading + strafeBias),
          st.evadeDir,
          2.2,
          v.radius,
          obstacles,
          trees,
        );
        overrideDir = clear.heading;
        moveScale = v.state === 'pursue' ? 1.65 : 0.95;
        v.heading = Math.atan2(dxH, dzH);
      }

      // D. Spearman Tactical Flanking & Boost-Lunge Sidestep
      if (
        overrideDir === null &&
        v.role === 'spearman' &&
        v.state === 'pursue' &&
        stealthTimer <= 0.05
      ) {
        const dirToV = distToHead > 0.5 ? (-dxH * snakeFx - dzH * snakeFz) / distToHead : 0;
        if (isBoosting && distToHead < 5.8 && distToHead > 2.3 && dirToV > 0.8) {
          const sideHeading = normAngle(Math.atan2(dxH, dzH) + st.evadeDir * (Math.PI * 0.5));
          const clear = this.pickClearHeading(
            v.x,
            v.y,
            v.z,
            sideHeading,
            st.evadeDir,
            2.0,
            v.radius,
            obstacles,
            trees,
          );
          overrideDir = clear.heading;
          moveScale = 0.85;
        } else if (distToHead > 4.2 && distToHead < 18.0) {
          const flankSlot = (v.id % 3) - 1;
          if (flankSlot !== 0) {
            const want = normAngle(Math.atan2(dxH, dzH) + flankSlot * 0.58);
            const clear = this.pickClearHeading(
              v.x,
              v.y,
              v.z,
              want,
              st.evadeDir,
              2.2,
              v.radius,
              obstacles,
              trees,
            );
            overrideDir = clear.heading;
            moveScale = 0.45;
          }
        }
      }

      // E. Generic Stall Recovery for pursuing hunters blocked by walls/fences
      if (overrideDir === null && st.stallTime > 0.22 && v.state === 'pursue') {
        st.evadeDir = st.evadeDir === 1 ? -1 : 1;
        st.stallTime = 0.08;
        const baseWant = Math.atan2(dxH, dzH);
        const clear = this.pickClearHeading(
          v.x,
          v.y,
          v.z,
          normAngle(baseWant + st.evadeDir * 1.1),
          st.evadeDir,
          2.4,
          v.radius,
          obstacles,
          trees,
        );
        overrideDir = clear.heading;
        moveScale = 0.95;
      }

      if (overrideDir !== null && moveScale > 0) {
        const baseX = stepFromPrev ? st.prevX : v.x;
        const baseY = stepFromPrev ? st.prevY : v.y;
        const baseZ = stepFromPrev ? st.prevZ : v.z;
        const step = vSpeed * dt * moveScale;
        let nx = baseX + Math.sin(overrideDir) * step;
        let nz = baseZ + Math.cos(overrideDir) * step;
        const rClamp = Math.hypot(nx, nz);
        if (rClamp > ARENA_RADIUS - 2.0) {
          const s = (ARENA_RADIUS - 2.0) / rClamp;
          nx *= s;
          nz *= s;
        }
        let ny = surfaceHeightAt(nx, nz, baseY, buildings);
        const bHit = resolveBuildingWallCollision(nx, ny, nz, v.radius);
        if (bHit.collided) {
          nx = bHit.x;
          nz = bHit.z;
        }
        const wHit = resolveWorldWallsCollision(nx, ny, nz, v.radius);
        if (wHit.collided) {
          nx = wHit.x;
          nz = wHit.z;
        }
        ny = surfaceHeightAt(nx, nz, baseY, buildings);

        v.x = nx;
        v.y = ny;
        v.z = nz;
        if (v.role !== 'crossbow' || distToHead >= 8.6) {
          v.heading = turnToward(v.heading, overrideDir, 10 * dt);
        }
      }
    }

    void headY;
  }
}
