import { useCallback, useEffect, useRef, useState } from 'react';
import { GameHud } from './components/GameHud';
import { NonGameplayAds } from './components/NonGameplayAds';
import { DEFAULT_GAME_SETTINGS, SettingsModal } from './components/SettingsModal';
import { StatusModals } from './components/StatusModals';
import { TitleOverlay } from './components/TitleOverlay';
import { WorldMapOverlay } from './components/WorldMapOverlay';
import {
  ARENA_RADIUS,
  INITIAL_SEGMENTS,
  START_SNAKE_SCALE,
  VILLAGES,
  VILLAGE_BOUNDS,
  WATER_PONDS,
  WORLD_REGIONS,
  getSpeciesPowerInfo,
} from './game/engine';
import { GameSettings, HudSnapshot, SnakeSpecies } from './game/types';
import { SnakeSceneController } from './three/SnakeSceneController';

const SETTINGS_STORAGE_KEY = 'serpentis_settings_v1';

function loadSavedSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_GAME_SETTINGS;
    return { ...DEFAULT_GAME_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_GAME_SETTINGS;
  }
}

function formatClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function detectMobileLayout(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(
    window.matchMedia?.('(pointer: coarse)')?.matches ||
      window.innerWidth < 1024 ||
      window.innerHeight < 560,
  );
}

function detectPortraitMobile(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerHeight > window.innerWidth && window.innerWidth < 768;
}

const INITIAL_HUD: HudSnapshot = {
  phase: 'title',
  score: 0,
  bestScore: 0,
  length: INITIAL_SEGMENTS,
  hp: 100,
  maxHp: 100,
  hatchlingCount: 0,
  laidEggCount: 0,
  canLayEgg: true,
  eggCooldown: 0,
  hunterAlert: false,
  threatLevel: 1,
  kills: 0,
  combo: 1,
  comboTimer: 0,
  elapsedSeconds: 0,
  speedKmh: 0,
  stamina: 100,
  cameraMode: 'chase',
  species: 'emerald',
  muted: false,
  deathReason: null,
  nearPrey: false,
  locationLabel: 'Timberhollow Trailhead',
  elevationY: 0,
  isIndoors: false,
  powerInfo: getSpeciesPowerInfo('emerald'),
  powerCooldown: 0,
  powerMaxCooldown: 3.6,
  tailGrabCooldown: 0,
  tailGrabMaxCooldown: 6.0,
  isStealthActive: false,
  isGrabbing: false,
  snakeScale: START_SNAKE_SCALE,
  canSwallow: false,
  feastCount: 0,
  powerTier: 1,
  secondaryCooldown: 0,
  secondaryMaxCooldown: 7.5,
  rivalClashActive: false,
  activeVillageId: -1,
  radar: {
    arenaRadius: ARENA_RADIUS,
    headX: 0,
    headZ: 4,
    heading: Math.PI,
    playerTrail: [],
    villages: VILLAGES,
    regions: WORLD_REGIONS,
    ponds: WATER_PONDS,
    prey: [],
    villagers: [],
    hatchlings: [],
    laidEggs: [],
    obstacles: [],
    buildings: [],
    villageBounds: VILLAGE_BOUNDS,
  },
};

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<SnakeSceneController | null>(null);
  const staminaBarRef = useRef<HTMLDivElement | null>(null);
  const hpBarRef = useRef<HTMLDivElement | null>(null);
  const hpTextRef = useRef<HTMLSpanElement | null>(null);
  const speedTextRef = useRef<HTMLSpanElement | null>(null);
  const timeTextRef = useRef<HTMLSpanElement | null>(null);

  const [settings, setSettings] = useState<GameSettings>(() => loadSavedSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [worldMapOpen, setWorldMapOpen] = useState(false);
  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [isMobileLayout, setIsMobileLayout] = useState<boolean>(() => detectMobileLayout());
  const [isPortraitMobile, setIsPortraitMobile] = useState<boolean>(() => detectPortraitMobile());
  const [dismissedPortrait, setDismissedPortrait] = useState(false);
  const wasPlayingBeforeSettingsRef = useRef(false);
  const wasPlayingBeforeMapRef = useRef(false);

  useEffect(() => {
    const syncLayout = () => {
      setIsMobileLayout(detectMobileLayout());
      const portrait = detectPortraitMobile();
      setIsPortraitMobile(portrait);
      if (!portrait) {
        setDismissedPortrait(false);
      }
    };
    window.addEventListener('resize', syncLayout);
    window.addEventListener('orientationchange', syncLayout);
    return () => {
      window.removeEventListener('resize', syncLayout);
      window.removeEventListener('orientationchange', syncLayout);
    };
  }, []);

  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    const params = new URLSearchParams(window.location.search);
    const autostart = params.get('autostart') === '1';

    const controller = new SnakeSceneController(
      mount,
      {
        onHudUpdate: (snapshot) => {
          setHud(snapshot);
        },
        onFastBars: (staminaPct, speedKmh, elapsedSec, hpPct) => {
          if (staminaBarRef.current) {
            const ratio = Math.max(0, Math.min(1, staminaPct / 100));
            staminaBarRef.current.style.transform = `scaleX(${ratio})`;
            staminaBarRef.current.style.backgroundColor =
              ratio < 0.25 ? '#d98a3b' : '#6ec47d';
          }
          if (hpBarRef.current) {
            const hpRatio = Math.max(0, Math.min(1, hpPct / 100));
            hpBarRef.current.style.transform = `scaleX(${hpRatio})`;
            hpBarRef.current.style.backgroundColor =
              hpRatio < 0.35 ? '#e04838' : hpRatio < 0.65 ? '#e2a743' : '#58c973';
          }
          if (hpTextRef.current) {
            hpTextRef.current.textContent = String(Math.max(0, Math.ceil(hpPct)));
          }
          if (speedTextRef.current) {
            speedTextRef.current.textContent = String(speedKmh);
          }
          if (timeTextRef.current) {
            timeTextRef.current.textContent = formatClock(elapsedSec);
          }
        },
      },
      settings,
      autostart,
    );

    controllerRef.current = controller;
    const win = window as Window & { __SERPENTIS_CTRL__?: SnakeSceneController };
    if (params.get('test') === '1') {
      win.__SERPENTIS_CTRL__ = controller;
    }

    return () => {
      if (win.__SERPENTIS_CTRL__ === controller) {
        delete win.__SERPENTIS_CTRL__;
      }
      controller.dispose();
      controllerRef.current = null;
    };
    // Mount WebGL controller once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUpdateSettings = useCallback((next: GameSettings) => {
    setSettings(next);
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
    controllerRef.current?.applySettings(next);
  }, []);

  const handleSelectSpecies = useCallback(
    (species: SnakeSpecies) => {
      handleUpdateSettings({ ...settings, species });
    },
    [handleUpdateSettings, settings],
  );

  const handleStartHunt = useCallback(() => {
    const touchOrSmall =
      window.matchMedia?.('(pointer: coarse)')?.matches || window.innerWidth < 1024;
    if (touchOrSmall) {
      const docEl = document.documentElement as HTMLElement & {
        requestFullscreen?: () => Promise<void>;
      };
      if (!document.fullscreenElement && docEl.requestFullscreen) {
        docEl.requestFullscreen().catch(() => {});
      }
      const orient = screen.orientation as ScreenOrientation & {
        lock?: (mode: string) => Promise<void>;
      };
      orient?.lock?.('landscape')?.catch(() => {});
    }
    controllerRef.current?.startNewGame();
  }, []);

  const handleOpenSettings = useCallback(() => {
    if (controllerRef.current?.engine.phase === 'playing') {
      wasPlayingBeforeSettingsRef.current = true;
      controllerRef.current.engine.setPhase('paused');
    } else {
      wasPlayingBeforeSettingsRef.current = false;
    }
    setSettingsOpen(true);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setSettingsOpen(false);
    if (wasPlayingBeforeSettingsRef.current) {
      wasPlayingBeforeSettingsRef.current = false;
      controllerRef.current?.resumeGame();
    }
  }, []);

  const handleOpenWorldMap = useCallback(() => {
    if (controllerRef.current?.engine.phase === 'playing') {
      wasPlayingBeforeMapRef.current = true;
      controllerRef.current.engine.setPhase('paused');
    } else {
      wasPlayingBeforeMapRef.current = false;
    }
    setWorldMapOpen(true);
  }, []);

  const handleCloseWorldMap = useCallback(() => {
    setWorldMapOpen(false);
    if (wasPlayingBeforeMapRef.current) {
      wasPlayingBeforeMapRef.current = false;
      controllerRef.current?.resumeGame();
    }
  }, []);

  useEffect(() => {
    const onTabMap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (settingsOpen || worldMapOpen) return;
      const phase = controllerRef.current?.engine.phase;
      if (phase === 'playing' || phase === 'paused') {
        e.preventDefault();
        handleOpenWorldMap();
      }
    };
    window.addEventListener('keydown', onTabMap);
    return () => window.removeEventListener('keydown', onTabMap);
  }, [settingsOpen, worldMapOpen, handleOpenWorldMap]);

  const handleToggleCamera = useCallback(() => {
    const nextMode = controllerRef.current?.toggleCameraMode();
    if (nextMode) {
      setSettings((prev) => {
        const updated = { ...prev, cameraMode: nextMode };
        try {
          localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(updated));
        } catch {
          // Ignore
        }
        return updated;
      });
    }
  }, []);

  const handleToggleMute = useCallback(() => {
    const nextMuted = controllerRef.current?.toggleMute();
    if (typeof nextMuted === 'boolean') {
      setSettings((prev) => {
        const updated = { ...prev, muted: nextMuted };
        try {
          localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(updated));
        } catch {
          // Ignore
        }
        return updated;
      });
    }
  }, []);

  const handleJoystickInput = useCallback(
    (joyX: number, joyY: number, boost: boolean, autoRun = false) => {
      controllerRef.current?.setJoystickInput(joyX, joyY, boost, autoRun);
    },
    [],
  );

  return (
    <main className="relative h-[100dvh] w-screen select-none overflow-hidden bg-[#0b100c]">
      <div
        ref={canvasMountRef}
        data-testid="snake-canvas"
        className="absolute inset-0 h-full w-full"
      />

      <NonGameplayAds phase={hud.phase} />

      {hud.phase === 'title' && (
        <TitleOverlay
          species={hud.species}
          bestScore={hud.bestScore}
          isMobileLayout={isMobileLayout}
          onSelectSpecies={handleSelectSpecies}
          onStart={handleStartHunt}
          onOpenSettings={handleOpenSettings}
        />
      )}

      {(hud.phase === 'playing' || hud.phase === 'paused') && (
        <GameHud
          hud={hud}
          showRadar={settings.showRadar}
          isMobileLayout={isMobileLayout}
          staminaBarRef={staminaBarRef}
          hpBarRef={hpBarRef}
          hpTextRef={hpTextRef}
          speedTextRef={speedTextRef}
          timeTextRef={timeTextRef}
          onLayEgg={() => controllerRef.current?.layEgg()}
          onPrimaryPower={() => controllerRef.current?.triggerPrimaryPower()}
          onSecondaryPower={() => controllerRef.current?.triggerSecondaryPower()}
          onBiteAction={() => controllerRef.current?.triggerBiteAction()}
          onTailGrab={() => controllerRef.current?.triggerTailGrab()}
          onToggleCamera={handleToggleCamera}
          onToggleMute={handleToggleMute}
          onOpenSettings={handleOpenSettings}
          onOpenWorldMap={handleOpenWorldMap}
          onTogglePause={() => controllerRef.current?.togglePause()}
          onRestart={handleStartHunt}
          onJoystickInput={handleJoystickInput}
        />
      )}

      {!worldMapOpen && (
        <StatusModals
          hud={hud}
          settingsOpen={settingsOpen}
          onResume={() => controllerRef.current?.resumeGame()}
          onOpenSettings={handleOpenSettings}
          onRestart={handleStartHunt}
          onTitle={() => controllerRef.current?.returnToTitle()}
        />
      )}

      <WorldMapOverlay
        open={worldMapOpen}
        hud={hud}
        isMobileLayout={isMobileLayout}
        onClose={handleCloseWorldMap}
      />

      <SettingsModal
        open={settingsOpen}
        settings={settings}
        onChange={handleUpdateSettings}
        onResetDefaults={() => handleUpdateSettings(DEFAULT_GAME_SETTINGS)}
        onClose={handleCloseSettings}
      />

      {/* Mobile Portrait Orientation Advisory Overlay */}
      {isPortraitMobile && !dismissedPortrait && (
        <div
          data-testid="rotate-landscape-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Rotate Device to Landscape"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center p-6 text-center"
          style={{ backgroundColor: 'rgba(8, 12, 9, 0.94)' }}
        >
          <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-2xl border border-[#d4a853]/50 bg-[#121c14] shadow-xl">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#d4a853" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="7" width="16" height="10" rx="2" />
              <path d="M18 3a6 6 0 0 1 4 4" />
              <polyline points="22 3 22 7 18 7" />
            </svg>
          </div>
          <div className="font-display text-xs font-bold tracking-[0.22em] text-[#d4a853] uppercase">
            Landscape Recommended
          </div>
          <h2 className="mt-1 text-2xl font-extrabold text-[#f5efe0]">
            Rotate Device to Landscape
          </h2>
          <p className="mt-2 max-w-xs text-sm text-[#a8b6a2]">
            SERPENTIS features dual-thumb combat controls engineered for horizontal widescreen play.
          </p>
          <button
            type="button"
            onClick={() => setDismissedPortrait(true)}
            className="mt-6 cursor-pointer rounded-xl border border-[#d4a853]/45 bg-[#17231a] px-6 py-2.5 text-xs font-bold tracking-wider text-[#f5efe0] uppercase hover:border-[#d4a853]"
          >
            Continue Anyway
          </button>
        </div>
      )}
    </main>
  );
}
