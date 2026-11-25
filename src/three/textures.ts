import * as THREE from 'three';
import { SnakeSpecies } from '../game/types';
import { snakeCoreWasm } from '../wasm/snakeCoreWasm';

export interface PbrTextureSet {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap?: THREE.CanvasTexture;
}

export interface SpeciesMorph {
  headWidth: number;
  headLength: number;
  headHeight: number;
  bodyWidth: number;
  bodyHeight: number;
  hoodStrength: number;
  hasRattle: boolean;
  slitPupil: boolean;
  clearcoat: number;
  roughness: number;
  iridescence: number;
  normalScale: number;
  hasCoonTail: boolean;
}

const SPECIES_MORPHS: Record<SnakeSpecies, SpeciesMorph> = {
  emerald: {
    headWidth: 1.08,
    headLength: 1.06,
    headHeight: 1.04,
    bodyWidth: 0.60,
    bodyHeight: 0.64,
    hoodStrength: 0,
    hasRattle: false,
    slitPupil: true,
    clearcoat: 0.28,
    roughness: 0.45,
    iridescence: 0.22,
    normalScale: 2.1,
    hasCoonTail: false,
  },
  golden: {
    headWidth: 0.98,
    headLength: 1.12,
    headHeight: 1.02,
    bodyWidth: 0.56,
    bodyHeight: 0.59,
    hoodStrength: 0.76,
    hasRattle: false,
    slitPupil: false,
    clearcoat: 0.25,
    roughness: 0.46,
    iridescence: 0.16,
    normalScale: 1.9,
    hasCoonTail: false,
  },
  obsidian: {
    headWidth: 0.98,
    headLength: 1.12,
    headHeight: 0.98,
    bodyWidth: 0.62,
    bodyHeight: 0.65,
    hoodStrength: 0,
    hasRattle: false,
    slitPupil: true,
    clearcoat: 0.36,
    roughness: 0.39,
    iridescence: 0.44,
    normalScale: 1.85,
    hasCoonTail: false,
  },
  rattler: {
    headWidth: 1.18,
    headLength: 0.98,
    headHeight: 1.06,
    bodyWidth: 0.65,
    bodyHeight: 0.65,
    hoodStrength: 0,
    hasRattle: true,
    slitPupil: true,
    clearcoat: 0.14,
    roughness: 0.62,
    iridescence: 0.08,
    normalScale: 2.5,
    hasCoonTail: true,
  },
  coral: {
    headWidth: 0.92,
    headLength: 1.04,
    headHeight: 0.94,
    bodyWidth: 0.52,
    bodyHeight: 0.55,
    hoodStrength: 0,
    hasRattle: false,
    slitPupil: false,
    clearcoat: 0.38,
    roughness: 0.36,
    iridescence: 0.18,
    normalScale: 1.5,
    hasCoonTail: false,
  },
  albino: {
    headWidth: 1.08,
    headLength: 1.06,
    headHeight: 1.04,
    bodyWidth: 0.64,
    bodyHeight: 0.67,
    hoodStrength: 0,
    hasRattle: false,
    slitPupil: true,
    clearcoat: 0.3,
    roughness: 0.41,
    iridescence: 0.22,
    normalScale: 1.75,
    hasCoonTail: false,
  },
};

export function getSpeciesMorph(species: SnakeSpecies): SpeciesMorph {
  return SPECIES_MORPHS[species];
}

const SPECIES_PALETTES: Record<
  SnakeSpecies,
  {
    baseDark: string;
    baseMid: string;
    highlight: string;
    blotch: string;
    blotchRim: string;
    rim: string;
    belly: string;
    eyeColor: number;
    pattern: 'emerald' | 'chevron' | 'mottled' | 'diamond' | 'banded' | 'albino';
  }
> = {
  emerald: {
    baseDark: '#0f3619',
    baseMid: '#1f5e2c',
    highlight: '#358240',
    blotch: '#e8e4c2',
    blotchRim: '#0a2410',
    rim: '#07170b',
    belly: '#ced09c',
    eyeColor: 0xd49626,
    pattern: 'emerald',
  },
  golden: {
    baseDark: '#382610',
    baseMid: '#6e4c1d',
    highlight: '#9e702a',
    blotch: '#e2c578',
    blotchRim: '#211407',
    rim: '#170d04',
    belly: '#dfd1a4',
    eyeColor: 0xd99b2a,
    pattern: 'chevron',
  },
  obsidian: {
    baseDark: '#101418',
    baseMid: '#1e2730',
    highlight: '#344959',
    blotch: '#181e24',
    blotchRim: '#4a6070',
    rim: '#050709',
    belly: '#7c878f',
    eyeColor: 0xe0a93a,
    pattern: 'mottled',
  },
  rattler: {
    baseDark: '#473625',
    baseMid: '#785e43',
    highlight: '#9e8260',
    blotch: '#24180f',
    blotchRim: '#d4be98',
    rim: '#1a120a',
    belly: '#d6c8ad',
    eyeColor: 0xc97b28,
    pattern: 'diamond',
  },
  coral: {
    baseDark: '#6b1216',
    baseMid: '#a81d22',
    highlight: '#c72c31',
    blotch: '#101114',
    blotchRim: '#dbb344',
    rim: '#120809',
    belly: '#dfd0ac',
    eyeColor: 0x3b2416,
    pattern: 'banded',
  },
  albino: {
    baseDark: '#d2c7ab',
    baseMid: '#eae2cb',
    highlight: '#f7f2e4',
    blotch: '#d89b3c',
    blotchRim: '#f0cc75',
    rim: '#9c8e72',
    belly: '#fcf8ec',
    eyeColor: 0xc42138,
    pattern: 'albino',
  },
};

export function getSpeciesBellyColor(species: SnakeSpecies): string {
  return SPECIES_PALETTES[species].belly;
}

export function getSpeciesEyeColor(species: SnakeSpecies): number {
  return SPECIES_PALETTES[species].eyeColor;
}

function hash2D(ix: number, iy: number, period = 32): number {
  const x = ((ix % period) + period) % period;
  const y = ((iy % period) + period) % period;
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function tileableNoise(u: number, v: number, freq: number): number {
  const x = u * freq;
  const y = v * freq;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const a = hash2D(ix, iy, freq);
  const b = hash2D(ix + 1, iy, freq);
  const c = hash2D(ix, iy + 1, freq);
  const d = hash2D(ix + 1, iy + 1, freq);

  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbmTileable(u: number, v: number, baseFreq = 4): number {
  let val = 0;
  let amp = 0.55;
  let freq = baseFreq;
  for (let i = 0; i < 3; i++) {
    val += tileableNoise(u, v, freq) * amp;
    freq *= 2;
    amp *= 0.48;
  }
  return val;
}

function finalizeCanvasTexture(
  srcCanvas: HTMLCanvasElement,
  lowMem: boolean,
  lowSize: number,
  maxAnisotropy: number,
  colorSpace: THREE.ColorSpace | null,
  wrapS: THREE.Wrapping,
  wrapT: THREE.Wrapping,
  repeatX = 1,
  repeatY = 1,
): THREE.CanvasTexture {
  let target = srcCanvas;
  if (lowMem && srcCanvas.width > lowSize) {
    target = document.createElement('canvas');
    target.width = lowSize;
    target.height = lowSize;
    target.getContext('2d')!.drawImage(srcCanvas, 0, 0, lowSize, lowSize);
  }
  const tex = new THREE.CanvasTexture(target);
  if (colorSpace) tex.colorSpace = colorSpace;
  tex.wrapS = wrapS;
  tex.wrapT = wrapT;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = lowMem ? 1 : maxAnisotropy;
  return tex;
}

/**
 * Converts a grayscale height canvas into a true tangent-space RGB Normal Map via Sobel filter.
 */
function heightCanvasToNormalTexture(
  heightCanvas: HTMLCanvasElement,
  strength: number,
  maxAnisotropy: number,
  repeatX = 1,
  repeatY = 1,
  lowMem = false,
  lowSize = 256,
): THREE.CanvasTexture {
  let srcCanvas = heightCanvas;
  if (lowMem && heightCanvas.width > lowSize) {
    srcCanvas = document.createElement('canvas');
    srcCanvas.width = lowSize;
    srcCanvas.height = lowSize;
    srcCanvas.getContext('2d')!.drawImage(heightCanvas, 0, 0, lowSize, lowSize);
  }
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const hCtx = srcCanvas.getContext('2d')!;
  const src = hCtx.getImageData(0, 0, w, h).data;

  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = w;
  normalCanvas.height = h;
  const nCtx = normalCanvas.getContext('2d')!;
  const dst = nCtx.createImageData(w, h);

  if (w * h <= 512 * 512 && snakeCoreWasm.isReady()) {
    snakeCoreWasm.sobelHeightToNormal(src, w, h, strength, dst.data);
  } else {
    const sample = (x: number, y: number) => {
      const wx = ((x % w) + w) % w;
      const wy = ((y % h) + h) % h;
      return src[(wy * w + wx) * 4] / 255;
    };

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const tl = sample(x - 1, y - 1);
        const t = sample(x, y - 1);
        const tr = sample(x + 1, y - 1);
        const l = sample(x - 1, y);
        const r = sample(x + 1, y);
        const bl = sample(x - 1, y + 1);
        const b = sample(x, y + 1);
        const br = sample(x + 1, y + 1);

        const dx = (tr + 2 * r + br - (tl + 2 * l + bl)) * strength;
        const dy = (bl + 2 * b + br - (tl + 2 * t + tr)) * strength;
        const dz = 1.0;
        const invLen = 1 / Math.hypot(dx, dy, dz);

        const idx = (y * w + x) * 4;
        dst.data[idx] = Math.round((-dx * invLen * 0.5 + 0.5) * 255);
        dst.data[idx + 1] = Math.round((-dy * invLen * 0.5 + 0.5) * 255);
        dst.data[idx + 2] = Math.round((dz * invLen * 0.5 + 0.5) * 255);
        dst.data[idx + 3] = 255;
      }
    }
  }
  nCtx.putImageData(dst, 0, 0);

  const tex = new THREE.CanvasTexture(normalCanvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = lowMem ? 1 : maxAnisotropy;
  return tex;
}

/**
 * Generates organic mottled reptile scale albedo, tangent-space normalMap, and roughnessMap.
 * Uses multi-octave tileable FBM noise so dorsal blotches/rosettes look genuinely biological
 * instead of repetitive uniform hoops.
 */
export function createSnakeScaleTextures(
  species: SnakeSpecies,
  maxAnisotropy: number,
  lowMem = false,
): PbrTextureSet {
  const size = 512;
  const cols = 26;
  const rows = 26;
  const cellW = size / cols;
  const cellH = size / rows;
  const pal = SPECIES_PALETTES[species];

  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = size;
  albedoCanvas.height = size;
  const actx = albedoCanvas.getContext('2d')!;

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = size;
  heightCanvas.height = size;
  const hctx = heightCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rctx = roughCanvas.getContext('2d')!;

  actx.fillStyle = pal.rim;
  actx.fillRect(0, 0, size, size);

  hctx.fillStyle = '#080808';
  hctx.fillRect(0, 0, size, size);

  rctx.fillStyle = '#d4d4d4';
  rctx.fillRect(0, 0, size, size);

  // Broad overlapping ventral belly scutes strictly along true underside (u < 0.085 or u > 0.915)
  const scuteRows = 22;
  const scuteH = size / scuteRows;
  for (let sr = 0; sr < scuteRows; sr++) {
    const sy = sr * scuteH;
    const drawScute = (sx: number, sw: number) => {
      const g = actx.createLinearGradient(sx, sy, sx, sy + scuteH);
      g.addColorStop(0, pal.belly);
      g.addColorStop(0.84, pal.belly);
      g.addColorStop(1, pal.rim);
      actx.fillStyle = g;
      actx.fillRect(sx, sy, sw, scuteH - 1.5);

      const hg = hctx.createLinearGradient(sx, sy, sx, sy + scuteH);
      hg.addColorStop(0, '#c8c8c8');
      hg.addColorStop(0.8, '#e8e8e8');
      hg.addColorStop(1, '#202020');
      hctx.fillStyle = hg;
      hctx.fillRect(sx, sy, sw, scuteH - 1.5);
    };
    drawScute(0, size * 0.085);
    drawScute(size * 0.915, size * 0.085);
  }

  for (let row = -1; row <= rows + 1; row++) {
    const offsetX = (row & 1) === 0 ? 0 : cellW * 0.5;
    for (let col = -1; col <= cols + 1; col++) {
      const cx = col * cellW + offsetX;
      const cy = row * cellH;

      const uNorm = (((cx / size) % 1) + 1) % 1;
      const vNorm = (((cy / size) % 1) + 1) % 1;
      const dorsalDist = Math.abs(uNorm - 0.5) * 2; // 0 = spine ridge, 1 = ventral belly

      // Skip ventral band already covered by broad belly scutes
      if (dorsalDist > 0.87) continue;

      // Organic biological python/viper saddles & mottled camouflage (non-repetitive FBM)
      const warpU = uNorm + (fbmTileable(uNorm + 0.13, vNorm + 0.71, 3) - 0.5) * 0.16;
      const warpV = vNorm + (fbmTileable(uNorm + 0.61, vNorm + 0.29, 3) - 0.5) * 0.16;
      const saddleNoise = fbmTileable(warpU, warpV, 3);
      const fineVal = fbmTileable(uNorm + 0.37, vNorm + 0.19, 6);
      const microVar = fbmTileable(uNorm * 1.5, vNorm * 1.5, 10);

      const dorsalMask = Math.max(0, 1 - dorsalDist * 1.12);
      const isVentral = dorsalDist > 0.8 + (fineVal - 0.5) * 0.05;

      let isBlotchCore = false;
      let isBlotchRim = false;
      let isHighlight = false;

      if (!isVentral) {
        if (pal.pattern === 'emerald') {
          // Classic Emerald Tree Boa: organic irregular ivory dorsal flecks & lightning chevrons
          const barPhase = ((vNorm * 2.0 + Math.abs(uNorm - 0.5) * 0.45 + (fineVal - 0.5) * 0.22) % 1 + 1) % 1;
          const isDorsalStripe = dorsalDist < 0.28 + (microVar - 0.5) * 0.14;
          isBlotchCore = isDorsalStripe && saddleNoise > 0.44 && barPhase > 0.45 && barPhase < 0.56;
          isBlotchRim = isDorsalStripe && !isBlotchCore && saddleNoise > 0.42 && barPhase > 0.40 && barPhase < 0.61;
          isHighlight = !isBlotchCore && !isBlotchRim && (fineVal > 0.50 || dorsalDist < 0.24);
        } else if (pal.pattern === 'chevron') {
          // King Cobra: natural widely spaced pale-gold chevron bands along olive-bronze scales
          const chevShift = Math.abs(uNorm - 0.5) * 0.48;
          const chevPhase = ((vNorm * 2.0 - chevShift + (fineVal - 0.5) * 0.08) % 1 + 1) % 1;
          isBlotchCore = chevPhase < 0.11 && dorsalDist < 0.72 && saddleNoise > 0.28;
          isBlotchRim = !isBlotchCore && (chevPhase < 0.17 || chevPhase > 0.96) && dorsalDist < 0.78;
          isHighlight = !isBlotchCore && !isBlotchRim && (fineVal > 0.52 || dorsalDist < 0.26);
        } else if (pal.pattern === 'diamond') {
          // Timber Rattler: crisp dark dorsal diamonds with warm cream borders
          const diamX = Math.abs(uNorm - 0.5) * 2.05;
          const diamV = Math.abs((((vNorm * 2.0 + (fineVal - 0.5) * 0.14) % 1) + 1) % 1 - 0.5) * 2.0;
          const dDist = diamX * 0.85 + diamV * 0.95;
          isBlotchCore = dDist < 0.52;
          isBlotchRim = !isBlotchCore && dDist < 0.68;
          isHighlight = !isBlotchCore && !isBlotchRim && fineVal > 0.52;
        } else if (pal.pattern === 'banded') {
          // Bold tricolor aposematic coral snake rings: crimson -> gold -> jet-black -> gold
          const phase = ((vNorm * 2.0 + (fineVal - 0.5) * 0.03) % 1 + 1) % 1;
          isBlotchCore = phase < 0.36;
          isBlotchRim = !isBlotchCore && (phase < 0.46 || phase > 0.90);
          isHighlight = !isBlotchCore && !isBlotchRim && fineVal > 0.52;
        } else if (pal.pattern === 'albino') {
          const blotchScore = saddleNoise * 0.78 + dorsalMask * 0.32 + (microVar - 0.5) * 0.14;
          isBlotchCore = blotchScore > 0.62;
          isBlotchRim = !isBlotchCore && blotchScore > 0.53;
          isHighlight = !isBlotchCore && !isBlotchRim && fineVal > 0.52;
        } else {
          // Obsidian Python: deep glossy slate with subtle smoky charcoal saddles
          const saddleScore = saddleNoise * 0.68 + dorsalMask * 0.32 + (microVar - 0.5) * 0.12;
          isBlotchCore = saddleScore > 0.66;
          isBlotchRim = !isBlotchCore && saddleScore > 0.56;
          isHighlight = !isBlotchCore && !isBlotchRim && fineVal > 0.55;
        }
      }

      const drawScalePath = (ctx: CanvasRenderingContext2D, shrink = 0.91) => {
        const hw = cellW * 0.56 * shrink;
        const hh = cellH * 0.66 * shrink;
        ctx.beginPath();
        ctx.moveTo(cx, cy - hh);
        ctx.quadraticCurveTo(cx + hw * 0.96, cy - hh * 0.16, cx + hw, cy + hh * 0.22);
        ctx.quadraticCurveTo(cx + hw * 0.42, cy + hh * 0.98, cx, cy + hh);
        ctx.quadraticCurveTo(cx - hw * 0.42, cy + hh * 0.98, cx - hw, cy + hh * 0.22);
        ctx.quadraticCurveTo(cx - hw * 0.96, cy - hh * 0.16, cx, cy - hh);
        ctx.closePath();
      };

      drawScalePath(actx, 0.95);
      const grad = actx.createRadialGradient(
        cx - cellW * 0.05,
        cy - cellH * 0.14,
        cellW * 0.04,
        cx,
        cy,
        cellW * 0.64,
      );
      if (isVentral) {
        grad.addColorStop(0, pal.belly);
        grad.addColorStop(0.8, pal.baseDark);
        grad.addColorStop(1, pal.rim);
      } else if (isBlotchCore) {
        grad.addColorStop(0, pal.blotch);
        grad.addColorStop(0.76, pal.blotch);
        grad.addColorStop(1, pal.rim);
      } else if (isBlotchRim) {
        grad.addColorStop(0, pal.blotchRim);
        grad.addColorStop(0.76, pal.blotchRim);
        grad.addColorStop(1, pal.rim);
      } else if (isHighlight) {
        grad.addColorStop(0, pal.highlight);
        grad.addColorStop(0.68, pal.baseMid);
        grad.addColorStop(1, pal.baseDark);
      } else {
        grad.addColorStop(0, pal.baseMid);
        grad.addColorStop(0.76, pal.baseDark);
        grad.addColorStop(1, pal.rim);
      }
      actx.fillStyle = grad;
      actx.fill();

      // Crisp overlapping scale edge shadow + dorsal keratin keel highlight
      actx.strokeStyle = 'rgba(0, 0, 0, 0.42)';
      actx.lineWidth = 1.25;
      actx.stroke();

      actx.strokeStyle = isBlotchCore ? 'rgba(255,244,210,0.16)' : 'rgba(255,255,255,0.09)';
      actx.lineWidth = 1.15;
      actx.beginPath();
      actx.moveTo(cx, cy - cellH * 0.36);
      actx.lineTo(cx, cy + cellH * 0.32);
      actx.stroke();

      // Height dome + central keel ridge for crisp normalMap
      drawScalePath(hctx, 0.93);
      const hGrad = hctx.createRadialGradient(cx, cy - cellH * 0.06, 2, cx, cy, cellW * 0.58);
      hGrad.addColorStop(0, '#ffffff');
      hGrad.addColorStop(0.62, '#a4a4a4');
      hGrad.addColorStop(1, '#141414');
      hctx.fillStyle = hGrad;
      hctx.fill();

      hctx.strokeStyle = '#ffffff';
      hctx.lineWidth = 2.0;
      hctx.beginPath();
      hctx.moveTo(cx, cy - cellH * 0.34);
      hctx.lineTo(cx, cy + cellH * 0.34);
      hctx.stroke();

      // Roughness map (keratin semi-matte scales, rougher inter-scale grooves)
      drawScalePath(rctx, 0.92);
      const rGrad = rctx.createRadialGradient(cx, cy, 2, cx, cy, cellW * 0.56);
      rGrad.addColorStop(0, '#5a5a5a');
      rGrad.addColorStop(0.72, '#828282');
      rGrad.addColorStop(1, '#c8c8c8');
      rctx.fillStyle = rGrad;
      rctx.fill();
    }
  }

  const map = finalizeCanvasTexture(
    albedoCanvas,
    lowMem,
    256,
    maxAnisotropy,
    THREE.SRGBColorSpace,
    THREE.RepeatWrapping,
    THREE.RepeatWrapping,
  );
  const normalMap = heightCanvasToNormalTexture(heightCanvas, 2.8, maxAnisotropy, 1, 1, lowMem, 256);

  if (lowMem) {
    return { map, normalMap };
  }

  const roughnessMap = finalizeCanvasTexture(
    roughCanvas,
    false,
    256,
    maxAnisotropy,
    null,
    THREE.RepeatWrapping,
    THREE.RepeatWrapping,
  );

  return { map, normalMap, roughnessMap };
}

/**
 * Generates realistic damp forest loam, moss cushions, pebbles, and leaf-litter PBR textures.
 */
export function createForestFloorTextures(maxAnisotropy: number, lowMem = false): PbrTextureSet {
  const size = 512;

  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = size;
  albedoCanvas.height = size;
  const actx = albedoCanvas.getContext('2d')!;

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = size;
  heightCanvas.height = size;
  const hctx = heightCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rctx = roughCanvas.getContext('2d')!;

  actx.fillStyle = '#4c592d';
  actx.fillRect(0, 0, size, size);

  hctx.fillStyle = '#6c6c6c';
  hctx.fillRect(0, 0, size, size);

  rctx.fillStyle = '#d4d4d4';
  rctx.fillRect(0, 0, size, size);

  let seed = 9001;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  const drawWrapped = (
    x: number,
    y: number,
    drawFn: (ox: number, oy: number) => void,
  ) => {
    for (let dx = -size; dx <= size; dx += size) {
      for (let dy = -size; dy <= size; dy += size) {
        if (x + dx > -90 && x + dx < size + 90 && y + dy > -90 && y + dy < size + 90) {
          drawFn(x + dx, y + dy);
        }
      }
    }
  };

  // Sunlit meadow grass & warm woodland loam patches
  for (let i = 0; i < 120; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 18 + rand() * 52;
    const kind = rand();
    const hue =
      kind < 0.54
        ? `rgba(${64 + Math.floor(rand() * 28)}, ${108 + Math.floor(rand() * 34)}, ${36 + Math.floor(rand() * 18)}, 0.48)`
        : kind < 0.84
          ? 'rgba(92, 72, 46, 0.45)'
          : 'rgba(54, 44, 30, 0.42)';

    drawWrapped(x, y, (ox, oy) => {
      const g = actx.createRadialGradient(ox, oy, 2, ox, oy, r);
      g.addColorStop(0, hue);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      actx.fillStyle = g;
      actx.beginPath();
      actx.arc(ox, oy, r, 0, Math.PI * 2);
      actx.fill();

      const val = kind < 0.54 ? 162 : 90;
      const hg = hctx.createRadialGradient(ox, oy, 2, ox, oy, r);
      hg.addColorStop(0, `rgba(${val},${val},${val},0.38)`);
      hg.addColorStop(1, 'rgba(128,128,128,0)');
      hctx.fillStyle = hg;
      hctx.beginPath();
      hctx.arc(ox, oy, r, 0, Math.PI * 2);
      hctx.fill();
    });
  }

  // Soil crumbs, small twigs, sunlit stones, and organic leaves
  for (let i = 0; i < 820; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const kind = rand();
    if (kind < 0.78) {
      const rad = 1.0 + rand() * 2.4;
      const shade = rand() < 0.4 ? '#4e6e2b' : rand() < 0.74 ? '#6b5235' : '#3d2f1e';
      const b = Math.floor(95 + rand() * 115);
      drawWrapped(x, y, (ox, oy) => {
        actx.fillStyle = shade;
        actx.beginPath();
        actx.arc(ox, oy, rad, 0, Math.PI * 2);
        actx.fill();

        hctx.fillStyle = `rgb(${b},${b},${b})`;
        hctx.beginPath();
        hctx.arc(ox, oy, rad, 0, Math.PI * 2);
        hctx.fill();
      });
    } else if (kind < 0.94) {
      // Muted decomposed fallen leaves (natural olive/umber/russet, not bright orange dots)
      const angle = rand() * Math.PI * 2;
      const len = 2.6 + rand() * 4.2;
      const w = 1.1 + rand() * 1.7;
      const leafColor = rand() < 0.45 ? '#47331c' : rand() < 0.8 ? '#544020' : '#35401b';
      drawWrapped(x, y, (ox, oy) => {
        actx.save();
        actx.translate(ox, oy);
        actx.rotate(angle);
        actx.fillStyle = leafColor;
        actx.beginPath();
        actx.ellipse(0, 0, len, w, 0, 0, Math.PI * 2);
        actx.fill();
        actx.restore();

        rctx.save();
        rctx.translate(ox, oy);
        rctx.rotate(angle);
        rctx.fillStyle = '#929292';
        rctx.beginPath();
        rctx.ellipse(0, 0, len, w, 0, 0, Math.PI * 2);
        rctx.fill();
        rctx.restore();
      });
    } else {
      // Small twig
      const angle = rand() * Math.PI * 2;
      const len = 8 + rand() * 14;
      drawWrapped(x, y, (ox, oy) => {
        actx.save();
        actx.translate(ox, oy);
        actx.rotate(angle);
        actx.strokeStyle = '#332417';
        actx.lineWidth = 1.6;
        actx.beginPath();
        actx.moveTo(-len * 0.5, 0);
        actx.lineTo(len * 0.5, 0);
        actx.stroke();
        actx.restore();
      });
    }
  }

  const map = finalizeCanvasTexture(
    albedoCanvas,
    lowMem,
    256,
    maxAnisotropy,
    THREE.SRGBColorSpace,
    THREE.RepeatWrapping,
    THREE.RepeatWrapping,
    22,
    22,
  );
  const normalMap = heightCanvasToNormalTexture(heightCanvas, 2.2, maxAnisotropy, 22, 22, lowMem, 256);

  if (lowMem) {
    return { map, normalMap };
  }

  const roughnessMap = finalizeCanvasTexture(
    roughCanvas,
    false,
    256,
    maxAnisotropy,
    null,
    THREE.RepeatWrapping,
    THREE.RepeatWrapping,
    22,
    22,
  );

  return { map, normalMap, roughnessMap };
}

export function createRockTexture(maxAnisotropy: number, lowMem = false): {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
} {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;

  const hc = document.createElement('canvas');
  hc.width = size;
  hc.height = size;
  const hctx = hc.getContext('2d')!;

  ctx.fillStyle = '#383a34';
  ctx.fillRect(0, 0, size, size);
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, size, size);

  let seed = 4242;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  for (let i = 0; i < 540; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 2 + rand() * 14;
    const isMoss = rand() < 0.24;
    ctx.fillStyle = isMoss
      ? `rgba(34, 58, 24, ${0.32 + rand() * 0.28})`
      : `rgba(${34 + Math.floor(rand() * 44)}, ${36 + Math.floor(rand() * 40)}, ${33 + Math.floor(rand() * 36)}, 0.45)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    const bv = Math.floor(60 + rand() * 140);
    hctx.fillStyle = `rgba(${bv},${bv},${bv},0.35)`;
    hctx.beginPath();
    hctx.arc(x, y, r, 0, Math.PI * 2);
    hctx.fill();
  }

  const map = finalizeCanvasTexture(
    c,
    lowMem,
    128,
    maxAnisotropy,
    THREE.SRGBColorSpace,
    THREE.RepeatWrapping,
    THREE.RepeatWrapping,
  );
  const normalMap = heightCanvasToNormalTexture(hc, 2.4, maxAnisotropy, 1, 1, lowMem, 128);
  return { map, normalMap };
}

export function createFoliageTexture(maxAnisotropy: number, lowMem = false): {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
} {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;

  const hc = document.createElement('canvas');
  hc.width = size;
  hc.height = size;
  const hctx = hc.getContext('2d')!;

  ctx.fillStyle = '#4c7536';
  ctx.fillRect(0, 0, size, size);
  hctx.fillStyle = '#606060';
  hctx.fillRect(0, 0, size, size);

  let seed = 8181;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  for (let i = 0; i < 480; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const ang = rand() * Math.PI * 2;
    const shade = Math.floor(92 + rand() * 135);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = `rgba(${Math.floor(shade * 0.58)}, ${Math.floor(shade * 0.94)}, ${Math.floor(shade * 0.42)}, 0.64)`;
    ctx.beginPath();
    ctx.ellipse(0, 0, 10 + rand() * 9, 4 + rand() * 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    hctx.save();
    hctx.translate(x, y);
    hctx.rotate(ang);
    hctx.fillStyle = `rgba(${shade}, ${shade}, ${shade}, 0.55)`;
    hctx.beginPath();
    hctx.ellipse(0, 0, 10 + rand() * 9, 4 + rand() * 4, 0, 0, Math.PI * 2);
    hctx.fill();
    hctx.restore();
  }

  const map = finalizeCanvasTexture(
    c,
    lowMem,
    128,
    maxAnisotropy,
    THREE.SRGBColorSpace,
    THREE.RepeatWrapping,
    THREE.RepeatWrapping,
    2,
    2,
  );
  const normalMap = heightCanvasToNormalTexture(hc, 2.0, maxAnisotropy, 2, 2, lowMem, 128);
  return { map, normalMap };
}

export function createBarkTexture(maxAnisotropy: number, lowMem = false): {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
} {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;

  const hc = document.createElement('canvas');
  hc.width = size;
  hc.height = size;
  const hctx = hc.getContext('2d')!;

  ctx.fillStyle = '#302216';
  ctx.fillRect(0, 0, size, size);
  hctx.fillStyle = '#707070';
  hctx.fillRect(0, 0, size, size);

  let seed = 777;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  for (let i = 0; i < 210; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const w = 2 + rand() * 5;
    const h = 24 + rand() * 80;
    ctx.fillStyle = rand() < 0.5 ? '#1b120b' : rand() < 0.8 ? '#453220' : '#2e3c1c';
    ctx.fillRect(x, y, w, h);

    const hv = rand() < 0.5 ? 40 : 200;
    hctx.fillStyle = `rgba(${hv},${hv},${hv},0.45)`;
    hctx.fillRect(x, y, w, h);
  }

  const map = finalizeCanvasTexture(
    c,
    lowMem,
    128,
    maxAnisotropy,
    THREE.SRGBColorSpace,
    THREE.RepeatWrapping,
    THREE.RepeatWrapping,
  );
  const normalMap = heightCanvasToNormalTexture(hc, 2.2, maxAnisotropy, 1, 1, lowMem, 128);
  return { map, normalMap };
}

export function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;

  const grad = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(5, 8, 6, 0.78)');
  grad.addColorStop(0.55, 'rgba(5, 8, 6, 0.36)');
  grad.addColorStop(1, 'rgba(5, 8, 6, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  return new THREE.CanvasTexture(c);
}

export function createWoodPlankTexture(maxAnisotropy: number, lowMem = false): {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
} {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;

  const hc = document.createElement('canvas');
  hc.width = size;
  hc.height = size;
  const hctx = hc.getContext('2d')!;

  ctx.fillStyle = '#4e3521';
  ctx.fillRect(0, 0, size, size);
  hctx.fillStyle = '#909090';
  hctx.fillRect(0, 0, size, size);

  const plankH = size / 6;
  let seed = 3141;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  for (let p = 0; p < 6; p++) {
    const y = p * plankH;
    const tone = 56 + Math.floor(rand() * 24);
    ctx.fillStyle = `rgb(${tone + 18}, ${tone - 4}, ${tone - 22})`;
    ctx.fillRect(0, y + 2, size, plankH - 3);

    for (let g = 0; g < 28; g++) {
      const gy = y + 3 + rand() * (plankH - 6);
      ctx.fillStyle = rand() < 0.5 ? 'rgba(28, 16, 8, 0.25)' : 'rgba(130, 96, 62, 0.18)';
      ctx.fillRect(0, gy, size, 1.5);
    }

    ctx.fillStyle = '#1b1109';
    ctx.fillRect(0, y, size, 2.5);
    hctx.fillStyle = '#141414';
    hctx.fillRect(0, y, size, 3);
  }

  const map = finalizeCanvasTexture(
    c,
    lowMem,
    128,
    maxAnisotropy,
    THREE.SRGBColorSpace,
    THREE.RepeatWrapping,
    THREE.RepeatWrapping,
  );
  const normalMap = heightCanvasToNormalTexture(hc, 2.2, maxAnisotropy, 1, 1, lowMem, 128);
  return { map, normalMap };
}

export function createStoneWallTexture(maxAnisotropy: number, lowMem = false): {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
} {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;

  const hc = document.createElement('canvas');
  hc.width = size;
  hc.height = size;
  const hctx = hc.getContext('2d')!;

  ctx.fillStyle = '#33312b';
  ctx.fillRect(0, 0, size, size);
  hctx.fillStyle = '#252525';
  hctx.fillRect(0, 0, size, size);

  let seed = 2718;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  const rows = 6;
  const cols = 4;
  const rh = size / rows;
  const cw = size / cols;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * (cw * 0.5);
    for (let col = -1; col <= cols; col++) {
      const bx = col * cw + off + 3;
      const by = r * rh + 3;
      const bw = cw - 6;
      const bh = rh - 6;
      const shade = 78 + Math.floor(rand() * 38);
      ctx.fillStyle = `rgb(${shade}, ${shade - 4}, ${shade - 10})`;
      ctx.fillRect(bx, by, bw, bh);

      const hv = 155 + Math.floor(rand() * 75);
      hctx.fillStyle = `rgb(${hv}, ${hv}, ${hv})`;
      hctx.fillRect(bx + 1, by + 1, bw - 2, bh - 2);
    }
  }

  const map = finalizeCanvasTexture(
    c,
    lowMem,
    128,
    maxAnisotropy,
    THREE.SRGBColorSpace,
    THREE.RepeatWrapping,
    THREE.RepeatWrapping,
  );
  const normalMap = heightCanvasToNormalTexture(hc, 2.5, maxAnisotropy, 1, 1, lowMem, 128);
  return { map, normalMap };
}

/**
 * Generates anatomical cephalic head-shield plates (supraocular brow plates, parietal & frontal scales,
 * and neat labial lip scales) so the snake head reads like a living reptile skull rather than wallpaper.
 */
export function createSnakeHeadTextures(
  species: SnakeSpecies,
  maxAnisotropy: number,
  lowMem = false,
): PbrTextureSet {
  const size = 512;
  const pal = SPECIES_PALETTES[species];

  const ac = document.createElement('canvas');
  ac.width = size;
  ac.height = size;
  const actx = ac.getContext('2d')!;

  const hc = document.createElement('canvas');
  hc.width = size;
  hc.height = size;
  const hctx = hc.getContext('2d')!;

  const rc = document.createElement('canvas');
  rc.width = size;
  rc.height = size;
  const rctx = rc.getContext('2d')!;

  actx.fillStyle = pal.rim;
  actx.fillRect(0, 0, size, size);
  hctx.fillStyle = '#141414';
  hctx.fillRect(0, 0, size, size);
  rctx.fillStyle = '#707070';
  rctx.fillRect(0, 0, size, size);

  // NOTE: CanvasTexture uses flipY=true!
  // So v=0 (rear skull / neck collar) maps to canvasY = 1.0 (bottom),
  // and v=1 (snout tip) maps to canvasY = 0.0 (top).
  const cols = 22;
  const rows = 22;
  const cw = size / cols;
  const ch = size / rows;
  for (let r = -1; r <= rows + 1; r++) {
    const off = (r & 1) * cw * 0.5;
    for (let c = -1; c <= cols + 1; c++) {
      const cx = c * cw + off;
      const cy = r * ch;
      const uNorm = Math.max(0, Math.min(1, cx / size));
      const yNorm = Math.max(0, Math.min(1, cy / size)); // 0=snout tip, 1=neck base
      const dorsalDist = Math.abs(uNorm - 0.5) * 2;
      const mottle = fbmTileable(uNorm + 0.19, yNorm + 0.37, 5);

      let cCenter = pal.baseMid;
      let cEdge = pal.baseDark;

      if (dorsalDist > 0.93) {
        cCenter = pal.belly;
        cEdge = pal.baseDark;
      } else if (yNorm > 0.72) {
        // Rear skull collar matches body base scales seamlessly so there is zero neck seam
        cCenter = mottle > 0.56 ? pal.highlight : pal.baseMid;
        cEdge = pal.baseDark;
      } else if (species === 'coral') {
        // Authentic coral snake head: jet-black snout mask, golden-yellow occipital collar, crimson neck blend
        if (yNorm < 0.44) {
          cCenter = '#17191e';
          cEdge = '#090a0c';
        } else if (yNorm < 0.66) {
          cCenter = pal.blotchRim; // golden yellow collar
          cEdge = '#96771e';
        } else {
          cCenter = pal.baseMid; // blends seamlessly into crimson neck
          cEdge = pal.baseDark;
        }
      } else if (species === 'rattler') {
        // Dark temporal viper eye-band + mottled sandstone head scales matching neck
        const inEyeStripe = yNorm > 0.36 && yNorm < 0.68 && Math.abs(dorsalDist - 0.52) < 0.15;
        if (inEyeStripe) {
          cCenter = pal.blotch;
          cEdge = pal.rim;
        } else if (mottle > 0.58) {
          cCenter = pal.highlight;
          cEdge = pal.baseMid;
        }
      } else if (species === 'albino') {
        const isArrow = yNorm > 0.28 && yNorm < 0.58 && dorsalDist < 0.24 - Math.abs(yNorm - 0.43) * 0.35;
        if (isArrow) {
          cCenter = pal.blotch;
          cEdge = pal.blotchRim;
        } else {
          cCenter = mottle > 0.52 ? pal.highlight : pal.baseMid;
          cEdge = pal.baseDark;
        }
      } else {
        if (mottle > 0.6) {
          cCenter = pal.highlight;
          cEdge = pal.baseMid;
        } else if (mottle < 0.32) {
          cCenter = pal.baseDark;
          cEdge = pal.rim;
        }
      }

      const hw = cw * 0.55;
      const hh = ch * 0.64;
      const drawS = (ctx: CanvasRenderingContext2D) => {
        ctx.beginPath();
        ctx.moveTo(cx, cy - hh);
        ctx.quadraticCurveTo(cx + hw * 0.95, cy - hh * 0.15, cx + hw, cy + hh * 0.22);
        ctx.quadraticCurveTo(cx + hw * 0.4, cy + hh * 0.95, cx, cy + hh);
        ctx.quadraticCurveTo(cx - hw * 0.4, cy + hh * 0.95, cx - hw, cy + hh * 0.22);
        ctx.quadraticCurveTo(cx - hw * 0.95, cy - hh * 0.15, cx, cy - hh);
        ctx.closePath();
      };

      drawS(actx);
      const g = actx.createRadialGradient(cx, cy - hh * 0.1, 1, cx, cy, cw * 0.62);
      g.addColorStop(0, cCenter);
      g.addColorStop(0.76, cEdge);
      g.addColorStop(1, pal.rim);
      actx.fillStyle = g;
      actx.fill();
      actx.strokeStyle = 'rgba(0,0,0,0.34)';
      actx.lineWidth = 1.1;
      actx.stroke();

      drawS(hctx);
      const hg = hctx.createRadialGradient(cx, cy - hh * 0.08, 1, cx, cy, cw * 0.58);
      hg.addColorStop(0, '#ededed');
      hg.addColorStop(0.65, '#9d9d9d');
      hg.addColorStop(1, '#141414');
      hctx.fillStyle = hg;
      hctx.fill();
    }
  }

  // Softly shaded biological cephalic shields strictly over the crown & brow (yNorm 0.18..0.64, NEVER at rear neck seam yNorm > 0.72)
  const drawOrganicPlate = (
    pts: Array<[number, number]>,
    centerCol: string,
    edgeCol: string,
    alpha: number,
  ) => {
    actx.save();
    actx.globalAlpha = alpha;
    for (const ctx of [actx, hctx]) {
      ctx.beginPath();
      const len = pts.length;
      const firstMidX = ((pts[len - 1][0] + pts[0][0]) * 0.5) * size;
      const firstMidY = ((pts[len - 1][1] + pts[0][1]) * 0.5) * size;
      ctx.moveTo(firstMidX, firstMidY);
      for (let i = 0; i < len; i++) {
        const p = pts[i];
        const next = pts[(i + 1) % len];
        const midX = ((p[0] + next[0]) * 0.5) * size;
        const midY = ((p[1] + next[1]) * 0.5) * size;
        ctx.quadraticCurveTo(p[0] * size, p[1] * size, midX, midY);
      }
      ctx.closePath();
      if (ctx === actx) {
        ctx.fillStyle = centerCol;
        ctx.fill();
        ctx.strokeStyle = edgeCol;
        ctx.lineWidth = 1.8;
        ctx.stroke();
      } else {
        ctx.fillStyle = '#e8e8e8';
        ctx.fill();
        ctx.strokeStyle = '#1e1e1e';
        ctx.lineWidth = 2.2;
        ctx.stroke();
      }
    }
    actx.restore();
  };

  // Smooth crown plate colors matching the body (avoid jarring bright yellow-green patch)
  const shieldCol = species === 'coral' ? '#17191e' : pal.baseMid;
  const shieldRim = 'rgba(0, 0, 0, 0.36)';
  const shieldAlpha = species === 'golden' || species === 'coral' || species === 'obsidian' ? 0.88 : 0.45;

  // Frontal Shield (center crown between eyes: yNorm 0.34..0.56)
  drawOrganicPlate(
    [
      [0.5, 0.34],
      [0.555, 0.41],
      [0.535, 0.54],
      [0.5, 0.58],
      [0.465, 0.54],
      [0.445, 0.41],
    ],
    shieldCol,
    shieldRim,
    shieldAlpha,
  );
  // Parietal & Supraocular Brow Plates
  for (const s of [-1, 1]) {
    drawOrganicPlate(
      [
        [0.5, 0.54],
        [0.5 + s * 0.12, 0.55],
        [0.5 + s * 0.09, 0.62],
        [0.5, 0.61],
      ],
      species === 'coral' ? pal.blotchRim : pal.baseMid,
      shieldRim,
      shieldAlpha * 0.6,
    );
    drawOrganicPlate(
      [
        [0.5 + s * 0.06, 0.35],
        [0.5 + s * 0.135, 0.39],
        [0.5 + s * 0.125, 0.52],
        [0.5 + s * 0.055, 0.49],
      ],
      species === 'coral' ? '#17191e' : pal.baseMid,
      shieldRim,
      shieldAlpha,
    );
  }
  // Prefrontal Snout Plates (yNorm 0.16..0.34)
  drawOrganicPlate(
    [
      [0.5, 0.18],
      [0.55, 0.21],
      [0.545, 0.33],
      [0.455, 0.33],
      [0.45, 0.21],
    ],
    shieldCol,
    shieldRim,
    shieldAlpha * 0.85,
  );

  const map = finalizeCanvasTexture(
    ac,
    lowMem,
    256,
    maxAnisotropy,
    THREE.SRGBColorSpace,
    THREE.ClampToEdgeWrapping,
    THREE.ClampToEdgeWrapping,
  );
  const normalMap = heightCanvasToNormalTexture(hc, 2.7, maxAnisotropy, 1, 1, lowMem, 256);

  if (lowMem) {
    return { map, normalMap };
  }

  const roughnessMap = finalizeCanvasTexture(
    rc,
    false,
    256,
    maxAnisotropy,
    null,
    THREE.ClampToEdgeWrapping,
    THREE.ClampToEdgeWrapping,
  );

  return { map, normalMap, roughnessMap };
}

/**
 * Generates a realistic predator reptile eye iris texture with radial fibers and vertical slit pupil.
 */
export function createReptileEyeTexture(
  irisHex: number,
  slitPupil = true,
  lowMem = false,
): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;
  const col = new THREE.Color(irisHex);
  const r = Math.round(col.r * 255);
  const g = Math.round(col.g * 255);
  const b = Math.round(col.b * 255);

  ctx.fillStyle = '#080908';
  ctx.fillRect(0, 0, size, size);

  const irisGrad = ctx.createRadialGradient(cx, cy, size * 0.08, cx, cy, size * 0.48);
  irisGrad.addColorStop(0, `rgb(${Math.min(255, r + 45)}, ${Math.min(255, g + 35)}, ${Math.min(255, b + 20)})`);
  irisGrad.addColorStop(0.65, `rgb(${r}, ${g}, ${b})`);
  irisGrad.addColorStop(0.92, `rgb(${Math.floor(r * 0.35)}, ${Math.floor(g * 0.35)}, ${Math.floor(b * 0.35)})`);
  irisGrad.addColorStop(1, '#070807');
  ctx.fillStyle = irisGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.48, 0, Math.PI * 2);
  ctx.fill();

  // Radial iris striations
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(255,245,210,0.18)' : 'rgba(15,10,5,0.28)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * size * 0.14, cy + Math.sin(a) * size * 0.14);
    ctx.lineTo(cx + Math.cos(a) * size * 0.44, cy + Math.sin(a) * size * 0.44);
    ctx.stroke();
  }

  // Sharp vertical slit pupil (or round cobra pupil)
  ctx.fillStyle = '#030404';
  ctx.beginPath();
  if (slitPupil) {
    ctx.ellipse(cx, cy, size * 0.075, size * 0.34, 0, 0, Math.PI * 2);
  } else {
    ctx.arc(cx, cy, size * 0.21, 0, Math.PI * 2);
  }
  ctx.fill();

  // Subtle wet specular catchlight
  ctx.fillStyle = 'rgba(255, 255, 245, 0.72)';
  ctx.beginPath();
  ctx.arc(cx - size * 0.14, cy - size * 0.14, size * 0.055, 0, Math.PI * 2);
  ctx.fill();

  return finalizeCanvasTexture(
    c,
    lowMem,
    128,
    1,
    THREE.SRGBColorSpace,
    THREE.ClampToEdgeWrapping,
    THREE.ClampToEdgeWrapping,
  );
}

/**
 * Generates realistic multi-strand ticked animal fur albedo + normalMap for Rabbits and Mice.
 */
export function createFurTexture(
  baseHex: string,
  tickHex: string,
  highlightHex: string,
  maxAnisotropy: number,
  seedVal = 5501,
  lowMem = false,
): { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture } {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;

  const hc = document.createElement('canvas');
  hc.width = size;
  hc.height = size;
  const hctx = hc.getContext('2d')!;

  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, size, size);
  hctx.fillStyle = '#7c7c7c';
  hctx.fillRect(0, 0, size, size);

  let seed = seedVal;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  for (let i = 0; i < 1600; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 8 + rand() * 14;
    const tilt = (rand() - 0.5) * 0.28;
    const roll = rand();
    ctx.strokeStyle = roll < 0.42 ? tickHex : roll < 0.78 ? baseHex : highlightHex;
    ctx.lineWidth = 1.2 + rand() * 1.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.sin(tilt) * len, y + Math.cos(tilt) * len);
    ctx.stroke();

    const hv = Math.floor(60 + rand() * 170);
    hctx.strokeStyle = `rgba(${hv},${hv},${hv},0.55)`;
    hctx.lineWidth = 1.4;
    hctx.beginPath();
    hctx.moveTo(x, y);
    hctx.lineTo(x + Math.sin(tilt) * len, y + Math.cos(tilt) * len);
    hctx.stroke();
  }

  const map = finalizeCanvasTexture(
    c,
    lowMem,
    128,
    maxAnisotropy,
    THREE.SRGBColorSpace,
    THREE.RepeatWrapping,
    THREE.RepeatWrapping,
  );
  const normalMap = heightCanvasToNormalTexture(hc, 1.9, maxAnisotropy, 1, 1, lowMem, 128);
  return { map, normalMap };
}

export function createFrogSkinTexture(maxAnisotropy: number, lowMem = false): {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
} {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;

  const hc = document.createElement('canvas');
  hc.width = size;
  hc.height = size;
  const hctx = hc.getContext('2d')!;

  ctx.fillStyle = '#337d3b';
  ctx.fillRect(0, 0, size, size);
  hctx.fillStyle = '#707070';
  hctx.fillRect(0, 0, size, size);

  let seed = 8821;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  for (let i = 0; i < 190; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 4 + rand() * 14;
    ctx.fillStyle = rand() < 0.55 ? 'rgba(20, 48, 22, 0.52)' : 'rgba(130, 178, 66, 0.35)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    const bv = Math.floor(110 + rand() * 120);
    hctx.fillStyle = `rgba(${bv},${bv},${bv},0.4)`;
    hctx.beginPath();
    hctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
    hctx.fill();
  }

  const map = finalizeCanvasTexture(
    c,
    lowMem,
    128,
    maxAnisotropy,
    THREE.SRGBColorSpace,
    THREE.RepeatWrapping,
    THREE.RepeatWrapping,
  );
  const normalMap = heightCanvasToNormalTexture(hc, 1.8, maxAnisotropy, 1, 1, lowMem, 128);
  return { map, normalMap };
}

export function createRoofShingleTexture(maxAnisotropy: number, lowMem = false): {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
} {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;

  const hc = document.createElement('canvas');
  hc.width = size;
  hc.height = size;
  const hctx = hc.getContext('2d')!;

  ctx.fillStyle = '#2d2018';
  ctx.fillRect(0, 0, size, size);
  hctx.fillStyle = '#303030';
  hctx.fillRect(0, 0, size, size);

  let seed = 6611;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  const rows = 8;
  const cols = 6;
  const rh = size / rows;
  const cw = size / cols;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * (cw * 0.5);
    for (let col = -1; col <= cols; col++) {
      const sx = col * cw + off + 2;
      const sy = r * rh + 2;
      const sw = cw - 4;
      const sh = rh - 4;
      const base = 46 + Math.floor(rand() * 26);
      ctx.fillStyle = `rgb(${base + 14}, ${base}, ${base - 10})`;
      ctx.fillRect(sx, sy, sw, sh);
      const hv = 130 + Math.floor(rand() * 90);
      hctx.fillStyle = `rgb(${hv},${hv},${hv})`;
      hctx.fillRect(sx, sy, sw, sh);
    }
  }

  const map = finalizeCanvasTexture(
    c,
    lowMem,
    128,
    maxAnisotropy,
    THREE.SRGBColorSpace,
    THREE.RepeatWrapping,
    THREE.RepeatWrapping,
    3,
    3,
  );
  const normalMap = heightCanvasToNormalTexture(hc, 2.3, maxAnisotropy, 3, 3, lowMem, 128);
  return { map, normalMap };
}

/**
 * Generates an alpha-cutout botanical oak/broadleaf twig cluster texture with serrated leaves,
 * sunlit midribs, and dappled canopy depth so tree crowns show organic individual foliage.
 */
export function createOakLeafAlphaTexture(maxAnisotropy: number, lowMem = false): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);

  let seed = 4192;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  // Delicate dark woody twigs radiating from cluster core
  ctx.strokeStyle = '#2d2015';
  ctx.lineCap = 'round';
  for (let b = 0; b < 7; b++) {
    const a = (b / 7) * Math.PI * 2 + (rand() - 0.5) * 0.4;
    const r = size * (0.28 + rand() * 0.14);
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(size * 0.5, size * 0.52);
    ctx.quadraticCurveTo(
      size * 0.5 + Math.cos(a + 0.3) * r * 0.55,
      size * 0.5 + Math.sin(a + 0.3) * r * 0.55,
      size * 0.5 + Math.cos(a) * r,
      size * 0.5 + Math.sin(a) * r,
    );
    ctx.stroke();
  }

  // Individual overlapping oak-lobed leaves
  for (let i = 0; i < 64; i++) {
    const rad = Math.pow(rand(), 0.65) * size * 0.38;
    const ang = rand() * Math.PI * 2;
    const lx = size * 0.5 + Math.cos(ang) * rad;
    const ly = size * 0.5 + Math.sin(ang) * rad;
    const rot = ang + (rand() - 0.5) * 1.1;
    const len = 18 + rand() * 18;
    const wid = 8 + rand() * 7;

    const shade = rand();
    const fill =
      shade < 0.28
        ? '#26451b'
        : shade < 0.65
          ? '#355c24'
          : shade < 0.88
            ? '#47742e'
            : '#5e8c37';

    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(rot);

    // Wavy oak-lobed leaf silhouette
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(-len * 0.55, 0);
    ctx.bezierCurveTo(-len * 0.25, -wid, len * 0.15, -wid * 1.1, len * 0.55, 0);
    ctx.bezierCurveTo(len * 0.15, wid * 1.1, -len * 0.25, wid, -len * 0.55, 0);
    ctx.closePath();
    ctx.fill();

    // Subtle dark edge & sunlit central vein
    ctx.strokeStyle = 'rgba(12, 22, 9, 0.38)';
    ctx.lineWidth = 1.1;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(176, 212, 118, 0.26)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(-len * 0.45, 0);
    ctx.lineTo(len * 0.42, 0);
    ctx.stroke();

    ctx.restore();
  }

  return finalizeCanvasTexture(
    c,
    lowMem,
    128,
    maxAnisotropy,
    THREE.SRGBColorSpace,
    THREE.ClampToEdgeWrapping,
    THREE.ClampToEdgeWrapping,
  );
}

/**
 * Generates an alpha-cutout evergreen pine needle bough spray texture.
 */
export function createPineNeedleAlphaTexture(maxAnisotropy: number, lowMem = false): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);

  let seed = 7331;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  // Central woody branch spine (bottom to top)
  ctx.strokeStyle = '#3a2617';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.96);
  ctx.lineTo(size * 0.5, size * 0.1);
  ctx.stroke();

  // Radiating needle twigs & dense pine needles
  for (let row = 0; row < 28; row++) {
    const t = row / 27; // 0 = base, 1 = tip
    const py = size * (0.92 - t * 0.8);
    const span = size * (0.44 * (1 - t * 0.72) + 0.05);

    for (const side of [-1, 1]) {
      const tipX = size * 0.5 + side * span;
      const tipY = py - span * 0.35;

      ctx.strokeStyle = '#332215';
      ctx.lineWidth = 2.1;
      ctx.beginPath();
      ctx.moveTo(size * 0.5, py);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();

      // Fan of needles along sub-twig
      for (let n = 0; n < 18; n++) {
        const nt = n / 17;
        const bx = size * 0.5 + (tipX - size * 0.5) * nt;
        const by = py + (tipY - py) * nt;
        const na = side * (0.35 + (rand() - 0.5) * 0.7) - Math.PI * 0.5;
        const nLen = 12 + rand() * 14;
        const tone = rand();
        ctx.strokeStyle =
          tone < 0.35 ? '#18361c' : tone < 0.75 ? '#234a25' : '#326030';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(na) * nLen, by + Math.sin(na) * nLen);
        ctx.stroke();
      }
    }
  }

  return finalizeCanvasTexture(
    c,
    lowMem,
    128,
    maxAnisotropy,
    THREE.SRGBColorSpace,
    THREE.ClampToEdgeWrapping,
    THREE.ClampToEdgeWrapping,
  );
}

/**
 * Generates packed earthen village lane & fine gravel path PBR textures with soft feathered edges.
 */
export function createVillageRoadTexture(maxAnisotropy: number, lowMem = false): {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
} {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;

  const hc = document.createElement('canvas');
  hc.width = size;
  hc.height = size;
  const hctx = hc.getContext('2d')!;

  // Warm sunlit packed country dirt road base
  ctx.fillStyle = '#7c6244';
  ctx.fillRect(0, 0, size, size);
  hctx.fillStyle = '#7a7a7a';
  hctx.fillRect(0, 0, size, size);

  let seed = 1994;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  // Subtle wagon-track shading down left & right center lanes
  for (const trackX of [size * 0.34, size * 0.66]) {
    const g = ctx.createLinearGradient(trackX - 24, 0, trackX + 24, 0);
    g.addColorStop(0, 'rgba(84, 64, 42, 0)');
    g.addColorStop(0.5, 'rgba(72, 54, 34, 0.28)');
    g.addColorStop(1, 'rgba(84, 64, 42, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(trackX - 24, 0, 48, size);
  }

  // Sunlit packed clay & grassy verge mottling
  for (let i = 0; i < 480; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 3 + rand() * 14;
    const isVerge = x < size * 0.2 || x > size * 0.8;
    const col = isVerge && rand() < 0.45
      ? `rgba(${62 + Math.floor(rand() * 26)}, ${96 + Math.floor(rand() * 28)}, ${40 + Math.floor(rand() * 16)}, 0.38)`
      : `rgba(${104 + Math.floor(rand() * 44)}, ${82 + Math.floor(rand() * 32)}, ${54 + Math.floor(rand() * 24)}, 0.32)`;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    const bv = Math.floor(90 + rand() * 80);
    hctx.fillStyle = `rgba(${bv},${bv},${bv},0.3)`;
    hctx.beginPath();
    hctx.arc(x, y, r * 0.6, 0, Math.PI * 2);
    hctx.fill();
  }

  // Fine compacted grit, small sunlit pebbles, and soil crumbs
  for (let i = 0; i < 620; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const rx = 0.8 + rand() * 2.2;
    const ry = 0.7 + rand() * 1.9;
    const g = 112 + Math.floor(rand() * 52);
    ctx.fillStyle = `rgba(${g + 16}, ${g + 4}, ${g - 14}, 0.5)`;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();

    hctx.fillStyle = '#bcbcbc';
    hctx.beginPath();
    hctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    hctx.fill();
  }

  // Softly feather left & right edges (destination-in alpha fade) so roads blend naturally into loam
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  const edgeMask = ctx.createLinearGradient(0, 0, size, 0);
  edgeMask.addColorStop(0.0, 'rgba(255,255,255,0)');
  edgeMask.addColorStop(0.14, 'rgba(255,255,255,0.88)');
  edgeMask.addColorStop(0.24, 'rgba(255,255,255,1)');
  edgeMask.addColorStop(0.76, 'rgba(255,255,255,1)');
  edgeMask.addColorStop(0.86, 'rgba(255,255,255,0.88)');
  edgeMask.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = edgeMask;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  const map = finalizeCanvasTexture(
    c,
    lowMem,
    128,
    maxAnisotropy,
    THREE.SRGBColorSpace,
    THREE.ClampToEdgeWrapping,
    THREE.RepeatWrapping,
  );
  const normalMap = heightCanvasToNormalTexture(hc, 1.8, maxAnisotropy, 1, 1, lowMem, 128);
  normalMap.wrapS = THREE.ClampToEdgeWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  return { map, normalMap };
}

/**
 * Generates speckled leathery reptile eggshell PBR textures for snake nests & brood eggs.
 */
export function createEggShellTexture(maxAnisotropy: number, lowMem = false): {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
} {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;

  const hc = document.createElement('canvas');
  hc.width = size;
  hc.height = size;
  const hctx = hc.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, '#ebe0c6');
  grad.addColorStop(0.5, '#dfd0ab');
  grad.addColorStop(1, '#c8b489');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, size, size);

  let seed = 4321;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  for (let i = 0; i < 240; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 1.5 + rand() * 5.2;
    const isJade = rand() < 0.3;
    ctx.fillStyle = isJade
      ? `rgba(74, 118, 72, ${0.22 + rand() * 0.28})`
      : `rgba(122, 92, 56, ${0.24 + rand() * 0.34})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.7 + rand() * 0.5), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();

    const hv = 100 + Math.floor(rand() * 55);
    hctx.fillStyle = `rgba(${hv},${hv},${hv},0.35)`;
    hctx.beginPath();
    hctx.arc(x, y, r * 0.7, 0, Math.PI * 2);
    hctx.fill();
  }

  const map = finalizeCanvasTexture(
    c,
    lowMem,
    128,
    maxAnisotropy,
    THREE.SRGBColorSpace,
    THREE.ClampToEdgeWrapping,
    THREE.ClampToEdgeWrapping,
  );
  const normalMap = heightCanvasToNormalTexture(hc, 1.4, maxAnisotropy, 1, 1, lowMem, 128);
  return { map, normalMap };
}

export interface HumanTextureSet {
  linenMap: THREE.CanvasTexture;
  linenNormal: THREE.CanvasTexture;
  leatherMap: THREE.CanvasTexture;
  leatherNormal: THREE.CanvasTexture;
  steelMap: THREE.CanvasTexture;
  steelNormal: THREE.CanvasTexture;
  humanEyeMap: THREE.CanvasTexture;
}

/**
 * Generates shared procedural PBR surface maps for village clothing, leather gear,
 * hammered steel armor/weapons, and expressive human eyes.
 */
export function createHumanMaterialTextures(maxAnisotropy: number, lowMem = false): HumanTextureSet {
  const size = 256;

  // 1. Woven Linen / Wool Cloth (neutral grayscale so vertex/material color tints cleanly)
  const lc = document.createElement('canvas');
  lc.width = size;
  lc.height = size;
  const lctx = lc.getContext('2d')!;
  const lhc = document.createElement('canvas');
  lhc.width = size;
  lhc.height = size;
  const lhctx = lhc.getContext('2d')!;

  lctx.fillStyle = '#dcdcdc';
  lctx.fillRect(0, 0, size, size);
  lhctx.fillStyle = '#808080';
  lhctx.fillRect(0, 0, size, size);

  for (let y = 0; y < size; y += 4) {
    const shade = 212 + ((y * 7) % 18);
    lctx.fillStyle = `rgba(${shade},${shade},${shade},0.28)`;
    lctx.fillRect(0, y, size, 2);
    lhctx.fillStyle = (y / 4) % 2 === 0 ? '#929292' : '#727272';
    lhctx.fillRect(0, y, size, 2);
  }
  for (let x = 0; x < size; x += 4) {
    const shade = 205 + ((x * 11) % 20);
    lctx.fillStyle = `rgba(${shade},${shade},${shade},0.22)`;
    lctx.fillRect(x, 0, 2, size);
    lhctx.fillStyle = (x / 4) % 2 === 0 ? 'rgba(155,155,155,0.45)' : 'rgba(105,105,105,0.45)';
    lhctx.fillRect(x, 0, 2, size);
  }
  // Subtle garment seam folds
  for (let f = 0; f < 6; f++) {
    const fy = 22 + f * 40;
    const fg = lctx.createLinearGradient(0, fy - 12, 0, fy + 12);
    fg.addColorStop(0, 'rgba(0,0,0,0)');
    fg.addColorStop(0.5, 'rgba(0,0,0,0.12)');
    fg.addColorStop(1, 'rgba(0,0,0,0)');
    lctx.fillStyle = fg;
    lctx.fillRect(0, fy - 12, size, 24);
  }

  const linenMap = finalizeCanvasTexture(
    lc,
    lowMem,
    128,
    maxAnisotropy,
    THREE.SRGBColorSpace,
    THREE.RepeatWrapping,
    THREE.RepeatWrapping,
  );
  const linenNormal = heightCanvasToNormalTexture(lhc, 1.35, maxAnisotropy, 1, 1, lowMem, 128);

  // 2. Supple Weathered Leather
  const bc = document.createElement('canvas');
  bc.width = size;
  bc.height = size;
  const bctx = bc.getContext('2d')!;
  const bhc = document.createElement('canvas');
  bhc.width = size;
  bhc.height = size;
  const bhctx = bhc.getContext('2d')!;
  bctx.fillStyle = '#5a3a22';
  bctx.fillRect(0, 0, size, size);
  bhctx.fillStyle = '#808080';
  bhctx.fillRect(0, 0, size, size);

  let seed = 8817;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  for (let i = 0; i < 420; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 1.5 + rand() * 4.5;
    const v = 56 + Math.floor(rand() * 44);
    bctx.fillStyle = `rgba(${v + 24},${v + 6},${v - 8},0.28)`;
    bctx.beginPath();
    bctx.ellipse(x, y, r, r * 0.7, rand() * Math.PI, 0, Math.PI * 2);
    bctx.fill();

    const hv = 104 + Math.floor(rand() * 48);
    bhctx.fillStyle = `rgba(${hv},${hv},${hv},0.35)`;
    bhctx.beginPath();
    bhctx.arc(x, y, r * 0.65, 0, Math.PI * 2);
    bhctx.fill();
  }
  const leatherMap = finalizeCanvasTexture(
    bc,
    lowMem,
    128,
    maxAnisotropy,
    THREE.SRGBColorSpace,
    THREE.RepeatWrapping,
    THREE.RepeatWrapping,
  );
  const leatherNormal = heightCanvasToNormalTexture(bhc, 1.5, maxAnisotropy, 1, 1, lowMem, 128);

  // 3. Hammered Steel Armor Texture
  const sc = document.createElement('canvas');
  sc.width = size;
  sc.height = size;
  const sctx = sc.getContext('2d')!;
  const shc = document.createElement('canvas');
  shc.width = size;
  shc.height = size;
  const shctx = shc.getContext('2d')!;
  sctx.fillStyle = '#b4bdc4';
  sctx.fillRect(0, 0, size, size);
  shctx.fillStyle = '#808080';
  shctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 240; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 3 + rand() * 8;
    const g = 148 + Math.floor(rand() * 54);
    sctx.fillStyle = `rgba(${g},${g + 4},${g + 8},0.26)`;
    sctx.beginPath();
    sctx.arc(x, y, r, 0, Math.PI * 2);
    sctx.fill();

    const hv = 96 + Math.floor(rand() * 64);
    shctx.fillStyle = `rgba(${hv},${hv},${hv},0.32)`;
    shctx.beginPath();
    shctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
    shctx.fill();
  }
  const steelMap = finalizeCanvasTexture(
    sc,
    lowMem,
    128,
    maxAnisotropy,
    THREE.SRGBColorSpace,
    THREE.ClampToEdgeWrapping,
    THREE.ClampToEdgeWrapping,
  );
  const steelNormal = heightCanvasToNormalTexture(shc, 1.4, maxAnisotropy, 1, 1, lowMem, 128);

  // 4. Realistic Human Eye Texture (sclera, warm hazel-brown iris, pupil, specular catchlight)
  const ec = document.createElement('canvas');
  ec.width = 128;
  ec.height = 128;
  const ectx = ec.getContext('2d')!;
  ectx.fillStyle = '#efe9e0';
  ectx.fillRect(0, 0, 128, 128);
  const irisG = ectx.createRadialGradient(64, 64, 6, 64, 64, 34);
  irisG.addColorStop(0, '#1a120c');
  irisG.addColorStop(0.45, '#593b22');
  irisG.addColorStop(0.85, '#3b2514');
  irisG.addColorStop(1, '#1e140d');
  ectx.fillStyle = irisG;
  ectx.beginPath();
  ectx.arc(64, 64, 34, 0, Math.PI * 2);
  ectx.fill();
  ectx.fillStyle = '#090909';
  ectx.beginPath();
  ectx.arc(64, 64, 15, 0, Math.PI * 2);
  ectx.fill();
  ectx.fillStyle = 'rgba(255,255,255,0.92)';
  ectx.beginPath();
  ectx.arc(74, 53, 5.5, 0, Math.PI * 2);
  ectx.fill();
  const humanEyeMap = new THREE.CanvasTexture(ec);
  humanEyeMap.colorSpace = THREE.SRGBColorSpace;

  return {
    linenMap,
    linenNormal,
    leatherMap,
    leatherNormal,
    steelMap,
    steelNormal,
    humanEyeMap,
  };
}




