import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HEAD_RADIUS, SEGMENT_SPACING } from '../game/engine';
import {
  EnterableBuilding,
  Hatchling,
  LaidEgg,
  ObstacleKind,
  PreyItem,
  PreyKind,
  SegmentPose,
  VillageDef,
  Villager,
} from '../game/types';
import { HumanTextureSet, SpeciesMorph } from './textures';
import { SCALAR_F32, SCALAR_I32, snakeCoreWasm } from '../wasm/snakeCoreWasm';

export interface SnakeHeadRig {
  root: THREE.Group;
  jawPivot: THREE.Group;
  tongueGroup: THREE.Group;
  cobraHood: THREE.Group;
  eyeMaterial: THREE.MeshStandardMaterial;
}

export interface BirdRig {
  root: THREE.Group;
  leftWing: THREE.Group;
  rightWing: THREE.Group;
}

export interface AnimalRig {
  root: THREE.Group;
  kind: PreyKind;
  bodyPivot: THREE.Group;
  neckPivot?: THREE.Group;
  headPivot?: THREE.Group;
  leftEar?: THREE.Group;
  rightEar?: THREE.Group;
  frontLeftLeg?: THREE.Group;
  frontRightLeg?: THREE.Group;
  hindLeftLeg?: THREE.Group;
  hindRightLeg?: THREE.Group;
  hindLeftLower?: THREE.Group;
  hindRightLower?: THREE.Group;
  tailPivot?: THREE.Group;
  tailSegs?: THREE.Group[];
  throatSac?: THREE.Mesh;
  trunkPivot?: THREE.Group;
  trunkLower?: THREE.Group;
}

export interface BuildingVisualRig {
  root: THREE.Group;
  roofGroup: THREE.Group;
  roofMaterials: THREE.MeshStandardMaterial[];
  interiorLight?: THREE.PointLight;
  baseEmberIntensity?: number;
}

export interface AnimalMaterialSet {
  rabbitFurMat: THREE.MeshStandardMaterial;
  rabbitBellyMat: THREE.MeshStandardMaterial;
  mouseFurMat: THREE.MeshStandardMaterial;
  pinkSkinMat: THREE.MeshStandardMaterial;
  frogSkinMat: THREE.MeshStandardMaterial;
  deerFurMat: THREE.MeshStandardMaterial;
  boarFurMat: THREE.MeshStandardMaterial;
  elephantSkinMat: THREE.MeshStandardMaterial;
  ivoryMat: THREE.MeshStandardMaterial;
}

export interface BuildingMaterialSet {
  woodMat: THREE.MeshStandardMaterial;
  stoneMat: THREE.MeshStandardMaterial;
  barkMat: THREE.MeshStandardMaterial;
  mossMat: THREE.MeshStandardMaterial;
  shingleMat: THREE.MeshStandardMaterial;
}

interface LoftStation {
  z: number;
  rx: number;
  ryTop: number;
  ryBot: number;
  yOff: number;
  browFlare?: number;
  lipFlare?: number;
}

function createLoftedGeometry(
  stations: readonly LoftStation[],
  radial: number,
  uMin = 0,
  uMax = 1,
  vScale = 1,
): THREE.BufferGeometry {
  const stride = radial + 1;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < stations.length; i++) {
    const st = stations[i];
    const v = (i / (stations.length - 1)) * vScale;
    for (let s = 0; s <= radial; s++) {
      const uFrac = s / radial;
      const theta = uFrac * Math.PI * 2;
      const sinT = Math.sin(theta);
      const cosT = -Math.cos(theta);
      const ry = cosT >= 0 ? st.ryTop : st.ryBot;
      const brow =
        st.browFlare && cosT > 0.2 && Math.abs(sinT) > 0.35
          ? st.browFlare * (1 - Math.abs(cosT - 0.58))
          : 0;
      const lip =
        st.lipFlare && Math.abs(cosT) < 0.25 && Math.abs(sinT) > 0.55
          ? st.lipFlare
          : 0;
      const px = sinT * (st.rx + brow * 0.5 + lip);
      const py = cosT * ry + st.yOff + brow;
      positions.push(px, py, st.z);
      uvs.push(uMin + uFrac * (uMax - uMin), v);
    }
  }

  for (let i = 0; i < stations.length - 1; i++) {
    for (let s = 0; s < radial; s++) {
      const a = i * stride + s;
      const b = a + 1;
      const c = (i + 1) * stride + s;
      const d = c + 1;
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export interface SpineRingSolveParams {
  poses: ArrayLike<number>;
  poseStride?: number;
  poseCount: number;
  headX: number;
  headY: number;
  headZ: number;
  heading: number;
  headPitch: number;
  rings: number;
  elapsed: number;
  segSpacing: number;
  headRadius: number;
  headWidth: number;
  headLength: number;
  bodyWidth: number;
  swallowBulgeT?: number;
}

/**
 * Computes distortion-free spline centerline rings `(x, y, z, radius)` from the snake's
 * occipital neck socket through the tracked spine poses. Enforces a skull half-space &
 * radial capsule exclusion zone plus 2-pass anti-fold relaxation on neck rings so sharp
 * or stationary turns never push the neck inside the skull or fold the body onto itself.
 */
export function computeSnakeSpineRings(
  params: SpineRingSolveParams,
  ringOut: Float32Array,
): { totalLen: number; b0x: number; b0y: number; b0z: number; neckRad: number } {
  const {
    poses,
    poseStride = 5,
    poseCount,
    headX,
    headY,
    headZ,
    heading,
    headPitch,
    rings,
    elapsed,
    segSpacing,
    headRadius,
    headWidth,
    headLength,
    bodyWidth,
    swallowBulgeT = 0,
  } = params;

  const scaleRatio = segSpacing / SEGMENT_SPACING;
  const sc = headRadius / HEAD_RADIUS;
  const headLenWorld = headLength * sc;
  const headWidthWorld = headWidth * sc;

  const cosP = Math.cos(headPitch);
  const f0x = Math.sin(heading) * cosP;
  const f0y = -Math.sin(headPitch);
  const f0z = Math.cos(heading) * cosP;

  // Anchor Ring 0 cleanly at the sculpted cranium's occipital socket (behind head pivot)
  const p0x = headX - f0x * (0.145 * headLenWorld);
  const p0y = headY - f0y * (0.145 * headLenWorld) - 0.008 * sc;
  const p0z = headZ - f0z * (0.145 * headLenWorld);

  const pose0Rad = poses[4] || headRadius * 0.44;
  const isHatch = Math.abs(segSpacing - SEGMENT_SPACING * sc) > 1e-3 && sc > 0.99 && segSpacing < 0.35;
  const neckRad = isHatch
    ? Math.max(0.038, pose0Rad * 0.72)
    : Math.min(headRadius * 0.44, Math.max(0.04, pose0Rad * 0.94));

  // Initial exit direction strictly backward out of the skull
  let b0x = -f0x;
  let b0y = -f0y;
  let b0z = -f0z;

  const joinIdx = Math.min(poseCount - 1, 2);
  const hermiteLen = (joinIdx + 1) * segSpacing;
  const p1Off = joinIdx * poseStride;
  const p1x = poses[p1Off];
  const p1y = poses[p1Off + 1];
  const p1z = poses[p1Off + 2];
  const p1Rad = poses[p1Off + 4] || pose0Rad;

  const prevOff = (joinIdx > 0 ? joinIdx - 1 : 0) * poseStride;
  const nextOff = (joinIdx + 1 < poseCount ? joinIdx + 1 : poseCount - 1) * poseStride;
  let b1x = poses[nextOff] - poses[prevOff];
  let b1y = poses[nextOff + 1] - poses[prevOff + 1];
  let b1z = poses[nextOff + 2] - poses[prevOff + 2];
  const b1Len = Math.hypot(b1x, b1y, b1z);
  if (b1Len > 1e-5) {
    b1x /= b1Len;
    b1y /= b1Len;
    b1z /= b1Len;
  } else {
    b1x = b0x;
    b1y = b0y;
    b1z = b0z;
  }

  const dx01 = p1x - p0x;
  const dy01 = p1y - p0y;
  const dz01 = p1z - p0z;
  const chordLen = Math.hypot(dx01, dy01, dz01);

  // Fallback lateral axis orthogonal to head forward vector (for 180-deg tight turns)
  const rightX = Math.cos(heading);
  const rightZ = -Math.sin(heading);
  let latX = dx01 - f0x * (dx01 * f0x + dy01 * f0y + dz01 * f0z);
  let latY = dy01 - f0y * (dx01 * f0x + dy01 * f0y + dz01 * f0z);
  let latZ = dz01 - f0z * (dx01 * f0x + dy01 * f0y + dz01 * f0z);
  const latLen = Math.hypot(latX, latY, latZ);
  if (latLen > 1e-4) {
    latX /= latLen;
    latY /= latLen;
    latZ /= latLen;
  } else {
    latX = rightX;
    latY = 0;
    latZ = rightZ;
  }

  let align = 1.0;
  if (chordLen > 1e-4) {
    const cdx = dx01 / chordLen;
    const cdy = dy01 / chordLen;
    const cdz = dz01 / chordLen;
    align = b0x * cdx + b0y * cdy + b0z * cdz;
    if (align < 0.25) {
      // Steer exit tangent smoothly out along lat, NEVER forward into +f0
      const sideBlend = Math.max(0, Math.min(0.48, (0.25 - align) * 0.45));
      const targetX = -f0x * 0.55 + latX * 0.835;
      const targetY = -f0y * 0.55 + latY * 0.835;
      const targetZ = -f0z * 0.55 + latZ * 0.835;
      b0x += (targetX - b0x) * sideBlend;
      b0y += (targetY - b0y) * sideBlend;
      b0z += (targetZ - b0z) * sideBlend;
      const b0L = Math.hypot(b0x, b0y, b0z);
      if (b0L > 1e-5) {
        b0x /= b0L;
        b0y /= b0L;
        b0z /= b0L;
      }
    }
  }

  // Keep sturdy neck support out of occipital socket even during steep joystick spins
  const alignFactor = Math.max(0.45, Math.min(1.0, (align + 1.0) * 0.5));
  const tangLen0 = Math.min(chordLen * 0.42, hermiteLen * 0.34) * alignFactor;
  const tangLen1 = Math.min(chordLen * 0.40, hermiteLen * 0.32);

  const totalLen = poseCount * segSpacing;
  const bulgeCenter = 0.08 + (1.0 - swallowBulgeT) * 0.70;

  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const distBack = t * totalLen;
    const r4 = r * 4;

    let bulgeMult = 1.0;
    if (swallowBulgeT > 0.001) {
      const dT = (t - bulgeCenter) / 0.085;
      bulgeMult = 1.0 + swallowBulgeT * Math.exp(-dT * dT) * 0.62;
    }

    if (distBack <= hermiteLen) {
      const u = distBack / hermiteLen;
      const u2 = u * u;
      const u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1;
      const h10 = u3 - 2 * u2 + u;
      const h01 = -2 * u3 + 3 * u2;
      const h11 = u3 - u2;

      ringOut[r4]     = h00 * p0x + h10 * tangLen0 * b0x + h01 * p1x + h11 * tangLen1 * b1x;
      ringOut[r4 + 1] = h00 * p0y + h10 * tangLen0 * b0y + h01 * p1y + h11 * tangLen1 * b1y;
      ringOut[r4 + 2] = h00 * p0z + h10 * tangLen0 * b0z + h01 * p1z + h11 * tangLen1 * b1z;
      const smoothU = Math.pow(u, 0.55);
      const hermiteBodyRad = p1Rad * 0.88;
      ringOut[r4 + 3] = (neckRad + (hermiteBodyRad - neckRad) * smoothU) * bulgeMult;
    } else {
      const segFloat = distBack / segSpacing - 1.0;
      let i0 = Math.floor(segFloat);
      if (i0 < 0) i0 = 0;
      if (i0 > poseCount - 1) i0 = poseCount - 1;
      const i1 = i0 + 1 < poseCount ? i0 + 1 : poseCount - 1;
      const im1 = i0 > 0 ? i0 - 1 : 0;
      const i2 = i1 + 1 < poseCount ? i1 + 1 : poseCount - 1;
      const tSeg = Math.max(0, Math.min(1, segFloat - i0));
      const t2 = tSeg * tSeg;
      const t3 = t2 * tSeg;

      const am1 = im1 * poseStride;
      const a0 = i0 * poseStride;
      const a1 = i1 * poseStride;
      const a2 = i2 * poseStride;

      // Tension-damped Catmull-Rom spline so curved body coils stay silky-round during sharp turns
      const catmull = (p0: number, p1: number, p2: number, p3: number) =>
        0.5 *
        (2 * p1 +
          (-p0 + p2) * tSeg +
          (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
          (-p0 + 3 * p1 - 3 * p2 + p3) * t3);

      const crX = catmull(poses[am1], poses[a0], poses[a1], poses[a2]);
      const crY = catmull(poses[am1 + 1], poses[a0 + 1], poses[a1 + 1], poses[a2 + 1]);
      const crZ = catmull(poses[am1 + 2], poses[a0 + 2], poses[a1 + 2], poses[a2 + 2]);
      const linX = poses[a0] + (poses[a1] - poses[a0]) * tSeg;
      const linY = poses[a0 + 1] + (poses[a1 + 1] - poses[a0 + 1]) * tSeg;
      const linZ = poses[a0 + 2] + (poses[a1 + 2] - poses[a0 + 2]) * tSeg;
      let outX = linX + (crX - linX) * 0.85;
      const outY = linY + (crY - linY) * 0.65;
      let outZ = linZ + (crZ - linZ) * 0.85;

      // Fluid multi-wave serpentine S-undulation starting past cervical neck (t > 0.25)
      if (t > 0.25) {
        const waveRamp = Math.min(1.0, (t - 0.25) / 0.18) * (1.0 - t * 0.22);
        const tanX = poses[a1] - poses[a0];
        const tanZ = poses[a1 + 2] - poses[a0 + 2];
        const tanLen = Math.hypot(tanX, tanZ);
        if (tanLen > 1e-4) {
          const perpX = tanZ / tanLen;
          const perpZ = -tanX / tanLen;
          const wave = Math.sin(elapsed * 4.8 - t * Math.PI * 3.1) * (0.072 * sc * waveRamp);
          outX += perpX * wave;
          outZ += perpZ * wave;
        }
      }

      ringOut[r4] = outX;
      ringOut[r4 + 1] = outY;
      ringOut[r4 + 2] = outZ;

      const baseRad = poses[a0 + 4] + (poses[a1 + 4] - poses[a0 + 4]) * tSeg;
      // Sleek muscular torso profile: eliminates mid-body slug bulge and tapers gracefully to whip tail
      const torsoSleek = 0.88 - 0.04 * Math.sin(Math.min(1, t * 2.5) * Math.PI);
      const tailFade =
        t > 0.36
          ? Math.max(0.11, 1.0 - Math.pow((t - 0.36) / 0.64, 1.28) * 0.89)
          : 1.0;
      const breath = t > 0.08 && t < 0.6 ? 1.0 + Math.sin(elapsed * 2.4 - t * 4.0) * 0.02 : 1.0;
      ringOut[r4 + 3] = baseRad * torsoSleek * tailFade * breath * bulgeMult;
    }
  }

  // Post-spline Neck Safety Pass: guarantee no neck ring ever enters the skull or folds backward
  const neckEndRing = Math.min(rings - 1, Math.max(4, Math.ceil(rings * 0.24)));
  const immediateNeckRing = Math.min(neckEndRing, Math.max(2, Math.floor(rings * 0.08)));

  const enforceSkullClearance = () => {
    for (let r = 1; r <= neckEndRing; r++) {
      const r4 = r * 4;
      let rx = ringOut[r4];
      let ry = ringOut[r4 + 1];
      let rz = ringOut[r4 + 2];
      const rad = ringOut[r4 + 3];

      // 1. Immediate cervical rings must remain strictly behind the occipital socket along -f0
      if (r <= immediateNeckRing) {
        const fwdFromP0 = (rx - p0x) * f0x + (ry - p0y) * f0y + (rz - p0z) * f0z;
        const maxFwd = -r * (0.014 * headLenWorld);
        if (fwdFromP0 > maxFwd) {
          const pushBack = fwdFromP0 - maxFwd;
          rx -= f0x * pushBack;
          ry -= f0y * pushBack;
          rz -= f0z * pushBack;
        }
      }

      // 2. Skull capsule radial exclusion: push rings out laterally if they pass beside/inside cranium
      const alongSkull = (rx - headX) * f0x + (ry - headY) * f0y + (rz - headZ) * f0z;
      if (alongSkull > -0.10 * headLenWorld && alongSkull < 0.96 * headLenWorld) {
        const projClamped = Math.max(-0.04 * headLenWorld, Math.min(0.88 * headLenWorld, alongSkull));
        const px = headX + f0x * projClamped;
        const py = headY + f0y * projClamped;
        const pz = headZ + f0z * projClamped;

        let ox = rx - px;
        let oy = ry - py;
        let oz = rz - pz;
        const dist = Math.hypot(ox, oy, oz);
        const minClear =
          Math.max(0.32 * headWidthWorld, 0.26 * headLenWorld) + rad * bodyWidth * 0.45;

        if (dist < minClear) {
          if (dist > 1e-4) {
            ox /= dist;
            oy /= dist;
            oz /= dist;
          } else {
            ox = latX;
            oy = 0;
            oz = latZ;
          }
          // Prefer pushing outward and slightly backward behind the temporal jaw
          rx = px + ox * minClear - f0x * (0.04 * headLenWorld);
          ry = py + oy * (minClear * 0.45);
          rz = pz + oz * minClear - f0z * (0.04 * headLenWorld);
        }
      }

      ringOut[r4] = rx;
      ringOut[r4 + 1] = ry;
      ringOut[r4 + 2] = rz;
    }
  };

  enforceSkullClearance();

  // 2 passes of kink/fold relaxation on cervical region to keep bends silky-smooth
  for (let pass = 0; pass < 2; pass++) {
    for (let r = 1; r < neckEndRing; r++) {
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
        if (dotAB < 0.35) {
          const w = Math.min(0.45, (0.35 - dotAB) * 0.42);
          ringOut[r4] += ((ringOut[p4] + ringOut[n4]) * 0.5 - ringOut[r4]) * w;
          ringOut[r4 + 1] += ((ringOut[p4 + 1] + ringOut[n4 + 1]) * 0.5 - ringOut[r4 + 1]) * w;
          ringOut[r4 + 2] += ((ringOut[p4 + 2] + ringOut[n4 + 2]) * 0.5 - ringOut[r4 + 2]) * w;
        }
      }
    }
    enforceSkullClearance();
  }

  return { totalLen, b0x, b0y, b0z, neckRad };
}

/**
 * Continuous seamless muscular snake body BufferGeometry updated in-place
 * with zero per-frame allocations. Anchors a distortion-free Hermite + capsule-guarded
 * neck spline directly to the skull's occipital socket and deforms the King Cobra hood.
 */
export class ContinuousSnakeBody {
  public readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly rings: number;
  private readonly radial: number;
  private readonly posArray: Float32Array;
  private readonly normArray: Float32Array;
  private readonly uvArray: Float32Array;
  private readonly colorArray: Float32Array;
  private readonly ringPts: Float32Array;
  private lastUvCount = -1;
  private lastCoonTail = false;
  private tailTip = { x: 0, y: 0, z: 0, yaw: 0 };

  constructor(material: THREE.Material, castShadow: boolean, rings = 84, radial = 16) {
    this.rings = rings;
    this.radial = radial;
    const stride = this.radial + 1;
    const vertCount = (this.rings + 1) * stride;
    this.posArray = new Float32Array(vertCount * 3);
    this.normArray = new Float32Array(vertCount * 3);
    this.uvArray = new Float32Array(vertCount * 2);
    this.colorArray = new Float32Array(vertCount * 3);
    this.ringPts = new Float32Array((this.rings + 1) * 4);

    for (let r = 0; r <= this.rings; r++) {
      const v = (r / this.rings) * 11.0;
      for (let s = 0; s <= this.radial; s++) {
        const idx = r * stride + s;
        this.uvArray[idx * 2] = s / this.radial;
        this.uvArray[idx * 2 + 1] = v;

        const theta = (s / this.radial) * Math.PI * 2;
        const cosT = -Math.cos(theta);
        const ao = 0.72 + 0.28 * Math.pow(Math.max(0, (cosT + 1) * 0.5), 0.75);
        this.colorArray[idx * 3] = ao;
        this.colorArray[idx * 3 + 1] = ao;
        this.colorArray[idx * 3 + 2] = ao;
        this.normArray[idx * 3 + 1] = 1.0;
      }
    }

    const indices: number[] = [];
    for (let r = 0; r < this.rings; r++) {
      for (let s = 0; s < this.radial; s++) {
        const a = r * stride + s;
        const b = a + 1;
        const c = (r + 1) * stride + s;
        const d = c + 1;
        indices.push(a, b, c);
        indices.push(b, d, c);
      }
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.posArray, 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.normArray, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(this.uvArray, 2));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colorArray, 3));
    this.geometry.setIndex(indices);

    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
  }

  public getTailTip(): { x: number; y: number; z: number; yaw: number } {
    return this.tailTip;
  }

  private syncUvAndTint(count: number, hasCoonTail: boolean): void {
    if (count === this.lastUvCount && hasCoonTail === this.lastCoonTail) return;
    this.lastUvCount = count;
    this.lastCoonTail = hasCoonTail;
    const vRepeat = Math.max(4.5, count * 0.36);
    const stride = this.radial + 1;
    for (let r = 0; r <= this.rings; r++) {
      const t = r / this.rings;
      const v = t * vRepeat;
      let ringTintR = 1;
      let ringTintG = 1;
      let ringTintB = 1;
      if (hasCoonTail && t > 0.82) {
        const blend = Math.min(1, (t - 0.82) / 0.04);
        const band = Math.sin(((t - 0.82) / 0.18) * Math.PI * 7) > 0;
        const tr = band ? 0.18 : 1.24;
        const tg = band ? 0.18 : 1.22;
        const tb = band ? 0.18 : 1.18;
        ringTintR = 1 + (tr - 1) * blend;
        ringTintG = 1 + (tg - 1) * blend;
        ringTintB = 1 + (tb - 1) * blend;
      }
      for (let s = 0; s <= this.radial; s++) {
        const idx = r * stride + s;
        this.uvArray[idx * 2 + 1] = v;
        const theta = (s / this.radial) * Math.PI * 2;
        const cosT = -Math.cos(theta);
        const ao = 0.72 + 0.28 * Math.pow(Math.max(0, (cosT + 1) * 0.5), 0.75);
        this.colorArray[idx * 3] = ao * ringTintR;
        this.colorArray[idx * 3 + 1] = ao * ringTintG;
        this.colorArray[idx * 3 + 2] = ao * ringTintB;
      }
    }
    (this.geometry.attributes.uv as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  private deformFromPosesBuffer(
    poses: ArrayLike<number>,
    headX: number,
    headY: number,
    headZ: number,
    heading: number,
    headPitch: number,
    poseCount: number,
    elapsed: number,
    morph: SpeciesMorph,
    segSpacing: number,
    headRadius: number,
    swallowBulgeT: number,
  ): boolean {
    if (poseCount < 3 || this.rings <= 1 || this.radial <= 2) return false;

    const { totalLen, b0x, b0y, b0z } = computeSnakeSpineRings(
      {
        poses,
        poseStride: 5,
        poseCount,
        headX,
        headY,
        headZ,
        heading,
        headPitch,
        rings: this.rings,
        elapsed,
        segSpacing,
        headRadius,
        headWidth: morph.headWidth,
        headLength: morph.headLength,
        bodyWidth: morph.bodyWidth,
        swallowBulgeT,
      },
      this.ringPts,
    );

    const stride = this.radial + 1;
    const scaleRatio = segSpacing / SEGMENT_SPACING;
    const hoodStrength = morph.hoodStrength;
    const hasHood = hoodStrength > 0 ? 1.0 : 0.0;
    const neckDenom = Math.max(0.22, 0.72 * scaleRatio);

    let prevRx = -Math.cos(heading);
    let prevRz = Math.sin(heading);

    for (let r = 0; r <= this.rings; r++) {
      const r4 = r * 4;
      const distBack = (r / this.rings) * totalLen;
      const cx = this.ringPts[r4];
      const cy = this.ringPts[r4 + 1];
      const cz = this.ringPts[r4 + 2];
      const rad = this.ringPts[r4 + 3];

      let tx: number;
      let ty: number;
      let tz: number;
      if (r === 0) {
        tx = b0x;
        ty = b0y;
        tz = b0z;
      } else {
        const prev4 = (r - 1) * 4;
        const next4 = (r + 1 <= this.rings ? r + 1 : this.rings) * 4;
        tx = this.ringPts[next4] - this.ringPts[prev4];
        ty = this.ringPts[next4 + 1] - this.ringPts[prev4 + 1];
        tz = this.ringPts[next4 + 2] - this.ringPts[prev4 + 2];
        const tLen = Math.hypot(tx, ty, tz);
        if (tLen < 1e-5) {
          tx = b0x;
          ty = b0y;
          tz = b0z;
        } else {
          tx /= tLen;
          ty /= tLen;
          tz /= tLen;
        }
      }

      let rx = tz;
      let rz = -tx;
      const rLen = Math.hypot(rx, rz);
      if (rLen < 1e-4) {
        rx = prevRx;
        rz = prevRz;
      } else {
        rx /= rLen;
        rz /= rLen;
        prevRx = rx;
        prevRz = rz;
      }

      const ux = ty * rz;
      const uy = tz * rx - tx * rz;
      const uz = -ty * rx;

      let hoodBell = 0;
      if (hoodStrength > 0 && distBack > 0.16 * scaleRatio && distBack < 1.18 * scaleRatio) {
        const hu = (distBack - 0.16 * scaleRatio) / (1.02 * scaleRatio);
        const sHu = Math.sin(Math.PI * hu);
        hoodBell = Math.pow(Math.max(0, sHu), 0.78);
      }

      const rcx = cx;
      const rcy = cy + hoodBell * (0.048 * scaleRatio) * hasHood;
      const rcz = cz;

      const neckMorphT = Math.min(1.0, distBack / neckDenom);
      const curW = morph.headWidth * 0.80 + (morph.bodyWidth - morph.headWidth * 0.80) * neckMorphT;
      const curH = morph.headHeight * 0.80 + (morph.bodyHeight - morph.headHeight * 0.80) * neckMorphT;

      for (let s = 0; s <= this.radial; s++) {
        const theta = (s / this.radial) * Math.PI * 2;
        const sinT = Math.sin(theta);
        const cosT = -Math.cos(theta);

        // Smooth muscular cylindrical cross-section with gentle belly ground contact (zero flat side flange)
        const tBelly = Math.max(0, Math.min(1, (-0.18 - cosT) / 0.82));
        const bellyFlat = tBelly * tBelly * (3 - 2 * tBelly);
        const dorsalArch = cosT > 0 ? 1.04 + 0.11 * cosT * cosT : 1.04;
        const sideFullness = 1.0 + 0.04 * (1 - Math.abs(cosT));
        const baseW = sideFullness * curW;
        const hoodW = 1.0 + hoodStrength * hoodBell * (0.68 + 0.32 * Math.max(0, cosT));
        const hoodH = 1.0 - 0.18 * hoodBell * hasHood;

        const widthFactor = baseW * hoodW;
        const heightFactor = (dorsalArch + (0.68 - dorsalArch) * bellyFlat) * curH * hoodH;

        const lx = sinT * rad * widthFactor;
        const ly = cosT * rad * heightFactor;

        const outIdx = (r * stride + s) * 3;
        this.posArray[outIdx] = rcx + rx * lx + ux * ly;
        this.posArray[outIdx + 1] = rcy + uy * ly;
        this.posArray[outIdx + 2] = rcz + rz * lx + uz * ly;

        this.normArray[outIdx] = 0;
        this.normArray[outIdx + 1] = 0;
        this.normArray[outIdx + 2] = 0;
      }
    }

    for (let r = 0; r < this.rings; r++) {
      for (let s = 0; s < this.radial; s++) {
        const a = (r * stride + s) * 3;
        const b = a + 3;
        const c = ((r + 1) * stride + s) * 3;
        const d = c + 3;

        const abx = this.posArray[b] - this.posArray[a];
        const aby = this.posArray[b + 1] - this.posArray[a + 1];
        const abz = this.posArray[b + 2] - this.posArray[a + 2];
        const acx = this.posArray[c] - this.posArray[a];
        const acy = this.posArray[c + 1] - this.posArray[a + 1];
        const acz = this.posArray[c + 2] - this.posArray[a + 2];
        const n1x = aby * acz - abz * acy;
        const n1y = abz * acx - abx * acz;
        const n1z = abx * acy - aby * acx;
        this.normArray[a] += n1x; this.normArray[a + 1] += n1y; this.normArray[a + 2] += n1z;
        this.normArray[b] += n1x; this.normArray[b + 1] += n1y; this.normArray[b + 2] += n1z;
        this.normArray[c] += n1x; this.normArray[c + 1] += n1y; this.normArray[c + 2] += n1z;

        const dbx = this.posArray[b] - this.posArray[d];
        const dby = this.posArray[b + 1] - this.posArray[d + 1];
        const dbz = this.posArray[b + 2] - this.posArray[d + 2];
        const dcx = this.posArray[c] - this.posArray[d];
        const dcy = this.posArray[c + 1] - this.posArray[d + 1];
        const dcz = this.posArray[c + 2] - this.posArray[d + 2];
        const n2x = dcy * dbz - dcz * dby;
        const n2y = dcz * dbx - dcx * dbz;
        const n2z = dcx * dby - dcy * dbx;
        this.normArray[b] += n2x; this.normArray[b + 1] += n2y; this.normArray[b + 2] += n2z;
        this.normArray[d] += n2x; this.normArray[d + 1] += n2y; this.normArray[d + 2] += n2z;
        this.normArray[c] += n2x; this.normArray[c + 1] += n2y; this.normArray[c + 2] += n2z;
      }
    }

    // Stitch seam normals between s=0 and s=radial
    for (let r = 0; r <= this.rings; r++) {
      const s0 = (r * stride) * 3;
      const sLast = (r * stride + this.radial) * 3;
      const sx = this.normArray[s0] + this.normArray[sLast];
      const sy = this.normArray[s0 + 1] + this.normArray[sLast + 1];
      const sz = this.normArray[s0 + 2] + this.normArray[sLast + 2];
      this.normArray[s0] = sx; this.normArray[s0 + 1] = sy; this.normArray[s0 + 2] = sz;
      this.normArray[sLast] = sx; this.normArray[sLast + 1] = sy; this.normArray[sLast + 2] = sz;
    }

    const vertCount = (this.rings + 1) * stride;
    for (let v = 0; v < vertCount; v++) {
      const i3 = v * 3;
      const nx = this.normArray[i3];
      const ny = this.normArray[i3 + 1];
      const nz = this.normArray[i3 + 2];
      const len = Math.hypot(nx, ny, nz);
      if (len > 1e-6) {
        this.normArray[i3] = nx / len;
        this.normArray[i3 + 1] = ny / len;
        this.normArray[i3 + 2] = nz / len;
      } else {
        this.normArray[i3] = 0;
        this.normArray[i3 + 1] = 1;
        this.normArray[i3 + 2] = 0;
      }
    }

    const tailOff = (this.rings - 1) * 4;
    const tipOff = this.rings * 4;
    this.tailTip.x = this.ringPts[tipOff];
    this.tailTip.y = this.ringPts[tipOff + 1];
    this.tailTip.z = this.ringPts[tipOff + 2];
    this.tailTip.yaw = Math.atan2(
      this.ringPts[tailOff] - this.ringPts[tipOff],
      this.ringPts[tailOff + 2] - this.ringPts[tipOff + 2],
    );

    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.normal as THREE.BufferAttribute).needsUpdate = true;
    return true;
  }

  public updatePlayer(
    headY: number,
    headPitch: number,
    count: number,
    elapsed: number,
    morph: SpeciesMorph,
  ): void {
    if (count < 3) return;
    this.syncUvAndTint(count, morph.hasCoonTail);
    snakeCoreWasm.getExports();
    const f32 = snakeCoreWasm.scalarsF32;
    const sc = Math.max(0.45, Math.min(2.0, f32[SCALAR_F32.snakeScale] || 1.0));
    const headX = f32[SCALAR_F32.headX];
    const headZ = f32[SCALAR_F32.headZ];
    const heading = f32[SCALAR_F32.heading];
    const bulgeT = f32[SCALAR_F32.swallowBulgeT] || 0;
    const segCount = Math.min(count, snakeCoreWasm.scalarsI32[SCALAR_I32.segmentCount] || count);

    this.deformFromPosesBuffer(
      snakeCoreWasm.playerPosesF32,
      headX,
      headY,
      headZ,
      heading,
      headPitch,
      segCount,
      elapsed,
      morph,
      SEGMENT_SPACING * sc,
      HEAD_RADIUS * sc,
      bulgeT,
    );
  }

  public updateHatchling(
    hIdx: number,
    headY: number,
    count: number,
    elapsed: number,
    morph: SpeciesMorph,
    segSpacing: number,
  ): void {
    if (count < 3) return;
    this.syncUvAndTint(count, morph.hasCoonTail);
    const poses = snakeCoreWasm.getHatchlingPoseView(hIdx);
    const hb = hIdx * 16;
    const f32 = snakeCoreWasm.hatchlingsF32;
    const hx = f32[hb + 6];
    const hz = f32[hb + 8];
    const heading = f32[hb + 9];
    const growth = f32[hb + 11];
    if (!Number.isFinite(hx) || !Number.isFinite(hz) || !Number.isFinite(heading)) return;
    const hScale = 0.42 + growth * 0.26;
    this.deformFromPosesBuffer(
      poses,
      hx,
      headY,
      hz,
      heading,
      0,
      count,
      elapsed,
      morph,
      segSpacing,
      HEAD_RADIUS * hScale,
      0,
    );
  }

  public update(
    headX: number,
    headY: number,
    headZ: number,
    heading: number,
    headPitch: number,
    poses: readonly SegmentPose[],
    count: number,
    elapsed: number,
    morph: SpeciesMorph,
    segSpacing = SEGMENT_SPACING,
    headRadius = HEAD_RADIUS,
  ): void {
    if (count < 3) return;
    this.syncUvAndTint(count, morph.hasCoonTail);
    const n = Math.min(count, poses.length);
    const flat = snakeCoreWasm.poseInView;
    for (let i = 0; i < n; i++) {
      const p = poses[i];
      const o = i * 5;
      flat[o] = p.x;
      flat[o + 1] = p.y;
      flat[o + 2] = p.z;
      flat[o + 3] = p.yaw;
      flat[o + 4] = p.radius;
    }
    this.deformFromPosesBuffer(
      flat,
      headX,
      headY,
      headZ,
      heading,
      headPitch,
      n,
      elapsed,
      morph,
      segSpacing,
      headRadius,
      0,
    );
  }

  public dispose(): void {
    this.geometry.dispose();
  }
}

/**
 * 11-station anatomically sculpted viper/python cranium pivoted cleanly at the occipital
 * neck joint (z = 0) so the posterior skull blends seamlessly inside the Hermite neck rings
 * without swinging out on tight turns.
 */
function createSculptedCraniumGeometry(): THREE.BufferGeometry {
  const stations: LoftStation[] = [
    { z: -0.20, rx: 0.175, ryTop: 0.135, ryBot: 0.095, yOff: -0.005 },
    { z: -0.09, rx: 0.255, ryTop: 0.185, ryBot: 0.125, yOff: 0.0 },
    { z: 0.06, rx: 0.37, ryTop: 0.245, ryBot: 0.145, yOff: 0.01, lipFlare: 0.018 }, // temporal venom glands
    { z: 0.20, rx: 0.33, ryTop: 0.225, ryBot: 0.125, yOff: 0.015, browFlare: 0.045, lipFlare: 0.018 },
    { z: 0.34, rx: 0.245, ryTop: 0.20, ryBot: 0.095, yOff: 0.018, browFlare: 0.072, lipFlare: 0.016 }, // recessed orbital socket + brow
    { z: 0.46, rx: 0.22, ryTop: 0.175, ryBot: 0.075, yOff: 0.014, browFlare: 0.056, lipFlare: 0.014 },
    { z: 0.58, rx: 0.185, ryTop: 0.145, ryBot: 0.055, yOff: 0.008, browFlare: 0.015, lipFlare: 0.01 },
    { z: 0.70, rx: 0.14, ryTop: 0.11, ryBot: 0.04, yOff: 0.0 },
    { z: 0.80, rx: 0.095, ryTop: 0.078, ryBot: 0.028, yOff: -0.004 },
    { z: 0.87, rx: 0.055, ryTop: 0.048, ryBot: 0.018, yOff: -0.007 },
    { z: 0.91, rx: 0.02, ryTop: 0.022, ryBot: 0.012, yOff: -0.009 },
  ];
  return createLoftedGeometry(stations, 24, 0.12, 0.88, 1);
}

export function createSnakeHeadRig(
  headMaterial: THREE.Material,
  _scaleMaterial: THREE.Material,
  bellyMaterial: THREE.Material,
  eyeTexture: THREE.Texture,
  enableShadows = true,
): SnakeHeadRig {
  const root = new THREE.Group();

  const skullGeo = createSculptedCraniumGeometry();
  const cranium = new THREE.Mesh(skullGeo, headMaterial);
  cranium.castShadow = enableShadows;
  cranium.receiveShadow = enableShadows;
  root.add(cranium);

  // Kept for API compatibility; cobra hood now deforms dynamically along the spine mesh
  const cobraHood = new THREE.Group();
  cobraHood.visible = false;
  root.add(cobraHood);

  // Deep-set predator eyes nestled cleanly inside the orbital socket below the supraocular brow
  const eyeOuterMat = new THREE.MeshStandardMaterial({
    map: eyeTexture,
    color: 0xffffff,
    roughness: 0.08,
    metalness: 0.08,
  });

  const eyeGeo = new THREE.SphereGeometry(0.062, 16, 14);
  const socketRimMat = new THREE.MeshStandardMaterial({ color: 0x121812, roughness: 0.78 });
  const socketGeo = new THREE.TorusGeometry(0.062, 0.012, 6, 14);

  for (const side of [-1, 1]) {
    const eyeGroup = new THREE.Group();
    eyeGroup.position.set(side * 0.246, 0.084, 0.39);
    eyeGroup.rotation.set(0.04, side * 1.15, 0);

    const eyeBall = new THREE.Mesh(eyeGeo, eyeOuterMat);
    eyeBall.scale.set(1.0, 0.92, 0.92);
    eyeGroup.add(eyeBall);

    const rim = new THREE.Mesh(socketGeo, socketRimMat);
    rim.position.z = -0.01;
    eyeGroup.add(rim);

    root.add(eyeGroup);
  }

  // Nostril & heat-sensing loreal pits
  const pitGeo = new THREE.SphereGeometry(0.017, 8, 8);
  const pitMat = new THREE.MeshStandardMaterial({ color: 0x0a0d0a, roughness: 0.9 });
  for (const side of [-1, 1]) {
    const nostril = new THREE.Mesh(pitGeo, pitMat);
    nostril.position.set(side * 0.078, 0.052, 0.79);
    root.add(nostril);

    const heatPit = new THREE.Mesh(pitGeo, pitMat);
    heatPit.scale.setScalar(0.85);
    heatPit.position.set(side * 0.132, 0.03, 0.65);
    root.add(heatPit);
  }

  // Twin curved maxillary fangs (revealed when lunging/striking)
  const fangMat = new THREE.MeshStandardMaterial({
    color: 0xf6f0dc,
    roughness: 0.2,
    metalness: 0.05,
  });
  const fangGeo = new THREE.ConeGeometry(0.013, 0.09, 7);
  for (const side of [-1, 1]) {
    const fang = new THREE.Mesh(fangGeo, fangMat);
    fang.position.set(side * 0.085, -0.024, 0.67);
    fang.rotation.x = Math.PI + 0.18;
    root.add(fang);
  }

  // Articulated Lower Mandible (tucked strictly inside the upper labial lip line)
  const jawPivot = new THREE.Group();
  jawPivot.position.set(0, -0.044, 0.03);

  const jawShape = new THREE.Shape();
  jawShape.moveTo(0, 0.76);
  jawShape.quadraticCurveTo(0.102, 0.60, 0.128, 0.22);
  jawShape.lineTo(0.095, 0.0);
  jawShape.lineTo(-0.095, 0.0);
  jawShape.lineTo(-0.128, 0.22);
  jawShape.quadraticCurveTo(-0.102, 0.60, 0, 0.76);

  const jawGeo = new THREE.ExtrudeGeometry(jawShape, {
    depth: 0.016,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.004,
    bevelSegments: 2,
  });
  jawGeo.rotateX(Math.PI / 2);

  const jawMesh = new THREE.Mesh(jawGeo, headMaterial);
  jawMesh.castShadow = enableShadows;
  jawPivot.add(jawMesh);

  const palateMat = new THREE.MeshStandardMaterial({
    color: 0x6e242c,
    roughness: 0.32,
  });
  const palate = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.014, 0.38), palateMat);
  palate.position.set(0, 0.007, 0.34);
  jawPivot.add(palate);

  root.add(jawPivot);

  // Forked Crimson Tongue
  const tongueGroup = new THREE.Group();
  tongueGroup.position.set(0, -0.01, 0.72);
  const tongueMat = new THREE.MeshStandardMaterial({
    color: 0xa8192e,
    roughness: 0.25,
    metalness: 0.05,
  });

  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.014, 0.34, 6), tongueMat);
  stem.rotation.x = Math.PI / 2;
  stem.position.z = 0.17;
  tongueGroup.add(stem);

  const forkGeo = new THREE.CylinderGeometry(0.004, 0.01, 0.15, 5);
  forkGeo.rotateX(Math.PI / 2);
  for (const side of [-1, 1]) {
    const fork = new THREE.Mesh(forkGeo, tongueMat);
    fork.position.set(side * 0.03, 0, 0.36);
    fork.rotation.y = side * 0.34;
    tongueGroup.add(fork);
  }
  root.add(tongueGroup);

  return { root, jawPivot, tongueGroup, cobraHood, eyeMaterial: eyeOuterMat };
}

export function createRattleMesh(): THREE.Group {
  const group = new THREE.Group();
  const rattleMat = new THREE.MeshStandardMaterial({
    color: 0xc2ab84,
    roughness: 0.65,
    metalness: 0.04,
  });
  for (let i = 0; i < 6; i++) {
    const r = 0.075 - i * 0.009;
    const bead = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.022, r), 10, 8), rattleMat);
    bead.scale.set(0.95, 0.78, 1.15);
    bead.position.set(0, 0, -i * 0.066);
    group.add(bead);
  }
  return group;
}

export function createBirdRig(): BirdRig {
  const root = new THREE.Group();
  const featherMat = new THREE.MeshStandardMaterial({
    color: 0x3b2c20,
    roughness: 0.85,
    metalness: 0.02,
  });
  const breastMat = new THREE.MeshStandardMaterial({
    color: 0x9c8264,
    roughness: 0.88,
  });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.34, 4, 8), featherMat);
  body.rotation.x = Math.PI / 2;
  root.add(body);

  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), breastMat);
  chest.position.set(0, -0.02, 0.12);
  root.add(chest);

  const beak = new THREE.Mesh(
    new THREE.ConeGeometry(0.032, 0.12, 5),
    new THREE.MeshStandardMaterial({ color: 0xd99e32, roughness: 0.4 }),
  );
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.01, 0.3);
  root.add(beak);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.02, 0.24), featherMat);
  tail.position.set(0, 0.01, -0.32);
  root.add(tail);

  const makeWing = (side: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.08, 0.02, 0.02);
    const inner = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, 0.2), featherMat);
    inner.position.set(side * 0.21, 0, -0.02);
    pivot.add(inner);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.015, 0.13), featherMat);
    tip.position.set(side * 0.52, -0.01, -0.06);
    tip.rotation.y = side * -0.22;
    pivot.add(tip);
    return pivot;
  };

  const leftWing = makeWing(-1);
  const rightWing = makeWing(1);
  root.add(leftWing, rightWing);
  return { root, leftWing, rightWing };
}

export function createNaturalRockGeometry(seed: number, detail = 2): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1.0, detail);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n1 = Math.sin(x * 2.4 + seed) * Math.cos(z * 2.1 - seed * 0.7);
    const n2 = Math.sin((x + y) * 4.2 + seed * 1.3) * 0.14;
    const disp = 0.85 + n1 * 0.22 + n2;
    const flatBottom = y < -0.25 ? 0.55 : 1.0;
    pos.setXYZ(i, x * disp * 1.15, y * disp * 0.78 * flatBottom, z * disp);
  }
  geo.computeVertexNormals();
  return geo;
}

export function createFernRosetteGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const frondCount = 7;

  for (let i = 0; i < frondCount; i++) {
    const angle = (i / frondCount) * Math.PI * 2 + (i % 2) * 0.22;
    const frond = new THREE.BoxGeometry(0.16, 0.02, 1.05, 1, 1, 5);
    const pos = frond.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const z = pos.getZ(v);
      const t = (z + 0.525) / 1.05;
      const archY = Math.sin(t * Math.PI * 0.78) * 0.45;
      const taperX = pos.getX(v) * (1 - Math.pow(Math.abs(t - 0.35), 1.35) * 1.15);
      pos.setXYZ(v, taperX, pos.getY(v) + archY, t * 0.96);
    }
    frond.rotateY(angle);
    frond.computeVertexNormals();
    parts.push(frond);
  }

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

export function createGrassTuftGeometry(): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = [];
  const bladeCount = 7;
  for (let i = 0; i < bladeCount; i++) {
    const angle = (i / bladeCount) * Math.PI * 2 + (i % 2) * 0.35;
    const h = 0.24 + (i % 3) * 0.09;
    const blade = new THREE.PlaneGeometry(0.055, h, 1, 3);
    const pos = blade.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const rawY = pos.getY(v);
      const t = Math.max(0, Math.min(1, (rawY + h * 0.5) / h));
      const taper = 1 - Math.pow(t, 1.35);
      const bendZ = t * t * (0.14 + (i % 3) * 0.05);
      pos.setXYZ(v, pos.getX(v) * taper, t * h, bendZ);
    }
    blade.rotateY(angle);
    blade.translate(Math.cos(angle) * 0.07, 0, Math.sin(angle) * 0.07);
    blade.computeVertexNormals();
    blades.push(blade);
  }
  const merged = mergeGeometries(blades, false);
  for (const b of blades) b.dispose();
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

interface SharedPreyAssets {
  shadowTexture: THREE.Texture;
  shadowDiscGeo: THREE.BufferGeometry;
  shadowMat: THREE.MeshBasicMaterial;
  twigMat: THREE.MeshStandardMaterial;
  nestRingGeo: THREE.BufferGeometry;
  nestTwigGeo: THREE.BufferGeometry;
  nestEggGeo: THREE.BufferGeometry;
  nestEggMat: THREE.MeshStandardMaterial;
  berryMat: THREE.MeshStandardMaterial;
  leafMat: THREE.MeshStandardMaterial;
  berryLobeGeo: THREE.BufferGeometry;
  berryLeafGeo: THREE.BufferGeometry;
  eyeMat: THREE.MeshStandardMaterial;
  whiskerGeo: THREE.BufferGeometry;
  rabbitWhiskerMat: THREE.MeshBasicMaterial;
  mouseWhiskerMat: THREE.MeshBasicMaterial;
  rabbitTorsoGeo: THREE.BufferGeometry;
  rabbitChestGeo: THREE.BufferGeometry;
  rabbitHeadGeo: THREE.BufferGeometry;
  rabbitNoseGeo: THREE.BufferGeometry;
  rabbitEarGeo: THREE.BufferGeometry;
  rabbitEyeGeo: THREE.BufferGeometry;
  rabbitTailGeo: THREE.BufferGeometry;
  rabbitForeArmGeo: THREE.BufferGeometry;
  rabbitForePawGeo: THREE.BufferGeometry;
  rabbitThighGeo: THREE.BufferGeometry;
  rabbitShinGeo: THREE.BufferGeometry;
  rabbitHindFootGeo: THREE.BufferGeometry;
  mouseTorsoGeo: THREE.BufferGeometry;
  mouseHeadGeo: THREE.BufferGeometry;
  mouseNoseGeo: THREE.BufferGeometry;
  mouseEarGeo: THREE.BufferGeometry;
  mouseEyeGeo: THREE.BufferGeometry;
  mouseLegGeo: THREE.BufferGeometry;
  mousePawGeo: THREE.BufferGeometry;
  mouseTailGeos: THREE.BufferGeometry[];
  frogEyeMat: THREE.MeshStandardMaterial;
  frogTorsoGeo: THREE.BufferGeometry;
  frogThroatGeo: THREE.BufferGeometry;
  frogThroatMat: THREE.MeshStandardMaterial;
  frogThighGeo: THREE.BufferGeometry;
  frogCalfGeo: THREE.BufferGeometry;
  frogEyeGeo: THREE.BufferGeometry;
  frogPupilGeo: THREE.BufferGeometry;
  frogFrontLegGeo: THREE.BufferGeometry;
  deerTorsoGeo: THREE.BufferGeometry;
  deerBellyGeo: THREE.BufferGeometry;
  deerNeckGeo: THREE.BufferGeometry;
  deerHeadGeo: THREE.BufferGeometry;
  deerEarGeo: THREE.BufferGeometry;
  deerAntlerGeo: THREE.BufferGeometry;
  deerLegGeo: THREE.BufferGeometry;
  deerHoofGeo: THREE.BufferGeometry;
  deerTailGeo: THREE.BufferGeometry;
  boarTorsoGeo: THREE.BufferGeometry;
  boarHeadGeo: THREE.BufferGeometry;
  boarSnoutGeo: THREE.BufferGeometry;
  boarTuskGeo: THREE.BufferGeometry;
  boarLegGeo: THREE.BufferGeometry;
  boarCrestGeo: THREE.BufferGeometry;
  elephantTorsoGeo: THREE.BufferGeometry;
  elephantHeadGeo: THREE.BufferGeometry;
  elephantEarGeo: THREE.BufferGeometry;
  elephantTuskGeo: THREE.BufferGeometry;
  elephantTrunkUpperGeo: THREE.BufferGeometry;
  elephantTrunkLowerGeo: THREE.BufferGeometry;
  elephantLegGeo: THREE.BufferGeometry;
  elephantFootGeo: THREE.BufferGeometry;
  elephantTailGeo: THREE.BufferGeometry;
}

interface SharedHumanAssets {
  shadowTexture: THREE.Texture;
  humanTex: HumanTextureSet;
  shadowDiscGeo: THREE.BufferGeometry;
  shadowMat: THREE.MeshBasicMaterial;
  telegraphRingGeo: THREE.BufferGeometry;
  telegraphMatRegular: THREE.MeshBasicMaterial;
  telegraphMatElite: THREE.MeshBasicMaterial;
  hitFlashMat: THREE.MeshStandardMaterial;
  poisonMat: THREE.MeshStandardMaterial;
  leatherMat: THREE.MeshStandardMaterial;
  woodMat: THREE.MeshStandardMaterial;
  eyeMat: THREE.MeshStandardMaterial;
  brassMat: THREE.MeshStandardMaterial;
  steelMatRegular: THREE.MeshStandardMaterial;
  steelMatElite: THREE.MeshStandardMaterial;
  capeMat: THREE.MeshStandardMaterial;
  cloakCrossbowMat: THREE.MeshStandardMaterial;
  cloakHideMat: THREE.MeshStandardMaterial;
  fletchMat: THREE.MeshStandardMaterial;
  crestMat: THREE.MeshStandardMaterial;
  featherGoldMat: THREE.MeshStandardMaterial;
  featherRedMat: THREE.MeshStandardMaterial;
  strawMat: THREE.MeshStandardMaterial;
  bowStringMat: THREE.MeshBasicMaterial;
  skinMats: Map<number, THREE.MeshStandardMaterial>;
  tunicMats: Map<number, THREE.MeshStandardMaterial>;
  skirtMats: Map<number, THREE.MeshStandardMaterial>;
  trouserMats: Map<number, THREE.MeshStandardMaterial>;
  hairMats: Map<number, THREE.MeshStandardMaterial>;
  hipGirdleGeo: THREE.BufferGeometry;
  tunicSkirtGeo: THREE.BufferGeometry;
  thighGeo: THREE.BufferGeometry;
  calfGeo: THREE.BufferGeometry;
  kneeCapGeo: THREE.BufferGeometry;
  bootShaftGeo: THREE.BufferGeometry;
  bootCuffGeo: THREE.BufferGeometry;
  bootFootGeo: THREE.BufferGeometry;
  torsoGeo: THREE.BufferGeometry;
  neckGeo: THREE.BufferGeometry;
  beltGeo: THREE.BufferGeometry;
  buckleGeo: THREE.BufferGeometry;
  pouchGeo: THREE.BufferGeometry;
  cuirassGeo: THREE.BufferGeometry;
  pauldronGeo: THREE.BufferGeometry;
  capeGeo: THREE.BufferGeometry;
  cloakGeo: THREE.BufferGeometry;
  qTubeGeo: THREE.BufferGeometry;
  qBoltEndGeo: THREE.BufferGeometry;
  vestGeo: THREE.BufferGeometry;
  craniumGeo: THREE.BufferGeometry;
  jawGeo: THREE.BufferGeometry;
  earGeo: THREE.BufferGeometry;
  noseGeo: THREE.BufferGeometry;
  eyeGeo: THREE.BufferGeometry;
  browGeo: THREE.BufferGeometry;
  beardGeo: THREE.BufferGeometry;
  helmGeo: THREE.BufferGeometry;
  helmBrimGeo: THREE.BufferGeometry;
  nasalBarGeo: THREE.BufferGeometry;
  crestGeo: THREE.BufferGeometry;
  hatBrimGeo: THREE.BufferGeometry;
  hatCrownGeo: THREE.BufferGeometry;
  featherGeo: THREE.BufferGeometry;
  strawBrimGeo: THREE.BufferGeometry;
  strawTopGeo: THREE.BufferGeometry;
  hatBandGeo: THREE.BufferGeometry;
  hairGeo: THREE.BufferGeometry;
  hoodGeo: THREE.BufferGeometry;
  shoulderGeo: THREE.BufferGeometry;
  upperArmGeo: THREE.BufferGeometry;
  forearmGeo: THREE.BufferGeometry;
  handGeo: THREE.BufferGeometry;
  shieldWoodGeo: THREE.BufferGeometry;
  shieldRimGeo: THREE.BufferGeometry;
  shieldBossGeo: THREE.BufferGeometry;
  shaftGeo: THREE.BufferGeometry;
  gripWrapGeo: THREE.BufferGeometry;
  socketGeo: THREE.BufferGeometry;
  bladeGeo: THREE.BufferGeometry;
  stockGeo: THREE.BufferGeometry;
  bowArcGeo: THREE.BufferGeometry;
  bowStringGeo: THREE.BufferGeometry;
  loadedBoltGeo: THREE.BufferGeometry;
}

interface SharedEggAssets {
  shadowTexture: THREE.Texture;
  shadowGeo: THREE.BufferGeometry;
  shadowMat: THREE.MeshBasicMaterial;
  twigMat: THREE.MeshStandardMaterial;
  twigGeo: THREE.BufferGeometry;
  eggGeo: THREE.BufferGeometry;
}

interface SharedBoltAssets {
  shaftGeo: THREE.BufferGeometry;
  shaftMat: THREE.MeshStandardMaterial;
  tipGeo: THREE.BufferGeometry;
  tipMat: THREE.MeshStandardMaterial;
  fletchGeo: THREE.BufferGeometry;
  fletchMat: THREE.MeshStandardMaterial;
  venomCoreGeo: THREE.BufferGeometry;
  venomDropGeo: THREE.BufferGeometry;
  venomMat: THREE.MeshStandardMaterial;
  mistOrbGeo: THREE.BufferGeometry;
  mistMat: THREE.MeshStandardMaterial;
}

let cachedPreyAssets: SharedPreyAssets | null = null;
let cachedHumanAssets: SharedHumanAssets | null = null;
let cachedEggAssets: SharedEggAssets | null = null;
let cachedBoltAssets: SharedBoltAssets | null = null;

interface SharedBuildingDetails {
  trimMat: THREE.MeshStandardMaterial;
  warmWindowMat: THREE.MeshStandardMaterial;
  rugMat: THREE.MeshStandardMaterial;
  emberMat: THREE.MeshStandardMaterial;
  hayMat: THREE.MeshStandardMaterial;
}

let cachedBuildingDetails: SharedBuildingDetails | null = null;
function getSharedBuildingDetails(): SharedBuildingDetails {
  if (!cachedBuildingDetails) {
    cachedBuildingDetails = {
      trimMat: new THREE.MeshStandardMaterial({ color: 0x26180f, roughness: 0.88 }),
      warmWindowMat: new THREE.MeshStandardMaterial({
        color: 0xffd27d,
        emissive: 0xd98422,
        emissiveIntensity: 0.95,
        roughness: 0.25,
      }),
      rugMat: new THREE.MeshStandardMaterial({ color: 0x70261e, roughness: 0.94 }),
      emberMat: new THREE.MeshStandardMaterial({
        color: 0xff7b24,
        emissive: 0xe64d12,
        emissiveIntensity: 1.6,
        roughness: 0.4,
      }),
      hayMat: new THREE.MeshStandardMaterial({ color: 0xc29e44, roughness: 0.94 }),
    };
  }
  return cachedBuildingDetails;
}

function disposeAssetRecord(record: object | null): void {
  if (!record) return;
  for (const val of Object.values(record)) {
    if (!val) continue;
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item && typeof (item as { dispose?: () => void }).dispose === 'function') {
          (item as { dispose: () => void }).dispose();
        }
      }
    } else if (val instanceof Map) {
      for (const item of val.values()) {
        if (item && typeof (item as { dispose?: () => void }).dispose === 'function') {
          (item as { dispose: () => void }).dispose();
        }
      }
      val.clear();
    } else if (typeof (val as { dispose?: () => void }).dispose === 'function') {
      // Do not dispose caller-owned textures (shadowTexture, humanTex)
      if ((val as THREE.Texture).isTexture) continue;
      (val as { dispose: () => void }).dispose();
    }
  }
}

export function disposeSharedRigAssets(): void {
  disposeAssetRecord(cachedPreyAssets);
  cachedPreyAssets = null;
  disposeAssetRecord(cachedHumanAssets);
  cachedHumanAssets = null;
  disposeAssetRecord(cachedEggAssets);
  cachedEggAssets = null;
  disposeAssetRecord(cachedBoltAssets);
  cachedBoltAssets = null;
  if (cachedBuildingDetails) {
    cachedBuildingDetails.trimMat.dispose();
    cachedBuildingDetails.warmWindowMat.dispose();
    cachedBuildingDetails.rugMat.dispose();
    cachedBuildingDetails.emberMat.dispose();
    cachedBuildingDetails.hayMat.dispose();
    cachedBuildingDetails = null;
  }
}

function getSharedPreyAssets(shadowTexture: THREE.Texture): SharedPreyAssets {
  if (cachedPreyAssets && cachedPreyAssets.shadowTexture === shadowTexture) {
    return cachedPreyAssets;
  }
  if (cachedPreyAssets) {
    disposeAssetRecord(cachedPreyAssets);
  }

  const eggPts: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const r = Math.sin(t * Math.PI) * (0.16 - t * 0.04);
    eggPts.push(new THREE.Vector2(Math.max(0.001, r), t * 0.38));
  }

  const berryLeafGeo = new THREE.ConeGeometry(0.13, 0.34, 4);
  berryLeafGeo.scale(1, 1, 0.28);

  const whiskerGeo = new THREE.CylinderGeometry(0.002, 0.004, 0.145, 4);
  whiskerGeo.rotateZ(Math.PI / 2);

  const rabbitEarGeo = createLoftedGeometry([
    { z: -0.02, rx: 0.032, ryTop: 0.018, ryBot: 0.015, yOff: 0.0 },
    { z: 0.08, rx: 0.055, ryTop: 0.02, ryBot: 0.01, yOff: 0.005 },
    { z: 0.22, rx: 0.058, ryTop: 0.018, ryBot: 0.008, yOff: 0.005 },
    { z: 0.34, rx: 0.022, ryTop: 0.01, ryBot: 0.005, yOff: 0.0 },
  ], 10);
  rabbitEarGeo.rotateX(-Math.PI / 2);

  const mouseTailGeos: THREE.BufferGeometry[] = [];
  for (let t = 0; t < 5; t++) {
    const rTop = 0.024 - t * 0.0038;
    const rBot = 0.02 - t * 0.0036;
    const segGeo = new THREE.CylinderGeometry(rBot, rTop, 0.105, 6);
    segGeo.rotateX(Math.PI / 2);
    segGeo.translate(0, 0, -0.052);
    mouseTailGeos.push(segGeo);
  }

  cachedPreyAssets = {
    shadowTexture,
    shadowDiscGeo: new THREE.CircleGeometry(0.84, 14),
    shadowMat: new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
    }),
    twigMat: new THREE.MeshStandardMaterial({ color: 0x4f361e, roughness: 0.94 }),
    nestRingGeo: new THREE.TorusGeometry(0.42, 0.08, 7, 16),
    nestTwigGeo: new THREE.CylinderGeometry(0.022, 0.028, 0.46, 5),
    nestEggGeo: new THREE.LatheGeometry(eggPts, 14),
    nestEggMat: new THREE.MeshStandardMaterial({
      color: 0xf1dd9f,
      roughness: 0.34,
      metalness: 0.02,
      emissive: 0x3b2a09,
      emissiveIntensity: 0.25,
    }),
    berryMat: new THREE.MeshStandardMaterial({
      color: 0xc22032,
      roughness: 0.2,
      metalness: 0.04,
      emissive: 0x45060e,
      emissiveIntensity: 0.32,
    }),
    leafMat: new THREE.MeshStandardMaterial({ color: 0x266328, roughness: 0.68 }),
    berryLobeGeo: new THREE.SphereGeometry(0.17, 10, 8),
    berryLeafGeo,
    eyeMat: new THREE.MeshStandardMaterial({
      color: 0x100c0a,
      roughness: 0.08,
      metalness: 0.06,
    }),
    whiskerGeo,
    rabbitWhiskerMat: new THREE.MeshBasicMaterial({ color: 0xe8e2d5 }),
    mouseWhiskerMat: new THREE.MeshBasicMaterial({ color: 0xd9d4ca }),
    rabbitTorsoGeo: createLoftedGeometry([
      { z: -0.44, rx: 0.02, ryTop: 0.02, ryBot: 0.02, yOff: 0.24 },
      { z: -0.36, rx: 0.2, ryTop: 0.21, ryBot: 0.14, yOff: 0.26 },
      { z: -0.18, rx: 0.25, ryTop: 0.26, ryBot: 0.16, yOff: 0.29 },
      { z: 0.04, rx: 0.19, ryTop: 0.2, ryBot: 0.14, yOff: 0.26 },
      { z: 0.22, rx: 0.18, ryTop: 0.19, ryBot: 0.14, yOff: 0.27 },
      { z: 0.34, rx: 0.11, ryTop: 0.12, ryBot: 0.1, yOff: 0.29 },
    ], 14),
    rabbitChestGeo: new THREE.SphereGeometry(0.14, 10, 8),
    rabbitHeadGeo: createLoftedGeometry([
      { z: -0.12, rx: 0.12, ryTop: 0.13, ryBot: 0.11, yOff: 0.02 },
      { z: -0.02, rx: 0.16, ryTop: 0.16, ryBot: 0.12, yOff: 0.04 },
      { z: 0.1, rx: 0.13, ryTop: 0.13, ryBot: 0.09, yOff: 0.03 },
      { z: 0.21, rx: 0.08, ryTop: 0.075, ryBot: 0.055, yOff: 0.01 },
      { z: 0.26, rx: 0.03, ryTop: 0.03, ryBot: 0.02, yOff: 0.0 },
    ], 12),
    rabbitNoseGeo: new THREE.SphereGeometry(0.026, 8, 8),
    rabbitEarGeo,
    rabbitEyeGeo: new THREE.SphereGeometry(0.028, 8, 8),
    rabbitTailGeo: new THREE.SphereGeometry(0.095, 8, 8),
    rabbitForeArmGeo: new THREE.CapsuleGeometry(0.042, 0.14, 4, 8),
    rabbitForePawGeo: new THREE.CapsuleGeometry(0.034, 0.08, 4, 6),
    rabbitThighGeo: new THREE.SphereGeometry(0.115, 8, 8),
    rabbitShinGeo: new THREE.CapsuleGeometry(0.044, 0.14, 4, 6),
    rabbitHindFootGeo: new THREE.CapsuleGeometry(0.036, 0.18, 4, 6),
    mouseTorsoGeo: createLoftedGeometry([
      { z: -0.25, rx: 0.02, ryTop: 0.02, ryBot: 0.02, yOff: 0.12 },
      { z: -0.16, rx: 0.15, ryTop: 0.14, ryBot: 0.08, yOff: 0.14 },
      { z: 0.0, rx: 0.16, ryTop: 0.15, ryBot: 0.08, yOff: 0.14 },
      { z: 0.14, rx: 0.12, ryTop: 0.11, ryBot: 0.07, yOff: 0.13 },
    ], 12),
    mouseHeadGeo: createLoftedGeometry([
      { z: -0.03, rx: 0.11, ryTop: 0.1, ryBot: 0.07, yOff: 0.0 },
      { z: 0.08, rx: 0.085, ryTop: 0.08, ryBot: 0.05, yOff: -0.005 },
      { z: 0.2, rx: 0.04, ryTop: 0.038, ryBot: 0.025, yOff: -0.01 },
      { z: 0.25, rx: 0.015, ryTop: 0.015, ryBot: 0.01, yOff: -0.012 },
    ], 10),
    mouseNoseGeo: new THREE.SphereGeometry(0.024, 6, 6),
    mouseEarGeo: new THREE.CylinderGeometry(0.07, 0.07, 0.016, 10),
    mouseEyeGeo: new THREE.SphereGeometry(0.024, 8, 6),
    mouseLegGeo: new THREE.CapsuleGeometry(0.024, 0.075, 4, 6),
    mousePawGeo: new THREE.SphereGeometry(0.026, 6, 6),
    mouseTailGeos,
    frogEyeMat: new THREE.MeshStandardMaterial({
      color: 0xe6a829,
      roughness: 0.1,
      metalness: 0.06,
    }),
    frogTorsoGeo: createLoftedGeometry([
      { z: -0.24, rx: 0.14, ryTop: 0.1, ryBot: 0.06, yOff: 0.14 },
      { z: -0.06, rx: 0.23, ryTop: 0.17, ryBot: 0.08, yOff: 0.18 },
      { z: 0.14, rx: 0.21, ryTop: 0.16, ryBot: 0.08, yOff: 0.21 },
      { z: 0.3, rx: 0.14, ryTop: 0.11, ryBot: 0.06, yOff: 0.22 },
      { z: 0.38, rx: 0.05, ryTop: 0.05, ryBot: 0.03, yOff: 0.2 },
    ], 12),
    frogThroatGeo: new THREE.SphereGeometry(0.11, 8, 8),
    frogThroatMat: new THREE.MeshStandardMaterial({ color: 0xa9c97b, roughness: 0.4 }),
    frogThighGeo: new THREE.CapsuleGeometry(0.058, 0.18, 4, 6),
    frogCalfGeo: new THREE.CapsuleGeometry(0.038, 0.2, 4, 6),
    frogEyeGeo: new THREE.SphereGeometry(0.054, 8, 8),
    frogPupilGeo: new THREE.BoxGeometry(0.012, 0.025, 0.048),
    frogFrontLegGeo: new THREE.CapsuleGeometry(0.034, 0.18, 4, 6),
    deerTorsoGeo: createLoftedGeometry([
      { z: -0.48, rx: 0.06, ryTop: 0.08, ryBot: 0.06, yOff: 0.72 },
      { z: -0.34, rx: 0.19, ryTop: 0.23, ryBot: 0.16, yOff: 0.72 },
      { z: -0.08, rx: 0.17, ryTop: 0.21, ryBot: 0.15, yOff: 0.71 },
      { z: 0.2, rx: 0.21, ryTop: 0.25, ryBot: 0.18, yOff: 0.72 },
      { z: 0.4, rx: 0.16, ryTop: 0.2, ryBot: 0.14, yOff: 0.74 },
      { z: 0.5, rx: 0.05, ryTop: 0.07, ryBot: 0.05, yOff: 0.75 },
    ], 12),
    deerBellyGeo: new THREE.CapsuleGeometry(0.11, 0.44, 4, 8),
    deerNeckGeo: new THREE.CylinderGeometry(0.085, 0.135, 0.46, 8),
    deerHeadGeo: createLoftedGeometry([
      { z: -0.06, rx: 0.09, ryTop: 0.1, ryBot: 0.07, yOff: 0.02 },
      { z: 0.06, rx: 0.125, ryTop: 0.13, ryBot: 0.085, yOff: 0.03 },
      { z: 0.18, rx: 0.08, ryTop: 0.08, ryBot: 0.055, yOff: 0.01 },
      { z: 0.31, rx: 0.042, ryTop: 0.042, ryBot: 0.03, yOff: -0.01 },
      { z: 0.36, rx: 0.018, ryTop: 0.02, ryBot: 0.014, yOff: -0.015 },
    ], 10),
    deerEarGeo: new THREE.ConeGeometry(0.048, 0.17, 6),
    deerAntlerGeo: new THREE.CylinderGeometry(0.015, 0.025, 0.42, 6),
    deerLegGeo: new THREE.CapsuleGeometry(0.04, 0.6, 4, 6),
    deerHoofGeo: new THREE.CylinderGeometry(0.035, 0.042, 0.06, 6),
    deerTailGeo: new THREE.SphereGeometry(0.07, 6, 6),
    boarTorsoGeo: createLoftedGeometry([
      { z: -0.54, rx: 0.08, ryTop: 0.09, ryBot: 0.07, yOff: 0.52 },
      { z: -0.38, rx: 0.25, ryTop: 0.28, ryBot: 0.21, yOff: 0.52 },
      { z: -0.08, rx: 0.29, ryTop: 0.31, ryBot: 0.24, yOff: 0.52 },
      { z: 0.22, rx: 0.3, ryTop: 0.34, ryBot: 0.24, yOff: 0.53 },
      { z: 0.44, rx: 0.23, ryTop: 0.26, ryBot: 0.19, yOff: 0.53 },
      { z: 0.54, rx: 0.1, ryTop: 0.12, ryBot: 0.09, yOff: 0.52 },
    ], 12),
    boarHeadGeo: createLoftedGeometry([
      { z: -0.04, rx: 0.19, ryTop: 0.2, ryBot: 0.15, yOff: 0.02 },
      { z: 0.14, rx: 0.22, ryTop: 0.22, ryBot: 0.16, yOff: 0.02 },
      { z: 0.32, rx: 0.14, ryTop: 0.13, ryBot: 0.1, yOff: -0.02 },
      { z: 0.48, rx: 0.095, ryTop: 0.09, ryBot: 0.075, yOff: -0.045 },
      { z: 0.54, rx: 0.05, ryTop: 0.05, ryBot: 0.04, yOff: -0.055 },
    ], 10),
    boarSnoutGeo: new THREE.CylinderGeometry(0.095, 0.095, 0.05, 8),
    boarTuskGeo: new THREE.ConeGeometry(0.028, 0.19, 5),
    boarLegGeo: new THREE.CapsuleGeometry(0.07, 0.36, 4, 6),
    boarCrestGeo: new THREE.CapsuleGeometry(0.04, 0.56, 4, 6),
    elephantTorsoGeo: createLoftedGeometry([
      { z: -1.26, rx: 0.24, ryTop: 0.26, ryBot: 0.22, yOff: 1.54 },
      { z: -0.95, rx: 0.64, ryTop: 0.72, ryBot: 0.56, yOff: 1.56 },
      { z: -0.3, rx: 0.78, ryTop: 0.86, ryBot: 0.68, yOff: 1.62 },
      { z: 0.4, rx: 0.76, ryTop: 0.88, ryBot: 0.68, yOff: 1.65 },
      { z: 0.95, rx: 0.64, ryTop: 0.74, ryBot: 0.56, yOff: 1.66 },
      { z: 1.24, rx: 0.28, ryTop: 0.32, ryBot: 0.24, yOff: 1.64 },
    ], 14),
    elephantHeadGeo: new THREE.SphereGeometry(0.72, 12, 10),
    elephantEarGeo: new THREE.SphereGeometry(0.56, 10, 8),
    elephantTuskGeo: new THREE.ConeGeometry(0.075, 0.96, 7),
    elephantTrunkUpperGeo: new THREE.CylinderGeometry(0.15, 0.22, 0.82, 8),
    elephantTrunkLowerGeo: new THREE.CylinderGeometry(0.085, 0.15, 0.84, 8),
    elephantLegGeo: new THREE.CylinderGeometry(0.25, 0.29, 1.2, 10),
    elephantFootGeo: new THREE.CylinderGeometry(0.32, 0.33, 0.14, 10),
    elephantTailGeo: new THREE.CylinderGeometry(0.03, 0.05, 0.72, 6),
  };
  return cachedPreyAssets;
}

/**
 * Builds articulated, biomechanically proportioned wildlife rigs (Rabbit, Mouse, Frog)
 * sharing pooled geometries and static materials for minimal GPU/memory footprint.
 */
export function createPreyRig(
  kind: PreyKind,
  shadowTexture: THREE.Texture,
  animalMats: AnimalMaterialSet,
  enableShadows = true,
): AnimalRig {
  const A = getSharedPreyAssets(shadowTexture);
  const root = new THREE.Group();
  root.scale.setScalar(1.24);

  const shadowDisc = new THREE.Mesh(A.shadowDiscGeo, A.shadowMat);
  shadowDisc.rotation.x = -Math.PI / 2;
  shadowDisc.position.y = 0.015;
  root.add(shadowDisc);

  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);

  if (kind === 'egg') {
    const nestRing = new THREE.Mesh(A.nestRingGeo, A.twigMat);
    nestRing.rotation.x = Math.PI / 2;
    nestRing.position.y = 0.08;
    nestRing.castShadow = enableShadows;
    bodyPivot.add(nestRing);

    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const twig = new THREE.Mesh(A.nestTwigGeo, A.twigMat);
      twig.rotation.z = Math.PI / 2;
      twig.rotation.y = a + 0.4;
      twig.position.set(Math.cos(a) * 0.38, 0.1, Math.sin(a) * 0.38);
      bodyPivot.add(twig);
    }

    for (const [ex, ey, ez, rx, rz] of [
      [0, 0.06, 0.08, 0.15, 0.1],
      [-0.16, 0.05, -0.1, -0.2, 0.25],
      [0.16, 0.05, -0.09, 0.18, -0.22],
    ]) {
      const egg = new THREE.Mesh(A.nestEggGeo, A.nestEggMat);
      egg.position.set(ex, ey, ez);
      egg.rotation.set(rx, 0, rz);
      egg.castShadow = enableShadows;
      bodyPivot.add(egg);
    }
    return { root, kind, bodyPivot };
  }

  if (kind === 'berry') {
    for (const [bx, by, bz] of [
      [0, 0.33, 0],
      [0.14, 0.21, 0.08],
      [-0.14, 0.21, 0.08],
      [0.08, 0.21, -0.14],
      [-0.08, 0.21, -0.14],
    ]) {
      const lobe = new THREE.Mesh(A.berryLobeGeo, A.berryMat);
      lobe.position.set(bx, by, bz);
      lobe.castShadow = enableShadows;
      bodyPivot.add(lobe);
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const leaf = new THREE.Mesh(A.berryLeafGeo, A.leafMat);
      leaf.position.set(Math.cos(a) * 0.19, 0.43, Math.sin(a) * 0.19);
      leaf.rotation.z = -Math.PI * 0.38;
      leaf.rotation.y = a;
      bodyPivot.add(leaf);
    }
    return { root, kind, bodyPivot };
  }

  if (kind === 'rabbit') {
    const { rabbitFurMat, rabbitBellyMat, pinkSkinMat } = animalMats;

    const torso = new THREE.Mesh(A.rabbitTorsoGeo, rabbitFurMat);
    torso.castShadow = enableShadows;
    bodyPivot.add(torso);

    const chestPatch = new THREE.Mesh(A.rabbitChestGeo, rabbitBellyMat);
    chestPatch.scale.set(0.85, 0.95, 1.15);
    chestPatch.position.set(0, 0.23, 0.22);
    bodyPivot.add(chestPatch);

    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.33, 0.29);

    const headMesh = new THREE.Mesh(A.rabbitHeadGeo, rabbitFurMat);
    headMesh.castShadow = enableShadows;
    headPivot.add(headMesh);

    const nose = new THREE.Mesh(A.rabbitNoseGeo, pinkSkinMat);
    nose.position.set(0, 0.015, 0.255);
    headPivot.add(nose);

    const ears: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const earPivot = new THREE.Group();
      earPivot.position.set(side * 0.068, 0.145, -0.02);
      earPivot.rotation.set(-0.28, side * 0.14, side * -0.16);
      const earOuter = new THREE.Mesh(A.rabbitEarGeo, rabbitFurMat);
      earOuter.castShadow = enableShadows;
      earPivot.add(earOuter);
      const earInner = new THREE.Mesh(A.rabbitEarGeo, pinkSkinMat);
      earInner.scale.set(0.68, 0.72, 0.85);
      earInner.position.z = 0.012;
      earPivot.add(earInner);
      headPivot.add(earPivot);
      ears.push(earPivot);

      const eye = new THREE.Mesh(A.rabbitEyeGeo, A.eyeMat);
      eye.position.set(side * 0.118, 0.075, 0.09);
      headPivot.add(eye);

      for (let w = 0; w < 2; w++) {
        const wh = new THREE.Mesh(A.whiskerGeo, A.rabbitWhiskerMat);
        wh.position.set(side * 0.085, 0.01 - w * 0.015, 0.21);
        wh.rotation.y = side * (-0.25 + w * 0.22);
        headPivot.add(wh);
      }
    }
    bodyPivot.add(headPivot);

    const tailPivot = new THREE.Group();
    tailPivot.position.set(0, 0.25, -0.43);
    const tailBall = new THREE.Mesh(A.rabbitTailGeo, rabbitBellyMat);
    tailBall.scale.set(0.95, 1.05, 1.15);
    tailPivot.add(tailBall);
    bodyPivot.add(tailPivot);

    const makeForeleg = (side: number) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.12, 0.21, 0.2);
      const arm = new THREE.Mesh(A.rabbitForeArmGeo, rabbitFurMat);
      arm.position.set(0, -0.08, 0.02);
      arm.rotation.x = 0.18;
      shoulder.add(arm);
      const paw = new THREE.Mesh(A.rabbitForePawGeo, rabbitBellyMat);
      paw.rotation.x = Math.PI / 2;
      paw.position.set(0, -0.175, 0.06);
      shoulder.add(paw);
      bodyPivot.add(shoulder);
      return shoulder;
    };

    const makeHindleg = (side: number) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.17, 0.23, -0.19);
      const thigh = new THREE.Mesh(A.rabbitThighGeo, rabbitFurMat);
      thigh.scale.set(0.72, 1.15, 1.38);
      thigh.position.set(0, -0.05, -0.02);
      thigh.castShadow = enableShadows;
      hip.add(thigh);

      const lowerPivot = new THREE.Group();
      lowerPivot.position.set(0, -0.14, -0.09);
      const shin = new THREE.Mesh(A.rabbitShinGeo, rabbitFurMat);
      shin.position.set(0, -0.02, 0.08);
      shin.rotation.x = Math.PI / 2 - 0.35;
      lowerPivot.add(shin);
      const foot = new THREE.Mesh(A.rabbitHindFootGeo, rabbitBellyMat);
      foot.rotation.x = Math.PI / 2;
      foot.position.set(0, -0.06, 0.18);
      lowerPivot.add(foot);
      hip.add(lowerPivot);
      bodyPivot.add(hip);
      return { hip, lowerPivot };
    };

    const frontLeftLeg = makeForeleg(-1);
    const frontRightLeg = makeForeleg(1);
    const hl = makeHindleg(-1);
    const hr = makeHindleg(1);

    return {
      root,
      kind,
      bodyPivot,
      headPivot,
      leftEar: ears[0],
      rightEar: ears[1],
      frontLeftLeg,
      frontRightLeg,
      hindLeftLeg: hl.hip,
      hindRightLeg: hr.hip,
      hindLeftLower: hl.lowerPivot,
      hindRightLower: hr.lowerPivot,
      tailPivot,
    };
  }

  if (kind === 'mouse') {
    const { mouseFurMat, pinkSkinMat } = animalMats;

    const torso = new THREE.Mesh(A.mouseTorsoGeo, mouseFurMat);
    torso.castShadow = enableShadows;
    bodyPivot.add(torso);

    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.14, 0.14);
    const headMesh = new THREE.Mesh(A.mouseHeadGeo, mouseFurMat);
    headPivot.add(headMesh);

    const nose = new THREE.Mesh(A.mouseNoseGeo, pinkSkinMat);
    nose.position.set(0, -0.012, 0.25);
    headPivot.add(nose);

    const ears: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const earPivot = new THREE.Group();
      earPivot.position.set(side * 0.085, 0.085, 0.02);
      const earDisc = new THREE.Mesh(A.mouseEarGeo, pinkSkinMat);
      earDisc.rotation.x = Math.PI / 2 - 0.3;
      earDisc.rotation.z = side * 0.35;
      earPivot.add(earDisc);
      headPivot.add(earPivot);
      ears.push(earPivot);

      const eye = new THREE.Mesh(A.mouseEyeGeo, A.eyeMat);
      eye.position.set(side * 0.068, 0.035, 0.11);
      headPivot.add(eye);

      const wh = new THREE.Mesh(A.whiskerGeo, A.mouseWhiskerMat);
      wh.position.set(side * 0.07, -0.01, 0.2);
      wh.rotation.y = side * -0.2;
      headPivot.add(wh);
    }
    bodyPivot.add(headPivot);

    const makeMouseLeg = (x: number, z: number, scale: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.085, z);
      const leg = new THREE.Mesh(A.mouseLegGeo, pinkSkinMat);
      leg.scale.setScalar(scale);
      leg.position.set(0, -0.04 * scale, 0);
      pivot.add(leg);
      const paw = new THREE.Mesh(A.mousePawGeo, pinkSkinMat);
      paw.scale.set(1.0 * scale, 0.6 * scale, 1.5 * scale);
      paw.position.set(0, -0.075 * scale, 0.025);
      pivot.add(paw);
      bodyPivot.add(pivot);
      return pivot;
    };

    const frontLeftLeg = makeMouseLeg(-0.085, 0.1, 0.9);
    const frontRightLeg = makeMouseLeg(0.085, 0.1, 0.9);
    const hindLeftLeg = makeMouseLeg(-0.11, -0.14, 1.12);
    const hindRightLeg = makeMouseLeg(0.11, -0.14, 1.12);

    const tailSegs: THREE.Group[] = [];
    let parentGroup: THREE.Group = bodyPivot;
    for (let t = 0; t < 5; t++) {
      const segPivot = new THREE.Group();
      segPivot.position.set(0, t === 0 ? 0.1 : 0, t === 0 ? -0.23 : -0.1);
      const segMesh = new THREE.Mesh(A.mouseTailGeos[t], pinkSkinMat);
      segPivot.add(segMesh);
      parentGroup.add(segPivot);
      tailSegs.push(segPivot);
      parentGroup = segPivot;
    }

    return {
      root,
      kind,
      bodyPivot,
      headPivot,
      leftEar: ears[0],
      rightEar: ears[1],
      frontLeftLeg,
      frontRightLeg,
      hindLeftLeg,
      hindRightLeg,
      tailSegs,
    };
  }

  if (kind === 'deer') {
    const { deerFurMat, rabbitBellyMat, ivoryMat } = animalMats;
    root.scale.setScalar(1.42);
    shadowDisc.scale.setScalar(1.12);

    const torso = new THREE.Mesh(A.deerTorsoGeo, deerFurMat);
    torso.castShadow = enableShadows;
    bodyPivot.add(torso);

    const bellyPatch = new THREE.Mesh(A.deerBellyGeo, rabbitBellyMat);
    bellyPatch.rotation.x = Math.PI / 2;
    bellyPatch.scale.set(1.0, 1.0, 0.75);
    bellyPatch.position.set(0, 0.56, 0.02);
    bodyPivot.add(bellyPatch);

    const neckPivot = new THREE.Group();
    neckPivot.position.set(0, 0.81, 0.38);
    neckPivot.rotation.x = -0.52;
    const neck = new THREE.Mesh(A.deerNeckGeo, deerFurMat);
    neck.position.y = 0.22;
    neck.castShadow = enableShadows;
    neckPivot.add(neck);

    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.44, 0.04);
    neckPivot.add(headPivot);

    const head = new THREE.Mesh(A.deerHeadGeo, deerFurMat);
    head.castShadow = enableShadows;
    headPivot.add(head);

    const ears: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const earPivot = new THREE.Group();
      earPivot.position.set(side * 0.11, 0.16, 0.02);
      earPivot.rotation.set(-0.35, side * 0.4, side * -0.3);
      const ear = new THREE.Mesh(A.deerEarGeo, deerFurMat);
      earPivot.add(ear);
      headPivot.add(earPivot);
      ears.push(earPivot);

      const eye = new THREE.Mesh(A.rabbitEyeGeo, A.eyeMat);
      eye.position.set(side * 0.108, 0.075, 0.11);
      headPivot.add(eye);

      const antler = new THREE.Mesh(A.deerAntlerGeo, ivoryMat);
      antler.position.set(side * 0.09, 0.32, -0.02);
      antler.rotation.set(0.2, side * 0.25, side * 0.35);
      headPivot.add(antler);
      const fork = new THREE.Mesh(A.deerAntlerGeo, ivoryMat);
      fork.scale.set(0.7, 0.55, 0.7);
      fork.position.set(side * 0.15, 0.42, 0.06);
      fork.rotation.set(0.65, side * 0.1, side * 0.2);
      headPivot.add(fork);
    }
    bodyPivot.add(neckPivot);

    const tailPivot = new THREE.Group();
    tailPivot.position.set(0, 0.81, -0.45);
    const tail = new THREE.Mesh(A.deerTailGeo, rabbitBellyMat);
    tail.scale.set(0.7, 1.2, 0.7);
    tailPivot.add(tail);
    bodyPivot.add(tailPivot);

    const makeDeerLeg = (x: number, z: number) => {
      const legPivot = new THREE.Group();
      legPivot.position.set(x, 0.61, z);
      const leg = new THREE.Mesh(A.deerLegGeo, deerFurMat);
      leg.position.y = -0.28;
      leg.castShadow = enableShadows;
      legPivot.add(leg);
      const hoof = new THREE.Mesh(A.deerHoofGeo, A.eyeMat);
      hoof.position.set(0, -0.58, 0.015);
      legPivot.add(hoof);
      bodyPivot.add(legPivot);
      return legPivot;
    };

    const frontLeftLeg = makeDeerLeg(-0.13, 0.32);
    const frontRightLeg = makeDeerLeg(0.13, 0.32);
    const hindLeftLeg = makeDeerLeg(-0.14, -0.32);
    const hindRightLeg = makeDeerLeg(0.14, -0.32);

    return {
      root,
      kind,
      bodyPivot,
      neckPivot,
      headPivot,
      leftEar: ears[0],
      rightEar: ears[1],
      frontLeftLeg,
      frontRightLeg,
      hindLeftLeg,
      hindRightLeg,
      tailPivot,
    };
  }

  if (kind === 'boar') {
    const { boarFurMat, pinkSkinMat, ivoryMat } = animalMats;
    root.scale.setScalar(1.35);
    shadowDisc.scale.setScalar(1.12);

    const torso = new THREE.Mesh(A.boarTorsoGeo, boarFurMat);
    torso.castShadow = enableShadows;
    bodyPivot.add(torso);

    const crest = new THREE.Mesh(A.boarCrestGeo, boarFurMat);
    crest.rotation.x = Math.PI / 2;
    crest.position.set(0, 0.85, 0.06);
    bodyPivot.add(crest);

    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.54, 0.44);
    headPivot.rotation.x = 0.22;

    const head = new THREE.Mesh(A.boarHeadGeo, boarFurMat);
    head.castShadow = enableShadows;
    headPivot.add(head);

    const snout = new THREE.Mesh(A.boarSnoutGeo, pinkSkinMat);
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, -0.055, 0.54);
    headPivot.add(snout);

    const ears: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const earPivot = new THREE.Group();
      earPivot.position.set(side * 0.16, 0.17, 0.08);
      earPivot.rotation.set(-0.4, side * 0.3, side * -0.4);
      const ear = new THREE.Mesh(A.deerEarGeo, boarFurMat);
      ear.scale.setScalar(0.75);
      earPivot.add(ear);
      headPivot.add(earPivot);
      ears.push(earPivot);

      const eye = new THREE.Mesh(A.rabbitEyeGeo, A.eyeMat);
      eye.position.set(side * 0.16, 0.08, 0.2);
      headPivot.add(eye);

      const tusk = new THREE.Mesh(A.boarTuskGeo, ivoryMat);
      tusk.position.set(side * 0.11, -0.05, 0.44);
      tusk.rotation.set(-0.6, 0, side * -0.5);
      headPivot.add(tusk);
    }
    bodyPivot.add(headPivot);

    const tailPivot = new THREE.Group();
    tailPivot.position.set(0, 0.64, -0.49);
    const tail = new THREE.Mesh(A.rabbitForePawGeo, boarFurMat);
    tail.scale.set(0.6, 0.6, 0.8);
    tailPivot.add(tail);
    bodyPivot.add(tailPivot);

    const makeBoarLeg = (x: number, z: number) => {
      const legPivot = new THREE.Group();
      legPivot.position.set(x, 0.41, z);
      const leg = new THREE.Mesh(A.boarLegGeo, boarFurMat);
      leg.position.y = -0.16;
      leg.castShadow = enableShadows;
      legPivot.add(leg);
      bodyPivot.add(legPivot);
      return legPivot;
    };

    const frontLeftLeg = makeBoarLeg(-0.2, 0.28);
    const frontRightLeg = makeBoarLeg(0.2, 0.28);
    const hindLeftLeg = makeBoarLeg(-0.2, -0.32);
    const hindRightLeg = makeBoarLeg(0.2, -0.32);

    return {
      root,
      kind,
      bodyPivot,
      headPivot,
      leftEar: ears[0],
      rightEar: ears[1],
      frontLeftLeg,
      frontRightLeg,
      hindLeftLeg,
      hindRightLeg,
      tailPivot,
    };
  }

  if (kind === 'elephant') {
    const { elephantSkinMat, ivoryMat } = animalMats;
    root.scale.setScalar(1.58);
    shadowDisc.scale.setScalar(1.75);

    const torso = new THREE.Mesh(A.elephantTorsoGeo, elephantSkinMat);
    torso.castShadow = enableShadows;
    bodyPivot.add(torso);

    const headPivot = new THREE.Group();
    headPivot.position.set(0, 1.88, 1.18);

    const head = new THREE.Mesh(A.elephantHeadGeo, elephantSkinMat);
    head.scale.set(0.96, 1.04, 1.02);
    head.castShadow = enableShadows;
    headPivot.add(head);

    const ears: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const earPivot = new THREE.Group();
      earPivot.position.set(side * 0.66, 0.1, -0.12);
      earPivot.rotation.set(0.12, side * 0.34, side * -0.12);
      const ear = new THREE.Mesh(A.elephantEarGeo, elephantSkinMat);
      ear.scale.set(0.14, 0.92, 0.78);
      ear.castShadow = enableShadows;
      earPivot.add(ear);
      headPivot.add(earPivot);
      ears.push(earPivot);

      const eye = new THREE.Mesh(A.rabbitEyeGeo, A.eyeMat);
      eye.scale.setScalar(1.6);
      eye.position.set(side * 0.58, 0.18, 0.42);
      headPivot.add(eye);

      const tusk = new THREE.Mesh(A.elephantTuskGeo, ivoryMat);
      tusk.position.set(side * 0.34, -0.38, 0.62);
      tusk.rotation.set(0.72, 0, side * 0.18);
      headPivot.add(tusk);
    }

    const trunkPivot = new THREE.Group();
    trunkPivot.position.set(0, -0.22, 0.72);
    trunkPivot.rotation.x = -0.35;
    const trunkUpper = new THREE.Mesh(A.elephantTrunkUpperGeo, elephantSkinMat);
    trunkUpper.position.y = -0.38;
    trunkPivot.add(trunkUpper);

    const trunkLower = new THREE.Group();
    trunkLower.position.set(0, -0.76, 0);
    trunkLower.rotation.x = 0.45;
    const trunkLowerMesh = new THREE.Mesh(A.elephantTrunkLowerGeo, elephantSkinMat);
    trunkLowerMesh.position.y = -0.4;
    trunkLower.add(trunkLowerMesh);
    trunkPivot.add(trunkLower);

    headPivot.add(trunkPivot);
    bodyPivot.add(headPivot);

    const tailPivot = new THREE.Group();
    tailPivot.position.set(0, 1.94, -1.22);
    const tail = new THREE.Mesh(A.elephantTailGeo, elephantSkinMat);
    tail.position.y = -0.36;
    tail.rotation.x = 0.18;
    tailPivot.add(tail);
    bodyPivot.add(tailPivot);

    const makeElephantLeg = (x: number, z: number) => {
      const legPivot = new THREE.Group();
      legPivot.position.set(x, 1.09, z);
      const leg = new THREE.Mesh(A.elephantLegGeo, elephantSkinMat);
      leg.position.y = -0.48;
      leg.castShadow = enableShadows;
      legPivot.add(leg);
      const foot = new THREE.Mesh(A.elephantFootGeo, elephantSkinMat);
      foot.position.y = -1.02;
      legPivot.add(foot);
      bodyPivot.add(legPivot);
      return legPivot;
    };

    const frontLeftLeg = makeElephantLeg(-0.55, 0.78);
    const frontRightLeg = makeElephantLeg(0.55, 0.78);
    const hindLeftLeg = makeElephantLeg(-0.55, -0.78);
    const hindRightLeg = makeElephantLeg(0.55, -0.78);

    return {
      root,
      kind,
      bodyPivot,
      headPivot,
      leftEar: ears[0],
      rightEar: ears[1],
      frontLeftLeg,
      frontRightLeg,
      hindLeftLeg,
      hindRightLeg,
      tailPivot,
      trunkPivot,
      trunkLower,
    };
  }

  // Articulated Leaping Frog (kind === 'frog')
  const { frogSkinMat } = animalMats;
  const frogTorso = new THREE.Mesh(A.frogTorsoGeo, frogSkinMat);
  frogTorso.castShadow = enableShadows;
  bodyPivot.add(frogTorso);

  const throatSac = new THREE.Mesh(A.frogThroatGeo, A.frogThroatMat);
  throatSac.scale.set(1.1, 0.72, 1.0);
  throatSac.position.set(0, 0.16, 0.26);
  bodyPivot.add(throatSac);

  const makeFrogHind = (side: number) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.18, 0.16, -0.14);
    const thigh = new THREE.Mesh(A.frogThighGeo, frogSkinMat);
    thigh.rotation.x = Math.PI / 2 - 0.35;
    thigh.rotation.z = side * -0.35;
    thigh.position.set(side * 0.05, -0.02, 0.06);
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.set(side * 0.09, -0.06, 0.14);
    const calf = new THREE.Mesh(A.frogCalfGeo, frogSkinMat);
    calf.rotation.x = Math.PI / 2 + 0.25;
    calf.position.set(0, -0.05, -0.09);
    knee.add(calf);
    hip.add(knee);
    bodyPivot.add(hip);
    return { hip, knee };
  };

  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(A.frogEyeGeo, A.frogEyeMat);
    eye.position.set(side * 0.115, 0.35, 0.22);
    bodyPivot.add(eye);

    const pupil = new THREE.Mesh(A.frogPupilGeo, A.eyeMat);
    pupil.position.set(side * 0.13, 0.355, 0.25);
    bodyPivot.add(pupil);

    const frontLeg = new THREE.Mesh(A.frogFrontLegGeo, frogSkinMat);
    frontLeg.position.set(side * 0.16, 0.11, 0.18);
    frontLeg.rotation.x = -0.32;
    bodyPivot.add(frontLeg);
  }
  const fhL = makeFrogHind(-1);
  const fhR = makeFrogHind(1);

  return {
    root,
    kind,
    bodyPivot,
    hindLeftLeg: fhL.hip,
    hindRightLeg: fhR.hip,
    hindLeftLower: fhL.knee,
    hindRightLower: fhR.knee,
    throatSac,
  };
}

/**
 * Distance-synced biomechanical locomotion for wildlife (Deer, Boar, Elephant, Rabbit, Mouse, Frog).
 */
export function animateAnimalRig(rig: AnimalRig, prey: PreyItem, elapsed: number): void {
  const speed = Math.hypot(prey.vx, prey.vz);
  const isMoving = speed > 0.22;

  if (rig.kind === 'deer') {
    const p = prey.gaitPhase;
    const stride = isMoving ? Math.sin(p) * 0.55 : 0;
    if (rig.frontLeftLeg) rig.frontLeftLeg.rotation.x = stride;
    if (rig.hindRightLeg) rig.hindRightLeg.rotation.x = stride;
    if (rig.frontRightLeg) rig.frontRightLeg.rotation.x = -stride;
    if (rig.hindLeftLeg) rig.hindLeftLeg.rotation.x = -stride;

    rig.bodyPivot.position.y = isMoving ? Math.abs(Math.sin(p)) * 0.08 : 0;
    if (rig.headPivot) {
      rig.headPivot.rotation.x = isMoving ? Math.sin(p) * 0.08 : Math.sin(elapsed * 2.2 + prey.phase) * 0.06;
    }
    if (rig.leftEar && rig.rightEar) {
      const earFlick = Math.sin(elapsed * 3.5 + prey.phase) * 0.08;
      rig.leftEar.rotation.z = -0.3 + earFlick;
      rig.rightEar.rotation.z = 0.3 - earFlick;
    }
    if (rig.tailPivot) {
      rig.tailPivot.rotation.x = isMoving ? Math.sin(p * 2) * 0.22 : 0;
    }
    rig.root.rotation.y = prey.heading;
  } else if (rig.kind === 'boar') {
    const p = prey.gaitPhase * 1.35;
    const stride = isMoving ? Math.sin(p) * 0.48 : 0;
    if (rig.frontLeftLeg) rig.frontLeftLeg.rotation.x = stride;
    if (rig.hindRightLeg) rig.hindRightLeg.rotation.x = stride;
    if (rig.frontRightLeg) rig.frontRightLeg.rotation.x = -stride;
    if (rig.hindLeftLeg) rig.hindLeftLeg.rotation.x = -stride;

    rig.bodyPivot.position.y = isMoving ? Math.abs(Math.sin(p)) * 0.05 : 0;
    if (rig.headPivot) {
      rig.headPivot.rotation.x = 0.28 + (isMoving ? Math.sin(p) * 0.1 : Math.sin(elapsed * 3 + prey.phase) * 0.05);
    }
    if (rig.tailPivot) {
      rig.tailPivot.rotation.y = Math.sin(elapsed * 12 + prey.phase) * 0.28;
    }
    rig.root.rotation.y = prey.heading;
  } else if (rig.kind === 'elephant') {
    const p = prey.gaitPhase * 0.52;
    const stride = isMoving ? Math.sin(p) * 0.38 : 0;
    if (rig.frontLeftLeg) rig.frontLeftLeg.rotation.x = stride;
    if (rig.hindRightLeg) rig.hindRightLeg.rotation.x = stride;
    if (rig.frontRightLeg) rig.frontRightLeg.rotation.x = -stride;
    if (rig.hindLeftLeg) rig.hindLeftLeg.rotation.x = -stride;

    rig.bodyPivot.position.y = isMoving ? Math.abs(Math.sin(p)) * 0.06 : 0;
    rig.bodyPivot.rotation.z = isMoving ? Math.sin(p) * 0.03 : 0;

    if (rig.leftEar && rig.rightEar) {
      const earFlap = Math.sin(elapsed * 1.8 + prey.phase) * 0.22;
      rig.leftEar.rotation.y = 0.32 + earFlap;
      rig.rightEar.rotation.y = -0.32 - earFlap;
    }
    if (rig.trunkPivot && rig.trunkLower) {
      rig.trunkPivot.rotation.x = -0.35 + Math.sin(elapsed * 2.1 + prey.phase) * 0.25;
      rig.trunkPivot.rotation.y = Math.sin(elapsed * 1.3 + prey.phase) * 0.18;
      rig.trunkLower.rotation.x = 0.45 + Math.sin(elapsed * 2.1 + 0.6 + prey.phase) * 0.32;
    }
    if (rig.tailPivot) {
      rig.tailPivot.rotation.z = Math.sin(elapsed * 2.4 + prey.phase) * 0.18;
    }
    rig.root.rotation.y = prey.heading;
  } else if (rig.kind === 'rabbit') {
    const phase = prey.gaitPhase % (Math.PI * 2);
    const hopSin = isMoving ? Math.max(0, Math.sin(phase)) : 0;
    const strideCos = isMoving ? Math.cos(phase) : 0;

    // Bounding arc and natural spine pitch
    rig.bodyPivot.position.y = hopSin * 0.28;
    rig.bodyPivot.rotation.x = isMoving ? -strideCos * 0.26 : 0.06;

    // Articulated hind legs: extend backward at launch, tuck forward on landing
    const hindSwing = isMoving ? Math.sin(phase - 0.5) * 0.85 : 0.32;
    if (rig.hindLeftLeg && rig.hindRightLeg) {
      rig.hindLeftLeg.rotation.x = hindSwing;
      rig.hindRightLeg.rotation.x = hindSwing * 0.96;
    }
    if (rig.hindLeftLower && rig.hindRightLower) {
      const kneeFlex = isMoving ? Math.max(-0.55, -Math.sin(phase) * 0.7) : 0.12;
      rig.hindLeftLower.rotation.x = kneeFlex;
      rig.hindRightLower.rotation.x = kneeFlex;
    }

    // Articulated forelegs: reach forward before touchdown
    const foreSwing = isMoving ? -Math.sin(phase + 0.65) * 0.68 : 0.05;
    if (rig.frontLeftLeg && rig.frontRightLeg) {
      rig.frontLeftLeg.rotation.x = foreSwing;
      rig.frontRightLeg.rotation.x = foreSwing * 0.92;
    }

    // Head sniff/look & ear expression (ears lay back when fleeing, perk & twitch when grazing)
    if (rig.headPivot) {
      rig.headPivot.rotation.x = isMoving
        ? strideCos * 0.14
        : 0.22 + Math.sin(elapsed * 5.2 + prey.phase) * 0.07;
    }
    if (rig.leftEar && rig.rightEar) {
      const earSweep = prey.fleeing ? -0.65 : -0.15 + Math.sin(elapsed * 3.1 + prey.phase) * 0.12;
      rig.leftEar.rotation.x = earSweep;
      rig.rightEar.rotation.x = earSweep + Math.cos(elapsed * 2.7 + prey.phase) * 0.08;
    }
    if (rig.tailPivot) {
      rig.tailPivot.rotation.x = isMoving ? Math.sin(phase * 2) * 0.25 : 0;
    }
    rig.root.rotation.y = prey.heading;
  } else if (rig.kind === 'mouse') {
    const p = prey.gaitPhase;
    const scurryAmp = isMoving ? 0.72 : 0.04;
    const diagA = Math.sin(p) * scurryAmp;
    const diagB = -diagA;

    // Fast diagonal quadruped trot/scurry
    if (rig.frontLeftLeg) rig.frontLeftLeg.rotation.x = diagA;
    if (rig.hindRightLeg) rig.hindRightLeg.rotation.x = diagA;
    if (rig.frontRightLeg) rig.frontRightLeg.rotation.x = diagB;
    if (rig.hindLeftLeg) rig.hindLeftLeg.rotation.x = diagB;

    rig.bodyPivot.position.y = isMoving ? Math.abs(Math.sin(p)) * 0.032 : 0;
    rig.bodyPivot.rotation.z = isMoving ? Math.sin(p) * 0.06 : 0;

    if (rig.headPivot) {
      rig.headPivot.rotation.x = isMoving ? 0 : Math.sin(elapsed * 8 + prey.phase) * 0.09;
      rig.headPivot.rotation.y = isMoving ? 0 : Math.sin(elapsed * 3.5 + prey.phase) * 0.14;
    }

    // Sinuous whipping 5-segment tail
    if (rig.tailSegs) {
      const freq = isMoving ? p * 0.7 : elapsed * 2.2 + prey.phase;
      const amp = isMoving ? 0.24 : 0.08;
      for (let t = 0; t < rig.tailSegs.length; t++) {
        rig.tailSegs[t].rotation.y = Math.sin(freq - t * 0.65) * amp;
        rig.tailSegs[t].rotation.x = t === 0 ? 0.1 : Math.cos(freq - t * 0.5) * 0.05;
      }
    }
    rig.root.rotation.y = prey.heading;
  } else if (rig.kind === 'frog') {
    const hopCycle = isMoving ? Math.max(0, Math.sin(prey.gaitPhase * 0.65)) : 0;
    const hopY = Math.pow(hopCycle, 1.5) * 0.34;
    rig.bodyPivot.position.y = hopY;
    rig.bodyPivot.rotation.x = isMoving ? -hopCycle * 0.38 : 0;

    // Hind legs kick back in mid-leap and tuck cleanly on ground
    const kick = hopCycle * 1.1;
    if (rig.hindLeftLeg && rig.hindRightLeg) {
      rig.hindLeftLeg.rotation.x = -kick;
      rig.hindRightLeg.rotation.x = -kick;
    }
    if (rig.hindLeftLower && rig.hindRightLower) {
      rig.hindLeftLower.rotation.x = kick * 1.35;
      rig.hindRightLower.rotation.x = kick * 1.35;
    }
    if (rig.throatSac) {
      const pulse = 1 + Math.sin(elapsed * 4.5 + prey.phase) * 0.18;
      rig.throatSac.scale.set(1.1 * pulse, 0.72 * pulse, 1.0 * pulse);
    }
    rig.root.rotation.y = prey.heading;
  } else {
    rig.root.rotation.y = elapsed * 0.55 + prey.phase;
  }
}

/**
 * Builds full enterable, multi-level architectural landmarks matching `buildings.ts` coordinates 1:1.
 * Includes open doorways, interior furniture, glowing hearths, climbable staircases, upper lofts,
 * and a separate `roofGroup` that smoothly fades open when the snake enters inside!
 */
export function createBuildingMesh(
  b: EnterableBuilding,
  mats: BuildingMaterialSet,
  shadowTexture: THREE.Texture,
  isSoftwareGl: boolean,
  enableShadows = !isSoftwareGl,
): BuildingVisualRig {
  const root = new THREE.Group();
  const roofGroup = new THREE.Group();
  const roofMaterials: THREE.MeshStandardMaterial[] = [];

  const shadowDisc = new THREE.Mesh(
    new THREE.CircleGeometry(b.footprintRadius * 0.96, 20),
    new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
    }),
  );
  shadowDisc.rotation.x = -Math.PI / 2;
  shadowDisc.position.y = 0.015;
  root.add(shadowDisc);

  const { trimMat, warmWindowMat, rugMat, emberMat, hayMat } = getSharedBuildingDetails();

  const makeRoofMat = (color: number, useShingle = false) => {
    const m = new THREE.MeshStandardMaterial({
      color: useShingle ? 0xffffff : color,
      map: useShingle ? mats.shingleMat.map : null,
      normalMap: useShingle ? mats.shingleMat.normalMap : null,
      roughness: 0.88,
      transparent: false,
      opacity: 1,
    });
    roofMaterials.push(m);
    return m;
  };

  if (b.kind === 'cabin') {
    const roofShingle = makeRoofMat(0xffffff, true);
    const roofGableWood = makeRoofMat(0x4c331e, false);

    // 1. Stone foundation + Plank Ground Floor + Porch + Entry Ramp
    const basePlinth = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.28, 6.9), mats.stoneMat);
    basePlinth.position.set(0, 0.14, 0);
    basePlinth.receiveShadow = enableShadows;
    root.add(basePlinth);

    const floorPlanks = new THREE.Mesh(new THREE.BoxGeometry(8.3, 0.06, 6.7), mats.woodMat);
    floorPlanks.position.set(0, 0.28, 0);
    floorPlanks.receiveShadow = enableShadows;
    root.add(floorPlanks);

    // Front Porch Deck (Z: 3.35 -> 5.15)
    const porch = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.3, 1.8), mats.woodMat);
    porch.position.set(0, 0.14, 4.25);
    porch.receiveShadow = enableShadows;
    root.add(porch);

    // Front Porch Entry Ramp (sloped cleanly from Z=6.75 -> 5.15)
    const frontRamp = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.16, 1.72), mats.woodMat);
    frontRamp.position.set(0, 0.1, 5.95);
    frontRamp.rotation.x = Math.atan2(0.28, 1.6);
    frontRamp.receiveShadow = enableShadows;
    root.add(frontRamp);

    // Side Door Ramp (X: -5.35 -> -4.15)
    const sideRamp = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.14, 2.2), mats.woodMat);
    sideRamp.position.set(-4.75, 0.1, 0);
    sideRamp.rotation.z = -Math.atan2(0.28, 1.2);
    sideRamp.receiveShadow = enableShadows;
    root.add(sideRamp);

    // 2. Solid Perimeter Walls matching `walls[]` 1:1 with Wide Open Doorways
    const addWall = (minX: number, maxX: number, minZ: number, maxZ: number, minY: number, maxY: number, mat: THREE.Material) => {
      const w = maxX - minX;
      const d = maxZ - minZ;
      const h = maxY - minY;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5);
      m.castShadow = enableShadows;
      m.receiveShadow = enableShadows;
      root.add(m);
    };

    // Front wall split around wide open front doorway (X in [-1.45, +1.45])
    addWall(-4.25, -1.45, 3.15, 3.55, 0.28, 3.3, mats.woodMat);
    addWall(1.45, 4.25, 3.15, 3.55, 0.28, 3.3, mats.woodMat);
    // Doorframe lintel beam overhead
    addWall(-1.55, 1.55, 3.15, 3.55, 2.4, 3.3, trimMat);
    // Back wall & Right wall
    addWall(-4.25, 4.25, -3.55, -3.15, 0.28, 3.3, mats.woodMat);
    addWall(3.95, 4.35, -3.45, 3.45, 0.28, 3.3, mats.woodMat);
    // Left wall split around side doorway (Z in [-1.1, +1.1])
    addWall(-4.35, -3.95, 1.1, 3.45, 0.28, 3.3, mats.woodMat);
    addWall(-4.35, -3.95, -3.45, -1.1, 0.28, 3.3, mats.woodMat);
    addWall(-4.35, -3.95, -1.15, 1.15, 2.35, 3.3, trimMat);

    // Doorway Timber Frame Posts
    for (const sx of [-1.48, 1.48]) {
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.2, 0.46), trimMat);
      jamb.position.set(sx, 1.38, 3.35);
      root.add(jamb);
    }

    // Porch Roof Columns
    for (const sx of [-2.4, 2.4]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 2.95, 8), mats.barkMat);
      col.position.set(sx, 1.75, 4.95);
      col.castShadow = enableShadows;
      root.add(col);
    }

    // Framed Cross-Mullion Glowing Cabin Windows
    for (const sx of [-2.85, 2.85]) {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.12, 1.0, 0.48), trimMat);
      frame.position.set(sx, 1.65, 3.35);
      root.add(frame);

      const pane = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 0.5), warmWindowMat);
      pane.position.set(sx, 1.65, 3.35);
      root.add(pane);

      const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.84, 0.53), trimMat);
      vBar.position.set(sx, 1.65, 3.35);
      root.add(vBar);

      const hBar = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.08, 0.53), trimMat);
      hBar.position.set(sx, 1.65, 3.35);
      root.add(hBar);
    }

    // 3. Detailed Interior: Stone Fireplace + Warm Rug + Table + Chairs + Interior Staircase + Upper Loft!
    const hearth = new THREE.Mesh(new THREE.BoxGeometry(1.25, 2.2, 1.2), mats.stoneMat);
    hearth.position.set(-3.28, 1.38, -2.5);
    hearth.castShadow = enableShadows;
    root.add(hearth);

    const embers = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 0.55), emberMat);
    embers.position.set(-3.05, 0.52, -2.35);
    root.add(embers);

    const rug = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.03, 2.2), rugMat);
    rug.position.set(-0.6, 0.32, 0.6);
    rug.receiveShadow = enableShadows;
    root.add(rug);

    // Dining Table (legs keep space underneath clear visually)
    const tableTop = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 1.0), trimMat);
    tableTop.position.set(-1.3, 1.02, 1.2);
    tableTop.castShadow = enableShadows;
    root.add(tableTop);
    for (const lx of [-0.58, 0.58]) {
      for (const lz of [-0.4, 0.4]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.72, 0.1), trimMat);
        leg.position.set(-1.3 + lx, 0.65, 1.2 + lz);
        root.add(leg);
      }
    }

    // Interior Climbable Timber Staircase (`X in [1.75, 3.75], Z: 2.75 -> -0.35, Y: 0.28 -> 2.68`)
    const stairLen = Math.hypot(3.1, 2.4);
    const stairSlope = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.14, stairLen), mats.woodMat);
    stairSlope.position.set(2.75, 1.44, 1.2);
    stairSlope.rotation.x = Math.atan2(2.4, 3.1);
    stairSlope.receiveShadow = enableShadows;
    stairSlope.castShadow = enableShadows;
    root.add(stairSlope);

    // Visible timber stair treads along the ramp
    for (let s = 0; s < 10; s++) {
      const t = (s + 0.5) / 10;
      const tread = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.34), trimMat);
      tread.position.set(2.75, 0.28 + t * 2.4, 2.75 - t * 3.1);
      root.add(tread);
    }

    // Upper Mezzanine Loft Floor (`X in [-3.85, 3.85], Z in [-3.1, -0.35], Y = 2.68`)
    const loftDeck = new THREE.Mesh(new THREE.BoxGeometry(7.7, 0.18, 2.75), mats.woodMat);
    loftDeck.position.set(0, 2.59, -1.72);
    loftDeck.castShadow = enableShadows;
    loftDeck.receiveShadow = enableShadows;
    root.add(loftDeck);

    // Loft Guardrail (X in [-1.45, 1.75], Z = -0.35)
    const railTop = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.1, 0.12), trimMat);
    railTop.position.set(0.15, 3.3, -0.35);
    root.add(railTop);
    for (let p = -1.3; p <= 1.6; p += 0.72) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.62, 0.09), trimMat);
      post.position.set(p, 2.98, -0.35);
      root.add(post);
    }

    // Upper Balcony Catwalk extending over front porch (`X in [-3.85, -1.45], Z in [-0.35, 4.95], Y = 2.68`)
    const balcony = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.16, 5.3), mats.woodMat);
    balcony.position.set(-2.65, 2.6, 2.3);
    balcony.castShadow = enableShadows;
    balcony.receiveShadow = enableShadows;
    root.add(balcony);

    // 4. Removable / Cutaway Roof Group (fades open when snake enters inside!)
    const pitchedRoofGeo = new THREE.ConeGeometry(6.3, 2.4, 4);
    pitchedRoofGeo.rotateY(Math.PI / 4);
    pitchedRoofGeo.scale(1.12, 1.0, 0.96);
    const pitchedRoof = new THREE.Mesh(pitchedRoofGeo, roofShingle);
    pitchedRoof.position.set(0, 4.55, 0.45);
    pitchedRoof.castShadow = enableShadows;
    roofGroup.add(pitchedRoof);

    const chimneyTop = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2.4, 0.95), roofGableWood);
    chimneyTop.position.set(-3.28, 4.75, -2.5);
    roofGroup.add(chimneyTop);

    root.add(roofGroup);
    return { root, roofGroup, roofMaterials, baseEmberIntensity: 2.6 };
  }

  if (b.kind === 'manor') {
    const roofSlate = makeRoofMat(0x2d3b2b, true);

    // Stone floor + front & rear archway ramps
    const floor = new THREE.Mesh(new THREE.BoxGeometry(9.0, 0.24, 7.4), mats.stoneMat);
    floor.position.set(0, 0.12, 0);
    floor.receiveShadow = enableShadows;
    root.add(floor);

    for (const dir of [1, -1]) {
      const ramp = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.14, 1.5), mats.stoneMat);
      ramp.position.set(0, 0.08, dir * 4.35);
      ramp.rotation.x = dir * Math.atan2(0.24, 1.4);
      ramp.receiveShadow = enableShadows;
      root.add(ramp);
    }

    const addStoneWall = (minX: number, maxX: number, minZ: number, maxZ: number, minY: number, maxY: number) => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(maxX - minX, maxY - minY, maxZ - minZ),
        mats.stoneMat,
      );
      m.position.set((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5);
      m.castShadow = enableShadows;
      m.receiveShadow = enableShadows;
      root.add(m);
    };

    // Front & back walls split around wide open archways (X in [-1.5, 1.5])
    addStoneWall(-4.55, -1.5, 3.45, 3.85, 0.24, 3.2);
    addStoneWall(1.5, 4.55, 3.45, 3.85, 0.24, 3.2);
    addStoneWall(-1.55, 1.55, 3.45, 3.85, 2.35, 3.2);

    addStoneWall(-4.55, -1.5, -3.85, -3.45, 0.24, 3.2);
    addStoneWall(1.5, 4.55, -3.85, -3.45, 0.24, 3.2);
    addStoneWall(-1.55, 1.55, -3.85, -3.45, 2.35, 3.2);

    addStoneWall(-4.65, -4.25, -3.75, 3.75, 0.24, 3.2);
    addStoneWall(4.25, 4.65, -3.75, 3.75, 0.24, 3.2);

    // Interior crates, oak barrels & hay bales (reuse cached hayMat)
    const hayBale = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.72, 0.85), hayMat);
    hayBale.position.set(-2.9, 0.6, -2.0);
    hayBale.castShadow = enableShadows;
    root.add(hayBale);

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.42, 0.95, 12), mats.woodMat);
    barrel.position.set(-3.1, 0.72, 1.9);
    barrel.castShadow = enableShadows;
    root.add(barrel);

    // Interior Stone & Timber Ramp (`X in [2.0, 4.1], Z: 3.35 -> 0.85, Y: 0.24 -> 2.9`)
    const rampLen = Math.hypot(2.5, 2.66);
    const upRamp = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.16, rampLen), mats.woodMat);
    upRamp.position.set(3.05, 1.52, 2.1);
    upRamp.rotation.x = Math.atan2(2.66, 2.5);
    upRamp.castShadow = enableShadows;
    upRamp.receiveShadow = enableShadows;
    root.add(upRamp);

    // Accessible Upper Roof Terrace (`X in [-4.25, 4.25], Z in [-3.45, 1.25], Y = 2.9`)
    const terrace = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.2, 4.7), mats.stoneMat);
    terrace.position.set(0, 2.8, -1.1);
    terrace.castShadow = enableShadows;
    terrace.receiveShadow = enableShadows;
    root.add(terrace);

    // Terrace Parapet Rails
    addStoneWall(-4.25, 2.0, 1.05, 1.3, 2.9, 3.5);
    addStoneWall(-4.3, -4.05, -3.45, 1.25, 2.9, 3.5);
    addStoneWall(-4.25, 4.25, -3.5, -3.25, 2.9, 3.5);

    // Warm Glowing Lantern in Stone Hall
    const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.42, 0.32), warmWindowMat);
    lantern.position.set(-1.5, 2.2, 0);
    root.add(lantern);

    // Cutaway Sloped Canopy Over Front Atrium (`roofGroup`)
    const atriumRoof = new THREE.Mesh(new THREE.BoxGeometry(8.9, 0.25, 2.6), roofSlate);
    atriumRoof.position.set(0, 3.45, 2.45);
    atriumRoof.castShadow = enableShadows;
    roofGroup.add(atriumRoof);
    root.add(roofGroup);
    return { root, roofGroup, roofMaterials, baseEmberIntensity: 2.2 };
  }

  // Open-air climbable Ancient Mossy Temple Ruin (`ruin_tower`)
  const base = new THREE.Mesh(new THREE.BoxGeometry(7.0, 0.22, 5.7), mats.stoneMat);
  base.position.set(0, 0.11, -0.65);
  base.receiveShadow = enableShadows;
  root.add(base);

  const entrySteps = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.14, 1.5), mats.stoneMat);
  entrySteps.position.set(0, 0.09, 2.9);
  entrySteps.rotation.x = Math.atan2(0.22, 1.4);
  entrySteps.receiveShadow = enableShadows;
  root.add(entrySteps);

  const altarRampLen = Math.hypot(2.4, 1.83);
  const altarRamp = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.18, altarRampLen), mats.stoneMat);
  altarRamp.position.set(0, 1.08, 1.0);
  altarRamp.rotation.x = Math.atan2(1.83, 2.4);
  altarRamp.castShadow = enableShadows;
  altarRamp.receiveShadow = enableShadows;
  root.add(altarRamp);

  const upperAltar = new THREE.Mesh(new THREE.BoxGeometry(6.6, 1.9, 3.1), mats.stoneMat);
  upperAltar.position.set(0, 1.1, -1.75);
  upperAltar.castShadow = enableShadows;
  upperAltar.receiveShadow = enableShadows;
  root.add(upperAltar);

  // 4 Ancient Fluted Pillars matching `walls[]`
  for (const [px, pz, h] of [
    [-2.9, -2.9, 4.4],
    [2.9, -2.9, 4.4],
    [-2.9, 1.8, 3.4],
    [2.9, 1.8, 2.9],
  ]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.85, h, 0.85), mats.stoneMat);
    col.position.set(px, h * 0.5, pz);
    col.castShadow = enableShadows;
    col.receiveShadow = enableShadows;
    root.add(col);

    const mossCap = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), mats.mossMat);
    mossCap.scale.set(1.1, 0.35, 1.1);
    mossCap.position.set(px, h + 0.05, pz);
    root.add(mossCap);
  }

  // Stone lintel arch across back pillars
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.58, 0.9), mats.stoneMat);
  lintel.position.set(0, 4.55, -2.9);
  lintel.castShadow = enableShadows;
  root.add(lintel);

  return { root, roofGroup, roofMaterials };
}

export function createObstacleMesh(
  kind: ObstacleKind,
  scale: number,
  rockGeo: THREE.BufferGeometry,
  rockMat: THREE.Material,
  mossMat: THREE.Material,
  barkMat: THREE.Material,
  shadowTexture: THREE.Texture,
  enableShadows = true,
): THREE.Group {
  const group = new THREE.Group();

  const shadowDisc = new THREE.Mesh(
    new THREE.CircleGeometry(1.5 * scale, 14),
    new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
    }),
  );
  shadowDisc.rotation.x = -Math.PI / 2;
  shadowDisc.position.y = 0.015;
  group.add(shadowDisc);

  if (kind === 'boulder') {
    const mainRock = new THREE.Mesh(rockGeo, rockMat);
    mainRock.scale.setScalar(1.02 * scale);
    mainRock.position.set(0, 0.48 * scale, 0);
    mainRock.rotation.set(0.15, 0.5, 0.1);
    mainRock.castShadow = enableShadows;
    mainRock.receiveShadow = enableShadows;
    group.add(mainRock);

    const sideRock = new THREE.Mesh(rockGeo, rockMat);
    sideRock.scale.setScalar(0.56 * scale);
    sideRock.position.set(0.68 * scale, 0.26 * scale, 0.34 * scale);
    sideRock.rotation.set(0.4, 1.4, 0.2);
    sideRock.castShadow = enableShadows;
    sideRock.receiveShadow = enableShadows;
    group.add(sideRock);

    const mossCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.58 * scale, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.45),
      mossMat,
    );
    mossCap.scale.set(1.12, 0.24, 0.88);
    mossCap.position.set(-0.04 * scale, 0.88 * scale, 0);
    mossCap.receiveShadow = enableShadows;
    group.add(mossCap);
  } else {
    const logGeo = new THREE.CylinderGeometry(0.44 * scale, 0.54 * scale, 2.25 * scale, 10);
    logGeo.rotateZ(Math.PI / 2);
    const logMesh = new THREE.Mesh(logGeo, barkMat);
    logMesh.position.set(0, 0.4 * scale, 0);
    logMesh.castShadow = enableShadows;
    logMesh.receiveShadow = enableShadows;
    group.add(logMesh);

    const stubGeo = new THREE.CylinderGeometry(0.12 * scale, 0.22 * scale, 0.74 * scale, 7);
    const stub = new THREE.Mesh(stubGeo, barkMat);
    stub.position.set(0.32 * scale, 0.76 * scale, 0.18 * scale);
    stub.rotation.set(0.45, 0, -0.5);
    stub.castShadow = enableShadows;
    group.add(stub);

    for (let m = 0; m < 3; m++) {
      const cushion = new THREE.Mesh(new THREE.SphereGeometry(0.28 * scale, 10, 8), mossMat);
      cushion.scale.set(1.45, 0.3, 0.82);
      cushion.position.set((-0.48 + m * 0.42) * scale, 0.8 * scale, (m === 1 ? 0.05 : -0.04) * scale);
      group.add(cushion);
    }

    const fungiMat = new THREE.MeshStandardMaterial({ color: 0xc97f34, roughness: 0.65 });
    for (let i = 0; i < 3; i++) {
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18 * scale, 0.06 * scale, 0.06 * scale, 8, 1, false, 0, Math.PI),
        fungiMat,
      );
      cap.position.set((-0.5 + i * 0.26) * scale, (0.43 + i * 0.08) * scale, 0.46 * scale);
      cap.rotation.y = Math.PI / 2;
      group.add(cap);
    }
  }

  return group;
}

/**
 * Builds a realistic multi-branch oak trunk with buttress roots, main gnarled trunk,
 * 5 spreading primary limbs, and secondary forked upper boughs.
 */
export function createOakTrunkGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const addLimb = (
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    rBot: number,
    rTop: number,
    radSeg = 8,
  ) => {
    const start = new THREE.Vector3(x0, y0, z0);
    const end = new THREE.Vector3(x1, y1, z1);
    const dir = new THREE.Vector3().subVectors(end, start);
    const len = dir.length();
    if (len < 0.05) return;
    const cyl = new THREE.CylinderGeometry(rTop, rBot, len, radSeg, 2);
    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.normalize(),
    );
    const mat = new THREE.Matrix4().compose(mid, quat, new THREE.Vector3(1, 1, 1));
    cyl.applyMatrix4(mat);
    parts.push(cyl);
  };

  // Lower root buttresses anchoring naturally into forest loam
  for (let r = 0; r < 5; r++) {
    const a = (r / 5) * Math.PI * 2 + 0.35;
    addLimb(
      Math.cos(a) * 0.25,
      1.35,
      Math.sin(a) * 0.25,
      Math.cos(a) * 1.18,
      -0.25,
      Math.sin(a) * 1.18,
      0.34,
      0.16,
      6,
    );
  }

  // Two-tier gently crooked main trunk (`0 -> 5.4m`)
  addLimb(0, -0.2, 0, 0.14, 2.75, -0.08, 0.72, 0.54, 9);
  addLimb(0.14, 2.75, -0.08, 0.02, 5.25, 0.08, 0.54, 0.38, 8);

  // 5 spreading primary forked oak boughs + secondary twigs
  const branches = [
    { yaw: 0.2, len: 3.9, pitch: 0.72, startY: 4.5, r: 0.26 },
    { yaw: 1.48, len: 4.2, pitch: 0.65, startY: 4.8, r: 0.27 },
    { yaw: 2.75, len: 3.7, pitch: 0.78, startY: 4.3, r: 0.24 },
    { yaw: 4.02, len: 4.1, pitch: 0.62, startY: 4.9, r: 0.26 },
    { yaw: 5.3, len: 3.8, pitch: 0.74, startY: 4.6, r: 0.24 },
  ];

  for (let b = 0; b < branches.length; b++) {
    const br = branches[b];
    const sx = 0.04;
    const sz = 0.02;
    const dx = Math.cos(br.yaw) * Math.sin(br.pitch) * br.len;
    const dy = Math.cos(br.pitch) * br.len;
    const dz = Math.sin(br.yaw) * Math.sin(br.pitch) * br.len;
    const ex = sx + dx;
    const ey = br.startY + dy;
    const ez = sz + dz;
    addLimb(sx, br.startY, sz, ex, ey, ez, br.r, br.r * 0.48, 7);

    // Secondary fork off each bough
    const forkYaw = br.yaw + (b % 2 === 0 ? 0.55 : -0.58);
    addLimb(
      sx + dx * 0.52,
      br.startY + dy * 0.52,
      sz + dz * 0.52,
      sx + dx * 0.52 + Math.cos(forkYaw) * 2.1,
      br.startY + dy * 0.52 + 1.55,
      sz + dz * 0.52 + Math.sin(forkYaw) * 2.1,
      br.r * 0.62,
      0.06,
      5,
    );
  }

  // Central crown leader limb
  addLimb(0.02, 5.1, 0.08, -0.15, 7.6, -0.06, 0.34, 0.12, 7);

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Builds layered crossed botanical leaf-card crown clusters positioned at oak branch tips
 * so real sunlight and sky peek between individual oak leaves.
 */
export function createOakCrownBoughGeometry(): THREE.BufferGeometry {
  const planes: THREE.BufferGeometry[] = [];
  const centers: Array<[number, number, number, number]> = [
    [0.0, 7.9, 0.0, 4.8],
    [2.6, 6.8, 0.6, 4.2],
    [-2.5, 6.7, 1.0, 4.1],
    [0.7, 6.8, -2.5, 4.2],
    [-0.9, 7.1, 2.5, 4.0],
    [1.7, 8.3, -1.4, 3.6],
    [-1.8, 8.2, -1.2, 3.6],
    [1.6, 6.2, 2.1, 3.5],
    [-1.7, 6.3, -2.1, 3.5],
  ];

  for (let c = 0; c < centers.length; c++) {
    const [cx, cy, cz, size] = centers[c];
    for (let k = 0; k < 4; k++) {
      const p = new THREE.PlaneGeometry(size, size);
      p.rotateX((k === 0 ? -Math.PI * 0.32 : (k - 1.5) * 0.42) + ((c % 3) - 1) * 0.12);
      p.rotateY((c * 1.1) + (k / 4) * Math.PI);
      p.rotateZ((k % 2 === 0 ? 1 : -1) * 0.22);
      p.translate(cx, cy, cz);
      planes.push(p);
    }
  }

  const merged = mergeGeometries(planes, false);
  for (const p of planes) p.dispose();
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Builds a tall tapering conifer trunk with root buttresses and woody radial boughs.
 */
export function createPineTrunkGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const main = new THREE.CylinderGeometry(0.11, 0.56, 13.4, 8, 3);
  main.translate(0, 6.5, 0);
  parts.push(main);

  // Subtle root buttresses
  for (let r = 0; r < 4; r++) {
    const a = (r / 4) * Math.PI * 2 + 0.5;
    const root = new THREE.CylinderGeometry(0.14, 0.26, 1.3, 5);
    root.rotateZ(0.45);
    root.rotateY(a);
    root.translate(Math.cos(a) * 0.34, 0.4, Math.sin(a) * 0.34);
    parts.push(root);
  }

  // Lower woody pine bough limbs inside foliage tiers
  for (let t = 0; t < 4; t++) {
    const y = 4.0 + t * 1.9;
    const bLen = 1.95 - t * 0.28;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + t * 0.65;
      const limb = new THREE.CylinderGeometry(0.035, 0.085, bLen, 5);
      limb.rotateZ(Math.PI * 0.5 + 0.18);
      limb.rotateY(a);
      limb.translate(Math.cos(a) * bLen * 0.45, y, Math.sin(a) * bLen * 0.45);
      parts.push(limb);
    }
  }

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Builds 7 whorled tiers of drooping evergreen pine-needle bough sprays.
 */
export function createPineFoliageGeometry(): THREE.BufferGeometry {
  const planes: THREE.BufferGeometry[] = [];
  const tiers = 7;
  for (let t = 0; t < tiers; t++) {
    const frac = t / (tiers - 1);
    const tierY = 3.8 + frac * 9.0;
    const radius = 3.1 * (1 - frac * 0.72) + 0.65;
    const boughsInTier = t < 5 ? 6 : 4;
    for (let b = 0; b < boughsInTier; b++) {
      const yaw = (b / boughsInTier) * Math.PI * 2 + t * 0.55;
      const spray = new THREE.PlaneGeometry(radius * 1.15, radius * 1.35);
      spray.translate(0, radius * 0.55, 0);
      spray.rotateX(Math.PI * 0.5 + 0.28 + frac * 0.12);
      spray.rotateY(yaw);
      spray.translate(0, tierY, 0);
      planes.push(spray);
    }
  }
  const merged = mergeGeometries(planes, false);
  for (const p of planes) p.dispose();
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

export interface VillageCullGroup {
  group: THREE.Group;
  cx: number;
  cz: number;
  cullRadius: number;
}

/**
 * Builds all rival villages' split-rail perimeter fences, stone/timber gateways with faction banners,
 * terrain-conforming feathered dirt avenues & clearings, street lanterns, and central plaza stone wells.
 * Groups per-village decorative geometry so far-away villages can be distance-culled in 1 boolean check.
 */
export function createMultiVillageSettlementGroup(
  villages: readonly VillageDef[],
  mats: BuildingMaterialSet,
  roadTex: { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture },
  groundHeightAtFn: (x: number, z: number) => number,
  isSoftwareGl: boolean,
  lowMem = false,
): {
  group: THREE.Group;
  villageGroups: VillageCullGroup[];
  disposables: Array<{ dispose: () => void }>;
} {
  const group = new THREE.Group();
  const villageGroups: VillageCullGroup[] = [];
  const disposables: Array<{ dispose: () => void }> = [];

  const roadMat = new THREE.MeshStandardMaterial({
    map: roadTex.map,
    normalMap: roadTex.normalMap,
    normalScale: new THREE.Vector2(1.0, 1.0),
    roughness: 0.95,
    metalness: 0.01,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  disposables.push(roadMat);

  // Shared geometries across all 7 villages
  const postGeo = new THREE.CylinderGeometry(0.17, 0.21, 1.85, 7);
  const railGeo = new THREE.BoxGeometry(1, 0.15, 0.13);
  const pierGeo = new THREE.BoxGeometry(1.55, 3.9, 1.55);
  const capGeo = new THREE.BoxGeometry(1.9, 0.36, 1.9);
  const lanternGeo = new THREE.BoxGeometry(0.42, 0.52, 0.42);
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 3.2, 7);
  const armGeo = new THREE.BoxGeometry(0.7, 0.1, 0.1);
  const smallLampGeo = new THREE.BoxGeometry(0.28, 0.38, 0.28);
  const wellRimGeo = new THREE.CylinderGeometry(1.65, 1.75, 1.15, 14, 1, true);
  const wellCapGeo = new THREE.TorusGeometry(1.65, 0.22, 7, 16);
  const wellWaterGeo = new THREE.CircleGeometry(1.42, 14);
  const wellPostGeo = new THREE.CylinderGeometry(0.11, 0.13, 2.3, 7);
  const wellRoofGeo = new THREE.ConeGeometry(2.35, 1.25, 4);
  const bannerGeo = new THREE.BoxGeometry(1.15, 1.5, 0.08);
  const archPostGeo = new THREE.CylinderGeometry(0.24, 0.28, 1.45, 7);
  const chainGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.65, 5);
  const hangLampGeo = new THREE.BoxGeometry(0.36, 0.46, 0.36);

  const lanternGlowMat = new THREE.MeshStandardMaterial({
    color: 0xffdf8e,
    emissive: 0xe68b22,
    emissiveIntensity: 1.4,
    roughness: 0.25,
  });
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x1b1e1c, roughness: 0.65, metalness: 0.45 });
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x0e2a2c, roughness: 0.18, metalness: 0.2 });

  disposables.push(
    postGeo,
    railGeo,
    pierGeo,
    capGeo,
    lanternGeo,
    poleGeo,
    armGeo,
    smallLampGeo,
    wellRimGeo,
    wellCapGeo,
    wellWaterGeo,
    wellPostGeo,
    wellRoofGeo,
    bannerGeo,
    archPostGeo,
    chainGeo,
    hangLampGeo,
    lanternGlowMat,
    ironMat,
    waterMat,
  );

  const postPositions: Array<{ x: number; y: number; z: number }> = [];
  const railTransforms: Array<{ x: number; y: number; z: number; yaw: number; len: number }> = [];

  for (let vIdx = 0; vIdx < villages.length; vIdx++) {
    const v = villages[vIdx];
    const vGroup = new THREE.Group();
    group.add(vGroup);
    const cullRadius = Math.hypot(v.halfW + 12, v.halfD + 14);
    villageGroups.push({ group: vGroup, cx: v.centerX, cz: v.centerZ, cullRadius });

    const addDirtRoad = (x0: number, z0: number, x1: number, z1: number, width: number) => {
      const dx = x1 - x0;
      const dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      if (len < 0.5) return;
      const segs = Math.max(4, Math.ceil(len / (lowMem ? 4.2 : 2.6)));
      const geo = new THREE.PlaneGeometry(width, len, lowMem ? 2 : 4, segs);
      geo.rotateX(-Math.PI / 2);
      const yaw = Math.atan2(dx, dz);
      const cxRoad = (x0 + x1) * 0.5;
      const czRoad = (z0 + z1) * 0.5;
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);

      const pos = geo.attributes.position;
      const uv = geo.attributes.uv;
      const vRepeat = len / 6.2;
      for (let i = 0; i < pos.count; i++) {
        const lx = pos.getX(i);
        const lz = pos.getZ(i);
        const wx = cxRoad + lx * cosY + lz * sinY;
        const wz = czRoad - lx * sinY + lz * cosY;
        pos.setXYZ(i, wx, groundHeightAtFn(wx, wz) + 0.035, wz);
        uv.setY(i, uv.getY(i) * vRepeat);
      }
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, roadMat);
      mesh.receiveShadow = !lowMem;
      vGroup.add(mesh);
      disposables.push(geo);
    };

    const addDirtClearing = (cxC: number, czC: number, radius: number, yOffset = 0.036) => {
      const ringGeo = new THREE.RingGeometry(0.25, radius, lowMem ? 16 : 24);
      ringGeo.rotateX(-Math.PI / 2);
      const rPos = ringGeo.attributes.position;
      const rUv = ringGeo.attributes.uv;
      for (let i = 0; i < rPos.count; i++) {
        const px = rPos.getX(i);
        const pz = rPos.getZ(i);
        const rFrac = Math.min(1, Math.hypot(px, pz) / radius);
        const wx = cxC + px;
        const wz = czC + pz;
        rPos.setXYZ(i, wx, groundHeightAtFn(wx, wz) + yOffset, wz);
        rUv.setXY(i, 0.5 + rFrac * 0.49, ((Math.atan2(pz, px) + Math.PI) / (Math.PI * 2)) * 3.5);
      }
      ringGeo.computeVertexNormals();
      const ringMesh = new THREE.Mesh(ringGeo, roadMat);
      ringMesh.receiveShadow = !lowMem;
      vGroup.add(ringMesh);
      disposables.push(ringGeo);
    };

    const minX = v.centerX - v.halfW;
    const maxX = v.centerX + v.halfW;
    const minZ = v.centerZ - v.halfD;
    const maxZ = v.centerZ + v.halfD;
    const cx = v.centerX;
    const cz = v.centerZ;
    const sGate = v.southGateHalfW;
    const eGate = v.sideGateHalfW;

    const bannerMat = new THREE.MeshStandardMaterial({
      color: v.factionColorHex,
      roughness: 0.78,
      metalness: 0.05,
    });
    disposables.push(bannerMat);

    // North-South & East-West village avenues + plaza ring
    addDirtRoad(cx, maxZ + 10, cx, minZ - 10, 9.2);
    addDirtClearing(cx, maxZ + 10, 4.9, 0.034);
    addDirtClearing(cx, minZ - 10, 4.9, 0.034);
    addDirtRoad(minX - 8, cz, maxX + 8, cz, 7.6);
    addDirtClearing(minX - 8, cz, 4.1, 0.034);
    addDirtClearing(maxX + 8, cz, 4.1, 0.034);
    addDirtClearing(cx, cz, 10.2, 0.04);

    if (v.id === 0) {
      // Starting Timberhollow Trailhead path connecting spawn (0, 12) to south gate
      addDirtRoad(0, 14, 0, maxZ, 8.6);
      addDirtClearing(0, 14, 5.2, 0.034);
    }

    // Fence runs matching `createVillageFenceWalls()` openings 1:1
    const fenceRuns: Array<[number, number, number, number]> = [
      [minX, maxZ, cx - sGate, maxZ],
      [cx + sGate, maxZ, maxX, maxZ],
      [minX, minZ, cx - sGate, minZ],
      [cx + sGate, minZ, maxX, minZ],
      [minX, minZ, minX, cz - eGate],
      [minX, cz + eGate, minX, maxZ],
      [maxX, minZ, maxX, cz - eGate],
      [maxX, cz + eGate, maxX, maxZ],
    ];

    for (const [x0, z0, x1, z1] of fenceRuns) {
      const dist = Math.hypot(x1 - x0, z1 - z0);
      const spans = Math.max(1, Math.round(dist / 4.4));
      const yaw = Math.atan2(x1 - x0, z1 - z0);
      for (let s = 0; s <= spans; s++) {
        const t = s / spans;
        const px = x0 + (x1 - x0) * t;
        const pz = z0 + (z1 - z0) * t;
        postPositions.push({ x: px, y: groundHeightAtFn(px, pz) + 0.84, z: pz });
      }
      for (let s = 0; s < spans; s++) {
        const t0 = s / spans;
        const t1 = (s + 1) / spans;
        const mx = x0 + (x1 - x0) * ((t0 + t1) * 0.5);
        const mz = z0 + (z1 - z0) * ((t0 + t1) * 0.5);
        const my = groundHeightAtFn(mx, mz);
        const spanLen = dist / spans;
        railTransforms.push({ x: mx, y: my + 0.68, z: mz, yaw: yaw + Math.PI * 0.5, len: spanLen });
        railTransforms.push({ x: mx, y: my + 1.34, z: mz, yaw: yaw + Math.PI * 0.5, len: spanLen });
      }
    }

    const addGatePair = (
      gx0: number,
      gz0: number,
      gx1: number,
      gz1: number,
      withOverheadArch: boolean,
    ) => {
      for (const [gx, gz] of [
        [gx0, gz0],
        [gx1, gz1],
      ]) {
        const gy = groundHeightAtFn(gx, gz);
        const pier = new THREE.Mesh(pierGeo, mats.stoneMat);
        pier.position.set(gx, gy + 1.92, gz);
        pier.castShadow = !isSoftwareGl && !lowMem && vIdx === 0;
        pier.receiveShadow = !lowMem;
        vGroup.add(pier);

        const cap = new THREE.Mesh(capGeo, mats.stoneMat);
        cap.position.set(gx, gy + 3.92, gz);
        vGroup.add(cap);

        const lantern = new THREE.Mesh(lanternGeo, lanternGlowMat);
        lantern.position.set(gx, gy + 4.4, gz);
        vGroup.add(lantern);
      }

      if (withOverheadArch) {
        const midX = (gx0 + gx1) * 0.5;
        const midZ = (gz0 + gz1) * 0.5;
        const cy = groundHeightAtFn(midX, midZ);
        const span = Math.hypot(gx1 - gx0, gz1 - gz0);

        const beamGeo = new THREE.BoxGeometry(span + 1.6, 0.58, 0.68);
        const slopeGeo = new THREE.BoxGeometry(span + 2.6, 0.22, 1.45);
        const braceGeo = new THREE.BoxGeometry(2.1, 0.24, 0.34);
        disposables.push(beamGeo, slopeGeo, braceGeo);

        const beam = new THREE.Mesh(beamGeo, mats.woodMat);
        beam.position.set(midX, cy + 5.25, midZ);
        beam.castShadow = !isSoftwareGl && !lowMem && vIdx === 0;
        vGroup.add(beam);

        for (const side of [-1, 1]) {
          const slope = new THREE.Mesh(slopeGeo, mats.shingleMat);
          slope.position.set(midX, cy + 5.9, midZ + side * 0.58);
          slope.rotation.x = side * 0.44;
          vGroup.add(slope);
        }

        // Central faction crest banner on gatehouse lintel
        const banner = new THREE.Mesh(bannerGeo, bannerMat);
        banner.position.set(midX, cy + 4.45, midZ + (midZ > cz ? 0.4 : -0.4));
        vGroup.add(banner);

        for (const sx of [-1, 1]) {
          const post = new THREE.Mesh(archPostGeo, mats.barkMat);
          post.position.set(midX + sx * sGate, cy + 4.55, midZ);
          vGroup.add(post);

          const brace = new THREE.Mesh(braceGeo, mats.woodMat);
          brace.position.set(midX + sx * (sGate - 0.95), cy + 4.55, midZ);
          brace.rotation.z = sx * 0.72;
          vGroup.add(brace);

          const chain = new THREE.Mesh(chainGeo, ironMat);
          chain.position.set(midX + sx * (sGate - 2.3), cy + 4.65, midZ);
          vGroup.add(chain);

          const hangLamp = new THREE.Mesh(hangLampGeo, lanternGlowMat);
          hangLamp.position.set(midX + sx * (sGate - 2.3), cy + 4.22, midZ);
          vGroup.add(hangLamp);
        }

        if (!isSoftwareGl && !lowMem && vIdx === 0) {
          const gateLight = new THREE.PointLight(0xffb85c, 3.0, 22, 1.5);
          gateLight.position.set(midX, cy + 4.6, midZ);
          vGroup.add(gateLight);
        }
      }
    };

    addGatePair(cx - sGate, maxZ, cx + sGate, maxZ, true);
    addGatePair(cx - sGate, minZ, cx + sGate, minZ, true);
    addGatePair(minX, cz - eGate, minX, cz + eGate, false);
    addGatePair(maxX, cz - eGate, maxX, cz + eGate, false);

    // Street Lantern Posts along main village avenue
    for (const [ox, oz] of [
      [-6.2, 18],
      [6.2, 18],
      [-6.2, -18],
      [6.2, -18],
    ]) {
      const lx = cx + ox;
      const lz = cz + oz;
      const ly = groundHeightAtFn(lx, lz);
      const pole = new THREE.Mesh(poleGeo, mats.barkMat);
      pole.position.set(lx, ly + 1.55, lz);
      vGroup.add(pole);

      const arm = new THREE.Mesh(armGeo, ironMat);
      arm.position.set(lx + (ox < 0 ? 0.3 : -0.3), ly + 3.05, lz);
      vGroup.add(arm);

      const lamp = new THREE.Mesh(smallLampGeo, lanternGlowMat);
      lamp.position.set(lx + (ox < 0 ? 0.58 : -0.58), ly + 2.82, lz);
      vGroup.add(lamp);
    }

    // Central Village Stone Plaza Well at `(cx, cz)` (aligned 1:1 with central collider)
    const wellY = groundHeightAtFn(cx, cz);
    const wellGroup = new THREE.Group();
    wellGroup.position.set(cx, wellY, cz);
    const wellRim = new THREE.Mesh(wellRimGeo, mats.stoneMat);
    wellRim.position.y = 0.58;
    wellRim.castShadow = !isSoftwareGl && !lowMem && vIdx === 0;
    wellGroup.add(wellRim);
    const wellCap = new THREE.Mesh(wellCapGeo, mats.stoneMat);
    wellCap.rotation.x = Math.PI / 2;
    wellCap.position.y = 1.15;
    wellGroup.add(wellCap);
    const wellWater = new THREE.Mesh(wellWaterGeo, waterMat);
    wellWater.rotation.x = -Math.PI / 2;
    wellWater.position.y = 0.68;
    wellGroup.add(wellWater);
    for (const sx of [-1.45, 1.45]) {
      const p = new THREE.Mesh(wellPostGeo, mats.woodMat);
      p.position.set(sx, 2.0, 0);
      wellGroup.add(p);
    }
    const wellRoof = new THREE.Mesh(wellRoofGeo, mats.shingleMat);
    wellRoof.rotation.y = Math.PI / 4;
    wellRoof.position.y = 3.55;
    wellGroup.add(wellRoof);
    const wellBanner = new THREE.Mesh(bannerGeo, bannerMat);
    wellBanner.scale.set(0.65, 0.55, 1.0);
    wellBanner.position.set(0, 2.35, 1.45);
    wellGroup.add(wellBanner);
    vGroup.add(wellGroup);
  }

  // Batched InstancedMesh for all fence posts & rails across all 7 villages
  const postInst = new THREE.InstancedMesh(postGeo, mats.barkMat, postPositions.length);
  postInst.castShadow = false;
  postInst.receiveShadow = !lowMem;
  const railInst = new THREE.InstancedMesh(railGeo, mats.woodMat, railTransforms.length);
  railInst.castShadow = false;
  railInst.receiveShadow = !lowMem;

  const dummy = new THREE.Object3D();
  for (let i = 0; i < postPositions.length; i++) {
    const p = postPositions[i];
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, i * 0.7, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    postInst.setMatrixAt(i, dummy.matrix);
  }
  for (let i = 0; i < railTransforms.length; i++) {
    const r = railTransforms[i];
    dummy.position.set(r.x, r.y, r.z);
    dummy.rotation.set(0, r.yaw, 0);
    dummy.scale.set(r.len, 1, 1);
    dummy.updateMatrix();
    railInst.setMatrixAt(i, dummy.matrix);
  }
  postInst.instanceMatrix.needsUpdate = true;
  railInst.instanceMatrix.needsUpdate = true;
  postInst.computeBoundingSphere();
  railInst.computeBoundingSphere();
  group.add(postInst, railInst);

  return { group, villageGroups, disposables };
}

/**
 * Single-village compatibility wrapper delegating to `createMultiVillageSettlementGroup`.
 */
export function createVillageSettlementGroup(
  bounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    southGateHalfW: number;
    sideGateHalfW: number;
  },
  mats: BuildingMaterialSet,
  roadTex: { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture },
  groundHeightAtFn: (x: number, z: number) => number,
  isSoftwareGl: boolean,
): { group: THREE.Group; disposables: Array<{ dispose: () => void }> } {
  const res = createMultiVillageSettlementGroup(
    [
      {
        id: 0,
        name: 'Timberhollow',
        centerX: (bounds.minX + bounds.maxX) * 0.5,
        centerZ: (bounds.minZ + bounds.maxZ) * 0.5,
        halfW: (bounds.maxX - bounds.minX) * 0.5,
        halfD: (bounds.maxZ - bounds.minZ) * 0.5,
        southGateHalfW: bounds.southGateHalfW,
        sideGateHalfW: bounds.sideGateHalfW,
        factionColorHex: 0x5c809e,
      },
    ],
    mats,
    roadTex,
    groundHeightAtFn,
    isSoftwareGl,
  );
  return { group: res.group, disposables: res.disposables };
}

export interface VillagerRig {
  root: THREE.Group;
  pelvisPivot: THREE.Group;
  torsoPivot: THREE.Group;
  headPivot: THREE.Group;
  leftArmPivot: THREE.Group;
  rightArmPivot: THREE.Group;
  leftElbowPivot: THREE.Group;
  rightElbowPivot: THREE.Group;
  leftLegPivot: THREE.Group;
  rightLegPivot: THREE.Group;
  leftKneePivot: THREE.Group;
  rightKneePivot: THREE.Group;
  torsoMesh: THREE.Mesh;
  skirtMesh: THREE.Mesh;
  baseTunicMat: THREE.MeshStandardMaterial;
  baseSkirtMat: THREE.MeshStandardMaterial;
  hitFlashMat: THREE.MeshStandardMaterial;
  poisonMat: THREE.MeshStandardMaterial;
  isFlashing: boolean;
  isPoisoned: boolean;
  telegraphRing: THREE.Mesh;
  weaponPivot?: THREE.Group;
}

function getOrCreateCachedMat<K>(
  map: Map<K, THREE.MeshStandardMaterial>,
  key: K,
  factory: () => THREE.MeshStandardMaterial,
): THREE.MeshStandardMaterial {
  let mat = map.get(key);
  if (!mat) {
    mat = factory();
    map.set(key, mat);
  }
  return mat;
}

function getSharedHumanAssets(
  shadowTexture: THREE.Texture,
  humanTex: HumanTextureSet,
): SharedHumanAssets {
  if (
    cachedHumanAssets &&
    cachedHumanAssets.shadowTexture === shadowTexture &&
    cachedHumanAssets.humanTex === humanTex
  ) {
    return cachedHumanAssets;
  }
  if (cachedHumanAssets) {
    disposeAssetRecord(cachedHumanAssets);
  }

  const thighGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.068, 0.0),
      new THREE.Vector2(0.082, 0.18),
      new THREE.Vector2(0.098, 0.38),
      new THREE.Vector2(0.088, 0.44),
    ],
    9,
  );
  const calfGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.05, 0.0),
      new THREE.Vector2(0.072, 0.22),
      new THREE.Vector2(0.074, 0.36),
      new THREE.Vector2(0.066, 0.42),
    ],
    9,
  );
  const torsoGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.165, 0.0),
      new THREE.Vector2(0.158, 0.14),
      new THREE.Vector2(0.205, 0.34),
      new THREE.Vector2(0.228, 0.46),
      new THREE.Vector2(0.165, 0.54),
      new THREE.Vector2(0.088, 0.57),
    ],
    12,
  );

  cachedHumanAssets = {
    shadowTexture,
    humanTex,
    shadowDiscGeo: new THREE.CircleGeometry(0.68, 12),
    shadowMat: new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      opacity: 0.54,
      depthWrite: false,
    }),
    telegraphRingGeo: new THREE.RingGeometry(0.68, 1.02, 20),
    telegraphMatRegular: new THREE.MeshBasicMaterial({
      color: 0xe84838,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    telegraphMatElite: new THREE.MeshBasicMaterial({
      color: 0xff3b24,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    hitFlashMat: new THREE.MeshStandardMaterial({
      color: 0xff4b32,
      emissive: 0xff3824,
      emissiveIntensity: 1.35,
      roughness: 0.52,
    }),
    poisonMat: new THREE.MeshStandardMaterial({
      color: 0x62c940,
      emissive: 0x45a31d,
      emissiveIntensity: 0.85,
      roughness: 0.55,
    }),
    leatherMat: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: humanTex.leatherMap,
      normalMap: humanTex.leatherNormal,
      normalScale: new THREE.Vector2(0.95, 0.95),
      roughness: 0.72,
      metalness: 0.05,
    }),
    woodMat: new THREE.MeshStandardMaterial({ color: 0x5c3d22, roughness: 0.82, metalness: 0.03 }),
    eyeMat: new THREE.MeshStandardMaterial({
      map: humanTex.humanEyeMap,
      roughness: 0.2,
      metalness: 0.0,
    }),
    brassMat: new THREE.MeshStandardMaterial({ color: 0xcfa54c, roughness: 0.32, metalness: 0.85 }),
    steelMatRegular: new THREE.MeshStandardMaterial({
      color: 0xbcc5cc,
      map: humanTex.steelMap,
      normalMap: humanTex.steelNormal,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 0.3,
      metalness: 0.85,
    }),
    steelMatElite: new THREE.MeshStandardMaterial({
      color: 0xd8c186,
      map: humanTex.steelMap,
      normalMap: humanTex.steelNormal,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 0.3,
      metalness: 0.85,
    }),
    capeMat: new THREE.MeshStandardMaterial({
      color: 0x6e1d19,
      map: humanTex.linenMap,
      roughness: 0.88,
      side: THREE.DoubleSide,
    }),
    cloakCrossbowMat: new THREE.MeshStandardMaterial({
      color: 0x223026,
      map: humanTex.linenMap,
      normalMap: humanTex.linenNormal,
      roughness: 0.9,
      side: THREE.DoubleSide,
    }),
    cloakHideMat: new THREE.MeshStandardMaterial({
      color: 0x4a3d52,
      map: humanTex.linenMap,
      normalMap: humanTex.linenNormal,
      roughness: 0.9,
      side: THREE.DoubleSide,
    }),
    fletchMat: new THREE.MeshStandardMaterial({ color: 0xc93b2b, roughness: 0.75 }),
    crestMat: new THREE.MeshStandardMaterial({ color: 0xb5241e, roughness: 0.78 }),
    featherGoldMat: new THREE.MeshStandardMaterial({ color: 0xe0b248, roughness: 0.75 }),
    featherRedMat: new THREE.MeshStandardMaterial({ color: 0xb83a2c, roughness: 0.75 }),
    strawMat: new THREE.MeshStandardMaterial({ color: 0xc2a462, roughness: 0.92 }),
    bowStringMat: new THREE.MeshBasicMaterial({ color: 0xd9cfb8 }),
    skinMats: new Map(),
    tunicMats: new Map(),
    skirtMats: new Map(),
    trouserMats: new Map(),
    hairMats: new Map(),
    hipGirdleGeo: new THREE.SphereGeometry(0.175, 10, 8),
    tunicSkirtGeo: new THREE.CylinderGeometry(0.18, 0.24, 0.22, 12, 1, true),
    thighGeo,
    calfGeo,
    kneeCapGeo: new THREE.SphereGeometry(0.068, 7, 6),
    bootShaftGeo: new THREE.CylinderGeometry(0.066, 0.056, 0.19, 8),
    bootCuffGeo: new THREE.TorusGeometry(0.064, 0.015, 5, 8),
    bootFootGeo: new THREE.CapsuleGeometry(0.054, 0.13, 3, 7),
    torsoGeo,
    neckGeo: new THREE.CylinderGeometry(0.062, 0.078, 0.14, 8),
    beltGeo: new THREE.CylinderGeometry(0.175, 0.178, 0.075, 12),
    buckleGeo: new THREE.BoxGeometry(0.07, 0.08, 0.03),
    pouchGeo: new THREE.BoxGeometry(0.08, 0.11, 0.065),
    cuirassGeo: new THREE.CylinderGeometry(0.225, 0.175, 0.36, 10),
    pauldronGeo: new THREE.SphereGeometry(0.11, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.58),
    capeGeo: new THREE.CylinderGeometry(0.2, 0.34, 0.82, 10, 1, true, Math.PI * 0.65, Math.PI * 0.7),
    cloakGeo: new THREE.CylinderGeometry(0.19, 0.31, 0.78, 10, 1, true, Math.PI * 0.62, Math.PI * 0.76),
    qTubeGeo: new THREE.CylinderGeometry(0.052, 0.042, 0.44, 7),
    qBoltEndGeo: new THREE.CylinderGeometry(0.012, 0.012, 0.14, 5),
    vestGeo: new THREE.CylinderGeometry(0.215, 0.175, 0.32, 10, 1, false),
    craniumGeo: new THREE.SphereGeometry(0.145, 12, 10),
    jawGeo: new THREE.SphereGeometry(0.105, 10, 7),
    earGeo: new THREE.SphereGeometry(0.032, 6, 5),
    noseGeo: new THREE.ConeGeometry(0.025, 0.072, 5),
    eyeGeo: new THREE.SphereGeometry(0.021, 7, 7),
    browGeo: new THREE.BoxGeometry(0.042, 0.011, 0.018),
    beardGeo: new THREE.SphereGeometry(0.112, 9, 7, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.58),
    helmGeo: new THREE.SphereGeometry(0.162, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.56),
    helmBrimGeo: new THREE.CylinderGeometry(0.215, 0.235, 0.028, 12),
    nasalBarGeo: new THREE.BoxGeometry(0.022, 0.075, 0.022),
    crestGeo: new THREE.CapsuleGeometry(0.042, 0.16, 3, 6),
    hatBrimGeo: new THREE.CylinderGeometry(0.24, 0.255, 0.024, 12),
    hatCrownGeo: new THREE.CylinderGeometry(0.11, 0.145, 0.16, 10),
    featherGeo: new THREE.ConeGeometry(0.022, 0.16, 5),
    strawBrimGeo: new THREE.CylinderGeometry(0.24, 0.26, 0.02, 12),
    strawTopGeo: new THREE.CylinderGeometry(0.12, 0.145, 0.11, 12),
    hatBandGeo: new THREE.CylinderGeometry(0.132, 0.142, 0.026, 12),
    hairGeo: new THREE.SphereGeometry(0.156, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62),
    hoodGeo: new THREE.SphereGeometry(0.168, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.68),
    shoulderGeo: new THREE.SphereGeometry(0.068, 7, 6),
    upperArmGeo: new THREE.CapsuleGeometry(0.056, 0.19, 3, 7),
    forearmGeo: new THREE.CylinderGeometry(0.048, 0.036, 0.22, 7),
    handGeo: new THREE.SphereGeometry(0.044, 7, 6),
    shieldWoodGeo: new THREE.CylinderGeometry(0.28, 0.28, 0.038, 12),
    shieldRimGeo: new THREE.TorusGeometry(0.28, 0.022, 5, 12),
    shieldBossGeo: new THREE.SphereGeometry(0.078, 7, 5),
    shaftGeo: new THREE.CylinderGeometry(0.022, 0.028, 2.2, 7),
    gripWrapGeo: new THREE.CylinderGeometry(0.027, 0.027, 0.28, 7),
    socketGeo: new THREE.CylinderGeometry(0.026, 0.032, 0.14, 6),
    bladeGeo: new THREE.ConeGeometry(0.056, 0.34, 4),
    stockGeo: new THREE.BoxGeometry(0.068, 0.076, 0.68),
    bowArcGeo: new THREE.TorusGeometry(0.32, 0.022, 5, 12, Math.PI * 0.72),
    bowStringGeo: new THREE.CylinderGeometry(0.005, 0.005, 0.58, 4),
    loadedBoltGeo: new THREE.CylinderGeometry(0.012, 0.012, 0.42, 5),
  };
  return cachedHumanAssets;
}

/**
 * Builds an anatomically proportioned, two-joint articulated 3D human villager or hunter
 * sharing pooled geometries and cached PBR materials to keep GPU memory minimal.
 */
export function createVillagerRig(
  v: Villager,
  shadowTexture: THREE.Texture,
  humanTex: HumanTextureSet,
  isSoftwareGl: boolean,
): VillagerRig {
  const H = getSharedHumanAssets(shadowTexture, humanTex);
  const root = new THREE.Group();
  const bodyScale = v.isElite ? 1.52 : 1.38 + (v.id % 4) * 0.035;

  const shadowDisc = new THREE.Mesh(H.shadowDiscGeo, H.shadowMat);
  shadowDisc.rotation.x = -Math.PI / 2;
  shadowDisc.position.y = 0.016;
  shadowDisc.scale.setScalar(bodyScale);
  root.add(shadowDisc);

  const telegraphRing = new THREE.Mesh(
    H.telegraphRingGeo,
    v.isElite ? H.telegraphMatElite : H.telegraphMatRegular,
  );
  telegraphRing.rotation.x = -Math.PI / 2;
  telegraphRing.position.y = 0.032;
  telegraphRing.visible = false;
  root.add(telegraphRing);

  const skinMat = getOrCreateCachedMat(
    H.skinMats,
    v.skinTone,
    () => new THREE.MeshStandardMaterial({ color: v.skinTone, roughness: 0.64, metalness: 0.0 }),
  );
  const tunicMat = getOrCreateCachedMat(
    H.tunicMats,
    v.shirtColor,
    () =>
      new THREE.MeshStandardMaterial({
        color: v.shirtColor,
        map: humanTex.linenMap,
        normalMap: humanTex.linenNormal,
        normalScale: new THREE.Vector2(0.85, 0.85),
        roughness: 0.86,
        metalness: 0.01,
      }),
  );
  const skirtMat = getOrCreateCachedMat(
    H.skirtMats,
    v.shirtColor,
    () =>
      new THREE.MeshStandardMaterial({
        color: v.shirtColor,
        map: humanTex.linenMap,
        normalMap: humanTex.linenNormal,
        roughness: 0.88,
        side: THREE.DoubleSide,
      }),
  );
  const trouserMat = getOrCreateCachedMat(
    H.trouserMats,
    v.trouserColor,
    () =>
      new THREE.MeshStandardMaterial({
        color: v.trouserColor,
        map: humanTex.linenMap,
        normalMap: humanTex.linenNormal,
        normalScale: new THREE.Vector2(0.7, 0.7),
        roughness: 0.9,
        metalness: 0.01,
      }),
  );
  const hairMat = getOrCreateCachedMat(
    H.hairMats,
    v.hairColor,
    () => new THREE.MeshStandardMaterial({ color: v.hairColor, roughness: 0.88 }),
  );
  const steelMat = v.isElite ? H.steelMatElite : H.steelMatRegular;

  const actorGroup = new THREE.Group();
  actorGroup.scale.setScalar(bodyScale);
  root.add(actorGroup);

  const pelvisPivot = new THREE.Group();
  pelvisPivot.position.y = 0.92;
  actorGroup.add(pelvisPivot);

  const hipGirdle = new THREE.Mesh(H.hipGirdleGeo, trouserMat);
  hipGirdle.scale.set(1.16, 0.68, 0.82);
  pelvisPivot.add(hipGirdle);

  const tunicSkirt = new THREE.Mesh(H.tunicSkirtGeo, skirtMat);
  tunicSkirt.scale.set(1.14, 1, 0.82);
  tunicSkirt.position.y = -0.05;
  pelvisPivot.add(tunicSkirt);

  const makeLeg = (xOff: number) => {
    const legPivot = new THREE.Group();
    legPivot.position.set(xOff, -0.02, 0);

    const thigh = new THREE.Mesh(H.thighGeo, trouserMat);
    thigh.position.y = -0.44;
    legPivot.add(thigh);

    const kneePivot = new THREE.Group();
    kneePivot.position.y = -0.44;
    legPivot.add(kneePivot);

    const kneeCap = new THREE.Mesh(H.kneeCapGeo, trouserMat);
    kneePivot.add(kneeCap);

    const calf = new THREE.Mesh(H.calfGeo, trouserMat);
    calf.position.y = -0.42;
    kneePivot.add(calf);

    const bootShaft = new THREE.Mesh(H.bootShaftGeo, H.leatherMat);
    bootShaft.position.y = -0.35;
    kneePivot.add(bootShaft);

    const bootCuff = new THREE.Mesh(H.bootCuffGeo, H.leatherMat);
    bootCuff.rotation.x = Math.PI / 2;
    bootCuff.position.y = -0.26;
    kneePivot.add(bootCuff);

    const bootFoot = new THREE.Mesh(H.bootFootGeo, H.leatherMat);
    bootFoot.rotation.x = Math.PI / 2;
    bootFoot.scale.set(1.08, 1.0, 0.74);
    bootFoot.position.set(0, -0.43, 0.065);
    kneePivot.add(bootFoot);

    pelvisPivot.add(legPivot);
    return { legPivot, kneePivot };
  };
  const leftLeg = makeLeg(-0.115);
  const rightLeg = makeLeg(0.115);

  const torsoPivot = new THREE.Group();
  pelvisPivot.add(torsoPivot);

  const torsoMesh = new THREE.Mesh(H.torsoGeo, tunicMat);
  torsoMesh.scale.set(1.18, 1.0, 0.74);
  torsoPivot.add(torsoMesh);

  const neck = new THREE.Mesh(H.neckGeo, skinMat);
  neck.position.y = 0.58;
  torsoPivot.add(neck);

  const belt = new THREE.Mesh(H.beltGeo, H.leatherMat);
  belt.scale.set(1.18, 1, 0.78);
  belt.position.y = 0.055;
  torsoPivot.add(belt);

  const buckle = new THREE.Mesh(H.buckleGeo, H.brassMat);
  buckle.position.set(0, 0.055, 0.145);
  torsoPivot.add(buckle);

  const pouch = new THREE.Mesh(H.pouchGeo, H.leatherMat);
  pouch.position.set(-0.2, 0.0, 0.04);
  pouch.rotation.z = 0.1;
  torsoPivot.add(pouch);

  if (v.role === 'spearman') {
    const cuirass = new THREE.Mesh(H.cuirassGeo, steelMat);
    cuirass.scale.set(1.18, 1, 0.76);
    cuirass.position.y = 0.33;
    torsoPivot.add(cuirass);

    for (const side of [-1, 1]) {
      const pauldron = new THREE.Mesh(H.pauldronGeo, steelMat);
      pauldron.position.set(side * 0.27, 0.48, 0);
      pauldron.rotation.z = -side * 0.42;
      torsoPivot.add(pauldron);
    }

    if (v.isElite) {
      const cape = new THREE.Mesh(H.capeGeo, H.capeMat);
      cape.position.set(0, 0.14, -0.05);
      cape.rotation.x = 0.14;
      torsoPivot.add(cape);
    }
  } else if (v.role === 'crossbow' || v.role === 'hide') {
    const cloak = new THREE.Mesh(
      H.cloakGeo,
      v.role === 'crossbow' ? H.cloakCrossbowMat : H.cloakHideMat,
    );
    cloak.position.set(0, 0.14, -0.04);
    cloak.rotation.x = 0.12;
    torsoPivot.add(cloak);

    if (v.role === 'crossbow') {
      const quiverGroup = new THREE.Group();
      quiverGroup.position.set(0.08, 0.36, -0.16);
      quiverGroup.rotation.set(0.15, 0, -0.42);
      const qTube = new THREE.Mesh(H.qTubeGeo, H.leatherMat);
      quiverGroup.add(qTube);
      for (let q = 0; q < 3; q++) {
        const boltEnd = new THREE.Mesh(H.qBoltEndGeo, H.fletchMat);
        boltEnd.position.set((q - 1) * 0.02, 0.25, (q % 2) * 0.015);
        quiverGroup.add(boltEnd);
      }
      torsoPivot.add(quiverGroup);
    }
  } else {
    const vest = new THREE.Mesh(H.vestGeo, H.leatherMat);
    vest.scale.set(1.12, 1, 0.72);
    vest.position.y = 0.31;
    torsoPivot.add(vest);
  }

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.62, 0);
  torsoPivot.add(headPivot);

  const cranium = new THREE.Mesh(H.craniumGeo, skinMat);
  cranium.scale.set(0.9, 1.04, 1.0);
  cranium.position.y = 0.175;
  headPivot.add(cranium);

  const jaw = new THREE.Mesh(H.jawGeo, skinMat);
  jaw.scale.set(0.84, 0.94, 0.96);
  jaw.position.set(0, 0.098, 0.028);
  headPivot.add(jaw);

  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(H.earGeo, skinMat);
    ear.scale.set(0.45, 1.0, 0.75);
    ear.position.set(sx * 0.132, 0.16, -0.008);
    headPivot.add(ear);
  }

  const nose = new THREE.Mesh(H.noseGeo, skinMat);
  nose.rotation.x = Math.PI * 0.42;
  nose.position.set(0, 0.15, 0.146);
  headPivot.add(nose);

  for (const sx of [-0.048, 0.048]) {
    const eye = new THREE.Mesh(H.eyeGeo, H.eyeMat);
    eye.position.set(sx, 0.175, 0.128);
    eye.rotation.y = -Math.PI / 2;
    headPivot.add(eye);

    const brow = new THREE.Mesh(H.browGeo, hairMat);
    brow.position.set(sx, 0.205, 0.132);
    brow.rotation.z =
      sx < 0
        ? v.role === 'spearman' || v.role === 'crossbow'
          ? -0.18
          : 0.08
        : v.role === 'spearman' || v.role === 'crossbow'
          ? 0.18
          : -0.08;
    headPivot.add(brow);
  }

  if (v.hasBeard) {
    const beard = new THREE.Mesh(H.beardGeo, hairMat);
    beard.scale.set(0.86, 1.08, 0.92);
    beard.position.set(0, 0.105, 0.028);
    headPivot.add(beard);
  }

  if (v.role === 'spearman') {
    const helm = new THREE.Mesh(H.helmGeo, steelMat);
    helm.scale.set(0.95, 1.05, 1.04);
    helm.position.y = 0.195;
    headPivot.add(helm);

    const helmBrim = new THREE.Mesh(H.helmBrimGeo, steelMat);
    helmBrim.position.y = 0.195;
    headPivot.add(helmBrim);

    const nasalBar = new THREE.Mesh(H.nasalBarGeo, steelMat);
    nasalBar.position.set(0, 0.17, 0.155);
    headPivot.add(nasalBar);

    if (v.isElite) {
      const crest = new THREE.Mesh(H.crestGeo, H.crestMat);
      crest.rotation.x = Math.PI / 2;
      crest.position.set(0, 0.36, -0.02);
      headPivot.add(crest);
    }
  } else if (v.role === 'crossbow') {
    const hatBrim = new THREE.Mesh(H.hatBrimGeo, H.leatherMat);
    hatBrim.position.y = 0.28;
    headPivot.add(hatBrim);
    const hatCrown = new THREE.Mesh(H.hatCrownGeo, H.leatherMat);
    hatCrown.position.y = 0.35;
    headPivot.add(hatCrown);
    const feather = new THREE.Mesh(
      H.featherGeo,
      v.isElite ? H.featherGoldMat : H.featherRedMat,
    );
    feather.position.set(0.12, 0.38, -0.02);
    feather.rotation.z = -0.55;
    headPivot.add(feather);
  } else if (v.role === 'flee') {
    if (v.id % 2 === 0) {
      const strawBrim = new THREE.Mesh(H.strawBrimGeo, H.strawMat);
      strawBrim.position.y = 0.28;
      headPivot.add(strawBrim);
      const strawTop = new THREE.Mesh(H.strawTopGeo, H.strawMat);
      strawTop.position.y = 0.335;
      headPivot.add(strawTop);
      const hatBand = new THREE.Mesh(H.hatBandGeo, H.leatherMat);
      hatBand.position.y = 0.3;
      headPivot.add(hatBand);
    } else {
      const hair = new THREE.Mesh(H.hairGeo, hairMat);
      hair.scale.set(0.94, 1.04, 1.04);
      hair.position.set(0, 0.185, -0.015);
      hair.rotation.x = -0.18;
      headPivot.add(hair);
    }
  } else {
    const hood = new THREE.Mesh(H.hoodGeo, tunicMat);
    hood.position.set(0, 0.185, -0.02);
    hood.rotation.x = -0.25;
    headPivot.add(hood);
  }

  const makeArm = (side: number) => {
    const armPivot = new THREE.Group();
    armPivot.position.set(side * 0.275, 0.49, 0);

    const shoulder = new THREE.Mesh(H.shoulderGeo, tunicMat);
    armPivot.add(shoulder);

    const upperArm = new THREE.Mesh(H.upperArmGeo, tunicMat);
    upperArm.position.y = -0.135;
    armPivot.add(upperArm);

    const elbowPivot = new THREE.Group();
    elbowPivot.position.y = -0.265;
    armPivot.add(elbowPivot);

    const forearm = new THREE.Mesh(
      H.forearmGeo,
      v.role === 'spearman' ? H.leatherMat : skinMat,
    );
    forearm.position.y = -0.11;
    elbowPivot.add(forearm);

    const hand = new THREE.Mesh(H.handGeo, skinMat);
    hand.scale.set(0.82, 1.15, 0.92);
    hand.position.y = -0.235;
    elbowPivot.add(hand);

    torsoPivot.add(armPivot);
    return { armPivot, elbowPivot };
  };
  const leftArm = makeArm(-1);
  const rightArm = makeArm(1);

  let weaponPivot: THREE.Group | undefined;
  if (v.role === 'spearman') {
    const shieldGroup = new THREE.Group();
    shieldGroup.position.set(-0.075, -0.14, 0.06);
    const shieldWood = new THREE.Mesh(H.shieldWoodGeo, H.woodMat);
    shieldWood.rotation.z = Math.PI / 2;
    shieldGroup.add(shieldWood);
    const shieldRim = new THREE.Mesh(H.shieldRimGeo, steelMat);
    shieldRim.rotation.y = Math.PI / 2;
    shieldGroup.add(shieldRim);
    const shieldBoss = new THREE.Mesh(H.shieldBossGeo, steelMat);
    shieldBoss.scale.set(0.6, 1, 1);
    shieldBoss.position.x = -0.025;
    shieldGroup.add(shieldBoss);
    leftArm.elbowPivot.add(shieldGroup);

    weaponPivot = new THREE.Group();
    weaponPivot.position.set(0, -0.235, 0.03);
    const shaft = new THREE.Mesh(H.shaftGeo, H.woodMat);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = 0.45;
    weaponPivot.add(shaft);

    const gripWrap = new THREE.Mesh(H.gripWrapGeo, H.leatherMat);
    gripWrap.rotation.x = Math.PI / 2;
    weaponPivot.add(gripWrap);

    const socket = new THREE.Mesh(H.socketGeo, steelMat);
    socket.rotation.x = Math.PI / 2;
    socket.position.z = 1.56;
    weaponPivot.add(socket);

    const blade = new THREE.Mesh(H.bladeGeo, steelMat);
    blade.scale.set(1.0, 1.0, 0.55);
    blade.rotation.x = Math.PI / 2;
    blade.position.z = 1.78;
    weaponPivot.add(blade);
    rightArm.elbowPivot.add(weaponPivot);
  } else if (v.role === 'crossbow') {
    weaponPivot = new THREE.Group();
    weaponPivot.position.set(0, -0.22, 0.08);
    const stock = new THREE.Mesh(H.stockGeo, H.woodMat);
    stock.position.z = 0.22;
    weaponPivot.add(stock);

    const bowArc = new THREE.Mesh(H.bowArcGeo, steelMat);
    bowArc.rotation.x = Math.PI / 2;
    bowArc.rotation.z = -Math.PI * 0.86;
    bowArc.position.z = 0.24;
    weaponPivot.add(bowArc);

    const bowString = new THREE.Mesh(H.bowStringGeo, H.bowStringMat);
    bowString.rotation.z = Math.PI / 2;
    bowString.position.set(0, 0.02, 0.38);
    weaponPivot.add(bowString);

    const loadedBolt = new THREE.Mesh(H.loadedBoltGeo, H.woodMat);
    loadedBolt.rotation.x = Math.PI / 2;
    loadedBolt.position.set(0, 0.042, 0.36);
    weaponPivot.add(loadedBolt);

    rightArm.elbowPivot.add(weaponPivot);
  }

  return {
    root,
    pelvisPivot,
    torsoPivot,
    headPivot,
    leftArmPivot: leftArm.armPivot,
    rightArmPivot: rightArm.armPivot,
    leftElbowPivot: leftArm.elbowPivot,
    rightElbowPivot: rightArm.elbowPivot,
    leftLegPivot: leftLeg.legPivot,
    rightLegPivot: rightLeg.legPivot,
    leftKneePivot: leftLeg.kneePivot,
    rightKneePivot: rightLeg.kneePivot,
    torsoMesh,
    skirtMesh: tunicSkirt,
    baseTunicMat: tunicMat,
    baseSkirtMat: skirtMat,
    hitFlashMat: H.hitFlashMat,
    poisonMat: H.poisonMat,
    isFlashing: false,
    isPoisoned: false,
    telegraphRing,
    weaponPivot,
  };
}

/**
 * Animates biomechanical 2-joint walking/sprinting, panic fleeing, crouching inside shelter,
 * hunter spear/crossbow windup telegraphs, hit flashes, poison/stun states, and KO collapse.
 */
export function animateVillagerRig(rig: VillagerRig, v: Villager, elapsed: number): void {
  rig.root.position.set(v.x, v.y, v.z);
  rig.root.rotation.y = v.heading;

  const wantFlash = v.hitFlash > 0.02;
  const wantPoison = !wantFlash && (v.poisonTimer ?? 0) > 0.05;
  if (wantFlash !== rig.isFlashing || wantPoison !== rig.isPoisoned) {
    rig.isFlashing = wantFlash;
    rig.isPoisoned = wantPoison;
    const mat = wantFlash
      ? rig.hitFlashMat
      : wantPoison
        ? rig.poisonMat
        : rig.baseTunicMat;
    rig.torsoMesh.material = mat;
    rig.skirtMesh.material = wantFlash ? rig.hitFlashMat : wantPoison ? rig.poisonMat : rig.baseSkirtMat;
  }

  if (v.state === 'ko') {
    const t = Math.min(1, 1 - v.koTimer / 0.48);
    rig.pelvisPivot.position.y = 0.92 - t * 0.7;
    rig.pelvisPivot.rotation.z = t * (Math.PI * 0.48);
    rig.pelvisPivot.rotation.x = t * 0.25;
    rig.leftKneePivot.rotation.x = 0.65 * t;
    rig.rightKneePivot.rotation.x = 0.9 * t;
    rig.telegraphRing.visible = false;
    return;
  }

  if (v.grabbed) {
    // Struggling mid-air as the snake tail coils and reels the villager in!
    rig.pelvisPivot.position.y = 0.92;
    rig.pelvisPivot.rotation.set(0.28, 0, Math.sin(elapsed * 24) * 0.22);
    rig.torsoPivot.rotation.set(-0.2, 0, 0);
    rig.leftArmPivot.rotation.set(-2.3, 0, -0.4);
    rig.rightArmPivot.rotation.set(-2.3, 0, 0.4);
    rig.leftLegPivot.rotation.x = Math.sin(elapsed * 26) * 0.65;
    rig.rightLegPivot.rotation.x = -Math.sin(elapsed * 26) * 0.65;
    rig.telegraphRing.visible = false;
    return;
  }

  rig.pelvisPivot.rotation.set(0, 0, 0);

  if ((v.stunTimer ?? 0) > 0.05) {
    rig.pelvisPivot.position.y = 0.88;
    rig.torsoPivot.rotation.set(0.18, Math.sin(elapsed * 9) * 0.12, 0);
    rig.headPivot.rotation.set(0.2, Math.sin(elapsed * 14) * 0.35, Math.cos(elapsed * 11) * 0.22);
    rig.leftArmPivot.rotation.set(-0.6, 0, -0.25);
    rig.rightArmPivot.rotation.set(-0.6, 0, 0.25);
    rig.telegraphRing.visible = false;
    return;
  }

  if (v.state === 'hiding') {
    // Deep natural crouch inside shelter with folded knees and protective arms
    rig.pelvisPivot.position.y = 0.54;
    rig.torsoPivot.rotation.set(0.46, 0, 0);
    rig.headPivot.rotation.set(-0.34, Math.sin(elapsed * 2.5 + v.phase) * 0.14, 0);
    rig.leftLegPivot.rotation.x = -1.25;
    rig.rightLegPivot.rotation.x = -1.25;
    rig.leftKneePivot.rotation.x = 1.95;
    rig.rightKneePivot.rotation.x = 1.95;
    rig.leftArmPivot.rotation.set(-0.85, 0, 0);
    rig.rightArmPivot.rotation.set(-0.85, 0, 0);
    rig.leftElbowPivot.rotation.x = -1.35;
    rig.rightElbowPivot.rotation.x = -1.35;
    rig.telegraphRing.visible = false;
    return;
  }

  const speed = Math.hypot(v.vx, v.vz);
  const moving = speed > 0.2;
  const stride = moving ? Math.sin(v.gaitPhase) : 0;
  const amp = v.state === 'fleeing' || v.state === 'pursue' ? 0.74 : 0.44;

  // Vertical bounce & natural hip/torso counter-twist
  rig.pelvisPivot.position.y = 0.92 + (moving ? Math.abs(Math.sin(v.gaitPhase)) * 0.05 : 0);
  rig.pelvisPivot.rotation.z = moving ? stride * 0.035 : 0;
  rig.torsoPivot.rotation.set(
    v.state === 'fleeing' ? 0.2 : v.state === 'pursue' ? 0.14 : 0.02,
    moving ? -stride * 0.12 : 0,
    0,
  );
  rig.headPivot.rotation.set(
    Math.sin(elapsed * 2.1 + v.phase) * 0.04,
    v.state === 'fleeing' ? Math.sin(elapsed * 6 + v.phase) * 0.22 : 0,
    0,
  );

  // Natural 2-joint knee bend: bends smoothly during swing-back & cushions foot plant
  rig.leftLegPivot.rotation.x = stride * amp;
  rig.rightLegPivot.rotation.x = -stride * amp;
  rig.leftKneePivot.rotation.x = moving ? Math.max(0.08, -stride * amp * 1.1 + 0.26) : 0.06;
  rig.rightKneePivot.rotation.x = moving ? Math.max(0.08, stride * amp * 1.1 + 0.26) : 0.06;

  if (v.state === 'fleeing') {
    const wave = Math.sin(elapsed * 13 + v.phase) * 0.3;
    rig.leftArmPivot.rotation.set(-2.1 + wave, 0, -0.32);
    rig.rightArmPivot.rotation.set(-2.1 - wave, 0, 0.32);
    rig.leftElbowPivot.rotation.x = -0.85;
    rig.rightElbowPivot.rotation.x = -0.85;
    rig.telegraphRing.visible = false;
    return;
  }

  if (v.state === 'windup') {
    rig.telegraphRing.visible = true;
    const pulse = 0.88 + Math.sin(elapsed * 24) * 0.18;
    rig.telegraphRing.scale.setScalar(pulse);

    if (v.role === 'spearman') {
      // Coil torso back & raise spear over shoulder with shield braced
      rig.torsoPivot.rotation.set(-0.08, -0.38, 0);
      rig.leftArmPivot.rotation.set(-0.8, 0.35, 0);
      rig.leftElbowPivot.rotation.x = -1.05;
      rig.rightArmPivot.rotation.set(-2.05, -0.18, 0.12);
      rig.rightElbowPivot.rotation.x = -0.65;
    } else {
      // Brace crossbow shoulder-level & aim steadily
      rig.torsoPivot.rotation.set(0.06, -0.18, 0);
      rig.leftArmPivot.rotation.set(-1.15, 0.3, 0);
      rig.leftElbowPivot.rotation.x = -0.9;
      rig.rightArmPivot.rotation.set(-1.35, -0.1, 0);
      rig.rightElbowPivot.rotation.x = -0.75;
    }
    return;
  }

  if (v.state === 'attack') {
    rig.telegraphRing.visible = false;
    if (v.role === 'spearman') {
      // Full forward spear lunge!
      rig.torsoPivot.rotation.set(0.32, 0.3, 0);
      rig.leftArmPivot.rotation.set(-0.55, 0.35, 0);
      rig.leftElbowPivot.rotation.x = -1.0;
      rig.rightArmPivot.rotation.set(-1.38, 0.1, 0);
      rig.rightElbowPivot.rotation.x = -0.15;
    } else {
      rig.torsoPivot.rotation.set(0.02, -0.15, 0);
      rig.rightArmPivot.rotation.set(-1.42, -0.1, 0);
      rig.rightElbowPivot.rotation.x = -0.7;
    }
    return;
  }

  rig.telegraphRing.visible = false;

  if (v.role === 'spearman') {
    rig.leftArmPivot.rotation.set(-0.48 + stride * 0.22, 0.28, 0);
    rig.leftElbowPivot.rotation.x = -0.95;
    rig.rightArmPivot.rotation.set(-0.48 - stride * 0.22, 0, 0);
    rig.rightElbowPivot.rotation.x = -0.85;
  } else if (v.role === 'crossbow') {
    rig.leftArmPivot.rotation.set(-0.82 + stride * 0.18, 0.25, 0);
    rig.leftElbowPivot.rotation.x = -0.85;
    rig.rightArmPivot.rotation.set(-0.92, -0.1, 0);
    rig.rightElbowPivot.rotation.x = -0.78;
  } else {
    rig.leftArmPivot.rotation.set(-stride * amp * 0.72, 0, 0.06);
    rig.rightArmPivot.rotation.set(stride * amp * 0.72, 0, -0.06);
    rig.leftElbowPivot.rotation.x = moving ? -0.58 - Math.max(0, stride) * 0.35 : -0.24;
    rig.rightElbowPivot.rotation.x = moving ? -0.58 - Math.max(0, -stride) * 0.35 : -0.24;
  }
}

export interface LaidEggRig {
  root: THREE.Group;
  eggMesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
}

function getSharedEggAssets(shadowTexture: THREE.Texture): SharedEggAssets {
  if (cachedEggAssets && cachedEggAssets.shadowTexture === shadowTexture) {
    return cachedEggAssets;
  }
  if (cachedEggAssets) {
    disposeAssetRecord(cachedEggAssets);
  }
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const r = Math.sin(t * Math.PI) * (0.21 - t * 0.05);
    pts.push(new THREE.Vector2(Math.max(0.001, r), t * 0.48));
  }
  cachedEggAssets = {
    shadowTexture,
    shadowGeo: new THREE.CircleGeometry(0.55, 12),
    shadowMat: new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    }),
    twigMat: new THREE.MeshStandardMaterial({ color: 0x3b2817, roughness: 0.94 }),
    twigGeo: new THREE.CylinderGeometry(0.02, 0.026, 0.42, 5),
    eggGeo: new THREE.LatheGeometry(pts, 14),
  };
  return cachedEggAssets;
}

/**
 * Builds an incubating snake clutch egg nestled on moss & twigs, glowing softly as it nears hatching.
 */
export function createLaidEggRig(
  egg: LaidEgg,
  shadowTexture: THREE.Texture,
  eggTex: { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture },
  enableShadows = true,
): LaidEggRig {
  const E = getSharedEggAssets(shadowTexture);
  const root = new THREE.Group();
  root.position.set(egg.x, egg.y, egg.z);

  const shadowDisc = new THREE.Mesh(E.shadowGeo, E.shadowMat);
  shadowDisc.rotation.x = -Math.PI / 2;
  shadowDisc.position.y = 0.015;
  root.add(shadowDisc);

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const twig = new THREE.Mesh(E.twigGeo, E.twigMat);
    twig.rotation.z = Math.PI / 2;
    twig.rotation.y = a + 0.3;
    twig.position.set(Math.cos(a) * 0.24, 0.05, Math.sin(a) * 0.24);
    root.add(twig);
  }

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: eggTex.map,
    normalMap: eggTex.normalMap,
    roughness: 0.34,
    metalness: 0.04,
    emissive: 0x4ca84e,
    emissiveIntensity: 0.15,
  });
  const eggMesh = new THREE.Mesh(E.eggGeo, mat);
  eggMesh.position.y = 0.03;
  eggMesh.castShadow = enableShadows;
  root.add(eggMesh);

  return { root, eggMesh, mat };
}

export function animateLaidEggRig(rig: LaidEggRig, egg: LaidEgg, elapsed: number): void {
  const prog = Math.min(1, egg.age / Math.max(0.1, egg.hatchTime));
  const pulse = 1 + Math.sin(elapsed * (4 + prog * 18)) * (0.03 + prog * 0.06);
  rig.eggMesh.scale.set(pulse, 1 / Math.sqrt(pulse), pulse);
  // Wobble energetically just before hatching!
  rig.eggMesh.rotation.z = prog > 0.65 ? Math.sin(elapsed * 28) * 0.22 * (prog - 0.65) * 2.5 : 0.06;
  rig.mat.emissiveIntensity = 0.16 + prog * 0.55;
}

export interface HatchlingRig {
  root: THREE.Group;
  headRig: SnakeHeadRig;
  body: ContinuousSnakeBody;
}

export function createHatchlingRig(
  headMaterial: THREE.Material,
  scaleMaterial: THREE.Material,
  bellyMaterial: THREE.Material,
  eyeTexture: THREE.Texture,
  castShadow: boolean,
): HatchlingRig {
  const root = new THREE.Group();
  const headRig = createSnakeHeadRig(
    headMaterial,
    scaleMaterial,
    bellyMaterial,
    eyeTexture,
    castShadow,
  );
  headRig.cobraHood.visible = false;
  root.add(headRig.root);

  const body = new ContinuousSnakeBody(scaleMaterial, castShadow, 40, 14);
  root.add(body.mesh);

  return { root, headRig, body };
}

export function updateHatchlingRig(
  rig: HatchlingRig,
  h: Hatchling,
  elapsed: number,
  morph: SpeciesMorph,
  hIdx = -1,
): void {
  const scale = 0.42 + h.growth * 0.26;
  const headY = h.y + (0.17 + h.growth * 0.09) * 0.58 + 0.03;

  rig.headRig.root.position.set(h.x, headY, h.z);
  rig.headRig.root.rotation.set(0, h.heading, 0);
  rig.headRig.root.scale.set(
    morph.headWidth * scale,
    morph.headHeight * scale,
    morph.headLength * scale,
  );
  rig.headRig.jawPivot.rotation.x = h.biteCooldown > 0.45 ? 0.5 : 0;
  rig.headRig.tongueGroup.visible = Math.sin(elapsed * 7 + h.id) > 0.7;

  if (h.segmentPoses.length >= 3) {
    const segSpacing = 0.2 + h.growth * 0.08;
    if (hIdx >= 0) {
      rig.body.updateHatchling(hIdx, headY, h.segmentPoses.length, elapsed, morph, segSpacing);
    } else {
      rig.body.update(
        h.x,
        headY,
        h.z,
        h.heading,
        0,
        h.segmentPoses,
        h.segmentPoses.length,
        elapsed,
        morph,
        segSpacing,
        HEAD_RADIUS * scale,
      );
    }
  }
}

function getSharedBoltAssets(): SharedBoltAssets {
  if (!cachedBoltAssets) {
    cachedBoltAssets = {
      shaftGeo: new THREE.CylinderGeometry(0.022, 0.022, 0.56, 6),
      shaftMat: new THREE.MeshStandardMaterial({ color: 0x4f351e, roughness: 0.8 }),
      tipGeo: new THREE.ConeGeometry(0.042, 0.14, 4),
      tipMat: new THREE.MeshStandardMaterial({ color: 0xb0bac2, roughness: 0.3, metalness: 0.85 }),
      fletchGeo: new THREE.BoxGeometry(0.11, 0.015, 0.14),
      fletchMat: new THREE.MeshStandardMaterial({ color: 0xc93b2b, roughness: 0.75 }),
      venomCoreGeo: new THREE.SphereGeometry(0.18, 10, 8),
      venomDropGeo: new THREE.ConeGeometry(0.14, 0.42, 7),
      venomMat: new THREE.MeshStandardMaterial({
        color: 0x94f536,
        emissive: 0x5acc14,
        emissiveIntensity: 1.15,
        roughness: 0.18,
      }),
      mistOrbGeo: new THREE.SphereGeometry(0.42, 10, 8),
      mistMat: new THREE.MeshStandardMaterial({
        color: 0x52e078,
        emissive: 0x26a648,
        emissiveIntensity: 0.85,
        roughness: 0.4,
        transparent: true,
        opacity: 0.72,
      }),
    };
  }
  return cachedBoltAssets;
}

/**
 * Builds a sleek 3-part crossbow bolt projectile using shared geometries and materials.
 */
export function createBoltMesh(): THREE.Group {
  const B = getSharedBoltAssets();
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(B.shaftGeo, B.shaftMat);
  shaft.rotation.x = Math.PI / 2;
  g.add(shaft);

  const tip = new THREE.Mesh(B.tipGeo, B.tipMat);
  tip.rotation.x = Math.PI / 2;
  tip.position.z = 0.33;
  g.add(tip);

  const fletch = new THREE.Mesh(B.fletchGeo, B.fletchMat);
  fletch.position.z = -0.22;
  g.add(fletch);
  return g;
}

export function createVenomGlobMesh(): THREE.Group {
  const B = getSharedBoltAssets();
  const g = new THREE.Group();
  const core = new THREE.Mesh(B.venomCoreGeo, B.venomMat);
  g.add(core);
  const tail = new THREE.Mesh(B.venomDropGeo, B.venomMat);
  tail.rotation.x = -Math.PI / 2;
  tail.position.z = -0.22;
  g.add(tail);
  return g;
}

export function createMistOrbMesh(): THREE.Group {
  const B = getSharedBoltAssets();
  const g = new THREE.Group();
  const orb = new THREE.Mesh(B.mistOrbGeo, B.mistMat);
  g.add(orb);
  return g;
}

export function createPowerWaveRing(): {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  geometry: THREE.RingGeometry;
} {
  const geometry = new THREE.RingGeometry(0.55, 1.0, 32);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    color: 0x84cc16,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.visible = false;
  return { mesh, material, geometry };
}

export function createTailTetherMesh(): {
  group: THREE.Group;
  tether: THREE.Mesh;
  lasso: THREE.Mesh;
  geometry: THREE.CylinderGeometry;
  lassoGeo: THREE.TorusGeometry;
  material: THREE.MeshStandardMaterial;
} {
  const geometry = new THREE.CylinderGeometry(0.11, 0.16, 1.0, 8);
  geometry.translate(0, 0.5, 0);
  geometry.rotateX(Math.PI / 2);
  const lassoGeo = new THREE.TorusGeometry(0.46, 0.09, 7, 16);
  const material = new THREE.MeshStandardMaterial({
    color: 0xd4a853,
    emissive: 0x6ba832,
    emissiveIntensity: 0.75,
    roughness: 0.35,
  });
  const tether = new THREE.Mesh(geometry, material);
  const lasso = new THREE.Mesh(lassoGeo, material);
  lasso.rotation.x = Math.PI / 2;
  const group = new THREE.Group();
  group.add(tether, lasso);
  group.visible = false;
  return { group, tether, lasso, geometry, lassoGeo, material };
}



