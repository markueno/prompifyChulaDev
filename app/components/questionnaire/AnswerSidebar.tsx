import type { Answers, ColorsAnswer, Question } from '~/lib/questionnaire/types';

interface AnswerSidebarProps {
  questions: Question[];
  answers: Answers;
  phase: 'primary' | 'secondary';
  onEdit: (index: number) => void;
}

function getAnswerDisplay(q: Question, answers: Answers): { text: string; colorSlots?: Array<{ hex: string; role: string }> } | null {
  const ans = answers[q.id];
  if (ans === undefined || ans === null) return null;

  if (q.type === 'color') {
    const c = ans as ColorsAnswer;
    if (c.noPreference) return { text: 'No preference' };
    const filled = (c.slots ?? []).filter((s) => s.hex);
    if (filled.length === 0) return { text: 'No preference' };
    return { text: filled.map((s) => s.hex).join(', '), colorSlots: filled as Array<{ hex: string; role: string }> };
  }

  if (q.type === 'fillblanks') {
    const text = ans as string;
    return { text: text.length > 50 ? text.slice(0, 47) + '…' : text };
  }

  if (q.type === 'designInspiration') {
    const d = ans as { brands: string[] };
    if (!d.brands?.length) return null;
    return { text: d.brands.map((b) => b.charAt(0).toUpperCase() + b.slice(1)).join(', ') };
  }

  if (q.type === 'text') {
    const text = ans as string;
    if (!text) return null;
    return { text: text.length > 50 ? text.slice(0, 47) + '…' : text };
  }

  const opt = q.options?.find((o) => o.id === ans);
  return opt ? { text: opt.label } : null;
}

export function AnswerSidebar({ questions, answers, phase, onEdit }: AnswerSidebarProps) {
  const answered = questions.filter((q, i) => {
    const ans = answers[q.id];
    return ans !== undefined && ans !== null;
  });

  return (
    <aside className="w-64 shrink-0 border-l border-bolt-elements-borderColor bg-bolt-elements-bg-depth-2 flex flex-col">
      <div className="px-4 py-3 border-b border-bolt-elements-borderColor">
        <p className="text-xs font-semibold text-bolt-elements-textSecondary uppercase tracking-wide">
          Your choices
        </p>
        <p className="text-xs text-bolt-elements-textTertiary mt-0.5">
          {phase === 'primary' ? 'Part 1' : 'Part 2'}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {answered.length === 0 ? (
          <p className="px-4 py-3 text-xs text-bolt-elements-textTertiary italic">
            Answer the questions to see your choices here…
          </p>
        ) : (
          answered.map((q, _) => {
            const display = getAnswerDisplay(q, answers);
            if (!display) return null;
            const idx = questions.indexOf(q);

            return (
              <button
                key={q.id}
                onClick={() => onEdit(idx)}
                className="w-full text-left px-4 py-2.5 hover:bg-bolt-elements-item-backgroundActive group transition-colors"
              >
                <p className="text-xs text-bolt-elements-textTertiary mb-0.5">{q.label}</p>

                {display.colorSlots ? (
                  <div className="flex items-center gap-1.5 mt-1">
                    {display.colorSlots.map((s) => (
                      <span
                        key={s.role}
                        title={`${s.role}: ${s.hex}`}
                        className="w-4 h-4 rounded-full border border-bolt-elements-borderColor shrink-0"
                        style={{ background: s.hex }}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs font-medium text-bolt-elements-textPrimary">{display.text}</p>
                )}

                <p className="text-[10px] text-bolt-elements-textTertiary opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
                  edit
                </p>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
