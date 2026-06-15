import { useState } from 'react';
import type { ColorSlot, ColorsAnswer } from '~/lib/questionnaire/types';

// ─── Color math ───────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  h /= 360; s /= 100; l /= 100;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function generateShades(hex: string): string[] {
  const [r, g, b] = hexToRgb(hex);
  const [h, s] = rgbToHsl(r, g, b);
  // 9 shades: 50 → 900
  const lightnesses = [96, 91, 82, 70, 58, 46, 36, 26, 16];
  return lightnesses.map(l => hslToHex(h, Math.min(s, 88), l));
}

const SHADE_LABELS = ['50', '100', '200', '300', '400', '500', '600', '700', '800'];

// ─── Quick palettes ───────────────────────────────────────────────────────────

const QUICK_PALETTES = [
  { name: 'Warm',    primary: '#F97316', secondary: '#FED7AA', accent: '#C2410C' },
  { name: 'Ocean',   primary: '#0EA5E9', secondary: '#BAE6FD', accent: '#0369A1' },
  { name: 'Forest',  primary: '#22C55E', secondary: '#BBF7D0', accent: '#15803D' },
  { name: 'Violet',  primary: '#8B5CF6', secondary: '#EDE9FE', accent: '#6D28D9' },
  { name: 'Rose',    primary: '#F43F5E', secondary: '#FFE4E6', accent: '#BE123C' },
  { name: 'Slate',   primary: '#6366F1', secondary: '#E0E7FF', accent: '#3730A3' },
];

// ─── Color role meta ──────────────────────────────────────────────────────────

const ROLE_META: Record<string, { label: string; description: string; example: string }> = {
  Primary: {
    label: 'Primary — Main brand color',
    description: 'The dominant color users see most. Used for CTA buttons, active navigation, links, and all key interactive elements.',
    example: 'e.g. "Sign Up" button, active tab, progress bar',
  },
  Secondary: {
    label: 'Secondary — Supporting surface',
    description: 'A softer supporting color for backgrounds, cards, input fields, hover states, and secondary buttons.',
    example: 'e.g. card background, sidebar, hover state',
  },
  Accent: {
    label: 'Accent — Pop & highlight',
    description: 'A contrasting "pop" color for drawing attention to small elements: badges, tags, notifications, and callouts.',
    example: 'e.g. "New" badge, error alert, notification dot',
  },
};

// ─── Swatch Popup ─────────────────────────────────────────────────────────────

const COLOR_PRESETS = [
  '#EF4444','#F97316','#F59E0B','#EAB308','#84CC16','#22C55E',
  '#10B981','#14B8A6','#06B6D4','#3B82F6','#6366F1','#8B5CF6',
  '#A855F7','#EC4899','#F43F5E','#BE123C','#111827','#374151',
  '#6B7280','#D1D5DB','#1E3A5F','#064E3B','#78350F','#FFFFFF',
];

function SwatchPopup({ role, currentHex, onPick, onClose }: {
  role: string; currentHex: string | null; onPick: (hex: string) => void; onClose: () => void;
}) {
  const [hexInput, setHexInput] = useState(currentHex?.replace('#', '') ?? '');
  const preview = hexInput.length === 6 ? `#${hexInput}` : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-bolt-elements-bg-depth-1 rounded-2xl p-5 w-80 shadow-2xl border border-bolt-elements-borderColor"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold text-bolt-elements-textPrimary">
            Pick color for <span className="text-accent-500">{role}</span>
          </p>
          <button onClick={onClose} className="text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary text-lg leading-none">×</button>
        </div>

        <div className="grid grid-cols-8 gap-1.5 mb-4">
          {COLOR_PRESETS.map(hex => (
            <button
              key={hex}
              title={hex}
              onClick={() => onPick(hex)}
              className="w-7 h-7 rounded-md border-2 hover:scale-110 transition-transform"
              style={{
                background: hex,
                borderColor: currentHex === hex ? '#000' : 'transparent',
                outline: currentHex === hex ? '2px solid white' : 'none',
              }}
            />
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-bolt-elements-textSecondary font-mono">#</span>
          <input
            type="text"
            maxLength={6}
            placeholder="e.g. 3B82F6"
            value={hexInput}
            onChange={e => setHexInput(e.target.value.replace(/[^0-9a-fA-F]/g, ''))}
            onKeyDown={e => { if (e.key === 'Enter' && hexInput.length === 6) onPick(`#${hexInput.toUpperCase()}`); }}
            className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-bg-depth-2 text-bolt-elements-textPrimary font-mono focus:outline-none focus:border-accent-500"
          />
          {preview && <span className="w-7 h-7 rounded-md border border-bolt-elements-borderColor shrink-0" style={{ background: preview }} />}
          <button
            onClick={() => hexInput.length === 6 && onPick(`#${hexInput.toUpperCase()}`)}
            disabled={hexInput.length !== 6}
            className="px-3 py-1.5 text-sm rounded-lg bg-accent-500 text-white disabled:opacity-40 hover:bg-accent-600 transition-colors"
          >
            Use
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Mini Preview ─────────────────────────────────────────────────────────────

function MiniPreview({ primary, secondary, accent }: { primary: string; secondary: string; accent: string }) {
  const fallbackPrimary = primary || '#6366F1';
  const fallbackSecondary = secondary || '#E0E7FF';
  const fallbackAccent = accent || '#3730A3';

  return (
    <div
      className="rounded-xl overflow-hidden border border-bolt-elements-borderColor text-[11px] select-none"
      style={{ minWidth: 160 }}
    >
      {/* Mini navbar */}
      <div className="px-3 py-2 flex items-center justify-between" style={{ background: fallbackPrimary }}>
        <span className="font-bold text-white tracking-wide" style={{ fontSize: 10 }}>MyApp</span>
        <div className="w-4 h-4 rounded-full bg-white/30" />
      </div>

      {/* Body */}
      <div className="p-3 space-y-2" style={{ background: fallbackSecondary }}>
        {/* Card */}
        <div className="rounded-lg p-2 bg-white/70 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-gray-800" style={{ fontSize: 10 }}>Dashboard</span>
            <span
              className="px-1.5 py-0.5 rounded-full text-white font-bold leading-none"
              style={{ background: fallbackAccent, fontSize: 8 }}
            >
              NEW
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-200" >
            <div className="h-full rounded-full w-2/3" style={{ background: fallbackPrimary }} />
          </div>
          <div className="h-1 rounded bg-gray-100 w-4/5" />
        </div>

        {/* Button row */}
        <div className="flex gap-1.5">
          <button
            className="flex-1 rounded-md py-1.5 text-white font-semibold"
            style={{ background: fallbackPrimary, fontSize: 9 }}
          >
            Get Started
          </button>
          <button
            className="px-2 rounded-md border font-medium"
            style={{ borderColor: fallbackPrimary, color: fallbackPrimary, fontSize: 9 }}
          >
            More
          </button>
        </div>

        {/* Tags */}
        <div className="flex gap-1 flex-wrap">
          {['Active', 'Pending'].map((tag, i) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 rounded-full text-white"
              style={{ background: i === 0 ? fallbackAccent : fallbackPrimary + 'cc', fontSize: 8 }}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Role Row ─────────────────────────────────────────────────────────────────

function ColorRoleRow({
  slot, onEdit, onPickShade,
}: {
  slot: ColorSlot;
  onEdit: () => void;
  onPickShade: (hex: string) => void;
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const meta = ROLE_META[slot.role];
  const shades = slot.hex ? generateShades(slot.hex) : null;

  return (
    <div className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-bg-depth-1 p-4 space-y-3">
      {/* Role header */}
      <div className="flex items-center gap-2">
        <button
          className="w-8 h-8 rounded-lg border-2 border-bolt-elements-borderColor shrink-0 transition-transform hover:scale-105"
          style={{ background: slot.hex ?? '#e5e7eb' }}
          onClick={onEdit}
          title="Change color"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-bolt-elements-textPrimary">{slot.role}</span>
            {meta && (
              <div className="relative">
                <button
                  className="w-4 h-4 rounded-full bg-bolt-elements-bg-depth-3 text-bolt-elements-textTertiary text-[10px] font-bold flex items-center justify-center hover:bg-bolt-elements-bg-depth-4 transition-colors"
                  onMouseEnter={() => setShowTooltip(true)}
                  onMouseLeave={() => setShowTooltip(false)}
                >
                  ?
                </button>
                {showTooltip && (
                  <div className="absolute left-5 top-0 z-30 w-56 rounded-xl bg-bolt-elements-bg-depth-3 border border-bolt-elements-borderColor p-3 shadow-xl text-left">
                    <p className="text-xs font-semibold text-bolt-elements-textPrimary mb-1">{meta.label}</p>
                    <p className="text-[11px] text-bolt-elements-textSecondary mb-1">{meta.description}</p>
                    <p className="text-[10px] text-bolt-elements-textTertiary italic">{meta.example}</p>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-bolt-elements-textSecondary">
              {slot.hex ?? 'not set'}
            </span>
            <button
              onClick={onEdit}
              className="text-[10px] text-accent-500 hover:text-accent-600 underline underline-offset-1 transition-colors"
            >
              edit
            </button>
          </div>
        </div>
      </div>

      {/* Shade scale */}
      {shades ? (
        <div className="space-y-1">
          <p className="text-[10px] text-bolt-elements-textTertiary font-medium tracking-wide uppercase">Shade scale — click to use</p>
          <div className="flex gap-1">
            {shades.map((shade, idx) => (
              <div key={idx} className="flex flex-col items-center gap-0.5 flex-1">
                <button
                  title={`${SHADE_LABELS[idx]} — ${shade}`}
                  onClick={() => onPickShade(shade)}
                  className="w-full rounded-md transition-transform hover:scale-110 hover:z-10 hover:shadow-md border border-transparent"
                  style={{
                    height: 24,
                    background: shade,
                    borderColor: shade === slot.hex ? '#000' : 'transparent',
                    outline: shade === slot.hex ? '2px solid rgba(0,0,0,0.3)' : 'none',
                  }}
                />
                <span className="text-[8px] text-bolt-elements-textTertiary leading-none">{SHADE_LABELS[idx]}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <button
          onClick={onEdit}
          className="w-full rounded-lg border border-dashed border-bolt-elements-borderColor py-3 text-xs text-bolt-elements-textTertiary hover:border-accent-500 hover:text-accent-500 transition-colors"
        >
          + Click to choose a color
        </button>
      )}
    </div>
  );
}

// ─── Main ColorPicker ─────────────────────────────────────────────────────────

interface ColorPickerProps {
  slots: ColorSlot[];
  onSlotsChange: (slots: ColorSlot[]) => void;
  onContinue: (answer: ColorsAnswer) => void;
}

export function ColorPicker({ slots, onSlotsChange, onContinue }: ColorPickerProps) {
  const [activeSlot, setActiveSlot] = useState<number | null>(null);

  const primary   = slots.find(s => s.role === 'Primary')?.hex ?? '';
  const secondary = slots.find(s => s.role === 'Secondary')?.hex ?? '';
  const accent    = slots.find(s => s.role === 'Accent')?.hex ?? '';

  function applyColor(slotIndex: number, hex: string) {
    onSlotsChange(slots.map((s, i) => (i === slotIndex ? { ...s, hex } : s)));
    setActiveSlot(null);
  }

  function applyPalette(p: typeof QUICK_PALETTES[0]) {
    onSlotsChange(slots.map(s => {
      if (s.role === 'Primary') return { ...s, hex: p.primary };
      if (s.role === 'Secondary') return { ...s, hex: p.secondary };
      if (s.role === 'Accent') return { ...s, hex: p.accent };
      return s;
    }));
  }

  function handleContinue() {
    const filled = slots.filter(s => s.hex);
    onContinue(filled.length === 0 ? { noPreference: true, slots: [] } : { noPreference: false, slots });
  }

  const hasAny = slots.some(s => s.hex);

  return (
    <div className="space-y-5">

      {/* Quick palettes */}
      <div>
        <p className="text-xs font-semibold text-bolt-elements-textTertiary uppercase tracking-wide mb-2">Quick palettes</p>
        <div className="flex flex-wrap gap-2">
          {QUICK_PALETTES.map(p => (
            <button
              key={p.name}
              onClick={() => applyPalette(p)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-bolt-elements-borderColor hover:border-accent-500 bg-bolt-elements-bg-depth-2 transition-colors group"
            >
              {/* Three color dots */}
              <span className="flex gap-0.5">
                {[p.primary, p.secondary, p.accent].map((c, i) => (
                  <span key={i} className="w-3 h-3 rounded-full border border-black/10" style={{ background: c }} />
                ))}
              </span>
              <span className="text-xs font-medium text-bolt-elements-textSecondary group-hover:text-bolt-elements-textPrimary transition-colors">
                {p.name}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Main area: roles + preview */}
      <div className="flex gap-4 items-start">

        {/* Color role rows */}
        <div className="flex-1 space-y-3 min-w-0">
          {slots.map((slot, i) => (
            <ColorRoleRow
              key={i}
              slot={slot}
              onEdit={() => setActiveSlot(i)}
              onPickShade={hex => applyColor(i, hex)}
            />
          ))}
        </div>

        {/* Live preview */}
        <div className="shrink-0 hidden sm:block">
          <p className="text-[10px] font-semibold text-bolt-elements-textTertiary uppercase tracking-wide mb-2 text-center">Preview</p>
          <MiniPreview primary={primary} secondary={secondary} accent={accent} />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={() => onContinue({ noPreference: true, slots: [] })}
          className="text-sm text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary underline underline-offset-2 transition-colors"
        >
          No preference — let the AI decide
        </button>
        <button
          onClick={handleContinue}
          className="ml-auto px-5 py-2.5 rounded-xl bg-accent-500 text-white text-sm font-semibold hover:bg-accent-600 transition-colors"
        >
          {hasAny ? 'Use these colors →' : 'Continue →'}
        </button>
      </div>

      {/* Popup */}
      {activeSlot !== null && (
        <SwatchPopup
          role={slots[activeSlot]?.role ?? 'Color'}
          currentHex={slots[activeSlot]?.hex ?? null}
          onPick={hex => applyColor(activeSlot, hex)}
          onClose={() => setActiveSlot(null)}
        />
      )}
    </div>
  );
}
