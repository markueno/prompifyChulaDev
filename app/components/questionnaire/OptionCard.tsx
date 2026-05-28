import type { Option } from '~/lib/questionnaire/types';

interface OptionCardProps {
  option: Option;
  selected: boolean;
  onSelect: () => void;
}

export function OptionCard({ option, selected, onSelect }: OptionCardProps) {
  return (
    <button
      onClick={onSelect}
      className={[
        'w-full text-left rounded-xl border p-4 transition-all duration-150',
        'hover:border-accent-500 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500',
        selected
          ? 'border-accent-500 bg-bolt-elements-item-backgroundAccent'
          : 'border-bolt-elements-borderColor bg-bolt-elements-bg-depth-2 hover:bg-bolt-elements-item-backgroundActive',
      ].join(' ')}
    >
      <p className={`font-semibold text-sm leading-snug ${selected ? 'text-accent-600' : 'text-bolt-elements-textPrimary'}`}>
        {option.label}
      </p>
      <p className="text-xs text-bolt-elements-textSecondary mt-1 leading-relaxed">
        {option.description}
      </p>
    </button>
  );
}

interface OptionGridProps {
  options: Option[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}

export function OptionGrid({ options, selectedId, onSelect }: OptionGridProps) {
  const cols =
    options.length <= 2
      ? 'grid-cols-2'
      : options.length === 3
        ? 'grid-cols-3'
        : 'grid-cols-2';

  return (
    <div className={`grid ${cols} gap-3`}>
      {options.map((opt) => (
        <OptionCard
          key={opt.id}
          option={opt}
          selected={selectedId === opt.id}
          onSelect={() => onSelect(opt.id)}
        />
      ))}
    </div>
  );
}
