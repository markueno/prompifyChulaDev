import { useRef } from 'react';
import type { FillBlanksTemplate } from '~/lib/questionnaire/types';

interface FillBlanksProps {
  template: FillBlanksTemplate | undefined;
  onContinue: (sentence: string) => void;
}

export function FillBlanks({ template, onContinue }: FillBlanksProps) {
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  function buildSentence(): string {
    if (!template) return 'My app is something unique and specific.';
    let sentence = '';
    template.parts.forEach((part, i) => {
      sentence += part;
      if (i < template.blanks.length) {
        const blank = template.blanks[i];
        const el = inputRefs.current[blank.id];
        const val = el?.value.trim() || blank.options[0] || '___';
        sentence += val;
      }
    });
    return sentence.trim();
  }

  if (!template) {
    return (
      <div className="space-y-4">
        <p className="text-bolt-elements-textSecondary text-sm">My app is something unique and specific.</p>
        <button
          onClick={() => onContinue('My app is something unique and specific.')}
          className="px-5 py-2.5 rounded-xl bg-accent-500 text-white text-sm font-semibold hover:bg-accent-600 transition-colors"
        >
          Get my prompt →
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-base leading-loose text-bolt-elements-textPrimary bg-bolt-elements-bg-depth-2 rounded-xl p-4 border border-bolt-elements-borderColor">
        {template.parts.map((part, i) => (
          <span key={i}>
            <span>{part}</span>
            {i < template.blanks.length && (
              <span className="inline-block mx-1 relative">
                <input
                  ref={(el) => { inputRefs.current[template.blanks[i].id] = el; }}
                  type="text"
                  defaultValue={template.blanks[i].options[0] ?? ''}
                  list={`list-${template.blanks[i].id}`}
                  autoComplete="off"
                  spellCheck={false}
                  className="border-b-2 border-accent-500 bg-transparent text-accent-600 font-semibold focus:outline-none px-1 min-w-24 text-base"
                  style={{ width: `${Math.max(template.blanks[i].options[0]?.length ?? 8, 8) + 2}ch` }}
                />
                <datalist id={`list-${template.blanks[i].id}`}>
                  {template.blanks[i].options.map((opt) => (
                    <option key={opt} value={opt} />
                  ))}
                </datalist>
              </span>
            )}
          </span>
        ))}
      </div>

      <button
        onClick={() => onContinue(buildSentence())}
        className="px-5 py-2.5 rounded-xl bg-accent-500 text-white text-sm font-semibold hover:bg-accent-600 transition-colors"
      >
        Get my prompt →
      </button>
    </div>
  );
}
