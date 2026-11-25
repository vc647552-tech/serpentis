import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AdPlacement,
  BANNER_AD_CONFIG,
  BannerFrameKind,
  DIRECT_LINK_AD_URL,
  NATIVE_AD_CONFIG,
  TITLE_NATIVE_FALLBACK_MS,
  UNFILLED_RETRY_MS,
  buildAdFrameUrl,
  computeAdDisplayMetrics,
  getAdRefreshSeconds,
  getTitleAdKind,
  isAdRunningInDocument,
} from '../game/adConfig';

interface BannerAdSlotProps {
  placement: AdPlacement;
  isMobileLayout?: boolean;
  className?: string;
}

export const BannerAdSlot: React.FC<BannerAdSlotProps> = ({
  placement,
  isMobileLayout = false,
  className = '',
}) => {
  const refreshSeconds = getAdRefreshSeconds(placement);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const observerRef = useRef<MutationObserver | null>(null);
  const probeTimerRef = useRef<number | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);

  const [refreshTick, setRefreshTick] = useState(0);
  const [kindOverride, setKindOverride] = useState<BannerFrameKind | undefined>(undefined);
  const [adRunning, setAdRunning] = useState(false);
  const [nativeHeight, setNativeHeight] = useState(220);
  const [secondsLeft, setSecondsLeft] = useState(refreshSeconds);
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1440,
  );

  const activeKind: BannerFrameKind = useMemo(() => {
    if (placement === 'playing') return 'banner468';
    return kindOverride ?? getTitleAdKind(refreshTick);
  }, [placement, kindOverride, refreshTick]);

  useEffect(() => {
    const syncWidth = () => {
      setViewportWidth(window.innerWidth);
    };
    window.addEventListener('resize', syncWidth);
    window.addEventListener('orientationchange', syncWidth);
    return () => {
      window.removeEventListener('resize', syncWidth);
      window.removeEventListener('orientationchange', syncWidth);
    };
  }, []);

  useEffect(() => {
    setRefreshTick(0);
    setKindOverride(undefined);
    setAdRunning(false);
    setSecondsLeft(refreshSeconds);
  }, [placement, refreshSeconds]);

  const stopProbing = useCallback(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (probeTimerRef.current !== null) {
      window.clearInterval(probeTimerRef.current);
      probeTimerRef.current = null;
    }
    if (fallbackTimerRef.current !== null) {
      window.clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => stopProbing(), [stopProbing]);

  const checkIframeForAd = useCallback(() => {
    const ifr = iframeRef.current;
    if (!ifr) return false;
    try {
      const doc = ifr.contentDocument;
      if (isAdRunningInDocument(doc)) {
        if (activeKind === 'native' && doc?.body) {
          const container = doc.getElementById(NATIVE_AD_CONFIG.containerId);
          const measuredRaw = container?.scrollHeight || doc.body.scrollHeight || 220;
          const measured = Math.max(120, Math.min(320, measuredRaw));
          setNativeHeight(measured);
        }
        setAdRunning(true);
        stopProbing();
        return true;
      }
    } catch {
      // Ignore transient unloading frame errors
    }
    return false;
  }, [activeKind, stopProbing]);

  const handleIframeLoad = useCallback(() => {
    stopProbing();
    if (checkIframeForAd()) return;

    const ifr = iframeRef.current;
    try {
      const doc = ifr?.contentDocument;
      if (doc?.body) {
        const observer = new MutationObserver(() => {
          checkIframeForAd();
        });
        observer.observe(doc.body, {
          childList: true,
          subtree: true,
          attributes: true,
        });
        observerRef.current = observer;
      }
    } catch {
      // Ignore observer attach errors
    }

    // Keep lightweight check active until the ad renders or retry triggers
    probeTimerRef.current = window.setInterval(() => {
      checkIframeForAd();
    }, 650);

    // On Title screen when trying native, fall back to banner468 after 4s if native is unfilled
    if (placement === 'title' && activeKind === 'native' && kindOverride === undefined) {
      fallbackTimerRef.current = window.setTimeout(() => {
        if (!checkIframeForAd()) {
          setKindOverride('banner468');
        }
      }, TITLE_NATIVE_FALLBACK_MS);
    }

    // Never stay stuck forever on an unfilled tick — rotate/retry automatically
    retryTimerRef.current = window.setTimeout(() => {
      if (!checkIframeForAd()) {
        stopProbing();
        setKindOverride(undefined);
        setRefreshTick((tick) => tick + 1);
      }
    }, UNFILLED_RETRY_MS);
  }, [activeKind, checkIframeForAd, kindOverride, placement, stopProbing]);

  // Countdown and refresh timer runs when an ad is actively running
  useEffect(() => {
    if (!adRunning) return;

    setSecondsLeft(refreshSeconds);

    const countdownInterval = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(countdownInterval);
          stopProbing();
          setAdRunning(false);
          setKindOverride(undefined);
          setRefreshTick((tick) => tick + 1);
          return refreshSeconds;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(countdownInterval);
    };
  }, [adRunning, refreshSeconds, stopProbing]);

  const metrics = useMemo(
    () => computeAdDisplayMetrics(viewportWidth, isMobileLayout, placement),
    [viewportWidth, isMobileLayout, placement],
  );

  const frameUrl = useMemo(
    () => buildAdFrameUrl(placement, refreshTick, activeKind),
    [placement, refreshTick, activeKind],
  );

  const progressPct = adRunning
    ? Math.max(0, Math.min(100, ((refreshSeconds - secondsLeft) / refreshSeconds) * 100))
    : 0;

  if (placement === 'title') {
    const isNative = activeKind === 'native';
    return (
      <aside
        data-testid="ad-slot-title"
        data-ad-placement="title"
        data-ad-kind={activeKind}
        data-ad-running={adRunning ? 'true' : 'false'}
        data-ad-tick={refreshTick}
        data-ad-refresh-sec={refreshSeconds}
        aria-label="Sponsored Display"
        className={`pointer-events-auto relative flex flex-col overflow-hidden rounded-2xl border transition-colors ${
          adRunning
            ? 'border-[#d4a853]/55 bg-transparent shadow-2xl'
            : 'border-[#d4a853]/35 bg-[#0c130e]/78 shadow-xl'
        } ${className}`}
      >
        <div className="flex items-center justify-between border-b border-[#d4a853]/25 bg-[#0e1711]/75 px-4 py-2">
          <span className="font-display text-[11px] font-bold tracking-[0.2em] text-[#d4a853] uppercase">
            Featured Sponsor
          </span>
          {adRunning ? (
            <span
              data-testid="ad-title-countdown"
              className="font-mono-num text-[11px] font-semibold text-[#e6ecd9]"
            >
              Next Ad · {secondsLeft}s
            </span>
          ) : (
            <span className="text-[10px] font-semibold tracking-wider text-[#9db097] uppercase">
              Sponsored Offer
            </span>
          )}
        </div>

        <div className="relative flex items-center justify-center bg-transparent p-2.5 sm:p-3">
          {/* Interactive Direct Link Ad fallback shown cleanly underneath until live iframe ad fills */}
          {!adRunning && (
            <a
              href={DIRECT_LINK_AD_URL}
              target="_blank"
              rel="noopener"
              data-testid="ad-title-direct-card"
              className="relative z-10 flex w-full max-w-[540px] items-center justify-between gap-4 rounded-xl border border-[#d4a853]/30 bg-[#121c15]/92 px-4 py-4 text-left transition-colors hover:border-[#d4a853]"
            >
              <div className="min-w-0">
                <div className="text-[10px] font-bold tracking-[0.18em] text-[#d4a853] uppercase">
                  Partner Spotlight
                </div>
                <div className="mt-1 text-sm font-bold text-[#f5efe0] sm:text-base">
                  Unlock Exclusive Partner Rewards
                </div>
                <div className="mt-0.5 text-xs text-[#a7b5a1]">
                  Tap to view featured sponsor offer in a new tab
                </div>
              </div>
              <span className="shrink-0 rounded-lg border border-[#e7c57c] bg-[#c5963e] px-3.5 py-2 text-xs font-extrabold tracking-wider text-[#0b100c] uppercase">
                Open Offer
              </span>
            </a>
          )}

          {isNative ? (
            <div
              className={
                adRunning
                  ? 'relative z-20 w-full overflow-hidden bg-transparent'
                  : 'pointer-events-none absolute inset-0 z-0 overflow-hidden opacity-0'
              }
              style={{
                maxWidth: '540px',
                height: adRunning ? `${nativeHeight}px` : '180px',
              }}
            >
              <iframe
                ref={iframeRef}
                key={`title-${activeKind}-${refreshTick}`}
                title="Sponsored Native Display"
                src={frameUrl}
                onLoad={handleIframeLoad}
                scrolling="no"
                referrerPolicy="origin-when-cross-origin"
                style={{
                  width: '100%',
                  height: '100%',
                  border: 'none',
                  display: 'block',
                  backgroundColor: 'transparent',
                }}
              />
            </div>
          ) : (
            <div
              className={
                adRunning
                  ? 'relative z-20 overflow-hidden bg-transparent'
                  : 'pointer-events-none absolute inset-0 z-0 overflow-hidden opacity-0'
              }
              style={{
                width: metrics.displayWidth,
                height: metrics.displayHeight,
              }}
            >
              <iframe
                ref={iframeRef}
                key={`title-${activeKind}-${refreshTick}`}
                title="Sponsored Banner Display"
                src={frameUrl}
                onLoad={handleIframeLoad}
                width={BANNER_AD_CONFIG.width}
                height={BANNER_AD_CONFIG.height}
                scrolling="no"
                referrerPolicy="origin-when-cross-origin"
                style={{
                  width: `${BANNER_AD_CONFIG.width}px`,
                  height: `${BANNER_AD_CONFIG.height}px`,
                  border: 'none',
                  display: 'block',
                  backgroundColor: 'transparent',
                  transform: `scale(${metrics.scale})`,
                  transformOrigin: 'top left',
                }}
              />
            </div>
          )}
        </div>

        {adRunning && (
          <div className="h-1 w-full bg-transparent">
            <div
              className="h-full origin-left bg-[#d4a853]/80 transition-transform duration-1000 linear"
              style={{ transform: `scaleX(${progressPct / 100})` }}
            />
          </div>
        )}
      </aside>
    );
  }

  return (
    <aside
      data-testid="ad-slot-playing"
      data-ad-placement="playing"
      data-ad-kind={activeKind}
      data-ad-running={adRunning ? 'true' : 'false'}
      data-ad-tick={refreshTick}
      data-ad-refresh-sec={refreshSeconds}
      aria-label="Top Corner Sponsored Banner"
      className={`flex flex-col overflow-hidden rounded-lg bg-transparent ${
        adRunning ? 'pointer-events-auto border border-[#d4a853]/40 shadow-lg' : 'pointer-events-none'
      } ${className}`}
    >
      <div
        className="relative overflow-hidden bg-transparent"
        style={{
          width: adRunning ? metrics.displayWidth : 1,
          height: adRunning ? metrics.displayHeight : 1,
          opacity: adRunning ? 1 : 0,
        }}
      >
        <iframe
          ref={iframeRef}
          key={`playing-${refreshTick}`}
          title="In-Game Corner Banner Ad"
          src={frameUrl}
          onLoad={handleIframeLoad}
          width={BANNER_AD_CONFIG.width}
          height={BANNER_AD_CONFIG.height}
          scrolling="no"
          referrerPolicy="origin-when-cross-origin"
          style={{
            width: `${BANNER_AD_CONFIG.width}px`,
            height: `${BANNER_AD_CONFIG.height}px`,
            border: 'none',
            display: 'block',
            backgroundColor: 'transparent',
            transform: `scale(${metrics.scale})`,
            transformOrigin: 'top left',
          }}
        />
      </div>
      {adRunning && (
        <div className="flex items-center justify-between bg-[#0b100c]/75 px-1.5 py-0.5 text-[9px] leading-none font-semibold tracking-wider text-[#c5d1bf] uppercase">
          <span>Ad</span>
          <span data-testid="ad-playing-countdown" className="font-mono-num text-[#d4a853]">
            {secondsLeft}s
          </span>
        </div>
      )}
    </aside>
  );
};
