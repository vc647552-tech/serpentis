import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CHASE_PITCH,
  MANUAL_HOLD_DURATION,
  MAX_CHASE_PITCH,
  MIN_CHASE_PITCH,
  applyScreenDrag,
  applyZoomWheel,
  computeCameraRelativeMove,
  computeChaseSteerCommand,
  createInitialCameraState,
  createSprintBoostState,
  normalizeAngleRad,
  resolveEffectiveBoost,
  stepOrbitCamera,
} from './cameraControls';

test('screen drag rotates camera yaw 360 and clamps vertical pitch', () => {
  const cam = createInitialCameraState(Math.PI, 54, 'chase', 0, 0, 4, 0.48);
  assert.ok(Math.abs(cam.yaw - Math.PI) < 1e-6);
  assert.ok(Math.abs(cam.pitch - DEFAULT_CHASE_PITCH) < 1e-6);

  // Dragging right (deltaX > 0) rotates view clockwise (decreasing yaw)
  applyScreenDrag(cam, 150, 0, 1.0, 'chase');
  assert.ok(cam.yaw < Math.PI, `Expected yaw < PI when dragging right, got ${cam.yaw}`);
  assert.equal(cam.manualHoldTimer, MANUAL_HOLD_DURATION);

  // Dragging very far down/up clamps pitch cleanly within safe bounds
  applyScreenDrag(cam, 0, 10000, 1.0, 'chase');
  assert.equal(cam.pitch, MAX_CHASE_PITCH);
  applyScreenDrag(cam, 0, -10000, 1.0, 'chase');
  assert.equal(cam.pitch, MIN_CHASE_PITCH);
});

test('camera-relative movement steers toward camera yaw when moving forward and supports Free Fire strafe/auto-run', () => {
  // Camera facing +X (yaw = PI/2)
  const camYaw = Math.PI / 2;

  // Pushing joystick UP (rawJoyY = 1) or pressing W moves along camera forward (+X -> PI/2)
  const fwdMove = computeCameraRelativeMove(
    camYaw,
    { left: false, right: false, up: true, down: false },
    0,
    0,
    false,
  );
  assert.equal(fwdMove.active, true);
  assert.ok(Math.abs(normalizeAngleRad(fwdMove.desiredHeading - Math.PI / 2)) < 1e-5);

  // Pushing joystick RIGHT (rawJoyX = 1) moves right of +X, which is +Z (heading = 0)
  const rightJoy = computeCameraRelativeMove(
    camYaw,
    { left: false, right: false, up: false, down: false },
    1,
    0,
    false,
  );
  assert.equal(rightJoy.active, true);
  assert.ok(Math.abs(normalizeAngleRad(rightJoy.desiredHeading - 0)) < 1e-5);

  // Auto-run sprint lock moves forward along camera yaw even with neutral joystick
  const autoRunMove = computeCameraRelativeMove(
    -Math.PI / 2,
    { left: false, right: false, up: false, down: false },
    0,
    0,
    true,
  );
  assert.equal(autoRunMove.active, true);
  assert.ok(Math.abs(normalizeAngleRad(autoRunMove.desiredHeading - (-Math.PI / 2))) < 1e-5);
});

test('stepOrbitCamera preserves manual free-look during hold timer and never clips below terrain', () => {
  const cam = createInitialCameraState(Math.PI, 54, 'chase', 0, 0, 4, 0.48);
  applyScreenDrag(cam, 200, -50, 1.0, 'chase');
  const draggedYaw = cam.yaw;

  const idleMove = computeCameraRelativeMove(
    cam.yaw,
    { left: false, right: false, up: false, down: false },
    0,
    0,
    false,
  );

  // Stationary free-look must not snap back to snake heading
  for (let i = 0; i < 30; i++) {
    const frame = stepOrbitCamera(
      cam,
      1 / 60,
      'chase',
      0,
      0,
      4,
      Math.PI,
      0.48,
      false,
      false,
      54,
      idleMove,
      () => 5.0, // High hill beneath camera
    );
    assert.ok(frame.posY >= 6.15, `Camera must stay above terrain+1.15m (got ${frame.posY})`);
  }
  assert.ok(Math.abs(cam.yaw - draggedYaw) < 1e-5, 'Stationary free-look must preserve dragged yaw');
});

test('computeChaseSteerCommand converts heading error into smooth WASM steerAxis without deadzone jitter', () => {
  // Need to turn left (+0.5 rad) -> steerAxis must be negative (since C++ does heading += -steerAxis * rate * dt)
  const turnLeft = computeChaseSteerCommand(0, 0.5, 3.2, 1 / 60);
  assert.ok(turnLeft.steerAxis < -0.5);
  assert.equal(turnLeft.snapHeading, null);

  // Tiny sub-threshold angle snaps directly without jitter
  const aligned = computeChaseSteerCommand(1.0, 1.0005, 3.2, 1 / 60);
  assert.equal(aligned.steerAxis, 0);
  assert.equal(aligned.snapHeading, 1.0005);
});

test('zoom wheel clamps camera zoom scale cleanly', () => {
  const cam = createInitialCameraState(Math.PI, 54, 'chase', 0, 0, 4, 0.48);
  applyZoomWheel(cam, -5000);
  assert.equal(cam.zoomScale, 0.72);
  applyZoomWheel(cam, 5000);
  assert.equal(cam.zoomScale, 1.65);
});

test('resolveEffectiveBoost prevents RUN stutter until stamina fully recovers', () => {
  const boostState = createSprintBoostState();

  assert.equal(resolveEffectiveBoost(boostState, true, true, 100), true);
  assert.equal(boostState.exhausted, false);

  // Depleting stamina below threshold latches exhausted state
  assert.equal(resolveEffectiveBoost(boostState, true, true, 3.5), false);
  assert.equal(boostState.exhausted, true);

  // As stamina regenerates back up (5, 25, 60, 99), sprint remains locked off with zero stutter
  for (const stam of [4.5, 10, 25, 60, 98.9]) {
    assert.equal(
      resolveEffectiveBoost(boostState, true, true, stam),
      false,
      `Boost must stay off at stamina=${stam} until full`,
    );
    assert.equal(boostState.exhausted, true);
  }

  // Once stamina reaches full (>= 99.5), RUN smoothly re-engages
  assert.equal(resolveEffectiveBoost(boostState, true, true, 100), true);
  assert.equal(boostState.exhausted, false);
});
