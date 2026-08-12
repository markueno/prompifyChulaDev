import { useState, useCallback, useEffect } from 'react';
import { classNames } from '~/utils/classNames';
import { FillBlanks } from '~/components/questionnaire/FillBlanks';
import type { FillBlanksTemplate } from '~/lib/questionnaire/types';
import { CompanyContextModal } from './CompanyContextModal';
import { DESIGN_SYSTEMS } from '~/lib/design-systems';
import { readCachedContext, syncWorkspaceContext } from '~/lib/workspaceContext';

// ─── Color math ───────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return [0, 0, l * 100];
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;

  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  } else if (max === g) {
    h = ((b - r) / d + 2) / 6;
  } else {
    h = ((r - g) / d + 4) / 6;
  }

  return [h * 360, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  h /= 360;
  s /= 100;
  l /= 100;

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) {
      t += 1;
    }

    if (t > 1) {
      t -= 1;
    }

    if (t < 1 / 6) {
      return p + (q - p) * 6 * t;
    }

    if (t < 1 / 2) {
      return q;
    }

    if (t < 2 / 3) {
      return p + (q - p) * (2 / 3 - t) * 6;
    }

    return p;
  };
  let r: number;
  let g: number;
  let b: number;

  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, '0');

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function generateShades(hex: string): string[] {
  const [r, g, b] = hexToRgb(hex);
  const [h, s] = rgbToHsl(r, g, b);

  return [96, 91, 82, 70, 58, 46, 36, 26, 16].map(l => hslToHex(h, Math.min(s, 88), l));
}

const SHADE_LABELS = ['50', '100', '200', '300', '400', '500', '600', '700', '800'];

// ─── Quick palettes ───────────────────────────────────────────────────────────

const QUICK_PALETTES = [
  { name: 'Warm', colors: ['#F97316', '#FED7AA', '#C2410C'] },
  { name: 'Ocean', colors: ['#0EA5E9', '#BAE6FD', '#0369A1'] },
  { name: 'Forest', colors: ['#22C55E', '#BBF7D0', '#15803D'] },
  { name: 'Brand', colors: ['#F97316', '#FED7AA', '#231710'] },
  { name: 'Rose', colors: ['#F43F5E', '#FFE4E6', '#BE123C'] },
  { name: 'Slate', colors: ['#6366F1', '#E0E7FF', '#3730A3'] },
];

const ROLE_LABELS = ['Primary', 'Secondary', 'Accent'];
const ROLE_HINTS = [
  'Main brand color — buttons, links, active states',
  'Supporting surface — cards, backgrounds, hover states',
  'Pop highlight — badges, tags, notifications',
];

const COLOR_PRESETS = [
  '#FF3B30',
  '#FF2D55',
  '#F97316',
  '#C2410C',
  '#FF6B00',
  '#FF9500',
  '#FFCC02',
  '#F5A623',
  '#34C759',
  '#30D158',
  '#00C896',
  '#00897B',
  '#007AFF',
  '#0A84FF',
  '#0057FF',
  '#1A73E8',
  '#F97316',
  '#EA580C',
  '#C2410C',
  '#FED7AA',
  '#32ADE6',
  '#00BCD4',
  '#26C6DA',
  '#0097A7',
  '#1C1C1E',
  '#2C2C2E',
  '#3A3A3C',
  '#48484A',
  '#8D6E63',
  '#795548',
  '#A1887F',
  '#6D4C41',
];

// ─── Swatch popup ─────────────────────────────────────────────────────────────

function SwatchPopup({
  role,
  current,
  onPick,
  onClose,
}: {
  role: string;
  current: string;
  onPick: (hex: string) => void;
  onClose: () => void;
}) {
  const [hexInput, setHexInput] = useState(current.replace('#', ''));
  const preview = hexInput.length === 6 ? `#${hexInput}` : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white dark:bg-[#2d2014] rounded-2xl p-5 w-72 shadow-2xl border border-gray-200 dark:border-[#423322]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-gray-800 dark:text-[#f0e4d5]">
            Pick <span className="text-accent-500">{role}</span> color
          </p>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 dark:hover:text-[#968878] text-xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="grid grid-cols-8 gap-1.5 mb-4">
          {COLOR_PRESETS.map(hex => (
            <button
              key={hex}
              onClick={() => onPick(hex)}
              className="w-7 h-7 rounded-md hover:scale-110 transition-transform border-2 shadow-sm"
              style={{
                background: hex,
                borderColor:
                  current.toUpperCase() === hex.toUpperCase()
                    ? 'var(--bolt-elements-textPrimary, #000)'
                    : 'rgba(0,0,0,0.08)',
              }}
            />
          ))}
        </div>
        <div className="flex items-center gap-2 pt-1 border-t border-gray-100 dark:border-[#423322]">
          <span className="text-sm text-gray-400 dark:text-[#c4b19a] font-mono">#</span>
          <input
            type="text"
            maxLength={6}
            placeholder="e.g. 3B82F6"
            value={hexInput}
            onChange={e => setHexInput(e.target.value.replace(/[^0-9a-fA-F]/g, ''))}
            onKeyDown={e => {
              if (e.key === 'Enter' && hexInput.length === 6) {
                onPick(`#${hexInput.toUpperCase()}`);
              }
            }}
            className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-[#423322] bg-gray-50 dark:bg-[#1a120a] text-gray-800 dark:text-[#f0e4d5] font-mono focus:outline-none focus:border-accent-500"
          />
          {preview && (
            <span
              className="w-7 h-7 rounded-md border border-gray-200 dark:border-[#423322] shrink-0 shadow-sm"
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
  onPromptChange: (prompt: string, summary?: string) => void;
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

const ARCHETYPE_NOTES: Record<string, { archetype: string; notes: string }> = {
  crm: {
    archetype: 'CRM / Sales Forecasting platform',
    notes:
      'Customer relationship management with contact records, deal pipeline, activity logging, and revenue forecasting. Role-based views for sales reps and managers. Reporting and target tracking built in.',
  },
  inventory: {
    archetype: 'Inventory Management system',
    notes:
      'Stock-level tracking with product catalogue, quantity management, low-stock alerts, and reorder workflows. Supports physical products, raw materials, and digital stock. Audit trail on all stock movements.',
  },
  hr: {
    archetype: 'HR management application',
    notes:
      'Staff-facing HR platform. Timesheet submission and approval, leave request management, expense claims with receipt upload, and payroll summary. Manager approval flows and admin oversight panel.',
  },
  appointment: {
    archetype: 'Appointment / scheduling application',
    notes:
      'Calendar-based booking with configurable availability, time-slot management, booking confirmations, and reminders. Supports self-service booking by customers or staff-managed scheduling. Calendar sync integration.',
  },
  knowledge: {
    archetype: 'Knowledge hub / document portal',
    notes:
      'Centralised content platform for sharing documents, guides, and dashboards. Category-based organisation with full-text search. Role-based access to control who can view or edit content. Version history on documents.',
  },
  landing: {
    archetype: 'Landing page / marketing website',
    notes:
      'Public-facing website with static or CMS-managed content. SEO-optimised pages, blog or news section, contact/lead capture forms, and clear calls to action. Fast load times and mobile-first design.',
  },
};

const USER_SCOPE: Record<string, { scope: string; auth: string; payments: string }> = {
  customers: {
    scope: 'External customers (public-facing)',
    auth: 'Public signup flow with email verification. OAuth social login support (Google, GitHub). Password reset. CDN and edge deployment for performance. SEO-optimised frontend.',
    payments: 'Stripe integration for customer payments — subscriptions, one-time purchases, and invoicing.',
  },
  team: {
    scope: 'Internal team / staff only',
    auth: 'No public signup. Invite-only or company email domain restriction. SSO-ready (SAML/OIDC). Admin-controlled user creation. Admin-focused UI, no SEO requirement.',
    payments: 'No customer-facing payments needed.',
  },
  both: {
    scope: 'Both internal staff and external customers',
    auth: 'Dual auth flows: invite-only or SSO for staff (admin panel), OAuth + email signup for customers (public-facing app). Role-based routing to separate interfaces.',
    payments: 'Stripe for customer payments; admin billing portal for staff subscription management.',
  },
};

const DIVIDER = '════════════════════════════════════════';

const FILL_BLANKS_TEMPLATES: Record<string, FillBlanksTemplate> = {
  crm: {
    parts: ["I'm building a CRM for ", ' businesses, to help their ', ' sales team ', '.'],
    blanks: [
      {
        id: 'industry',
        options: [
          'real estate',
          'retail',
          'finance',
          'healthcare',
          'tech',
          'logistics',
          'hospitality',
          'e-commerce',
          'construction',
        ],
      },
      { id: 'team_size', options: ['small', 'growing', 'large', 'remote', 'multi-location'] },
      {
        id: 'goal',
        options: [
          'manage their pipeline',
          'track customers',
          'forecast revenue',
          'close more deals',
          'organise contacts',
          'improve follow-ups',
        ],
      },
    ],
  },
  inventory: {
    parts: ["I'm building an inventory system for ", ' to track ', ' across ', '.'],
    blanks: [
      {
        id: 'business_type',
        options: [
          'a retail store',
          'a warehouse',
          'a restaurant',
          'a manufacturer',
          'an e-commerce business',
          'a pharmacy',
          'a supplier',
        ],
      },
      {
        id: 'stock_type',
        options: ['physical products', 'raw materials', 'ingredients', 'digital licenses', 'equipment', 'spare parts'],
      },
      {
        id: 'locations',
        options: ['one location', 'multiple warehouses', 'online and physical stores', 'multiple branches'],
      },
    ],
  },
  hr: {
    parts: ["I'm building an HR app for a ", ' ', ' company to help manage ', '.'],
    blanks: [
      { id: 'company_size', options: ['small', 'growing', 'mid-sized', 'large'] },
      {
        id: 'industry',
        options: [
          'retail',
          'tech',
          'hospitality',
          'healthcare',
          'construction',
          'logistics',
          'financial',
          'manufacturing',
        ],
      },
      {
        id: 'scope',
        options: [
          'timesheets and leave',
          'expenses and payroll',
          'all HR tasks',
          'attendance and scheduling',
          'employee onboarding',
        ],
      },
    ],
  },
  appointment: {
    parts: ["I'm building a booking app for ", ' where ', ' can schedule ', '.'],
    blanks: [
      {
        id: 'business_type',
        options: [
          'a salon',
          'a clinic',
          'a consultancy',
          'a fitness studio',
          'a repair service',
          'a coaching business',
          'a dental practice',
        ],
      },
      { id: 'booker', options: ['customers', 'staff', 'both customers and staff'] },
      {
        id: 'service_type',
        options: ['appointments', 'classes and sessions', 'consultations', 'treatments', 'meetings', 'home visits'],
      },
    ],
  },
  knowledge: {
    parts: ["I'm building a knowledge hub for ", ' to share ', ' about ', '.'],
    blanks: [
      { id: 'audience', options: ['our internal team', 'our company', 'our clients', 'our partners', 'the public'] },
      {
        id: 'content_type',
        options: [
          'documents and guides',
          'training materials',
          'policies and procedures',
          'product knowledge',
          'video tutorials',
          'FAQs and wikis',
        ],
      },
      {
        id: 'topic',
        options: [
          'our products',
          'our services',
          'company processes',
          'technical documentation',
          'onboarding materials',
        ],
      },
    ],
  },
  landing: {
    parts: ["I'm building a ", ' for ', ' to ', '.'],
    blanks: [
      {
        id: 'site_type',
        options: ['business website', 'portfolio', 'blog', 'landing page', 'product showcase', 'personal brand site'],
      },
      {
        id: 'business_type',
        options: [
          'a freelancer',
          'a startup',
          'a local business',
          'an agency',
          'a personal brand',
          'a non-profit',
          'a consultancy',
        ],
      },
      {
        id: 'goal',
        options: [
          'showcase our work',
          'attract new clients',
          'share our story',
          'generate leads',
          'promote a product',
          'build an audience',
        ],
      },
    ],
  },
};

export function PromptingMultipleChoice({ onPromptChange }: PromptingMultipleChoiceProps) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Partial<Record<QuestionId, string>>>({});
  const [multiAnswers, setMultiAnswers] = useState<string[]>([]);
  const [palette, setPalette] = useState(['#F97316', '#FDBA74', '#C2410C']);
  const [activeColorSlot, setActiveColorSlot] = useState<number | null>(null);
  const [context, setContext] = useState('');
  const [complete, setComplete] = useState(false);
  const [contextModalOpen, setContextModalOpen] = useState(false);

  /*
   * Reads the cache, which syncWorkspaceContext keeps in step with the workspace copy on the
   * server. Kept synchronous so the prompt builder below stays a plain function.
   */
  const getCompanyContext = useCallback(() => readCachedContext(), []);

  const [hasCompanyContext, setHasCompanyContext] = useState(() => !!readCachedContext());

  /*
   * Pull the workspace's context down on mount so it is present on every device, not just the
   * browser that generated it (and migrate any pre-workspace localStorage copy up).
   */
  useEffect(() => {
    void syncWorkspaceContext().then(content => setHasCompanyContext(!!content));
  }, []);

  const handleContextModalChange = useCallback(
    (open: boolean) => {
      setContextModalOpen(open);

      if (!open) {
        setHasCompanyContext(!!getCompanyContext());
      }
    },
    [getCompanyContext]
  );

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
    const appTypeId = answers.app_type || '';
    const archetype = ARCHETYPE_NOTES[appTypeId] ?? {
      archetype: 'Web application',
      notes: 'A production-ready web application with clear UX and scalable architecture.',
    };
    const userScope = USER_SCOPE[answers.users || ''] ?? USER_SCOPE.customers;
    const contextSentence = context.trim();
    const companyCtx = getCompanyContext();

    const lines: string[] = [];

    lines.push('You are an expert full-stack software engineer and solution architect.');
    lines.push('');

    // ── WHAT I'M BUILDING ──
    lines.push(DIVIDER);
    lines.push("WHAT I'M BUILDING");
    lines.push(DIVIDER);

    if (contextSentence) {
      lines.push(contextSentence);
      lines.push('');
    }

    lines.push(`App type:  ${archetype.archetype}`);
    lines.push('');

    if (archetype.notes) {
      lines.push(archetype.notes);
      lines.push('');
    }

    // ── TARGET USERS & REQUIREMENTS ──
    lines.push(DIVIDER);
    lines.push('TARGET USERS & REQUIREMENTS');
    lines.push(DIVIDER);
    lines.push('User scope');
    lines.push(`  ${userScope.scope}`);
    lines.push('');
    lines.push('Authentication');
    lines.push(`  ${userScope.auth}`);
    lines.push('');
    lines.push('Payments');
    lines.push(`  ${userScope.payments}`);
    lines.push('');

    // ── VISUAL DESIGN — COLOR PALETTE ──
    lines.push(DIVIDER);
    lines.push('VISUAL DESIGN — COLOR PALETTE');
    lines.push(DIVIDER);
    lines.push('Color palette (apply exactly — these are hard requirements):');
    lines.push(`  Primary:    ${palette[0]}`);
    lines.push(`  Secondary:  ${palette[1]}`);
    lines.push(`  Accent:     ${palette[2]}`);
    lines.push('');
    lines.push('UI color rules:');
    lines.push('  — Primary color: main CTAs, navigation active states, key interactive elements');
    lines.push('  — Secondary color: backgrounds, card surfaces, sidebar fills');
    lines.push('  — Accent color: highlights, badges, notifications, calls to attention');
    lines.push('  Do not introduce any other brand colors. These are the only colors in the palette.');
    lines.push('');

    // ── VISUAL DESIGN INSPIRATION ──
    if (multiAnswers.length > 0) {
      lines.push(DIVIDER);
      lines.push('VISUAL DESIGN INSPIRATION');
      lines.push(DIVIDER);
      lines.push(
        'The following design system(s) define the visual style for this app. Use them as binding reference for component structure, spacing, typography, color usage, and interaction patterns when building all UI.'
      );
      lines.push('');

      for (const brandId of multiAnswers) {
        const md = DESIGN_SYSTEMS[brandId];

        if (md) {
          const brandLabel = QUESTIONS[2].options.find(o => o.id === brandId)?.label ?? brandId;
          lines.push(`─── ${brandLabel.toUpperCase()} DESIGN SYSTEM ───`);
          lines.push(md.trim());
          lines.push('');
        }
      }
    }

    // ── COMPANY CONTEXT ──
    if (companyCtx) {
      lines.push(DIVIDER);
      lines.push('YOUR COMPANY CONTEXT');
      lines.push(DIVIDER);
      lines.push(
        'The following describes the company this tool is being built for. Use it throughout — for naming conventions, design decisions, feature scope, and UX tone.'
      );
      lines.push('');
      lines.push(companyCtx.trim());
      lines.push('');
    }

    // ── WHAT TO BUILD ──
    lines.push(DIVIDER);
    lines.push('WHAT TO BUILD — PRE-ALPHA SCAFFOLD');
    lines.push(DIVIDER);
    lines.push('Build the pre-alpha foundation of this app. This is the skeleton to start from.');
    lines.push('');
    lines.push('1)  Directory structure — scaffold the full project with proper separation of concerns');
    lines.push('2)  Core pages and routes — all main views with working navigation');
    lines.push('3)  Authentication flow — signup, login, password reset, session management');
    lines.push('4)  Data model and CRUD APIs — database schema, migrations, REST or server actions');
    lines.push('5)  .env.example and README — setup instructions, environment variables documented');
    lines.push('');

    // ── IMPORTANT NOTES ──
    lines.push(DIVIDER);
    lines.push('IMPORTANT NOTES');
    lines.push(DIVIDER);

    if (multiAnswers.length > 0) {
      lines.push(
        'Apply the selected design system(s) to all UI decisions — typography, spacing, elevation, color usage, and component patterns.'
      );
    }

    lines.push('Keep the implementation lean and modular. Use TypeScript throughout.');
    lines.push('Do not over-engineer — deliver the scaffold, not the final product.');

    return lines.join('\n');
  };

  /*
   * Short, human-readable summary of the wizard answers — shown in the chat instead of the
   * full generated prompt (consumed via UserMessage.tsx's `summary:` annotation).
   */
  const buildSummary = () => {
    const parts: string[] = [];
    const archetype = ARCHETYPE_NOTES[answers.app_type || '']?.archetype;

    if (archetype) {
      parts.push(archetype);
    }

    const usersOpt = QUESTIONS.find(q => q.id === 'users')?.options.find(o => o.id === answers.users);

    if (usersOpt) {
      parts.push(`for ${usersOpt.label.toLowerCase()}`);
    }

    const styleOpt = QUESTIONS.find(q => q.id === 'website_style')?.options.find(o => o.id === answers.website_style);

    if (styleOpt) {
      parts.push(`${styleOpt.label} style`);
    }

    const base = parts.join(' · ') || 'Custom app';
    const ctx = context.trim();

    return ctx ? `${ctx.length > 50 ? ctx.slice(0, 50) + '…' : ctx} — ${base}` : base;
  };

  const completeFlow = () => {
    onPromptChange(buildPrompt(), buildSummary());
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
        <span className="text-xs font-semibold uppercase tracking-wide text-accent-600 dark:text-accent-300">
          Part 1
        </span>
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

          {step === 0 && (
            <div
              className={classNames(
                'flex items-center gap-2 px-3.5 py-2.5 rounded-lg border text-sm mt-2',
                hasCompanyContext
                  ? 'bg-green-50 dark:bg-green-950/40 border-green-200 dark:border-green-800 text-green-800 dark:text-green-400'
                  : 'bg-[#fafafa] dark:bg-[#372a1a] border-[#e8e8e8] dark:border-[#423322] text-[#999] dark:text-[#968878]'
              )}
            >
              {hasCompanyContext ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
                    <circle cx="7" cy="7" r="6" stroke="#16a34a" strokeWidth="1.5" />
                    <path
                      d="M4 7l2 2 4-4"
                      stroke="#16a34a"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span>Company context loaded</span>
                  <button
                    onClick={() => setContextModalOpen(true)}
                    className="ml-auto text-green-700 hover:text-green-900 underline underline-offset-2 text-xs font-medium"
                  >
                    Edit
                  </button>
                </>
              ) : (
                <>
                  <span>Optional: add your company context for more personalized prompts</span>
                  <button
                    onClick={() => setContextModalOpen(true)}
                    className="ml-auto text-accent-600 dark:text-accent-300 hover:text-accent-700 dark:hover:text-accent-200 underline underline-offset-2 text-xs font-medium whitespace-nowrap"
                  >
                    Add context →
                  </button>
                </>
              )}
            </div>
          )}
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
                      : 'border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 hover:bg-bolt-elements-item-backgroundActive'
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    {option.icon && (
                      /*
                       * The brand marks are single-colour `fill="currentColor"` glyphs. An <img>
                       * cannot inherit the page colour, so currentColor resolved to black and the
                       * logos disappeared on the dark card. Mask them instead so they take the
                       * theme's text colour.
                       */
                      <span
                        role="img"
                        aria-label={option.label}
                        className={classNames(
                          'w-7 h-7 shrink-0',
                          isSelected ? 'bg-accent-600 dark:bg-accent-300' : 'bg-bolt-elements-textPrimary'
                        )}
                        style={{
                          maskImage: `url(${option.icon})`,
                          WebkitMaskImage: `url(${option.icon})`,
                          maskSize: 'contain',
                          WebkitMaskSize: 'contain',
                          maskRepeat: 'no-repeat',
                          WebkitMaskRepeat: 'no-repeat',
                          maskPosition: 'center',
                          WebkitMaskPosition: 'center',
                        }}
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
                    className={`font-semibold text-sm leading-snug ${isSelected ? 'text-accent-600 dark:text-accent-300' : 'text-bolt-elements-textPrimary'}`}
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
            <p className="text-[10px] font-semibold text-bolt-elements-textTertiary uppercase tracking-wide mb-1.5">
              Quick palettes
            </p>
            <div className="flex flex-wrap gap-2">
              {QUICK_PALETTES.map(p => (
                <button
                  key={p.name}
                  onClick={() => setPalette(p.colors)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-bolt-elements-borderColor hover:border-accent-500 bg-bolt-elements-background-depth-2 transition-colors group"
                >
                  <span className="flex gap-0.5">
                    {p.colors.map((c, i) => (
                      <span key={i} className="w-3 h-3 rounded-full border border-black/10" style={{ background: c }} />
                    ))}
                  </span>
                  <span className="text-xs text-bolt-elements-textSecondary group-hover:text-bolt-elements-textPrimary transition-colors">
                    {p.name}
                  </span>
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
                <div
                  key={label}
                  className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-3 space-y-2.5"
                >
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setActiveColorSlot(index)}
                      className="w-8 h-8 rounded-lg border-2 border-white/20 shadow-sm shrink-0 hover:scale-105 transition-transform"
                      style={{ background: hex }}
                      title={`${label} — ${hex.toUpperCase()}`}
                    />
                    <div>
                      <p className="text-sm font-semibold text-bolt-elements-textPrimary">{label}</p>
                      <p className="text-[11px] text-bolt-elements-textTertiary">{ROLE_HINTS[index]}</p>
                    </div>
                    <span className="font-mono text-[11px] text-bolt-elements-textSecondary ml-auto">
                      {hex.toUpperCase()}
                    </span>
                    <button
                      onClick={() => setActiveColorSlot(index)}
                      className="text-[10px] text-accent-500 dark:text-accent-300 hover:text-accent-600 dark:hover:text-accent-200 underline underline-offset-1 transition-colors shrink-0"
                    >
                      edit
                    </button>
                  </div>
                  <div className="flex gap-px rounded-md overflow-hidden">
                    {shades.map((shade, i) => (
                      <div
                        key={i}
                        title={`${SHADE_LABELS[i]} — ${shade}`}
                        onClick={() => handleColorChange(index, shade)}
                        className="w-full h-7 rounded-sm hover:scale-110 transition-transform cursor-pointer"
                        style={{ background: shade }}
                      >
                        <span className="text-[8px] text-white/70 leading-none block text-center mt-1.5 drop-shadow-sm">
                          {SHADE_LABELS[i]}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={() => setStep(QUESTIONS.length + 1)}
              className="text-sm text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary underline underline-offset-2 transition-colors"
            >
              Skip — use defaults
            </button>
            <button
              onClick={() => setStep(QUESTIONS.length + 1)}
              className="ml-auto rounded-xl bg-accent-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-600 transition-colors"
            >
              Use these colors →
            </button>
          </div>

          {activeColorSlot !== null && (
            <SwatchPopup
              role={ROLE_LABELS[activeColorSlot]}
              current={palette[activeColorSlot]}
              onPick={hex => {
                handleColorChange(activeColorSlot, hex);
                setActiveColorSlot(null);
              }}
              onClose={() => setActiveColorSlot(null)}
            />
          )}
        </div>
      )}

      {/* Context step — fill in the blanks */}
      {!complete && step === QUESTIONS.length + 1 && (
        <div className="space-y-4">
          <h3 className="text-xl font-semibold text-bolt-elements-textPrimary">Tell us about your app</h3>
          <p className="text-sm text-bolt-elements-textSecondary">
            Fill in the blanks — click each highlighted word to choose, or type your own.
          </p>
          <FillBlanks
            template={FILL_BLANKS_TEMPLATES[answers.app_type || '']}
            onContinue={sentence => {
              setContext(sentence);
              completeFlow();
            }}
          />
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

      <CompanyContextModal open={contextModalOpen} onOpenChange={handleContextModalChange} />
    </div>
  );
}
