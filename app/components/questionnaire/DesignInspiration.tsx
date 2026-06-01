import { useState } from 'react';
import type { Brand, DesignInspirationAnswer } from '~/lib/questionnaire/types';
import { getDesignSystem } from '~/lib/questionnaire/design-refs';

interface DesignInspirationProps {
  brands: Brand[];
  maxSelect: number;
  initialSelected?: string[];
  onContinue: (answer: DesignInspirationAnswer) => void;
}

export function DesignInspiration({ brands, maxSelect, initialSelected = [], onContinue }: DesignInspirationProps) {
  const [selected, setSelected] = useState<string[]>(initialSelected);

  function toggle(id: string) {
    setSelected(prev => {
      if (prev.includes(id)) {
        return prev.filter(b => b !== id);
      }

      if (prev.length >= maxSelect) {
        return [...prev.slice(1), id];
      }

      return [...prev, id];
    });
  }

  function handleContinue() {
    const content: Record<string, string> = {};

    for (const id of selected) {
      const md = getDesignSystem(id);

      if (md) {
        content[id] = md;
      }
    }
    onContinue({ brands: selected, content });
  }

  function handleSkip() {
    onContinue({ brands: [], content: {} });
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-bolt-elements-textTertiary">
        Pick up to {maxSelect} — the AI will mirror that visual style throughout your app.
      </p>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {brands.map(brand => {
          const isSelected = selected.includes(brand.id);
          return (
            <button
              key={brand.id}
              onClick={() => toggle(brand.id)}
              className={[
                'text-left rounded-xl border p-3.5 transition-all duration-150',
                'hover:border-accent-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500',
                isSelected
                  ? 'border-accent-500 bg-bolt-elements-item-backgroundAccent'
                  : 'border-bolt-elements-borderColor bg-bolt-elements-bg-depth-2 hover:bg-bolt-elements-item-backgroundActive',
              ].join(' ')}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                {brand.icon && (
                  <img
                    src={brand.icon}
                    alt={brand.label}
                    className="w-7 h-7 object-contain shrink-0"
                    draggable={false}
                  />
                )}
                {isSelected && (
                  <span className="ml-auto shrink-0 w-4 h-4 rounded-full bg-accent-500 flex items-center justify-center">
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                      <path
                        d="M1.5 4L3.5 6L6.5 2"
                        stroke="white"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                )}
              </div>
              <p
                className={`font-semibold text-sm leading-snug ${isSelected ? 'text-accent-600' : 'text-bolt-elements-textPrimary'}`}
              >
                {brand.label}
              </p>
              <p className="text-xs text-bolt-elements-textSecondary mt-1 leading-relaxed">{brand.tagline}</p>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={handleSkip}
          className="text-sm text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary underline underline-offset-2 transition-colors"
        >
          Skip — no preference
        </button>
        <button
          onClick={handleContinue}
          className="ml-auto px-5 py-2.5 rounded-xl bg-accent-500 text-white text-sm font-semibold hover:bg-accent-600 transition-colors"
        >
          {selected.length > 0
            ? `Use ${selected.length === 1 ? '1 brand' : `${selected.length} brands`} →`
            : 'Continue →'}
        </button>
      </div>
    </div>
  );
}
