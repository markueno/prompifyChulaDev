import { useState } from 'react';
import { classNames } from '~/utils/classNames';

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
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  let r, g, b;
  if (s === 0) { r = g = b = l; } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1/3);
  }
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function generateShades(hex: string): string[] {
  const [r, g, b] = hexToRgb(hex);
  const [h, s] = rgbToHsl(r, g, b);
  return [96, 91, 82, 70, 58, 46, 36, 26, 16].map(l => hslToHex(h, Math.min(s, 88), l));
}

const SHADE_LABELS = ['50','100','200','300','400','500','600','700','800'];

// ─── Quick palettes ───────────────────────────────────────────────────────────

const QUICK_PALETTES = [
  { name: 'Warm',   colors: ['#F97316', '#FED7AA', '#C2410C'] },
  { name: 'Ocean',  colors: ['#0EA5E9', '#BAE6FD', '#0369A1'] },
  { name: 'Forest', colors: ['#22C55E', '#BBF7D0', '#15803D'] },
  { name: 'Violet', colors: ['#8B5CF6', '#EDE9FE', '#6D28D9'] },
  { name: 'Rose',   colors: ['#F43F5E', '#FFE4E6', '#BE123C'] },
  { name: 'Slate',  colors: ['#6366F1', '#E0E7FF', '#3730A3'] },
];

const ROLE_LABELS = ['Primary', 'Secondary', 'Accent'];
const ROLE_HINTS = [
  'Main brand color — buttons, links, active states',
  'Supporting surface — cards, backgrounds, hover states',
  'Pop highlight — badges, tags, notifications',
];

const COLOR_PRESETS = [
  // Reds & Pinks
  '#FF3B30','#FF2D55','#E91E8C','#C2185B',
  // Oranges & Yellows
  '#FF6B00','#FF9500','#FFCC02','#F5A623',
  // Greens
  '#34C759','#30D158','#00C896','#00897B',
  // Blues
  '#007AFF','#0A84FF','#0057FF','#1A73E8',
  // Purples & Indigos
  '#5E5CE6','#7C3AED','#9333EA','#BF5AF2',
  // Teals & Cyans
  '#32ADE6','#00BCD4','#26C6DA','#0097A7',
  // Neutrals (dark)
  '#1C1C1E','#2C2C2E','#3A3A3C','#48484A',
  // Warm neutrals & earth
  '#8D6E63','#795548','#A1887F','#6D4C41',
];

// ─── Swatch popup ─────────────────────────────────────────────────────────────

function SwatchPopup({ role, current, onPick, onClose }: {
  role: string; current: string; onPick: (hex: string) => void; onClose: () => void;
}) {
  const [hexInput, setHexInput] = useState(current.replace('#', ''));
  const preview = hexInput.length === 6 ? `#${hexInput}` : null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl p-5 w-72 shadow-2xl border border-gray-200" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-gray-800">Pick <span className="text-accent-500">{role}</span> color</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>
        <div className="grid grid-cols-8 gap-1.5 mb-4">
          {COLOR_PRESETS.map(hex => (
            <button key={hex} onClick={() => onPick(hex)}
              className="w-7 h-7 rounded-md hover:scale-110 transition-transform border-2 shadow-sm"
              style={{ background: hex, borderColor: current.toUpperCase() === hex.toUpperCase() ? '#000' : 'rgba(0,0,0,0.08)' }}
            />
          ))}
        </div>
        <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
          <span className="text-sm text-gray-400 font-mono">#</span>
          <input type="text" maxLength={6} placeholder="e.g. 3B82F6" value={hexInput}
            onChange={e => setHexInput(e.target.value.replace(/[^0-9a-fA-F]/g, ''))}
            onKeyDown={e => { if (e.key === 'Enter' && hexInput.length === 6) onPick(`#${hexInput.toUpperCase()}`); }}
            className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-gray-200 bg-gray-50 text-gray-800 font-mono focus:outline-none focus:border-accent-500"
          />
          {preview && <span className="w-7 h-7 rounded-md border border-gray-200 shrink-0 shadow-sm" style={{ background: preview }} />}
          <button onClick={() => hexInput.length === 6 && onPick(`#${hexInput.toUpperCase()}`)} disabled={hexInput.length !== 6}
            className="px-3 py-1.5 text-sm rounded-lg bg-accent-500 text-white disabled:opacity-40 hover:bg-accent-600 transition-colors">
            Use
          </button>
        </div>
      </div>
    </div>
  );
}

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
  const [activeColorSlot, setActiveColorSlot] = useState<number | null>(null);
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
            Pick colors that define your brand. Each role has a purpose.
          </p>

          {/* Quick palettes */}
          <div>
            <p className="text-[10px] font-semibold text-bolt-elements-textTertiary uppercase tracking-wide mb-1.5">Quick palettes</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_PALETTES.map(p => (
                <button key={p.name} onClick={() => setPalette(p.colors)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-bolt-elements-borderColor hover:border-accent-500 bg-bolt-elements-background-depth-2 transition-colors group">
                  <span className="flex gap-0.5">
                    {p.colors.map((c, i) => (
                      <span key={i} className="w-3 h-3 rounded-full border border-black/10" style={{ background: c }} />
                    ))}
                  </span>
                  <span className="text-xs text-bolt-elements-textSecondary group-hover:text-bolt-elements-textPrimary transition-colors">{p.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Color role cards */}
          <div className="space-y-2.5">
            {ROLE_LABELS.map((label, index) => {
              const hex = palette[index];
              const shades = generateShades(hex);
              return (
                <div key={label} className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-3 space-y-2.5">
                  {/* Header row */}
                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={() => setActiveColorSlot(index)}
                      className="w-8 h-8 rounded-lg border-2 border-white/20 shadow-sm shrink-0 hover:scale-105 transition-transform"
                      style={{ background: hex }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-bolt-elements-textPrimary">{label}</span>
                        <span className="font-mono text-[11px] text-bolt-elements-textSecondary">{hex.toUpperCase()}</span>
                        <button onClick={() => setActiveColorSlot(index)}
                          className="text-[10px] text-accent-500 hover:text-accent-600 underline underline-offset-1 transition-colors ml-auto">
                          edit
                        </button>
                      </div>
                      <p className="text-[11px] text-bolt-elements-textTertiary">{ROLE_HINTS[index]}</p>
                    </div>
                  </div>
                  {/* Shade scale */}
                  <div className="flex gap-1">
                    {shades.map((shade, i) => (
                      <div key={i} className="flex flex-col items-center gap-0.5 flex-1">
                        <button
                          title={`${SHADE_LABELS[i]} — ${shade}`}
                          onClick={() => handleColorChange(index, shade)}
                          className="w-full rounded hover:scale-110 transition-transform"
                          style={{
                            height: 20,
                            background: shade,
                            outline: shade.toUpperCase() === hex.toUpperCase() ? '2px solid rgba(0,0,0,0.4)' : 'none',
                            outlineOffset: 1,
                          }}
                        />
                        <span className="text-[8px] text-bolt-elements-textTertiary leading-none">{SHADE_LABELS[i]}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button onClick={() => setStep(QUESTIONS.length + 1)}
              className="text-sm text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary underline underline-offset-2 transition-colors">
              Skip — use defaults
            </button>
            <button onClick={() => setStep(QUESTIONS.length + 1)}
              className="ml-auto rounded-xl bg-accent-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-600 transition-colors">
              Use these colors →
            </button>
          </div>

          {activeColorSlot !== null && (
            <SwatchPopup
              role={ROLE_LABELS[activeColorSlot]}
              current={palette[activeColorSlot]}
              onPick={hex => { handleColorChange(activeColorSlot, hex); setActiveColorSlot(null); }}
              onClose={() => setActiveColorSlot(null)}
            />
          )}
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
