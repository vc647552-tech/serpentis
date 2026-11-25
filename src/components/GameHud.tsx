import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ARENA_RADIUS, COMBO_DURATION } from '../game/engine';
import { CameraMode, HudSnapshot, SnakeSpecies } from '../game/types';
import { BannerAdSlot } from './BannerAdSlot';

interface GameHudProps {
  hud: HudSnapshot;
  showRadar: boolean;
  isMobileLayout: boolean;
  staminaBarRef: React.RefObject<HTMLDivElement | null>;
  hpBarRef: React.RefObject<HTMLDivElement | null>;
  hpTextRef: React.RefObject<HTMLSpanElement | null>;
  speedTextRef: React.RefObject<HTMLSpanElement | null>;
  timeTextRef: React.RefObject<HTMLSpanElement | null>;
  onLayEgg: () => void;
  onPrimaryPower: () => void;
  onSecondaryPower: () => void;
  onBiteAction: () => void;
  onTailGrab: () => void;
  onToggleCamera: () => void;
  onToggleMute: () => void;
  onOpenSettings: () => void;
  onOpenWorldMap: () => void;
  onTogglePause: () => void;
  onRestart: () => void;
  onJoystickInput: (joyX: number, joyY: number, boost: boolean, autoRun?: boolean) => void;
}

function formatClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const GameHud: React.FC<GameHudProps> = ({
  hud,
  showRadar,
  isMobileLayout,
  staminaBarRef,
  hpBarRef,
  hpTextRef,
  speedTextRef,
  timeTextRef,
  onLayEgg,
  onPrimaryPower,
  onSecondaryPower,
  onBiteAction,
  onTailGrab,
  onToggleCamera,
  onToggleMute,
  onOpenSettings,
  onOpenWorldMap,
  onTogglePause,
  onRestart,
  onJoystickInput,
}) => {
  const cameraLabel = hud.cameraMode === 'chase' ? 'Chase Cam' : 'Canopy Cam';
  const hpRatio = Math.max(0, Math.min(1, hud.hp / Math.max(1, hud.maxHp)));
  const lowHp = hud.hp < 35;

  // Virtual 360 Joystick + Free Fire Sprint Toggle state (DOM-ref driven to prevent 60fps React re-renders)
  const joyPointerIdRef = useRef<number | null>(null);
  const joyVecRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const joyPadRef = useRef<HTMLDivElement | null>(null);
  const joyNubRef = useRef<HTMLDivElement | null>(null);

  const [sprintLocked, setSprintLocked] = useState(false);
  const sprintLockedRef = useRef(false);
  const sprintHeldRef = useRef(false);
  const runDownTimeRef = useRef(0);
  const lastTouchFireRef = useRef<Record<string, number>>({});

  const setJoystickVisual = useCallback((dx: number, dy: number, active: boolean) => {
    const nub = joyNubRef.current;
    if (nub) {
      nub.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      nub.style.backgroundColor = active ? '#d4a853' : 'rgba(212, 168, 83, 0.86)';
    }
    const pad = joyPadRef.current;
    if (pad) {
      pad.style.backgroundColor = active ? 'rgba(16, 25, 18, 0.72)' : 'rgba(12, 18, 14, 0.56)';
      pad.style.borderColor = active ? '#d4a853' : 'rgba(212, 168, 83, 0.45)';
    }
  }, []);

  const syncTouchVector = useCallback(
    (jx: number, jy: number, held: boolean, locked: boolean) => {
      joyVecRef.current = { x: jx, y: jy };
      onJoystickInput(jx, jy, held || locked, locked);
    },
    [onJoystickInput],
  );

  useEffect(() => {
    if (hud.phase !== 'playing') {
      joyPointerIdRef.current = null;
      sprintHeldRef.current = false;
      sprintLockedRef.current = false;
      setSprintLocked(false);
      setJoystickVisual(0, 0, false);
      syncTouchVector(0, 0, false, false);
    }
  }, [hud.phase, setJoystickVisual, syncTouchVector]);

  useEffect(() => {
    const resetOnBlur = () => {
      joyPointerIdRef.current = null;
      sprintHeldRef.current = false;
      setJoystickVisual(0, 0, false);
      syncTouchVector(0, 0, false, sprintLockedRef.current);
    };
    window.addEventListener('blur', resetOnBlur);
    return () => window.removeEventListener('blur', resetOnBlur);
  }, [setJoystickVisual, syncTouchVector]);

  const updateJoystickFromPointer = (el: HTMLElement, clientX: number, clientY: number) => {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * 0.5;
    const maxR = Math.max(24, rect.width * 0.4);
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) {
      dx = (dx / dist) * maxR;
      dy = (dy / dist) * maxR;
    }
    const nx = dx / maxR;
    const ny = -dy / maxR; // Upward drag = positive forward intent
    setJoystickVisual(dx, dy, true);
    syncTouchVector(nx, ny, sprintHeldRef.current, sprintLockedRef.current);
  };

  const handleJoystickPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (joyPointerIdRef.current !== null) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic event without active pointerId
    }
    joyPointerIdRef.current = e.pointerId;
    updateJoystickFromPointer(e.currentTarget, e.clientX, e.clientY);
  };

  const handleJoystickPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== joyPointerIdRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    updateJoystickFromPointer(e.currentTarget, e.clientX, e.clientY);
  };

  const handleJoystickPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== joyPointerIdRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    joyPointerIdRef.current = null;
    setJoystickVisual(0, 0, false);
    syncTouchVector(0, 0, sprintHeldRef.current, sprintLockedRef.current);
  };

  const handleRunPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    sprintHeldRef.current = true;
    runDownTimeRef.current = performance.now();
    syncTouchVector(joyVecRef.current.x, joyVecRef.current.y, true, sprintLockedRef.current);
  };

  const handleRunPointerEnd = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const heldMs = performance.now() - runDownTimeRef.current;
    sprintHeldRef.current = false;
    if (heldMs < 280) {
      const next = !sprintLockedRef.current;
      sprintLockedRef.current = next;
      setSprintLocked(next);
      lastTouchFireRef.current.run = performance.now();
    }
    syncTouchVector(joyVecRef.current.x, joyVecRef.current.y, false, sprintLockedRef.current);
  };

  const fireInstantTouch = (key: string, fn: () => void) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'touch') {
      e.preventDefault();
      e.stopPropagation();
      lastTouchFireRef.current[key] = performance.now();
      fn();
    }
  };

  const fireClickFallback = (key: string, fn: () => void) => (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    if (performance.now() - (lastTouchFireRef.current[key] ?? 0) < 320) return;
    fn();
  };

  const powerReady = hud.powerCooldown <= 0.05;
  const secondaryUnlocked = hud.powerTier >= 2;
  const secondaryReady = secondaryUnlocked && hud.secondaryCooldown <= 0.05;
  const grabReady = hud.tailGrabCooldown <= 0.05 && !hud.isGrabbing;
  const powerFrac =
    hud.powerMaxCooldown > 0
      ? Math.max(0, Math.min(1, hud.powerCooldown / hud.powerMaxCooldown))
      : 0;
  const secondaryFrac =
    hud.secondaryMaxCooldown > 0
      ? Math.max(0, Math.min(1, hud.secondaryCooldown / hud.secondaryMaxCooldown))
      : 0;
  const grabFrac =
    hud.tailGrabMaxCooldown > 0
      ? Math.max(0, Math.min(1, hud.tailGrabCooldown / hud.tailGrabMaxCooldown))
      : 0;

  return (
    <div
      className={`pointer-events-none fixed inset-0 z-10 flex flex-col justify-between ${
        isMobileLayout ? 'p-2.5 sm:p-3.5' : 'p-4 sm:p-6'
      }`}
    >
      {lowHp && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0"
          style={{
            boxShadow: 'inset 0 0 96px rgba(196, 36, 26, 0.55)',
          }}
        />
      )}

      {/* Active Stealth Veil border tint for Albino Python */}
      {hud.isStealthActive && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0"
          style={{
            boxShadow: 'inset 0 0 72px rgba(203, 213, 225, 0.36)',
          }}
        />
      )}

      {/* TOP ROW: Telemetry Cluster (Left) + Hunter Alert (Center) + Utility Toolbar (Right) */}
      <div className="flex items-start justify-between gap-2 sm:gap-4">
        <div className="flex flex-col items-start gap-1.5">
          <div
            className={`flex items-center rounded-xl border ${
              isMobileLayout ? 'gap-2.5 px-2.5 py-1.5' : 'gap-4 px-4 py-2.5'
            }`}
            style={{
              backgroundColor: 'rgba(11, 16, 12, 0.86)',
              borderColor: 'rgba(212, 168, 83, 0.34)',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
            }}
          >
            {/* Score */}
            <div>
              <div className="text-[9px] font-bold tracking-[0.16em] text-[#98a993] uppercase sm:text-[10px]">
                Score
              </div>
              <div
                data-testid="hud-score"
                className={`font-mono-num hud-text-stroke leading-none font-bold text-[#f5efe0] ${
                  isMobileLayout ? 'text-lg sm:text-xl' : 'text-2xl sm:text-3xl'
                }`}
              >
                {hud.score}
              </div>
            </div>

            {!isMobileLayout && (
              <>
                <div className="h-8 w-px bg-[#d4a853]/20" />
                <div className="hidden sm:block">
                  <div className="text-[10px] font-bold tracking-[0.18em] text-[#98a993] uppercase">
                    Best
                  </div>
                  <div className="font-mono-num text-lg leading-none font-bold text-[#e2be70]">
                    {hud.bestScore}
                  </div>
                </div>
              </>
            )}

            <div className="h-6 w-px bg-[#d4a853]/20 sm:h-8" />

            {/* Length */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="sm:h-5 sm:w-5">
                <path
                  d="M4 16C7 16 7 8 11 8C15 8 15 16 19 16"
                  stroke="#5cb874"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                />
                <circle cx="20" cy="16" r="2.2" fill="#d4a853" />
              </svg>
              <div>
                <div className="text-[9px] font-bold tracking-[0.16em] text-[#98a993] uppercase sm:text-[10px]">
                  Length
                </div>
                <div
                  data-testid="hud-length"
                  className={`font-mono-num leading-none font-bold text-[#88d499] ${
                    isMobileLayout ? 'text-sm sm:text-base' : 'text-lg'
                  }`}
                >
                  {hud.length}
                </div>
              </div>
            </div>

            {/* Brood */}
            <div className="h-6 w-px bg-[#d4a853]/20 sm:h-8" />
            <div className="flex items-center gap-1.5 sm:gap-2">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="sm:h-[18px] sm:w-[18px]">
                <path
                  d="M12 3C8.5 3 6 8.5 6 13.5C6 17.8 8.7 20.5 12 20.5C15.3 20.5 18 17.8 18 13.5C18 8.5 15.5 3 12 3Z"
                  fill="#ede3c4"
                  stroke="#86b868"
                  strokeWidth="1.8"
                />
                <circle cx="10.5" cy="12" r="1.1" fill="#7a8c58" />
                <circle cx="13.8" cy="15.2" r="1.3" fill="#7a8c58" />
              </svg>
              <div>
                <div className="text-[9px] font-bold tracking-[0.16em] text-[#98a993] uppercase sm:text-[10px]">
                  Brood
                </div>
                <div
                  data-testid="hud-brood"
                  className={`font-mono-num leading-none font-bold text-[#a4e887] ${
                    isMobileLayout ? 'text-sm sm:text-base' : 'text-lg'
                  }`}
                >
                  {hud.hatchlingCount}
                  {hud.laidEggCount > 0 && (
                    <span className="ml-0.5 text-[11px] font-semibold text-[#f2cf72]">
                      +{hud.laidEggCount}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Growth Scale & Feast Power Tier */}
            <div className="h-6 w-px bg-[#d4a853]/20 sm:h-8" />
            <div>
              <div className="text-[9px] font-bold tracking-[0.16em] text-[#98a993] uppercase sm:text-[10px]">
                {hud.canSwallow ? 'Swallow' : 'Blood'} · T{hud.powerTier}
              </div>
              <div
                data-testid="hud-scale"
                className={`font-mono-num leading-none font-bold ${
                  hud.canSwallow ? 'text-[#ffcf6e]' : 'text-[#e5989b]'
                } ${isMobileLayout ? 'text-sm sm:text-base' : 'text-lg'}`}
              >
                {hud.snakeScale.toFixed(2)}x
              </div>
            </div>

            {/* Active Combo Badge */}
            {hud.combo > 1 && (
              <>
                <div className="h-6 w-px bg-[#d4a853]/20 sm:h-8" />
                <div className="min-w-[38px]">
                  <div className="font-mono-num text-xs leading-none font-extrabold text-[#f5cf73] sm:text-sm">
                    x{hud.combo}
                  </div>
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-black/60">
                    <div
                      className="h-full origin-left bg-[#f5cf73]"
                      style={{
                        transform: `scaleX(${Math.max(0, Math.min(1, hud.comboTimer / COMBO_DURATION))})`,
                      }}
                    />
                  </div>
                </div>
              </>
            )}

            {/* Location & Elevation (Desktop) */}
            {!isMobileLayout && (
              <>
                <div className="hidden h-8 w-px bg-[#d4a853]/20 lg:block" />
                <div className="hidden max-w-[190px] lg:block">
                  <div className="text-[10px] font-bold tracking-[0.18em] text-[#98a993] uppercase">
                    {hud.isIndoors
                      ? 'Indoors'
                      : hud.elevationY > 0.65
                        ? `Elevated +${hud.elevationY.toFixed(1)}m`
                        : 'Zone'}
                  </div>
                  <div
                    data-testid="hud-location"
                    className="truncate text-xs leading-tight font-semibold text-[#e6c97a]"
                    title={hud.locationLabel}
                  >
                    {hud.locationLabel}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Mobile Landscape: Compact HP & Stamina Strip tucked cleanly below Top-Left Telemetry */}
          {isMobileLayout && (
            <div
              className="w-56 rounded-xl border px-2.5 py-1.5"
              style={{
                backgroundColor: 'rgba(11, 16, 12, 0.85)',
                borderColor: lowHp ? 'rgba(232, 82, 66, 0.65)' : 'rgba(212, 168, 83, 0.3)',
              }}
            >
              <div className="mb-0.5 flex items-center justify-between text-[10px] font-semibold text-[#c9d4c4]">
                <span className="tracking-wider uppercase">HP</span>
                <span
                  data-testid="hud-hp"
                  className="font-mono-num font-bold"
                  style={{ color: lowHp ? '#ff7c6e' : '#8ee39c' }}
                >
                  <span ref={hpTextRef}>{Math.max(0, Math.ceil(hud.hp))}</span>/{hud.maxHp}
                </span>
                <span className="font-mono-num text-[#e6c97a]">
                  <span ref={speedTextRef}>{hud.speedKmh}</span> km/h
                </span>
                <span ref={timeTextRef} className="font-mono-num text-[#a4b8a0]">
                  {formatClock(hud.elapsedSeconds)}
                </span>
              </div>
              <div className="mb-1 h-1.5 w-full overflow-hidden rounded-full bg-[#070b08]">
                <div
                  ref={hpBarRef}
                  className="h-full origin-left rounded-full"
                  style={{
                    transform: `scaleX(${hpRatio})`,
                    backgroundColor: hpRatio < 0.35 ? '#e04838' : hpRatio < 0.65 ? '#e2a743' : '#58c973',
                  }}
                />
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#070b08]">
                <div
                  ref={staminaBarRef}
                  className="h-full origin-left rounded-full bg-[#6ec47d]"
                  style={{ transform: `scaleX(${Math.max(0, Math.min(1, hud.stamina / 100))})` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Hunter Alert, Village Escalation & Rival Clash Badges + Mobile Top-Center Banner Ad */}
        <div className="flex flex-col items-center gap-1">
          {isMobileLayout && (
            <BannerAdSlot placement="playing" isMobileLayout={true} />
          )}
          <div className="flex items-center gap-2">
          {hud.rivalClashActive && (
            <div
              data-testid="hud-rival-clash"
              className={`items-center gap-1.5 rounded-lg border font-extrabold tracking-[0.14em] uppercase ${
                isMobileLayout ? 'flex px-2 py-1 text-[10px]' : 'flex px-3.5 py-2 text-xs'
              }`}
              style={{
                backgroundColor: 'rgba(66, 32, 10, 0.94)',
                borderColor: 'rgba(245, 166, 35, 0.85)',
                color: '#ffe8b8',
                boxShadow: '0 6px 20px rgba(0, 0, 0, 0.45)',
              }}
            >
              <span>RIVAL CLASH</span>
            </div>
          )}

          {(hud.hunterAlert || hud.threatLevel > 1) && (
            <div
              data-testid="hud-hunter-alert"
              className={`items-center gap-1.5 rounded-lg border font-extrabold tracking-[0.12em] uppercase ${
                isMobileLayout ? 'hidden sm:flex px-2.5 py-1 text-[10px]' : 'hidden md:flex px-3.5 py-2 text-xs'
              }`}
              style={{
                backgroundColor: hud.hunterAlert ? 'rgba(84, 18, 16, 0.92)' : 'rgba(58, 30, 14, 0.9)',
                borderColor: hud.hunterAlert ? 'rgba(232, 82, 66, 0.82)' : 'rgba(224, 148, 62, 0.72)',
                color: hud.hunterAlert ? '#ffd7cf' : '#ffe3b3',
                boxShadow: '0 6px 20px rgba(0, 0, 0, 0.45)',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={hud.hunterAlert ? '#ff7a6b' : '#f2b14e'} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span data-testid="hud-threat-level">
                {hud.threatLevel > 1 ? `Threat Lv ${hud.threatLevel}` : 'Alert'}
              </span>
              {hud.hunterAlert && !isMobileLayout && (
                <>
                  <span className="opacity-50">·</span>
                  <span>{hud.threatLevel >= 3 ? 'Elite Squads Closing In' : 'Hunters Closing In'}</span>
                </>
              )}
            </div>
          )}
          </div>
        </div>

        {/* Top-Right Corner Banner Ad (Desktop) + Compact Utility Toolbar (+ Mobile Compact Radar) */}
        <div className="flex flex-col items-end gap-1.5">
          {!isMobileLayout && (
            <BannerAdSlot placement="playing" isMobileLayout={false} />
          )}
          <div className="pointer-events-auto flex items-center gap-1 sm:gap-2">
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Switch Camera (${cameraLabel}) [C]`}
              title={`Camera: ${cameraLabel} [C]`}
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleCamera();
              }}
              className={`flex cursor-pointer items-center gap-1.5 rounded-lg border text-xs font-semibold text-[#e6ecd9] transition-colors hover:border-[#d4a853] ${
                isMobileLayout ? 'h-8 px-2.5' : 'h-10 px-3'
              }`}
              style={{
                backgroundColor: 'rgba(11, 16, 12, 0.86)',
                borderColor: 'rgba(212, 168, 83, 0.3)',
              }}
            >
              <CameraIcon mode={hud.cameraMode} />
              <span className="hidden lg:inline">{cameraLabel}</span>
            </button>

            <button
              type="button"
              tabIndex={-1}
              aria-label={hud.muted ? 'Unmute Audio [M]' : 'Mute Audio [M]'}
              title={hud.muted ? 'Unmute [M]' : 'Mute [M]'}
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleMute();
              }}
              className={`flex cursor-pointer items-center justify-center rounded-lg border text-[#e6ecd9] transition-colors hover:border-[#d4a853] ${
                isMobileLayout ? 'h-8 w-8' : 'h-10 w-10'
              }`}
              style={{
                backgroundColor: 'rgba(11, 16, 12, 0.86)',
                borderColor: 'rgba(212, 168, 83, 0.3)',
              }}
            >
              <SoundIcon muted={hud.muted} />
            </button>

            <button
              type="button"
              tabIndex={-1}
              aria-label="Open Settings"
              title="Settings"
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenSettings();
              }}
              className={`flex cursor-pointer items-center justify-center rounded-lg border text-[#e6ecd9] transition-colors hover:border-[#d4a853] ${
                isMobileLayout ? 'h-8 w-8' : 'h-10 w-10'
              }`}
              style={{
                backgroundColor: 'rgba(11, 16, 12, 0.86)',
                borderColor: 'rgba(212, 168, 83, 0.3)',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>

            <button
              type="button"
              tabIndex={-1}
              aria-label="Restart Hunt [R]"
              title="Restart [R]"
              onClick={(e) => {
                e.currentTarget.blur();
                sprintLockedRef.current = false;
                sprintHeldRef.current = false;
                setSprintLocked(false);
                syncTouchVector(joyVecRef.current.x, joyVecRef.current.y, false, false);
                onRestart();
              }}
              className={`flex cursor-pointer items-center justify-center rounded-lg border text-[#e6ecd9] transition-colors hover:border-[#d4a853] ${
                isMobileLayout ? 'h-8 w-8' : 'h-10 w-10'
              }`}
              style={{
                backgroundColor: 'rgba(11, 16, 12, 0.86)',
                borderColor: 'rgba(212, 168, 83, 0.3)',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </button>

            <button
              type="button"
              tabIndex={-1}
              aria-label="Pause Game [P]"
              title="Pause [Esc / P]"
              onClick={(e) => {
                e.currentTarget.blur();
                onTogglePause();
              }}
              className={`flex cursor-pointer items-center justify-center rounded-lg border text-[#e6ecd9] transition-colors hover:border-[#d4a853] ${
                isMobileLayout ? 'h-8 w-8' : 'h-10 w-10'
              }`}
              style={{
                backgroundColor: 'rgba(11, 16, 12, 0.86)',
                borderColor: 'rgba(212, 168, 83, 0.3)',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            </button>
          </div>

          {isMobileLayout && showRadar && (
            <button
              type="button"
              tabIndex={-1}
              data-testid="btn-open-world-map"
              aria-label="Open Full World Map"
              title="Tap to Expand Full World Map"
              onPointerDown={fireInstantTouch('map', onOpenWorldMap)}
              onClick={fireClickFallback('map', onOpenWorldMap)}
              className="pointer-events-auto relative cursor-pointer rounded-full border p-1 transition-transform active:scale-95"
              style={{
                backgroundColor: 'rgba(11, 16, 12, 0.90)',
                borderColor: 'rgba(212, 168, 83, 0.55)',
                boxShadow: '0 6px 18px rgba(0, 0, 0, 0.55)',
              }}
            >
              <WildernessRadar hud={hud} size={82} />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -bottom-1 left-1/2 -translate-x-1/2 rounded border border-[#d4a853]/65 bg-[#0c140e] px-1.5 py-0.5 text-[7px] leading-none font-extrabold tracking-widest text-[#f2cf72] uppercase"
              >
                MAP
              </span>
            </button>
          )}
        </div>
      </div>

      {/* BOTTOM ROW: Desktop Tactical HUD vs Free Fire Mobile Landscape Controls */}
      {!isMobileLayout ? (
        <div className="flex items-end justify-between gap-4">
          <div className="flex flex-col items-start gap-2">
            {/* Desktop Action Bar: Blood/Swallow [G], Power [Q], Feast Power [V], Tail Grab [F], Lay Egg [E] */}
            <div className="pointer-events-auto flex flex-wrap items-center gap-2">
              <button
                type="button"
                tabIndex={-1}
                data-testid="ff-btn-bite"
                aria-label={hud.canSwallow ? 'Swallow Human [G]' : 'Blood Bite [G]'}
                onClick={fireClickFallback('bite', onBiteAction)}
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold tracking-wider uppercase transition-colors"
                style={{
                  backgroundColor: hud.canSwallow ? 'rgba(66, 38, 14, 0.94)' : 'rgba(68, 16, 20, 0.94)',
                  borderColor: hud.canSwallow ? '#f2b14e' : '#e04f5f',
                  color: '#f5efe0',
                }}
              >
                <BiteGlyph canSwallow={hud.canSwallow} size={15} />
                <span>{hud.canSwallow ? 'Swallow [G]' : 'Blood Bite [G]'}</span>
              </button>

              <button
                type="button"
                tabIndex={-1}
                data-testid="ff-btn-power"
                aria-label={`${hud.powerInfo.name} [Q]`}
                disabled={!powerReady}
                onClick={fireClickFallback('power', onPrimaryPower)}
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold tracking-wider uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-75"
                style={{
                  backgroundColor: powerReady ? 'rgba(22, 34, 24, 0.94)' : 'rgba(11, 16, 12, 0.86)',
                  borderColor: powerReady ? hud.powerInfo.accentHex : 'rgba(212, 168, 83, 0.25)',
                  color: powerReady ? '#f5efe0' : '#9aa896',
                }}
              >
                <PowerGlyph species={hud.species} accent={hud.powerInfo.accentHex} size={15} />
                <span>
                  {powerReady
                    ? `${hud.powerInfo.shortName} [Q]`
                    : `${hud.powerInfo.shortName} ${hud.powerCooldown.toFixed(1)}s`}
                </span>
              </button>

              <button
                type="button"
                tabIndex={-1}
                data-testid="ff-btn-power2"
                aria-label="Feast Shockwave Power [V]"
                disabled={!secondaryReady}
                onClick={fireClickFallback('power2', onSecondaryPower)}
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold tracking-wider uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-75"
                style={{
                  backgroundColor: secondaryReady ? 'rgba(48, 28, 14, 0.94)' : 'rgba(11, 16, 12, 0.86)',
                  borderColor: secondaryReady ? '#f59e0b' : 'rgba(212, 168, 83, 0.25)',
                  color: secondaryReady ? '#fef0c7' : '#9aa896',
                }}
              >
                <FeastGlyph size={15} />
                <span>
                  {!secondaryUnlocked
                    ? `Feast ${hud.feastCount}/3 [V]`
                    : secondaryReady
                      ? `Feast T${hud.powerTier} [V]`
                      : `Feast ${hud.secondaryCooldown.toFixed(1)}s`}
                </span>
              </button>

              <button
                type="button"
                tabIndex={-1}
                data-testid="ff-btn-tail-grab"
                aria-label="Tail Grab and Devour [F]"
                disabled={!grabReady}
                onClick={fireClickFallback('grab', onTailGrab)}
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold tracking-wider uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-75"
                style={{
                  backgroundColor: hud.isGrabbing
                    ? 'rgba(84, 58, 18, 0.95)'
                    : grabReady
                      ? 'rgba(32, 26, 16, 0.92)'
                      : 'rgba(11, 16, 12, 0.86)',
                  borderColor: grabReady || hud.isGrabbing ? '#e8c675' : 'rgba(212, 168, 83, 0.25)',
                  color: grabReady || hud.isGrabbing ? '#f9e3a4' : '#9aa896',
                }}
              >
                <TailGrabGlyph size={15} />
                <span>
                  {hud.isGrabbing
                    ? 'Devouring...'
                    : grabReady
                      ? 'Tail Grab [F]'
                      : `Grab ${hud.tailGrabCooldown.toFixed(1)}s`}
                </span>
              </button>

              <button
                type="button"
                tabIndex={-1}
                data-testid="btn-lay-egg"
                disabled={!hud.canLayEgg}
                onClick={fireClickFallback('egg', onLayEgg)}
                className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold tracking-wider uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-80"
                style={{
                  backgroundColor: hud.canLayEgg ? 'rgba(28, 42, 24, 0.92)' : 'rgba(11, 16, 12, 0.86)',
                  borderColor: hud.canLayEgg ? 'rgba(164, 232, 135, 0.6)' : 'rgba(212, 168, 83, 0.3)',
                  color: hud.canLayEgg ? '#dcf7c8' : '#b8c7b3',
                }}
              >
                <EggGlyph size={14} />
                <span>
                  {hud.canLayEgg
                    ? 'Lay Egg [E]'
                    : hud.eggCooldown > 0
                      ? `Egg ${Math.ceil(hud.eggCooldown)}s`
                      : 'Need 24 Stam'}
                </span>
              </button>
            </div>

            {/* Desktop Health + Stamina Panel */}
            <div
              className="w-64 rounded-xl border px-3.5 py-2.5"
              style={{
                backgroundColor: 'rgba(11, 16, 12, 0.85)',
                borderColor: lowHp ? 'rgba(232, 82, 66, 0.65)' : 'rgba(212, 168, 83, 0.32)',
              }}
            >
              <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-[#c9d4c4]">
                <span className="tracking-wider uppercase">Health</span>
                <span
                  data-testid="hud-hp"
                  className="font-mono-num font-bold"
                  style={{ color: lowHp ? '#ff7c6e' : '#8ee39c' }}
                >
                  <span ref={hpTextRef}>{Math.max(0, Math.ceil(hud.hp))}</span> / {hud.maxHp}
                </span>
              </div>
              <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-[#070b08]">
                <div
                  ref={hpBarRef}
                  className="h-full origin-left rounded-full"
                  style={{
                    transform: `scaleX(${hpRatio})`,
                    backgroundColor: hpRatio < 0.35 ? '#e04838' : hpRatio < 0.65 ? '#e2a743' : '#58c973',
                  }}
                />
              </div>

              <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-[#b3c2ab]">
                <span className="tracking-wider uppercase">Stamina</span>
                <div className="flex items-center gap-2.5 font-mono-num">
                  <span className="text-[#e6c97a]">
                    <span ref={speedTextRef}>{hud.speedKmh}</span> km/h
                  </span>
                  <span className="text-white/25">|</span>
                  <span ref={timeTextRef} className="text-[#a4b8a0]">
                    {formatClock(hud.elapsedSeconds)}
                  </span>
                </div>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-[#070b08]">
                <div
                  ref={staminaBarRef}
                  className="h-full origin-left rounded-full bg-[#6ec47d]"
                  style={{ transform: `scaleX(${Math.max(0, Math.min(1, hud.stamina / 100))})` }}
                />
              </div>
            </div>
          </div>

          {showRadar && (
            <button
              type="button"
              tabIndex={-1}
              data-testid="btn-open-world-map"
              aria-label="Open Full World Map [Tab]"
              title="Click to Expand Full World Map [Tab]"
              onClick={fireClickFallback('map', onOpenWorldMap)}
              className="pointer-events-auto group relative cursor-pointer rounded-full border p-1.5 transition-all hover:scale-[1.03] hover:border-[#f2cf72]"
              style={{
                backgroundColor: 'rgba(11, 16, 12, 0.90)',
                borderColor: 'rgba(212, 168, 83, 0.52)',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.55)',
              }}
            >
              <WildernessRadar hud={hud} size={132} />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-0.5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded border border-[#d4a853]/70 bg-[#0b130d] px-2 py-0.5 text-[9px] leading-none font-extrabold tracking-widest text-[#f2cf72] uppercase group-hover:border-[#f5dc86] group-hover:text-white"
              >
                <span>MAP</span>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              </span>
            </button>
          )}
        </div>
      ) : (
        /* MOBILE LANDSCAPE: Free Fire-Style Left 360 Joystick (+2 Buttons Above) + Right Curved Action Arc */
        <div className="pointer-events-none flex items-end justify-between gap-2 pb-1">
          {/* LEFT THUMB: 2 Free Fire Buttons directly above 360 Virtual Joystick */}
          <div className="pointer-events-none flex flex-col items-start gap-2 pl-1">
            <div className="pointer-events-none flex items-center gap-2.5 pl-0.5">
              {/* 1. RUN / AUTO-SPRINT */}
              <button
                type="button"
                tabIndex={-1}
                data-testid="ff-btn-run"
                aria-label={sprintLocked ? 'Auto-Sprint Active (Tap to Toggle)' : 'Sprint / Auto-Run'}
                aria-pressed={sprintLocked}
                onPointerDown={handleRunPointerDown}
                onPointerUp={handleRunPointerEnd}
                onPointerCancel={handleRunPointerEnd}
                onClick={(e) => {
                  e.currentTarget.blur();
                  if (performance.now() - (lastTouchFireRef.current.run ?? 0) < 320) return;
                  const next = !sprintLockedRef.current;
                  sprintLockedRef.current = next;
                  setSprintLocked(next);
                  syncTouchVector(joyVecRef.current.x, joyVecRef.current.y, false, next);
                }}
                className="pointer-events-auto touch-control flex h-12 w-12 cursor-pointer flex-col items-center justify-center rounded-full border-2 shadow-xl active:scale-95"
                style={{
                  backgroundColor: sprintLocked ? 'rgba(182, 128, 36, 0.94)' : 'rgba(13, 20, 15, 0.88)',
                  borderColor: sprintLocked ? '#f5cf73' : 'rgba(212, 168, 83, 0.62)',
                  color: sprintLocked ? '#0b100c' : '#f4d482',
                }}
              >
                <RunGlyph size={17} />
                <span className="mt-0.5 text-[8px] leading-none font-extrabold tracking-wider uppercase">
                  {sprintLocked ? 'ON' : 'RUN'}
                </span>
              </button>

              {/* 2. BLOOD BITE / SWALLOW */}
              <button
                type="button"
                tabIndex={-1}
                data-testid="ff-btn-bite"
                aria-label={hud.canSwallow ? 'Swallow Human' : 'Blood Bite'}
                onPointerDown={fireInstantTouch('bite', onBiteAction)}
                onClick={fireClickFallback('bite', onBiteAction)}
                className="pointer-events-auto touch-control flex h-12 w-12 cursor-pointer flex-col items-center justify-center rounded-full border-2 shadow-xl active:scale-95"
                style={{
                  backgroundColor: hud.canSwallow ? 'rgba(92, 46, 14, 0.94)' : 'rgba(84, 18, 24, 0.94)',
                  borderColor: hud.canSwallow ? '#f2b14e' : '#f05d6c',
                  color: '#f7efe1',
                }}
              >
                <BiteGlyph canSwallow={hud.canSwallow} size={17} />
                <span className="mt-0.5 text-[7px] leading-none font-extrabold tracking-wider uppercase">
                  {hud.canSwallow ? 'SWALLOW' : 'BLOOD'}
                </span>
              </button>
            </div>

            <div
              ref={joyPadRef}
              data-testid="ff-joystick"
              role="application"
              aria-label="360 Movement Joystick"
              onPointerDown={handleJoystickPointerDown}
              onPointerMove={handleJoystickPointerMove}
              onPointerUp={handleJoystickPointerEnd}
              onPointerCancel={handleJoystickPointerEnd}
              className="pointer-events-auto touch-control relative flex h-28 w-28 items-center justify-center rounded-full border-2"
              style={{
                backgroundColor: 'rgba(12, 18, 14, 0.56)',
                borderColor: 'rgba(212, 168, 83, 0.45)',
                boxShadow: 'inset 0 0 22px rgba(0, 0, 0, 0.65), 0 6px 20px rgba(0, 0, 0, 0.45)',
              }}
            >
              {/* Inner guidance ring & cardinal chevrons */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-4 rounded-full border border-white/10"
              />
              <span aria-hidden="true" className="pointer-events-none absolute top-1.5 text-[9px] font-bold text-[#d4a853]/75">
                ▲
              </span>
              <span aria-hidden="true" className="pointer-events-none absolute bottom-1.5 text-[9px] font-bold text-[#d4a853]/45">
                ▼
              </span>
              <span aria-hidden="true" className="pointer-events-none absolute left-2 text-[9px] font-bold text-[#d4a853]/65">
                ◀
              </span>
              <span aria-hidden="true" className="pointer-events-none absolute right-2 text-[9px] font-bold text-[#d4a853]/65">
                ▶
              </span>

              {/* Draggable Thumb Nub (moved imperatively via ref for zero React re-renders) */}
              <div
                ref={joyNubRef}
                aria-hidden="true"
                className="pointer-events-none flex h-11 w-11 items-center justify-center rounded-full border-2 shadow-lg will-change-transform"
                style={{
                  transform: 'translate3d(0px, 0px, 0)',
                  backgroundColor: 'rgba(212, 168, 83, 0.86)',
                  borderColor: '#0b100c',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.65)',
                }}
              >
                <div className="h-3.5 w-3.5 rounded-full bg-[#101812]/80" />
              </div>
            </div>
          </div>

          {/* RIGHT THUMB: Free Fire Action Arc (Feast Power, Tail Grab, Lay Egg, Species Power) */}
          <div className="pointer-events-none relative h-36 w-56 shrink-0 pr-1">
            {/* 1. FEAST SHOCKWAVE POWER (Bottom-Left of Right Arc) */}
            <button
              type="button"
              tabIndex={-1}
              data-testid="ff-btn-power2"
              aria-label="Feast Shockwave Power"
              disabled={!secondaryReady}
              onPointerDown={fireInstantTouch('power2', onSecondaryPower)}
              onClick={fireClickFallback('power2', onSecondaryPower)}
              className="pointer-events-auto touch-control absolute bottom-1 left-2 flex h-14 w-14 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-full border-2 shadow-xl active:scale-95 disabled:opacity-75"
              style={{
                backgroundColor: secondaryReady ? 'rgba(54, 30, 12, 0.94)' : 'rgba(13, 20, 15, 0.88)',
                borderColor: secondaryReady ? '#f59e0b' : 'rgba(212, 168, 83, 0.35)',
                color: secondaryReady ? '#fef0c7' : '#8d9b89',
              }}
            >
              {secondaryFrac > 0 && secondaryUnlocked && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/55"
                  style={{ height: `${Math.round(secondaryFrac * 100)}%` }}
                />
              )}
              <div className="relative z-10 flex flex-col items-center">
                <FeastGlyph size={18} />
                <span className="mt-0.5 font-mono-num text-[8px] leading-none font-extrabold tracking-wider uppercase">
                  {!secondaryUnlocked
                    ? `${hud.feastCount}/3`
                    : secondaryReady
                      ? `T${hud.powerTier}`
                      : `${hud.secondaryCooldown.toFixed(1)}s`}
                </span>
              </div>
            </button>

            {/* 2. TAIL GRAB & DEVOUR (Upper-Left of Primary Power) */}
            <button
              type="button"
              tabIndex={-1}
              data-testid="ff-btn-tail-grab"
              aria-label="Tail Grab and Devour"
              disabled={!grabReady}
              onPointerDown={fireInstantTouch('grab', onTailGrab)}
              onClick={fireClickFallback('grab', onTailGrab)}
              className="pointer-events-auto touch-control absolute top-1 left-8 flex h-14 w-14 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-full border-2 shadow-xl active:scale-95 disabled:opacity-80"
              style={{
                backgroundColor: hud.isGrabbing
                  ? 'rgba(188, 120, 32, 0.95)'
                  : grabReady
                    ? 'rgba(24, 21, 14, 0.92)'
                    : 'rgba(11, 15, 12, 0.86)',
                borderColor: grabReady || hud.isGrabbing ? '#e8c675' : 'rgba(212, 168, 83, 0.28)',
                color: grabReady || hud.isGrabbing ? '#f8dfa0' : '#8d9b89',
              }}
            >
              {grabFrac > 0 && !hud.isGrabbing && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/55"
                  style={{ height: `${Math.round(grabFrac * 100)}%` }}
                />
              )}
              <div className="relative z-10 flex flex-col items-center">
                <TailGrabGlyph size={19} />
                <span className="mt-0.5 font-mono-num text-[9px] leading-none font-extrabold tracking-wider uppercase">
                  {hud.isGrabbing ? 'REEL' : grabReady ? 'GRAB' : `${hud.tailGrabCooldown.toFixed(1)}s`}
                </span>
              </div>
            </button>

            {/* 3. LAY EGG (Top-Right of Arc) */}
            <button
              type="button"
              tabIndex={-1}
              data-testid="btn-lay-egg"
              aria-label="Lay Brood Egg"
              disabled={!hud.canLayEgg}
              onPointerDown={fireInstantTouch('egg', onLayEgg)}
              onClick={fireClickFallback('egg', onLayEgg)}
              className="pointer-events-auto touch-control absolute top-0 right-3 flex h-12 w-12 cursor-pointer flex-col items-center justify-center rounded-full border-2 shadow-lg active:scale-95 disabled:opacity-75"
              style={{
                backgroundColor: hud.canLayEgg ? 'rgba(26, 44, 24, 0.92)' : 'rgba(11, 16, 12, 0.86)',
                borderColor: hud.canLayEgg ? '#8fe070' : 'rgba(212, 168, 83, 0.28)',
                color: hud.canLayEgg ? '#dcf7c8' : '#8d9b89',
              }}
            >
              <EggGlyph size={16} />
              <span className="mt-0.5 font-mono-num text-[8px] leading-none font-bold uppercase">
                {hud.canLayEgg
                  ? 'EGG'
                  : hud.eggCooldown > 0
                    ? `${Math.ceil(hud.eggCooldown)}s`
                    : '24S'}
              </span>
            </button>

            {/* 4. PRIMARY SPECIES POWER (Large Free-Fire Anchor Button Bottom-Right) */}
            <button
              type="button"
              tabIndex={-1}
              data-testid="ff-btn-power"
              aria-label={hud.powerInfo.name}
              disabled={!powerReady}
              onPointerDown={fireInstantTouch('power', onPrimaryPower)}
              onClick={fireClickFallback('power', onPrimaryPower)}
              className="pointer-events-auto touch-control absolute right-2 bottom-1 flex h-[68px] w-[68px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-full border-2 shadow-2xl active:scale-95 disabled:opacity-85"
              style={{
                backgroundColor: powerReady ? 'rgba(20, 34, 22, 0.95)' : 'rgba(11, 16, 12, 0.88)',
                borderColor: powerReady ? hud.powerInfo.accentHex : 'rgba(212, 168, 83, 0.28)',
                color: powerReady ? '#f5efe0' : '#8d9b89',
                boxShadow: powerReady ? `0 0 18px ${hud.powerInfo.accentHex}55` : undefined,
              }}
            >
              {powerFrac > 0 && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/60"
                  style={{ height: `${Math.round(powerFrac * 100)}%` }}
                />
              )}
              <div className="relative z-10 flex flex-col items-center">
                <PowerGlyph species={hud.species} accent={hud.powerInfo.accentHex} size={24} />
                <span className="mt-0.5 font-mono-num text-[9px] leading-none font-extrabold tracking-wider uppercase">
                  {powerReady ? hud.powerInfo.shortName : `${hud.powerCooldown.toFixed(1)}s`}
                </span>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const WildernessRadar: React.FC<{ hud: HudSnapshot; size?: number }> = React.memo(({ hud, size = 132 }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const targetPx = Math.round(size * dpr);
    if (canvas.width !== targetPx || canvas.height !== targetPx) {
      canvas.width = targetPx;
      canvas.height = targetPx;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);

    const arenaRadius = hud.radar.arenaRadius || ARENA_RADIUS;
    const center = size * 0.5;
    const discR = center - 3;
    const scale = (center - 6) / arenaRadius;

    // Radar disc & terrain rings
    ctx.beginPath();
    ctx.arc(center, center, discR, 0, Math.PI * 2);
    ctx.fillStyle = '#0e1911';
    ctx.fill();
    ctx.strokeStyle = 'rgba(212, 168, 83, 0.42)';
    ctx.lineWidth = 1.1;
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.arc(center, center, discR - 0.5, 0, Math.PI * 2);
    ctx.clip();

    for (const frac of [0.34, 0.67]) {
      ctx.beginPath();
      ctx.arc(center, center, discR * frac, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(212, 168, 83, 0.11)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.moveTo(center, 5);
    ctx.lineTo(center, size - 5);
    ctx.moveTo(5, center);
    ctx.lineTo(size - 5, center);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.stroke();

    // Dirt trails connecting villages
    const villagesList = hud.radar.villages ?? [];
    if (villagesList.length > 1) {
      const c0x = center + villagesList[0].centerX * scale;
      const c0z = center + villagesList[0].centerZ * scale;
      ctx.strokeStyle = 'rgba(184, 152, 98, 0.28)';
      ctx.lineWidth = 1.4;
      for (let i = 1; i < villagesList.length; i++) {
        const vx = center + villagesList[i].centerX * scale;
        const vz = center + villagesList[i].centerZ * scale;
        ctx.beginPath();
        ctx.moveTo(c0x, c0z);
        ctx.lineTo(vx, vz);
        ctx.stroke();
      }
    }

    // Watering ponds
    const pondsList = hud.radar.ponds ?? [];
    for (let i = 0; i < pondsList.length; i++) {
      const p = pondsList[i];
      ctx.beginPath();
      ctx.ellipse(
        center + p.x * scale,
        center + p.z * scale,
        Math.max(1.8, p.rx * scale),
        Math.max(1.4, p.rz * scale),
        0,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = 'rgba(56, 168, 224, 0.52)';
      ctx.fill();
    }

    // 7 Rival Village Fenced Perimeters
    if (villagesList.length > 0) {
      ctx.lineWidth = 1.1;
      for (let i = 0; i < villagesList.length; i++) {
        const vil = villagesList[i];
        const rx = center + (vil.centerX - vil.halfW) * scale;
        const rz = center + (vil.centerZ - vil.halfD) * scale;
        const rw = vil.halfW * 2 * scale;
        const rh = vil.halfD * 2 * scale;
        const fHex = `#${vil.factionColorHex.toString(16).padStart(6, '0')}`;
        ctx.fillStyle = `${fHex}28`;
        ctx.fillRect(rx, rz, rw, rh);
        ctx.strokeStyle = fHex;
        ctx.globalAlpha = 0.85;
        ctx.strokeRect(rx, rz, rw, rh);
        ctx.globalAlpha = 1;
      }
    } else {
      const rx = center + hud.radar.villageBounds.minX * scale;
      const rz = center + hud.radar.villageBounds.minZ * scale;
      const rw = (hud.radar.villageBounds.maxX - hud.radar.villageBounds.minX) * scale;
      const rh = (hud.radar.villageBounds.maxZ - hud.radar.villageBounds.minZ) * scale;
      ctx.fillStyle = 'rgba(168, 134, 72, 0.14)';
      ctx.fillRect(rx, rz, rw, rh);
      ctx.strokeStyle = 'rgba(212, 168, 83, 0.65)';
      ctx.strokeRect(rx, rz, rw, rh);
    }

    // Buildings
    const blds = hud.radar.buildings;
    for (let i = 0; i < blds.length; i++) {
      const b = blds[i];
      const bx = center + b.x * scale;
      const bz = center + b.z * scale;
      const w = Math.max(1.8, (b.kind === 'manor' ? 9.2 : b.kind === 'cabin' ? 7.6 : 6.4) * b.scale * scale);
      const h = Math.max(1.6, (b.kind === 'manor' ? 7.6 : b.kind === 'cabin' ? 6.6 : 6.4) * b.scale * scale);
      ctx.save();
      ctx.translate(bx, bz);
      ctx.rotate(-b.rotation);
      ctx.fillStyle = 'rgba(224, 180, 92, 0.55)';
      ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
      ctx.strokeStyle = 'rgba(242, 207, 114, 0.92)';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(-w * 0.5, -h * 0.5, w, h);
      ctx.restore();
    }

    // Obstacles
    const obs = hud.radar.obstacles;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      ctx.beginPath();
      ctx.arc(center + o.x * scale, center + o.z * scale, Math.max(1.1, o.radius * scale), 0, Math.PI * 2);
      ctx.fillStyle = o.kind === 'log' ? 'rgba(139, 108, 72, 0.55)' : 'rgba(148, 158, 145, 0.42)';
      ctx.fill();
    }

    // Wildlife prey
    const prey = hud.radar.prey;
    for (let i = 0; i < prey.length; i++) {
      const p = prey[i];
      const r = p.kind === 'elephant' ? 3.2 : p.kind === 'deer' || p.kind === 'boar' ? 2.5 : 1.9;
      ctx.fillStyle =
        p.kind === 'elephant'
          ? '#cbd5e1'
          : p.kind === 'deer'
            ? '#f59e0b'
            : p.kind === 'boar'
              ? '#b45309'
              : p.kind === 'rabbit'
                ? '#f4a261'
                : p.kind === 'mouse'
                  ? '#cbd5e1'
                  : p.kind === 'frog'
                    ? '#5fe378'
                    : p.kind === 'berry'
                      ? '#ef4444'
                      : '#f2cf72';
      ctx.beginPath();
      ctx.arc(center + p.x * scale, center + p.z * scale, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Laid eggs
    const eggs = hud.radar.laidEggs;
    ctx.strokeStyle = '#f2cf72';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < eggs.length; i++) {
      const e = eggs[i];
      ctx.beginPath();
      ctx.arc(center + e.x * scale, center + e.z * scale, 2.2, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Villagers
    const vils = hud.radar.villagers;
    for (let i = 0; i < vils.length; i++) {
      const v = vils[i];
      if (v.state === 'ko') continue;
      const armed = v.role === 'spearman' || v.role === 'crossbow';
      ctx.fillStyle = armed ? '#ef4444' : v.role === 'hide' ? '#a78bfa' : '#38bdf8';
      ctx.beginPath();
      ctx.arc(center + v.x * scale, center + v.z * scale, armed ? 2.4 : 1.7, 0, Math.PI * 2);
      ctx.fill();
    }

    // Hatchlings
    const hatch = hud.radar.hatchlings;
    ctx.fillStyle = '#8ef576';
    for (let i = 0; i < hatch.length; i++) {
      const h = hatch[i];
      ctx.beginPath();
      ctx.arc(center + h.x * scale, center + h.z * scale, 2.1, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player slither trail
    const trail = hud.radar.playerTrail;
    if (trail && trail.length > 1) {
      ctx.beginPath();
      for (let i = 0; i < trail.length; i++) {
        const tx = center + trail[i].x * scale;
        const tz = center + trail[i].z * scale;
        if (i === 0) ctx.moveTo(tx, tz);
        else ctx.lineTo(tx, tz);
      }
      ctx.strokeStyle = 'rgba(136, 224, 153, 0.72)';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    // Player snake head marker
    const hx = center + hud.radar.headX * scale;
    const hz = center + hud.radar.headZ * scale;
    ctx.save();
    ctx.translate(hx, hz);
    ctx.rotate(-hud.radar.heading + Math.PI);
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(3.4, 3.4);
    ctx.lineTo(-3.4, 3.4);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#0b100c';
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.restore();

    ctx.restore(); // end disc clip

    // Cardinal N indicator
    ctx.font = '800 8px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f2cf72';
    ctx.fillText('N', center, 9);

    ctx.restore();
  }, [hud, size]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, display: 'block' }}
      aria-hidden="true"
    />
  );
});

const PowerGlyph: React.FC<{ species: SnakeSpecies; accent: string; size?: number }> = ({
  species,
  accent,
  size = 20,
}) => {
  if (species === 'obsidian' || species === 'rattler') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke={accent} strokeWidth="2" strokeDasharray="4 2" />
        <circle cx="12" cy="12" r="5" stroke={accent} strokeWidth="2" />
        <circle cx="12" cy="12" r="2" fill={accent} />
      </svg>
    );
  }
  if (species === 'albino') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M2 12s3.8-6 10-6 10 6 10 6-3.8 6-10 6-10-6-10-6Z"
          stroke={accent}
          strokeWidth="2"
          fill="rgba(226,232,240,0.16)"
        />
        <ellipse cx="12" cy="12" rx="1.6" ry="3.8" fill={accent} />
      </svg>
    );
  }
  // Venom Spray / Dart / Mist fang droplets
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3C12 3 6.5 10 6.5 14.2C6.5 17.4 8.96 20 12 20C15.04 20 17.5 17.4 17.5 14.2C17.5 10 12 3 12 3Z"
        fill={accent}
        stroke="#0b100c"
        strokeWidth="1.4"
      />
      <path d="M10 14.5C10 16 11 17 12.2 17" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
};

const TailGrabGlyph: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M4 19C7 17 8 13 11 11C14 9 18 10 19 6C19.6 3.8 17 2.5 15 4C12.8 5.6 13.5 9.2 16 11.5C18.2 13.6 18 17.5 14.5 19"
      stroke="#f5cf73"
      strokeWidth="2.4"
      strokeLinecap="round"
    />
    <circle cx="15.5" cy="12" r="2" fill="#f5cf73" />
  </svg>
);

const RunGlyph: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5 17L11 7L14 12L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M15 7H19V11" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const BiteGlyph: React.FC<{ canSwallow: boolean; size?: number }> = ({ canSwallow, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    {canSwallow ? (
      <>
        <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2.1" />
        <path d="M8 10L12 15L16 10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ) : (
      <>
        <path
          d="M12 3C12 3 6.5 10.2 6.5 14.3C6.5 17.4 8.96 20 12 20C15.04 20 17.5 17.4 17.5 14.3C17.5 10.2 12 3 12 3Z"
          fill="#ef4444"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <path d="M9.5 14.5C9.5 16 10.6 17.2 12 17.2" stroke="#ffd8d8" strokeWidth="1.5" strokeLinecap="round" />
      </>
    )}
  </svg>
);

const FeastGlyph: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <polygon
      points="12,2.5 14.8,8.5 21.5,9.3 16.5,13.9 17.9,20.5 12,17.2 6.1,20.5 7.5,13.9 2.5,9.3 9.2,8.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="12" r="2.2" fill="currentColor" />
  </svg>
);

const EggGlyph: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M12 3C8.5 3 6 8.5 6 13.5C6 17.8 8.7 20.5 12 20.5C15.3 20.5 18 17.8 18 13.5C18 8.5 15.5 3 12 3Z"
      fill="currentColor"
      opacity="0.9"
    />
  </svg>
);

const CameraIcon: React.FC<{ mode: CameraMode }> = ({ mode }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {mode === 'chase' ? (
      <>
        <path d="M23 7l-7 5 7 5V7z" />
        <rect x="1" y="5" width="15" height="14" rx="2" />
      </>
    ) : (
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="3" />
      </>
    )}
  </svg>
);

const SoundIcon: React.FC<{ muted: boolean }> = ({ muted }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    {muted ? (
      <>
        <line x1="23" y1="9" x2="17" y2="15" />
        <line x1="17" y1="9" x2="23" y2="15" />
      </>
    ) : (
      <>
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      </>
    )}
  </svg>
);
