import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  ARENA_RADIUS,
  HEAD_RADIUS,
  MAX_SEGMENTS,
  SnakeGameEngine,
  TURN_RATE,
  VILLAGES,
  WATER_PONDS,
  getSpeciesTraits,
  groundHeightAt,
} from '../game/engine';
import {
  OrbitCameraState,
  SprintBoostState,
  applyScreenDrag,
  applyZoomWheel,
  computeCameraRelativeMove,
  computeChaseSteerCommand,
  createInitialCameraState,
  createSprintBoostState,
  resolveEffectiveBoost,
  snapOrbitCamera,
  stepOrbitCamera,
} from '../game/cameraControls';
import { isInsideVillage, isPointNearBuilding } from '../game/buildings';
import { GraphicsQualityConfig, resolveGraphicsQualityConfig } from '../game/graphicsQuality';
import {
  CameraMode,
  GamePhase,
  GameSettings,
  Hatchling,
  HudSnapshot,
  InputState,
  LaidEgg,
  ObstacleKind,
  PreyItem,
  PreyKind,
  ProjectileKind,
  SnakeSpecies,
  Villager,
} from '../game/types';
import { SoundEngine } from './audio';
import {
  AnimalMaterialSet,
  AnimalRig,
  BirdRig,
  BuildingMaterialSet,
  BuildingVisualRig,
  ContinuousSnakeBody,
  HatchlingRig,
  LaidEggRig,
  SnakeHeadRig,
  VillageCullGroup,
  VillagerRig,
  animateAnimalRig,
  animateLaidEggRig,
  animateVillagerRig,
  createBirdRig,
  createBoltMesh,
  createBuildingMesh,
  createFernRosetteGeometry,
  createGrassTuftGeometry,
  createHatchlingRig,
  createLaidEggRig,
  createMistOrbMesh,
  createNaturalRockGeometry,
  createOakCrownBoughGeometry,
  createOakTrunkGeometry,
  createObstacleMesh,
  createPineFoliageGeometry,
  createPineTrunkGeometry,
  createPowerWaveRing,
  createPreyRig,
  createRattleMesh,
  createSnakeHeadRig,
  createTailTetherMesh,
  createVenomGlobMesh,
  createMultiVillageSettlementGroup,
  createVillagerRig,
  disposeSharedRigAssets,
  updateHatchlingRig,
} from './models';
import { snakeCoreWasm } from '../wasm/snakeCoreWasm';
import {
  HumanTextureSet,
  PbrTextureSet,
  SpeciesMorph,
  createBarkTexture,
  createContactShadowTexture,
  createEggShellTexture,
  createForestFloorTextures,
  createFrogSkinTexture,
  createFurTexture,
  createHumanMaterialTextures,
  createOakLeafAlphaTexture,
  createPineNeedleAlphaTexture,
  createReptileEyeTexture,
  createRockTexture,
  createRoofShingleTexture,
  createSnakeHeadTextures,
  createSnakeScaleTextures,
  createStoneWallTexture,
  createVillageRoadTexture,
  createWoodPlankTexture,
  getSpeciesBellyColor,
  getSpeciesEyeColor,
  getSpeciesMorph,
} from './textures';

const _color = new THREE.Color();

const PARTICLE_POOL_SIZE = 96;
const BEST_SCORE_STORAGE_KEY = 'serpentis_best_score_v1';

export interface SceneControllerCallbacks {
  onHudUpdate: (snapshot: HudSnapshot) => void;
  onFastBars?: (staminaPct: number, speedKmh: number, elapsedSec: number, hpPct: number) => void;
}

export class SnakeSceneController {
  private container: HTMLElement;
  private callbacks: SceneControllerCallbacks;
  private isSoftwareGl: boolean;
  private isMobileDevice: boolean;
  private isLowMem: boolean;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private sunLight: THREE.DirectionalLight;
  private sound: SoundEngine;
  public engine: SnakeGameEngine;

  private frameId = 0;
  private disposed = false;
  private lastTimeMs = 0;
  private hudSyncTimer = 0;
  private hitstopTimer = 0;
  private pendingTraumaAdd = 0;
  private dustKickAccum = 0;

  private baseFov = 54;

  private input: InputState = {
    left: false,
    right: false,
    up: false,
    down: false,
    boost: false,
    steerAxis: 0,
    moveThrottle: 0,
    joyX: 0,
    joyY: 0,
  };
  private stepInputBuf: InputState = {
    left: false,
    right: false,
    up: false,
    down: false,
    boost: false,
    steerAxis: 0,
    moveThrottle: 0,
    joyX: 0,
    joyY: 0,
  };
  private rawJoyX = 0;
  private rawJoyY = 0;
  private autoRunActive = false;
  private sprintBoostState: SprintBoostState = createSprintBoostState();
  private orbitCam: OrbitCameraState;
  private lookPointerId: number | null = null;
  private lookLastX = 0;
  private lookLastY = 0;
  private lastCameraMove = {
    active: false,
    desiredHeading: Math.PI,
    throttle: 0,
    localForward: 0,
    localRight: 0,
  };
  private keysHeld = new Set<string>();

  private speciesMorph: SpeciesMorph;
  private scaleTextures: PbrTextureSet;
  private headTextures: PbrTextureSet;
  private eyeTexture: THREE.CanvasTexture;
  private scaleMaterial: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
  private headMaterial: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;
  private bellyMaterial: THREE.MeshStandardMaterial;
  private headRig: SnakeHeadRig;
  private rattleMesh: THREE.Group;
  private snakeBody: ContinuousSnakeBody;
  private snakeShadowInstanced: THREE.InstancedMesh;
  private headShadowDisc: THREE.Mesh;
  private powerWaveRing: ReturnType<typeof createPowerWaveRing>;
  private tailTether: ReturnType<typeof createTailTetherMesh>;
  private wasStealth = false;

  private villageGroups: VillageCullGroup[] = [];
  private preyRigs = new Map<number, { rig: AnimalRig; kind: PreyKind }>();
  private preyPool = new Map<PreyKind, AnimalRig[]>();
  private villagerRigs = new Map<number, VillagerRig>();
  private laidEggRigs = new Map<number, LaidEggRig>();
  private hatchlingRigs = new Map<number, HatchlingRig>();
  private boltMeshes = new Map<number, { mesh: THREE.Group; kind: ProjectileKind }>();
  private boltPool = new Map<ProjectileKind, THREE.Group[]>();
  private obstacleMeshes = new Map<number, THREE.Group>();
  private buildingRigs = new Map<number, { rig: BuildingVisualRig; roofOpacity: number; isFading: boolean }>();
  private rockGeoObs: THREE.BufferGeometry;
  private rockMat: THREE.MeshStandardMaterial;
  private mossMat: THREE.MeshStandardMaterial;
  private barkMat: THREE.MeshStandardMaterial;
  private woodMat: THREE.MeshStandardMaterial;
  private stoneMat: THREE.MeshStandardMaterial;
  private shingleTex: { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture };
  private eggTex: { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture };
  private buildingMats: BuildingMaterialSet;
  private animalMats: AnimalMaterialSet;
  private humanTex: HumanTextureSet;
  private shadowTex: THREE.CanvasTexture;
  private grassInstanced: THREE.InstancedMesh | null = null;
  private maxGrassCount = 1600;
  private currentQuality: GameSettings['graphicsQuality'] = 'high';
  private qualityConfig: GraphicsQualityConfig;

  private activeBIds = new Set<number>();
  private activeObsIds = new Set<number>();
  private activePreyIds = new Set<number>();
  private activeVillagerIds = new Set<number>();
  private activeEggIds = new Set<number>();
  private activeHatchIds = new Set<number>();
  private activeBoltIds = new Set<number>();

  private frameDurations: number[] = [];
  private adaptivePerfTriggered = false;

  private birds: Array<{
    rig: BirdRig;
    orbitRadius: number;
    orbitSpeed: number;
    baseY: number;
    phase: number;
    centerX: number;
    centerZ: number;
  }> = [];

  private particleMesh: THREE.InstancedMesh;
  private motesPoints: THREE.Points;
  private motesUniforms = { uTime: { value: 0 } };
  private frameCounter = 0;
  private lastShadowX = 1e6;
  private lastShadowZ = 1e6;
  private visibleBirdCount = 6;

  private disposables: Array<{ dispose: () => void }> = [];
  private resizeObserver: ResizeObserver;

  constructor(
    container: HTMLElement,
    callbacks: SceneControllerCallbacks,
    initialSettings: GameSettings,
    autostart = false,
  ) {
    this.container = container;
    this.callbacks = callbacks;
    this.sound = new SoundEngine();
    this.currentQuality = initialSettings.graphicsQuality;

    this.isSoftwareGl = (() => {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    this.isMobileDevice =
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(pointer: coarse)')?.matches ||
        Math.min(window.innerWidth, window.innerHeight) < 620);
    const devMem =
      typeof navigator !== 'undefined' &&
      typeof (navigator as { deviceMemory?: number }).deviceMemory === 'number'
        ? (navigator as { deviceMemory?: number }).deviceMemory!
        : 8;
    this.isLowMem = this.isSoftwareGl || devMem <= 2;
    if (this.isLowMem) {
      this.maxGrassCount = 560;
    }

    this.qualityConfig = resolveGraphicsQualityConfig(initialSettings.graphicsQuality, {
      isMobile: this.isMobileDevice,
      isLowMem: this.isLowMem,
      isSoftwareGl: this.isSoftwareGl,
      devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
      maxGrassCount: this.maxGrassCount,
    });

    const initialShadows = this.qualityConfig.shadowsEnabled;

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl && !this.isLowMem,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: this.isSoftwareGl,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.24;
    this.renderer.setPixelRatio(this.qualityConfig.effectivePixelRatio);
    this.renderer.shadowMap.enabled = initialShadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    this.renderer.setSize(width, height);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    // Bright crisp sunny daytime sky haze
    this.scene = new THREE.Scene();
    const fogColor = 0xa8d4e8;
    this.scene.background = new THREE.Color(fogColor);
    this.scene.fog = new THREE.FogExp2(fogColor, 0.00125);

    this.baseFov = initialSettings.fov;
    this.camera = new THREE.PerspectiveCamera(this.baseFov, width / height, 0.25, 920);

    // Procedural Sunny Daytime Sky Dome (clear azure sky + warm sunlit horizon & solar glow)
    this.buildSkyDome();

    // Studio & sky environment reflection (pre-baked once at startup on all hardware tiers)
    const skipEnvMap = !this.qualityConfig.envMapEnabled;
    if (!skipEnvMap) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environment = envTex;
      this.scene.environmentIntensity = this.qualityConfig.environmentIntensity;
      pmrem.dispose();
      this.disposables.push(envTex);
    }

    // Bright midday/late-morning sunlight + sky/meadow hemisphere fill + sky rim backlight
    const hemi = new THREE.HemisphereLight(0xdaf0ff, 0x5d7a3c, skipEnvMap ? 1.38 : 1.18);
    this.scene.add(hemi);

    this.sunLight = new THREE.DirectionalLight(0xfff4d6, 3.35);
    this.sunLight.position.set(38, 58, -32);
    this.sunLight.castShadow = initialShadows;
    const shadowSize = this.isMobileDevice || this.isLowMem ? 512 : 1024;
    this.sunLight.shadow.mapSize.width = shadowSize;
    this.sunLight.shadow.mapSize.height = shadowSize;
    this.sunLight.shadow.camera.near = 4;
    this.sunLight.shadow.camera.far = 160;
    const sd = 56;
    this.sunLight.shadow.camera.left = -sd;
    this.sunLight.shadow.camera.right = sd;
    this.sunLight.shadow.camera.top = sd;
    this.sunLight.shadow.camera.bottom = -sd;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.02;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    const rimLight = new THREE.DirectionalLight(0xbce8ff, 0.95);
    rimLight.position.set(-28, 18, 30);
    this.scene.add(rimLight);

    // Shared PBR materials
    const maxAniso = this.isSoftwareGl
      ? 1
      : Math.min(this.qualityConfig.maxAnisotropyCap, this.renderer.capabilities.getMaxAnisotropy());
    this.shadowTex = createContactShadowTexture();
    this.eggTex = createEggShellTexture(maxAniso, this.isLowMem);
    this.humanTex = createHumanMaterialTextures(maxAniso, this.isLowMem);
    this.disposables.push(
      this.shadowTex,
      this.eggTex.map,
      this.eggTex.normalMap,
      this.humanTex.linenMap,
      this.humanTex.linenNormal,
      this.humanTex.leatherMap,
      this.humanTex.leatherNormal,
      this.humanTex.steelMap,
      this.humanTex.steelNormal,
      this.humanTex.humanEyeMap,
    );

    const rockTex = createRockTexture(maxAniso, this.isLowMem);
    this.disposables.push(rockTex.map, rockTex.normalMap);
    this.rockMat = new THREE.MeshStandardMaterial({
      map: rockTex.map,
      normalMap: rockTex.normalMap,
      normalScale: new THREE.Vector2(1.2, 1.2),
      roughness: 0.88,
      metalness: 0.04,
    });
    this.mossMat = new THREE.MeshStandardMaterial({
      color: 0x305424,
      roughness: 0.95,
      metalness: 0.0,
    });
    const barkTex = createBarkTexture(maxAniso, this.isLowMem);
    this.disposables.push(barkTex.map, barkTex.normalMap);
    this.barkMat = new THREE.MeshStandardMaterial({
      map: barkTex.map,
      normalMap: barkTex.normalMap,
      normalScale: new THREE.Vector2(1.1, 1.1),
      roughness: 0.92,
      metalness: 0.02,
    });
    const woodTex = createWoodPlankTexture(maxAniso, this.isLowMem);
    this.disposables.push(woodTex.map, woodTex.normalMap);
    this.woodMat = new THREE.MeshStandardMaterial({
      map: woodTex.map,
      normalMap: woodTex.normalMap,
      normalScale: new THREE.Vector2(1.15, 1.15),
      roughness: 0.85,
      metalness: 0.02,
    });
    const stoneTex = createStoneWallTexture(maxAniso, this.isLowMem);
    this.disposables.push(stoneTex.map, stoneTex.normalMap);
    this.stoneMat = new THREE.MeshStandardMaterial({
      map: stoneTex.map,
      normalMap: stoneTex.normalMap,
      normalScale: new THREE.Vector2(1.25, 1.25),
      roughness: 0.9,
      metalness: 0.03,
    });
    this.shingleTex = createRoofShingleTexture(maxAniso, this.isLowMem);
    this.disposables.push(this.shingleTex.map, this.shingleTex.normalMap);
    const shingleMat = new THREE.MeshStandardMaterial({
      map: this.shingleTex.map,
      normalMap: this.shingleTex.normalMap,
      roughness: 0.88,
      metalness: 0.02,
    });

    this.buildingMats = {
      woodMat: this.woodMat,
      stoneMat: this.stoneMat,
      barkMat: this.barkMat,
      mossMat: this.mossMat,
      shingleMat,
    };

    const rabbitFurTex = createFurTexture('#9c7f61', '#5a432f', '#cbb89c', maxAniso, 5501, this.isLowMem);
    const mouseFurTex = createFurTexture('#686158', '#3c3732', '#9b948b', maxAniso, 6603, this.isLowMem);
    const frogSkinTex = createFrogSkinTexture(maxAniso, this.isLowMem);
    this.disposables.push(
      rabbitFurTex.map,
      rabbitFurTex.normalMap,
      mouseFurTex.map,
      mouseFurTex.normalMap,
      frogSkinTex.map,
      frogSkinTex.normalMap,
    );

    const rabbitFurMat = new THREE.MeshStandardMaterial({
      map: rabbitFurTex.map,
      normalMap: rabbitFurTex.normalMap,
      normalScale: new THREE.Vector2(1.1, 1.1),
      roughness: 0.92,
      metalness: 0.0,
    });
    const rabbitBellyMat = new THREE.MeshStandardMaterial({
      color: 0xe6dcc8,
      roughness: 0.92,
    });
    const mouseFurMat = new THREE.MeshStandardMaterial({
      map: mouseFurTex.map,
      normalMap: mouseFurTex.normalMap,
      normalScale: new THREE.Vector2(1.0, 1.0),
      roughness: 0.9,
      metalness: 0.0,
    });
    const pinkSkinMat = new THREE.MeshStandardMaterial({
      color: 0xd49698,
      roughness: 0.65,
    });
    const frogSkinMat = this.isLowMem
      ? new THREE.MeshStandardMaterial({
          map: frogSkinTex.map,
          normalMap: frogSkinTex.normalMap,
          normalScale: new THREE.Vector2(1.0, 1.0),
          roughness: 0.24,
          metalness: 0.04,
        })
      : new THREE.MeshPhysicalMaterial({
          map: frogSkinTex.map,
          normalMap: frogSkinTex.normalMap,
          normalScale: new THREE.Vector2(1.0, 1.0),
          roughness: 0.22,
          metalness: 0.04,
          clearcoat: 0.78,
          clearcoatRoughness: 0.14,
        });
    const deerFurMat = new THREE.MeshStandardMaterial({
      color: 0x935c34,
      roughness: 0.88,
      metalness: 0.0,
    });
    const boarFurMat = new THREE.MeshStandardMaterial({
      color: 0x3d3027,
      roughness: 0.94,
      metalness: 0.0,
    });
    const elephantSkinMat = new THREE.MeshStandardMaterial({
      color: 0x6e7174,
      roughness: 0.85,
      metalness: 0.02,
    });
    const ivoryMat = new THREE.MeshStandardMaterial({
      color: 0xf5eedb,
      roughness: 0.35,
      metalness: 0.05,
    });
    this.animalMats = {
      rabbitFurMat,
      rabbitBellyMat,
      mouseFurMat,
      pinkSkinMat,
      frogSkinMat,
      deerFurMat,
      boarFurMat,
      elephantSkinMat,
      ivoryMat,
    };

    this.rockGeoObs = createNaturalRockGeometry(7.3, 2);
    this.disposables.push(
      this.rockMat,
      this.mossMat,
      this.barkMat,
      this.woodMat,
      this.stoneMat,
      shingleMat,
      rabbitFurMat,
      rabbitBellyMat,
      mouseFurMat,
      pinkSkinMat,
      frogSkinMat,
      deerFurMat,
      boarFurMat,
      elephantSkinMat,
      ivoryMat,
      this.rockGeoObs,
    );

    // Engine setup with initial settings BEFORE building world trees & village props
    this.engine = new SnakeGameEngine(
      {
        onEat: (prey, combo) => this.handleEat(prey, combo),
        onHatch: (hatchling, x, y, z) => this.handleHatch(hatchling, x, y, z),
        onLayEgg: (egg) => this.handleLayEgg(egg),
        onSnakeHurt: (damage, x, y, z) => this.handleSnakeHurt(damage, x, y, z),
        onVillagerHit: (villager, killed, byHatchling) =>
          this.handleVillagerHit(villager, killed, byHatchling),
        onHunterTelegraph: () => this.sound.playTelegraphHorn(),
        onPowerUsed: (sp, hits, x, y, z, radius) => this.handlePowerUsed(sp, hits, x, y, z, radius),
        onTailGrab: (v, x, y, z) => this.handleTailGrab(v, x, y, z),
        onTailDevour: (_vid, isHunter, x, y, z) => this.handleTailDevour(isHunter, x, y, z),
        onVenomHit: (_v, x, y, z) => this.handleVenomHit(x, y, z),
        onBloodDrink: (_v, x, y, z) => this.handleBloodDrink(x, y, z),
        onSecondaryPower: (tier, _hits, x, y, z, radius) =>
          this.handleSecondaryPower(tier, x, y, z, radius),
        onRivalClash: (x, y, z) => this.handleRivalClash(x, y, z),
        onCrash: (reason, x, z) => this.handleCrash(reason, x, z),
        onPhaseChange: (phase) => this.handlePhaseChange(phase),
      },
      2026,
    );
    this.engine.species = initialSettings.species;
    this.engine.cameraMode = initialSettings.cameraMode;
    this.engine.difficulty = initialSettings.difficulty;
    this.engine.turnSensitivity = initialSettings.turnSensitivity;
    this.engine.muted = initialSettings.muted;
    this.sound.setVolume(initialSettings.volume);
    this.sound.setMuted(initialSettings.muted);
    this.engine.resetWorld(true);
    this.orbitCam = createInitialCameraState(
      this.engine.heading,
      this.baseFov,
      this.engine.cameraMode,
      this.engine.headX,
      this.engine.headY,
      this.engine.headZ,
      this.engine.snakeScale,
    );

    this.buildForestEnvironment(maxAniso);

    try {
      const savedBest = Number(localStorage.getItem(BEST_SCORE_STORAGE_KEY) || '0');
      if (Number.isFinite(savedBest) && savedBest > 0) {
        this.engine.setBestScore(savedBest);
      }
    } catch {
      // Ignore storage access failures
    }

    // Snake PBR materials: imbricated scales + dedicated cephalic head shields + textured predator iris
    this.speciesMorph = getSpeciesMorph(this.engine.species);
    const lowHeroTex = this.qualityConfig.lowHeroTextures;
    this.scaleTextures = createSnakeScaleTextures(this.engine.species, maxAniso, lowHeroTex);
    this.headTextures = createSnakeHeadTextures(this.engine.species, maxAniso, lowHeroTex);
    this.eyeTexture = createReptileEyeTexture(
      getSpeciesEyeColor(this.engine.species),
      this.speciesMorph.slitPupil,
    );

    if (lowHeroTex) {
      this.scaleMaterial = new THREE.MeshStandardMaterial({
        map: this.scaleTextures.map,
        normalMap: this.scaleTextures.normalMap,
        normalScale: new THREE.Vector2(this.speciesMorph.normalScale, this.speciesMorph.normalScale),
        roughness: Math.max(0.32, this.speciesMorph.roughness - 0.12),
        metalness: 0.08,
        vertexColors: true,
      });
      this.headMaterial = new THREE.MeshStandardMaterial({
        map: this.headTextures.map,
        normalMap: this.headTextures.normalMap,
        normalScale: new THREE.Vector2(this.speciesMorph.normalScale, this.speciesMorph.normalScale),
        roughness: Math.max(0.3, this.speciesMorph.roughness - 0.14),
        metalness: 0.08,
      });
    } else {
      this.scaleMaterial = new THREE.MeshPhysicalMaterial({
        map: this.scaleTextures.map,
        normalMap: this.scaleTextures.normalMap,
        normalScale: new THREE.Vector2(this.speciesMorph.normalScale, this.speciesMorph.normalScale),
        roughnessMap: this.scaleTextures.roughnessMap ?? null,
        roughness: this.speciesMorph.roughness,
        metalness: 0.04,
        clearcoat: this.speciesMorph.clearcoat,
        clearcoatRoughness: 0.36,
        iridescence: this.speciesMorph.iridescence,
        iridescenceIOR: 1.38,
        vertexColors: true,
      });
      this.headMaterial = new THREE.MeshPhysicalMaterial({
        map: this.headTextures.map,
        normalMap: this.headTextures.normalMap,
        normalScale: new THREE.Vector2(this.speciesMorph.normalScale, this.speciesMorph.normalScale),
        roughnessMap: this.headTextures.roughnessMap ?? null,
        roughness: Math.max(0.34, this.speciesMorph.roughness - 0.05),
        metalness: 0.04,
        clearcoat: Math.min(0.45, this.speciesMorph.clearcoat + 0.06),
        clearcoatRoughness: 0.32,
        iridescence: this.speciesMorph.iridescence,
        iridescenceIOR: 1.38,
      });
    }
    this.bellyMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(getSpeciesBellyColor(this.engine.species)),
      roughness: 0.45,
      metalness: 0.02,
    });
    this.disposables.push(this.scaleMaterial, this.headMaterial, this.bellyMaterial);

    this.headRig = createSnakeHeadRig(
      this.headMaterial,
      this.scaleMaterial,
      this.bellyMaterial,
      this.eyeTexture,
      initialShadows,
    );
    const initSc = this.engine.snakeScale;
    this.headRig.root.scale.set(
      this.speciesMorph.headWidth * initSc,
      this.speciesMorph.headHeight * initSc,
      this.speciesMorph.headLength * initSc,
    );
    this.headRig.cobraHood.visible = false;
    this.scene.add(this.headRig.root);

    this.rattleMesh = createRattleMesh();
    this.rattleMesh.visible = this.speciesMorph.hasRattle;
    this.scene.add(this.rattleMesh);

    this.headShadowDisc = new THREE.Mesh(
      new THREE.CircleGeometry(0.75, 16),
      new THREE.MeshBasicMaterial({
        map: this.shadowTex,
        transparent: true,
        opacity: 0.56,
        depthWrite: false,
      }),
    );
    this.headShadowDisc.rotation.x = -Math.PI / 2;
    this.scene.add(this.headShadowDisc);

    const bodyRings = this.isLowMem || this.isSoftwareGl ? 72 : 96;
    const bodyRadial = this.isLowMem || this.isSoftwareGl ? 18 : 20;
    this.snakeBody = new ContinuousSnakeBody(
      this.scaleMaterial,
      initialShadows,
      bodyRings,
      bodyRadial,
    );
    this.scene.add(this.snakeBody.mesh);
    this.disposables.push(this.snakeBody);

    this.snakeShadowInstanced = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.68, 12),
      new THREE.MeshBasicMaterial({
        map: this.shadowTex,
        transparent: true,
        opacity: 0.44,
        depthWrite: false,
      }),
      MAX_SEGMENTS,
    );
    this.snakeShadowInstanced.frustumCulled = false;
    this.scene.add(this.snakeShadowInstanced);

    this.powerWaveRing = createPowerWaveRing();
    this.scene.add(this.powerWaveRing.mesh);
    this.disposables.push(this.powerWaveRing.geometry, this.powerWaveRing.material);

    this.tailTether = createTailTetherMesh();
    this.scene.add(this.tailTether.group);
    this.disposables.push(this.tailTether.geometry, this.tailTether.lassoGeo, this.tailTether.material);

    // Particle pool
    const particleGeo = new THREE.DodecahedronGeometry(0.11, 0);
    const particleMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.4,
      metalness: 0.1,
    });
    this.particleMesh = new THREE.InstancedMesh(particleGeo, particleMat, PARTICLE_POOL_SIZE);
    this.particleMesh.frustumCulled = false;
    this.particleMesh.count = PARTICLE_POOL_SIZE;
    this.scene.add(this.particleMesh);
    this.disposables.push(particleGeo, particleMat);

    const exp = snakeCoreWasm.getExports();
    (this.particleMesh.instanceMatrix.array as Float32Array).set(snakeCoreWasm.particleMatsView);
    if (this.particleMesh.instanceColor) {
      (this.particleMesh.instanceColor.array as Float32Array).set(snakeCoreWasm.particleColorsView);
      this.particleMesh.instanceColor.needsUpdate = true;
    }
    this.particleMesh.instanceMatrix.needsUpdate = true;
    void exp;

    this.motesPoints = this.createForestMotes(this.isLowMem ? 64 : 200);
    this.scene.add(this.motesPoints);

    // Circling forest hawks overhead across village and deep woods
    for (let i = 0; i < 6; i++) {
      const rig = createBirdRig();
      rig.root.scale.setScalar(1.35 + (i % 3) * 0.22);
      this.scene.add(rig.root);
      this.birds.push({
        rig,
        orbitRadius: 24 + i * 9.5,
        orbitSpeed: 0.16 + (i % 3) * 0.04,
        baseY: 17.5 + (i % 4) * 2.8,
        phase: i * 1.15,
        centerX: Math.sin(i * 1.7) * 32,
        centerZ: -25 + Math.cos(i * 2.1) * 34,
      });
    }

    this.applyGraphicsQuality(initialSettings.graphicsQuality);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    if (autostart) {
      this.engine.startGame();
      document.body.dataset.state = 'playing';
      this.snapCameraForPhase('playing');
    } else {
      for (let i = 0; i < 48; i++) {
        this.engine.stepTitleDemo(0.03);
      }
      document.body.dataset.state = 'title';
      this.snapCameraForPhase('title');
    }

    this.syncObstaclesAndPrey(this.engine.elapsedSeconds);
    this.syncSnakeMeshes(this.engine.elapsedSeconds);
    this.renderer.render(this.scene, this.camera);

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleWindowBlur);
    window.addEventListener('pointermove', this.handleWindowPointerMove);
    window.addEventListener('pointerup', this.handleWindowPointerUp);
    window.addEventListener('pointercancel', this.handleWindowPointerUp);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.renderer.domElement.addEventListener('contextmenu', this.handleContextMenu);
    this.renderer.domElement.addEventListener('pointerdown', this.handleCanvasPointerDown);
    this.renderer.domElement.addEventListener('wheel', this.handleCanvasWheel, { passive: false });

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    this.emitHudSnapshot();
    this.lastTimeMs = performance.now();
    this.tick();
  }

  private buildSkyDome(): void {
    const skyGeo = new THREE.SphereGeometry(840, 28, 18);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      uniforms: {
        uHorizonColor: { value: new THREE.Color(0xbce3f2) },
        uZenithColor: { value: new THREE.Color(0x3b86d1) },
        uSunGlowColor: { value: new THREE.Color(0xfff0b8) },
        uSunDir: { value: new THREE.Vector3(38, 48, -32).normalize() },
      },
      vertexShader: `
        varying vec3 vWorldDir;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldDir = normalize(position);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        varying vec3 vWorldDir;
        uniform vec3 uHorizonColor;
        uniform vec3 uZenithColor;
        uniform vec3 uSunGlowColor;
        uniform vec3 uSunDir;
        void main() {
          float h = clamp(vWorldDir.y * 2.1, 0.0, 1.0);
          vec3 col = mix(uHorizonColor, uZenithColor, pow(h, 0.56));
          float sunDot = max(dot(normalize(vWorldDir), uSunDir), 0.0);
          col += uSunGlowColor * pow(sunDot, 7.0) * 0.34;
          col += uSunGlowColor * pow(sunDot, 38.0) * 0.42;
          col += vec3(1.0, 0.98, 0.9) * pow(sunDot, 220.0) * 1.15;
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }
      `,
    });
    const skyDome = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(skyDome);
    this.disposables.push(skyGeo, skyMat);
  }

  private buildForestEnvironment(maxAniso: number): void {
    // 1. Vast Open-World Forest & Frontier Terrain (960m x 960m covering ARENA_RADIUS=420m)
    const worldPlaneSize = 960;
    const floorTex = createForestFloorTextures(maxAniso, this.isLowMem);
    floorTex.map.repeat.set(200, 200);
    floorTex.normalMap.repeat.set(200, 200);
    this.disposables.push(floorTex.map, floorTex.normalMap);
    if (floorTex.roughnessMap) {
      floorTex.roughnessMap.repeat.set(200, 200);
      this.disposables.push(floorTex.roughnessMap);
    }

    const terrainSegs = this.isLowMem ? 72 : 120;
    const floorGeo = new THREE.PlaneGeometry(worldPlaneSize, worldPlaneSize, terrainSegs, terrainSegs);
    floorGeo.rotateX(-Math.PI / 2);
    const pos = floorGeo.attributes.position;
    snakeCoreWasm.getExports().wasm_fill_terrain_heights(terrainSegs, worldPlaneSize);
    const heights = snakeCoreWasm.terrainOutView;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, heights[i]);
    }
    floorGeo.computeVertexNormals();

    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTex.map,
      normalMap: floorTex.normalMap,
      normalScale: new THREE.Vector2(1.15, 1.15),
      roughnessMap: floorTex.roughnessMap ?? null,
      roughness: 0.92,
      metalness: 0.02,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.receiveShadow = !this.isSoftwareGl && this.currentQuality !== 'performance';
    this.scene.add(floorMesh);
    this.disposables.push(floorGeo, floorMat);

    // 7 Rival Villages Split-Rail Fences, Stone Gateways, Dirt Roads & Plaza Wells
    const roadTex = createVillageRoadTexture(maxAniso, this.isLowMem);
    this.disposables.push(roadTex.map, roadTex.normalMap);
    const villagesGroup = createMultiVillageSettlementGroup(
      VILLAGES,
      this.buildingMats,
      roadTex,
      groundHeightAt,
      this.isSoftwareGl,
      this.isLowMem,
    );
    this.villageGroups = villagesGroup.villageGroups;
    this.scene.add(villagesGroup.group);
    this.disposables.push(...villagesGroup.disposables);

    // Organic rain puddle nestled outside South Village Gate clearing
    const puddleMat = this.isLowMem
      ? new THREE.MeshStandardMaterial({
          color: 0x1d525c,
          roughness: 0.24,
          metalness: 0.04,
          transparent: true,
          opacity: 0.9,
        })
      : new THREE.MeshPhysicalMaterial({
          color: 0x1d525c,
          roughness: 0.22,
          metalness: 0.04,
          clearcoat: 0.22,
          clearcoatRoughness: 0.18,
          envMapIntensity: 0.28,
          transparent: true,
          opacity: 0.9,
        });
    const puddleGeo = new THREE.CircleGeometry(3.2, this.isLowMem ? 20 : 32);
    puddleGeo.rotateX(-Math.PI / 2);
    const pPos = puddleGeo.attributes.position;
    for (let i = 0; i < pPos.count; i++) {
      const px = pPos.getX(i);
      const pz = pPos.getZ(i);
      const ang = Math.atan2(pz, px);
      const wobble = 1 + Math.sin(ang * 3 + 0.6) * 0.14 + Math.cos(ang * 5 - 0.4) * 0.08;
      pPos.setXYZ(i, px * wobble, 0, pz * wobble);
    }
    puddleGeo.computeVertexNormals();

    const mudRimMat = new THREE.MeshStandardMaterial({
      color: 0x453521,
      roughness: 0.72,
      metalness: 0.02,
      transparent: true,
      opacity: 0.85,
    });
    const mudRimGeo = new THREE.RingGeometry(2.7, 3.85, this.isLowMem ? 20 : 32);
    mudRimGeo.rotateX(-Math.PI / 2);
    const mPos = mudRimGeo.attributes.position;
    for (let i = 0; i < mPos.count; i++) {
      const px = mPos.getX(i);
      const pz = mPos.getZ(i);
      const ang = Math.atan2(pz, px);
      const wobble = 1 + Math.sin(ang * 3 + 0.6) * 0.14 + Math.cos(ang * 5 - 0.4) * 0.08;
      mPos.setXYZ(i, px * wobble, 0, pz * wobble);
    }

    for (const pond of WATER_PONDS) {
      const py0 = groundHeightAt(pond.x, pond.z);
      const mudRim = new THREE.Mesh(mudRimGeo, mudRimMat);
      mudRim.position.set(pond.x, py0 + 0.02, pond.z);
      mudRim.scale.set(pond.rx / 3.2, 1, pond.rz / 3.2);

      const puddle = new THREE.Mesh(puddleGeo, puddleMat);
      puddle.position.set(pond.x, py0 + 0.04, pond.z);
      puddle.scale.set(pond.rx / 3.2, 1, pond.rz / 3.2);
      puddle.receiveShadow = !this.isSoftwareGl && !this.isLowMem;
      this.scene.add(mudRim, puddle);
    }
    this.disposables.push(puddleGeo, puddleMat, mudRimGeo, mudRimMat);

    // 2. Natural Rugged Perimeter Rock Crags around ARENA_RADIUS (420m)
    const cragGeos = [
      createNaturalRockGeometry(1.1, this.isLowMem ? 1 : 2),
      createNaturalRockGeometry(4.7, this.isLowMem ? 1 : 2),
      createNaturalRockGeometry(9.3, 1),
    ];
    const dummy = new THREE.Object3D();

    cragGeos.forEach((geo, gIdx) => {
      const count = this.isLowMem ? 32 : 84;
      const cragInst = new THREE.InstancedMesh(geo, this.rockMat, count);
      cragInst.castShadow = !this.isSoftwareGl && !this.isLowMem;
      cragInst.receiveShadow = !this.isSoftwareGl && !this.isLowMem;

      for (let i = 0; i < count; i++) {
        const seed = i * 17.3 + gIdx * 41.1;
        const angle = (i / count) * Math.PI * 2 + Math.sin(seed) * 0.16;
        const dist = ARENA_RADIUS + 4.4 + ((Math.cos(seed * 1.7) + 1) * 0.5) * 4.6;
        const bx = Math.cos(angle) * dist;
        const bz = Math.sin(angle) * dist;
        const by = groundHeightAt(bx, bz);

        const sx = 1.3 + ((i * 23 + gIdx * 7) % 10) * 0.22;
        const sy = 0.9 + ((i * 13 + gIdx * 11) % 10) * 0.26;
        const sz = 1.2 + ((i * 19 + gIdx * 3) % 10) * 0.2;

        dummy.position.set(bx, by + sy * 0.28, bz);
        dummy.rotation.set(Math.sin(seed) * 0.35, seed * 0.9, Math.cos(seed) * 0.3);
        dummy.scale.set(sx, sy, sz);
        dummy.updateMatrix();
        cragInst.setMatrixAt(i, dummy.matrix);

        _color.setHSL(0.25, 0.1, 0.45 + ((i * 13) % 10) * 0.03);
        cragInst.setColorAt(i, _color);
      }
      cragInst.instanceMatrix.needsUpdate = true;
      if (cragInst.instanceColor) cragInst.instanceColor.needsUpdate = true;
      cragInst.computeBoundingSphere();
      this.scene.add(cragInst);
      this.disposables.push(geo);
    });

    // 3. Realistic Multi-Branch Forest Trees (Interior Collidable Trees + Deep Forest Perimeter Backdrop)
    const oakLeafTex = createOakLeafAlphaTexture(maxAniso, this.isLowMem);
    const pineNeedleTex = createPineNeedleAlphaTexture(maxAniso, this.isLowMem);
    this.disposables.push(oakLeafTex, pineNeedleTex);

    const oakTrunkGeo = createOakTrunkGeometry();
    const oakCrownGeo = createOakCrownBoughGeometry();
    const pineTrunkGeo = createPineTrunkGeometry();
    const pineCrownGeo = createPineFoliageGeometry();

    const oakLeafMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: oakLeafTex,
      alphaTest: 0.36,
      side: THREE.DoubleSide,
      roughness: 0.84,
      metalness: 0.0,
    });
    const pineLeafMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: pineNeedleTex,
      alphaTest: 0.34,
      side: THREE.DoubleSide,
      roughness: 0.86,
      metalness: 0.0,
    });
    this.disposables.push(oakTrunkGeo, oakCrownGeo, pineTrunkGeo, pineCrownGeo, oakLeafMat, pineLeafMat);

    // Combine exact engine interior trees + outer perimeter forest trees
    const allTrees: Array<{ x: number; z: number; scale: number; kind: 'oak' | 'pine'; rot: number }> =
      this.engine.trees.map((t, idx) => ({
        x: t.x,
        z: t.z,
        scale: t.scale,
        kind: t.kind,
        rot: (idx * 2.39996) % (Math.PI * 2),
      }));

    const perimTreeCount = this.isLowMem ? 110 : 300;
    const innerRingCount = Math.floor(perimTreeCount / 2);
    for (let i = 0; i < perimTreeCount; i++) {
      const ring = i < innerRingCount ? 0 : 1;
      const idx = ring === 0 ? i : i - innerRingCount;
      const totalInRing = ring === 0 ? innerRingCount : perimTreeCount - innerRingCount;
      const angle = (idx / totalInRing) * Math.PI * 2 + ring * 0.09 + Math.sin(i * 2.9) * 0.05;
      const dist = (ring === 0 ? ARENA_RADIUS + 4.5 : ARENA_RADIUS + 14.0) + ((i * 23) % 10) * 0.8;
      allTrees.push({
        x: Math.cos(angle) * dist,
        z: Math.sin(angle) * dist,
        scale: 0.96 + ((i * 31) % 10) * 0.07,
        kind: i % 3 === 0 ? 'pine' : 'oak',
        rot: angle * 1.7 + i,
      });
    }

    const oakList = allTrees.filter((t) => t.kind === 'oak');
    const pineList = allTrees.filter((t) => t.kind === 'pine');

    const populateTreeInstances = (
      list: typeof allTrees,
      trunkGeo: THREE.BufferGeometry,
      crownGeo: THREE.BufferGeometry,
      crownMat: THREE.MeshStandardMaterial,
      isPine: boolean,
    ) => {
      if (list.length === 0) return;
      const treeShadows = !this.isSoftwareGl && !this.isLowMem;
      const trunkInst = new THREE.InstancedMesh(trunkGeo, this.barkMat, list.length);
      trunkInst.castShadow = treeShadows;
      trunkInst.receiveShadow = treeShadows;

      const crownInst = new THREE.InstancedMesh(crownGeo, crownMat, list.length);
      crownInst.castShadow = false;
      crownInst.receiveShadow = treeShadows;

      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        const ty = groundHeightAt(t.x, t.z) - 0.15;
        const heightVar = t.scale * (0.94 + (i % 4) * 0.05);
        dummy.position.set(t.x, ty, t.z);
        dummy.rotation.set(Math.sin(i * 1.3) * 0.035, t.rot, Math.cos(i * 1.9) * 0.035);
        dummy.scale.set(t.scale, heightVar, t.scale);
        dummy.updateMatrix();
        trunkInst.setMatrixAt(i, dummy.matrix);
        crownInst.setMatrixAt(i, dummy.matrix);

        const hue = isPine ? 0.34 + ((i % 5) - 2) * 0.014 : 0.25 + ((i % 7) - 3) * 0.016;
        const sat = isPine ? 0.32 : 0.42;
        const light = 0.68 + (i % 5) * 0.07;
        _color.setHSL(hue, sat, light);
        crownInst.setColorAt(i, _color);
      }

      trunkInst.instanceMatrix.needsUpdate = true;
      crownInst.instanceMatrix.needsUpdate = true;
      if (crownInst.instanceColor) crownInst.instanceColor.needsUpdate = true;
      trunkInst.computeBoundingSphere();
      crownInst.computeBoundingSphere();
      this.scene.add(trunkInst, crownInst);
    };

    populateTreeInstances(oakList, oakTrunkGeo, oakCrownGeo, oakLeafMat, false);
    populateTreeInstances(pineList, pineTrunkGeo, pineCrownGeo, pineLeafMat, true);

    // 4. Perimeter & Woodland Ferns + Clustered Wild Forest Grass
    const fernCount = this.isLowMem ? 120 : 380;
    const fernGeo = createFernRosetteGeometry();
    const fernMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.78,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    const fernInst = new THREE.InstancedMesh(fernGeo, fernMat, fernCount);

    for (let i = 0; i < fernCount; i++) {
      const isInner = i < Math.floor(fernCount * 0.48);
      const angle = (i / fernCount) * Math.PI * 2 * (isInner ? 3.7 : 1.0) + Math.sin(i * 5.1) * 0.24;
      const dist = isInner
        ? 30 + ((i * 47) % Math.max(40, ARENA_RADIUS - 38))
        : ARENA_RADIUS - 1.2 + ((i * 23) % 10) * 1.1;
      const fx = Math.cos(angle) * dist;
      const fz = Math.sin(angle) * dist;
      const fy = groundHeightAt(fx, fz);
      const sc = 0.85 + ((i * 17) % 10) * 0.055;

      dummy.position.set(fx, fy, fz);
      dummy.rotation.set(0, angle * 2.1, 0);
      dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      fernInst.setMatrixAt(i, dummy.matrix);

      _color.setHSL(0.27 + (i % 4) * 0.015, 0.48, 0.28 + (i % 3) * 0.05);
      fernInst.setColorAt(i, _color);
    }
    fernInst.instanceMatrix.needsUpdate = true;
    if (fernInst.instanceColor) fernInst.instanceColor.needsUpdate = true;
    fernInst.computeBoundingSphere();
    this.scene.add(fernInst);
    this.disposables.push(fernGeo, fernMat);

    // Organic clustered wild grass clumps across open forest & village outskirts
    const grassGeo = createGrassTuftGeometry();
    const grassMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.88,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    this.grassInstanced = new THREE.InstancedMesh(grassGeo, grassMat, this.maxGrassCount);
    this.grassInstanced.receiveShadow = !this.isSoftwareGl && !this.isLowMem;

    let gSeed = 5150;
    const gRand = () => {
      gSeed = (gSeed * 1664525 + 1013904223) >>> 0;
      return gSeed / 0xffffffff;
    };

    const patches: Array<{ x: number; z: number; spread: number }> = [];
    for (let p = 0; p < 140; p++) {
      const a = gRand() * Math.PI * 2;
      const r = p < 24 ? 12 + gRand() * 14 : 28 + gRand() * (ARENA_RADIUS - 32);
      const px = Math.cos(a) * r;
      const pz = Math.sin(a) * r;
      if (Math.abs(px) < 6.5 && pz < 18 && pz > -85) continue;
      if (isInsideVillage(px, pz, 2)) continue;
      if (isPointNearBuilding(px, pz, 2.0, this.engine.buildings)) continue;
      patches.push({
        x: px,
        z: pz,
        spread: 2.2 + gRand() * 3.4,
      });
    }

    const activePatches = patches.length > 0 ? patches : [{ x: 14, z: 12, spread: 2.5 }];
    for (let i = 0; i < this.maxGrassCount; i++) {
      const patch = activePatches[i % activePatches.length];
      const ang = gRand() * Math.PI * 2;
      const rad = Math.pow(gRand(), 0.7) * patch.spread;
      const gx = patch.x + Math.cos(ang) * rad;
      const gz = patch.z + Math.sin(ang) * rad;
      const gy = groundHeightAt(gx, gz);
      const sc = 0.8 + gRand() * 0.7;

      dummy.position.set(gx, gy, gz);
      dummy.rotation.set((gRand() - 0.5) * 0.1, gRand() * Math.PI * 2, (gRand() - 0.5) * 0.1);
      dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      this.grassInstanced.setMatrixAt(i, dummy.matrix);

      _color.setHSL(0.25 + (gRand() - 0.5) * 0.05, 0.42 + gRand() * 0.14, 0.24 + gRand() * 0.09);
      this.grassInstanced.setColorAt(i, _color);
    }
    this.grassInstanced.instanceMatrix.needsUpdate = true;
    if (this.grassInstanced.instanceColor) this.grassInstanced.instanceColor.needsUpdate = true;
    this.grassInstanced.computeBoundingSphere();
    this.scene.add(this.grassInstanced);
    this.disposables.push(grassGeo, grassMat);
  }

  private createForestMotes(count = 200): THREE.Points {
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * (ARENA_RADIUS + 4);
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = 0.7 + Math.random() * 6.8;
      positions[i * 3 + 2] = Math.sin(a) * r;
      phases[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.motesUniforms.uTime,
        uColor: { value: new THREE.Color(0xf7e3a1) },
      },
      vertexShader: `
        attribute float aPhase;
        uniform float uTime;
        void main() {
          vec3 pos = position;
          pos.y = 0.7 + mod(pos.y + uTime * 0.14 + sin(uTime * 0.8 + aPhase) * 0.25, 6.8);
          pos.x += cos(uTime * 0.45 + aPhase) * 0.22;
          vec4 mv = modelViewMatrix * vec4(pos, 1.0);
          gl_PointSize = clamp(26.0 / max(1.0, -mv.z), 1.5, 5.5);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float alpha = smoothstep(0.5, 0.08, d) * 0.48;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    this.disposables.push(geo, mat);
    return new THREE.Points(geo, mat);
  }

  private handleEat(prey: PreyItem, combo: number): void {
    this.sound.playEat(prey.kind, combo);
    this.hitstopTimer = 0.042;
    this.pendingTraumaAdd = Math.min(1, this.pendingTraumaAdd + 0.28);

    const burstColor =
      prey.kind === 'frog'
        ? 0x6ce37c
        : prey.kind === 'berry'
          ? 0xef4444
          : prey.kind === 'elephant'
            ? 0x94a3b8
            : prey.kind === 'deer'
              ? 0xd97706
              : prey.kind === 'boar'
                ? 0x92400e
                : 0xf5d77f;
    const y = groundHeightAt(prey.x, prey.z) + 0.35;
    this.spawnParticleBurst(prey.x, y, prey.z, burstColor, 18, 4.8);
    this.emitHudSnapshot();
  }

  private handleHatch(_hatchling: Hatchling, x: number, y: number, z: number): void {
    this.sound.playHatch();
    this.spawnParticleBurst(x, y + 0.3, z, 0x8ef576, 18, 4.4);
    this.emitHudSnapshot();
  }

  private handleLayEgg(egg: LaidEgg): void {
    this.sound.playLayEgg();
    this.spawnParticleBurst(egg.x, egg.y + 0.25, egg.z, 0xe8d9a8, 12, 2.8);
    this.emitHudSnapshot();
  }

  private handleSnakeHurt(damage: number, x: number, y: number, z: number): void {
    this.sound.playHurt();
    this.hitstopTimer = damage >= 20 ? 0.055 : 0.032;
    this.pendingTraumaAdd = Math.min(1, this.pendingTraumaAdd + 0.52);
    this.spawnParticleBurst(x, y + 0.45, z, 0xd93829, 18, 5.2);
    this.emitHudSnapshot();
  }

  private handleVillagerHit(villager: Villager, killed: boolean, byHatchling: boolean): void {
    this.sound.playVillagerHit(killed);
    if (!byHatchling) {
      this.hitstopTimer = killed ? 0.048 : 0.024;
      this.pendingTraumaAdd = Math.min(1, this.pendingTraumaAdd + (killed ? 0.34 : 0.16));
    }
    this.spawnParticleBurst(
      villager.x,
      villager.y + 0.9,
      villager.z,
      killed ? 0xf2cf72 : 0xd93b2b,
      killed ? 20 : 10,
      4.8,
    );
    this.emitHudSnapshot();
  }

  private handleCrash(_reason: 'boundary' | 'obstacle' | 'self' | 'hunter', x: number, z: number): void {
    this.sound.playCrash();
    this.hitstopTimer = 0.075;
    this.pendingTraumaAdd = Math.min(1, this.pendingTraumaAdd + 0.88);
    const y = groundHeightAt(x, z) + 0.4;
    this.spawnParticleBurst(x, y, z, 0xd8a35d, 26, 6.2);

    try {
      localStorage.setItem(BEST_SCORE_STORAGE_KEY, String(this.engine.bestScore));
    } catch {
      // Ignore storage failures
    }
    this.emitHudSnapshot();
  }

  private handlePhaseChange(phase: GamePhase): void {
    document.body.dataset.state = phase;
    if (phase === 'playing') {
      this.keysHeld.clear();
      this.resetInput();
    }
    this.emitHudSnapshot();
  }

  private handlePowerUsed(
    species: SnakeSpecies,
    _hits: number,
    x: number,
    y: number,
    z: number,
    radius: number,
  ): void {
    if (species === 'obsidian' || species === 'rattler') {
      this.sound.playShockwave();
      this.pendingTraumaAdd = Math.min(1, this.pendingTraumaAdd + 0.55);
      this.hitstopTimer = 0.04;
      this.spawnParticleBurst(x, y + 0.35, z, species === 'obsidian' ? 0x38bdf8 : 0xfacc15, 28, Math.max(4.5, radius * 0.7));
    } else if (species === 'albino') {
      this.sound.playStealth();
      this.spawnParticleBurst(x, y + 0.4, z, 0xe2e8f0, 20, 4.4);
    } else {
      this.sound.playVenomSpit();
      this.pendingTraumaAdd = Math.min(1, this.pendingTraumaAdd + 0.22);
      const fx = Math.sin(this.engine.heading);
      const fz = Math.cos(this.engine.heading);
      this.spawnParticleBurst(x + fx * 0.9, y + 0.45, z + fz * 0.9, 0x84cc16, 18, 5.4);
    }
    this.emitHudSnapshot();
  }

  private handleTailGrab(villager: Villager | null, x: number, y: number, z: number): void {
    this.sound.playTailWhip(Boolean(villager));
    if (villager) {
      this.pendingTraumaAdd = Math.min(1, this.pendingTraumaAdd + 0.3);
      this.spawnParticleBurst(x, y + 0.85, z, 0xd4a853, 16, 4.8);
    } else {
      this.spawnParticleBurst(x, y + 0.25, z, 0x9ca3af, 8, 2.8);
    }
    this.emitHudSnapshot();
  }

  private handleTailDevour(isHunter: boolean, x: number, y: number, z: number): void {
    this.sound.playDevour();
    this.hitstopTimer = 0.052;
    this.pendingTraumaAdd = Math.min(1, this.pendingTraumaAdd + 0.44);
    this.spawnParticleBurst(x, y + 0.4, z, isHunter ? 0xf5cf73 : 0xef4444, 24, 5.8);
    this.emitHudSnapshot();
  }

  private handleVenomHit(x: number, y: number, z: number): void {
    this.sound.playVillagerHit(false);
    this.spawnParticleBurst(x, y + 0.4, z, 0x84cc16, 12, 4.2);
  }

  private handleBloodDrink(x: number, y: number, z: number): void {
    this.sound.playBloodDrink();
    this.hitstopTimer = 0.036;
    this.pendingTraumaAdd = Math.min(1, this.pendingTraumaAdd + 0.26);
    this.spawnParticleBurst(x, y, z, 0xb81424, 18, 4.6);
    this.emitHudSnapshot();
  }

  private handleSecondaryPower(powerTier: number, x: number, y: number, z: number, radius: number): void {
    if (powerTier >= 4) {
      this.sound.playShockwave();
      this.pendingTraumaAdd = Math.min(1, this.pendingTraumaAdd + 0.6);
      this.hitstopTimer = 0.045;
      this.spawnParticleBurst(x, y + 0.35, z, 0xf97316, 30, Math.max(5.0, radius * 0.72));
    } else {
      this.sound.playVenomSpit();
      this.pendingTraumaAdd = Math.min(1, this.pendingTraumaAdd + 0.28);
      this.spawnParticleBurst(x, y + 0.35, z, 0x22c55e, 22, 5.2);
    }
    this.emitHudSnapshot();
  }

  private handleRivalClash(x: number, y: number, z: number): void {
    this.sound.playRivalHorn();
    this.pendingTraumaAdd = Math.min(1, this.pendingTraumaAdd + 0.28);
    this.spawnParticleBurst(x, y + 1.2, z, 0xf59e0b, 20, 5.0);
    this.emitHudSnapshot();
  }

  private spawnParticleBurst(
    x: number,
    y: number,
    z: number,
    hex: number,
    count: number,
    speedScale: number,
  ): void {
    snakeCoreWasm.getExports().wasm_spawn_particle_burst(x, y, z, hex >>> 0, count, speedScale);
  }

  private updateParticles(dt: number): void {
    if (snakeCoreWasm.getExports().wasm_step_particles(dt) !== 0) {
      (this.particleMesh.instanceMatrix.array as Float32Array).set(snakeCoreWasm.particleMatsView);
      this.particleMesh.instanceMatrix.needsUpdate = true;
      if (this.particleMesh.instanceColor) {
        (this.particleMesh.instanceColor.array as Float32Array).set(
          snakeCoreWasm.particleColorsView,
        );
        this.particleMesh.instanceColor.needsUpdate = true;
      }
    }
  }

  private syncObstaclesAndPrey(elapsed: number, dt = 0.016): void {
    const headX = this.engine.headX;
    const headZ = this.engine.headZ;
    const enableShadows = this.qualityConfig.shadowsEnabled;
    const cullDist = this.qualityConfig.cullDistance;
    const cullDistSq = cullDist * cullDist;
    const buildingCullDistSq = (cullDist + 35) * (cullDist + 35);
    const lodDistSq = this.qualityConfig.lodDistanceSq;

    // 0. Distance-cull per-village settlement perimeter meshes (roads, fences, gates, wells)
    for (let i = 0; i < this.villageGroups.length; i++) {
      const vg = this.villageGroups[i];
      const dx = vg.cx - headX;
      const dz = vg.cz - headZ;
      const maxD = cullDist + vg.cullRadius + 24;
      vg.group.visible = dx * dx + dz * dz <= maxD * maxD;
    }

    // 1. Enterable Multi-Level Buildings + smooth roof cutaway & warm hearth flicker
    this.activeBIds.clear();
    for (const b of this.engine.buildings) {
      this.activeBIds.add(b.id);
      let entry = this.buildingRigs.get(b.id);
      if (!entry) {
        const rig = createBuildingMesh(
          b,
          this.buildingMats,
          this.shadowTex,
          this.isSoftwareGl,
          enableShadows,
        );
        rig.root.position.set(b.x, groundHeightAt(b.x, b.z), b.z);
        rig.root.rotation.y = b.rotation;
        rig.root.scale.setScalar(b.scale);
        this.scene.add(rig.root);
        entry = { rig, roofOpacity: 1, isFading: false };
        this.buildingRigs.set(b.id, entry);
      }

      const dx = b.x - headX;
      const dz = b.z - headZ;
      const d2 = dx * dx + dz * dz;
      if (d2 > buildingCullDistSq) {
        entry.rig.root.visible = false;
        continue;
      }
      entry.rig.root.visible = true;

      const shouldHideRoof =
        this.engine.activeBuildingId === b.id && this.engine.hideActiveRoof;
      const targetOpacity = shouldHideRoof ? 0.05 : 1.0;
      entry.roofOpacity += (targetOpacity - entry.roofOpacity) * (1 - Math.exp(-8 * dt));
      entry.rig.roofGroup.visible = entry.roofOpacity > 0.08;
      const fadingNow = entry.roofOpacity < 0.992;
      if (fadingNow !== entry.isFading) {
        entry.isFading = fadingNow;
        for (const rm of entry.rig.roofMaterials) {
          rm.transparent = fadingNow;
          rm.needsUpdate = true;
        }
      }
      for (const rm of entry.rig.roofMaterials) {
        rm.opacity = entry.roofOpacity;
      }
      if (entry.rig.interiorLight && entry.rig.baseEmberIntensity) {
        entry.rig.interiorLight.intensity =
          entry.rig.baseEmberIntensity * (0.9 + Math.sin(elapsed * 7.5 + b.id) * 0.1);
      }
    }
    for (const [id, entry] of this.buildingRigs.entries()) {
      if (!this.activeBIds.has(id)) {
        this.scene.remove(entry.rig.root);
        this.buildingRigs.delete(id);
      }
    }

    // 2. Natural Boulders & Fallen Logs
    this.activeObsIds.clear();
    for (const obs of this.engine.obstacles) {
      this.activeObsIds.add(obs.id);
      let mesh = this.obstacleMeshes.get(obs.id);
      if (!mesh) {
        mesh = createObstacleMesh(
          obs.kind,
          obs.scale,
          this.rockGeoObs,
          this.rockMat,
          this.mossMat,
          this.barkMat,
          this.shadowTex,
          enableShadows,
        );
        mesh.position.set(obs.x, groundHeightAt(obs.x, obs.z), obs.z);
        mesh.rotation.y = obs.rotation;
        this.scene.add(mesh);
        this.obstacleMeshes.set(obs.id, mesh);
      }
      const dx = obs.x - headX;
      const dz = obs.z - headZ;
      mesh.visible = (dx * dx + dz * dz) <= cullDistSq;
    }
    for (const [id, mesh] of this.obstacleMeshes.entries()) {
      if (!this.activeObsIds.has(id)) {
        this.scene.remove(mesh);
        this.obstacleMeshes.delete(id);
      }
    }

    // 3. Articulated Walking / Hopping / Scurrying Wildlife (pooled + distance LOD & culling)
    this.activePreyIds.clear();
    for (const prey of this.engine.preyItems) {
      this.activePreyIds.add(prey.id);
      let entry = this.preyRigs.get(prey.id);
      if (entry && entry.kind !== prey.kind) {
        entry.rig.root.visible = false;
        let bucket = this.preyPool.get(entry.kind);
        if (!bucket) {
          bucket = [];
          this.preyPool.set(entry.kind, bucket);
        }
        if (bucket.length < 8) bucket.push(entry.rig);
        else this.scene.remove(entry.rig.root);
        this.preyRigs.delete(prey.id);
        entry = undefined;
      }
      const isNew = !entry;
      if (!entry) {
        const pooled = this.preyPool.get(prey.kind)?.pop();
        const rig = pooled ?? createPreyRig(prey.kind, this.shadowTex, this.animalMats, enableShadows);
        if (!rig.root.parent) {
          this.scene.add(rig.root);
        }
        entry = { rig, kind: prey.kind };
        this.preyRigs.set(prey.id, entry);
      }
      const dx = prey.x - headX;
      const dz = prey.z - headZ;
      const d2 = dx * dx + dz * dz;
      if (d2 > cullDistSq) {
        entry.rig.root.visible = false;
        continue;
      }
      entry.rig.root.visible = true;
      entry.rig.root.position.set(prey.x, prey.y, prey.z);
      if (isNew || d2 < lodDistSq || (this.frameCounter + prey.id) % 3 === 0) {
        animateAnimalRig(entry.rig, prey, elapsed);
      }
    }
    for (const [id, entry] of this.preyRigs.entries()) {
      if (!this.activePreyIds.has(id)) {
        entry.rig.root.visible = false;
        let bucket = this.preyPool.get(entry.kind);
        if (!bucket) {
          bucket = [];
          this.preyPool.set(entry.kind, bucket);
        }
        if (bucket.length < 8) {
          bucket.push(entry.rig);
        } else {
          this.scene.remove(entry.rig.root);
        }
        this.preyRigs.delete(id);
      }
    }

    // 4. Village People (Fleeing Civilians, Sheltering Villagers & Armed Hunters, distance LOD & culling)
    this.activeVillagerIds.clear();
    for (const v of this.engine.villagers) {
      this.activeVillagerIds.add(v.id);
      let rig = this.villagerRigs.get(v.id);
      const isNew = !rig;
      if (!rig) {
        rig = createVillagerRig(v, this.shadowTex, this.humanTex, !enableShadows);
        this.scene.add(rig.root);
        this.villagerRigs.set(v.id, rig);
      }
      const dx = v.x - headX;
      const dz = v.z - headZ;
      const d2 = dx * dx + dz * dz;
      if (d2 > cullDistSq) {
        rig.root.visible = false;
        continue;
      }
      rig.root.visible = true;
      if (isNew || d2 < lodDistSq || (this.frameCounter + v.id) % 3 === 0) {
        animateVillagerRig(rig, v, elapsed);
      } else {
        rig.root.position.set(v.x, v.y, v.z);
        rig.root.rotation.y = v.heading;
      }
    }
    for (const [id, rig] of this.villagerRigs.entries()) {
      if (!this.activeVillagerIds.has(id)) {
        this.scene.remove(rig.root);
        this.villagerRigs.delete(id);
      }
    }

    // 5. Incubating Laid Snake Eggs
    this.activeEggIds.clear();
    for (const egg of this.engine.laidEggs) {
      this.activeEggIds.add(egg.id);
      let rig = this.laidEggRigs.get(egg.id);
      if (!rig) {
        rig = createLaidEggRig(egg, this.shadowTex, this.eggTex, enableShadows);
        this.scene.add(rig.root);
        this.laidEggRigs.set(egg.id, rig);
      }
      const dx = egg.x - headX;
      const dz = egg.z - headZ;
      if (dx * dx + dz * dz > cullDistSq) {
        rig.root.visible = false;
        continue;
      }
      rig.root.visible = true;
      animateLaidEggRig(rig, egg, elapsed);
    }
    for (const [id, rig] of this.laidEggRigs.entries()) {
      if (!this.activeEggIds.has(id)) {
        this.scene.remove(rig.root);
        this.laidEggRigs.delete(id);
      }
    }

    // 6. Growing Helper Baby Snakes (Hatchlings, distance LOD & culling)
    this.activeHatchIds.clear();
    for (let hi = 0; hi < this.engine.hatchlings.length; hi++) {
      const h = this.engine.hatchlings[hi];
      this.activeHatchIds.add(h.id);
      let rig = this.hatchlingRigs.get(h.id);
      const isNew = !rig;
      if (!rig) {
        rig = createHatchlingRig(
          this.headMaterial,
          this.scaleMaterial,
          this.bellyMaterial,
          this.eyeTexture,
          enableShadows,
        );
        this.scene.add(rig.root);
        this.hatchlingRigs.set(h.id, rig);
      }
      const dx = h.x - headX;
      const dz = h.z - headZ;
      const d2 = dx * dx + dz * dz;
      if (d2 > cullDistSq) {
        rig.root.visible = false;
        continue;
      }
      rig.root.visible = true;
      if (isNew || d2 < lodDistSq || (this.frameCounter + h.id) % 2 === 0) {
        updateHatchlingRig(rig, h, elapsed, this.speciesMorph, hi);
      }
    }
    for (const [id, rig] of this.hatchlingRigs.entries()) {
      if (!this.activeHatchIds.has(id)) {
        this.scene.remove(rig.root);
        rig.body.dispose();
        this.hatchlingRigs.delete(id);
      }
    }

    // 7. Crossbow Bolts & Venom/Mist Projectiles (pooled)
    this.activeBoltIds.clear();
    for (const b of this.engine.projectiles) {
      this.activeBoltIds.add(b.id);
      let entry = this.boltMeshes.get(b.id);
      if (entry && entry.kind !== b.kind) {
        entry.mesh.visible = false;
        let bucket = this.boltPool.get(entry.kind);
        if (!bucket) {
          bucket = [];
          this.boltPool.set(entry.kind, bucket);
        }
        if (bucket.length < 16) bucket.push(entry.mesh);
        else this.scene.remove(entry.mesh);
        this.boltMeshes.delete(b.id);
        entry = undefined;
      }
      if (!entry) {
        const pooled = this.boltPool.get(b.kind)?.pop();
        const mesh =
          pooled ??
          (b.kind === 'venom'
            ? createVenomGlobMesh()
            : b.kind === 'mist'
              ? createMistOrbMesh()
              : createBoltMesh());
        if (!mesh.parent) {
          this.scene.add(mesh);
        }
        entry = { mesh, kind: b.kind };
        this.boltMeshes.set(b.id, entry);
      }
      entry.mesh.visible = true;
      entry.mesh.position.set(b.x, b.y, b.z);
      entry.mesh.rotation.set(-Math.atan2(b.vy, Math.hypot(b.vx, b.vz)), b.yaw, 0);
      if (b.kind === 'mist') {
        const s = 0.8 + Math.sin(elapsed * 12 + b.id) * 0.16;
        entry.mesh.scale.setScalar(s);
      }
    }
    for (const [id, entry] of this.boltMeshes.entries()) {
      if (!this.activeBoltIds.has(id)) {
        entry.mesh.visible = false;
        let bucket = this.boltPool.get(entry.kind);
        if (!bucket) {
          bucket = [];
          this.boltPool.set(entry.kind, bucket);
        }
        if (bucket.length < 16) {
          bucket.push(entry.mesh);
        } else {
          this.scene.remove(entry.mesh);
        }
        this.boltMeshes.delete(id);
      }
    }

    // 8. Species Power Expanding Shockwave / Mist Ring
    const pulseT = this.engine.powerPulseTimer;
    if (pulseT > 0.01) {
      const pKind = this.engine.powerPulseKind;
      const maxT = pKind === 'obsidian' || pKind === 'rattler' ? 0.65 : pKind === 'emerald' || pKind === 'albino' ? 0.55 : 0.42;
      const prog = Math.max(0, Math.min(1, 1 - pulseT / maxT));
      const maxRad = pKind === 'rattler' ? 8.4 : pKind === 'obsidian' ? 7.4 : pKind === 'emerald' ? 5.2 : 3.2;
      const ringColor =
        pKind === 'obsidian' ? 0x38bdf8 : pKind === 'rattler' ? 0xfacc15 : pKind === 'albino' ? 0xe2e8f0 : pKind === 'coral' ? 0xf97316 : 0x84cc16;
      this.powerWaveRing.mesh.visible = true;
      this.powerWaveRing.mesh.position.set(
        this.engine.powerPulseX,
        this.engine.powerPulseY + 0.08,
        this.engine.powerPulseZ,
      );
      this.powerWaveRing.mesh.scale.setScalar(Math.max(0.4, maxRad * prog));
      this.powerWaveRing.material.color.setHex(ringColor);
      this.powerWaveRing.material.opacity = (1 - prog) * 0.72;
    } else {
      this.powerWaveRing.mesh.visible = false;
    }
  }

  private syncSnakeMeshes(elapsed: number): void {
    const poses = this.engine.segmentPoses;
    const count = Math.min(poses.length, MAX_SEGMENTS);
    const sc = this.engine.snakeScale;

    const neckSeg = poses[0];
    const headBaseY = this.engine.headY + HEAD_RADIUS * sc * 0.56;
    const headLift =
      this.engine.phase === 'playing' && (this.engine.nearPrey || this.engine.isBoosting)
        ? 0.07 * sc
        : 0.015 * sc;
    const headY = headBaseY + headLift;

    // Predatory slope alignment + subtle living head bob
    let slopePitch = 0;
    if (neckSeg) {
      const horiz = Math.hypot(this.engine.headX - neckSeg.x, this.engine.headZ - neckSeg.z);
      if (horiz > 0.05) {
        slopePitch = -Math.atan2(headY - neckSeg.y, horiz) * 0.65;
      }
    }
    const strikePitch = -this.engine.mouthOpen * 0.14;

    const headPitch = slopePitch + strikePitch;
    this.headRig.root.position.set(this.engine.headX, headY, this.engine.headZ);
    this.headRig.root.rotation.set(headPitch, this.engine.heading, 0);
    this.headRig.root.scale.set(
      this.speciesMorph.headWidth * sc,
      this.speciesMorph.headHeight * sc,
      this.speciesMorph.headLength * sc,
    );

    this.headRig.jawPivot.rotation.x = this.engine.mouthOpen * 0.62;
    const flickCycle = this.engine.tongueTimer % 2.6;
    const tongueOut = flickCycle < 0.34 ? Math.sin((flickCycle / 0.34) * Math.PI) : 0;
    this.headRig.tongueGroup.position.z = 0.70 + tongueOut * 0.34;
    this.headRig.tongueGroup.rotation.x = Math.sin(elapsed * 42) * 0.16 * tongueOut;
    this.headRig.tongueGroup.visible = tongueOut > 0.04;

    this.headShadowDisc.position.set(
      this.engine.headX,
      this.engine.headY + 0.02,
      this.engine.headZ,
    );
    this.headShadowDisc.scale.setScalar(sc);

    this.snakeBody.updatePlayer(headY, headPitch, count, elapsed, this.speciesMorph);

    if (this.rattleMesh.visible && count >= 3) {
      const tip = this.snakeBody.getTailTip();
      const vib =
        this.engine.isBoosting || this.engine.nearPrey ? Math.sin(elapsed * 58) * 0.12 : 0;
      this.rattleMesh.position.set(tip.x, tip.y + 0.03, tip.z);
      this.rattleMesh.rotation.set(0.28, tip.yaw + vib, 0);
      this.rattleMesh.scale.setScalar(sc);
    }

    if (!this.qualityConfig.contactShadowsEnabled) {
      this.snakeShadowInstanced.visible = false;
    } else {
      this.snakeShadowInstanced.visible = true;
      this.snakeShadowInstanced.count = count;
      snakeCoreWasm.getExports().wasm_write_snake_shadow_mats(count);
      (this.snakeShadowInstanced.instanceMatrix.array as Float32Array).set(
        snakeCoreWasm.shadowMatsView.subarray(0, count * 16),
      );
      this.snakeShadowInstanced.instanceMatrix.needsUpdate = true;
    }

    // Ivory Python Phantom Veil Stealth translucency
    const isStealth = this.engine.stealthTimer > 0.05;
    if (isStealth !== this.wasStealth) {
      this.wasStealth = isStealth;
      this.scaleMaterial.transparent = isStealth;
      this.scaleMaterial.opacity = isStealth ? 0.38 : 1.0;
      this.scaleMaterial.needsUpdate = true;
      this.headMaterial.transparent = isStealth;
      this.headMaterial.opacity = isStealth ? 0.42 : 1.0;
      this.headMaterial.needsUpdate = true;
    }

    // Active Tail-Grab Energy Coil / Tether connecting snake tail to caught villager
    const grabId = this.engine.grabTargetId;
    const isLatched = this.engine.grabStage === 1 && grabId >= 0;
    const tip = count >= 3 ? this.snakeBody.getTailTip() : { x: this.engine.headX, y: this.engine.headY, z: this.engine.headZ, yaw: this.engine.heading };
    if (isLatched) {
      let targetV: Villager | undefined;
      for (const v of this.engine.villagers) {
        if (v.id === grabId) {
          targetV = v;
          break;
        }
      }
      if (targetV) {
        this.tailTether.group.visible = true;
        this.tailTether.tether.visible = true;
        this.tailTether.lasso.visible = true;
        const sy = tip.y + 0.12;
        const tx = targetV.x;
        const ty = targetV.y + 0.85;
        const tz = targetV.z;
        const dist = Math.max(0.2, Math.hypot(tx - tip.x, ty - sy, tz - tip.z));
        this.tailTether.tether.position.set(tip.x, sy, tip.z);
        this.tailTether.tether.lookAt(tx, ty, tz);
        this.tailTether.tether.scale.set(1, 1, dist);
        this.tailTether.lasso.position.set(tx, ty, tz);
        this.tailTether.lasso.rotation.y = elapsed * 14;
      } else {
        this.tailTether.group.visible = false;
      }
    } else if (this.engine.grabWhipTimer > 0.02 && count >= 3) {
      // Brief tail-whip arc flash when whipping or finishing devour
      this.tailTether.group.visible = true;
      this.tailTether.tether.visible = false;
      this.tailTether.lasso.visible = true;
      this.tailTether.lasso.position.set(tip.x, tip.y + 0.2, tip.z);
      this.tailTether.lasso.rotation.y = elapsed * 18;
    } else {
      this.tailTether.group.visible = false;
    }
  }

  private updateCamera(dt: number, elapsed: number): void {
    if (this.engine.phase === 'title') {
      snakeCoreWasm
        .getExports()
        .wasm_step_camera(dt, elapsed, this.baseFov, this.pendingTraumaAdd);
      this.pendingTraumaAdd = 0;

      const cs = snakeCoreWasm.camStateView;
      this.camera.position.set(cs[6], cs[7], cs[8]);
      this.camera.lookAt(cs[3], cs[4], cs[5]);

      if (Math.abs(cs[9] - this.camera.fov) > 0.05) {
        this.camera.fov = cs[9];
        this.camera.updateProjectionMatrix();
      }
      return;
    }

    const camFrame = stepOrbitCamera(
      this.orbitCam,
      dt,
      this.engine.cameraMode,
      this.engine.headX,
      this.engine.headY,
      this.engine.headZ,
      this.engine.heading,
      this.engine.snakeScale,
      this.engine.isIndoors,
      this.engine.isBoosting,
      this.baseFov,
      this.lastCameraMove,
      groundHeightAt,
      this.pendingTraumaAdd,
    );
    this.pendingTraumaAdd = 0;

    this.camera.position.set(camFrame.posX, camFrame.posY, camFrame.posZ);
    this.camera.lookAt(camFrame.lookX, camFrame.lookY, camFrame.lookZ);

    if (Math.abs(camFrame.fov - this.camera.fov) > 0.05) {
      this.camera.fov = camFrame.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private snapCameraForPhase(phase: GamePhase): void {
    if (phase === 'title') {
      snakeCoreWasm.getExports().wasm_snap_camera(0, this.baseFov);
      const cs = snakeCoreWasm.camStateView;
      this.camera.position.set(cs[6], cs[7], cs[8]);
      this.camera.lookAt(cs[3], cs[4], cs[5]);
      this.camera.fov = cs[9];
      this.camera.updateProjectionMatrix();
    } else {
      const preserveYaw = phase === 'paused' || phase === 'gameover';
      snapOrbitCamera(
        this.orbitCam,
        this.engine.heading,
        this.engine.cameraMode,
        this.engine.headX,
        this.engine.headY,
        this.engine.headZ,
        this.engine.snakeScale,
        this.baseFov,
        preserveYaw,
      );
      this.camera.position.set(this.orbitCam.posX, this.orbitCam.posY, this.orbitCam.posZ);
      this.camera.lookAt(this.orbitCam.lookX, this.orbitCam.lookY, this.orbitCam.lookZ);
      this.camera.fov = this.orbitCam.fov;
      this.camera.updateProjectionMatrix();
    }
    this.sunLight.position.set(this.engine.headX + 38, 58, this.engine.headZ - 32);
    this.sunLight.target.position.set(this.engine.headX, 0, this.engine.headZ);
    this.sunLight.target.updateMatrixWorld();
  }

  private tick = (): void => {
    if (this.disposed) return;

    const now = performance.now();
    const rawDt = (now - this.lastTimeMs) / 1000;
    this.lastTimeMs = now;
    const dt = Math.min(Math.max(rawDt, 0.001), 0.05);

    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
    } else if (this.engine.phase === 'title') {
      this.engine.stepTitleDemo(dt);
    } else if (this.engine.phase === 'playing') {
      const move = computeCameraRelativeMove(
        this.orbitCam.yaw,
        this.input,
        this.rawJoyX,
        this.rawJoyY,
        this.autoRunActive,
      );
      this.lastCameraMove = move;

      const stepIn = this.stepInputBuf;
      stepIn.left = false;
      stepIn.right = false;
      stepIn.up = false;
      stepIn.down = false;
      stepIn.boost = resolveEffectiveBoost(
        this.sprintBoostState,
        this.input.boost || this.autoRunActive,
        move.active,
        this.engine.stamina,
      );
      stepIn.steerAxis = 0;
      stepIn.moveThrottle = 0;
      stepIn.joyX = 0;
      stepIn.joyY = 0;

      if (move.active) {
        if (this.engine.cameraMode === 'canopy') {
          stepIn.moveThrottle = move.throttle;
          stepIn.joyX = Math.sin(move.desiredHeading);
          stepIn.joyY = Math.cos(move.desiredHeading);
        } else {
          const traits = getSpeciesTraits(this.engine.species);
          const effTurnRate = TURN_RATE * this.engine.turnSensitivity * traits.turnMult;
          const steerCmd = computeChaseSteerCommand(
            this.engine.heading,
            move.desiredHeading,
            effTurnRate,
            dt,
          );
          if (steerCmd.snapHeading !== null) {
            this.engine.heading = steerCmd.snapHeading;
          }
          stepIn.steerAxis = steerCmd.steerAxis;
          stepIn.moveThrottle = move.throttle;
        }
      }

      this.engine.step(dt, stepIn);
      if (this.engine.isBoosting) {
        this.dustKickAccum += dt;
        if (this.dustKickAccum > 0.09) {
          this.dustKickAccum = 0;
          const tail = this.engine.segmentPoses[Math.min(4, this.engine.segmentPoses.length - 1)];
          if (tail) {
            this.spawnParticleBurst(tail.x, tail.y - 0.1, tail.z, 0x7b6b47, 2, 1.8);
          }
        }
      }
    }

    const elapsed = this.engine.elapsedSeconds;
    this.frameCounter++;
    this.syncObstaclesAndPrey(elapsed, dt);
    this.syncSnakeMeshes(elapsed);
    this.updateParticles(dt);
    this.updateCamera(dt, elapsed);

    if (
      Math.hypot(this.engine.headX - this.lastShadowX, this.engine.headZ - this.lastShadowZ) >
      1.25
    ) {
      this.lastShadowX = this.engine.headX;
      this.lastShadowZ = this.engine.headZ;
      this.sunLight.position.set(this.engine.headX + 38, 58, this.engine.headZ - 32);
      this.sunLight.target.position.set(this.engine.headX, 0, this.engine.headZ);
      this.sunLight.target.updateMatrixWorld();
    }

    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      if (i >= this.visibleBirdCount) continue;
      const a = elapsed * b.orbitSpeed + b.phase;
      const bx = b.centerX + Math.cos(a) * b.orbitRadius;
      const bz = b.centerZ + Math.sin(a) * b.orbitRadius;
      const by = b.baseY + Math.sin(elapsed * 0.7 + b.phase) * 0.65;
      b.rig.root.position.set(bx, by, bz);
      b.rig.root.rotation.set(0, -a, 0.22);
      const flap = Math.sin(elapsed * 5.2 + b.phase) * 0.38;
      b.rig.leftWing.rotation.z = flap;
      b.rig.rightWing.rotation.z = -flap;
    }

    this.sound.updateSoundscape(
      dt,
      this.engine.phase,
      this.engine.speed,
      this.engine.isBoosting,
      this.engine.species,
      this.engine.nearPrey,
      elapsed,
    );

    this.motesUniforms.uTime.value = elapsed;

    if (this.engine.phase === 'playing') {
      this.callbacks.onFastBars?.(
        this.engine.stamina,
        Math.round(this.engine.speed * 3.6),
        Math.floor(this.engine.elapsedSeconds),
        this.engine.hp,
      );
    }

    if (this.engine.phase === 'playing') {
      this.hudSyncTimer += dt;
      if (this.hudSyncTimer >= (this.isLowMem ? 0.16 : 0.12)) {
        this.hudSyncTimer = 0;
        this.emitHudSnapshot();
      }
    }

    this.renderer.render(this.scene, this.camera);

    // Adaptive frame-rate monitor: only drops shadow pass on sustained <20fps after warmup
    if (!this.isSoftwareGl && this.frameCounter >= 240 && this.frameCounter % 60 === 0) {
      this.frameDurations.push(rawDt);
      if (this.frameDurations.length > 5) this.frameDurations.shift();
      const avgDuration =
        this.frameDurations.reduce((a, b) => a + b, 0) / this.frameDurations.length;
      if (avgDuration > 0.048 && !this.adaptivePerfTriggered && this.currentQuality !== 'performance') {
        this.adaptivePerfTriggered = true;
        this.applyGraphicsQuality('performance');
      }
    }

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private emitHudSnapshot(): void {
    this.callbacks.onHudUpdate(this.engine.getHudSnapshot());
  }

  private applyGraphicsQuality(quality: GameSettings['graphicsQuality']): void {
    this.currentQuality = quality;
    const cfg = resolveGraphicsQualityConfig(quality, {
      isMobile: this.isMobileDevice,
      isLowMem: this.isLowMem,
      isSoftwareGl: this.isSoftwareGl,
      devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
      maxGrassCount: this.maxGrassCount,
    });
    this.qualityConfig = cfg;

    if (this.grassInstanced) {
      this.grassInstanced.count = cfg.grassCount;
    }
    this.motesPoints.visible = cfg.showMotes;
    this.visibleBirdCount = cfg.visibleBirds;
    for (let i = 0; i < this.birds.length; i++) {
      this.birds[i].rig.root.visible = i < this.visibleBirdCount;
    }
    if (this.scaleMaterial && this.headMaterial) {
      if ('iridescence' in this.scaleMaterial) {
        this.scaleMaterial.iridescence = cfg.heroIridescence ? this.speciesMorph.iridescence : 0;
        this.scaleMaterial.clearcoat = cfg.heroClearcoat ? this.speciesMorph.clearcoat : 0;
      }
      if ('iridescence' in this.headMaterial) {
        this.headMaterial.iridescence = cfg.heroIridescence ? this.speciesMorph.iridescence : 0;
        this.headMaterial.clearcoat = cfg.heroClearcoat
          ? Math.min(0.45, this.speciesMorph.clearcoat + 0.04)
          : 0;
      }
    }
    this.scene.environmentIntensity = cfg.environmentIntensity;

    if (!this.isSoftwareGl) {
      this.renderer.setPixelRatio(cfg.effectivePixelRatio);
      if (this.renderer.shadowMap.enabled !== cfg.shadowsEnabled) {
        this.renderer.shadowMap.enabled = cfg.shadowsEnabled;
        this.sunLight.castShadow = cfg.shadowsEnabled;
      }
    }
  }

  public applySettings(settings: GameSettings): void {
    if (settings.species !== this.engine.species) {
      this.setSpecies(settings.species);
    }
    this.engine.cameraMode = settings.cameraMode;
    this.engine.difficulty = settings.difficulty;
    this.engine.turnSensitivity = settings.turnSensitivity;
    this.baseFov = settings.fov;
    this.sound.setVolume(settings.volume);
    this.engine.muted = settings.muted;
    this.sound.setMuted(settings.muted);
    this.applyGraphicsQuality(settings.graphicsQuality);
    this.emitHudSnapshot();
  }

  public startNewGame(): void {
    this.sound.playStart();
    this.autoRunActive = false;
    this.sprintBoostState.exhausted = false;
    this.endLookDrag();
    this.engine.startGame();
    this.syncObstaclesAndPrey(0);
    this.syncSnakeMeshes(0);
    this.snapCameraForPhase('playing');
    document.body.dataset.state = 'playing';
    this.emitHudSnapshot();
  }

  public resumeGame(): void {
    this.sound.playUiClick();
    if (this.engine.phase === 'paused') {
      this.engine.setPhase('playing');
    }
  }

  public togglePause(): void {
    this.sound.playUiClick();
    this.endLookDrag();
    this.engine.togglePause();
  }

  public returnToTitle(): void {
    this.sound.playUiClick();
    this.autoRunActive = false;
    this.sprintBoostState.exhausted = false;
    this.endLookDrag();
    this.engine.resetWorld(true);
    this.engine.setPhase('title');
    this.syncObstaclesAndPrey(0);
    this.syncSnakeMeshes(0);
    this.snapCameraForPhase('title');
  }

  public toggleCameraMode(): CameraMode {
    this.sound.playUiClick();
    this.engine.cameraMode = this.engine.cameraMode === 'chase' ? 'canopy' : 'chase';
    if (this.engine.phase === 'playing' || this.engine.phase === 'paused') {
      snapOrbitCamera(
        this.orbitCam,
        this.engine.heading,
        this.engine.cameraMode,
        this.engine.headX,
        this.engine.headY,
        this.engine.headZ,
        this.engine.snakeScale,
        this.baseFov,
        true,
      );
      this.camera.position.set(this.orbitCam.posX, this.orbitCam.posY, this.orbitCam.posZ);
      this.camera.lookAt(this.orbitCam.lookX, this.orbitCam.lookY, this.orbitCam.lookZ);
      this.camera.fov = this.orbitCam.fov;
      this.camera.updateProjectionMatrix();
    }
    this.emitHudSnapshot();
    return this.engine.cameraMode;
  }

  public toggleMute(): boolean {
    this.engine.muted = !this.engine.muted;
    this.sound.setMuted(this.engine.muted);
    if (!this.engine.muted) this.sound.playUiClick();
    this.emitHudSnapshot();
    return this.engine.muted;
  }

  public layEgg(): boolean {
    const laid = this.engine.layEgg();
    if (laid) {
      this.emitHudSnapshot();
    }
    return laid;
  }

  public triggerPrimaryPower(): boolean {
    const used = this.engine.triggerPrimaryPower();
    if (used) {
      this.emitHudSnapshot();
    }
    return used;
  }

  public triggerTailGrab(): boolean {
    const latched = this.engine.triggerTailGrab();
    this.emitHudSnapshot();
    return latched;
  }

  public triggerBiteAction(): boolean {
    const ok = this.engine.triggerBiteAction();
    this.emitHudSnapshot();
    return ok;
  }

  public triggerSecondaryPower(): boolean {
    const used = this.engine.triggerSecondaryPower();
    if (used) {
      this.emitHudSnapshot();
    }
    return used;
  }

  public setSpecies(species: SnakeSpecies): void {
    if (this.engine.species === species) return;
    this.sound.playUiClick();
    this.engine.species = species;
    this.speciesMorph = getSpeciesMorph(species);

    this.scaleTextures.map.dispose();
    this.scaleTextures.normalMap.dispose();
    this.scaleTextures.roughnessMap?.dispose();
    this.headTextures.map.dispose();
    this.headTextures.normalMap.dispose();
    this.headTextures.roughnessMap?.dispose();
    this.eyeTexture.dispose();

    const maxAniso = this.isSoftwareGl
      ? 1
      : Math.min(this.qualityConfig.maxAnisotropyCap, this.renderer.capabilities.getMaxAnisotropy());
    const lowHeroTex = this.qualityConfig.lowHeroTextures;
    this.scaleTextures = createSnakeScaleTextures(species, maxAniso, lowHeroTex);
    this.scaleMaterial.map = this.scaleTextures.map;
    this.scaleMaterial.normalMap = this.scaleTextures.normalMap;
    this.scaleMaterial.normalScale.set(this.speciesMorph.normalScale, this.speciesMorph.normalScale);
    this.scaleMaterial.roughnessMap = this.scaleTextures.roughnessMap ?? null;
    this.scaleMaterial.roughness = lowHeroTex
      ? Math.max(0.32, this.speciesMorph.roughness - 0.12)
      : this.speciesMorph.roughness;
    if ('clearcoat' in this.scaleMaterial) {
      this.scaleMaterial.clearcoat = this.qualityConfig.heroClearcoat ? this.speciesMorph.clearcoat : 0;
      this.scaleMaterial.iridescence = this.qualityConfig.heroIridescence ? this.speciesMorph.iridescence : 0;
    }
    this.scaleMaterial.needsUpdate = true;

    this.headTextures = createSnakeHeadTextures(species, maxAniso, lowHeroTex);
    this.headMaterial.map = this.headTextures.map;
    this.headMaterial.normalMap = this.headTextures.normalMap;
    this.headMaterial.normalScale.set(this.speciesMorph.normalScale, this.speciesMorph.normalScale);
    this.headMaterial.roughnessMap = this.headTextures.roughnessMap ?? null;
    this.headMaterial.roughness = Math.max(0.3, this.speciesMorph.roughness - 0.04);
    if ('clearcoat' in this.headMaterial) {
      this.headMaterial.clearcoat = this.qualityConfig.heroClearcoat
        ? Math.min(0.75, this.speciesMorph.clearcoat + 0.05)
        : 0;
      this.headMaterial.iridescence = this.qualityConfig.heroIridescence ? this.speciesMorph.iridescence : 0;
    }
    this.headMaterial.needsUpdate = true;

    this.eyeTexture = createReptileEyeTexture(
      getSpeciesEyeColor(species),
      this.speciesMorph.slitPupil,
    );
    this.headRig.eyeMaterial.map = this.eyeTexture;
    this.headRig.eyeMaterial.needsUpdate = true;
    for (const rig of this.hatchlingRigs.values()) {
      rig.headRig.eyeMaterial.map = this.eyeTexture;
      rig.headRig.eyeMaterial.needsUpdate = true;
    }

    const sc = this.engine.snakeScale;
    this.headRig.root.scale.set(
      this.speciesMorph.headWidth * sc,
      this.speciesMorph.headHeight * sc,
      this.speciesMorph.headLength * sc,
    );
    this.bellyMaterial.color.set(getSpeciesBellyColor(species));
    this.headRig.cobraHood.visible = false;
    this.rattleMesh.visible = this.speciesMorph.hasRattle;
    this.applyGraphicsQuality(this.currentQuality);
    this.syncSnakeMeshes(this.engine.elapsedSeconds);
    this.emitHudSnapshot();
  }

  public getCameraAngles(): { yaw: number; pitch: number; zoomScale: number; isDragging: boolean } {
    return {
      yaw: this.orbitCam.yaw,
      pitch: this.orbitCam.pitch,
      zoomScale: this.orbitCam.zoomScale,
      isDragging: this.orbitCam.isDragging,
    };
  }

  public setTouchSteer(steerAxis: number, boost: boolean): void {
    this.input.steerAxis = steerAxis;
    this.input.boost = boost;
  }

  public setJoystickInput(joyX: number, joyY: number, boost: boolean, autoRun = false): void {
    const mag = Math.hypot(joyX, joyY);
    const active = mag > 0.14;
    this.rawJoyX = active ? joyX : 0;
    this.rawJoyY = active ? joyY : 0;
    this.autoRunActive = autoRun;
    this.input.steerAxis = active ? joyX : 0;
    this.input.moveThrottle = active ? Math.min(1, mag) : 0;
    this.input.joyX = active ? joyX : 0;
    this.input.joyY = active ? -joyY : 0;
    this.input.boost = boost;
  }

  private resetInput(): void {
    this.input.left = false;
    this.input.right = false;
    this.input.up = false;
    this.input.down = false;
    this.input.boost = false;
    this.input.steerAxis = 0;
    this.input.moveThrottle = 0;
    this.input.joyX = 0;
    this.input.joyY = 0;
    this.rawJoyX = 0;
    this.rawJoyY = 0;
    this.endLookDrag();
  }

  private syncInputFromKeys(): void {
    this.input.left = this.keysHeld.has('ArrowLeft') || this.keysHeld.has('KeyA');
    this.input.right = this.keysHeld.has('ArrowRight') || this.keysHeld.has('KeyD');
    this.input.up = this.keysHeld.has('ArrowUp') || this.keysHeld.has('KeyW');
    this.input.down = this.keysHeld.has('ArrowDown') || this.keysHeld.has('KeyS');
    this.input.boost = this.keysHeld.has('Space') || this.keysHeld.has('ShiftLeft') || this.keysHeld.has('ShiftRight');
  }

  private handleCanvasPointerDown = (e: PointerEvent): void => {
    if (this.engine.phase !== 'playing') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.lookPointerId !== null) return;
    this.lookPointerId = e.pointerId;
    this.lookLastX = e.clientX;
    this.lookLastY = e.clientY;
    this.orbitCam.isDragging = true;
  };

  private handleWindowPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.lookPointerId) return;
    if (this.engine.phase !== 'playing') {
      this.endLookDrag();
      return;
    }
    if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) {
      this.endLookDrag();
      return;
    }
    const dx = e.clientX - this.lookLastX;
    const dy = e.clientY - this.lookLastY;
    this.lookLastX = e.clientX;
    this.lookLastY = e.clientY;
    if (dx !== 0 || dy !== 0) {
      applyScreenDrag(
        this.orbitCam,
        dx,
        dy,
        this.engine.turnSensitivity,
        this.engine.cameraMode,
      );
    }
  };

  private handleWindowPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.lookPointerId) return;
    this.endLookDrag();
  };

  private endLookDrag(): void {
    this.lookPointerId = null;
    if (this.orbitCam) {
      this.orbitCam.isDragging = false;
    }
  }

  private handleCanvasWheel = (e: WheelEvent): void => {
    if (this.engine.phase !== 'playing') return;
    e.preventDefault();
    applyZoomWheel(this.orbitCam, e.deltaY);
  };

  private handleContextMenu = (e: MouseEvent): void => {
    if (this.engine.phase === 'playing') {
      e.preventDefault();
      this.triggerTailGrab();
    }
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    const code = e.code;
    if (
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight' ||
      code === 'Space'
    ) {
      e.preventDefault();
    }

    if (e.repeat) return;

    if (this.engine.phase === 'title') {
      if (code === 'Enter' || code === 'Space') {
        this.startNewGame();
        return;
      }
    } else if (this.engine.phase === 'gameover') {
      if (code === 'Enter' || code === 'Space' || code === 'KeyR') {
        this.startNewGame();
        return;
      }
    }

    if (code === 'Escape' || code === 'KeyP') {
      if (this.engine.phase === 'playing' || this.engine.phase === 'paused') {
        this.togglePause();
        return;
      }
    }

    if (code === 'KeyC') {
      this.toggleCameraMode();
      return;
    }

    if (code === 'KeyM') {
      this.toggleMute();
      return;
    }

    if (code === 'KeyE' && this.engine.phase === 'playing') {
      this.layEgg();
      return;
    }

    if (code === 'KeyQ' && this.engine.phase === 'playing') {
      this.triggerPrimaryPower();
      return;
    }

    if (code === 'KeyF' && this.engine.phase === 'playing') {
      this.triggerTailGrab();
      return;
    }

    if (code === 'KeyG' && this.engine.phase === 'playing') {
      this.triggerBiteAction();
      return;
    }

    if (code === 'KeyV' && this.engine.phase === 'playing') {
      this.triggerSecondaryPower();
      return;
    }

    if (code === 'KeyR' && (this.engine.phase === 'playing' || this.engine.phase === 'paused')) {
      this.startNewGame();
      return;
    }

    this.keysHeld.add(code);
    this.syncInputFromKeys();
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.keysHeld.delete(e.code);
    this.syncInputFromKeys();
  };

  private handleWindowBlur = (): void => {
    this.keysHeld.clear();
    this.resetInput();
  };

  private handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.keysHeld.clear();
      this.resetInput();
    }
  };

  private handleResize(): void {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.renderer.render(this.scene, this.camera);
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.resizeObserver.disconnect();
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleWindowBlur);
    window.removeEventListener('pointermove', this.handleWindowPointerMove);
    window.removeEventListener('pointerup', this.handleWindowPointerUp);
    window.removeEventListener('pointercancel', this.handleWindowPointerUp);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.renderer.domElement.removeEventListener('contextmenu', this.handleContextMenu);
    this.renderer.domElement.removeEventListener('pointerdown', this.handleCanvasPointerDown);
    this.renderer.domElement.removeEventListener('wheel', this.handleCanvasWheel);

    this.scaleTextures.map.dispose();
    this.scaleTextures.normalMap.dispose();
    this.scaleTextures.roughnessMap?.dispose();
    this.headTextures.map.dispose();
    this.headTextures.normalMap.dispose();
    this.headTextures.roughnessMap?.dispose();
    this.eyeTexture.dispose();
    this.preyPool.clear();
    this.boltPool.clear();
    for (const rig of this.hatchlingRigs.values()) {
      rig.body.dispose();
    }
    this.hatchlingRigs.clear();
    for (const d of this.disposables) {
      d.dispose();
    }
    disposeSharedRigAssets();
    this.sound.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
