import React from 'react';
import {
  CameraMode,
  DifficultyLevel,
  GameSettings,
  GraphicsQuality,
} from '../game/types';

interface SettingsModalProps {
  open: boolean;
  settings: GameSettings;
  onChange: (next: GameSettings) => void;
  onResetDefaults: () => void;
  onClose: () => void;
}

const isLowMemoryClient =
  typeof navigator !== 'undefined' &&
  typeof (navigator as { deviceMemory?: number }).deviceMemory === 'number' &&
  (navigator as { deviceMemory?: number }).deviceMemory! <= 2;

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  species: 'emerald',
  cameraMode: 'chase',
  graphicsQuality: isLowMemoryClient ? 'performance' : 'balanced',
  difficulty: 'realistic',
  fov: 54,
  turnSensitivity: 1.0,
  volume: 0.75,
  muted: false,
  showRadar: true,
};

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  settings,
  onChange,
  onResetDefaults,
  onClose,
}) => {
  if (!open) return null;

  const update = <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(6, 10, 7, 0.78)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Game Settings"
    >
      <div
        className="flex max-h-[90dvh] w-full max-w-lg flex-col rounded-2xl border p-5 shadow-2xl sm:p-7"
        style={{
          backgroundColor: 'rgba(13, 19, 15, 0.98)',
          borderColor: 'rgba(212, 168, 83, 0.42)',
        }}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 pb-3.5 sm:pb-4">
          <div>
            <div className="font-display text-[11px] font-bold tracking-[0.24em] text-[#d4a853] uppercase">
              Configuration
            </div>
            <h2 className="mt-0.5 text-xl font-extrabold tracking-tight text-[#f5efe0] sm:text-2xl">
              Game Settings
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close Settings"
            onClick={onClose}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-white/15 bg-white/5 text-[#c8d0c2] transition-colors hover:border-[#d4a853] hover:text-white"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="mt-4 flex-1 space-y-5 overflow-y-auto pr-1 sm:mt-5" style={{ touchAction: 'pan-y' }}>
          {/* Graphics Quality */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wider text-[#b6c2b0] uppercase">
                Graphics Quality
              </span>
              <span className="text-xs text-[#8f9c8a]">Shadows &amp; Detail</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'high', label: 'High' },
                  { id: 'balanced', label: 'Balanced' },
                  { id: 'performance', label: 'Performance' },
                ] as Array<{ id: GraphicsQuality; label: string }>
              ).map((opt) => {
                const active = settings.graphicsQuality === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => update('graphicsQuality', opt.id)}
                    className="cursor-pointer rounded-lg border py-2 text-xs font-semibold transition-colors"
                    style={{
                      backgroundColor: active ? 'rgba(212, 168, 83, 0.18)' : 'rgba(255,255,255,0.03)',
                      borderColor: active ? '#d4a853' : 'rgba(255,255,255,0.12)',
                      color: active ? '#f5dba1' : '#b8c3b3',
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Difficulty / Speed */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wider text-[#b6c2b0] uppercase">
                Simulation Pace
              </span>
              <span className="text-xs text-[#8f9c8a]">Speed &amp; Hazards</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'relaxed', label: 'Relaxed' },
                  { id: 'realistic', label: 'Realistic' },
                  { id: 'apex', label: 'Apex' },
                ] as Array<{ id: DifficultyLevel; label: string }>
              ).map((opt) => {
                const active = settings.difficulty === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => update('difficulty', opt.id)}
                    className="cursor-pointer rounded-lg border py-2 text-xs font-semibold transition-colors"
                    style={{
                      backgroundColor: active ? 'rgba(212, 168, 83, 0.18)' : 'rgba(255,255,255,0.03)',
                      borderColor: active ? '#d4a853' : 'rgba(255,255,255,0.12)',
                      color: active ? '#f5dba1' : '#b8c3b3',
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Camera Perspective */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wider text-[#b6c2b0] uppercase">
                Camera View
              </span>
              <span className="text-xs text-[#8f9c8a]">Shortcut [C]</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { id: 'chase', label: 'Dynamic Chase' },
                  { id: 'canopy', label: 'Canopy Tactical' },
                ] as Array<{ id: CameraMode; label: string }>
              ).map((opt) => {
                const active = settings.cameraMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => update('cameraMode', opt.id)}
                    className="cursor-pointer rounded-lg border py-2 text-xs font-semibold transition-colors"
                    style={{
                      backgroundColor: active ? 'rgba(212, 168, 83, 0.18)' : 'rgba(255,255,255,0.03)',
                      borderColor: active ? '#d4a853' : 'rgba(255,255,255,0.12)',
                      color: active ? '#f5dba1' : '#b8c3b3',
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Field of View Slider */}
          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <label htmlFor="fov-slider" className="font-semibold tracking-wider text-[#b6c2b0] uppercase">
                Field of View
              </label>
              <span className="font-mono-num font-bold text-[#e8c675]">{settings.fov}°</span>
            </div>
            <input
              id="fov-slider"
              type="range"
              min={45}
              max={70}
              step={1}
              value={settings.fov}
              onChange={(e) => update('fov', Number(e.target.value))}
              className="game-slider w-full"
            />
          </div>

          {/* Turn Sensitivity Slider */}
          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <label htmlFor="sens-slider" className="font-semibold tracking-wider text-[#b6c2b0] uppercase">
                Steering Sensitivity
              </label>
              <span className="font-mono-num font-bold text-[#e8c675]">
                {settings.turnSensitivity.toFixed(2)}x
              </span>
            </div>
            <input
              id="sens-slider"
              type="range"
              min={0.6}
              max={1.5}
              step={0.05}
              value={settings.turnSensitivity}
              onChange={(e) => update('turnSensitivity', Number(e.target.value))}
              className="game-slider w-full"
            />
          </div>

          {/* Master Audio Volume & Mute */}
          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <label htmlFor="vol-slider" className="font-semibold tracking-wider text-[#b6c2b0] uppercase">
                Master Volume
              </label>
              <div className="flex items-center gap-3">
                <span className="font-mono-num font-bold text-[#e8c675]">
                  {settings.muted ? 'MUTED' : `${Math.round(settings.volume * 100)}%`}
                </span>
                <button
                  type="button"
                  onClick={() => update('muted', !settings.muted)}
                  className="cursor-pointer rounded border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-[#d2dacd] hover:border-[#d4a853]"
                >
                  {settings.muted ? 'Unmute' : 'Mute'}
                </button>
              </div>
            </div>
            <input
              id="vol-slider"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.volume}
              onChange={(e) => update('volume', Number(e.target.value))}
              className="game-slider w-full"
            />
          </div>

          {/* Wilderness Radar Toggle */}
          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <div>
              <div className="text-xs font-semibold tracking-wider text-[#d9e0d3] uppercase">
                Wilderness Radar
              </div>
              <div className="text-[11px] text-[#8f9c8a]">
                Show prey and obstacle positions on HUD
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.showRadar}
              onClick={() => update('showRadar', !settings.showRadar)}
              className="cursor-pointer rounded-lg border px-3.5 py-1.5 text-xs font-bold transition-colors"
              style={{
                backgroundColor: settings.showRadar
                  ? 'rgba(92, 184, 116, 0.2)'
                  : 'rgba(255, 255, 255, 0.05)',
                borderColor: settings.showRadar ? '#5cb874' : 'rgba(255,255,255,0.18)',
                color: settings.showRadar ? '#95e3a8' : '#9ca799',
              }}
            >
              {settings.showRadar ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between gap-3 border-t border-white/10 pt-4">
          <button
            type="button"
            onClick={onResetDefaults}
            className="cursor-pointer rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-xs font-semibold text-[#b8c4b2] transition-colors hover:border-[#d4a853] hover:text-white"
          >
            Reset Defaults
          </button>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg border border-[#e3bf74] bg-[#c5963e] px-6 py-2.5 text-sm font-bold text-[#0b100c] transition-colors hover:bg-[#d6a74e]"
          >
            Apply &amp; Close
          </button>
        </div>
      </div>
    </div>
  );
};
