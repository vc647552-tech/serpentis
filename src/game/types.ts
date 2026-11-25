export type GamePhase = 'title' | 'playing' | 'paused' | 'gameover';

export type CameraMode = 'chase' | 'canopy';

export type SnakeSpecies =
  | 'emerald'
  | 'golden'
  | 'obsidian'
  | 'rattler'
  | 'coral'
  | 'albino';

export type GraphicsQuality = 'high' | 'balanced' | 'performance';

export type DifficultyLevel = 'relaxed' | 'realistic' | 'apex';

export type PreyKind =
  | 'egg'
  | 'berry'
  | 'frog'
  | 'mouse'
  | 'rabbit'
  | 'deer'
  | 'boar'
  | 'elephant';

export type ObstacleKind = 'boulder' | 'log';

export type BuildingKind = 'cabin' | 'manor' | 'ruin_tower';

export type VillagerRole = 'flee' | 'hide' | 'spearman' | 'crossbow';

export type ProjectileKind = 'bolt' | 'venom' | 'mist';

export interface SpeciesPowerInfo {
  name: string;
  shortName: string;
  description: string;
  accentHex: string;
  cooldownSec: number;
}

export type VillagerState =
  | 'patrol'
  | 'fleeing'
  | 'seeking_shelter'
  | 'hiding'
  | 'pursue'
  | 'windup'
  | 'attack'
  | 'recover'
  | 'ko';

export interface WallBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
}

export interface FloorZone {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  elevation: number;
  label: string;
  isInterior: boolean;
  isRoof?: boolean;
}

export interface RampZone {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  axis: 'x' | 'z';
  startCoord: number;
  endCoord: number;
  startY: number;
  endY: number;
  label: string;
  isInterior: boolean;
}

export interface EnterableBuilding {
  id: number;
  kind: BuildingKind;
  name: string;
  x: number;
  z: number;
  rotation: number;
  scale: number;
  footprintRadius: number;
  floors: FloorZone[];
  ramps: RampZone[];
  walls: WallBox[];
  interiorSpot: { x: number; z: number; y: number };
  upperSpot: { x: number; z: number; y: number };
}

export interface GameSettings {
  species: SnakeSpecies;
  cameraMode: CameraMode;
  graphicsQuality: GraphicsQuality;
  difficulty: DifficultyLevel;
  fov: number; // 45..70
  turnSensitivity: number; // 0.6..1.5
  volume: number; // 0..1
  muted: boolean;
  showRadar: boolean;
}

export interface SpinePoint {
  x: number;
  y: number;
  z: number;
  dist: number;
}

export interface SegmentPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  radius: number;
}

export interface PreyItem {
  id: number;
  kind: PreyKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  heading: number;
  radius: number;
  points: number;
  growth: number;
  staminaGain: number;
  phase: number;
  gaitPhase: number;
  idleTimer: number;
  fleeing: boolean;
}

export interface VillageDef {
  id: number;
  name: string;
  centerX: number;
  centerZ: number;
  halfW: number;
  halfD: number;
  southGateHalfW: number;
  sideGateHalfW: number;
  factionColorHex: number;
}

export interface Villager {
  id: number;
  role: VillagerRole;
  state: VillagerState;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  heading: number;
  radius: number;
  hp: number;
  maxHp: number;
  speed: number;
  gaitPhase: number;
  phase: number;
  homeX: number;
  homeZ: number;
  targetBuildingId: number | null;
  stateTimer: number;
  attackCooldown: number;
  hitFlash: number;
  koTimer: number;
  shirtColor: number;
  trouserColor: number;
  hairColor: number;
  skinTone: number;
  hasBeard: boolean;
  isElite?: boolean;
  tier?: number;
  poisonTimer?: number;
  stunTimer?: number;
  grabbed?: boolean;
  homeVillageId?: number;
  targetVillagerId?: number | null;
}

export interface LaidEgg {
  id: number;
  x: number;
  y: number;
  z: number;
  age: number;
  hatchTime: number;
  species: SnakeSpecies;
}

export interface Hatchling {
  id: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  growth: number;
  stage: 1 | 2 | 3;
  biteCooldown: number;
  targetVillagerId: number | null;
  targetPreyId: number | null;
  spine: SpinePoint[];
  totalDist: number;
  segmentPoses: SegmentPose[];
}

export interface Projectile {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  life: number;
  damage: number;
  kind: ProjectileKind;
  radius: number;
  ownerVillageId?: number;
}

export interface HazardObstacle {
  id: number;
  kind: ObstacleKind;
  x: number;
  z: number;
  radius: number;
  rotation: number;
  scale: number;
}

export interface TreeCollider {
  id: number;
  x: number;
  z: number;
  radius: number;
  scale: number;
  kind: 'oak' | 'pine';
}

export interface WorldRegion {
  id: string;
  name: string;
  x: number;
  z: number;
  radius: number;
  kind: 'forest' | 'highlands' | 'basin' | 'glade' | 'quarry' | 'marsh' | 'steppe' | 'clearing';
  colorHex: string;
}

export interface WaterPond {
  id: string;
  name: string;
  x: number;
  z: number;
  rx: number;
  rz: number;
}

export interface RadarData {
  arenaRadius: number;
  headX: number;
  headZ: number;
  heading: number;
  playerTrail: Array<{ x: number; z: number }>;
  villageBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  villages: readonly VillageDef[];
  regions: readonly WorldRegion[];
  ponds: readonly WaterPond[];
  prey: Array<{ x: number; z: number; kind: PreyKind }>;
  villagers: Array<{ x: number; z: number; role: VillagerRole; state: VillagerState; homeVillageId?: number }>;
  hatchlings: Array<{ x: number; z: number }>;
  laidEggs: Array<{ x: number; z: number }>;
  obstacles: Array<{ x: number; z: number; radius: number; kind: ObstacleKind }>;
  buildings: Array<{ name: string; x: number; z: number; rotation: number; kind: BuildingKind; scale: number }>;
}

export interface HudSnapshot {
  phase: GamePhase;
  score: number;
  bestScore: number;
  length: number;
  hp: number;
  maxHp: number;
  hatchlingCount: number;
  laidEggCount: number;
  canLayEgg: boolean;
  eggCooldown: number;
  hunterAlert: boolean;
  threatLevel: number;
  kills: number;
  combo: number;
  comboTimer: number;
  elapsedSeconds: number;
  speedKmh: number;
  stamina: number;
  cameraMode: CameraMode;
  species: SnakeSpecies;
  muted: boolean;
  deathReason: 'boundary' | 'obstacle' | 'self' | 'hunter' | null;
  nearPrey: boolean;
  locationLabel: string;
  elevationY: number;
  isIndoors: boolean;
  powerInfo: SpeciesPowerInfo;
  powerCooldown: number;
  powerMaxCooldown: number;
  tailGrabCooldown: number;
  tailGrabMaxCooldown: number;
  isStealthActive: boolean;
  isGrabbing: boolean;
  snakeScale: number;
  canSwallow: boolean;
  feastCount: number;
  powerTier: number;
  secondaryCooldown: number;
  secondaryMaxCooldown: number;
  rivalClashActive: boolean;
  activeVillageId: number;
  radar: RadarData;
}

export interface InputState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  boost: boolean;
  steerAxis: number;
  moveThrottle?: number;
  joyX?: number;
  joyY?: number;
}

export interface EngineCallbacks {
  onEat?: (prey: PreyItem, newCombo: number, comboPoints: number) => void;
  onHatch?: (hatchling: Hatchling, x: number, y: number, z: number) => void;
  onLayEgg?: (egg: LaidEgg) => void;
  onSnakeHurt?: (damage: number, x: number, y: number, z: number) => void;
  onVillagerHit?: (villager: Villager, killed: boolean, byHatchling: boolean) => void;
  onHunterTelegraph?: (villager: Villager) => void;
  onPowerUsed?: (
    species: SnakeSpecies,
    hits: number,
    x: number,
    y: number,
    z: number,
    radius: number,
  ) => void;
  onTailGrab?: (villager: Villager | null, x: number, y: number, z: number) => void;
  onTailDevour?: (
    villagerId: number,
    isHunter: boolean,
    x: number,
    y: number,
    z: number,
    bonusScore: number,
  ) => void;
  onVenomHit?: (villager: Villager, x: number, y: number, z: number) => void;
  onBloodDrink?: (
    villager: Villager | null,
    x: number,
    y: number,
    z: number,
    damage: number,
    snakeScale: number,
  ) => void;
  onSecondaryPower?: (
    powerTier: number,
    hits: number,
    x: number,
    y: number,
    z: number,
    radius: number,
  ) => void;
  onRivalClash?: (x: number, y: number, z: number) => void;
  onCrash?: (reason: 'boundary' | 'obstacle' | 'self' | 'hunter', x: number, z: number) => void;
  onPhaseChange?: (phase: GamePhase) => void;
}
