import { useMemo, useState } from 'react';
import { classNames } from '~/utils/classNames';

type QuestionId = 'app_type' | 'users' | 'payments' | 'auth_method';

interface Option {
  id: string;
  label: string;
  description: string;
}

interface Question {
  id: QuestionId;
  label: string;
  description: string;
  options: Option[];
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
    id: 'payments',
    label: 'Will users pay?',
    description: 'Determines billing and payment requirements.',
    options: [
      { id: 'yes', label: 'Yes', description: 'Include full payment flow' },
      { id: 'maybe', label: 'Not yet', description: 'Scaffold for future payments' },
      { id: 'no', label: 'No', description: 'No billing infrastructure needed' },
    ],
  },
  {
    id: 'auth_method',
    label: 'How do users sign in?',
    description: 'Defines authentication approach.',
    options: [
      { id: 'email', label: 'Email & password', description: 'Classic credentials auth' },
      { id: 'social', label: 'Social accounts', description: 'Google/GitHub style OAuth' },
      { id: 'sso', label: 'Enterprise SSO', description: 'SAML/OIDC for organizations' },
      { id: 'notsure', label: 'Not sure', description: 'Use sensible defaults' },
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

const PAYMENTS_TEXT: Record<string, string> = {
  yes: 'Full payment integration',
  maybe: 'Payment scaffolding prepared for later activation',
  no: 'No payment infrastructure',
};

const AUTH_TEXT: Record<string, string> = {
  email: 'Email & password',
  social: 'Social OAuth',
  sso: 'Enterprise SSO',
  notsure: 'Email + social defaults',
};

export function PromptingMultipleChoice({ onPromptChange }: PromptingMultipleChoiceProps) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Partial<Record<QuestionId, string>>>({});
  const [palette, setPalette] = useState(['#F97316', '#FDBA74', '#C2410C']);
  const [context, setContext] = useState('');
  const [complete, setComplete] = useState(false);

  const totalSteps = QUESTIONS.length + 2;
  const currentQuestion = QUESTIONS[step];

  const prompt = useMemo(() => {
    if (!complete) {
      return '';
    }

    const appType = APP_TYPE_TEXT[answers.app_type || ''] || 'Web application';
    const users = USERS_TEXT[answers.users || ''] || 'General users';
    const payments = PAYMENTS_TEXT[answers.payments || ''] || 'No payment requirements specified';
    const auth = AUTH_TEXT[answers.auth_method || ''] || 'Flexible auth defaults';

    const contextLine = context.trim()
      ? `Project context: ${context.trim()}`
      : 'Project context: Build a production-ready foundation with clear UX and scalable architecture.';

    return [
      'You are an expert full-stack engineer.',
      '',
      'Build a pre-alpha scaffold for this product:',
      `- App type: ${appType}`,
      `- Target users: ${users}`,
      `- Payments: ${payments}`,
      `- Authentication: ${auth}`,
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
    ].join('\n');
  }, [answers, complete, context, palette]);

  const updatePrompt = (nextPrompt: string) => {
    onPromptChange(nextPrompt);
  };

  const selectOption = (questionId: QuestionId, optionId: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: optionId }));

    if (step < QUESTIONS.length - 1) {
      setStep(step + 1);
      return;
    }

    setStep(QUESTIONS.length);
  };

  const handleColorChange = (index: number, value: string) => {
    setPalette(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const completeFlow = () => {
    setComplete(true);
    const nextPrompt = [
      'You are an expert full-stack engineer.',
      '',
      'Build a pre-alpha scaffold for this product:',
      `- App type: ${APP_TYPE_TEXT[answers.app_type || ''] || 'Web application'}`,
      `- Target users: ${USERS_TEXT[answers.users || ''] || 'General users'}`,
      `- Payments: ${PAYMENTS_TEXT[answers.payments || ''] || 'No payment requirements specified'}`,
      `- Authentication: ${AUTH_TEXT[answers.auth_method || ''] || 'Flexible auth defaults'}`,
      `- Brand palette: Primary ${palette[0]}, Secondary ${palette[1]}, Accent ${palette[2]}`,
      '',
      context.trim()
        ? `Project context: ${context.trim()}`
        : 'Project context: Build a production-ready foundation with clear UX and scalable architecture.',
      '',
      'Deliver:',
      '1) Directory structure',
      '2) Core pages and routes',
      '3) Authentication flow',
      '4) Data model and CRUD APIs',
      '5) .env.example and README',
      '',
      'Keep implementation lean and modular.',
    ].join('\n');
    updatePrompt(nextPrompt);
  };

  const goBack = () => {
    if (complete) {
      setComplete(false);
      updatePrompt('');
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

      {!complete && currentQuestion && (
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
                  answers[currentQuestion.id] === option.id ? 'bg-accent-500/10 border-accent-500' : 'bg-bolt-elements-background-depth-2'
                )}
              >
                <div className="text-sm font-medium text-bolt-elements-textPrimary">{option.label}</div>
                <div className="mt-1 text-xs text-bolt-elements-textSecondary">{option.description}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {!complete && step === QUESTIONS.length && (
        <div className="space-y-4">
          <h3 className="text-xl font-semibold text-bolt-elements-textPrimary">Choose your color palette</h3>
          <p className="text-sm text-bolt-elements-textSecondary">Pick three colors for primary, secondary, and accent.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {['Primary', 'Secondary', 'Accent'].map((label, index) => (
              <label key={label} className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-3">
                <span className="mb-2 block text-xs font-medium text-bolt-elements-textPrimary">{label}</span>
                <div className="flex items-center gap-2">
                  <input type="color" value={palette[index]} onChange={e => handleColorChange(index, e.target.value)} className="h-8 w-10 rounded border border-bolt-elements-borderColor" />
                  <span className="text-xs text-bolt-elements-textSecondary">{palette[index]}</span>
                </div>
              </label>
            ))}
          </div>
          <button onClick={() => setStep(QUESTIONS.length + 1)} className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600">
            Continue
          </button>
        </div>
      )}

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
          <button onClick={completeFlow} className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600">
            Get my prompt
          </button>
        </div>
      )}

      {complete && (
        <div className="space-y-4">
          <div className="rounded-lg border border-accent-500/40 bg-accent-500/10 p-4 text-sm text-bolt-elements-textPrimary">
            Prompt is ready. Click the send button to start generation.
          </div>
          <pre className="max-h-[240px] overflow-auto whitespace-pre-wrap rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-3 text-xs text-bolt-elements-textSecondary">
            {prompt}
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
