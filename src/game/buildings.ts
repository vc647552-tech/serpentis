import {
  BuildingKind,
  EnterableBuilding,
  FloorZone,
  RampZone,
  VillageDef,
  WallBox,
  WaterPond,
  WorldRegion,
} from './types';

import { snakeCoreWasm } from '../wasm/snakeCoreWasm';
import {
  RUIN_UPPER_ALTAR_WALLS,
  resolveBuildingWallsTS,
  resolveWorldWallsAndVillagePropsTS,
} from './outdoorCollisions';

export const ARENA_RADIUS = 420.0;

export const WORLD_REGIONS: readonly WorldRegion[] = [
  { id: 'elderwood', name: 'Elderwood Canopy', x: 0, z: -285, radius: 78, kind: 'forest', colorHex: '#4f9e66' },
  { id: 'redstone', name: 'Redstone Mesa', x: -290, z: -205, radius: 72, kind: 'highlands', colorHex: '#c8734d' },
  { id: 'misty_pine', name: 'Misty Pine Basin', x: 290, z: -205, radius: 72, kind: 'basin', colorHex: '#5aa69d' },
  { id: 'sunlit_glade', name: 'Sunlit Savanna', x: -315, z: 36, radius: 76, kind: 'glade', colorHex: '#cfa952' },
  { id: 'ironridge', name: 'Ironridge Quarry', x: 315, z: 36, radius: 76, kind: 'quarry', colorHex: '#8499a8' },
  { id: 'emerald_marsh', name: 'Emerald Marsh', x: -245, z: 275, radius: 74, kind: 'marsh', colorHex: '#3fb58b' },
  { id: 'golden_steppe', name: 'Golden Steppe', x: 245, z: 275, radius: 74, kind: 'steppe', colorHex: '#d49a45' },
  { id: 'ancient_clearing', name: 'Ancient Clearing', x: 0, z: 325, radius: 78, kind: 'clearing', colorHex: '#7cc268' },
];

export const WATER_PONDS: readonly WaterPond[] = [
  { id: 'south_gate_puddle', name: 'Trailhead Pool', x: -11.5, z: -6.5, rx: 4.0, rz: 2.6 },
  { id: 'emerald_lagoon', name: 'Emerald Marsh Lagoon', x: -236, z: 268, rx: 14.5, rz: 10.2 },
  { id: 'misty_springs', name: 'Misty Pine Springs', x: 282, z: -196, rx: 12.0, rz: 8.6 },
  { id: 'sunlit_oasis', name: 'Sunlit Watering Hole', x: -304, z: 42, rx: 11.0, rz: 8.4 },
];

export const VILLAGES: readonly VillageDef[] = [
  { id: 0, name: 'Timberhollow', centerX: 0, centerZ: -52, halfW: 42, halfD: 32, southGateHalfW: 7.5, sideGateHalfW: 7.0, factionColorHex: 0x5c809e },
  { id: 1, name: 'Ashford', centerX: -128, centerZ: -112, halfW: 38, halfD: 30, southGateHalfW: 7.0, sideGateHalfW: 6.5, factionColorHex: 0xb85242 },
  { id: 2, name: 'Ravenbrook', centerX: 128, centerZ: -112, halfW: 38, halfD: 30, southGateHalfW: 7.0, sideGateHalfW: 6.5, factionColorHex: 0x7b5aa6 },
  { id: 3, name: 'Sunhaven', centerX: -162, centerZ: 24, halfW: 38, halfD: 30, southGateHalfW: 7.0, sideGateHalfW: 6.5, factionColorHex: 0xd49a35 },
  { id: 4, name: 'Ironvale', centerX: 162, centerZ: 24, halfW: 38, halfD: 30, southGateHalfW: 7.0, sideGateHalfW: 6.5, factionColorHex: 0x617a8c },
  { id: 5, name: 'Mossglen', centerX: -112, centerZ: 142, halfW: 38, halfD: 30, southGateHalfW: 7.0, sideGateHalfW: 6.5, factionColorHex: 0x4b8f5c },
  { id: 6, name: 'Goldcrest', centerX: 112, centerZ: 142, halfW: 38, halfD: 30, southGateHalfW: 7.0, sideGateHalfW: 6.5, factionColorHex: 0xc97438 },
];

export const VILLAGE_BOUNDS = {
  minX: -42,
  maxX: 42,
  minZ: -84,
  maxZ: -20,
  southGateHalfW: 7.5,
  sideGateHalfW: 7.0,
} as const;

export function findVillageAt(x: number, z: number, margin = 0): VillageDef | null {
  for (const v of VILLAGES) {
    if (
      x >= v.centerX - v.halfW - margin &&
      x <= v.centerX + v.halfW + margin &&
      z >= v.centerZ - v.halfD - margin &&
      z <= v.centerZ + v.halfD + margin
    ) {
      return v;
    }
  }
  return null;
}

export function isInsideVillage(x: number, z: number, margin = 0): boolean {
  return findVillageAt(x, z, margin) !== null;
}

export function groundHeightAt(x: number, z: number): number {
  return snakeCoreWasm.groundHeight(x, z);
}

export function worldToBuildingLocal(
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

export function buildingLocalToWorld(
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

function createCabinBlueprint(
  id: number,
  name: string,
  x: number,
  z: number,
  rotation: number,
  scale = 1.0,
): EnterableBuilding {
  const floors: FloorZone[] = [
    { minX: -4.15, maxX: 4.15, minZ: -3.35, maxZ: 3.35, elevation: 0.28, label: 'Ground Floor', isInterior: true },
    { minX: -2.8, maxX: 2.8, minZ: 3.35, maxZ: 5.15, elevation: 0.28, label: 'Front Porch', isInterior: false },
    { minX: -3.85, maxX: 3.85, minZ: -3.1, maxZ: -0.35, elevation: 2.68, label: 'Upper Loft', isInterior: true },
    { minX: -3.85, maxX: -1.45, minZ: -0.35, maxZ: 4.95, elevation: 2.68, label: 'Loft Balcony', isInterior: false, isRoof: true },
  ];
  const ramps: RampZone[] = [
    { minX: -1.85, maxX: 1.85, minZ: 5.15, maxZ: 6.75, axis: 'z', startCoord: 6.75, endCoord: 5.15, startY: 0.0, endY: 0.28, label: 'Porch Steps', isInterior: false },
    { minX: -5.35, maxX: -4.15, minZ: -1.1, maxZ: 1.1, axis: 'x', startCoord: -5.35, endCoord: -4.15, startY: 0.0, endY: 0.28, label: 'Side Threshold', isInterior: false },
    { minX: 1.75, maxX: 3.75, minZ: -0.35, maxZ: 2.75, axis: 'z', startCoord: 2.75, endCoord: -0.35, startY: 0.28, endY: 2.68, label: 'Loft Stairway', isInterior: true },
  ];
  const walls: WallBox[] = [
    { minX: -4.25, maxX: -1.45, minZ: 3.15, maxZ: 3.55, minY: 0, maxY: 4.5 },
    { minX: 1.45, maxX: 4.25, minZ: 3.15, maxZ: 3.55, minY: 0, maxY: 4.5 },
    { minX: -4.25, maxX: 4.25, minZ: -3.55, maxZ: -3.15, minY: 0, maxY: 5.0 },
    { minX: 3.95, maxX: 4.35, minZ: -3.45, maxZ: 3.45, minY: 0, maxY: 5.0 },
    { minX: -4.35, maxX: -3.95, minZ: 1.1, maxZ: 3.45, minY: 0, maxY: 5.0 },
    { minX: -4.35, maxX: -3.95, minZ: -3.45, maxZ: -1.1, minY: 0, maxY: 5.0 },
    { minX: -3.9, maxX: -2.65, minZ: -3.1, maxZ: -1.9, minY: 0, maxY: 2.45 },
    { minX: -1.45, maxX: 1.75, minZ: -0.45, maxZ: -0.25, minY: 2.68, maxY: 3.35 },
  ];
  return {
    id, kind: 'cabin', name, x, z, rotation, scale,
    footprintRadius: 7.4 * scale,
    floors, ramps, walls,
    interiorSpot: { x: -0.6, z: 0.6, y: 0.28 },
    upperSpot: { x: -2.4, z: 2.2, y: 2.68 },
  };
}

function createManorBlueprint(
  id: number,
  name: string,
  x: number,
  z: number,
  rotation: number,
  scale = 1.0,
): EnterableBuilding {
  const floors: FloorZone[] = [
    { minX: -4.45, maxX: 4.45, minZ: -3.65, maxZ: 3.65, elevation: 0.24, label: 'Stone Hall', isInterior: true },
    { minX: -4.25, maxX: 4.25, minZ: -3.45, maxZ: 1.25, elevation: 2.9, label: 'Roof Terrace', isInterior: false, isRoof: true },
  ];
  const ramps: RampZone[] = [
    { minX: -1.65, maxX: 1.65, minZ: 3.65, maxZ: 5.05, axis: 'z', startCoord: 5.05, endCoord: 3.65, startY: 0.0, endY: 0.24, label: 'Front Arch', isInterior: false },
    { minX: -1.65, maxX: 1.65, minZ: -5.05, maxZ: -3.65, axis: 'z', startCoord: -5.05, endCoord: -3.65, startY: 0.0, endY: 0.24, label: 'Rear Arch', isInterior: false },
    { minX: 2.0, maxX: 4.1, minZ: 0.85, maxZ: 3.35, axis: 'z', startCoord: 3.35, endCoord: 0.85, startY: 0.24, endY: 2.9, label: 'Terrace Ramp', isInterior: true },
  ];
  const walls: WallBox[] = [
    { minX: -4.55, maxX: -1.5, minZ: 3.45, maxZ: 3.85, minY: 0, maxY: 3.8 },
    { minX: 1.5, maxX: 4.55, minZ: 3.45, maxZ: 3.85, minY: 0, maxY: 3.8 },
    { minX: -4.55, maxX: -1.5, minZ: -3.85, maxZ: -3.45, minY: 0, maxY: 3.8 },
    { minX: 1.5, maxX: 4.55, minZ: -3.85, maxZ: -3.45, minY: 0, maxY: 3.8 },
    { minX: -4.65, maxX: -4.25, minZ: -3.75, maxZ: 3.75, minY: 0, maxY: 3.8 },
    { minX: 4.25, maxX: 4.65, minZ: -3.75, maxZ: 3.75, minY: 0, maxY: 3.8 },
    { minX: -4.25, maxX: 2.0, minZ: 1.05, maxZ: 1.3, minY: 2.9, maxY: 3.55 },
    { minX: -4.3, maxX: -4.05, minZ: -3.45, maxZ: 1.25, minY: 2.9, maxY: 3.55 },
    { minX: -4.25, maxX: 4.25, minZ: -3.5, maxZ: -3.25, minY: 2.9, maxY: 3.55 },
  ];
  return {
    id, kind: 'manor', name, x, z, rotation, scale,
    footprintRadius: 7.5 * scale,
    floors, ramps, walls,
    interiorSpot: { x: -1.2, z: -0.4, y: 0.24 },
    upperSpot: { x: -1.0, z: -1.2, y: 2.9 },
  };
}

function createRuinTowerBlueprint(
  id: number,
  name: string,
  x: number,
  z: number,
  rotation: number,
  scale = 1.0,
): EnterableBuilding {
  const floors: FloorZone[] = [
    { minX: -3.5, maxX: 3.5, minZ: -3.5, maxZ: 2.2, elevation: 0.22, label: 'Ruin Courtyard', isInterior: false },
    { minX: -3.3, maxX: 3.3, minZ: -3.3, maxZ: -0.2, elevation: 2.05, label: 'Temple Terrace', isInterior: false, isRoof: true },
  ];
  const ramps: RampZone[] = [
    { minX: -1.5, maxX: 1.5, minZ: 2.2, maxZ: 3.6, axis: 'z', startCoord: 3.6, endCoord: 2.2, startY: 0.0, endY: 0.22, label: 'Stone Steps', isInterior: false },
    { minX: -1.55, maxX: 1.55, minZ: -0.2, maxZ: 2.2, axis: 'z', startCoord: 2.2, endCoord: -0.2, startY: 0.22, endY: 2.05, label: 'Altar Ramp', isInterior: false },
  ];
  const walls: WallBox[] = [
    { minX: -3.35, maxX: -2.45, minZ: -3.35, maxZ: -2.45, minY: 0, maxY: 4.6 },
    { minX: 2.45, maxX: 3.35, minZ: -3.35, maxZ: -2.45, minY: 0, maxY: 4.6 },
    { minX: -3.35, maxX: -2.45, minZ: 1.35, maxZ: 2.25, minY: 0, maxY: 3.8 },
    { minX: 2.45, maxX: 3.35, minZ: 1.35, maxZ: 2.25, minY: 0, maxY: 3.8 },
    ...RUIN_UPPER_ALTAR_WALLS,
  ];
  return {
    id, kind: 'ruin_tower', name, x, z, rotation, scale,
    footprintRadius: 6.2 * scale,
    floors, ramps, walls,
    interiorSpot: { x: 0, z: 0.9, y: 1.15 },
    upperSpot: { x: 0, z: -1.8, y: 2.05 },
  };
}

let cachedBuildings: EnterableBuilding[] | null = null;

export function createWorldBuildings(): EnterableBuilding[] {
  if (!cachedBuildings) {
    let nextBId = 9001;
    cachedBuildings = [
      // Village 0: Timberhollow (0, -52)
      createCabinBlueprint(nextBId++, 'Timberhollow Lodge', -21.0, -36.5, 0.14, 2.65),
      createManorBlueprint(nextBId++, 'Timberhollow Manor', 21.0, -37.5, -0.16, 2.75),
      createCabinBlueprint(nextBId++, 'Timberhollow Homestead', -20.5, -68.5, 3.02, 2.58),

      // Village 1: Ashford (-128, -112)
      createCabinBlueprint(nextBId++, 'Ashford Watch Cabin', -147.0, -127.0, 0.15, 2.52),
      createManorBlueprint(nextBId++, 'Ashford Forge Hall', -109.0, -127.0, -0.15, 2.62),
      createCabinBlueprint(nextBId++, 'Ashford Granary', -146.5, -97.5, 2.98, 2.48),

      // Village 2: Ravenbrook (128, -112)
      createManorBlueprint(nextBId++, 'Ravenbrook Guildhall', 109.0, -127.0, 0.15, 2.62),
      createCabinBlueprint(nextBId++, 'Ravenbrook Timberhouse', 147.0, -127.0, -0.15, 2.52),
      createCabinBlueprint(nextBId++, 'Ravenbrook Millhouse', 146.5, -97.5, -2.98, 2.48),

      // Village 3: Sunhaven (-162, 24)
      createCabinBlueprint(nextBId++, 'Sunhaven Farmhouse', -181.0, 9.0, 0.18, 2.52),
      createManorBlueprint(nextBId++, 'Sunhaven Steward Hall', -143.0, 9.0, -0.16, 2.62),
      createCabinBlueprint(nextBId++, 'Sunhaven Orchard Barn', -180.5, 38.5, 2.96, 2.48),

      // Village 4: Ironvale (162, 24)
      createManorBlueprint(nextBId++, 'Ironvale Citadel', 143.0, 9.0, 0.16, 2.65),
      createCabinBlueprint(nextBId++, 'Ironvale Barracks', 181.0, 9.0, -0.16, 2.52),
      createCabinBlueprint(nextBId++, 'Ironvale Armory', 143.5, 38.5, 2.96, 2.50),

      // Village 5: Mossglen (-112, 142)
      createCabinBlueprint(nextBId++, 'Mossglen Hunter Lodge', -131.0, 127.0, 0.16, 2.54),
      createManorBlueprint(nextBId++, 'Mossglen Timber Hall', -93.0, 127.0, -0.18, 2.62),
      createCabinBlueprint(nextBId++, 'Mossglen Reed Cabin', -130.5, 156.5, 2.98, 2.48),

      // Village 6: Goldcrest (112, 142)
      createManorBlueprint(nextBId++, 'Goldcrest Keep', 93.0, 127.0, 0.16, 2.66),
      createCabinBlueprint(nextBId++, 'Goldcrest Meadhouse', 131.0, 127.0, -0.16, 2.54),
      createCabinBlueprint(nextBId++, 'Goldcrest Gatehouse', 130.5, 156.5, -2.98, 2.50),

      // 2 Wilderness outposts
      createRuinTowerBlueprint(nextBId++, 'Mossy Forest Temple', 64.0, 52.0, -2.25, 2.60),
      createCabinBlueprint(nextBId++, 'Deepwood Ranger Cabin', -64.0, 48.0, 0.75, 2.52),
    ];
  }
  return cachedBuildings;
}

export function createVillageFenceWalls(): WallBox[] {
  const walls: WallBox[] = [];
  const thick = 0.55;
  for (const v of VILLAGES) {
    const minX = v.centerX - v.halfW;
    const maxX = v.centerX + v.halfW;
    const minZ = v.centerZ - v.halfD;
    const maxZ = v.centerZ + v.halfD;
    const cx = v.centerX;
    const cz = v.centerZ;
    const sGate = v.southGateHalfW;
    const eGate = v.sideGateHalfW;
    walls.push(
      { minX: minX - thick, maxX: cx - sGate, minZ: maxZ - thick, maxZ: maxZ + thick, minY: 0, maxY: 2.5 },
      { minX: cx + sGate, maxX: maxX + thick, minZ: maxZ - thick, maxZ: maxZ + thick, minY: 0, maxY: 2.5 },
      { minX: minX - thick, maxX: cx - sGate, minZ: minZ - thick, maxZ: minZ + thick, minY: 0, maxY: 2.5 },
      { minX: cx + sGate, maxX: maxX + thick, minZ: minZ - thick, maxZ: minZ + thick, minY: 0, maxY: 2.5 },
      { minX: minX - thick, maxX: minX + thick, minZ: minZ - thick, maxZ: cz - eGate, minY: 0, maxY: 2.5 },
      { minX: minX - thick, maxX: minX + thick, minZ: cz + eGate, maxZ: maxZ + thick, minY: 0, maxY: 2.5 },
      { minX: maxX - thick, maxX: maxX + thick, minZ: minZ - thick, maxZ: cz - eGate, minY: 0, maxY: 2.5 },
      { minX: maxX - thick, maxX: maxX + thick, minZ: cz + eGate, maxZ: maxZ + thick, minY: 0, maxY: 2.5 },
      { minX: cx - 2.15, maxX: cx + 2.15, minZ: cz - 2.15, maxZ: cz + 2.15, minY: 0, maxY: 2.5 },
    );
  }
  return walls;
}

export function surfaceHeightAt(
  x: number,
  z: number,
  currentY: number,
  _buildings?: readonly EnterableBuilding[],
): number {
  return snakeCoreWasm.surfaceHeight(x, z, currentY);
}

export interface BuildingLocationInfo {
  building: EnterableBuilding | null;
  label: string;
  isIndoors: boolean;
  hideRoof: boolean;
}

export function getWorldRegionAt(x: number, z: number): WorldRegion | null {
  let closest: WorldRegion | null = null;
  let bestD2 = Infinity;
  for (const reg of WORLD_REGIONS) {
    const dx = x - reg.x;
    const dz = z - reg.z;
    const d2 = dx * dx + dz * dz;
    if (d2 <= reg.radius * reg.radius && d2 < bestD2) {
      bestD2 = d2;
      closest = reg;
    }
  }
  return closest;
}

export function resolveLocationLabel(
  buildings: readonly EnterableBuilding[],
  buildingIdx: number,
  zoneType: number,
  zoneIdx: number,
  x = 0,
  z = 0,
): { building: EnterableBuilding | null; label: string } {
  if (buildingIdx >= 0 && buildingIdx < buildings.length) {
    const b = buildings[buildingIdx];
    const subLabel =
      zoneType === 1
        ? b.ramps[zoneIdx]?.label ?? ''
        : zoneType === 2
          ? b.floors[zoneIdx]?.label ?? ''
          : '';
    return { building: b, label: subLabel ? `${b.name} · ${subLabel}` : b.name };
  }
  if (zoneType === 3) {
    const vName = VILLAGES[zoneIdx]?.name ?? 'Timberhollow';
    return { building: null, label: `${vName} Village` };
  }
  const region = getWorldRegionAt(x, z);
  if (region) return { building: null, label: region.name };
  if (zoneType === 4) return { building: null, label: 'Timberhollow Trailhead' };
  if (zoneType === 5) return { building: null, label: 'Northern Highlands' };
  return { building: null, label: 'Ancient Emerald Forest' };
}

export function getBuildingAtPosition(
  x: number,
  z: number,
  y: number,
  buildings: readonly EnterableBuilding[],
): BuildingLocationInfo {
  const e = snakeCoreWasm.getExports();
  e.wasm_get_building_at_position(x, z, y);
  const sc = snakeCoreWasm.scratchView;
  const bIdx = Math.round(sc[0]);
  const zoneType = Math.round(sc[2]);
  const zoneIdx = Math.round(sc[3]);
  const isIndoors = sc[4] > 0.5;
  const hideRoof = sc[5] > 0.5;
  const resolved = resolveLocationLabel(buildings, bIdx, zoneType, zoneIdx, x, z);
  return {
    building: resolved.building,
    label: resolved.label,
    isIndoors,
    hideRoof,
  };
}

export function resolveBuildingWallCollision(
  x: number,
  y: number,
  z: number,
  radius: number,
  buildings?: readonly EnterableBuilding[],
): { x: number; z: number; collided: boolean; normalX: number; normalZ: number } {
  return resolveBuildingWallsTS(
    x,
    y,
    z,
    radius,
    buildings ?? createWorldBuildings(),
    groundHeightAt,
  );
}

export function resolveWorldWallsCollision(
  x: number,
  y: number,
  z: number,
  radius: number,
  walls?: readonly WallBox[],
): { x: number; z: number; collided: boolean; normalX: number; normalZ: number } {
  return resolveWorldWallsAndVillagePropsTS(
    x,
    y,
    z,
    radius,
    walls ?? createVillageFenceWalls(),
    VILLAGES,
    groundHeightAt,
  );
}

export function isPointNearBuilding(
  x: number,
  z: number,
  padding: number,
  _buildings?: readonly EnterableBuilding[],
): boolean {
  return snakeCoreWasm.getExports().wasm_is_point_near_building(x, z, padding) !== 0;
}

export type { BuildingKind };
