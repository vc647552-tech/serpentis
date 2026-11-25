import { GraphicsQuality } from './types';

export interface GraphicsQualityConfig {
  pixelRatioCap: number;
  effectivePixelRatio: number;
  shadowsEnabled: boolean;
  contactShadowsEnabled: boolean;
  envMapEnabled: boolean;
  environmentIntensity: number;
  heroClearcoat: boolean;
  heroIridescence: boolean;
  lowHeroTextures: boolean;
  grassCount: number;
  visibleBirds: number;
  showMotes: boolean;
  cullDistance: number;
  lodDistanceSq: number;
  maxAnisotropyCap: number;
}

export function resolveGraphicsQualityConfig(
  quality: GraphicsQuality,
  options: {
    isMobile: boolean;
    isLowMem: boolean;
    isSoftwareGl: boolean;
    devicePixelRatio: number;
    maxGrassCount: number;
  },
): GraphicsQualityConfig {
  const { isMobile, isLowMem, isSoftwareGl, devicePixelRatio, maxGrassCount } = options;
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;

  if (isSoftwareGl) {
    return {
      pixelRatioCap: 1,
      effectivePixelRatio: 1,
      shadowsEnabled: false,
      contactShadowsEnabled: true,
      envMapEnabled: false,
      environmentIntensity: 0.72,
      heroClearcoat: false,
      heroIridescence: false,
      lowHeroTextures: true,
      grassCount: Math.min(maxGrassCount, 320),
      visibleBirds: 3,
      showMotes: true,
      cullDistance: quality === 'performance' ? 76 : quality === 'balanced' ? 92 : 115,
      lodDistanceSq: 42 * 42,
      maxAnisotropyCap: 1,
    };
  }

  if (quality === 'high') {
    const cap = isMobile ? 1.65 : 1.85;
    return {
      pixelRatioCap: cap,
      effectivePixelRatio: Math.min(dpr, cap),
      shadowsEnabled: true,
      contactShadowsEnabled: true,
      envMapEnabled: true,
      environmentIntensity: 0.85,
      heroClearcoat: true,
      heroIridescence: !isLowMem,
      lowHeroTextures: false,
      grassCount: isLowMem ? Math.min(maxGrassCount, 420) : maxGrassCount,
      visibleBirds: isMobile ? 4 : 6,
      showMotes: true,
      cullDistance: 115,
      lodDistanceSq: 55 * 55,
      maxAnisotropyCap: isLowMem ? 2 : 8,
    };
  }

  if (quality === 'balanced') {
    const cap = isMobile ? 1.35 : 1.45;
    return {
      pixelRatioCap: cap,
      effectivePixelRatio: Math.min(dpr, cap),
      shadowsEnabled: true,
      contactShadowsEnabled: true,
      envMapEnabled: true,
      environmentIntensity: 0.80,
      heroClearcoat: true,
      heroIridescence: false,
      lowHeroTextures: false,
      grassCount: Math.min(maxGrassCount, isLowMem ? 340 : 950),
      visibleBirds: 4,
      showMotes: true,
      cullDistance: 92,
      lodDistanceSq: 48 * 48,
      maxAnisotropyCap: 4,
    };
  }

  // 'performance': Skip heavy 2nd-pass shadow map & iridescence for high FPS,
  // while keeping crisp native+ resolution, 4x anisotropy, IBL, clearcoat scales, and contact shadows.
  const cap = isMobile ? 1.15 : 1.25;
  return {
    pixelRatioCap: cap,
    effectivePixelRatio: Math.min(dpr, cap),
    shadowsEnabled: false,
    contactShadowsEnabled: true,
    envMapEnabled: true,
    environmentIntensity: 0.74,
    heroClearcoat: true,
    heroIridescence: false,
    lowHeroTextures: false,
    grassCount: Math.min(maxGrassCount, isLowMem ? 280 : 580),
    visibleBirds: 3,
    showMotes: true,
    cullDistance: 78,
    lodDistanceSq: 42 * 42,
    maxAnisotropyCap: 4,
  };
}
