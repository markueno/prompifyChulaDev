import { useState } from 'react';

interface PromptBlockProps {
  label: string;
  prompt: string;
}

function PromptBlock({ label, prompt }: PromptBlockProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback for environments without clipboard API
    }
  }

  return (
    <div className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-bg-depth-2 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-bolt-elements-borderColor bg-bolt-elements-bg-depth-3">
        <span className="text-xs font-semibold text-bolt-elements-textSecondary uppercase tracking-wide">{label}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary transition-colors"
        >
          {copied ? (
            <>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M2 6L5 9L10 3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <rect x="4" y="4" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                <path
                  d="M8 4V2.5A1.5 1.5 0 006.5 1H2.5A1.5 1.5 0 001 2.5V6.5A1.5 1.5 0 002.5 8H4"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
              Copy
            </>
          )}
        </button>
      </div>
      <pre className="px-4 py-3 text-xs text-bolt-elements-textPrimary font-mono leading-relaxed whitespace-pre-wrap overflow-y-auto max-h-64 select-all">
        {prompt}
      </pre>
    </div>
  );
}

interface PromptPreviewProps {
  primaryPrompt: string;
  refinedPrompt: string;
  onStartBuilding: () => void;
  onReset: () => void;
}

export function PromptPreview({ primaryPrompt, refinedPrompt, onStartBuilding, onReset }: PromptPreviewProps) {
  const [allCopied, setAllCopied] = useState(false);

  async function copyAll() {
    const combined = `=== PROMPT 1 — SCAFFOLD ===\n\n${primaryPrompt}\n\n\n=== PROMPT 2 — REFINE ===\n\n${refinedPrompt}`;

    try {
      await navigator.clipboard.writeText(combined);
      setAllCopied(true);
      setTimeout(() => setAllCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-accent-500/30 bg-bolt-elements-item-backgroundAccent px-4 py-3">
        <p className="text-sm font-semibold text-accent-600 mb-0.5">Your prompts are ready</p>
        <p className="text-xs text-bolt-elements-textSecondary leading-relaxed">
          Send Prompt 1 first to scaffold the app. After the AI responds, send Prompt 2 to refine and extend it.
        </p>
      </div>

      <PromptBlock label="Prompt 1 — Scaffold" prompt={primaryPrompt} />
      <PromptBlock label="Prompt 2 — Refine" prompt={refinedPrompt} />

      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={onReset}
          className="text-sm text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary underline underline-offset-2 transition-colors"
        >
          Start over
        </button>
        <button
          onClick={copyAll}
          className="ml-auto px-4 py-2 rounded-xl border border-bolt-elements-borderColor text-sm text-bolt-elements-textPrimary hover:border-accent-500 transition-colors"
        >
          {allCopied ? 'Copied both!' : 'Copy both'}
        </button>
        <button
          onClick={onStartBuilding}
          className="px-5 py-2.5 rounded-xl bg-accent-500 text-white text-sm font-semibold hover:bg-accent-600 transition-colors"
        >
          Start building →
        </button>
      </div>
    </div>
  );
}
