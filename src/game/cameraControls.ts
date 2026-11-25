import { CameraMode, InputState } from './types';

export const DEFAULT_CHASE_PITCH = 0.62;
export const DEFAULT_CANOPY_PITCH = 0.96;
export const MIN_CHASE_PITCH = 0.14;
export const MAX_CHASE_PITCH = 1.18;
export const MIN_CANOPY_PITCH = 0.55;
export const MAX_CANOPY_PITCH = 1.32;
export const MANUAL_HOLD_DURATION = 2.0;

export const YAW_SENSITIVITY_RAD_PER_PX = 0.0052;
export const PITCH_SENSITIVITY_RAD_PER_PX = 0.0042;

export interface OrbitCameraState {
  yaw: number;
  pitch: number;
  zoomScale: number;
  posX: number;
  posY: number;
  posZ: number;
  lookX: number;
  lookY: number;
  lookZ: number;
  fov: number;
  trauma: number;
  isDragging: boolean;
  manualHoldTimer: number;
}

export interface CameraRelativeMove {
  active: boolean;
  desiredHeading: number;
  throttle: number;
  localForward: number;
  localRight: number;
}

export function normalizeAngleRad(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function clampVal(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function computeDesiredCameraTransform(
  yaw: number,
  pitch: number,
  zoomScale: number,
  cameraMode: CameraMode,
  headX: number,
  headY: number,
  headZ: number,
  snakeScale: number,
  isIndoors: boolean,
  isBoosting: boolean,
  baseFov: number,
): {
  tx: number;
  ty: number;
  tz: number;
  lx: number;
  ly: number;
  lz: number;
  targetFov: number;
} {
  const dirX = Math.sin(yaw);
  const dirZ = Math.cos(yaw);

  if (cameraMode === 'canopy') {
    const cPitch = clampVal(pitch, MIN_CANOPY_PITCH, MAX_CANOPY_PITCH);
    const orbitDist = 41.5 * zoomScale;
    const horizDist = Math.cos(cPitch) * orbitDist;
    const vertDist = Math.sin(cPitch) * orbitDist;
    return {
      tx: headX - dirX * horizDist,
      ty: headY + vertDist,
      tz: headZ - dirZ * horizDist,
      lx: headX + dirX * 4.0,
      ly: headY + 0.5,
      lz: headZ + dirZ * 4.0,
      targetFov: Math.max(46, baseFov - 4),
    };
  }

  const camZoom = (0.60 + snakeScale * 0.38) * zoomScale;
  const orbitDist = (isIndoors ? 6.2 : isBoosting ? 7.8 : 6.9) * camZoom;
  const clampedPitch = clampVal(pitch, MIN_CHASE_PITCH, MAX_CHASE_PITCH);
  const horizDist = Math.cos(clampedPitch) * orbitDist;
  const vertDist = Math.sin(clampedPitch) * orbitDist;
  const anchorY = headY + 0.42 * snakeScale;
  const lookAhead = isIndoors ? 1.9 : 2.15;
  const pitchLookBias = Math.sin(clampedPitch - DEFAULT_CHASE_PITCH) * 1.45;

  return {
    tx: headX - dirX * horizDist,
    ty: anchorY + vertDist,
    tz: headZ - dirZ * horizDist,
    lx: headX + dirX * lookAhead,
    ly: anchorY + 0.22 - pitchLookBias,
    lz: headZ + dirZ * lookAhead,
    targetFov: isBoosting ? baseFov + 7.0 : baseFov,
  };
}

export function createInitialCameraState(
  heading: number,
  baseFov: number,
  cameraMode: CameraMode,
  headX: number,
  headY: number,
  headZ: number,
  snakeScale: number,
): OrbitCameraState {
  const pitch = cameraMode === 'canopy' ? DEFAULT_CANOPY_PITCH : DEFAULT_CHASE_PITCH;
  const t = computeDesiredCameraTransform(
    heading,
    pitch,
    1.0,
    cameraMode,
    headX,
    headY,
    headZ,
    snakeScale,
    false,
    false,
    baseFov,
  );
  return {
    yaw: normalizeAngleRad(heading),
    pitch,
    zoomScale: 1.0,
    posX: t.tx,
    posY: t.ty,
    posZ: t.tz,
    lookX: t.lx,
    lookY: t.ly,
    lookZ: t.lz,
    fov: t.targetFov,
    trauma: 0,
    isDragging: false,
    manualHoldTimer: 0,
  };
}

export function snapOrbitCamera(
  state: OrbitCameraState,
  heading: number,
  cameraMode: CameraMode,
  headX: number,
  headY: number,
  headZ: number,
  snakeScale: number,
  baseFov: number,
  preserveYaw = false,
): void {
  if (!preserveYaw) {
    state.yaw = normalizeAngleRad(heading);
  }
  state.pitch = cameraMode === 'canopy' ? DEFAULT_CANOPY_PITCH : DEFAULT_CHASE_PITCH;
  state.manualHoldTimer = 0;
  state.isDragging = false;
  const t = computeDesiredCameraTransform(
    state.yaw,
    state.pitch,
    state.zoomScale,
    cameraMode,
    headX,
    headY,
    headZ,
    snakeScale,
    false,
    false,
    baseFov,
  );
  state.posX = t.tx;
  state.posY = t.ty;
  state.posZ = t.tz;
  state.lookX = t.lx;
  state.lookY = t.ly;
  state.lookZ = t.lz;
  state.fov = t.targetFov;
}

export function applyScreenDrag(
  state: OrbitCameraState,
  deltaX: number,
  deltaY: number,
  turnSensitivity: number,
  cameraMode: CameraMode,
): void {
  const sens = clampVal(turnSensitivity, 0.5, 2.0);
  // Dragging right (deltaX > 0) turns camera right (clockwise from above -> decreasing yaw)
  state.yaw = normalizeAngleRad(state.yaw - deltaX * YAW_SENSITIVITY_RAD_PER_PX * sens);
  if (cameraMode === 'canopy') {
    state.pitch = clampVal(
      state.pitch + deltaY * PITCH_SENSITIVITY_RAD_PER_PX * 0.7 * sens,
      MIN_CANOPY_PITCH,
      MAX_CANOPY_PITCH,
    );
  } else {
    state.pitch = clampVal(
      state.pitch + deltaY * PITCH_SENSITIVITY_RAD_PER_PX * sens,
      MIN_CHASE_PITCH,
      MAX_CHASE_PITCH,
    );
  }
  state.manualHoldTimer = MANUAL_HOLD_DURATION;
}

export function applyZoomWheel(state: OrbitCameraState, deltaY: number): void {
  state.zoomScale = clampVal(state.zoomScale + deltaY * 0.0008, 0.72, 1.65);
}

export function computeCameraRelativeMove(
  camYaw: number,
  input: Pick<InputState, 'left' | 'right' | 'up' | 'down'>,
  rawJoyX: number,
  rawJoyY: number,
  autoRun: boolean,
): CameraRelativeMove {
  const joyMag = Math.hypot(rawJoyX, rawJoyY);
  const joyActive = joyMag > 0.14;

  let localRight = joyActive ? rawJoyX : (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let localForward = joyActive ? rawJoyY : (input.up ? 1 : 0) - (input.down ? 1 : 0);
  let mag = joyActive ? Math.min(1, joyMag) : Math.hypot(localRight, localForward);

  if (mag <= 0.14 && autoRun) {
    localForward = 1;
    localRight = 0;
    mag = 1;
  }

  if (mag <= 0.14) {
    return {
      active: false,
      desiredHeading: camYaw,
      throttle: 0,
      localForward: 0,
      localRight: 0,
    };
  }

  const fwdX = Math.sin(camYaw);
  const fwdZ = Math.cos(camYaw);
  const rightX = -Math.cos(camYaw);
  const rightZ = Math.sin(camYaw);

  const worldX = fwdX * localForward + rightX * localRight;
  const worldZ = fwdZ * localForward + rightZ * localRight;
  const desiredHeading = Math.atan2(worldX, worldZ);

  return {
    active: true,
    desiredHeading,
    throttle: clampVal(mag, 0.28, 1.0),
    localForward,
    localRight,
  };
}

export function computeChaseSteerCommand(
  currentHeading: number,
  desiredHeading: number,
  effectiveTurnRate: number,
  dt: number,
): { steerAxis: number; snapHeading: number | null } {
  const diff = normalizeAngleRad(desiredHeading - currentHeading);
  const maxStepAngle = Math.max(1e-4, effectiveTurnRate * Math.max(dt, 0.001));
  const desiredSteer = diff / maxStepAngle;
  if (Math.abs(desiredSteer) <= 0.05) {
    return { steerAxis: 0, snapHeading: desiredHeading };
  }
  const clampedSteer = clampVal(desiredSteer, -1.3, 1.3);
  return { steerAxis: -clampedSteer, snapHeading: null };
}

export function stepOrbitCamera(
  state: OrbitCameraState,
  dt: number,
  cameraMode: CameraMode,
  headX: number,
  headY: number,
  headZ: number,
  snakeHeading: number,
  snakeScale: number,
  isIndoors: boolean,
  isBoosting: boolean,
  baseFov: number,
  move: CameraRelativeMove,
  groundHeightAt: (x: number, z: number) => number,
  traumaAdd = 0,
): {
  posX: number;
  posY: number;
  posZ: number;
  lookX: number;
  lookY: number;
  lookZ: number;
  fov: number;
} {
  if (traumaAdd > 0) {
    state.trauma = Math.min(1, state.trauma + traumaAdd);
  }

  if (!state.isDragging && state.manualHoldTimer > 0) {
    state.manualHoldTimer = Math.max(0, state.manualHoldTimer - dt);
  }

  // Gentle GTA V-style chase auto-follow ONLY when not manually looking around and moving forward
  if (
    cameraMode === 'chase' &&
    !state.isDragging &&
    state.manualHoldTimer <= 0 &&
    move.active &&
    move.localForward > 0.15
  ) {
    const diff = normalizeAngleRad(snakeHeading - state.yaw);
    const followSpeed = 1.75 * Math.min(1, move.localForward);
    state.yaw = normalizeAngleRad(state.yaw + diff * (1 - Math.exp(-followSpeed * dt)));
  }

  const desired = computeDesiredCameraTransform(
    state.yaw,
    state.pitch,
    state.zoomScale,
    cameraMode,
    headX,
    headY,
    headZ,
    snakeScale,
    isIndoors,
    isBoosting,
    baseFov,
  );

  // Snappier damping while actively dragging camera so swipe feels instant and responsive
  const posRate = state.isDragging || state.manualHoldTimer > 1.7 ? 20.0 : 8.5;
  const damp = 1 - Math.exp(-posRate * dt);
  state.posX += (desired.tx - state.posX) * damp;
  state.posY += (desired.ty - state.posY) * damp;
  state.posZ += (desired.tz - state.posZ) * damp;
  state.lookX += (desired.lx - state.lookX) * damp;
  state.lookY += (desired.ly - state.lookY) * damp;
  state.lookZ += (desired.lz - state.lookZ) * damp;

  const minGroundY = groundHeightAt(state.posX, state.posZ) + 1.15;
  if (state.posY < minGroundY) {
    state.posY = minGroundY;
  }

  const fovDamp = 1 - Math.exp(-6.0 * dt);
  state.fov += (desired.targetFov - state.fov) * fovDamp;

  state.trauma = Math.max(0, state.trauma - 1.9 * dt);
  const shake = state.trauma * state.trauma * 0.38;
  const shakeX = shake > 0.001 ? Math.sin(headX * 19.3 + state.trauma * 71.0) * shake : 0;
  const shakeY = shake > 0.001 ? Math.cos(headZ * 23.7 + state.trauma * 59.0) * shake : 0;

  return {
    posX: state.posX + shakeX,
    posY: state.posY + shakeY,
    posZ: state.posZ,
    lookX: state.lookX,
    lookY: state.lookY,
    lookZ: state.lookZ,
    fov: state.fov,
  };
}

export const BOOST_EXHAUST_THRESHOLD = 4.0;
export const BOOST_RECOVERY_THRESHOLD = 99.5;

export interface SprintBoostState {
  exhausted: boolean;
}

export function createSprintBoostState(): SprintBoostState {
  return { exhausted: false };
}

export function resolveEffectiveBoost(
  state: SprintBoostState,
  wantsBoost: boolean,
  isMoving: boolean,
  stamina: number,
): boolean {
  if (state.exhausted) {
    if (stamina >= BOOST_RECOVERY_THRESHOLD) {
      state.exhausted = false;
    } else {
      return false;
    }
  }
  if (wantsBoost && isMoving && stamina <= BOOST_EXHAUST_THRESHOLD) {
    state.exhausted = true;
    return false;
  }
  return wantsBoost && isMoving;
}

