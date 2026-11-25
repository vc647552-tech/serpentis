import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  SOCIAL_BAR_SCRIPT_SRC,
  isAdRunningInDocument,
  shouldEnableNonGameplayAds,
} from '../game/adConfig';
import { GamePhase } from '../game/types';

interface NonGameplayAdsProps {
  phase: GamePhase;
}

/**
 * Runs non-gameplay script units (#2 Social Bar & #4 Promo frame)
 * ONLY on Title / Game Over screens, and immediately hides/unmounts any injected
 * third-party DOM overlays during active gameplay so controls & 3D view stay unobstructed.
 */
export const NonGameplayAds: React.FC<NonGameplayAdsProps> = ({ phase }) => {
  const allowExternalAds = shouldEnableNonGameplayAds(phase);
  const socialInjectedRef = useRef(false);
  const baselineNodesRef = useRef<WeakSet<Element>>(new WeakSet());
  const promoFrameRef = useRef<HTMLIFrameElement | null>(null);
  const promoProbeRef = useRef<number | null>(null);
  const promoObserverRef = useRef<MutationObserver | null>(null);
  const [promoVisible, setPromoVisible] = useState(false);

  // Snapshot initial body children once before loading any third-party overlay script
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const rootEl = document.getElementById('root');
    if (rootEl) baselineNodesRef.current.add(rootEl);
    Array.from(document.body.children).forEach((child) => {
      baselineNodesRef.current.add(child);
    });
  }, []);

  // Load Unit #2 (bauval.org/14/...) when on Title/GameOver; retry if previous load errored or yielded no DOM nodes
  useEffect(() => {
    if (!allowExternalAds) return;

    const rootEl = document.getElementById('root');
    const hasInjectedNodes = Array.from(document.body.children).some((child) => {
      if (child === rootEl || baselineNodesRef.current.has(child)) return false;
      const tag = child.tagName.toUpperCase();
      return tag !== 'SCRIPT' && tag !== 'STYLE' && tag !== 'LINK';
    });

    if (socialInjectedRef.current && hasInjectedNodes) return;

    const existing = document.querySelector(`script[src^="${SOCIAL_BAR_SCRIPT_SRC}"]`);
    if (existing && socialInjectedRef.current) {
      // Remove stale unfilled script tag before retrying on re-entry to Title/GameOver
      existing.remove();
    }

    socialInjectedRef.current = true;
    const script = document.createElement('script');
    script.src = SOCIAL_BAR_SCRIPT_SRC;
    script.async = true;
    script.referrerPolicy = 'origin-when-cross-origin';
    script.setAttribute('data-cfasync', 'false');
    script.onerror = () => {
      socialInjectedRef.current = false;
    };
    baselineNodesRef.current.add(script);
    document.body.appendChild(script);
  }, [allowExternalAds]);

  // Toggle visibility of any externally injected body overlays so gameplay is never disturbed
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const rootEl = document.getElementById('root');

    const syncThirdPartyNodes = () => {
      Array.from(document.body.children).forEach((child) => {
        if (child === rootEl || baselineNodesRef.current.has(child)) return;
        const tag = child.tagName.toUpperCase();
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK') return;
        const el = child as HTMLElement;
        if (allowExternalAds) {
          if (el.dataset.serpentisHidden === '1') {
            el.style.removeProperty('display');
            el.style.removeProperty('pointer-events');
            delete el.dataset.serpentisHidden;
          }
        } else {
          el.dataset.serpentisHidden = '1';
          el.style.setProperty('display', 'none', 'important');
          el.style.setProperty('pointer-events', 'none', 'important');
        }
      });
    };

    syncThirdPartyNodes();
    const observer = new MutationObserver(syncThirdPartyNodes);
    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
  }, [allowExternalAds]);

  const stopPromoProbe = useCallback(() => {
    if (promoObserverRef.current) {
      promoObserverRef.current.disconnect();
      promoObserverRef.current = null;
    }
    if (promoProbeRef.current !== null) {
      window.clearInterval(promoProbeRef.current);
      promoProbeRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!allowExternalAds) {
      stopPromoProbe();
      setPromoVisible(false);
    }
    return () => stopPromoProbe();
  }, [allowExternalAds, stopPromoProbe]);

  const checkPromoFrame = useCallback(() => {
    const ifr = promoFrameRef.current;
    if (!ifr) return false;
    try {
      if (isAdRunningInDocument(ifr.contentDocument)) {
        setPromoVisible(true);
        stopPromoProbe();
        return true;
      }
    } catch {
      // Ignore cross-origin / unloading access
    }
    return false;
  }, [stopPromoProbe]);

  const handlePromoLoad = useCallback(() => {
    stopPromoProbe();
    if (checkPromoFrame()) return;
    try {
      const doc = promoFrameRef.current?.contentDocument;
      if (doc?.body) {
        const obs = new MutationObserver(() => {
          checkPromoFrame();
        });
        obs.observe(doc.body, { childList: true, subtree: true, attributes: true });
        promoObserverRef.current = obs;
      }
    } catch {
      // Ignore
    }
    promoProbeRef.current = window.setInterval(() => {
      checkPromoFrame();
    }, 800);
  }, [checkPromoFrame, stopPromoProbe]);

  if (!allowExternalAds) {
    return null;
  }

  // Unit #4 isolated to non-gameplay screens without popup-blocking sandbox restrictions;
  // stays non-blocking while empty and expands cleanly if the script renders a visible promo creative.
  return (
    <iframe
      ref={promoFrameRef}
      data-testid="ad-slot-promo-isolated"
      title="Sponsored Promo Frame"
      src="/promo-ad-frame.html"
      onLoad={handlePromoLoad}
      referrerPolicy="origin-when-cross-origin"
      aria-hidden={!promoVisible}
      tabIndex={promoVisible ? 0 : -1}
      style={
        promoVisible
          ? {
              position: 'fixed',
              bottom: '16px',
              right: '16px',
              width: '320px',
              height: '250px',
              border: 'none',
              pointerEvents: 'auto',
              backgroundColor: 'transparent',
              zIndex: 25,
            }
          : {
              position: 'fixed',
              bottom: 0,
              right: 0,
              width: '1px',
              height: '1px',
              opacity: 0,
              border: 'none',
              pointerEvents: 'none',
              backgroundColor: 'transparent',
              zIndex: 1,
            }
      }
    />
  );
};
