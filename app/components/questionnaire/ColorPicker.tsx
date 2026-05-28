import { useState } from 'react';
import type { ColorSlot, ColorsAnswer } from '~/lib/questionnaire/types';

const COLOR_PRESETS = [
  '#EF4444', '#F97316', '#F59E0B', '#EAB308',
  '#84CC16', '#22C55E', '#10B981', '#14B8A6',
  '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6',
  '#A855F7', '#EC4899', '#F43F5E', '#BE123C',
  '#111827', '#374151', '#6B7280', '#D1D5DB',
  '#FFFFFF', '#1E3A5F', '#064E3B', '#78350F',
];

interface SwatchPopupProps {
  role: string;
  onPick: (hex: string) => void;
  onClose: () => void;
}

function SwatchPopup({ role, onPick, onClose }: SwatchPopupProps) {
  const [hexInput, setHexInput] = useState('');
  const preview = hexInput.length === 6 ? `#${hexInput}` : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-bolt-elements-bg-depth-1 rounded-2xl p-5 w-80 shadow-xl border border-bolt-elements-borderColor"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-semibold text-bolt-elements-textPrimary mb-3">
          Choose color for <span className="text-accent-500">{role}</span>
        </p>

        <div className="grid grid-cols-8 gap-1.5 mb-4">
          {COLOR_PRESETS.map((hex) => (
            <button
              key={hex}
              title={hex}
              onClick={() => onPick(hex)}
              className="w-7 h-7 rounded-md border border-bolt-elements-borderColor hover:scale-110 transition-transform"
              style={{ background: hex }}
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
            onChange={(e) => setHexInput(e.target.value.replace(/[^0-9a-fA-F]/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hexInput.length === 6) onPick(`#${hexInput.toUpperCase()}`);
            }}
            className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-bg-depth-2 text-bolt-elements-textPrimary font-mono focus:outline-none focus:border-accent-500"
          />
          {preview && (
            <span
              className="w-7 h-7 rounded-md border border-bolt-elements-borderColor shrink-0"
              style={{ background: preview }}
            />
          )}
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

interface ColorPickerProps {
  slots: ColorSlot[];
  onSlotsChange: (slots: ColorSlot[]) => void;
  onContinue: (answer: ColorsAnswer) => void;
}

export function ColorPicker({ slots, onSlotsChange, onContinue }: ColorPickerProps) {
  const [activeSlot, setActiveSlot] = useState<number | null>(null);

  const roleHints: Record<string, string> = {
    Primary: 'Buttons & key actions',
    Secondary: 'Backgrounds & surfaces',
    Accent: 'Highlights & badges',
  };

  function applyColor(slotIndex: number, hex: string) {
    const updated = slots.map((s, i) => (i === slotIndex ? { ...s, hex } : s));
    onSlotsChange(updated);
    setActiveSlot(null);
  }

  function addSlot() {
    onSlotsChange([...slots, { role: `Extra ${slots.length - 2}`, hex: null }]);
  }

  function handleContinue() {
    const filled = slots.filter((s) => s.hex);
    onContinue(filled.length === 0 ? { noPreference: true, slots: [] } : { noPreference: false, slots });
  }

  const hasAny = slots.some((s) => s.hex);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        {slots.map((slot, i) => (
          <button
            key={i}
            onClick={() => setActiveSlot(i)}
            className="flex flex-col rounded-xl border border-bolt-elements-borderColor overflow-hidden hover:border-accent-500 transition-colors w-32"
          >
            <div
              className="h-20 w-full flex items-center justify-center"
              style={{ background: slot.hex ?? '#f5f5f5' }}
            >
              {!slot.hex && (
                <span className="text-2xl text-bolt-elements-textTertiary">+</span>
              )}
            </div>
            <div className="px-2 py-1.5 bg-bolt-elements-bg-depth-2 text-left">
              <p className="text-xs font-semibold text-bolt-elements-textPrimary">{slot.role}</p>
              {slot.hex ? (
                <p className="text-[11px] font-mono text-bolt-elements-textSecondary">{slot.hex}</p>
              ) : (
                <p className="text-[11px] text-bolt-elements-textTertiary">{roleHints[slot.role] ?? 'Click to choose'}</p>
              )}
            </div>
          </button>
        ))}

        <button
          onClick={addSlot}
          className="flex flex-col items-center justify-center w-32 h-32 rounded-xl border border-dashed border-bolt-elements-borderColor hover:border-accent-500 text-bolt-elements-textTertiary hover:text-accent-500 transition-colors"
        >
          <span className="text-2xl">+</span>
          <span className="text-xs mt-1">Add color</span>
        </button>
      </div>

      <div className="flex items-center gap-3 pt-2">
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

      {activeSlot !== null && (
        <SwatchPopup
          role={slots[activeSlot]?.role ?? 'Color'}
          onPick={(hex) => applyColor(activeSlot, hex)}
          onClose={() => setActiveSlot(null)}
        />
      )}
    </div>
  );
}
