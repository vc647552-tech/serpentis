import { SegmentPose, SpinePoint } from '../game/types';

export interface SnakeCoreWasmExports {
  memory: WebAssembly.Memory;
  wasm_init: (seed: number) => void;
  wasm_reset_world: (isTitleDemo: number) => void;
  wasm_start_game: () => void;
  wasm_set_phase: (nextPhase: number) => void;
  wasm_toggle_pause: () => void;
  wasm_can_lay_egg: () => number;
  wasm_lay_egg: () => number;
  wasm_trigger_primary_power: () => number;
  wasm_trigger_tail_grab: () => number;
  wasm_trigger_bite_action: () => number;
  wasm_trigger_secondary_power: () => number;
  wasm_step_title_demo: (dt: number) => void;
  wasm_step_game: (
    dt: number,
    left: number,
    right: number,
    up: number,
    down: number,
    boost: number,
    steerAxis: number,
    moveThrottle: number,
    joyX: number,
    joyY: number,
  ) => void;
  wasm_damage_snake: (amount: number, sx: number, sy: number, sz: number) => void;
  wasm_compute_segment_poses: () => void;
  wasm_recompute_hatchling_poses: (hIdx: number) => void;
  wasm_spawn_prey: (
    hasKind: number,
    kind: number,
    hasPos: number,
    x: number,
    z: number,
    hasY: number,
    y: number,
  ) => void;
  wasm_spawn_villager: (
    role: number,
    x: number,
    z: number,
    tier: number,
    isElite: number,
    homeVillageId: number,
  ) => number;
  wasm_spawn_hatchling: (x: number, y: number, z: number) => number;
  wasm_clear_events: () => void;

  wasm_get_scalars_ptr: () => number;
  wasm_get_counts_ptr: () => number;
  wasm_get_prey_ptr: () => number;
  wasm_get_villagers_ptr: () => number;
  wasm_get_eggs_ptr: () => number;
  wasm_get_hatchlings_ptr: () => number;
  wasm_get_hatchling_poses_ptr: (hIdx: number) => number;
  wasm_get_hatchling_spines_ptr: (hIdx: number) => number;
  wasm_get_projectiles_ptr: () => number;
  wasm_get_obstacles_ptr: () => number;
  wasm_get_trees_ptr: () => number;
  wasm_get_events_ptr: () => number;
  wasm_get_player_spine_ptr: () => number;
  wasm_get_player_spine_head_idx: () => number;
  wasm_get_player_poses_ptr: () => number;

  wasm_get_pose_in_ptr: () => number;
  wasm_get_spine_in_ptr: () => number;
  wasm_get_pos_out_ptr: () => number;
  wasm_get_norm_out_ptr: () => number;
  wasm_get_scratch_ptr: () => number;

  wasm_get_shadow_mats_ptr: () => number;
  wasm_get_particle_mats_ptr: () => number;
  wasm_get_particle_colors_ptr: () => number;
  wasm_get_cam_state_ptr: () => number;
  wasm_get_terrain_out_ptr: () => number;
  wasm_get_pixel_buf_ptr: () => number;
  wasm_get_pixel_out_ptr: () => number;

  wasm_ground_height: (x: number, z: number) => number;
  wasm_surface_height_at: (x: number, z: number, currentY: number) => number;
  wasm_get_building_at_position: (x: number, z: number, y: number) => void;
  wasm_resolve_building_wall_collision: (x: number, y: number, z: number, radius: number) => number;
  wasm_resolve_world_walls_collision: (x: number, y: number, z: number, radius: number) => number;
  wasm_is_point_near_building: (x: number, z: number, padding: number) => number;
  wasm_sample_spine_at_distance: (spineLen: number, headTotalDist: number, distBehind: number) => void;

  wasm_deform_snake_body: (
    headX: number,
    headY: number,
    headZ: number,
    heading: number,
    headPitch: number,
    poseCount: number,
    rings: number,
    radial: number,
    elapsed: number,
    headWidth: number,
    headHeight: number,
    bodyWidth: number,
    bodyHeight: number,
    hoodStrength: number,
    segSpacing: number,
    headRadius: number,
  ) => void;
  wasm_deform_player_body: (
    headY: number,
    headPitch: number,
    rings: number,
    radial: number,
    elapsed: number,
    headWidth: number,
    headHeight: number,
    bodyWidth: number,
    bodyHeight: number,
    hoodStrength: number,
  ) => void;
  wasm_deform_hatchling_body: (
    hIdx: number,
    headY: number,
    rings: number,
    radial: number,
    elapsed: number,
    headWidth: number,
    headHeight: number,
    bodyWidth: number,
    bodyHeight: number,
    hoodStrength: number,
    segSpacing: number,
  ) => void;

  wasm_write_snake_shadow_mats: (segCount: number) => void;
  wasm_spawn_particle_burst: (
    x: number,
    y: number,
    z: number,
    hexColor: number,
    count: number,
    speedScale: number,
  ) => void;
  wasm_step_particles: (dt: number) => number;
  wasm_snap_camera: (phase: number, baseFov: number) => void;
  wasm_step_camera: (dt: number, elapsed: number, baseFov: number, traumaAdd: number) => void;
  wasm_fill_terrain_heights: (segs: number, worldSize: number) => void;
  wasm_sobel_height_to_normal: (w: number, h: number, strength: number) => void;
}

export const SCALAR_I32 = {
  phase: 0,
  cameraMode: 1,
  species: 2,
  difficulty: 3,
  muted: 4,
  isBoosting: 5,
  kills: 6,
  segmentCount: 7,
  combo: 8,
  deathReason: 9,
  nearPrey: 10,
  hunterAlert: 11,
  threatLevel: 12,
  activeBuildingId: 13,
  hideActiveRoof: 14,
  isIndoors: 15,
  locZoneType: 16,
  locZoneIdx: 17,
  locBuildingIdx: 18,
  totalHatched: 19,
  nextId: 20,
  spineLen: 21,
  obstaclesVersion: 22,
  maxHp: 23,
  grabTargetId: 46,
  grabStage: 47,
  powerPulseKind: 48,
  feastCount: 64,
  powerTier: 65,
  rivalClashActive: 66,
  activeVillageId: 67,
} as const;

export const SCALAR_F32 = {
  headX: 24,
  headY: 25,
  headZ: 26,
  headVelY: 27,
  heading: 28,
  totalDist: 29,
  speed: 30,
  stamina: 31,
  hp: 32,
  invulnTimer: 33,
  outOfCombatTimer: 34,
  score: 35,
  bestScore: 36,
  comboTimer: 37,
  elapsedSeconds: 38,
  mouthOpen: 39,
  tongueTimer: 40,
  raidHeat: 41,
  eggCooldown: 42,
  turnSensitivity: 43,
  lastHazardScoreMilestone: 44,
  villagerReinforceTimer: 45,
  powerCooldown: 49,
  powerMaxCooldown: 50,
  tailGrabCooldown: 51,
  tailGrabMaxCooldown: 52,
  grabTimer: 53,
  grabWhipTimer: 54,
  grabOriginX: 55,
  grabOriginY: 56,
  grabOriginZ: 57,
  stealthTimer: 58,
  powerPulseTimer: 59,
  powerPulseX: 60,
  powerPulseY: 61,
  powerPulseZ: 62,
  padEnd: 63,
  snakeScale: 68,
  secondaryCooldown: 69,
  secondaryMaxCooldown: 70,
  swallowBulgeT: 71,
} as const;

class SnakeCoreWasmBridge {
  private exports: SnakeCoreWasmExports | null = null;
  private loadingPromise: Promise<boolean> | null = null;
  private bufRef: ArrayBuffer | null = null;

  public scalarsI32!: Int32Array;
  public scalarsF32!: Float32Array;
  public countsI32!: Int32Array;
  public preyI32!: Int32Array;
  public preyF32!: Float32Array;
  public villagersI32!: Int32Array;
  public villagersF32!: Float32Array;
  public eggsI32!: Int32Array;
  public eggsF32!: Float32Array;
  public hatchlingsI32!: Int32Array;
  public hatchlingsF32!: Float32Array;
  public projectilesI32!: Int32Array;
  public projectilesF32!: Float32Array;
  public obstaclesI32!: Int32Array;
  public obstaclesF32!: Float32Array;
  public treesI32!: Int32Array;
  public treesF32!: Float32Array;
  public eventsI32!: Int32Array;
  public eventsF32!: Float32Array;
  public playerPosesF32!: Float32Array;
  public playerSpineF32!: Float32Array;

  public poseInView!: Float32Array;
  public spineInView!: Float32Array;
  public posOutView!: Float32Array;
  public normOutView!: Float32Array;
  public scratchView!: Float32Array;

  public shadowMatsView!: Float32Array;
  public particleMatsView!: Float32Array;
  public particleColorsView!: Float32Array;
  public camStateView!: Float32Array;
  public terrainOutView!: Float32Array;
  public pixelBufView!: Uint8Array;
  public pixelOutView!: Uint8Array;

  private hatchPoseCache: Array<Float32Array | null> = new Array(8).fill(null);
  private hatchSpineCache: Array<Float32Array | null> = new Array(8).fill(null);

  public isReady(): boolean {
    return this.exports !== null;
  }

  public getExports(): SnakeCoreWasmExports {
    this.ensureReady();
    this.bindMemoryViews();
    return this.exports!;
  }

  public ensureReady(): void {
    if (this.exports) return;
    // Synchronous autoload in Node.js (unit tests / SSR tools)
    const proc = (globalThis as { process?: { getBuiltinModule?: (m: string) => unknown } }).process;
    if (proc && typeof proc.getBuiltinModule === 'function') {
      const fs = proc.getBuiltinModule('node:fs') as { readFileSync: (p: string) => Uint8Array } | undefined;
      const pathMod = proc.getBuiltinModule('node:path') as { resolve: (...p: string[]) => string } | undefined;
      if (fs && pathMod) {
        const wasmPath = pathMod.resolve(process.cwd(), 'public/snake_core.wasm');
        const bytes = fs.readFileSync(wasmPath);
        this.initFromBytes(bytes);
        this.exports!.wasm_init(2026);
        return;
      }
    }
    throw new Error('snake_core.wasm is not loaded yet. Call await snakeCoreWasm.preload() first.');
  }

  public bindMemoryViews(): void {
    if (!this.exports) return;
    const buf = this.exports.memory.buffer;
    if (buf === this.bufRef) return;
    this.bufRef = buf;
    this.hatchPoseCache.fill(null);
    this.hatchSpineCache.fill(null);

    const e = this.exports;
    const sPtr = e.wasm_get_scalars_ptr();
    this.scalarsI32 = new Int32Array(buf, sPtr, 72);
    this.scalarsF32 = new Float32Array(buf, sPtr, 72);
    this.countsI32 = new Int32Array(buf, e.wasm_get_counts_ptr(), 8);

    const pPtr = e.wasm_get_prey_ptr();
    this.preyI32 = new Int32Array(buf, pPtr, 72 * 16);
    this.preyF32 = new Float32Array(buf, pPtr, 72 * 16);

    const vPtr = e.wasm_get_villagers_ptr();
    this.villagersI32 = new Int32Array(buf, vPtr, 72 * 36);
    this.villagersF32 = new Float32Array(buf, vPtr, 72 * 36);

    const egPtr = e.wasm_get_eggs_ptr();
    this.eggsI32 = new Int32Array(buf, egPtr, 8 * 8);
    this.eggsF32 = new Float32Array(buf, egPtr, 8 * 8);

    const hPtr = e.wasm_get_hatchlings_ptr();
    this.hatchlingsI32 = new Int32Array(buf, hPtr, 8 * 16);
    this.hatchlingsF32 = new Float32Array(buf, hPtr, 8 * 16);

    const prPtr = e.wasm_get_projectiles_ptr();
    this.projectilesI32 = new Int32Array(buf, prPtr, 96 * 16);
    this.projectilesF32 = new Float32Array(buf, prPtr, 96 * 16);

    const obPtr = e.wasm_get_obstacles_ptr();
    this.obstaclesI32 = new Int32Array(buf, obPtr, 112 * 8);
    this.obstaclesF32 = new Float32Array(buf, obPtr, 112 * 8);

    const trPtr = e.wasm_get_trees_ptr();
    this.treesI32 = new Int32Array(buf, trPtr, 320 * 8);
    this.treesF32 = new Float32Array(buf, trPtr, 320 * 8);

    const evPtr = e.wasm_get_events_ptr();
    this.eventsI32 = new Int32Array(buf, evPtr, 128 * 12);
    this.eventsF32 = new Float32Array(buf, evPtr, 128 * 12);

    this.playerPosesF32 = new Float32Array(buf, e.wasm_get_player_poses_ptr(), 256 * 5);
    this.playerSpineF32 = new Float32Array(buf, e.wasm_get_player_spine_ptr(), 2048 * 4);

    this.poseInView = new Float32Array(buf, e.wasm_get_pose_in_ptr(), 256 * 5);
    this.spineInView = new Float32Array(buf, e.wasm_get_spine_in_ptr(), 2048 * 4);
    this.posOutView = new Float32Array(buf, e.wasm_get_pos_out_ptr(), 4096 * 3);
    this.normOutView = new Float32Array(buf, e.wasm_get_norm_out_ptr(), 4096 * 3);
    this.scratchView = new Float32Array(buf, e.wasm_get_scratch_ptr(), 16);

    this.shadowMatsView = new Float32Array(buf, e.wasm_get_shadow_mats_ptr(), 160 * 16);
    this.particleMatsView = new Float32Array(buf, e.wasm_get_particle_mats_ptr(), 96 * 16);
    this.particleColorsView = new Float32Array(buf, e.wasm_get_particle_colors_ptr(), 96 * 3);
    this.camStateView = new Float32Array(buf, e.wasm_get_cam_state_ptr(), 16);
    this.terrainOutView = new Float32Array(buf, e.wasm_get_terrain_out_ptr(), 128 * 128);
    this.pixelBufView = new Uint8Array(buf, e.wasm_get_pixel_buf_ptr(), 512 * 512 * 4);
    this.pixelOutView = new Uint8Array(buf, e.wasm_get_pixel_out_ptr(), 512 * 512 * 4);
  }

  public initFromBytes(bytes: Uint8Array | ArrayBuffer): boolean {
    const mod = new WebAssembly.Module(bytes as BufferSource);
    const inst = new WebAssembly.Instance(mod, {});
    this.exports = inst.exports as unknown as SnakeCoreWasmExports;
    this.bufRef = null;
    this.bindMemoryViews();
    this.exports.wasm_init(2026);
    return true;
  }

  public async preload(): Promise<boolean> {
    if (this.exports) return true;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = (async () => {
      try {
        if (typeof fetch === 'undefined') {
          this.ensureReady();
          return true;
        }
        const resp = await fetch('/snake_core.wasm');
        if (!resp.ok) return false;
        let inst: WebAssembly.Instance;
        if (typeof WebAssembly.instantiateStreaming === 'function') {
          try {
            const res = await WebAssembly.instantiateStreaming(resp.clone(), {});
            inst = res.instance;
          } catch {
            const bytes = await resp.arrayBuffer();
            inst = (await WebAssembly.instantiate(bytes, {})).instance;
          }
        } else {
          const bytes = await resp.arrayBuffer();
          inst = (await WebAssembly.instantiate(bytes, {})).instance;
        }
        this.exports = inst.exports as unknown as SnakeCoreWasmExports;
        this.bufRef = null;
        this.bindMemoryViews();
        this.exports.wasm_init(2026);
        return true;
      } catch {
        return false;
      }
    })();

    return this.loadingPromise;
  }

  public getHatchlingPoseView(hIdx: number): Float32Array {
    const e = this.getExports();
    if (hIdx >= 0 && hIdx < 8) {
      let cached = this.hatchPoseCache[hIdx];
      if (!cached || cached.buffer !== this.bufRef) {
        cached = new Float32Array(this.bufRef!, e.wasm_get_hatchling_poses_ptr(hIdx), 32 * 5);
        this.hatchPoseCache[hIdx] = cached;
      }
      return cached;
    }
    return new Float32Array(this.bufRef!, e.wasm_get_hatchling_poses_ptr(hIdx), 32 * 5);
  }

  public getHatchlingSpineView(hIdx: number): Float32Array {
    const e = this.getExports();
    if (hIdx >= 0 && hIdx < 8) {
      let cached = this.hatchSpineCache[hIdx];
      if (!cached || cached.buffer !== this.bufRef) {
        cached = new Float32Array(this.bufRef!, e.wasm_get_hatchling_spines_ptr(hIdx), 64 * 4);
        this.hatchSpineCache[hIdx] = cached;
      }
      return cached;
    }
    return new Float32Array(this.bufRef!, e.wasm_get_hatchling_spines_ptr(hIdx), 64 * 4);
  }

  public groundHeight(x: number, z: number): number {
    return this.getExports().wasm_ground_height(x, z);
  }

  public surfaceHeight(x: number, z: number, currentY: number): number {
    return this.getExports().wasm_surface_height_at(x, z, currentY);
  }

  public sampleSpineAtDistance(
    spine: readonly SpinePoint[],
    headTotalDist: number,
    distBehind: number,
  ): { x: number; y: number; z: number; yaw: number } {
    const e = this.getExports();
    const sLen = Math.min(spine.length, 2048);
    const sv = this.spineInView;
    for (let i = 0; i < sLen; i++) {
      const sp = spine[i];
      const off = i * 4;
      sv[off] = sp.x;
      sv[off + 1] = sp.y;
      sv[off + 2] = sp.z;
      sv[off + 3] = sp.dist;
    }
    e.wasm_sample_spine_at_distance(sLen, headTotalDist, distBehind);
    const sc = this.scratchView;
    return { x: sc[0], y: sc[1], z: sc[2], yaw: sc[3] };
  }

  public deformPlayerBody(
    headY: number,
    headPitch: number,
    rings: number,
    radial: number,
    elapsed: number,
    headWidth: number,
    headHeight: number,
    bodyWidth: number,
    bodyHeight: number,
    hoodStrength: number,
    outPosArray: Float32Array,
    outNormArray: Float32Array,
    outTailTip: { x: number; y: number; z: number; yaw: number },
  ): boolean {
    const e = this.getExports();
    const segs = this.scalarsI32[SCALAR_I32.segmentCount];
    if (segs < 3) return false;
    e.wasm_deform_player_body(
      headY,
      headPitch,
      rings,
      radial,
      elapsed,
      headWidth,
      headHeight,
      bodyWidth,
      bodyHeight,
      hoodStrength,
    );
    const floatCount = (rings + 1) * (radial + 1) * 3;
    outPosArray.set(this.posOutView.subarray(0, floatCount));
    outNormArray.set(this.normOutView.subarray(0, floatCount));
    const sc = this.scratchView;
    outTailTip.x = sc[0];
    outTailTip.y = sc[1];
    outTailTip.z = sc[2];
    outTailTip.yaw = sc[3];
    return true;
  }

  public deformHatchlingBody(
    hIdx: number,
    headY: number,
    rings: number,
    radial: number,
    elapsed: number,
    headWidth: number,
    headHeight: number,
    bodyWidth: number,
    bodyHeight: number,
    hoodStrength: number,
    segSpacing: number,
    outPosArray: Float32Array,
    outNormArray: Float32Array,
    outTailTip: { x: number; y: number; z: number; yaw: number },
  ): boolean {
    const e = this.getExports();
    const poseCount = this.hatchlingsI32[hIdx * 16 + 4];
    if (poseCount < 3) return false;
    e.wasm_deform_hatchling_body(
      hIdx,
      headY,
      rings,
      radial,
      elapsed,
      headWidth,
      headHeight,
      bodyWidth,
      bodyHeight,
      hoodStrength,
      segSpacing,
    );
    const floatCount = (rings + 1) * (radial + 1) * 3;
    outPosArray.set(this.posOutView.subarray(0, floatCount));
    outNormArray.set(this.normOutView.subarray(0, floatCount));
    const sc = this.scratchView;
    outTailTip.x = sc[0];
    outTailTip.y = sc[1];
    outTailTip.z = sc[2];
    outTailTip.yaw = sc[3];
    return true;
  }

  public deformSnakeBody(
    headX: number,
    headY: number,
    headZ: number,
    heading: number,
    headPitch: number,
    poses: readonly SegmentPose[],
    count: number,
    rings: number,
    radial: number,
    elapsed: number,
    headWidth: number,
    headHeight: number,
    bodyWidth: number,
    bodyHeight: number,
    hoodStrength: number,
    segSpacing: number,
    headRadius: number,
    outPosArray: Float32Array,
    outNormArray: Float32Array,
    outTailTip: { x: number; y: number; z: number; yaw: number },
  ): boolean {
    if (count < 3) return false;
    const e = this.getExports();
    const pv = this.poseInView;
    const pLen = Math.min(count, 256);
    for (let i = 0; i < pLen; i++) {
      const p = poses[i];
      const off = i * 5;
      pv[off] = p.x;
      pv[off + 1] = p.y;
      pv[off + 2] = p.z;
      pv[off + 4] = p.radius;
    }

    e.wasm_deform_snake_body(
      headX,
      headY,
      headZ,
      heading,
      headPitch,
      pLen,
      rings,
      radial,
      elapsed,
      headWidth,
      headHeight,
      bodyWidth,
      bodyHeight,
      hoodStrength,
      segSpacing,
      headRadius,
    );

    const floatCount = (rings + 1) * (radial + 1) * 3;
    outPosArray.set(this.posOutView.subarray(0, floatCount));
    outNormArray.set(this.normOutView.subarray(0, floatCount));

    const sc = this.scratchView;
    outTailTip.x = sc[0];
    outTailTip.y = sc[1];
    outTailTip.z = sc[2];
    outTailTip.yaw = sc[3];
    return true;
  }

  public sobelHeightToNormal(srcRgba: Uint8ClampedArray, w: number, h: number, strength: number, dstRgba: Uint8ClampedArray): void {
    const e = this.getExports();
    const byteLen = w * h * 4;
    if (w * h > 512 * 512) return;
    this.pixelBufView.set(srcRgba.subarray(0, byteLen));
    e.wasm_sobel_height_to_normal(w, h, strength);
    dstRgba.set(this.pixelOutView.subarray(0, byteLen));
  }
}

export const snakeCoreWasm = new SnakeCoreWasmBridge();
