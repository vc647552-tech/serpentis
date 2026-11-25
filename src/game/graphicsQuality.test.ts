import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGraphicsQualityConfig } from './graphicsQuality';

test('performance quality optimizes shadow pass while preserving sharp resolution, PBR lighting, and contact shadows', () => {
  const mobilePerf = resolveGraphicsQualityConfig('performance', {
    isMobile: true,
    isLowMem: false,
    isSoftwareGl: false,
    devicePixelRatio: 2.0,
    maxGrassCount: 1600,
  });

  // Never drop below native 1.0 DPR or degrade hero snake / anisotropy / IBL
  assert.ok(mobilePerf.effectivePixelRatio >= 1.1, `Expected sharp DPR >= 1.1, got ${mobilePerf.effectivePixelRatio}`);
  assert.equal(mobilePerf.shadowsEnabled, false, 'Performance skips heavy shadow map render pass');
  assert.equal(mobilePerf.contactShadowsEnabled, true, 'Performance keeps cheap contact shadows so snake never floats');
  assert.equal(mobilePerf.envMapEnabled, true, 'Performance retains pre-baked PBR environment reflections');
  assert.equal(mobilePerf.heroClearcoat, true, 'Performance retains clearcoat sheen on hero snake');
  assert.equal(mobilePerf.lowHeroTextures, false, 'Performance keeps crisp 512px hero snake textures');
  assert.ok(mobilePerf.maxAnisotropyCap >= 4, 'Performance keeps anisotropic filtering to avoid blurry ground');
  assert.ok(mobilePerf.grassCount >= 500, 'Performance retains lush instanced grass');
});

test('high and balanced tiers enable real shadows and scale resolution cleanly', () => {
  const high = resolveGraphicsQualityConfig('high', {
    isMobile: false,
    isLowMem: false,
    isSoftwareGl: false,
    devicePixelRatio: 2.0,
    maxGrassCount: 1600,
  });
  const balanced = resolveGraphicsQualityConfig('balanced', {
    isMobile: true,
    isLowMem: false,
    isSoftwareGl: false,
    devicePixelRatio: 2.0,
    maxGrassCount: 1600,
  });

  assert.equal(high.shadowsEnabled, true);
  assert.equal(high.heroIridescence, true);
  assert.ok(high.effectivePixelRatio > balanced.effectivePixelRatio);
  assert.equal(balanced.shadowsEnabled, true);
  assert.equal(balanced.contactShadowsEnabled, true);
});
