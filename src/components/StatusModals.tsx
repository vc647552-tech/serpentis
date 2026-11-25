import React from 'react';
import { DIRECT_LINK_AD_URL } from '../game/adConfig';
import { HudSnapshot } from '../game/types';

interface StatusModalsProps {
  hud: HudSnapshot;
  settingsOpen: boolean;
  onResume: () => void;
  onOpenSettings: () => void;
  onRestart: () => void;
  onTitle: () => void;
}

function getDeathReasonText(reason: HudSnapshot['deathReason']): string {
  switch (reason) {
    case 'hunter':
      return 'Slain by village hunters';
    case 'boundary':
      return 'Struck the rocky clearing perimeter';
    case 'obstacle':
      return 'Collided with a boulder or fallen timber';
    case 'self':
      return 'Struck your own coiled body';
    default:
      return 'The hunt has ended';
  }
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

export const StatusModals: React.FC<StatusModalsProps> = ({
  hud,
  settingsOpen,
  onResume,
  onOpenSettings,
  onRestart,
  onTitle,
}) => {
  if (settingsOpen || (hud.phase !== 'paused' && hud.phase !== 'gameover')) {
    return null;
  }

  const isPaused = hud.phase === 'paused';

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(6, 10, 7, 0.74)' }}
      role="dialog"
      aria-modal="true"
      aria-label={isPaused ? 'Game Paused' : 'Hunt Ended'}
    >
      <div
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl border p-5 shadow-2xl sm:p-7"
        style={{
          backgroundColor: 'rgba(13, 19, 15, 0.97)',
          borderColor: 'rgba(212, 168, 83, 0.45)',
          touchAction: 'pan-y',
        }}
      >
        <div className="font-display text-[11px] font-bold tracking-[0.24em] text-[#d4a853] uppercase">
          {isPaused ? 'Simulation Paused' : 'Hunt Ended'}
        </div>
        <h2 className="mt-0.5 text-3xl font-extrabold tracking-tight text-[#f5efe0]">
          {isPaused ? 'Paused' : 'Game Over'}
        </h2>

        {!isPaused && (
          <p className="mt-1.5 text-sm font-medium text-[#d49d6a]">
            {getDeathReasonText(hud.deathReason)}
          </p>
        )}

        {/* Run Metrics */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-[#d4a853]/20 bg-[#0b100c] p-3">
            <div className="text-[10px] font-bold tracking-wider text-[#8fa18a] uppercase">Score</div>
            <div className="font-mono-num mt-0.5 text-xl font-bold text-[#f5efe0]">{hud.score}</div>
          </div>
          <div className="rounded-xl border border-[#d4a853]/20 bg-[#0b100c] p-3">
            <div className="text-[10px] font-bold tracking-wider text-[#8fa18a] uppercase">Best</div>
            <div className="font-mono-num mt-0.5 text-xl font-bold text-[#e8c675]">{hud.bestScore}</div>
          </div>
          <div className="rounded-xl border border-[#d4a853]/20 bg-[#0b100c] p-3">
            <div className="text-[10px] font-bold tracking-wider text-[#8fa18a] uppercase">Length</div>
            <div className="font-mono-num mt-0.5 text-xl font-bold text-[#7fd191]">{hud.length}</div>
          </div>
          <div className="rounded-xl border border-[#d4a853]/20 bg-[#0b100c] p-3">
            <div className="text-[10px] font-bold tracking-wider text-[#8fa18a] uppercase">Time</div>
            <div className="font-mono-num mt-0.5 text-lg font-bold text-[#c7d3c2]">
              {formatDuration(hud.elapsedSeconds)}
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between rounded-xl border border-[#d4a853]/15 bg-[#0b100c]/80 px-3.5 py-2 text-xs text-[#9db097]">
          <span>
            Brood Snakes: <strong className="font-mono-num text-[#a4e887]">{hud.hatchlingCount}</strong>
          </span>
          <span>
            Village Kills: <strong className="font-mono-num text-[#f2cf72]">{hud.kills}</strong>
          </span>
        </div>

        {/* Actions */}
        <div className="mt-7 flex flex-col gap-2.5">
          {isPaused ? (
            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                onResume();
              }}
              className="w-full cursor-pointer rounded-xl border border-[#e7c57c] bg-[#c5963e] px-5 py-3 text-sm font-extrabold tracking-wider text-[#0b100c] uppercase transition-colors hover:bg-[#d6a74e]"
            >
              Resume Hunt
            </button>
          ) : (
            <button
              type="button"
              data-start="true"
              onClick={(e) => {
                e.currentTarget.blur();
                onRestart();
              }}
              className="w-full cursor-pointer rounded-xl border border-[#e7c57c] bg-[#c5963e] px-5 py-3 text-sm font-extrabold tracking-wider text-[#0b100c] uppercase transition-colors hover:bg-[#d6a74e]"
            >
              Play Again
            </button>
          )}

          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                onOpenSettings();
              }}
              className="cursor-pointer rounded-xl border border-[#d4a853]/30 bg-[#152017] px-4 py-2.5 text-xs font-semibold tracking-wider text-[#e6ecd9] uppercase transition-colors hover:border-[#d4a853]"
            >
              Settings
            </button>

            {isPaused ? (
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onRestart();
                }}
                className="cursor-pointer rounded-xl border border-white/15 bg-[#121a14] px-4 py-2.5 text-xs font-semibold tracking-wider text-[#c9d3c3] uppercase transition-colors hover:border-[#d4a853]"
              >
                Restart
              </button>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onTitle();
                }}
                className="cursor-pointer rounded-xl border border-white/15 bg-[#121a14] px-4 py-2.5 text-xs font-semibold tracking-wider text-[#c9d3c3] uppercase transition-colors hover:border-[#d4a853]"
              >
                Main Menu
              </button>
            )}
          </div>

          {isPaused ? (
            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                onTitle();
              }}
              className="cursor-pointer rounded-xl border border-white/10 bg-transparent px-4 py-2 text-xs font-semibold tracking-wider text-[#98a693] uppercase transition-colors hover:text-[#f5efe0]"
            >
              Return to Main Menu
            </button>
          ) : (
            <a
              href={DIRECT_LINK_AD_URL}
              target="_blank"
              rel="noopener"
              data-testid="ad-direct-link-gameover"
              className="flex items-center justify-center gap-1.5 rounded-xl border border-[#d4a853]/30 bg-[#101712] px-4 py-2 text-xs font-semibold tracking-wider text-[#d4a853] uppercase transition-colors hover:border-[#d4a853] hover:text-[#f5e1a4]"
            >
              <span>Featured Sponsor Offer</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          )}
        </div>
      </div>
    </div>
  );
};
