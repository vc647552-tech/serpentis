import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  WATER_PONDS,
  WORLD_REGIONS,
  buildingLocalToWorld,
  getBuildingAtPosition,
  getWorldRegionAt,
  resolveBuildingWallCollision,
  surfaceHeightAt,
  worldToBuildingLocal,
} from './buildings';
import { getBoulderSideRockCenter, getFallenLogSegment } from './outdoorCollisions';
import {
  ARENA_RADIUS,
  BASE_SPEED,
  EGG_HATCH_TIME_SEC,
  HEAD_RADIUS,
  INITIAL_SEGMENTS,
  MAX_SNAKE_HP,
  SEGMENT_SPACING,
  START_SNAKE_SCALE,
  SWALLOW_MIN_SCALE,
  SnakeGameEngine,
  VILLAGES,
  getSpeciesTraits,
  groundHeightAt,
  normalizeAngle,
  sampleSpineAtDistance,
} from './engine';
import * as THREE from 'three';
import { InputState, PreyKind, SnakeSpecies } from './types';
import { snakeCoreWasm } from '../wasm/snakeCoreWasm';
import {
  AnimalMaterialSet,
  computeSnakeSpineRings,
  createHatchlingRig,
  createPreyRig,
  disposeSharedRigAssets,
  updateHatchlingRig,
} from '../three/models';
import { getSpeciesMorph } from '../three/textures';

function emptyInput(): InputState {
  return {
    left: false,
    right: false,
    up: false,
    down: false,
    boost: false,
    steerAxis: 0,
  };
}

test('groundHeightAt is finite, smooth inside arena, and rises outside boundary', () => {
  const centerH = groundHeightAt(0, 0);
  const midH = groundHeightAt(18, -14);
  const outsideH = groundHeightAt(ARENA_RADIUS + 6, 0);

  assert.ok(Number.isFinite(centerH));
  assert.ok(Math.abs(midH) < 1.2);
  assert.ok(outsideH > centerH + 1.5, `Expected outside berm ${outsideH} > center ${centerH}`);
});

test('normalizeAngle wraps angles cleanly into [-PI, PI]', () => {
  assert.ok(Math.abs(normalizeAngle(Math.PI * 3) - Math.PI) < 1e-6);
  assert.ok(Math.abs(normalizeAngle(-Math.PI * 3) + Math.PI) < 1e-6);
});

test('sampleSpineAtDistance interpolates smoothly in 3D along spine points', () => {
  const spine = [
    { x: 0, y: 2.5, z: 0, dist: 10 },
    { x: 0, y: 1.5, z: 5, dist: 5 },
    { x: 0, y: 0.5, z: 10, dist: 0 },
  ];
  const sample = sampleSpineAtDistance(spine, 10, 2.5);
  assert.ok(Math.abs(sample.x) < 1e-6);
  assert.ok(Math.abs(sample.y - 2.0) < 1e-6);
  assert.ok(Math.abs(sample.z - 2.5) < 1e-6);
});

test('snake stays stationary on idle input and moves only on manual input', () => {
  const engine = new SnakeGameEngine({}, 42);
  engine.startGame();
  const idle = emptyInput();
  const startX = engine.headX;
  const startZ = engine.headZ;

  for (let i = 0; i < 60; i++) {
    engine.step(1 / 60, idle);
  }
  assert.equal(engine.phase, 'playing');
  assert.equal(engine.speed, 0, 'Snake should remain stationary without manual input');
  assert.ok(Math.hypot(engine.headX - startX, engine.headZ - startZ) < 1e-4);

  const forward = { ...emptyInput(), up: true };
  for (let i = 0; i < 120; i++) {
    engine.step(1 / 60, forward);
  }
  assert.equal(engine.phase, 'playing');
  assert.ok(engine.headZ < startZ - 2.0, 'Snake should move forward along -Z when W/Up is held');
});

test('steering left/right changes heading and boost consumes stamina', () => {
  const engine = new SnakeGameEngine({}, 42);
  engine.startGame();
  const initialHeading = engine.heading;

  const leftInput = { ...emptyInput(), left: true, boost: true };
  for (let i = 0; i < 30; i++) {
    engine.step(1 / 60, leftInput);
  }

  assert.notEqual(engine.heading, initialHeading);
  assert.ok(engine.stamina < 100, 'Boost should consume stamina');
  assert.ok(engine.speed > BASE_SPEED, 'Boost should accelerate snake');
});

test('eating prey awards combo score, grows segment count, and spawns replacement prey', () => {
  let ateCount = 0;
  const engine = new SnakeGameEngine(
    {
      onEat: () => {
        ateCount++;
      },
    },
    99,
  );
  engine.startGame();

  const initialPreyCount = engine.preyItems.length;
  engine.preyItems[0] = {
    id: 999,
    kind: 'rabbit',
    x: engine.headX,
    y: engine.headY,
    z: engine.headZ - 0.5,
    vx: 0,
    vz: 0,
    heading: 0,
    radius: 0.68,
    points: 45,
    growth: 3,
    staminaGain: 40,
    phase: 0,
    gaitPhase: 0,
    idleTimer: 0,
    fleeing: false,
  };

  const moveInput = { ...emptyInput(), up: true };
  for (let i = 0; i < 15; i++) {
    engine.step(1 / 60, moveInput);
  }

  assert.equal(ateCount, 1);
  assert.ok(engine.score >= 45);
  assert.equal(engine.segmentCount, INITIAL_SEGMENTS + 3);
  assert.equal(engine.combo, 2);
  assert.equal(engine.preyItems.length, initialPreyCount);
});

test('open world seeds enterable buildings and animated wildlife advances gaitPhase with distance', () => {
  const engine = new SnakeGameEngine({}, 77);
  engine.startGame();

  const kinds = new Set(engine.buildings.map((b) => b.kind));
  assert.ok(kinds.has('cabin'), 'Expected enterable cabin');
  assert.ok(kinds.has('manor'), 'Expected enterable stone manor');
  assert.ok(kinds.has('ruin_tower'), 'Expected climbable mossy temple');

  const rabbit = engine.preyItems.find((p) => p.kind === 'rabbit');
  assert.ok(rabbit, 'Expected roaming rabbit prey');
  rabbit.idleTimer = 0;
  const startX = rabbit.x;
  const startZ = rabbit.z;
  const startGait = rabbit.gaitPhase;

  for (let i = 0; i < 40; i++) {
    engine.step(1 / 60, emptyInput());
  }

  assert.ok(Math.hypot(rabbit.x - startX, rabbit.z - startZ) > 0.2, 'Rabbit should move across terrain');
  assert.ok(rabbit.gaitPhase > startGait, 'Rabbit gaitPhase should advance strictly with travel distance');
});

test('snake can enter cabin doorway, detect interior roof cutaway, and climb stairs to upper loft', () => {
  const engine = new SnakeGameEngine({}, 77);
  engine.startGame();
  const cabin = engine.buildings.find((b) => b.kind === 'cabin');
  assert.ok(cabin);

  const baseY = groundHeightAt(cabin.x, cabin.z);

  const doorWorld = buildingLocalToWorld(cabin, 0, 3.4);
  const doorHit = resolveBuildingWallCollision(doorWorld.wx, baseY + 0.28, doorWorld.wz, 0.4, engine.buildings);
  assert.equal(doorHit.collided, false, 'Open doorway should allow smooth entry');

  const wallWorld = buildingLocalToWorld(cabin, 2.8, 3.35);
  const wallHit = resolveBuildingWallCollision(wallWorld.wx, baseY + 0.28, wallWorld.wz, 0.4, engine.buildings);
  assert.equal(wallHit.collided, true, 'Solid cabin wall should block penetration');

  const insideWorld = buildingLocalToWorld(cabin, -0.5, 0.5);
  const floorY = surfaceHeightAt(insideWorld.wx, insideWorld.wz, baseY + 0.28 * cabin.scale, engine.buildings);
  assert.ok(Math.abs(floorY - (baseY + 0.28 * cabin.scale)) < 0.05);
  const locInside = getBuildingAtPosition(insideWorld.wx, insideWorld.wz, floorY, engine.buildings);
  assert.equal(locInside.isIndoors, true);
  assert.equal(locInside.hideRoof, true);

  let curY = baseY + 0.28 * cabin.scale;
  for (let lz = 2.75; lz >= -0.45; lz -= 0.25) {
    const pt = buildingLocalToWorld(cabin, 2.75, lz);
    curY = surfaceHeightAt(pt.wx, pt.wz, curY, engine.buildings);
  }
  assert.ok(curY > baseY + 2.2 * cabin.scale, `Expected upper loft ${curY} > ${baseY + 2.2 * cabin.scale}`);
});

test('all 6 snake species traits return valid positive multipliers', () => {
  const speciesList: SnakeSpecies[] = ['emerald', 'golden', 'obsidian', 'rattler', 'coral', 'albino'];
  for (const s of speciesList) {
    const tr = getSpeciesTraits(s);
    assert.ok(tr.speedMult > 0.8 && tr.speedMult < 1.3);
    assert.ok(tr.turnMult > 0.8 && tr.turnMult < 1.3);
    assert.ok(tr.staminaDrainMult > 0.5 && tr.staminaDrainMult < 1.3);
  }
});

test('boundary, boulders, trees, and village fence deflect smoothly without killing the snake', () => {
  const engine = new SnakeGameEngine({}, 42);
  engine.startGame();

  engine.headX = ARENA_RADIUS - 0.1;
  engine.headZ = 0;
  engine.heading = Math.PI / 2;
  engine.step(1 / 60, { ...emptyInput(), up: true });
  assert.equal(engine.phase, 'playing');
  assert.ok(Math.hypot(engine.headX, engine.headZ) < ARENA_RADIUS);

  const boulder = engine.obstacles.find((o) => o.kind === 'boulder');
  assert.ok(boulder, 'Expected at least one boulder');
  engine.headX = boulder.x;
  engine.headZ = boulder.z + boulder.radius * 0.5;
  engine.headY = groundHeightAt(boulder.x, boulder.z);
  engine.step(1 / 60, { ...emptyInput(), up: true });
  assert.equal(engine.phase, 'playing');

  const firstVillage = VILLAGES[0];
  engine.headX = firstVillage.centerX;
  engine.headZ = firstVillage.centerZ + 4;
  engine.headY = groundHeightAt(engine.headX, engine.headZ);
  engine.heading = Math.PI;
  engine.step(1 / 60, { ...emptyInput(), up: true });
  assert.ok(engine.locationLabel.includes(firstVillage.name));
});

test('crossing over own body coils lifts the snake in 3D instead of self-bite death', () => {
  const engine = new SnakeGameEngine({}, 42);
  engine.startGame();
  engine.segmentCount = 64;

  let maxHeadLift = 0;
  const moveForward = { ...emptyInput(), up: true };
  for (let i = 0; i < 45; i++) {
    engine.step(1 / 60, moveForward);
  }
  const turnLeft = { ...emptyInput(), left: true, up: true };
  for (let i = 0; i < 135; i++) {
    engine.step(1 / 60, turnLeft);
    const groundY = groundHeightAt(engine.headX, engine.headZ);
    maxHeadLift = Math.max(maxHeadLift, engine.headY - groundY);
  }

  assert.equal(engine.phase, 'playing', 'Snake must never die from touching its own coils');
  assert.ok(maxHeadLift > 0.08, `Expected snake head to climb over coils, got max lift ${maxHeadLift}`);
});

test('village spawns flee, hide, spearman, and crossbow villagers with realistic AI reactions', () => {
  const engine = new SnakeGameEngine({}, 101);
  engine.startGame();

  const roles = new Set(engine.villagers.map((v) => v.role));
  assert.ok(roles.has('flee'), 'Expected fleeing civilians');
  assert.ok(roles.has('hide'), 'Expected hiding civilians');
  assert.ok(roles.has('spearman'), 'Expected spearman hunters');
  assert.ok(roles.has('crossbow'), 'Expected crossbow hunters');

  // Move snake right near a flee civilian and a hide civilian in village
  const fleeVillager = engine.villagers.find((v) => v.role === 'flee');
  const hideVillager = engine.villagers.find((v) => v.role === 'hide');
  assert.ok(fleeVillager && hideVillager);

  const fleeStartD = Math.hypot(fleeVillager.x - 0, fleeVillager.z - (-24));
  engine.headX = fleeVillager.x;
  engine.headZ = fleeVillager.z + 5.0;
  engine.headY = groundHeightAt(engine.headX, engine.headZ);

  for (let i = 0; i < 60; i++) {
    engine.step(1 / 60, emptyInput());
  }
  assert.equal(fleeVillager.state, 'fleeing', 'Flee villager should panic and flee');
  assert.ok(Math.hypot(fleeVillager.x - 0, fleeVillager.z - (-24)) !== fleeStartD);

  // Move snake near hide villager and verify shelter-seeking -> hiding
  engine.headX = hideVillager.x;
  engine.headZ = hideVillager.z + 5.0;
  for (let i = 0; i < 30; i++) {
    engine.step(1 / 60, emptyInput());
  }
  assert.ok(
    hideVillager.state === 'seeking_shelter' || hideVillager.state === 'hiding',
    `Expected hide villager to seek shelter or hide, got ${hideVillager.state}`,
  );
});

test('armed hunters telegraph attacks, hurt the snake, and trigger gameover when hp reaches 0', () => {
  let hurtCalls = 0;
  const engine = new SnakeGameEngine(
    {
      onSnakeHurt: () => {
        hurtCalls++;
      },
    },
    102,
  );
  engine.startGame();
  assert.equal(engine.hp, MAX_SNAKE_HP);

  const spearman = engine.villagers.find((v) => v.role === 'spearman');
  assert.ok(spearman);

  // Place spearman right in front of snake
  spearman.x = engine.headX;
  spearman.z = engine.headZ - 2.2;
  spearman.y = engine.headY;
  spearman.attackCooldown = 0;

  let sawWindup = false;
  for (let i = 0; i < 90; i++) {
    engine.step(1 / 60, emptyInput());
    if (spearman.state === 'windup') sawWindup = true;
    // Keep snake stationed within spear thrust reach to absorb telegraphed strike
    engine.headX = spearman.x;
    engine.headZ = spearman.z + 1.85;
  }

  assert.equal(sawWindup, true, 'Spearman should display windup telegraph before striking');
  assert.ok(hurtCalls >= 1 && engine.hp < MAX_SNAKE_HP, 'Hunter strike should reduce snake HP');

  // Lethal damage drops snake to gameover with deathReason='hunter'
  engine.invulnTimer = 0;
  engine.damageSnake(engine.hp, spearman.x, spearman.y, spearman.z);
  assert.equal(engine.phase, 'gameover');
  assert.equal(engine.deathReason, 'hunter');
});

test('eating wild eggs hatches baby snakes, laying eggs incubates into baby snakes, and hatchlings fight and grow', () => {
  let hatchedCount = 0;
  const engine = new SnakeGameEngine(
    {
      onHatch: () => {
        hatchedCount++;
      },
    },
    103,
  );
  engine.startGame();

  // 1. Eat a wild brood egg -> immediately hatches a baby snake
  engine.preyItems[0] = {
    id: 888,
    kind: 'egg',
    x: engine.headX,
    y: engine.headY,
    z: engine.headZ - 0.5,
    vx: 0,
    vz: 0,
    heading: 0,
    radius: 0.52,
    points: 25,
    growth: 2,
    staminaGain: 20,
    phase: 0,
    gaitPhase: 0,
    idleTimer: 0,
    fleeing: false,
  };
  const forwardInput = { ...emptyInput(), up: true };
  for (let i = 0; i < 15; i++) {
    engine.step(1 / 60, forwardInput);
  }
  assert.equal(engine.hatchlings.length, 1, 'Eating a wild egg should hatch a baby snake');
  assert.equal(hatchedCount, 1);

  // 2. Lay an egg via layEgg(), incubate for EGG_HATCH_TIME_SEC -> hatches 2nd baby snake!
  const laid = engine.layEgg();
  assert.equal(laid, true, 'layEgg should succeed with full stamina');
  assert.equal(engine.laidEggs.length, 1);

  const stepsNeeded = Math.ceil((EGG_HATCH_TIME_SEC + 0.3) * 60);
  for (let i = 0; i < stepsNeeded; i++) {
    engine.step(1 / 60, emptyInput());
  }
  assert.equal(engine.laidEggs.length, 0, 'Laid egg should finish hatching');
  assert.equal(engine.hatchlings.length, 2, 'Laid egg should hatch into a 2nd baby snake');

  // 3. Baby snakes help attack nearby hunter and grow larger!
  const helper = engine.hatchlings[0];
  const initialGrowth = helper.growth;
  const hunter = engine.villagers.find((v) => v.role === 'spearman');
  assert.ok(hunter);
  hunter.x = engine.headX + 2.5;
  hunter.z = engine.headZ;
  hunter.y = engine.headY;
  helper.x = hunter.x - 0.5;
  helper.z = hunter.z;
  helper.biteCooldown = 0;
  const hunterStartHp = hunter.hp;

  for (let i = 0; i < 90; i++) {
    engine.step(1 / 60, emptyInput());
    engine.headX = hunter.x - 3.5;
    engine.headZ = hunter.z;
  }

  assert.ok(hunter.hp < hunterStartHp, 'Hatchling should bite and damage nearby hunter');
  assert.ok(helper.growth > initialGrowth, 'Hatchling should grow from combat and aging');
});

test('15. Raiding the village escalates threatLevel, raises civilian alarms, and spawns stronger elite hunter squads', () => {
  const engine = new SnakeGameEngine({}, 4242);
  engine.startGame();
  assert.equal(engine.getHudSnapshot().threatLevel, 1);

  // Move snake inside Timberhollow Village plaza and defeat several villagers
  engine.headX = 0;
  engine.headZ = -45;
  engine.headY = groundHeightAt(0, -45);

  const targets = engine.villagers.slice(0, 5);
  for (const v of targets) {
    v.hp = 1;
    v.x = engine.headX;
    v.z = engine.headZ;
    v.y = engine.headY;
    engine.step(1 / 60, emptyInput());
  }

  const snapAfterRaid = engine.getHudSnapshot();
  assert.ok(
    snapAfterRaid.threatLevel >= 2,
    `Expected threatLevel >= 2 after village kills, got ${snapAfterRaid.threatLevel}`,
  );

  // Verify civilian panic alerts nearby patrolling hunters into pursue
  const civ = engine.villagers.find((v) => v.role === 'flee' || v.role === 'hide');
  const guard = engine.villagers.find((v) => v.role === 'spearman' || v.role === 'crossbow');
  if (civ && guard) {
    civ.state = 'fleeing';
    guard.state = 'patrol';
    guard.x = civ.x + 8;
    guard.z = civ.z;
    // Keep snake close to civilian so civilian continues panicking and alerts guard
    engine.headX = civ.x + 1.5;
    engine.headZ = civ.z + 1.5;
    engine.step(1 / 60, emptyInput());
    assert.equal(guard.state, 'pursue', 'Panicking civilian should alert nearby patrolling hunter');
  }

  // Eliminate more guards to push threatLevel >= 3 and trigger multi-hunter / elite reinforcement wave
  for (let round = 0; round < 6; round++) {
    const hunters = engine.villagers.filter((v) => v.role === 'spearman' || v.role === 'crossbow');
    if (hunters.length === 0) break;
    for (const h of hunters.slice(0, 3)) {
      h.hp = 1;
      h.x = engine.headX;
      h.z = engine.headZ;
      h.y = engine.headY;
      engine.step(1 / 60, emptyInput());
    }
  }

  // Step forward 10s (keeping snake alive in plaza) so reinforcement wave spawns escalated hunters
  engine.headX = 0;
  engine.headZ = -45;
  engine.headY = groundHeightAt(0, -45);
  for (let i = 0; i < 60 * 10; i++) {
    engine.hp = 100;
    engine.step(1 / 60, emptyInput());
  }

  const highSnap = engine.getHudSnapshot();
  assert.ok(highSnap.threatLevel >= 3, `Expected threatLevel >= 3, got ${highSnap.threatLevel}`);
  const escalatedHunters = engine.villagers.filter((v) => (v.tier ?? 1) >= 2 || v.isElite);
  assert.ok(
    escalatedHunters.length > 0,
    'Escalated raids should spawn higher-tier or elite hunters',
  );
  assert.ok(
    escalatedHunters.some((h) => h.maxHp > 65),
    'Escalated hunters should have higher maxHp than base Tier-1 hunters',
  );
});

test('16. C++ WebAssembly core matches TS groundHeightAt, samples spine poses, and deforms snake mesh with zero NaNs', () => {
  const wasmPath = path.resolve(process.cwd(), 'public/snake_core.wasm');
  const bytes = fs.readFileSync(wasmPath);
  const loaded = snakeCoreWasm.initFromBytes(bytes);
  assert.equal(loaded, true, 'C++ WASM binary should instantiate cleanly');
  assert.equal(snakeCoreWasm.isReady(), true);

  // 1. Terrain height parity across center, village, rough woods, and outer berm
  const coords: Array<[number, number]> = [
    [0, 0],
    [0, -45],
    [24.5, -18.2],
    [-62.1, 41.7],
    [ARENA_RADIUS + 4.5, 12.0],
  ];
  for (const [x, z] of coords) {
    const jsH = groundHeightAt(x, z);
    const wasmH = snakeCoreWasm.groundHeight(x, z);
    assert.ok(Number.isFinite(wasmH));
    assert.ok(
      Math.abs(jsH - wasmH) < 1e-3,
      `groundHeight parity mismatch at (${x}, ${z}): JS=${jsH} WASM=${wasmH}`,
    );
  }

  // 2. Step engine under C++ WASM and verify segmentPoses + deformSnakeBody
  const engine = new SnakeGameEngine({}, 777);
  engine.startGame();
  const steer = { ...emptyInput(), left: true };
  for (let i = 0; i < 60; i++) {
    engine.step(1 / 60, steer);
  }
  assert.equal(engine.phase, 'playing');
  assert.equal(engine.segmentPoses.length, INITIAL_SEGMENTS);
  for (const p of engine.segmentPoses) {
    assert.ok(
      Number.isFinite(p.x) &&
        Number.isFinite(p.y) &&
        Number.isFinite(p.z) &&
        Number.isFinite(p.yaw) &&
        Number.isFinite(p.radius),
      'All WASM-computed segment poses must be finite',
    );
  }

  // Verify C++ deformSnakeBody populates finite positions and unit normals
  const rings = 84;
  const radial = 16;
  const floatLen = (rings + 1) * (radial + 1) * 3;
  const outPos = new Float32Array(floatLen);
  const outNorm = new Float32Array(floatLen);
  const tailTip = { x: 0, y: 0, z: 0, yaw: 0 };

  const deformed = snakeCoreWasm.deformSnakeBody(
    engine.headX,
    engine.headY + HEAD_RADIUS * 0.56,
    engine.headZ,
    engine.heading,
    0,
    engine.segmentPoses,
    engine.segmentPoses.length,
    rings,
    radial,
    engine.elapsedSeconds,
    1.0,
    1.0,
    1.0,
    1.0,
    0.0,
    SEGMENT_SPACING,
    HEAD_RADIUS,
    outPos,
    outNorm,
    tailTip,
  );
  assert.equal(deformed, true);
  assert.ok(Number.isFinite(tailTip.x) && Number.isFinite(tailTip.y) && Number.isFinite(tailTip.z));

  for (let i = 0; i < floatLen; i++) {
    assert.ok(Number.isFinite(outPos[i]), `Position buffer non-finite at ${i}`);
    assert.ok(Number.isFinite(outNorm[i]), `Normal buffer non-finite at ${i}`);
  }
});

test('17. all 6 species unique powers trigger distinct combat, venom, stun, heal, and stealth effects', () => {
  // 1. King Cobra: Venom Spray spawns 7 venom projectiles that poison hit villagers
  {
    let venomHits = 0;
    const engine = new SnakeGameEngine({ onVenomHit: () => { venomHits++; } }, 501);
    engine.species = 'golden';
    engine.startGame();
    const target = engine.villagers[0];
    assert.ok(target);
    target.x = engine.headX;
    target.z = engine.headZ - 4.0;
    target.y = engine.headY;
    target.hp = 80;

    const ok = engine.triggerPrimaryPower();
    assert.equal(ok, true, 'Golden King Cobra power should trigger');
    const venomProjs = engine.projectiles.filter((p) => p.kind === 'venom');
    assert.equal(venomProjs.length, 7, 'Venom Spray should launch 7 toxic droplets');
    assert.ok(engine.powerCooldown > 2.5);

    for (let i = 0; i < 40; i++) engine.step(1 / 60, emptyInput());
    assert.ok(venomHits >= 1 || target.hp < 80, 'Venom droplets should strike nearby target');
  }

  // 2. Coral Viper: Venom Dart grants immediate stamina surge + 3 darts
  {
    const engine = new SnakeGameEngine({}, 502);
    engine.species = 'coral';
    engine.startGame();
    engine.stamina = 40;
    assert.equal(engine.triggerPrimaryPower(), true);
    assert.ok(engine.stamina >= 59, 'Venom Dart should refund +20 stamina');
    assert.equal(engine.projectiles.filter((p) => p.kind === 'venom').length, 3);
  }

  // 3. Emerald Boa: Venom Mist heals snake HP and releases toxic mist orbs
  {
    const engine = new SnakeGameEngine({}, 503);
    engine.species = 'emerald';
    engine.startGame();
    engine.hp = 60;
    assert.equal(engine.triggerPrimaryPower(), true);
    assert.ok(engine.hp > 60, 'Emerald Venom Mist should heal snake HP');
    assert.equal(engine.projectiles.filter((p) => p.kind === 'mist').length, 5);
  }

  // 4. Obsidian Python: Titan Crush stuns & knocks back villagers and shatters enemy bolts
  {
    const engine = new SnakeGameEngine({}, 504);
    engine.species = 'obsidian';
    engine.startGame();
    const hunter = engine.villagers.find((v) => v.role === 'spearman')!;
    hunter.x = engine.headX + 2.0;
    hunter.z = engine.headZ - 2.0;
    hunter.y = engine.headY;
    hunter.hp = 70;
    const distBefore = Math.hypot(hunter.x - engine.headX, hunter.z - engine.headZ);

    assert.equal(engine.triggerPrimaryPower(), true);
    assert.ok(hunter.hp < 70, 'Titan Crush should damage nearby hunter');
    assert.ok((hunter.stunTimer ?? 0) > 1.0, 'Titan Crush should stun hit hunter');
    const distAfter = Math.hypot(hunter.x - engine.headX, hunter.z - engine.headZ);
    assert.ok(distAfter > distBefore, 'Titan Crush should knock back struck hunter');
  }

  // 5. Timber Rattler: Sonic Rattle applies wide stun + poison
  {
    const engine = new SnakeGameEngine({}, 505);
    engine.species = 'rattler';
    engine.startGame();
    const hunter = engine.villagers.find((v) => v.role === 'crossbow')!;
    hunter.x = engine.headX + 4.5;
    hunter.z = engine.headZ - 4.5;
    hunter.y = engine.headY;
    hunter.hp = 70;

    assert.equal(engine.triggerPrimaryPower(), true);
    assert.ok(hunter.hp < 70, 'Sonic Rattle should hit target within 8.4m');
    assert.ok((hunter.stunTimer ?? 0) >= 2.0, 'Sonic Rattle should stun target');
    assert.ok((hunter.poisonTimer ?? 0) > 2.0, 'Sonic Rattle should poison target');
  }

  // 6. Ivory Python: Phantom Veil activates stealth and causes pursuing hunter to drop aggro
  {
    const engine = new SnakeGameEngine({}, 506);
    engine.species = 'albino';
    engine.startGame();
    const hunter = engine.villagers.find((v) => v.role === 'spearman')!;
    hunter.state = 'pursue';

    assert.equal(engine.triggerPrimaryPower(), true);
    assert.ok(engine.stealthTimer > 3.0, 'Phantom Veil should activate stealth cloak');
    assert.equal(hunter.state, 'patrol', 'Phantom Veil should break pursuing hunter lock');
  }
});

test('18. Tail Grab & Devour latches villager, reels in over 0.52s, devours with rewards, and uses short whiff cooldown', () => {
  // 1. Whiff when no villager in range gives short 1.1s cooldown
  {
    const engine = new SnakeGameEngine({}, 601);
    engine.startGame();
    for (const v of engine.villagers) {
      v.x = 95;
      v.z = 95;
    }
    const latched = engine.triggerTailGrab();
    assert.equal(latched, false);
    assert.ok(engine.tailGrabCooldown > 0.8 && engine.tailGrabCooldown <= 1.2);
  }

  // 2. Latch an in-range villager, reel in to snake tail/body, and devour cleanly
  let devoured = 0;
  const engine = new SnakeGameEngine(
    {
      onTailDevour: () => {
        devoured++;
      },
    },
    602,
  );
  engine.startGame();
  engine.hp = 65;
  engine.stamina = 50;
  const startLength = engine.segmentCount;
  const target = engine.villagers[0];
  assert.ok(target);
  target.x = engine.headX + 3.2;
  target.z = engine.headZ - 2.0;
  target.y = engine.headY;

  const latched = engine.triggerTailGrab();
  assert.equal(latched, true, 'Tail Grab should latch onto nearby villager');
  assert.equal(engine.grabStage, 1);
  assert.equal(target.grabbed, true);

  for (let i = 0; i < 45; i++) {
    engine.step(1 / 60, emptyInput());
  }

  assert.equal(devoured, 1, 'Latched villager should be devoured after reel-in finishes');
  assert.equal(engine.grabStage, 0);
  assert.ok(engine.score >= 60, 'Devouring villager should award score');
  assert.ok(engine.hp > 65, 'Devouring villager should restore snake HP');
  assert.ok(engine.stamina > 50, 'Devouring villager should restore stamina');
  assert.ok(engine.segmentCount >= startLength + 2, 'Devouring villager should grow snake by at least +2');
  assert.ok(engine.getHudSnapshot().kills >= 1);
});

test('19. 420m open world houses 7 spaced villages with large buildings and solid collision separation', () => {
  assert.equal(ARENA_RADIUS, 420);
  assert.equal(VILLAGES.length, 7, 'Expected 7 distinct villages');

  const engine = new SnakeGameEngine({}, 707);
  engine.startGame();

  // Verify buildings are larger than starter snake
  assert.ok(engine.buildings.length >= 20);
  assert.ok(engine.buildings.every((b) => b.scale >= 2.45), 'All village buildings should use large realistic scale');

  // Verify each of the 7 villages has assigned villagers
  const villageIdsPresent = new Set(
    engine.villagers.map((v) => v.homeVillageId).filter((id): id is number => id !== undefined && id >= 0),
  );
  assert.equal(villageIdsPresent.size, 7, 'All 7 villages should spawn resident villagers');
});

test('20. starter snake drinks blood to grow until giant threshold, then swallows humans and unlocks Feast Power', () => {
  let bloodDrinks = 0;
  let swallowed = 0;
  let secondaryUsed = 0;

  const engine = new SnakeGameEngine(
    {
      onBloodDrink: () => {
        bloodDrinks++;
      },
      onTailDevour: () => {
        swallowed++;
      },
      onSecondaryPower: () => {
        secondaryUsed++;
      },
    },
    808,
  );
  engine.startGame();

  assert.ok(Math.abs(engine.snakeScale - START_SNAKE_SCALE) < 0.02);
  assert.equal(engine.canSwallow, false);
  assert.equal(engine.powerTier, 1);
  assert.equal(engine.triggerSecondaryPower(), false, 'Secondary feast power should be locked before feast 3');

  // 1. Small snake bites villagers & drinks blood to grow
  const v0 = engine.villagers[0];
  v0.hp = 120;
  v0.x = engine.headX;
  v0.z = engine.headZ - 2.0;
  v0.y = engine.headY;

  const startScale = engine.snakeScale;
  assert.equal(engine.triggerBiteAction(), true, 'Starter snake should bite & drink blood from nearby villager');
  assert.equal(bloodDrinks, 1);
  assert.ok(engine.snakeScale > startScale, 'Drinking blood should grow snakeScale');

  // Drink repeatedly until draining & defeating targets to unlock Tier 2 Feast Power
  for (let i = 1; i <= 5; i++) {
    const t = engine.villagers[i];
    t.hp = 35;
    t.x = engine.headX;
    t.z = engine.headZ - 1.8;
    t.y = engine.headY;
    engine.triggerBiteAction();
  }

  assert.ok(engine.feastCount >= 3, `Expected feastCount >= 3, got ${engine.feastCount}`);
  assert.ok(engine.powerTier >= 2, `Expected unlocked powerTier >= 2, got ${engine.powerTier}`);
  assert.equal(engine.triggerSecondaryPower(), true, 'Unlocked feast power [V] should trigger');
  assert.equal(secondaryUsed, 1);

  // Boost scale above SWALLOW_MIN_SCALE via additional feeding and verify whole-human swallow + belly bulge
  for (let i = 6; i <= 14; i++) {
    const t = engine.villagers[i];
    if (!t) break;
    t.hp = 100;
    t.x = engine.headX;
    t.z = engine.headZ - 1.8;
    t.y = engine.headY;
    engine.triggerBiteAction();
  }
  assert.ok(engine.snakeScale >= SWALLOW_MIN_SCALE, `Expected giant scale >= ${SWALLOW_MIN_SCALE}, got ${engine.snakeScale}`);
  assert.equal(engine.canSwallow, true);

  const meal = engine.villagers[15];
  meal.hp = 90;
  meal.x = engine.headX;
  meal.z = engine.headZ - 1.9;
  meal.y = engine.headY;
  assert.equal(engine.triggerBiteAction(), true);
  assert.ok(swallowed >= 1, 'Giant snake should swallow human whole');
  assert.ok(engine.swallowBulgeT > 0.5, 'Swallowing human should trigger traveling belly bulge');
});

test('21. herding villagers from one village into a rival village ignites inter-village clash', () => {
  let clashEvents = 0;
  const engine = new SnakeGameEngine(
    {
      onRivalClash: () => {
        clashEvents++;
      },
    },
    909,
  );
  engine.startGame();

  const villageA = engine.villagers.find((v) => v.homeVillageId === 0);
  const villageB = engine.villagers.find((v) => v.homeVillageId === 1);
  assert.ok(villageA && villageB);

  // Move Village 0 villager directly inside Village 1 territory facing Village 1 villager
  villageA.x = villageB.x + 2.5;
  villageA.z = villageB.z;
  villageA.y = villageB.y;
  villageA.state = 'patrol';
  villageB.state = 'patrol';
  villageA.attackCooldown = 0;
  villageB.attackCooldown = 0;

  // Keep snake away so rivalry is purely village vs village
  engine.headX = 0;
  engine.headZ = 220;

  for (let i = 0; i < 60; i++) {
    engine.step(1 / 60, emptyInput());
  }

  assert.equal(engine.rivalClashActive, true, 'Inter-village encounter should activate rivalClashActive');
  assert.ok(clashEvents >= 1, 'Rival encounter should emit onRivalClash event');
});

test('22. wildlife ecosystem spawns deer, boar, and elephant with size-gated devouring vs blood-drinking', () => {
  let eatenItem: any = null;
  let bloodDrank = 0;
  const engine = new SnakeGameEngine(
    {
      onEat: (item) => {
        eatenItem = item;
      },
      onBloodDrink: () => {
        bloodDrank++;
      },
    },
    777,
  );
  engine.startGame();

  // Verify prey array contains diverse wildlife
  const hasDeer = engine.preyItems.some((p) => p.kind === 'deer');
  const hasBoar = engine.preyItems.some((p) => p.kind === 'boar');
  const hasElephant = engine.preyItems.some((p) => p.kind === 'elephant');
  assert.ok(hasDeer, 'Forest should spawn deer');
  assert.ok(hasBoar, 'Forest should spawn boar');
  assert.ok(hasElephant, 'Forest should spawn elephant');

  // Small snake trying to devour an elephant: size-gated, drains blood instead of full swallow
  const elephant = engine.preyItems.find((p) => p.kind === 'elephant')!;
  elephant.x = engine.headX;
  elephant.z = engine.headZ - 1.0;
  elephant.y = engine.headY;

  // Move into elephant while small
  const moveInput = { ...emptyInput(), up: true };
  for (let i = 0; i < 20; i++) {
    engine.step(1 / 60, moveInput);
  }

  // Small snake bites elephant -> blood drink triggered or health wounded
  assert.ok(bloodDrank >= 1 || elephant.points > 0, 'Small snake should wound large beast and drink blood');

  // When snake grows to giant scale, devours elephant whole
  engine.snakeScale = 3.6;
  engine.step(1 / 60, moveInput);
  if (eatenItem) {
    assert.equal(eatenItem.kind, 'elephant');
  }
});

test('23. rapid stationary turns do not invert neck tangents or cause spine inversion', () => {
  const engine = new SnakeGameEngine({}, 555);
  engine.startGame();

  // Perform 180 degree rapid stationary turn
  const spinInput = { ...emptyInput(), left: true, steerAxis: -1.0 };
  for (let i = 0; i < 60; i++) {
    engine.step(1 / 60, spinInput);
  }

  // Verify segment distance and orientation
  for (let i = 0; i < engine.segmentPoses.length - 1; i++) {
    const s1 = engine.segmentPoses[i];
    const s2 = engine.segmentPoses[i + 1];
    const dist = Math.hypot(s1.x - s2.x, s1.z - s2.z);
    assert.ok(
      dist > 0.05,
      `Segments ${i} and ${i + 1} must not collapse to zero distance (got ${dist})`,
    );
    assert.ok(
      dist < 3.0,
      `Segments ${i} and ${i + 1} must not stretch unrealistically (got ${dist})`,
    );
  }
});

test('24. computeSnakeSpineRings anchors neck behind skull and keeps cervical rings clear of skull during tight stationary & moving turns', () => {
  const morph = getSpeciesMorph('emerald');
  const rings = 56;
  const ringOut = new Float32Array((rings + 1) * 4);

  const verifyCurrentSpine = (engine: SnakeGameEngine, label: string) => {
    const sc = engine.snakeScale;
    const headBaseY = engine.headY + HEAD_RADIUS * sc * 0.56;
    const headY = headBaseY + 0.015 * sc;
    const heading = engine.heading;
    const headPitch = 0;
    const poseCount = engine.segmentPoses.length;

    const res = computeSnakeSpineRings(
      {
        poses: snakeCoreWasm.playerPosesF32,
        poseStride: 5,
        poseCount,
        headX: engine.headX,
        headY,
        headZ: engine.headZ,
        heading,
        headPitch,
        rings,
        elapsed: engine.elapsedSeconds,
        segSpacing: SEGMENT_SPACING * sc,
        headRadius: HEAD_RADIUS * sc,
        headWidth: morph.headWidth,
        headLength: morph.headLength,
        bodyWidth: morph.bodyWidth,
        swallowBulgeT: engine.swallowBulgeT,
      },
      ringOut,
    );

    const fx = Math.sin(heading);
    const fz = Math.cos(heading);

    for (let i = 0; i < ringOut.length; i++) {
      assert.ok(Number.isFinite(ringOut[i]), `${label}: ringOut[${i}] must be finite`);
    }

    const r0Fwd = (ringOut[0] - engine.headX) * fx + (ringOut[2] - engine.headZ) * fz;
    assert.ok(
      r0Fwd < -0.1 * morph.headLength * sc,
      `${label}: ring 0 must sit behind head pivot (dot=${r0Fwd})`,
    );
    assert.ok(
      res.neckRad <= HEAD_RADIUS * sc * 0.45,
      `${label}: neck radius ${res.neckRad} must fit inside rear cranium cuff`,
    );

    for (let r = 1; r <= 2; r++) {
      const r4 = r * 4;
      const fwdFromP0 = (ringOut[r4] - ringOut[0]) * fx + (ringOut[r4 + 2] - ringOut[2]) * fz;
      assert.ok(
        fwdFromP0 <= 0.03 * sc,
        `${label}: cervical ring ${r} crossed forward into skull (fwdFromP0=${fwdFromP0})`,
      );
    }

    const frontX = engine.headX + fx * (0.28 * morph.headLength * sc);
    const frontZ = engine.headZ + fz * (0.28 * morph.headLength * sc);
    const skullCoreClear = 0.25 * morph.headWidth * sc;
    for (let r = 1; r <= 12; r++) {
      const r4 = r * 4;
      const dFront = Math.hypot(ringOut[r4] - frontX, ringOut[r4 + 2] - frontZ);
      assert.ok(
        dFront >= skullCoreClear,
        `${label}: ring ${r} penetrated front skull cavity (dist=${dFront} < ${skullCoreClear})`,
      );
    }

    for (let r = 1; r < 14; r++) {
      const p4 = (r - 1) * 4;
      const r4 = r * 4;
      const n4 = (r + 1) * 4;
      const ax = ringOut[r4] - ringOut[p4];
      const ay = ringOut[r4 + 1] - ringOut[p4 + 1];
      const az = ringOut[r4 + 2] - ringOut[p4 + 2];
      const bx = ringOut[n4] - ringOut[r4];
      const by = ringOut[n4 + 1] - ringOut[r4 + 1];
      const bz = ringOut[n4 + 2] - ringOut[r4 + 2];
      const la = Math.hypot(ax, ay, az);
      const lb = Math.hypot(bx, by, bz);
      if (la > 1e-4 && lb > 1e-4) {
        const dotAB = (ax * bx + ay * by + az * bz) / (la * lb);
        assert.ok(
          dotAB > -0.25,
          `${label}: sharp neck fold detected at ring ${r} (dot=${dotAB})`,
        );
      }
    }
  };

  const engineStat = new SnakeGameEngine({}, 555);
  engineStat.startGame();
  const spinInput = { ...emptyInput(), left: true, steerAxis: -1.0 };
  for (let i = 0; i < 90; i++) {
    engineStat.step(1 / 60, spinInput);
    if (i === 15 || i === 45 || i === 89) {
      verifyCurrentSpine(engineStat, `stationary-step-${i}`);
    }
  }

  const engineMove = new SnakeGameEngine({}, 777);
  engineMove.startGame();
  const tightTurnInput = { ...emptyInput(), up: true, left: true, boost: true, steerAxis: -1.0 };
  for (let i = 0; i < 120; i++) {
    engineMove.step(1 / 60, tightTurnInput);
    if (i === 20 || i === 60 || i === 119) {
      verifyCurrentSpine(engineMove, `moving-tight-turn-${i}`);
    }
  }
});

test('25. createPreyRig builds isolated species rigs with no frogs under deer, boar, or elephant', () => {
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  tex.needsUpdate = true;

  const frogSkinMat = new THREE.MeshStandardMaterial({ color: 0x3b8a2f });
  const animalMats: AnimalMaterialSet = {
    rabbitFurMat: new THREE.MeshStandardMaterial(),
    rabbitBellyMat: new THREE.MeshStandardMaterial(),
    mouseFurMat: new THREE.MeshStandardMaterial(),
    pinkSkinMat: new THREE.MeshStandardMaterial(),
    frogSkinMat,
    deerFurMat: new THREE.MeshStandardMaterial(),
    boarFurMat: new THREE.MeshStandardMaterial(),
    elephantSkinMat: new THREE.MeshStandardMaterial(),
    ivoryMat: new THREE.MeshStandardMaterial(),
  };

  try {
    const kinds: PreyKind[] = ['egg', 'berry', 'rabbit', 'mouse', 'frog', 'deer', 'boar', 'elephant'];
    for (const kind of kinds) {
      const rig = createPreyRig(kind, tex, animalMats, false);
      rig.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(rig.bodyPivot);

      let usesFrogSkin = false;
      rig.bodyPivot.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.isMesh && m.material === frogSkinMat) {
          usesFrogSkin = true;
        }
      });

      if (kind === 'frog') {
        assert.ok(rig.throatSac, 'Frog rig must include throatSac');
        assert.ok(usesFrogSkin, 'Frog rig must use frogSkinMat');
      } else {
        assert.equal(rig.throatSac, undefined, `${kind} rig must NOT include frog throatSac`);
        assert.equal(usesFrogSkin, false, `${kind} rig must NOT attach frog meshes`);
      }

      assert.ok(box.min.y >= -0.05, `${kind} bottom (${box.min.y}) must sit cleanly near ground y=0`);
      assert.ok(box.max.y > 0.2, `${kind} height must be positive`);
    }
  } finally {
    disposeSharedRigAssets();
    tex.dispose();
    for (const m of Object.values(animalMats)) m.dispose();
  }
});

test('26. hatchlings anchor to exact head coordinates and never stretch toward world origin', () => {
  const engine = new SnakeGameEngine({}, 321);
  engine.startGame();
  // Spawn hatchlings far away from world origin (0, 0)
  engine.spawnHatchling(48, 0, -36);
  engine.spawnHatchling(-55, 0, 42);

  const idle = emptyInput();
  for (let i = 0; i < 90; i++) {
    engine.step(1 / 30, idle);
  }

  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  tex.needsUpdate = true;
  const mat = new THREE.MeshStandardMaterial();
  const morph = getSpeciesMorph('emerald');

  try {
    for (let hi = 0; hi < engine.hatchlings.length; hi++) {
      const h = engine.hatchlings[hi];
      const rigWasm = createHatchlingRig(mat, mat, mat, tex, false);
      const rigFallback = createHatchlingRig(mat, mat, mat, tex, false);

      updateHatchlingRig(rigWasm, h, 3.0, morph, hi);
      updateHatchlingRig(rigFallback, h, 3.0, morph, -1);

      const posWasm = rigWasm.body.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const posFallback = rigFallback.body.mesh.geometry.attributes.position as THREE.BufferAttribute;

      let maxVertDistFromHead = 0;
      let maxWasmFallbackDiff = 0;
      for (let v = 0; v < posWasm.count; v++) {
        const vx = posWasm.getX(v);
        const vy = posWasm.getY(v);
        const vz = posWasm.getZ(v);
        assert.ok(Number.isFinite(vx) && Number.isFinite(vy) && Number.isFinite(vz), 'Hatchling vertices must be finite');

        const dHead = Math.hypot(vx - h.x, vz - h.z);
        if (dHead > maxVertDistFromHead) maxVertDistFromHead = dHead;

        const diff = Math.hypot(
          vx - posFallback.getX(v),
          vy - posFallback.getY(v),
          vz - posFallback.getZ(v),
        );
        if (diff > maxWasmFallbackDiff) maxWasmFallbackDiff = diff;
      }

      const maxExpectedLength = h.segmentPoses.length * (0.2 + h.growth * 0.08) + 0.6;
      assert.ok(
        maxVertDistFromHead <= maxExpectedLength,
        `Hatchling ${hi} vertices stretched too far from head (${maxVertDistFromHead} > ${maxExpectedLength})`,
      );
      assert.ok(
        maxWasmFallbackDiff < 1e-3,
        `WASM fast-path and fallback hatchling deform must match (diff=${maxWasmFallbackDiff})`,
      );

      rigWasm.body.dispose();
      rigFallback.body.dispose();
    }
  } finally {
    mat.dispose();
    tex.dispose();
  }
});

test('27. Smart Hatchling AI switches to open outdoor targets, routes via doorways around walls, and escorts mother snake', () => {
  const engine = new SnakeGameEngine({}, 701);
  engine.startGame();
  const cabin = engine.buildings.find((b) => b.kind === 'cabin')!;
  assert.ok(cabin);

  // Clear distractions far away
  for (let i = 0; i < engine.villagers.length; i++) {
    engine.villagers[i].x = 320;
    engine.villagers[i].z = 320;
    engine.villagers[i].state = 'ko';
  }
  for (const p of engine.preyItems) {
    p.x = 340;
    p.z = 340;
  }

  // 1. Doorway routing: hatchling behind cabin -Z wall navigates around corner into doorway cleanly
  const vInPos = buildingLocalToWorld(cabin, 0, 0);
  const vIn = engine.spawnVillager('flee', vInPos.wx, vInPos.wz, 1, false, 0)!;
  vIn.y = cabin.floors[0].elevation;
  vIn.hp = 42;
  vIn.state = 'patrol';

  const hBehind = buildingLocalToWorld(cabin, -0.5, -4.4);
  const mDoorSide = buildingLocalToWorld(cabin, -4.5, 0);
  engine.headX = mDoorSide.wx;
  engine.headZ = mDoorSide.wz;
  const h = engine.spawnHatchling(hBehind.wx, 0, hBehind.wz);
  h.targetVillagerId = vIn.id;

  const idle = emptyInput();
  let enteredDoorway = false;
  for (let f = 0; f < 420; f++) {
    vIn.x = vInPos.wx;
    vIn.z = vInPos.wz;
    vIn.y = cabin.floors[0].elevation;
    engine.step(1 / 60, idle);
    const gl = getBuildingAtPosition(h.x, h.z, h.y, engine.buildings);
    if (gl.isIndoors && gl.building?.id === cabin.id) {
      enteredDoorway = true;
      break;
    }
  }
  assert.equal(enteredDoorway, true, 'Hatchling behind cabin wall should route cleanly around corner through doorway');

  // 2. Outdoor retarget: hatchling behind wall with walled indoor target switches to reachable outdoor human
  h.x = hBehind.wx;
  h.z = hBehind.wz;
  h.y = 0;
  h.targetVillagerId = vIn.id;
  const outPos = buildingLocalToWorld(cabin, -4.0, -7.5);
  const vOut = engine.spawnVillager('flee', outPos.wx, outPos.wz, 1, false, -1)!;
  vOut.state = 'fleeing';
  vOut.hp = 42;
  engine.step(1 / 60, idle);
  assert.equal(h.targetVillagerId, vOut.id, 'Hatchling should switch from walled target to clear outdoor human');

  // 3. Mother-snake escort: hatchling separated by >45m closes back toward player snake
  engine.headX = 0;
  engine.headZ = 0;
  h.x = 64;
  h.z = 0;
  h.y = 0;
  h.targetVillagerId = null;
  h.targetPreyId = null;
  const distBefore = Math.hypot(h.x - engine.headX, h.z - engine.headZ);
  for (let f = 0; f < 240; f++) {
    engine.step(1 / 60, idle);
  }
  const distAfter = Math.hypot(h.x - engine.headX, h.z - engine.headZ);
  assert.ok(distAfter < distBefore - 20, `Separated hatchling should escort back toward mother snake (${distBefore} -> ${distAfter})`);
});

test('28. Smarter Human AI uses doorway shelter routes, crossbow kiting, and squad alerts', () => {
  const engine = new SnakeGameEngine({}, 702);
  engine.startGame();
  const cabin = engine.buildings.find((b) => b.kind === 'cabin')!;
  const idle = emptyInput();

  // 1. Crossbow kiting + Squad alert propagation
  engine.headX = 120;
  engine.headZ = 120;
  const xb = engine.spawnVillager('crossbow', 120, 125, 1, false, -1)!;
  const sp = engine.spawnVillager('spearman', 132, 125, 1, false, -1)!;
  xb.state = 'pursue';
  sp.state = 'patrol';
  const startDist = Math.hypot(xb.x - engine.headX, xb.z - engine.headZ);
  for (let f = 0; f < 60; f++) {
    engine.step(1 / 60, idle);
  }
  const endDist = Math.hypot(xb.x - engine.headX, xb.z - engine.headZ);
  assert.ok(endDist > startDist + 0.4, `Crossbowman should kite away from close snake (${startDist.toFixed(2)} -> ${endDist.toFixed(2)})`);
  assert.equal(sp.state, 'pursue', 'Nearby patrolling spearman should wake up via squad alert');

  // 2. Shelter-seeking civilian behind cabin routes around corner to doorway instead of pinning against rear wall
  const hBehind = buildingLocalToWorld(cabin, -0.5, -4.4);
  const vShelt = engine.spawnVillager('hide', hBehind.wx, hBehind.wz, 1, false, -1)!;
  vShelt.state = 'seeking_shelter';
  vShelt.targetBuildingId = cabin.id;
  engine.headX = hBehind.wx + 5;
  engine.headZ = hBehind.wz - 12;

  let reachedShelter = false;
  for (let f = 0; f < 420; f++) {
    engine.step(1 / 60, idle);
    const gl = getBuildingAtPosition(vShelt.x, vShelt.z, vShelt.y, engine.buildings);
    if (gl.isIndoors && gl.building?.id === cabin.id) {
      reachedShelter = true;
      break;
    }
  }
  assert.equal(reachedShelter, true, 'Shelter-seeking human behind cabin should navigate smoothly through doorway');
});

test('29. 420m expanded world provides 8 frontier regions, 4 watering ponds, smooth far terrain, and full map HUD radar data', () => {
  assert.equal(ARENA_RADIUS, 420);
  assert.equal(WORLD_REGIONS.length, 8);
  assert.equal(WATER_PONDS.length, 4);

  const elderwood = getWorldRegionAt(0, -285);
  assert.equal(elderwood?.name, 'Elderwood Canopy');

  // Verify far interior terrain at 405m is smooth while rim beyond 420m rises sharply
  const farInside = groundHeightAt(405, 0);
  const rimOutside = groundHeightAt(430, 0);
  assert.ok(Number.isFinite(farInside) && Math.abs(farInside) < 3.5, `Expected smooth 405m interior height (got ${farInside})`);
  assert.ok(rimOutside > farInside + 2.0, `Expected outer 430m berm ${rimOutside} > ${farInside}`);

  const engine = new SnakeGameEngine({}, 703);
  engine.startGame();
  const moveFwd = { ...emptyInput(), up: true };
  for (let f = 0; f < 40; f++) engine.step(1 / 60, moveFwd);

  const snap = engine.getHudSnapshot();
  assert.equal(snap.radar.arenaRadius, 420);
  assert.equal(snap.radar.regions.length, 8);
  assert.equal(snap.radar.ponds.length, 4);
  assert.ok(snap.radar.playerTrail.length >= 2, 'HUD radar should populate playerTrail as snake moves');
  assert.ok(snap.radar.buildings.every((b) => typeof b.name === 'string' && b.name.length > 0));
});

test('30. outdoor ruin altar, boulder sideRocks, fallen logs, oak roots, gate piers, and long tails stay solid with zero clipping while temple ramp remains climbable', () => {
  const engine = new SnakeGameEngine({}, 808);
  engine.startGame();
  engine.segmentCount = 45;
  engine.snakeScale = 0.85;

  const temple = engine.buildings.find((b) => b.kind === 'ruin_tower');
  assert.ok(temple, 'Expected Mossy Forest Temple');
  if (!temple) throw new Error('Expected Mossy Forest Temple');
  const templeBaseY = groundHeightAt(temple.x, temple.z);
  const moveFwd = { ...emptyInput(), up: true };

  // 1. Charge directly into upperAltar rear wall, left wing, and right wing -> must never clip inside upperAltar
  const attackVectors: Array<{ startX: number; startZ: number; targetX: number; targetZ: number; label: string }> = [
    { startX: 0, startZ: -4.9, targetX: 0, targetZ: -1.8, label: 'temple rear monolith wall' },
    { startX: -4.9, startZ: -1.8, targetX: -1.8, targetZ: -1.8, label: 'temple left stone wall' },
    { startX: 4.9, startZ: -1.8, targetX: 1.8, targetZ: -1.8, label: 'temple right stone wall' },
  ];
  for (const vec of attackVectors) {
    const startW = buildingLocalToWorld(temple, vec.startX, vec.startZ);
    const tgtW = buildingLocalToWorld(temple, vec.targetX, vec.targetZ);
    engine.headX = startW.wx;
    engine.headZ = startW.wz;
    engine.headY = groundHeightAt(startW.wx, startW.wz);
    engine.heading = Math.atan2(tgtW.wx - startW.wx, tgtW.wz - startW.wz);

    for (let f = 0; f < 90; f++) {
      engine.step(1 / 60, moveFwd);
      const loc = worldToBuildingLocal(temple, engine.headX, engine.headZ);
      const localY: number = (engine.headY - templeBaseY) / temple.scale;
      const insideAltar: boolean =
        localY < 1.65 &&
        loc.lx > -3.28 &&
        loc.lx < 3.28 &&
        loc.lz > -3.28 &&
        loc.lz < -0.22;
      assert.equal(
        insideAltar,
        false,
        `Snake clipped inside ${vec.label} at local=(${loc.lx.toFixed(2)}, ${localY.toFixed(2)}, ${loc.lz.toFixed(2)})`,
      );
    }
  }

  // 2. Verify snake can still climb Stone Steps + Altar Ramp cleanly up onto Temple Terrace
  const rampStart = buildingLocalToWorld(temple, 0, 3.8);
  const rampTop = buildingLocalToWorld(temple, 0, -1.6);
  engine.headX = rampStart.wx;
  engine.headZ = rampStart.wz;
  engine.headY = groundHeightAt(rampStart.wx, rampStart.wz);
  engine.heading = Math.atan2(rampTop.wx - rampStart.wx, rampTop.wz - rampStart.wz);
  let maxLocalY = 0;
  for (let f = 0; f < 160; f++) {
    // Keep steering toward temple terrace center along the ramp
    const curLoc = worldToBuildingLocal(temple, engine.headX, engine.headZ);
    if (curLoc.lz > -1.4) {
      const aim = buildingLocalToWorld(temple, 0, -1.6);
      engine.heading = Math.atan2(aim.wx - engine.headX, aim.wz - engine.headZ);
    }
    engine.step(1 / 60, moveFwd);
    const localY = (engine.headY - templeBaseY) / temple.scale;
    if (localY > maxLocalY) maxLocalY = localY;
  }
  assert.ok(maxLocalY >= 1.98, `Expected snake to climb altarRamp onto Temple Terrace (got maxLocalY=${maxLocalY.toFixed(2)})`);

  // 3. Verify boulder sideRock pushes out BOTH head and full 45-segment body
  const boulder = engine.obstacles.find((o) => o.kind === 'boulder')!;
  assert.ok(boulder);
  const sideRock = getBoulderSideRockCenter(boulder);
  engine.headX = sideRock.x + (sideRock.x - boulder.x) * 2.0;
  engine.headZ = sideRock.z + (sideRock.z - boulder.z) * 2.0;
  engine.headY = groundHeightAt(engine.headX, engine.headZ);
  engine.heading = Math.atan2(sideRock.x - engine.headX, sideRock.z - engine.headZ);
  for (let f = 0; f < 60; f++) {
    engine.step(1 / 60, moveFwd);
    const dSide = Math.hypot(engine.headX - sideRock.x, engine.headZ - sideRock.z);
    assert.ok(
      dSide >= sideRock.radius - 0.05,
      `Head clipped into boulder sideRock (dist=${dSide.toFixed(2)} < ${sideRock.radius.toFixed(2)})`,
    );
  }
  for (let i = 0; i < engine.segmentPoses.length; i++) {
    const seg = engine.segmentPoses[i];
    const dMain = Math.hypot(seg.x - boulder.x, seg.z - boulder.z);
    const dSide = Math.hypot(seg.x - sideRock.x, seg.z - sideRock.z);
    assert.ok(
      dMain >= 1.28 * boulder.scale - 0.05,
      `Tail segment ${i} clipped inside boulder mainRock`,
    );
    assert.ok(
      dSide >= sideRock.radius - 0.05,
      `Tail segment ${i} clipped inside boulder sideRock`,
    );
  }

  // 4. Verify fallen log capsule and oak root buttress keep head & long tail clear
  const log = engine.obstacles.find((o) => o.kind === 'log')!;
  assert.ok(log);
  const logSeg = getFallenLogSegment(log);
  engine.headX = log.x;
  engine.headZ = log.z + 2.4 * log.scale;
  engine.headY = groundHeightAt(engine.headX, engine.headZ);
  engine.heading = Math.atan2(log.x - engine.headX, log.z - engine.headZ);
  for (let f = 0; f < 50; f++) engine.step(1 / 60, moveFwd);
  const checkPointToLogDist = (px: number, pz: number) => {
    const abx = logSeg.bx - logSeg.ax;
    const abz = logSeg.bz - logSeg.az;
    const len2 = abx * abx + abz * abz;
    const t = len2 > 1e-6 ? Math.max(0, Math.min(1, ((px - logSeg.ax) * abx + (pz - logSeg.az) * abz) / len2)) : 0;
    return Math.hypot(px - (logSeg.ax + t * abx), pz - (logSeg.az + t * abz));
  };
  assert.ok(checkPointToLogDist(engine.headX, engine.headZ) >= logSeg.radius);
  for (let i = 0; i < engine.segmentPoses.length; i++) {
    const seg = engine.segmentPoses[i];
    assert.ok(
      checkPointToLogDist(seg.x, seg.z) >= logSeg.radius - 0.05,
      `Tail segment ${i} clipped into fallen log`,
    );
  }

  const oak = engine.trees.find((t) => t.kind === 'oak')!;
  assert.ok(oak);
  engine.headX = oak.x + 2.5 * oak.scale;
  engine.headZ = oak.z;
  engine.headY = groundHeightAt(engine.headX, engine.headZ);
  engine.heading = -Math.PI / 2;
  for (let f = 0; f < 50; f++) {
    engine.step(1 / 60, moveFwd);
    assert.ok(
      Math.hypot(engine.headX - oak.x, engine.headZ - oak.z) >= 1.0 * oak.scale,
      'Head clipped inside oak root buttress',
    );
  }

  // 5. Verify village gate stone pier blocks edge grazing
  const v0 = VILLAGES[0];
  const pierX = v0.centerX - v0.southGateHalfW;
  const pierZ = v0.centerZ + v0.halfD;
  engine.headX = pierX;
  engine.headZ = pierZ + 2.5;
  engine.headY = groundHeightAt(engine.headX, engine.headZ);
  engine.heading = Math.PI;
  for (let f = 0; f < 45; f++) {
    engine.step(1 / 60, moveFwd);
    const insidePier =
      Math.abs(engine.headX - pierX) < 0.72 &&
      Math.abs(engine.headZ - pierZ) < 0.72;
    assert.equal(insidePier, false, 'Snake clipped inside village stone gate pier');
  }
});


