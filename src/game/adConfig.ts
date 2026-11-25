export type AdPlacement = 'title' | 'playing';
export type BannerFrameKind = 'banner468' | 'native';

export interface AdScriptConfig {
  key: string;
  format: 'iframe';
  width: number;
  height: number;
  scriptSrc: string;
}

export const BANNER_AD_CONFIG: AdScriptConfig = {
  key: '138e7e65c84f1620d03be9fefe7f1d72',
  format: 'iframe',
  width: 468,
  height: 60,
  scriptSrc: 'https://bauval.org/22/138e7e65c84f1620d03be9fefe7f1d72',
};

export const NATIVE_AD_CONFIG = {
  key: '937f5a3ebb516a5c516b8d61f1484eec',
  containerId: 'container-937f5a3ebb516a5c516b8d61f1484eec',
  scriptSrc: 'https://bauval.org/21/937f5a3ebb516a5c516b8d61f1484eec',
};

export const SOCIAL_BAR_SCRIPT_SRC = 'https://bauval.org/14/9cfdea7a69b0e20d9b35602020597b44';
export const DIRECT_LINK_AD_URL = 'https://araplhn.org/4/4a218fdea453ea78a64f6efc45510bcf';
export const PROMO_SCRIPT_SRC = 'https://abscloud.org/1/2ec781d39d7217ee87e07db89b816868';

export const TITLE_AD_REFRESH_SECONDS = 30;
export const GAME_AD_REFRESH_SECONDS = 35;
export const TITLE_NATIVE_FALLBACK_MS = 4000;
export const UNFILLED_RETRY_MS = 12000;

export function getAdRefreshSeconds(placement: AdPlacement): number {
  return placement === 'title' ? TITLE_AD_REFRESH_SECONDS : GAME_AD_REFRESH_SECONDS;
}

export function getTitleAdKind(refreshTick: number): BannerFrameKind {
  return refreshTick % 2 === 0 ? 'native' : 'banner468';
}

export function shouldEnableNonGameplayAds(phase: string): boolean {
  return phase === 'title' || phase === 'gameover';
}

export function buildAdFrameUrl(
  placement: AdPlacement,
  refreshTick: number,
  kindOverride?: BannerFrameKind,
): string {
  const kind: BannerFrameKind =
    kindOverride ?? (placement === 'title' ? getTitleAdKind(refreshTick) : 'banner468');
  const page = kind === 'native' ? '/native-ad-frame.html' : '/ad-frame.html';
  return `${page}?placement=${encodeURIComponent(placement)}&tick=${refreshTick}`;
}

export interface AdNodeCandidate {
  tagName: string;
  width: number;
  height: number;
  src?: string;
  hasSrcdoc?: boolean;
  hasInnerContent?: boolean;
  hasShadowContent?: boolean;
  completeImage?: boolean;
  naturalWidth?: number;
  hasVisibleTextOrBg?: boolean;
}

const MIN_AD_DIMENSION = 20;

export function hasRenderedAdCandidate(candidates: readonly AdNodeCandidate[]): boolean {
  for (const node of candidates) {
    const tag = node.tagName.toUpperCase();
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'META' || tag === 'LINK' || tag === 'NOSCRIPT') {
      continue;
    }

    if (node.width < MIN_AD_DIMENSION || node.height < MIN_AD_DIMENSION) {
      continue;
    }

    if (tag === 'IFRAME') {
      const src = (node.src ?? '').trim();
      const hasValidSrc = src.length > 0 && src !== 'about:blank';
      if (hasValidSrc || node.hasSrcdoc || node.hasInnerContent) {
        return true;
      }
      continue;
    }

    if (tag === 'IMG') {
      if (node.completeImage !== false && (node.naturalWidth ?? node.width) >= MIN_AD_DIMENSION) {
        return true;
      }
      continue;
    }

    if (tag === 'A' || tag === 'INS' || tag === 'CANVAS' || tag === 'VIDEO' || tag === 'OBJECT' || tag === 'EMBED' || tag === 'SVG') {
      return true;
    }

    if (node.hasShadowContent) {
      return true;
    }

    if ((tag === 'DIV' || tag === 'SPAN' || tag === 'SECTION') && node.hasVisibleTextOrBg) {
      return true;
    }
  }
  return false;
}

export function isAdRunningInDocument(doc: Document | null | undefined): boolean {
  if (!doc || !doc.body) return false;
  const elements = doc.body.querySelectorAll('iframe, img, a, ins, canvas, video, object, embed, svg, div, span, section');
  const candidates: AdNodeCandidate[] = [];
  const view = doc.defaultView;

  for (let i = 0; i < elements.length; i += 1) {
    const el = elements[i];
    const rect = el.getBoundingClientRect();
    const tagName = el.tagName.toUpperCase();
    const hasShadowContent = Boolean(
      (el as HTMLElement).shadowRoot && (el as HTMLElement).shadowRoot!.childElementCount > 0,
    );

    if (tagName === 'IFRAME') {
      const ifr = el as HTMLIFrameElement;
      let hasInnerContent = false;
      try {
        const innerBody = ifr.contentDocument?.body;
        if (innerBody && innerBody.innerHTML.trim().length > 0) {
          hasInnerContent = true;
        }
      } catch {
        // Cross-origin ad iframe with valid src is normal
      }
      candidates.push({
        tagName,
        width: Math.max(rect.width, Number(ifr.getAttribute('width')) || 0),
        height: Math.max(rect.height, Number(ifr.getAttribute('height')) || 0),
        src: ifr.getAttribute('src') ?? '',
        hasSrcdoc: Boolean(ifr.getAttribute('srcdoc')?.trim()),
        hasInnerContent,
      });
    } else if (tagName === 'IMG') {
      const img = el as HTMLImageElement;
      candidates.push({
        tagName,
        width: Math.max(rect.width, img.naturalWidth || 0),
        height: Math.max(rect.height, img.naturalHeight || 0),
        completeImage: img.complete,
        naturalWidth: img.naturalWidth,
      });
    } else if (tagName === 'DIV' || tagName === 'SPAN' || tagName === 'SECTION') {
      let hasVisibleTextOrBg = (el.textContent ?? '').trim().length > 0;
      if (!hasVisibleTextOrBg && view) {
        const style = view.getComputedStyle(el);
        const bgImg = style.backgroundImage;
        const bgCol = style.backgroundColor;
        const hasBgImg = Boolean(bgImg && bgImg !== 'none');
        const hasOpaqueBg = Boolean(bgCol && bgCol !== 'rgba(0, 0, 0, 0)' && bgCol !== 'transparent');
        hasVisibleTextOrBg = hasBgImg || hasOpaqueBg;
      }
      candidates.push({
        tagName,
        width: rect.width,
        height: rect.height,
        hasVisibleTextOrBg,
        hasShadowContent,
      });
    } else {
      candidates.push({
        tagName,
        width: rect.width,
        height: rect.height,
        hasShadowContent,
      });
    }
  }

  return hasRenderedAdCandidate(candidates);
}

export interface AdDisplayMetrics {
  scale: number;
  displayWidth: number;
  displayHeight: number;
}

export function computeAdDisplayMetrics(
  viewportWidth: number,
  isMobileLayout: boolean,
  placement: AdPlacement,
  nativeWidth = BANNER_AD_CONFIG.width,
  nativeHeight = BANNER_AD_CONFIG.height,
): AdDisplayMetrics {
  let scale = 1;

  if (placement === 'title') {
    if (viewportWidth >= 1280) {
      scale = 1.15;
    } else if (viewportWidth >= 1024) {
      scale = 0.96;
    } else if (viewportWidth >= 768) {
      scale = 0.78;
    } else {
      scale = Math.max(0.58, Math.min(0.95, (viewportWidth - 56) / nativeWidth));
    }
  } else {
    // 'playing' top-corner / top-bar placement: keep gameplay viewport completely unobstructed
    if (!isMobileLayout) {
      if (viewportWidth >= 1280) {
        scale = 1.0;
      } else if (viewportWidth >= 1140) {
        scale = 0.82;
      } else {
        scale = 0.68;
      }
    } else if (viewportWidth >= 820) {
      scale = 0.56;
    } else if (viewportWidth >= 680) {
      scale = Math.max(0.36, Math.min(0.5, (viewportWidth - 520) / nativeWidth));
    } else {
      scale = 0.36;
    }
  }

  return {
    scale,
    displayWidth: Math.round(nativeWidth * scale),
    displayHeight: Math.round(nativeHeight * scale),
  };
}
