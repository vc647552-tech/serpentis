import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ARENA_RADIUS, VILLAGES, WATER_PONDS, WORLD_REGIONS } from '../game/buildings';
import { HudSnapshot } from '../game/types';

interface WorldMapOverlayProps {
  open: boolean;
  hud: HudSnapshot;
  isMobileLayout: boolean;
  onClose: () => void;
}

interface DirectoryLocation {
  id: string;
  name: string;
  category: 'village' | 'outpost' | 'region' | 'pond';
  x: number;
  z: number;
  accent: string;
  subtitle: string;
}

function compassBearing(dx: number, dz: number): string {
  const dist = Math.round(Math.hypot(dx, dz));
  if (dist < 6) return 'Here';
  // -Z is North, +Z is South, +X is East, -X is West
  const deg = (Math.atan2(dx, -dz) * 180) / Math.PI;
  const norm = (deg + 360) % 360;
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const dir = dirs[Math.round(norm / 45) % 8];
  return `${dist}m ${dir}`;
}

export const WorldMapOverlay: React.FC<WorldMapOverlayProps> = ({
  open,
  hud,
  isMobileLayout,
  onClose,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasBox, setCanvasBox] = useState<{ w: number; h: number }>({ w: 560, h: 520 });
  const [selectedLocId, setSelectedLocId] = useState<string | null>(null);

  const directory = useMemo<DirectoryLocation[]>(() => {
    const villagesList = hud.radar.villages?.length ? hud.radar.villages : VILLAGES;
    const regionsList = hud.radar.regions?.length ? hud.radar.regions : WORLD_REGIONS;
    const pondsList = hud.radar.ponds?.length ? hud.radar.ponds : WATER_PONDS;
    const outposts = hud.radar.buildings.filter(
      (b) => b.name === 'Mossy Forest Temple' || b.name === 'Deepwood Ranger Cabin',
    );

    const items: DirectoryLocation[] = [];
    for (const v of villagesList) {
      items.push({
        id: `village-${v.id}`,
        name: v.name,
        category: 'village',
        x: v.centerX,
        z: v.centerZ,
        accent: `#${v.factionColorHex.toString(16).padStart(6, '0')}`,
        subtitle: v.id === 0 ? 'Central Settlement' : 'Rival Village',
      });
    }
    for (const o of outposts) {
      items.push({
        id: `outpost-${o.name}`,
        name: o.name,
        category: 'outpost',
        x: o.x,
        z: o.z,
        accent: '#e2be70',
        subtitle: o.kind === 'ruin_tower' ? 'Ancient Outpost' : 'Ranger Outpost',
      });
    }
    for (const r of regionsList) {
      items.push({
        id: `region-${r.id}`,
        name: r.name,
        category: 'region',
        x: r.x,
        z: r.z,
        accent: r.colorHex,
        subtitle: 'Wilderness Frontier',
      });
    }
    for (const p of pondsList) {
      items.push({
        id: `pond-${p.id}`,
        name: p.name,
        category: 'pond',
        x: p.x,
        z: p.z,
        accent: '#4aa8d8',
        subtitle: 'Watering Hole',
      });
    }
    return items;
  }, [hud.radar.buildings, hud.radar.ponds, hud.radar.regions, hud.radar.villages]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      const nextW = Math.floor(el.clientWidth);
      const nextH = Math.floor(el.clientHeight);
      if (nextW > 40 && nextH > 40) {
        setCanvasBox((prev) =>
          Math.abs(prev.w - nextW) < 2 && Math.abs(prev.h - nextH) < 2
            ? prev
            : { w: nextW, h: nextH },
        );
      }
    };
    updateSize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateSize) : null;
    ro?.observe(el);
    window.addEventListener('resize', updateSize);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = Math.max(200, canvasBox.w);
    const h = Math.max(200, canvasBox.h);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pxW = Math.round(w * dpr);
    const pxH = Math.round(h * dpr);
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const arenaR = hud.radar.arenaRadius || ARENA_RADIUS;
    const pad = Math.max(18, Math.min(w, h) * 0.055);
    const radiusPx = Math.max(60, Math.min(w, h) * 0.5 - pad);
    const cx = w * 0.5;
    const cy = h * 0.5;
    const scale = radiusPx / arenaR;

    const toPx = (wx: number, wz: number) => ({
      x: cx + wx * scale,
      y: cy + wz * scale,
    });

    const drawHaloText = (
      text: string,
      tx: number,
      ty: number,
      color: string,
      font: string,
      align: CanvasTextAlign = 'center',
    ) => {
      ctx.font = font;
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = 'rgba(7, 12, 9, 0.94)';
      ctx.strokeText(text, tx, ty);
      ctx.fillStyle = color;
      ctx.fillText(text, tx, ty);
    };

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // Background terrain vignette
    ctx.fillStyle = '#080e0a';
    ctx.fillRect(0, 0, w, h);

    const discGrad = ctx.createRadialGradient(cx, cy, radiusPx * 0.1, cx, cy, radiusPx * 1.04);
    discGrad.addColorStop(0, '#182b1c');
    discGrad.addColorStop(0.58, '#112015');
    discGrad.addColorStop(0.92, '#0d1810');
    discGrad.addColorStop(1, '#1f1b14');

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
    ctx.fillStyle = discGrad;
    ctx.fill();
    ctx.clip();

    // Frontier biome territory zones
    const regionsList = hud.radar.regions?.length ? hud.radar.regions : WORLD_REGIONS;
    for (let i = 0; i < regionsList.length; i++) {
      const reg = regionsList[i];
      const pt = toPx(reg.x, reg.z);
      const rr = reg.radius * scale;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, rr, 0, Math.PI * 2);
      ctx.fillStyle = `${reg.colorHex}18`;
      ctx.fill();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = `${reg.colorHex}4d`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Distance rings (100m, 200m, 300m, 400m) + cardinal crosshairs
    for (const m of [100, 200, 300, 400]) {
      const r = m * scale;
      if (r < radiusPx - 4) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(212, 168, 83, 0.12)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.font = '600 9px ui-monospace, SFMono-Regular, monospace';
        ctx.fillStyle = 'rgba(212, 168, 83, 0.45)';
        ctx.textAlign = 'left';
        ctx.fillText(`${m}m`, cx + 4, cy - r + 8);
      }
    }

    ctx.beginPath();
    ctx.moveTo(cx, cy - radiusPx);
    ctx.lineTo(cx, cy + radiusPx);
    ctx.moveTo(cx - radiusPx, cy);
    ctx.lineTo(cx + radiusPx, cy);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Connecting wilderness dirt roads from central Timberhollow to villages & outposts
    const villagesList = hud.radar.villages?.length ? hud.radar.villages : VILLAGES;
    ctx.strokeStyle = 'rgba(184, 152, 98, 0.24)';
    ctx.lineWidth = Math.max(2, 4.5 * scale);
    ctx.lineCap = 'round';
    const c0 = toPx(0, -52);
    for (let i = 1; i < villagesList.length; i++) {
      const v = villagesList[i];
      const pv = toPx(v.centerX, v.centerZ);
      ctx.beginPath();
      ctx.moveTo(c0.x, c0.y);
      ctx.lineTo(pv.x, pv.y);
      ctx.stroke();
    }
    // Trailhead road south from Timberhollow
    const pSpawn = toPx(0, 12);
    ctx.beginPath();
    ctx.moveTo(c0.x, c0.y);
    ctx.lineTo(pSpawn.x, pSpawn.y);
    ctx.stroke();

    // Water ponds
    const pondsList = hud.radar.ponds?.length ? hud.radar.ponds : WATER_PONDS;
    for (let i = 0; i < pondsList.length; i++) {
      const pond = pondsList[i];
      const pt = toPx(pond.x, pond.z);
      const prx = Math.max(3.5, pond.rx * scale);
      const prz = Math.max(2.6, pond.rz * scale);
      ctx.beginPath();
      ctx.ellipse(pt.x, pt.y, prx, prz, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(42, 132, 184, 0.55)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(130, 214, 245, 0.85)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // Villages (walled enclosures)
    for (let i = 0; i < villagesList.length; i++) {
      const vil = villagesList[i];
      const tl = toPx(vil.centerX - vil.halfW, vil.centerZ - vil.halfD);
      const rw = vil.halfW * 2 * scale;
      const rh = vil.halfD * 2 * scale;
      const fHex = `#${vil.factionColorHex.toString(16).padStart(6, '0')}`;
      ctx.fillStyle = `${fHex}24`;
      ctx.fillRect(tl.x, tl.y, rw, rh);
      ctx.strokeStyle = fHex;
      ctx.lineWidth = 1.6;
      ctx.strokeRect(tl.x, tl.y, rw, rh);
    }

    // Buildings
    const blds = hud.radar.buildings;
    for (let i = 0; i < blds.length; i++) {
      const b = blds[i];
      const bp = toPx(b.x, b.z);
      const bw = Math.max(3.5, (b.kind === 'manor' ? 9.2 : b.kind === 'cabin' ? 7.6 : 6.4) * b.scale * scale);
      const bh = Math.max(3.2, (b.kind === 'manor' ? 7.6 : b.kind === 'cabin' ? 6.6 : 6.4) * b.scale * scale);
      ctx.save();
      ctx.translate(bp.x, bp.y);
      ctx.rotate(-b.rotation);
      ctx.fillStyle = b.kind === 'ruin_tower' ? 'rgba(168, 194, 152, 0.55)' : 'rgba(218, 174, 92, 0.55)';
      ctx.fillRect(-bw * 0.5, -bh * 0.5, bw, bh);
      ctx.strokeStyle = '#f2cf72';
      ctx.lineWidth = 1;
      ctx.strokeRect(-bw * 0.5, -bh * 0.5, bw, bh);
      ctx.restore();
    }

    // Obstacles
    const obs = hud.radar.obstacles;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      const op = toPx(o.x, o.z);
      ctx.beginPath();
      ctx.arc(op.x, op.y, Math.max(1.5, o.radius * scale), 0, Math.PI * 2);
      ctx.fillStyle = o.kind === 'log' ? 'rgba(148, 112, 74, 0.58)' : 'rgba(146, 156, 146, 0.45)';
      ctx.fill();
    }

    // Prey / Wildlife
    const prey = hud.radar.prey;
    for (let i = 0; i < prey.length; i++) {
      const p = prey[i];
      const pp = toPx(p.x, p.z);
      const pr = p.kind === 'elephant' ? 4.2 : p.kind === 'deer' || p.kind === 'boar' ? 3.2 : 2.3;
      ctx.beginPath();
      ctx.arc(pp.x, pp.y, pr, 0, Math.PI * 2);
      ctx.fillStyle =
        p.kind === 'elephant'
          ? '#cbd5e1'
          : p.kind === 'deer'
            ? '#f59e0b'
            : p.kind === 'boar'
              ? '#b45309'
              : p.kind === 'rabbit'
                ? '#f4a261'
                : p.kind === 'frog'
                  ? '#5fe378'
                  : p.kind === 'berry'
                    ? '#ef4444'
                    : '#f2cf72';
      ctx.fill();
      ctx.strokeStyle = '#080e0a';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    // Laid Eggs
    const eggs = hud.radar.laidEggs;
    ctx.strokeStyle = '#f7dc7a';
    ctx.lineWidth = 1.6;
    for (let i = 0; i < eggs.length; i++) {
      const ep = toPx(eggs[i].x, eggs[i].z);
      ctx.beginPath();
      ctx.arc(ep.x, ep.y, 3.2, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Villagers (Civilians vs Armed Hunters)
    const vils = hud.radar.villagers;
    for (let i = 0; i < vils.length; i++) {
      const v = vils[i];
      if (v.state === 'ko') continue;
      const vp = toPx(v.x, v.z);
      const armed = v.role === 'spearman' || v.role === 'crossbow';
      ctx.beginPath();
      ctx.arc(vp.x, vp.y, armed ? 3.5 : 2.6, 0, Math.PI * 2);
      ctx.fillStyle = armed ? '#ef4444' : v.role === 'hide' ? '#a78bfa' : '#38bdf8';
      ctx.fill();
      ctx.strokeStyle = '#080e0a';
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }

    // Baby Snakes (Hatchlings)
    const hatch = hud.radar.hatchlings;
    for (let i = 0; i < hatch.length; i++) {
      const hp = toPx(hatch[i].x, hatch[i].z);
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = '#8ef576';
      ctx.fill();
      ctx.strokeStyle = '#080e0a';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Player Slither Trail
    const trail = hud.radar.playerTrail;
    if (trail && trail.length > 1) {
      ctx.beginPath();
      for (let i = 0; i < trail.length; i++) {
        const tp = toPx(trail[i].x, trail[i].z);
        if (i === 0) ctx.moveTo(tp.x, tp.y);
        else ctx.lineTo(tp.x, tp.y);
      }
      ctx.strokeStyle = 'rgba(136, 224, 153, 0.72)';
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    // Selected Directory Highlight Reticle
    if (selectedLocId) {
      const sel = directory.find((d) => d.id === selectedLocId);
      if (sel) {
        const sp = toPx(sel.x, sel.z);
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 13, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffd86b';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 18, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 216, 107, 0.42)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    // Clear Text Labels Layer (Regions -> Ponds -> Outposts -> Villages -> Player)
    const compactMap = radiusPx < 190;
    const ultraCompact = radiusPx < 155;
    const regionFontSize = ultraCompact ? 6.8 : compactMap ? 7.8 : 9.5;
    const pondRegions = new Set(['misty_pine_basin', 'sunlit_savanna', 'emerald_marsh']);
    for (let i = 0; i < regionsList.length; i++) {
      const reg = regionsList[i];
      const pull = ultraCompact ? 0.93 : 0.94;
      const rp = toPx(reg.x * pull, reg.z * pull);
      const yShift = !compactMap && pondRegions.has(reg.id) ? 13 : 0;
      drawHaloText(
        reg.name.toUpperCase(),
        rp.x,
        rp.y + yShift,
        '#d7e6d1',
        `700 ${regionFontSize}px system-ui, sans-serif`,
      );
    }

    if (!compactMap) {
      for (let i = 0; i < pondsList.length; i++) {
        const pond = pondsList[i];
        if (pond.id === 'south_gate_puddle') continue; // keep center near Timberhollow uncluttered
        const pp = toPx(pond.x, pond.z);
        drawHaloText(
          pond.name,
          pp.x,
          pp.y - Math.max(10, pond.rz * scale + 7),
          '#8be0ff',
          '600 9px system-ui, sans-serif',
        );
      }
    }

    if (!ultraCompact) {
      for (let i = 0; i < blds.length; i++) {
        const b = blds[i];
        if (b.name === 'Mossy Forest Temple' || b.name === 'Deepwood Ranger Cabin') {
          const bp = toPx(b.x, b.z);
          const isRanger = b.name === 'Deepwood Ranger Cabin';
          const label = compactMap ? (isRanger ? 'Ranger Cabin' : 'Forest Temple') : b.name;
          drawHaloText(
            label,
            isRanger ? bp.x + 2 : bp.x - 2,
            bp.y + (compactMap ? 9 : 11),
            '#f2d382',
            `700 ${compactMap ? 7.5 : 9.5}px system-ui, sans-serif`,
            isRanger ? 'right' : 'left',
          );
        }
      }
    }

    for (let i = 0; i < villagesList.length; i++) {
      const vil = villagesList[i];
      const vp = toPx(vil.centerX, vil.centerZ);
      drawHaloText(
        vil.name,
        vp.x,
        vp.y - vil.halfD * scale - (compactMap ? 6 : 8),
        '#fff5d6',
        `800 ${compactMap ? 8.5 : 11.5}px system-ui, sans-serif`,
      );
    }

    // Player Head Marker + "YOU"
    const hp = toPx(hud.radar.headX, hud.radar.headZ);
    ctx.beginPath();
    ctx.arc(hp.x, hp.y, 9, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.fill();

    ctx.save();
    ctx.translate(hp.x, hp.y);
    ctx.rotate(-hud.radar.heading + Math.PI);
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 5);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#080e0a';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();

    drawHaloText('YOU', hp.x, hp.y + 13, '#ffffff', '800 9.5px system-ui, sans-serif');

    ctx.restore(); // end circular clip

    // Outer World Border Ring & Compass Rose
    ctx.beginPath();
    ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(212, 168, 83, 0.72)';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    drawHaloText('N', cx, cy - radiusPx - 9, '#f2cf72', '800 11px system-ui, sans-serif');
    drawHaloText('S', cx, cy + radiusPx + 10, '#c8d6c2', '700 10px system-ui, sans-serif');
    drawHaloText('W', cx - radiusPx - 10, cy, '#c8d6c2', '700 10px system-ui, sans-serif');
    drawHaloText('E', cx + radiusPx + 10, cy, '#c8d6c2', '700 10px system-ui, sans-serif');

    ctx.restore();
  }, [open, hud, canvasBox, selectedLocId, directory]);

  if (!open) return null;

  const arenaR = hud.radar.arenaRadius || ARENA_RADIUS;

  return (
    <div
      data-testid="world-map-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Full Wilderness World Map"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-40 flex items-center justify-center p-2 sm:p-4"
      style={{ backgroundColor: 'rgba(6, 10, 8, 0.90)' }}
    >
      <div
        className="flex h-full max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border md:flex-row"
        style={{
          backgroundColor: '#0c140e',
          borderColor: 'rgba(212, 168, 83, 0.5)',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.78)',
        }}
      >
        {/* LEFT / MAIN CANVAS COLUMN */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-[#d4a853]/25 bg-[#09100b] px-4 py-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold tracking-[0.2em] text-[#d4a853] uppercase">
                  World Atlas · {arenaR * 2}m Valley
                </span>
                <span className="hidden text-white/25 sm:inline">|</span>
                <span className="hidden font-mono-num text-[11px] text-[#9eb198] sm:inline">
                  Pos ({Math.round(hud.radar.headX)}m, {Math.round(hud.radar.headZ)}m)
                </span>
              </div>
              <h2 className="truncate text-sm font-extrabold text-[#f5efe0] sm:text-base">
                {hud.locationLabel}
              </h2>
            </div>

            <button
              type="button"
              data-testid="btn-close-world-map"
              onClick={onClose}
              className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-[#d4a853]/45 bg-[#162219] px-3 py-1.5 text-xs font-bold tracking-wider text-[#f5efe0] uppercase transition-colors hover:border-[#f2cf72] hover:bg-[#1f3023]"
            >
              <span>Close</span>
              <span className="hidden text-[10px] text-[#d4a853] sm:inline">[Esc]</span>
            </button>
          </div>

          <div
            ref={containerRef}
            className="relative min-h-[220px] flex-1 overflow-hidden bg-[#080e0a]"
          >
            <canvas
              ref={canvasRef}
              data-testid="world-map-canvas"
              className="absolute inset-0 block h-full w-full"
            />
          </div>
        </div>

        {/* RIGHT / BOTTOM DIRECTORY & LEGEND SIDEBAR */}
        <div
          className={`flex shrink-0 flex-col border-t border-[#d4a853]/25 bg-[#09100b] md:border-t-0 md:border-l ${
            isMobileLayout ? 'max-h-[34dvh] w-full md:max-h-full md:w-64' : 'max-h-[36dvh] w-full md:max-h-full md:w-76'
          }`}
        >
          <div className="border-b border-[#d4a853]/20 px-3.5 py-2">
            <div className="text-[10px] font-bold tracking-[0.18em] text-[#d4a853] uppercase">
              Locations Directory ({directory.length})
            </div>
            <div className="text-[11px] text-[#8fa189]">
              Tap any landmark to highlight on map
            </div>
          </div>

          <div
            className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2.5 py-2"
            style={{ touchAction: 'pan-y' }}
          >
            {directory.map((loc) => {
              const selected = selectedLocId === loc.id;
              const dx = loc.x - hud.radar.headX;
              const dz = loc.z - hud.radar.headZ;
              return (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => setSelectedLocId(selected ? null : loc.id)}
                  className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors"
                  style={{
                    backgroundColor: selected ? 'rgba(212, 168, 83, 0.16)' : 'rgba(14, 22, 16, 0.85)',
                    borderColor: selected ? '#f2cf72' : 'rgba(212, 168, 83, 0.18)',
                  }}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/60"
                      style={{ backgroundColor: loc.accent }}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-xs font-bold text-[#f4eee0]">{loc.name}</div>
                      <div className="truncate text-[10px] text-[#8fa189]">{loc.subtitle}</div>
                    </div>
                  </div>
                  <span className="shrink-0 font-mono-num text-[10px] font-semibold text-[#e6c97a]">
                    {compassBearing(dx, dz)}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Compact Map Legend */}
          <div className="border-t border-[#d4a853]/25 bg-[#070c08] px-3 py-2">
            <div className="grid grid-cols-3 gap-x-2 gap-y-1 text-[10px] font-semibold text-[#bfd0b9]">
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-white" />
                <span>You</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#8ef576]" />
                <span>Brood</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full border border-[#f7dc7a]" />
                <span>Eggs</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#ef4444]" />
                <span>Hunters</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#38bdf8]" />
                <span>Humans</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#f59e0b]" />
                <span>Wildlife</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
