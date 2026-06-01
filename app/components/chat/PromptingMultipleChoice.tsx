import { useState } from 'react';
import { classNames } from '~/utils/classNames';

type QuestionId = 'app_type' | 'users' | 'website_style';

interface Option {
  id: string;
  label: string;
  description: string;
  icon?: string;
}

interface Question {
  id: QuestionId;
  label: string;
  description: string;
  options: Option[];
  multiSelect?: boolean;
  maxSelect?: number;
}

interface PromptingMultipleChoiceProps {
  onPromptChange: (prompt: string) => void;
}

const QUESTIONS: Question[] = [
  {
    id: 'app_type',
    label: 'What kind of app?',
    description: 'This shapes the architecture and core feature set.',
    options: [
      { id: 'crm', label: 'CRM / Forecast Tools', description: 'Sales forecasting and customer tracking' },
      { id: 'inventory', label: 'Inventory Management', description: 'Stock and product tracking workflows' },
      { id: 'hr', label: 'HR App', description: 'Timesheets, leave, expenses, payroll' },
      { id: 'appointment', label: 'Appointment App', description: 'Booking, timetables, and scheduling' },
      { id: 'knowledge', label: 'Knowledge Hub', description: 'Internal docs, guides, and dashboards' },
      { id: 'landing', label: 'Landing Page / Blog', description: 'Marketing website or content blog' },
    ],
  },
  {
    id: 'users',
    label: 'Who uses it?',
    description: 'Shapes signup and access model.',
    options: [
      { id: 'customers', label: 'My customers', description: 'Public users can sign up' },
      { id: 'team', label: 'My team', description: 'Internal staff only' },
      { id: 'both', label: 'Both', description: 'Staff + customers with separate routes' },
    ],
  },
  {
    id: 'website_style',
    label: 'What style do you want?',
    description: 'Pick up to 2 — the AI will mirror that visual style in your app.',
    multiSelect: true,
    maxSelect: 2,
    options: [
      { id: 'apple', label: 'Apple', description: 'Minimalist & premium', icon: '/icons/brands/apple.svg' },
      { id: 'airbnb', label: 'Airbnb', description: 'Warm & human', icon: '/icons/brands/airbnb.svg' },
      { id: 'stripe', label: 'Stripe', description: 'Professional & trustworthy', icon: '/icons/brands/stripe.svg' },
      { id: 'notion', label: 'Notion', description: 'Document-first & structured', icon: '/icons/brands/notion.svg' },
      { id: 'linear', label: 'Linear', description: 'Dark, dense & precise', icon: '/icons/brands/linear.svg' },
      { id: 'figma', label: 'Figma', description: 'Creative & colorful', icon: '/icons/brands/figma.svg' },
      { id: 'spotify', label: 'Spotify', description: 'Bold & expressive', icon: '/icons/brands/spotify.svg' },
      { id: 'framer', label: 'Framer', description: 'Motion-rich & modern', icon: '/icons/brands/framer.svg' },
      { id: 'raycast', label: 'Raycast', description: 'Focused & keyboard-first', icon: '/icons/brands/raycast.svg' },
      { id: 'supabase', label: 'Supabase', description: 'Dashboard & data-rich', icon: '/icons/brands/supabase.svg' },
    ],
  },
];

const APP_TYPE_TEXT: Record<string, string> = {
  crm: 'CRM / Sales Forecasting platform',
  inventory: 'Inventory Management system',
  hr: 'HR management application',
  appointment: 'Appointment scheduling application',
  knowledge: 'Knowledge hub / document portal',
  landing: 'Landing page / marketing website',
};

const USERS_TEXT: Record<string, string> = {
  customers: 'External customers (public-facing)',
  team: 'Internal team / staff only',
  both: 'Both internal staff and external customers',
};

export function PromptingMultipleChoice({ onPromptChange }: PromptingMultipleChoiceProps) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Partial<Record<QuestionId, string>>>({});
  const [multiAnswers, setMultiAnswers] = useState<string[]>([]);
  const [palette, setPalette] = useState(['#F97316', '#FDBA74', '#C2410C']);
  const [context, setContext] = useState('');
  const [complete, setComplete] = useState(false);

  const totalSteps = QUESTIONS.length + 2;
  const currentQuestion = QUESTIONS[step];

  const toggleMulti = (optionId: string, maxSelect: number) => {
    setMultiAnswers(prev => {
      if (prev.includes(optionId)) {
        return prev.filter(id => id !== optionId);
      }

      if (prev.length >= maxSelect) {
        return [...prev.slice(1), optionId];
      }

      return [...prev, optionId];
    });
  };

  const selectOption = (questionId: QuestionId, optionId: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: optionId }));

    if (step < QUESTIONS.length - 1) {
      setStep(step + 1);
      return;
    }

    setStep(QUESTIONS.length);
  };

  const confirmMultiSelect = () => {
    setStep(QUESTIONS.length);
  };

  const handleColorChange = (index: number, value: string) => {
    setPalette(prev => {
      const next = [...prev];
      next[index] = value;

      return next;
    });
  };

  const buildPrompt = () => {
    const appType = APP_TYPE_TEXT[answers.app_type || ''] || 'Web application';
    const users = USERS_TEXT[answers.users || ''] || 'General users';
    const styleLabels = multiAnswers
      .map(id => {
        const opt = QUESTIONS[2].options.find(o => o.id === id);
        return opt ? `${opt.label} (${opt.description})` : id;
      })
      .join(', ');

    const contextLine = context.trim()
      ? `Project context: ${context.trim()}`
      : 'Project context: Build a production-ready foundation with clear UX and scalable architecture.';

    return [
      'You are an expert full-stack engineer.',
      '',
      'Build a pre-alpha scaffold for this product:',
      `- App type: ${appType}`,
      `- Target users: ${users}`,
      styleLabels ? `- Visual style inspired by: ${styleLabels}` : '',
      `- Brand palette: Primary ${palette[0]}, Secondary ${palette[1]}, Accent ${palette[2]}`,
      '',
      contextLine,
      '',
      'Deliver:',
      '1) Directory structure',
      '2) Core pages and routes',
      '3) Authentication flow',
      '4) Data model and CRUD APIs',
      '5) .env.example and README',
      '',
      'Keep implementation lean and modular.',
    ]
      .filter(line => line !== '')
      .join('\n');
  };

  const completeFlow = () => {
    setComplete(true);
    onPromptChange(buildPrompt());
  };

  const goBack = () => {
    if (complete) {
      setComplete(false);
      onPromptChange('');
      setStep(totalSteps - 1);

      return;
    }

    if (step > 0) {
      setStep(step - 1);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-accent">Part 1</span>
        <span className="text-xs text-bolt-elements-textSecondary">
          {Math.min(step + 1, totalSteps)} / {totalSteps}
        </span>
      </div>

      {/* Standard single-select questions */}
      {!complete && currentQuestion && !currentQuestion.multiSelect && (
        <div className="space-y-4">
          <h3 className="text-xl font-semibold text-bolt-elements-textPrimary">{currentQuestion.label}</h3>
          <p className="text-sm text-bolt-elements-textSecondary">{currentQuestion.description}</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {currentQuestion.options.map(option => (
              <button
                key={option.id}
                onClick={() => selectOption(currentQuestion.id, option.id)}
                className={classNames(
                  'rounded-lg border p-4 text-left transition-colors',
                  'border-bolt-elements-borderColor hover:border-accent-500',
                  answers[currentQuestion.id] === option.id
                    ? 'bg-accent-500/10 border-accent-500'
                    : 'bg-bolt-elements-background-depth-2'
                )}
              >
                <div className="text-sm font-medium text-bolt-elements-textPrimary">{option.label}</div>
                <div className="mt-1 text-xs text-bolt-elements-textSecondary">{option.description}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Multi-select style question */}
      {!complete && currentQuestion && currentQuestion.multiSelect && (
        <div className="space-y-4">
          <h3 className="text-xl font-semibold text-bolt-elements-textPrimary">{currentQuestion.label}</h3>
          <p className="text-sm text-bolt-elements-textSecondary">{currentQuestion.description}</p>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {currentQuestion.options.map(option => {
              const isSelected = multiAnswers.includes(option.id);
              return (
                <button
                  key={option.id}
                  onClick={() => toggleMulti(option.id, currentQuestion.maxSelect ?? 2)}
                  className={classNames(
                    'text-left rounded-xl border p-3.5 transition-all duration-150',
                    'hover:border-accent-500 focus-visible:outline-none',
                    isSelected
                      ? 'border-accent-500 bg-accent-500/10'
                      : 'border-bolt-elements-borderColor bg-bolt-elements-bg-depth-2 hover:bg-bolt-elements-item-backgroundActive'
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    {option.icon && (
                      <img
                        src={option.icon}
                        alt={option.label}
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
                    {option.label}
                  </p>
                  <p className="text-xs text-bolt-elements-textSecondary mt-1">{option.description}</p>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={confirmMultiSelect}
              className="text-sm text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary underline underline-offset-2 transition-colors"
            >
              Skip — no preference
            </button>
            <button
              onClick={confirmMultiSelect}
              className="ml-auto px-5 py-2.5 rounded-xl bg-accent-500 text-white text-sm font-semibold hover:bg-accent-600 transition-colors"
            >
              {multiAnswers.length > 0
                ? `Use ${multiAnswers.length === 1 ? '1 style' : `${multiAnswers.length} styles`} →`
                : 'Continue →'}
            </button>
          </div>
        </div>
      )}

      {/* Color palette step */}
      {!complete && step === QUESTIONS.length && (
        <div className="space-y-4">
          <h3 className="text-xl font-semibold text-bolt-elements-textPrimary">Choose your color palette</h3>
          <p className="text-sm text-bolt-elements-textSecondary">
            Pick three colors for primary, secondary, and accent.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {['Primary', 'Secondary', 'Accent'].map((label, index) => (
              <label
                key={label}
                className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-3"
              >
                <span className="mb-2 block text-xs font-medium text-bolt-elements-textPrimary">{label}</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={palette[index]}
                    onChange={e => handleColorChange(index, e.target.value)}
                    className="h-8 w-10 rounded border border-bolt-elements-borderColor"
                  />
                  <span className="text-xs text-bolt-elements-textSecondary">{palette[index]}</span>
                </div>
              </label>
            ))}
          </div>
          <button
            onClick={() => setStep(QUESTIONS.length + 1)}
            className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600"
          >
            Continue
          </button>
        </div>
      )}

      {/* Context step */}
      {!complete && step === QUESTIONS.length + 1 && (
        <div className="space-y-4">
          <h3 className="text-xl font-semibold text-bolt-elements-textPrimary">Tell us about your app</h3>
          <p className="text-sm text-bolt-elements-textSecondary">Add key context, features, and constraints.</p>
          <textarea
            value={context}
            onChange={e => setContext(e.target.value)}
            placeholder="Example: Multi-tenant dashboard, role-based access, English + Japanese support, mobile-first."
            className="min-h-[120px] w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-4 text-sm text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary"
          />
          <button
            onClick={completeFlow}
            className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600"
          >
            Get my prompt
          </button>
        </div>
      )}

      {/* Complete state */}
      {complete && (
        <div className="space-y-4">
          <div className="rounded-lg border border-accent-500/40 bg-accent-500/10 p-4 text-sm text-bolt-elements-textPrimary">
            Prompt is ready. Click the send button to start generation.
          </div>
          <pre className="max-h-[240px] overflow-auto whitespace-pre-wrap rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-3 text-xs text-bolt-elements-textSecondary">
            {buildPrompt()}
          </pre>
        </div>
      )}

      <div className="mt-5">
        <button
          onClick={goBack}
          disabled={step === 0 && !complete}
          className={classNames(
            'rounded-lg px-3 py-1.5 text-xs border',
            step === 0 && !complete
              ? 'cursor-not-allowed border-bolt-elements-borderColor text-bolt-elements-textTertiary'
              : 'border-bolt-elements-borderColor text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary'
          )}
        >
          Back
        </button>
      </div>
    </div>
  );
}
