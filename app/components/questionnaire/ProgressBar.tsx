interface ProgressBarProps {
  answered: number;
  total: number;
  phase: 'primary' | 'secondary';
}

export function ProgressBar({ answered, total, phase }: ProgressBarProps) {
  const pct = total > 0 ? Math.round((answered / total) * 100) : 0;
  const label = phase === 'primary' ? 'Essential questions' : 'Technical details';

  return (
    <div className="w-full px-6 py-3">
      <div className="h-1 w-full rounded-full bg-bolt-elements-bg-depth-3 overflow-hidden">
        <div
          className="h-full rounded-full bg-accent-500 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between mt-1.5">
        <span className="text-xs text-bolt-elements-textTertiary">
          {answered} of {total} questions
        </span>
        <span className="text-xs text-bolt-elements-textTertiary">{label}</span>
      </div>
    </div>
  );
}
