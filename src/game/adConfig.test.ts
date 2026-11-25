import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BANNER_AD_CONFIG,
  DIRECT_LINK_AD_URL,
  GAME_AD_REFRESH_SECONDS,
  NATIVE_AD_CONFIG,
  PROMO_SCRIPT_SRC,
  SOCIAL_BAR_SCRIPT_SRC,
  TITLE_AD_REFRESH_SECONDS,
  buildAdFrameUrl,
  computeAdDisplayMetrics,
  getAdRefreshSeconds,
  getTitleAdKind,
  hasRenderedAdCandidate,
  shouldEnableNonGameplayAds,
} from './adConfig';

test('refresh intervals match 30s on title and 35s during gameplay', () => {
  assert.equal(TITLE_AD_REFRESH_SECONDS, 30);
  assert.equal(GAME_AD_REFRESH_SECONDS, 35);
  assert.equal(getAdRefreshSeconds('title'), 30);
  assert.equal(getAdRefreshSeconds('playing'), 35);
});

test('all 5 ad units expose valid config endpoints and smart phase gating', () => {
  assert.match(BANNER_AD_CONFIG.scriptSrc, /bauval\.org\/22\/138e7e65c84f1620d03be9fefe7f1d72/);
  assert.match(NATIVE_AD_CONFIG.scriptSrc, /bauval\.org\/21\/937f5a3ebb516a5c516b8d61f1484eec/);
  assert.match(SOCIAL_BAR_SCRIPT_SRC, /bauval\.org\/14\/9cfdea7a69b0e20d9b35602020597b44/);
  assert.match(DIRECT_LINK_AD_URL, /araplhn\.org\/4\/4a218fdea453ea78a64f6efc45510bcf/);
  assert.match(PROMO_SCRIPT_SRC, /abscloud\.org\/1\/2ec781d39d7217ee87e07db89b816868/);

  assert.equal(shouldEnableNonGameplayAds('title'), true);
  assert.equal(shouldEnableNonGameplayAds('gameover'), true);
  assert.equal(shouldEnableNonGameplayAds('playing'), false);
  assert.equal(shouldEnableNonGameplayAds('paused'), false);
});

test('buildAdFrameUrl rotates title between native and banner468 while playing uses banner468', () => {
  assert.equal(getTitleAdKind(0), 'native');
  assert.equal(getTitleAdKind(1), 'banner468');
  assert.equal(buildAdFrameUrl('title', 0), '/native-ad-frame.html?placement=title&tick=0');
  assert.equal(buildAdFrameUrl('title', 1), '/ad-frame.html?placement=title&tick=1');
  assert.equal(buildAdFrameUrl('playing', 0), '/ad-frame.html?placement=playing&tick=0');
  assert.equal(buildAdFrameUrl('playing', 3), '/ad-frame.html?placement=playing&tick=3');
});

test('hasRenderedAdCandidate returns false when no ad is running or only tracking pixels exist', () => {
  assert.equal(hasRenderedAdCandidate([]), false);
  assert.equal(
    hasRenderedAdCandidate([
      { tagName: 'SCRIPT', width: 0, height: 0 },
      { tagName: 'IMG', width: 1, height: 1, completeImage: true, naturalWidth: 1 },
      { tagName: 'IFRAME', width: 468, height: 60, src: 'about:blank' },
      { tagName: 'DIV', width: 468, height: 60, hasVisibleTextOrBg: false },
    ]),
    false,
  );
});

test('hasRenderedAdCandidate returns true only when an actual visible ad element is rendered', () => {
  assert.equal(
    hasRenderedAdCandidate([
      { tagName: 'IFRAME', width: 468, height: 60, src: 'https://cdn.example.com/banner.html' },
    ]),
    true,
  );
  assert.equal(
    hasRenderedAdCandidate([
      { tagName: 'IMG', width: 468, height: 60, completeImage: true, naturalWidth: 468 },
    ]),
    true,
  );
  assert.equal(
    hasRenderedAdCandidate([
      { tagName: 'DIV', width: 468, height: 60, hasVisibleTextOrBg: true },
    ]),
    true,
  );
  assert.equal(
    hasRenderedAdCandidate([
      { tagName: 'DIV', width: 468, height: 60, hasVisibleTextOrBg: false, hasShadowContent: true },
    ]),
    true,
  );
});

test('computeAdDisplayMetrics scales title display large on desktop and playing banner compactly without overlap', () => {
  const desktopTitle = computeAdDisplayMetrics(1440, false, 'title');
  assert.ok(desktopTitle.displayWidth > 468);
  assert.ok(desktopTitle.scale > 1);

  const desktopPlaying = computeAdDisplayMetrics(1440, false, 'playing');
  assert.equal(desktopPlaying.displayWidth, 468);
  assert.equal(desktopPlaying.displayHeight, 60);

  const tabletPlaying = computeAdDisplayMetrics(1024, false, 'playing');
  assert.ok(tabletPlaying.displayWidth <= 325);

  const narrowMobilePlaying = computeAdDisplayMetrics(740, true, 'playing');
  assert.ok(narrowMobilePlaying.displayWidth <= 220);

  const mobilePlaying = computeAdDisplayMetrics(844, true, 'playing');
  assert.ok(mobilePlaying.displayWidth <= 270);
  assert.ok(mobilePlaying.displayHeight <= 36);
});
