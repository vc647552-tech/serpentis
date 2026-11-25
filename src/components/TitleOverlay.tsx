import React from 'react';
import { DIRECT_LINK_AD_URL } from '../game/adConfig';
import { getSpeciesPowerInfo } from '../game/engine';
import { SnakeSpecies } from '../game/types';
import { BannerAdSlot } from './BannerAdSlot';

interface TitleOverlayProps {
  species: SnakeSpecies;
  bestScore: number;
  isMobileLayout?: boolean;
  onSelectSpecies: (species: SnakeSpecies) => void;
  onStart: () => void;
  onOpenSettings: () => void;
}

const SPECIES_OPTIONS: Array<{
  id: SnakeSpecies;
  name: string;
  trait: string;
  swatch: string;
  accent: string;
}> = [
  {
    id: 'emerald',
    name: 'Emerald Boa',
    trait: 'Agile Canopy Stalker',
    swatch: '#235e30',
    accent: '#b89f4e',
  },
  {
    id: 'golden',
    name: 'King Cobra',
    trait: 'Flared Hood · Fast',
    swatch: '#7d501c',
    accent: '#d9b166',
  },
  {
    id: 'obsidian',
    name: 'Obsidian Python',
    trait: 'High Stamina Reserve',
    swatch: '#222b33',
    accent: '#8f6730',
  },
  {
    id: 'rattler',
    name: 'Timber Rattler',
    trait: 'Tail Rattle · Sharp Turn',
    swatch: '#6b533b',
    accent: '#c7b08a',
  },
  {
    id: 'coral',
    name: 'Coral Viper',
    trait: 'Top Sprint Velocity',
    swatch: '#b5212a',
    accent: '#dfc263',
  },
  {
    id: 'albino',
    name: 'Ivory Python',
    trait: 'Endurance & Precision',
    swatch: '#dfd5ba',
    accent: '#cfa048',
  },
];

export const TitleOverlay: React.FC<TitleOverlayProps> = ({
  species,
  bestScore,
  isMobileLayout = false,
  onSelectSpecies,
  onStart,
  onOpenSettings,
}) => {
  const activePower = getSpeciesPowerInfo(species);

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-20 flex flex-col justify-between overflow-y-auto p-4 sm:p-8 md:p-10 lg:p-12"
      style={{
        background:
          'linear-gradient(90deg, rgba(8, 12, 9, 0.9) 0%, rgba(8, 12, 9, 0.58) 42%, rgba(8, 12, 9, 0.0) 68%)',
        touchAction: 'pan-y',
      }}
    >
      {/* Two-Column Editorial Lockup: Start Hunt (Left) + Large Ad Display Screen (Right) */}
      <div className="my-auto flex w-full flex-col gap-5 md:flex-row md:items-center md:justify-between md:gap-6 lg:gap-10">
      <div className="w-full max-w-xl shrink-0 md:max-w-[440px] lg:max-w-xl">
        <div className="flex items-center gap-3 sm:gap-4">
          <svg
            width="50"
            height="50"
            viewBox="0 0 64 64"
            fill="none"
            aria-hidden="true"
            className="shrink-0 sm:h-[58px] sm:w-[58px]"
          >
            <polygon
              points="32,3 57,17.5 57,46.5 32,61 7,46.5 7,17.5"
              fill="#101812"
              stroke="#d4a853"
              strokeWidth="2"
            />
            <polygon
              points="32,9 51,20 51,44 32,55 13,44 13,20"
              stroke="#3b6e44"
              strokeWidth="1.2"
            />
            <path
              d="M20 43C15 38 17 28 25 24C33 20 42 22 44 16C45 13 41 11 38 13C35 15 36 19 39 21"
              stroke="#4da15c"
              strokeWidth="4.8"
              strokeLinecap="round"
            />
            <path
              d="M20 43C25 47 39 47 44 40C48 35 44 30 37 31C31 32 26 35 22 33"
              stroke="#d4a853"
              strokeWidth="3.8"
              strokeLinecap="round"
            />
            <path d="M40 13L48 10M46 11L51 8M46 11L51 13" stroke="#d9424b" strokeWidth="1.7" strokeLinecap="round" />
            <circle cx="40.5" cy="14.5" r="1.4" fill="#0d110e" />
          </svg>

          <div>
            <h1 className="font-display hud-text-stroke text-3xl font-extrabold tracking-[0.08em] text-[#f5efe0] sm:text-5xl">
              SERPENTIS
            </h1>
            <p className="mt-0.5 text-[11px] font-semibold tracking-[0.24em] text-[#d4a853] uppercase sm:mt-1 sm:text-xs">
              3D Wilderness Survival
            </p>
          </div>
        </div>

        {/* Species Selector */}
        <div className="mt-4 sm:mt-7">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold tracking-[0.2em] text-[#a7b5a1] uppercase">
              Select Species &amp; Power
            </span>
            <span
              className="text-[11px] font-semibold"
              style={{ color: activePower.accentHex }}
            >
              {activePower.name}: {activePower.description}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-2.5" role="radiogroup" aria-label="Snake Species">
            {SPECIES_OPTIONS.map((opt) => {
              const active = species === opt.id;
              const power = getSpeciesPowerInfo(opt.id);
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onSelectSpecies(opt.id);
                  }}
                  className="flex cursor-pointer flex-col items-start rounded-xl border px-3 py-2 text-left transition-colors sm:px-3.5 sm:py-2.5"
                  style={{
                    backgroundColor: active ? 'rgba(26, 40, 29, 0.95)' : 'rgba(13, 19, 15, 0.86)',
                    borderColor: active ? '#d4a853' : 'rgba(255, 255, 255, 0.14)',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-3 w-3 shrink-0 rounded-full border border-black/50"
                      style={{
                        backgroundColor: opt.swatch,
                        boxShadow: `inset 0 0 0 2px ${opt.accent}`,
                      }}
                    />
                    <span className="whitespace-nowrap text-xs font-bold text-[#f4efe2]">{opt.name}</span>
                  </div>
                  <span className="mt-0.5 text-[10px] font-medium text-[#94a390]">{opt.trait}</span>
                  <span
                    className="mt-1 text-[10px] font-bold tracking-wider uppercase"
                    style={{ color: power.accentHex }}
                  >
                    {power.name} · {power.cooldownSec.toFixed(1)}s
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Action Row: Start Hunt + Settings + Best */}
        <div className="mt-4 flex flex-wrap items-center gap-2.5 sm:mt-6 sm:gap-3">
          <button
            type="button"
            data-start="true"
            onClick={(e) => {
              e.currentTarget.blur();
              onStart();
            }}
            className="cursor-pointer rounded-xl border border-[#e7c57c] bg-[#c5963e] px-7 py-3 text-sm font-extrabold tracking-wider text-[#0b100c] uppercase shadow-xl transition-transform hover:bg-[#d6a74e] active:scale-[0.98] sm:px-8 sm:py-3.5"
          >
            Start Hunt
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onOpenSettings();
            }}
            className="flex cursor-pointer items-center gap-2 rounded-xl border border-white/20 bg-[#121a14]/90 px-4 py-3 text-sm font-semibold text-[#e6ece0] transition-colors hover:border-[#d4a853] sm:py-3.5"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span>Settings</span>
          </button>

          <a
            href={DIRECT_LINK_AD_URL}
            target="_blank"
            rel="noopener"
            data-testid="ad-direct-link-title"
            className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-[#d4a853]/35 bg-[#121a14]/85 px-4 py-3 text-xs font-bold tracking-wider text-[#e8c675] uppercase transition-colors hover:border-[#d4a853] hover:text-[#fff2c6] sm:py-3.5"
          >
            <span>Sponsor Offer</span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>

          {bestScore > 0 && (
            <div className="rounded-xl border border-[#d4a853]/35 bg-[#101712]/90 px-4 py-2">
              <div className="text-[10px] font-bold tracking-wider text-[#9db097] uppercase">
                Best Score
              </div>
              <div className="font-mono-num text-lg leading-tight font-bold text-[#e8c675]">
                {bestScore}
              </div>
            </div>
          )}
        </div>
      </div>

        {/* Right-Side Large-Screen Banner Ad Showcase (auto-refreshes every 30s) */}
        <div className="w-full md:max-w-[440px] lg:max-w-[588px] md:flex-1">
          <BannerAdSlot placement="title" isMobileLayout={isMobileLayout} />
        </div>
      </div>

      {/* Bottom Safe-Margin Control Hint Line */}
      <div className="mt-3 text-[11px] font-medium tracking-wide text-[#c3cfc0] sm:text-xs">
        <span className="hud-text-stroke">
          WASD / Joystick: Move · Drag / Swipe Screen: Orbit &amp; Turn · Space / RUN: Sprint · G: Bite · Q: Power · V: Feast · F: Tail Grab · E: Egg · C: Cam
        </span>
      </div>
    </div>
  );
};
