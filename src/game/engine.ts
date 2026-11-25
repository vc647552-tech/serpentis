import {
  ARENA_RADIUS,
  VILLAGES,
  VILLAGE_BOUNDS,
  WATER_PONDS,
  WORLD_REGIONS,
  createVillageFenceWalls,
  createWorldBuildings,
  groundHeightAt,
  resolveLocationLabel,
  surfaceHeightAt,
} from './buildings';
import {
  OutdoorCollisionContext,
  enforceFullBodySolidClearance,
  resolveHeadAndSnoutTS,
} from './outdoorCollisions';
import { SmartAiController } from './smartAi';
import { SCALAR_F32, SCALAR_I32, snakeCoreWasm } from '../wasm/snakeCoreWasm';
import {
  CameraMode,
  DifficultyLevel,
  EngineCallbacks,
  EnterableBuilding,
  GamePhase,
  Hatchling,
  HazardObstacle,
  HudSnapshot,
  InputState,
  LaidEgg,
  ObstacleKind,
  PreyItem,
  PreyKind,
  Projectile,
  ProjectileKind,
  SegmentPose,
  SnakeSpecies,
  SpeciesPowerInfo,
  SpinePoint,
  TreeCollider,
  Villager,
  VillagerRole,
  VillagerState,
  WallBox,
} from './types';

export { ARENA_RADIUS, VILLAGES, VILLAGE_BOUNDS, WATER_PONDS, WORLD_REGIONS, groundHeightAt };

export const HEAD_RADIUS = 0.44;
export const SEGMENT_SPACING = 0.44;
export const INITIAL_SEGMENTS = 12;
export const MAX_SEGMENTS = 160;
export const START_SNAKE_SCALE = 0.48;
export const SWALLOW_MIN_SCALE = 0.85;
export const MAX_SNAKE_SCALE = 1.65;
export const BASE_SPEED = 5.6;
export const MAX_SPEED_BONUS = 3.4;
export const BOOST_MULTIPLIER = 1.72;
export const TURN_RATE = 3.2;
export const SELF_COLLISION_SKIP = 10;
export const COMBO_DURATION = 5.5;
export const MAX_PREY_COUNT = 64;

export const MAX_SNAKE_HP = 100;
export const MAX_HATCHLINGS = 8;
export const EGG_STAMINA_COST = 24;
export const EGG_COOLDOWN_SEC = 2.0;
export const EGG_HATCH_TIME_SEC = 3.8;
export const MAX_ACTIVE_ATTACKERS = 3;

const MAX_PREY_POOL = 72;
const MAX_VILLAGER_POOL = 72;
const MAX_EGG_POOL = 8;
const MAX_HATCHLING_POOL = 8;
const MAX_PROJ_POOL = 96;
const MAX_OBS_POOL = 112;
const MAX_TREE_POOL = 320;

const PHASE_LIST: readonly GamePhase[] = ['title', 'playing', 'paused', 'gameover'];
const CAMERA_LIST: readonly CameraMode[] = ['chase', 'canopy'];
const SPECIES_LIST: readonly SnakeSpecies[] = [
  'emerald',
  'golden',
  'obsidian',
  'rattler',
  'coral',
  'albino',
];
const DIFF_LIST: readonly DifficultyLevel[] = ['relaxed', 'realistic', 'apex'];
const DEATH_LIST: ReadonlyArray<'boundary' | 'obstacle' | 'self' | 'hunter' | null> = [
  null,
  'boundary',
  'obstacle',
  'self',
  'hunter',
];
const PREY_KIND_LIST: readonly PreyKind[] = [
  'rabbit',
  'frog',
  'mouse',
  'berry',
  'egg',
  'deer',
  'boar',
  'elephant',
];
const ROLE_LIST: readonly VillagerRole[] = ['flee', 'hide', 'spearman', 'crossbow'];
const VSTATE_LIST: readonly VillagerState[] = [
  'patrol',
  'fleeing',
  'seeking_shelter',
  'hiding',
  'pursue',
  'windup',
  'attack',
  'recover',
  'ko',
];

const EVT_EAT = 1;
const EVT_HATCH = 2;
const EVT_LAY_EGG = 3;
const EVT_SNAKE_HURT = 4;
const EVT_VILLAGER_HIT = 5;
const EVT_HUNTER_TELEGRAPH = 6;
const EVT_CRASH = 7;
const EVT_PHASE_CHANGE = 8;
const EVT_POWER_USED = 9;
const EVT_TAIL_GRAB = 10;
const EVT_TAIL_DEVOUR = 11;
const EVT_VENOM_HIT = 12;
const EVT_BLOOD_DRINK = 13;
const EVT_SECONDARY_POWER = 14;
const EVT_RIVAL_CLASH = 15;

const PROJ_KIND_LIST: readonly ProjectileKind[] = ['bolt', 'venom', 'mist'];

export interface SpeciesTraits {
  speedMult: number;
  turnMult: number;
  staminaDrainMult: number;
}

export function getSpeciesTraits(species: SnakeSpecies): SpeciesTraits {
  switch (species) {
    case 'golden':
      return { speedMult: 1.07, turnMult: 1.04, staminaDrainMult: 1.0 };
    case 'obsidian':
      return { speedMult: 1.03, turnMult: 1.0, staminaDrainMult: 0.78 };
    case 'rattler':
      return { speedMult: 1.02, turnMult: 1.12, staminaDrainMult: 0.92 };
    case 'coral':
      return { speedMult: 1.1, turnMult: 1.1, staminaDrainMult: 1.08 };
    case 'albino':
      return { speedMult: 0.98, turnMult: 1.08, staminaDrainMult: 0.82 };
    case 'emerald':
    default:
      return { speedMult: 1.0, turnMult: 1.05, staminaDrainMult: 0.9 };
  }
}

export function getSpeciesPowerInfo(species: SnakeSpecies): SpeciesPowerInfo {
  switch (species) {
    case 'golden':
      return {
        name: 'Venom Spray',
        shortName: 'Venom',
        description: '7-fang toxic arc that slows and poisons hunters',
        accentHex: '#84cc16',
        cooldownSec: 3.4,
      };
    case 'coral':
      return {
        name: 'Venom Dart',
        shortName: 'Darts',
        description: '3 high-speed venom bolts + stamina surge',
        accentHex: '#f97316',
        cooldownSec: 2.8,
      };
    case 'obsidian':
      return {
        name: 'Titan Crush',
        shortName: 'Crush',
        description: 'Seismic coil slam that stuns foes & shatters bolts',
        accentHex: '#38bdf8',
        cooldownSec: 4.8,
      };
    case 'rattler':
      return {
        name: 'Sonic Rattle',
        shortName: 'Sonic',
        description: 'Shockwave stun blast + venom cloud',
        accentHex: '#facc15',
        cooldownSec: 4.2,
      };
    case 'albino':
      return {
        name: 'Phantom Veil',
        shortName: 'Veil',
        description: '3.8s stealth cloak + twin silent venom fangs',
        accentHex: '#e2e8f0',
        cooldownSec: 5.4,
      };
    case 'emerald':
    default:
      return {
        name: 'Venom Mist',
        shortName: 'Mist',
        description: 'Toxic canopy mist wave + regenerates health',
        accentHex: '#22c55e',
        cooldownSec: 3.6,
      };
  }
}

export function normalizeAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function sampleSpineAtDistance(
  spine: readonly SpinePoint[],
  headTotalDist: number,
  distBehind: number,
): { x: number; y: number; z: number; yaw: number } {
  return snakeCoreWasm.sampleSpineAtDistance(spine, headTotalDist, distBehind);
}

export function createSeededRng(seed = 1337): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function createPreySlotView(slotIdx: number): PreyItem {
  const b = slotIdx * 16;
  return {
    get id() { return snakeCoreWasm.preyI32[b]; },
    set id(v) { snakeCoreWasm.preyI32[b] = v; },
    get kind() { return PREY_KIND_LIST[snakeCoreWasm.preyI32[b + 1]] ?? 'rabbit'; },
    set kind(v) {
      const idx = PREY_KIND_LIST.indexOf(v);
      snakeCoreWasm.preyI32[b + 1] = idx >= 0 ? idx : 0;
    },
    get points() { return snakeCoreWasm.preyI32[b + 2]; },
    set points(v) { snakeCoreWasm.preyI32[b + 2] = v; },
    get growth() { return snakeCoreWasm.preyI32[b + 3]; },
    set growth(v) { snakeCoreWasm.preyI32[b + 3] = v; },
    get staminaGain() { return snakeCoreWasm.preyI32[b + 4]; },
    set staminaGain(v) { snakeCoreWasm.preyI32[b + 4] = v; },
    get fleeing() { return snakeCoreWasm.preyI32[b + 5] !== 0; },
    set fleeing(v) { snakeCoreWasm.preyI32[b + 5] = v ? 1 : 0; },
    get x() { return snakeCoreWasm.preyF32[b + 6]; },
    set x(v) { snakeCoreWasm.preyF32[b + 6] = v; },
    get y() { return snakeCoreWasm.preyF32[b + 7]; },
    set y(v) { snakeCoreWasm.preyF32[b + 7] = v; },
    get z() { return snakeCoreWasm.preyF32[b + 8]; },
    set z(v) { snakeCoreWasm.preyF32[b + 8] = v; },
    get vx() { return snakeCoreWasm.preyF32[b + 9]; },
    set vx(v) { snakeCoreWasm.preyF32[b + 9] = v; },
    get vz() { return snakeCoreWasm.preyF32[b + 10]; },
    set vz(v) { snakeCoreWasm.preyF32[b + 10] = v; },
    get heading() { return snakeCoreWasm.preyF32[b + 11]; },
    set heading(v) { snakeCoreWasm.preyF32[b + 11] = v; },
    get radius() { return snakeCoreWasm.preyF32[b + 12]; },
    set radius(v) { snakeCoreWasm.preyF32[b + 12] = v; },
    get phase() { return snakeCoreWasm.preyF32[b + 13]; },
    set phase(v) { snakeCoreWasm.preyF32[b + 13] = v; },
    get gaitPhase() { return snakeCoreWasm.preyF32[b + 14]; },
    set gaitPhase(v) { snakeCoreWasm.preyF32[b + 14] = v; },
    get idleTimer() { return snakeCoreWasm.preyF32[b + 15]; },
    set idleTimer(v) { snakeCoreWasm.preyF32[b + 15] = v; },
  };
}

function writePreySlot(slotIdx: number, src: PreyItem): void {
  const b = slotIdx * 16;
  const i32 = snakeCoreWasm.preyI32;
  const f32 = snakeCoreWasm.preyF32;
  const kIdx = PREY_KIND_LIST.indexOf(src.kind);
  i32[b] = src.id;
  i32[b + 1] = kIdx >= 0 ? kIdx : 0;
  i32[b + 2] = src.points;
  i32[b + 3] = src.growth;
  i32[b + 4] = src.staminaGain;
  i32[b + 5] = src.fleeing ? 1 : 0;
  f32[b + 6] = src.x;
  f32[b + 7] = src.y;
  f32[b + 8] = src.z;
  f32[b + 9] = src.vx;
  f32[b + 10] = src.vz;
  f32[b + 11] = src.heading;
  f32[b + 12] = src.radius;
  f32[b + 13] = src.phase;
  f32[b + 14] = src.gaitPhase;
  f32[b + 15] = src.idleTimer;
}

function createVillagerSlotView(slotIdx: number): Villager {
  const b = slotIdx * 36;
  return {
    get id() { return snakeCoreWasm.villagersI32[b]; },
    set id(v) { snakeCoreWasm.villagersI32[b] = v; },
    get role() { return ROLE_LIST[snakeCoreWasm.villagersI32[b + 1]] ?? 'flee'; },
    set role(v) {
      const idx = ROLE_LIST.indexOf(v);
      snakeCoreWasm.villagersI32[b + 1] = idx >= 0 ? idx : 0;
    },
    get state() { return VSTATE_LIST[snakeCoreWasm.villagersI32[b + 2]] ?? 'patrol'; },
    set state(v) {
      const idx = VSTATE_LIST.indexOf(v);
      snakeCoreWasm.villagersI32[b + 2] = idx >= 0 ? idx : 0;
    },
    get hp() { return snakeCoreWasm.villagersF32[b + 3]; },
    set hp(v) { snakeCoreWasm.villagersF32[b + 3] = v; },
    get maxHp() { return snakeCoreWasm.villagersF32[b + 4]; },
    set maxHp(v) { snakeCoreWasm.villagersF32[b + 4] = v; },
    get targetBuildingId() {
      const id = snakeCoreWasm.villagersI32[b + 5];
      return id >= 0 ? id : null;
    },
    set targetBuildingId(v) { snakeCoreWasm.villagersI32[b + 5] = v ?? -1; },
    get shirtColor() { return snakeCoreWasm.villagersI32[b + 6]; },
    set shirtColor(v) { snakeCoreWasm.villagersI32[b + 6] = v; },
    get trouserColor() { return snakeCoreWasm.villagersI32[b + 7]; },
    set trouserColor(v) { snakeCoreWasm.villagersI32[b + 7] = v; },
    get hairColor() { return snakeCoreWasm.villagersI32[b + 8]; },
    set hairColor(v) { snakeCoreWasm.villagersI32[b + 8] = v; },
    get skinTone() { return snakeCoreWasm.villagersI32[b + 9]; },
    set skinTone(v) { snakeCoreWasm.villagersI32[b + 9] = v; },
    get hasBeard() { return snakeCoreWasm.villagersI32[b + 10] !== 0; },
    set hasBeard(v) { snakeCoreWasm.villagersI32[b + 10] = v ? 1 : 0; },
    get isElite() { return snakeCoreWasm.villagersI32[b + 11] !== 0; },
    set isElite(v) { snakeCoreWasm.villagersI32[b + 11] = v ? 1 : 0; },
    get tier() { return snakeCoreWasm.villagersI32[b + 12]; },
    set tier(v) { snakeCoreWasm.villagersI32[b + 12] = v ?? 1; },
    get x() { return snakeCoreWasm.villagersF32[b + 13]; },
    set x(v) { snakeCoreWasm.villagersF32[b + 13] = v; },
    get y() { return snakeCoreWasm.villagersF32[b + 14]; },
    set y(v) { snakeCoreWasm.villagersF32[b + 14] = v; },
    get z() { return snakeCoreWasm.villagersF32[b + 15]; },
    set z(v) { snakeCoreWasm.villagersF32[b + 15] = v; },
    get vx() { return snakeCoreWasm.villagersF32[b + 16]; },
    set vx(v) { snakeCoreWasm.villagersF32[b + 16] = v; },
    get vz() { return snakeCoreWasm.villagersF32[b + 17]; },
    set vz(v) { snakeCoreWasm.villagersF32[b + 17] = v; },
    get heading() { return snakeCoreWasm.villagersF32[b + 18]; },
    set heading(v) { snakeCoreWasm.villagersF32[b + 18] = v; },
    get radius() { return snakeCoreWasm.villagersF32[b + 19]; },
    set radius(v) { snakeCoreWasm.villagersF32[b + 19] = v; },
    get speed() { return snakeCoreWasm.villagersF32[b + 20]; },
    set speed(v) { snakeCoreWasm.villagersF32[b + 20] = v; },
    get gaitPhase() { return snakeCoreWasm.villagersF32[b + 21]; },
    set gaitPhase(v) { snakeCoreWasm.villagersF32[b + 21] = v; },
    get phase() { return snakeCoreWasm.villagersF32[b + 22]; },
    set phase(v) { snakeCoreWasm.villagersF32[b + 22] = v; },
    get homeX() { return snakeCoreWasm.villagersF32[b + 23]; },
    set homeX(v) { snakeCoreWasm.villagersF32[b + 23] = v; },
    get homeZ() { return snakeCoreWasm.villagersF32[b + 24]; },
    set homeZ(v) { snakeCoreWasm.villagersF32[b + 24] = v; },
    get stateTimer() { return snakeCoreWasm.villagersF32[b + 25]; },
    set stateTimer(v) { snakeCoreWasm.villagersF32[b + 25] = v; },
    get attackCooldown() { return snakeCoreWasm.villagersF32[b + 26]; },
    set attackCooldown(v) { snakeCoreWasm.villagersF32[b + 26] = v; },
    get hitFlash() { return snakeCoreWasm.villagersF32[b + 27]; },
    set hitFlash(v) { snakeCoreWasm.villagersF32[b + 27] = v; },
    get koTimer() { return snakeCoreWasm.villagersF32[b + 28]; },
    set koTimer(v) { snakeCoreWasm.villagersF32[b + 28] = v; },
    get poisonTimer() { return snakeCoreWasm.villagersF32[b + 29]; },
    set poisonTimer(v) { snakeCoreWasm.villagersF32[b + 29] = v ?? 0; },
    get stunTimer() { return snakeCoreWasm.villagersF32[b + 30]; },
    set stunTimer(v) { snakeCoreWasm.villagersF32[b + 30] = v ?? 0; },
    get grabbed() { return snakeCoreWasm.villagersI32[b + 31] !== 0; },
    set grabbed(v) { snakeCoreWasm.villagersI32[b + 31] = v ? 1 : 0; },
    get homeVillageId() { return snakeCoreWasm.villagersI32[b + 32]; },
    set homeVillageId(v) { snakeCoreWasm.villagersI32[b + 32] = v ?? 0; },
    get targetVillagerId() {
      const id = snakeCoreWasm.villagersI32[b + 33];
      return id >= 0 ? id : null;
    },
    set targetVillagerId(v) { snakeCoreWasm.villagersI32[b + 33] = v ?? -1; },
  };
}

function createEggSlotView(slotIdx: number): LaidEgg {
  const b = slotIdx * 8;
  return {
    get id() { return snakeCoreWasm.eggsI32[b]; },
    set id(v) { snakeCoreWasm.eggsI32[b] = v; },
    get species() { return SPECIES_LIST[snakeCoreWasm.eggsI32[b + 1]] ?? 'emerald'; },
    set species(v) {
      const idx = SPECIES_LIST.indexOf(v);
      snakeCoreWasm.eggsI32[b + 1] = idx >= 0 ? idx : 0;
    },
    get x() { return snakeCoreWasm.eggsF32[b + 2]; },
    set x(v) { snakeCoreWasm.eggsF32[b + 2] = v; },
    get y() { return snakeCoreWasm.eggsF32[b + 3]; },
    set y(v) { snakeCoreWasm.eggsF32[b + 3] = v; },
    get z() { return snakeCoreWasm.eggsF32[b + 4]; },
    set z(v) { snakeCoreWasm.eggsF32[b + 4] = v; },
    get age() { return snakeCoreWasm.eggsF32[b + 5]; },
    set age(v) { snakeCoreWasm.eggsF32[b + 5] = v; },
    get hatchTime() { return snakeCoreWasm.eggsF32[b + 6]; },
    set hatchTime(v) { snakeCoreWasm.eggsF32[b + 6] = v; },
  };
}

function createHatchlingSlotView(slotIdx: number): Hatchling {
  const b = slotIdx * 16;
  const posePool: SegmentPose[] = [];
  for (let p = 0; p < 32; p++) {
    const pOff = p * 5;
    posePool.push({
      get x() { return snakeCoreWasm.getHatchlingPoseView(slotIdx)[pOff]; },
      set x(v) { snakeCoreWasm.getHatchlingPoseView(slotIdx)[pOff] = v; },
      get y() { return snakeCoreWasm.getHatchlingPoseView(slotIdx)[pOff + 1]; },
      set y(v) { snakeCoreWasm.getHatchlingPoseView(slotIdx)[pOff + 1] = v; },
      get z() { return snakeCoreWasm.getHatchlingPoseView(slotIdx)[pOff + 2]; },
      set z(v) { snakeCoreWasm.getHatchlingPoseView(slotIdx)[pOff + 2] = v; },
      get yaw() { return snakeCoreWasm.getHatchlingPoseView(slotIdx)[pOff + 3]; },
      set yaw(v) { snakeCoreWasm.getHatchlingPoseView(slotIdx)[pOff + 3] = v; },
      get radius() { return snakeCoreWasm.getHatchlingPoseView(slotIdx)[pOff + 4]; },
      set radius(v) { snakeCoreWasm.getHatchlingPoseView(slotIdx)[pOff + 4] = v; },
    });
  }
  const activePoses: SegmentPose[] = [];
  const emptySpine: SpinePoint[] = [];

  return {
    get id() { return snakeCoreWasm.hatchlingsI32[b]; },
    set id(v) { snakeCoreWasm.hatchlingsI32[b] = v; },
    get stage() { return (snakeCoreWasm.hatchlingsI32[b + 1] || 1) as 1 | 2 | 3; },
    set stage(v) { snakeCoreWasm.hatchlingsI32[b + 1] = v; },
    get targetVillagerId() {
      const id = snakeCoreWasm.hatchlingsI32[b + 2];
      return id >= 0 ? id : null;
    },
    set targetVillagerId(v) { snakeCoreWasm.hatchlingsI32[b + 2] = v ?? -1; },
    get targetPreyId() {
      const id = snakeCoreWasm.hatchlingsI32[b + 3];
      return id >= 0 ? id : null;
    },
    set targetPreyId(v) { snakeCoreWasm.hatchlingsI32[b + 3] = v ?? -1; },
    get x() { return snakeCoreWasm.hatchlingsF32[b + 6]; },
    set x(v) { snakeCoreWasm.hatchlingsF32[b + 6] = v; },
    get y() { return snakeCoreWasm.hatchlingsF32[b + 7]; },
    set y(v) { snakeCoreWasm.hatchlingsF32[b + 7] = v; },
    get z() { return snakeCoreWasm.hatchlingsF32[b + 8]; },
    set z(v) { snakeCoreWasm.hatchlingsF32[b + 8] = v; },
    get heading() { return snakeCoreWasm.hatchlingsF32[b + 9]; },
    set heading(v) { snakeCoreWasm.hatchlingsF32[b + 9] = v; },
    get speed() { return snakeCoreWasm.hatchlingsF32[b + 10]; },
    set speed(v) { snakeCoreWasm.hatchlingsF32[b + 10] = v; },
    get growth() { return snakeCoreWasm.hatchlingsF32[b + 11]; },
    set growth(v) { snakeCoreWasm.hatchlingsF32[b + 11] = v; },
    get biteCooldown() { return snakeCoreWasm.hatchlingsF32[b + 12]; },
    set biteCooldown(v) { snakeCoreWasm.hatchlingsF32[b + 12] = v; },
    get totalDist() { return snakeCoreWasm.hatchlingsF32[b + 13]; },
    set totalDist(v) { snakeCoreWasm.hatchlingsF32[b + 13] = v; },
    get spine() { return emptySpine; },
    get segmentPoses() {
      const n = Math.min(32, Math.max(0, snakeCoreWasm.hatchlingsI32[b + 4]));
      if (activePoses.length !== n) {
        activePoses.length = 0;
        for (let i = 0; i < n; i++) activePoses.push(posePool[i]);
      }
      return activePoses;
    },
  };
}

function createProjectileSlotView(slotIdx: number): Projectile {
  const b = slotIdx * 16;
  return {
    get id() { return snakeCoreWasm.projectilesI32[b]; },
    set id(v) { snakeCoreWasm.projectilesI32[b] = v; },
    get damage() { return snakeCoreWasm.projectilesI32[b + 1]; },
    set damage(v) { snakeCoreWasm.projectilesI32[b + 1] = v; },
    get x() { return snakeCoreWasm.projectilesF32[b + 2]; },
    set x(v) { snakeCoreWasm.projectilesF32[b + 2] = v; },
    get y() { return snakeCoreWasm.projectilesF32[b + 3]; },
    set y(v) { snakeCoreWasm.projectilesF32[b + 3] = v; },
    get z() { return snakeCoreWasm.projectilesF32[b + 4]; },
    set z(v) { snakeCoreWasm.projectilesF32[b + 4] = v; },
    get vx() { return snakeCoreWasm.projectilesF32[b + 5]; },
    set vx(v) { snakeCoreWasm.projectilesF32[b + 5] = v; },
    get vy() { return snakeCoreWasm.projectilesF32[b + 6]; },
    set vy(v) { snakeCoreWasm.projectilesF32[b + 6] = v; },
    get vz() { return snakeCoreWasm.projectilesF32[b + 7]; },
    set vz(v) { snakeCoreWasm.projectilesF32[b + 7] = v; },
    get yaw() { return snakeCoreWasm.projectilesF32[b + 8]; },
    set yaw(v) { snakeCoreWasm.projectilesF32[b + 8] = v; },
    get life() { return snakeCoreWasm.projectilesF32[b + 9]; },
    set life(v) { snakeCoreWasm.projectilesF32[b + 9] = v; },
    get kind() { return PROJ_KIND_LIST[snakeCoreWasm.projectilesI32[b + 10]] ?? 'bolt'; },
    set kind(v) {
      const idx = PROJ_KIND_LIST.indexOf(v);
      snakeCoreWasm.projectilesI32[b + 10] = idx >= 0 ? idx : 0;
    },
    get radius() { return snakeCoreWasm.projectilesF32[b + 11]; },
    set radius(v) { snakeCoreWasm.projectilesF32[b + 11] = v; },
    get ownerVillageId() { return snakeCoreWasm.projectilesI32[b + 12]; },
    set ownerVillageId(v) { snakeCoreWasm.projectilesI32[b + 12] = v ?? -1; },
  };
}

function createObstacleSlotView(slotIdx: number): HazardObstacle {
  const b = slotIdx * 8;
  return {
    get id() { return snakeCoreWasm.obstaclesI32[b]; },
    get kind(): ObstacleKind { return snakeCoreWasm.obstaclesI32[b + 1] === 0 ? 'boulder' : 'log'; },
    get x() { return snakeCoreWasm.obstaclesF32[b + 2]; },
    get z() { return snakeCoreWasm.obstaclesF32[b + 3]; },
    get radius() { return snakeCoreWasm.obstaclesF32[b + 4]; },
    get rotation() { return snakeCoreWasm.obstaclesF32[b + 5]; },
    get scale() { return snakeCoreWasm.obstaclesF32[b + 6]; },
  };
}

function createTreeSlotView(slotIdx: number): TreeCollider {
  const b = slotIdx * 8;
  return {
    get id() { return snakeCoreWasm.treesI32[b]; },
    get kind() { return snakeCoreWasm.treesI32[b + 1] === 0 ? 'oak' : 'pine'; },
    get x() { return snakeCoreWasm.treesF32[b + 2]; },
    get z() { return snakeCoreWasm.treesF32[b + 3]; },
    get radius() { return snakeCoreWasm.treesF32[b + 4]; },
    get scale() { return snakeCoreWasm.treesF32[b + 5]; },
  };
}

function createPlayerPoseView(slotIdx: number): SegmentPose {
  const b = slotIdx * 5;
  return {
    get x() { return snakeCoreWasm.playerPosesF32[b]; },
    set x(v) { snakeCoreWasm.playerPosesF32[b] = v; },
    get y() { return snakeCoreWasm.playerPosesF32[b + 1]; },
    set y(v) { snakeCoreWasm.playerPosesF32[b + 1] = v; },
    get z() { return snakeCoreWasm.playerPosesF32[b + 2]; },
    set z(v) { snakeCoreWasm.playerPosesF32[b + 2] = v; },
    get yaw() { return snakeCoreWasm.playerPosesF32[b + 3]; },
    set yaw(v) { snakeCoreWasm.playerPosesF32[b + 3] = v; },
    get radius() { return snakeCoreWasm.playerPosesF32[b + 4]; },
    set radius(v) { snakeCoreWasm.playerPosesF32[b + 4] = v; },
  };
}

export class SnakeGameEngine {
  public readonly buildings: EnterableBuilding[];
  public readonly fenceWalls: WallBox[];
  public readonly preyItems: PreyItem[];
  public readonly villagers: Villager[] = [];
  public readonly laidEggs: LaidEgg[] = [];
  public readonly hatchlings: Hatchling[] = [];
  public readonly projectiles: Projectile[] = [];
  public readonly obstacles: HazardObstacle[] = [];
  public readonly trees: TreeCollider[] = [];
  public readonly segmentPoses: SegmentPose[] = [];

  private readonly preyPool: PreyItem[] = [];
  private readonly rawPreyItems: PreyItem[] = [];
  private readonly villagerPool: Villager[] = [];
  private readonly eggPool: LaidEgg[] = [];
  private readonly hatchlingPool: Hatchling[] = [];
  private readonly projectilePool: Projectile[] = [];
  private readonly obstaclePool: HazardObstacle[] = [];
  private readonly treePool: TreeCollider[] = [];
  private readonly playerPosePool: SegmentPose[] = [];

  private callbacks: EngineCallbacks;
  private readonly smartAi: SmartAiController;
  private collisionCtx: OutdoorCollisionContext | null = null;
  private cachedRadarBuildings: Array<{
    name: string;
    x: number;
    z: number;
    rotation: number;
    kind: 'cabin' | 'manor' | 'ruin_tower';
    scale: number;
  }>;
  private cachedObstaclesVersion = -1;
  private cachedRadarObstacles: Array<{ x: number; z: number; radius: number; kind: ObstacleKind }> = [];
  private readonly radarTrailPool: Array<{ x: number; z: number }> = [];
  private readonly radarTrailOut: Array<{ x: number; z: number }> = [];
  private readonly radarPreyPool: Array<{ x: number; z: number; kind: PreyKind }> = [];
  private readonly radarPreyOut: Array<{ x: number; z: number; kind: PreyKind }> = [];
  private readonly radarVillagerPool: Array<{
    x: number;
    z: number;
    role: VillagerRole;
    state: VillagerState;
    homeVillageId?: number;
  }> = [];
  private readonly radarVillagerOut: Array<{
    x: number;
    z: number;
    role: VillagerRole;
    state: VillagerState;
    homeVillageId?: number;
  }> = [];
  private readonly radarHatchPool: Array<{ x: number; z: number }> = [];
  private readonly radarHatchOut: Array<{ x: number; z: number }> = [];
  private readonly radarEggPool: Array<{ x: number; z: number }> = [];
  private readonly radarEggOut: Array<{ x: number; z: number }> = [];

  constructor(callbacks: EngineCallbacks = {}, seed = 2026) {
    this.callbacks = callbacks;
    const exp = snakeCoreWasm.getExports();
    exp.wasm_init(seed >>> 0);

    this.buildings = createWorldBuildings();
    this.fenceWalls = createVillageFenceWalls();
    this.smartAi = new SmartAiController(this.buildings);
    this.cachedRadarBuildings = this.buildings.map((b) => ({
      name: b.name,
      x: b.x,
      z: b.z,
      rotation: b.rotation,
      kind: b.kind,
      scale: b.scale,
    }));

    for (let i = 0; i < MAX_PREY_POOL; i++) this.preyPool.push(createPreySlotView(i));
    for (let i = 0; i < MAX_VILLAGER_POOL; i++) this.villagerPool.push(createVillagerSlotView(i));
    for (let i = 0; i < MAX_EGG_POOL; i++) this.eggPool.push(createEggSlotView(i));
    for (let i = 0; i < MAX_HATCHLING_POOL; i++) this.hatchlingPool.push(createHatchlingSlotView(i));
    for (let i = 0; i < MAX_PROJ_POOL; i++) this.projectilePool.push(createProjectileSlotView(i));
    for (let i = 0; i < MAX_OBS_POOL; i++) this.obstaclePool.push(createObstacleSlotView(i));
    for (let i = 0; i < MAX_TREE_POOL; i++) this.treePool.push(createTreeSlotView(i));
    for (let i = 0; i < MAX_SEGMENTS; i++) this.playerPosePool.push(createPlayerPoseView(i));

    this.preyItems = new Proxy(this.rawPreyItems, {
      set: (target, prop, value, receiver) => {
        if (typeof prop === 'string' && /^\d+$/.test(prop)) {
          const idx = Number(prop);
          if (idx >= 0 && idx < MAX_PREY_POOL && value && typeof value === 'object') {
            writePreySlot(idx, value as PreyItem);
            if (snakeCoreWasm.countsI32[0] <= idx) {
              snakeCoreWasm.countsI32[0] = idx + 1;
            }
            target[idx] = this.preyPool[idx];
            return true;
          }
        }
        return Reflect.set(target, prop, value, receiver);
      },
    });

    this.syncPools();
    exp.wasm_clear_events();
  }

  public get phase(): GamePhase {
    return PHASE_LIST[snakeCoreWasm.scalarsI32[SCALAR_I32.phase]] ?? 'title';
  }
  public set phase(v: GamePhase) {
    const idx = PHASE_LIST.indexOf(v);
    snakeCoreWasm.scalarsI32[SCALAR_I32.phase] = idx >= 0 ? idx : 0;
  }

  public get cameraMode(): CameraMode {
    return CAMERA_LIST[snakeCoreWasm.scalarsI32[SCALAR_I32.cameraMode]] ?? 'chase';
  }
  public set cameraMode(v: CameraMode) {
    snakeCoreWasm.scalarsI32[SCALAR_I32.cameraMode] = v === 'canopy' ? 1 : 0;
  }

  public get species(): SnakeSpecies {
    return SPECIES_LIST[snakeCoreWasm.scalarsI32[SCALAR_I32.species]] ?? 'emerald';
  }
  public set species(v: SnakeSpecies) {
    const idx = SPECIES_LIST.indexOf(v);
    snakeCoreWasm.scalarsI32[SCALAR_I32.species] = idx >= 0 ? idx : 0;
  }

  public get difficulty(): DifficultyLevel {
    return DIFF_LIST[snakeCoreWasm.scalarsI32[SCALAR_I32.difficulty]] ?? 'realistic';
  }
  public set difficulty(v: DifficultyLevel) {
    const idx = DIFF_LIST.indexOf(v);
    snakeCoreWasm.scalarsI32[SCALAR_I32.difficulty] = idx >= 0 ? idx : 1;
  }

  public get turnSensitivity(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.turnSensitivity]; }
  public set turnSensitivity(v: number) { snakeCoreWasm.scalarsF32[SCALAR_F32.turnSensitivity] = v; }

  public get muted(): boolean { return snakeCoreWasm.scalarsI32[SCALAR_I32.muted] !== 0; }
  public set muted(v: boolean) { snakeCoreWasm.scalarsI32[SCALAR_I32.muted] = v ? 1 : 0; }

  public get headX(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.headX]; }
  public set headX(v: number) { snakeCoreWasm.scalarsF32[SCALAR_F32.headX] = v; }

  public get headY(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.headY]; }
  public set headY(v: number) { snakeCoreWasm.scalarsF32[SCALAR_F32.headY] = v; }

  public get headZ(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.headZ]; }
  public set headZ(v: number) { snakeCoreWasm.scalarsF32[SCALAR_F32.headZ] = v; }

  public get headVelY(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.headVelY]; }
  public set headVelY(v: number) { snakeCoreWasm.scalarsF32[SCALAR_F32.headVelY] = v; }

  public get heading(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.heading]; }
  public set heading(v: number) { snakeCoreWasm.scalarsF32[SCALAR_F32.heading] = v; }

  public get totalDist(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.totalDist]; }
  public set totalDist(v: number) { snakeCoreWasm.scalarsF32[SCALAR_F32.totalDist] = v; }

  public get speed(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.speed]; }
  public set speed(v: number) { snakeCoreWasm.scalarsF32[SCALAR_F32.speed] = v; }

  public get stamina(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.stamina]; }
  public set stamina(v: number) { snakeCoreWasm.scalarsF32[SCALAR_F32.stamina] = v; }

  public get isBoosting(): boolean { return snakeCoreWasm.scalarsI32[SCALAR_I32.isBoosting] !== 0; }
  public set isBoosting(v: boolean) { snakeCoreWasm.scalarsI32[SCALAR_I32.isBoosting] = v ? 1 : 0; }

  public get hp(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.hp]; }
  public set hp(v: number) { snakeCoreWasm.scalarsF32[SCALAR_F32.hp] = v; }

  public get maxHp(): number { return snakeCoreWasm.scalarsI32[SCALAR_I32.maxHp]; }
  public set maxHp(v: number) { snakeCoreWasm.scalarsI32[SCALAR_I32.maxHp] = v; }

  public get invulnTimer(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.invulnTimer]; }
  public set invulnTimer(v: number) { snakeCoreWasm.scalarsF32[SCALAR_F32.invulnTimer] = v; }

  public get outOfCombatTimer(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.outOfCombatTimer]; }
  public set outOfCombatTimer(v: number) { snakeCoreWasm.scalarsF32[SCALAR_F32.outOfCombatTimer] = v; }

  public get kills(): number { return snakeCoreWasm.scalarsI32[SCALAR_I32.kills]; }
  public set kills(v: number) { snakeCoreWasm.scalarsI32[SCALAR_I32.kills] = v; }

  public get segmentCount(): number { return snakeCoreWasm.scalarsI32[SCALAR_I32.segmentCount]; }
  public set segmentCount(v: number) {
    snakeCoreWasm.scalarsI32[SCALAR_I32.segmentCount] = v;
    snakeCoreWasm.getExports().wasm_compute_segment_poses();
    this.syncPool(this.segmentPoses, this.playerPosePool, v, MAX_SEGMENTS);
    if (this.phase === 'playing') {
      enforceFullBodySolidClearance(
        this.snakeScale,
        this.segmentCount,
        snakeCoreWasm.playerPosesF32,
        this.getCollisionContext(),
      );
    }
  }

  public get score(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.score]; }
  public set score(v: number) { snakeCoreWasm.scalarsF32[SCALAR_F32.score] = v; }

  public get bestScore(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.bestScore]; }
  public set bestScore(v: number) { snakeCoreWasm.scalarsF32[SCALAR_F32.bestScore] = v; }

  public get combo(): number { return snakeCoreWasm.scalarsI32[SCALAR_I32.combo]; }
  public set combo(v: number) { snakeCoreWasm.scalarsI32[SCALAR_I32.combo] = v; }

  public get comboTimer(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.comboTimer]; }
  public set comboTimer(v: number) { snakeCoreWasm.scalarsF32[SCALAR_F32.comboTimer] = v; }

  public get elapsedSeconds(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.elapsedSeconds]; }
  public set elapsedSeconds(v: number) { snakeCoreWasm.scalarsF32[SCALAR_F32.elapsedSeconds] = v; }

  public get deathReason(): 'boundary' | 'obstacle' | 'self' | 'hunter' | null {
    return DEATH_LIST[snakeCoreWasm.scalarsI32[SCALAR_I32.deathReason]] ?? null;
  }
  public set deathReason(v: 'boundary' | 'obstacle' | 'self' | 'hunter' | null) {
    const idx = DEATH_LIST.indexOf(v);
    snakeCoreWasm.scalarsI32[SCALAR_I32.deathReason] = idx >= 0 ? idx : 0;
  }

  public get mouthOpen(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.mouthOpen]; }
  public set mouthOpen(v: number) { snakeCoreWasm.scalarsF32[SCALAR_F32.mouthOpen] = v; }

  public get tongueTimer(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.tongueTimer]; }
  public set tongueTimer(v: number) { snakeCoreWasm.scalarsF32[SCALAR_F32.tongueTimer] = v; }

  public get nearPrey(): boolean { return snakeCoreWasm.scalarsI32[SCALAR_I32.nearPrey] !== 0; }
  public get hunterAlert(): boolean { return snakeCoreWasm.scalarsI32[SCALAR_I32.hunterAlert] !== 0; }

  public get raidHeat(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.raidHeat]; }
  public set raidHeat(v: number) { snakeCoreWasm.scalarsF32[SCALAR_F32.raidHeat] = v; }

  public get threatLevel(): number { return snakeCoreWasm.scalarsI32[SCALAR_I32.threatLevel]; }
  public set threatLevel(v: number) { snakeCoreWasm.scalarsI32[SCALAR_I32.threatLevel] = v; }

  public get activeBuildingId(): number | null {
    const id = snakeCoreWasm.scalarsI32[SCALAR_I32.activeBuildingId];
    return id > 0 ? id : null;
  }
  public get hideActiveRoof(): boolean { return snakeCoreWasm.scalarsI32[SCALAR_I32.hideActiveRoof] !== 0; }
  public get isIndoors(): boolean { return snakeCoreWasm.scalarsI32[SCALAR_I32.isIndoors] !== 0; }

  public get locationLabel(): string {
    const s = snakeCoreWasm.scalarsI32;
    return resolveLocationLabel(
      this.buildings,
      s[SCALAR_I32.locBuildingIdx],
      s[SCALAR_I32.locZoneType],
      s[SCALAR_I32.locZoneIdx],
      this.headX,
      this.headZ,
    ).label;
  }

  public get eggCooldown(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.eggCooldown]; }
  public set eggCooldown(v: number) { snakeCoreWasm.scalarsF32[SCALAR_F32.eggCooldown] = v; }

  public get totalHatched(): number { return snakeCoreWasm.scalarsI32[SCALAR_I32.totalHatched]; }

  public get powerCooldown(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.powerCooldown]; }
  public get powerMaxCooldown(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.powerMaxCooldown]; }
  public get tailGrabCooldown(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.tailGrabCooldown]; }
  public get tailGrabMaxCooldown(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.tailGrabMaxCooldown]; }
  public get grabTargetId(): number { return snakeCoreWasm.scalarsI32[SCALAR_I32.grabTargetId]; }
  public get grabStage(): number { return snakeCoreWasm.scalarsI32[SCALAR_I32.grabStage]; }
  public get grabWhipTimer(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.grabWhipTimer]; }
  public get stealthTimer(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.stealthTimer]; }
  public get powerPulseTimer(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.powerPulseTimer]; }
  public get powerPulseKind(): SnakeSpecies {
    return SPECIES_LIST[snakeCoreWasm.scalarsI32[SCALAR_I32.powerPulseKind]] ?? 'emerald';
  }
  public get powerPulseX(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.powerPulseX]; }
  public get powerPulseY(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.powerPulseY]; }
  public get powerPulseZ(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.powerPulseZ]; }

  public get feastCount(): number { return snakeCoreWasm.scalarsI32[SCALAR_I32.feastCount]; }
  public set feastCount(v: number) { snakeCoreWasm.scalarsI32[SCALAR_I32.feastCount] = v; }
  public get powerTier(): number { return snakeCoreWasm.scalarsI32[SCALAR_I32.powerTier]; }
  public get rivalClashActive(): boolean { return snakeCoreWasm.scalarsI32[SCALAR_I32.rivalClashActive] !== 0; }
  public get activeVillageId(): number { return snakeCoreWasm.scalarsI32[SCALAR_I32.activeVillageId]; }
  public get snakeScale(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.snakeScale]; }
  public set snakeScale(v: number) { snakeCoreWasm.scalarsF32[SCALAR_F32.snakeScale] = v; }
  public get canSwallow(): boolean { return this.snakeScale >= SWALLOW_MIN_SCALE; }
  public get secondaryCooldown(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.secondaryCooldown]; }
  public get secondaryMaxCooldown(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.secondaryMaxCooldown]; }
  public get swallowBulgeT(): number { return snakeCoreWasm.scalarsF32[SCALAR_F32.swallowBulgeT]; }

  private syncPool<T>(target: T[], pool: T[], count: number, cap: number): void {
    const n = Math.min(cap, Math.max(0, count));
    if (target.length !== n) {
      target.length = 0;
      for (let i = 0; i < n; i++) target.push(pool[i]);
    }
  }

  private syncPools(): void {
    const c = snakeCoreWasm.countsI32;
    this.syncPool(this.rawPreyItems, this.preyPool, c[0], MAX_PREY_POOL);
    this.syncPool(this.villagers, this.villagerPool, c[1], MAX_VILLAGER_POOL);
    this.syncPool(this.laidEggs, this.eggPool, c[2], MAX_EGG_POOL);
    this.syncPool(this.hatchlings, this.hatchlingPool, c[3], MAX_HATCHLING_POOL);
    this.syncPool(this.projectiles, this.projectilePool, c[4], MAX_PROJ_POOL);
    this.syncPool(this.obstacles, this.obstaclePool, c[5], MAX_OBS_POOL);
    this.syncPool(this.trees, this.treePool, c[6], MAX_TREE_POOL);
    this.syncPool(
      this.segmentPoses,
      this.playerPosePool,
      snakeCoreWasm.scalarsI32[SCALAR_I32.segmentCount],
      MAX_SEGMENTS,
    );
  }

  private findVillagerById(id: number): Villager | undefined {
    for (let i = 0; i < this.villagers.length; i++) {
      if (this.villagers[i].id === id) return this.villagers[i];
    }
    return undefined;
  }

  private findHatchlingById(id: number): Hatchling | undefined {
    for (let i = 0; i < this.hatchlings.length; i++) {
      if (this.hatchlings[i].id === id) return this.hatchlings[i];
    }
    return undefined;
  }

  private findEggById(id: number): LaidEgg | undefined {
    for (let i = 0; i < this.laidEggs.length; i++) {
      if (this.laidEggs[i].id === id) return this.laidEggs[i];
    }
    return undefined;
  }

  private drainEvents(): void {
    const exp = snakeCoreWasm.getExports();
    const count = snakeCoreWasm.countsI32[7];
    if (count <= 0) return;

    const i32 = snakeCoreWasm.eventsI32;
    const f32 = snakeCoreWasm.eventsF32;

    for (let i = 0; i < count; i++) {
      const b = i * 12;
      const type = i32[b];
      const a = i32[b + 1];
      const evB = i32[b + 2];
      const evC = i32[b + 3];
      const x = f32[b + 4];
      const y = f32[b + 5];
      const z = f32[b + 6];
      const f0 = f32[b + 7];
      const f1 = f32[b + 8];

      switch (type) {
        case EVT_EAT: {
          if (this.callbacks.onEat) {
            const preySnapshot: PreyItem = {
              id: a,
              kind: PREY_KIND_LIST[evB] ?? 'rabbit',
              x,
              y,
              z,
              vx: 0,
              vz: 0,
              heading: 0,
              radius: 0.56,
              points: 25,
              growth: 2,
              staminaGain: 20,
              phase: 0,
              gaitPhase: 0,
              idleTimer: 0,
              fleeing: false,
            };
            this.callbacks.onEat(preySnapshot, evC, f0);
          }
          break;
        }
        case EVT_HATCH: {
          if (this.callbacks.onHatch) {
            const h = this.findHatchlingById(a) ?? this.hatchlings[0];
            if (h) {
              this.callbacks.onHatch(h, x, y, z);
            }
          }
          break;
        }
        case EVT_LAY_EGG: {
          if (this.callbacks.onLayEgg) {
            const egg = this.findEggById(a);
            if (egg) {
              this.callbacks.onLayEgg(egg);
            }
          }
          break;
        }
        case EVT_SNAKE_HURT: {
          this.callbacks.onSnakeHurt?.(f0, x, y, z);
          break;
        }
        case EVT_VILLAGER_HIT: {
          if (this.callbacks.onVillagerHit) {
            const v = this.findVillagerById(a);
            if (v) {
              this.callbacks.onVillagerHit(v, evB !== 0, evC !== 0);
            }
          }
          break;
        }
        case EVT_HUNTER_TELEGRAPH: {
          if (this.callbacks.onHunterTelegraph) {
            const v = this.findVillagerById(a);
            if (v) {
              this.callbacks.onHunterTelegraph(v);
            }
          }
          break;
        }
        case EVT_CRASH: {
          const reason = DEATH_LIST[a];
          if (reason) {
            this.callbacks.onCrash?.(reason, x, z);
          }
          break;
        }
        case EVT_PHASE_CHANGE: {
          const next = PHASE_LIST[a] ?? 'title';
          this.callbacks.onPhaseChange?.(next);
          break;
        }
        case EVT_POWER_USED: {
          const sp = SPECIES_LIST[a] ?? this.species;
          this.callbacks.onPowerUsed?.(sp, evB, x, y, z, f0);
          break;
        }
        case EVT_TAIL_GRAB: {
          if (this.callbacks.onTailGrab) {
            const v = a >= 0 ? this.findVillagerById(a) ?? null : null;
            this.callbacks.onTailGrab(v, x, y, z);
          }
          break;
        }
        case EVT_TAIL_DEVOUR: {
          this.callbacks.onTailDevour?.(a, evB !== 0, x, y, z, f0);
          break;
        }
        case EVT_VENOM_HIT: {
          if (this.callbacks.onVenomHit) {
            const v = this.findVillagerById(a);
            if (v) {
              this.callbacks.onVenomHit(v, x, y, z);
            }
          }
          break;
        }
        case EVT_BLOOD_DRINK: {
          if (this.callbacks.onBloodDrink) {
            const v = this.findVillagerById(a) ?? null;
            this.callbacks.onBloodDrink(v, x, y, z, f0, f1);
          }
          break;
        }
        case EVT_SECONDARY_POWER: {
          this.callbacks.onSecondaryPower?.(a, evB, x, y, z, f0);
          break;
        }
        case EVT_RIVAL_CLASH: {
          this.callbacks.onRivalClash?.(x, y, z);
          break;
        }
      }
    }

    exp.wasm_clear_events();
  }

  public setBestScore(best: number): void {
    snakeCoreWasm.scalarsF32[SCALAR_F32.bestScore] = Math.max(0, Math.floor(best));
  }

  public getVillageThreatLevel(): number {
    const h = this.raidHeat;
    if (h < 3.0) return 1;
    if (h < 7.0) return 2;
    if (h < 13.0) return 3;
    if (h < 20.0) return 4;
    return 5 + Math.floor((h - 20.0) / 8.0);
  }

  public resetWorld(isTitleDemo = false): void {
    snakeCoreWasm.getExports().wasm_reset_world(isTitleDemo ? 1 : 0);
    this.cachedObstaclesVersion = -1;
    this.smartAi.reset();
    this.syncPools();
    this.drainEvents();
  }

  public startGame(): void {
    snakeCoreWasm.getExports().wasm_start_game();
    this.cachedObstaclesVersion = -1;
    this.smartAi.reset();
    this.syncPools();
    this.drainEvents();
  }

  public setPhase(next: GamePhase): void {
    const idx = PHASE_LIST.indexOf(next);
    snakeCoreWasm.getExports().wasm_set_phase(idx >= 0 ? idx : 0);
    this.drainEvents();
  }

  public togglePause(): void {
    snakeCoreWasm.getExports().wasm_toggle_pause();
    this.drainEvents();
  }

  public canLayEgg(): boolean {
    return snakeCoreWasm.getExports().wasm_can_lay_egg() !== 0;
  }

  public layEgg(): boolean {
    const ok = snakeCoreWasm.getExports().wasm_lay_egg() !== 0;
    if (ok) {
      this.syncPools();
      this.drainEvents();
    }
    return ok;
  }

  public triggerPrimaryPower(): boolean {
    const ok = snakeCoreWasm.getExports().wasm_trigger_primary_power() !== 0;
    if (ok) {
      this.syncPools();
      this.drainEvents();
    }
    return ok;
  }

  public triggerTailGrab(): boolean {
    const ok = snakeCoreWasm.getExports().wasm_trigger_tail_grab() !== 0;
    this.syncPools();
    this.drainEvents();
    return ok;
  }

  public triggerBiteAction(): boolean {
    const ok = snakeCoreWasm.getExports().wasm_trigger_bite_action() !== 0;
    this.syncPools();
    this.drainEvents();
    return ok;
  }

  public triggerSecondaryPower(): boolean {
    const ok = snakeCoreWasm.getExports().wasm_trigger_secondary_power() !== 0;
    this.syncPools();
    this.drainEvents();
    return ok;
  }

  public spawnVillager(
    role: VillagerRole,
    x: number,
    z: number,
    tier = 1,
    isElite = false,
    homeVillageId = -1,
  ): Villager | null {
    const rIdx = ROLE_LIST.indexOf(role);
    const vIdx = snakeCoreWasm.getExports().wasm_spawn_villager(
      rIdx >= 0 ? rIdx : 0,
      x,
      z,
      tier,
      isElite ? 1 : 0,
      homeVillageId,
    );
    this.syncPools();
    return vIdx >= 0 ? this.villagers[vIdx] ?? null : null;
  }

  public spawnHatchling(x: number, y: number, z: number): Hatchling {
    const hIdx = snakeCoreWasm.getExports().wasm_spawn_hatchling(x, y, z);
    this.syncPools();
    this.drainEvents();
    return this.hatchlings[hIdx] ?? this.hatchlings[0];
  }

  public spawnPrey(
    forcedKind?: PreyKind,
    forcedPos?: { x: number; z: number; y?: number },
  ): void {
    const hasKind = forcedKind !== undefined ? 1 : 0;
    const kIdx = forcedKind ? Math.max(0, PREY_KIND_LIST.indexOf(forcedKind)) : 0;
    const hasPos = forcedPos !== undefined ? 1 : 0;
    const hasY = forcedPos?.y !== undefined ? 1 : 0;
    snakeCoreWasm.getExports().wasm_spawn_prey(
      hasKind,
      kIdx,
      hasPos,
      forcedPos?.x ?? 0,
      forcedPos?.z ?? 0,
      hasY,
      forcedPos?.y ?? 0,
    );
    this.syncPools();
  }

  public damageSnake(amount: number, sourceX: number, sourceY: number, sourceZ: number): void {
    snakeCoreWasm.getExports().wasm_damage_snake(amount, sourceX, sourceY, sourceZ);
    this.syncPools();
    this.drainEvents();
  }

  public stepTitleDemo(dt: number): void {
    snakeCoreWasm.getExports().wasm_step_title_demo(dt);
    this.syncPools();
    this.drainEvents();
  }

  private getCollisionContext(): OutdoorCollisionContext {
    if (!this.collisionCtx) {
      this.collisionCtx = {
        arenaRadius: ARENA_RADIUS,
        buildings: this.buildings,
        fenceWalls: this.fenceWalls,
        villages: VILLAGES,
        obstacles: this.obstacles,
        trees: this.trees,
        groundHeightAt,
      };
    }
    return this.collisionCtx;
  }

  private applyPostWasmSolidCollisions(
    dt: number,
    prevHeadY: number,
    input: InputState,
  ): void {
    const ctx = this.getCollisionContext();
    const prevX = this.headX;
    const prevZ = this.headZ;
    const headHit = resolveHeadAndSnoutTS(
      prevX,
      this.headY,
      prevZ,
      this.heading,
      HEAD_RADIUS,
      this.snakeScale,
      ctx,
    );

    if (headHit.collided) {
      const disp = Math.hypot(headHit.x - prevX, headHit.z - prevZ);
      this.headX = headHit.x;
      this.headZ = headHit.z;

      const wantsMove =
        this.speed > 0.1 ||
        input.up ||
        Math.abs(input.joyX ?? 0) > 0.14 ||
        Math.abs(input.joyY ?? 0) > 0.14;

      if (wantsMove && (headHit.normalX !== 0 || headHit.normalZ !== 0)) {
        const fx = Math.sin(this.heading);
        const fz = Math.cos(this.heading);
        const dot = fx * headHit.normalX + fz * headHit.normalZ;
        if (dot < 0) {
          const tx = fx - dot * headHit.normalX;
          const tz = fz - dot * headHit.normalZ;
          if (Math.hypot(tx, tz) > 0.06) {
            const slideHeading = Math.atan2(tx, tz);
            const hDiff = normalizeAngle(slideHeading - this.heading);
            this.heading = normalizeAngle(this.heading + hDiff * Math.min(1, 14 * dt));
          } else {
            const tangentHeading = Math.atan2(-headHit.normalZ, headHit.normalX);
            const hDiff = normalizeAngle(tangentHeading - this.heading);
            this.heading = normalizeAngle(this.heading + hDiff * Math.min(1, 10 * dt));
          }
        }
      }

      if (disp > 0.002) {
        this.headY = surfaceHeightAt(this.headX, this.headZ, prevHeadY);
        const exp = snakeCoreWasm.getExports();
        const spineHeadIdx = exp.wasm_get_player_spine_head_idx();
        if (spineHeadIdx >= 0 && spineHeadIdx < 2048) {
          const sp4 = spineHeadIdx * 4;
          snakeCoreWasm.playerSpineF32[sp4] = this.headX;
          snakeCoreWasm.playerSpineF32[sp4 + 1] = this.headY;
          snakeCoreWasm.playerSpineF32[sp4 + 2] = this.headZ;
        }
        exp.wasm_compute_segment_poses();
        exp.wasm_get_building_at_position(this.headX, this.headZ, this.headY);
        const sc = snakeCoreWasm.scratchView;
        const bIdx = Math.round(sc[0]);
        snakeCoreWasm.scalarsI32[SCALAR_I32.locBuildingIdx] = bIdx;
        snakeCoreWasm.scalarsI32[SCALAR_I32.activeBuildingId] =
          bIdx >= 0 && bIdx < this.buildings.length ? this.buildings[bIdx].id : 0;
        snakeCoreWasm.scalarsI32[SCALAR_I32.locZoneType] = Math.round(sc[2]);
        snakeCoreWasm.scalarsI32[SCALAR_I32.locZoneIdx] = Math.round(sc[3]);
        snakeCoreWasm.scalarsI32[SCALAR_I32.isIndoors] = sc[4] > 0.5 ? 1 : 0;
        snakeCoreWasm.scalarsI32[SCALAR_I32.hideActiveRoof] = sc[5] > 0.5 ? 1 : 0;
      }
    }

    enforceFullBodySolidClearance(
      this.snakeScale,
      this.segmentCount,
      snakeCoreWasm.playerPosesF32,
      ctx,
    );
  }

  public step(dt: number, input: InputState): void {
    const wasPlaying = this.phase === 'playing';
    const prevHeadY = this.headY;
    if (wasPlaying) {
      this.smartAi.preStep(
        dt,
        this.headX,
        this.headY,
        this.headZ,
        this.heading,
        this.isBoosting,
        this.stealthTimer,
        this.buildings,
        this.villagers,
        this.preyItems,
        this.hatchlings,
        this.obstacles,
        this.trees,
      );
    }
    const moveThrottle = input.moveThrottle ?? (input.up ? 1 : 0);
    const joyX = input.joyX ?? 0;
    const joyY = input.joyY ?? 0;
    snakeCoreWasm.getExports().wasm_step_game(
      dt,
      input.left ? 1 : 0,
      input.right ? 1 : 0,
      input.up ? 1 : 0,
      input.down ? 1 : 0,
      input.boost ? 1 : 0,
      input.steerAxis,
      moveThrottle,
      joyX,
      joyY,
    );
    this.syncPools();
    if (wasPlaying && this.phase === 'playing') {
      this.applyPostWasmSolidCollisions(dt, prevHeadY, input);
      this.smartAi.postStep(
        dt,
        this.headX,
        this.headY,
        this.headZ,
        this.heading,
        this.isBoosting,
        this.stealthTimer,
        this.buildings,
        this.villagers,
        this.hatchlings,
        this.obstacles,
        this.trees,
      );
    }
    this.drainEvents();
  }

  public computeSegmentPoses(): void {
    snakeCoreWasm.getExports().wasm_compute_segment_poses();
    this.syncPools();
    if (this.phase === 'playing') {
      enforceFullBodySolidClearance(
        this.snakeScale,
        this.segmentCount,
        snakeCoreWasm.playerPosesF32,
        this.getCollisionContext(),
      );
    }
  }

  public getHudSnapshot(): HudSnapshot {
    const obsVer = snakeCoreWasm.scalarsI32[SCALAR_I32.obstaclesVersion];
    if (obsVer !== this.cachedObstaclesVersion) {
      this.cachedObstaclesVersion = obsVer;
      this.cachedRadarObstacles = this.obstacles.map((o) => ({
        x: o.x,
        z: o.z,
        radius: o.radius,
        kind: o.kind,
      }));
    }

    this.radarPreyOut.length = 0;
    for (let i = 0; i < this.preyItems.length; i++) {
      const p = this.preyItems[i];
      let slot = this.radarPreyPool[i];
      if (!slot) {
        slot = { x: p.x, z: p.z, kind: p.kind };
        this.radarPreyPool[i] = slot;
      } else {
        slot.x = p.x;
        slot.z = p.z;
        slot.kind = p.kind;
      }
      this.radarPreyOut.push(slot);
    }

    this.radarVillagerOut.length = 0;
    let vWrite = 0;
    for (let i = 0; i < this.villagers.length; i++) {
      const v = this.villagers[i];
      if (v.state === 'ko') continue;
      let slot = this.radarVillagerPool[vWrite];
      if (!slot) {
        slot = {
          x: v.x,
          z: v.z,
          role: v.role,
          state: v.state,
          homeVillageId: v.homeVillageId,
        };
        this.radarVillagerPool[vWrite] = slot;
      } else {
        slot.x = v.x;
        slot.z = v.z;
        slot.role = v.role;
        slot.state = v.state;
        slot.homeVillageId = v.homeVillageId;
      }
      this.radarVillagerOut.push(slot);
      vWrite++;
    }

    this.radarHatchOut.length = 0;
    for (let i = 0; i < this.hatchlings.length; i++) {
      const h = this.hatchlings[i];
      let slot = this.radarHatchPool[i];
      if (!slot) {
        slot = { x: h.x, z: h.z };
        this.radarHatchPool[i] = slot;
      } else {
        slot.x = h.x;
        slot.z = h.z;
      }
      this.radarHatchOut.push(slot);
    }

    this.radarEggOut.length = 0;
    for (let i = 0; i < this.laidEggs.length; i++) {
      const e = this.laidEggs[i];
      let slot = this.radarEggPool[i];
      if (!slot) {
        slot = { x: e.x, z: e.z };
        this.radarEggPool[i] = slot;
      } else {
        slot.x = e.x;
        slot.z = e.z;
      }
      this.radarEggOut.push(slot);
    }

    this.radarTrailOut.length = 0;
    let tWrite = 0;
    for (let i = 0; i < this.segmentPoses.length; i += 3) {
      const seg = this.segmentPoses[i];
      let slot = this.radarTrailPool[tWrite];
      if (!slot) {
        slot = { x: seg.x, z: seg.z };
        this.radarTrailPool[tWrite] = slot;
      } else {
        slot.x = seg.x;
        slot.z = seg.z;
      }
      this.radarTrailOut.push(slot);
      tWrite++;
    }

    return {
      phase: this.phase,
      score: Math.round(this.score),
      bestScore: Math.round(this.bestScore),
      length: this.segmentCount,
      hp: Math.round(this.hp),
      maxHp: this.maxHp,
      hatchlingCount: this.hatchlings.length,
      laidEggCount: this.laidEggs.length,
      canLayEgg: this.canLayEgg(),
      eggCooldown: Math.round(this.eggCooldown * 10) / 10,
      hunterAlert: this.hunterAlert,
      threatLevel: this.threatLevel,
      kills: this.kills,
      combo: this.combo,
      comboTimer: this.comboTimer,
      elapsedSeconds: Math.floor(this.elapsedSeconds),
      speedKmh: Math.round(this.speed * 3.6),
      stamina: Math.round(this.stamina),
      cameraMode: this.cameraMode,
      species: this.species,
      muted: this.muted,
      deathReason: this.deathReason,
      nearPrey: this.nearPrey,
      locationLabel: this.locationLabel,
      elevationY: Math.round(this.headY * 10) / 10,
      isIndoors: this.isIndoors,
      powerInfo: getSpeciesPowerInfo(this.species),
      powerCooldown: Math.round(Math.max(0, this.powerCooldown) * 10) / 10,
      powerMaxCooldown: Math.max(0.1, this.powerMaxCooldown),
      tailGrabCooldown: Math.round(Math.max(0, this.tailGrabCooldown) * 10) / 10,
      tailGrabMaxCooldown: Math.max(0.1, this.tailGrabMaxCooldown),
      isStealthActive: this.stealthTimer > 0.05,
      isGrabbing: this.grabStage === 1,
      snakeScale: Math.round(this.snakeScale * 100) / 100,
      canSwallow: this.canSwallow,
      feastCount: this.feastCount,
      powerTier: this.powerTier,
      secondaryCooldown: Math.round(Math.max(0, this.secondaryCooldown) * 10) / 10,
      secondaryMaxCooldown: Math.max(0.1, this.secondaryMaxCooldown),
      rivalClashActive: this.rivalClashActive,
      activeVillageId: this.activeVillageId,
      radar: {
        arenaRadius: ARENA_RADIUS,
        headX: this.headX,
        headZ: this.headZ,
        heading: this.heading,
        playerTrail: this.radarTrailOut,
        villageBounds: {
          minX: VILLAGE_BOUNDS.minX,
          maxX: VILLAGE_BOUNDS.maxX,
          minZ: VILLAGE_BOUNDS.minZ,
          maxZ: VILLAGE_BOUNDS.maxZ,
        },
        villages: VILLAGES,
        regions: WORLD_REGIONS,
        ponds: WATER_PONDS,
        prey: this.radarPreyOut,
        villagers: this.radarVillagerOut,
        hatchlings: this.radarHatchOut,
        laidEggs: this.radarEggOut,
        obstacles: this.cachedRadarObstacles,
        buildings: this.cachedRadarBuildings,
      },
    };
  }
}
