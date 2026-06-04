import { useReducer, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { primaryQuestions, buildRefineQuestions } from '~/lib/questionnaire/data';
import { buildPrimaryPrompt, buildRefinedPrompt } from '~/lib/questionnaire/engine';
import type {
  FlowState,
  FlowAction,
  ColorSlot,
  ColorsAnswer,
  DesignInspirationAnswer,
  Question,
} from '~/lib/questionnaire/types';
import { ProgressBar } from './ProgressBar';
import { AnswerSidebar } from './AnswerSidebar';
import { OptionGrid } from './OptionCard';
import { ColorPicker } from './ColorPicker';
import { FillBlanks } from './FillBlanks';
import { DesignInspiration } from './DesignInspiration';
import { PromptPreview } from './PromptPreview';

// ── Constants ─────────────────────────────────────────────────

const DEFAULT_COLOR_SLOTS: ColorSlot[] = [
  { role: 'Primary', hex: null },
  { role: 'Secondary', hex: null },
  { role: 'Accent', hex: null },
];

const initialState: FlowState = {
  phase: 'primary',
  primaryStep: 0,
  secondaryStep: 0,
  primaryAnswers: {},
  secondaryAnswers: {},
  colorSlots: DEFAULT_COLOR_SLOTS,
  refineQuestions: buildRefineQuestions(''),
};

// ── Reducer ───────────────────────────────────────────────────

function advance(step: number, total: number): { nextStep: number; done: boolean } {
  const nextStep = step + 1;
  return { nextStep, done: nextStep >= total };
}

function reducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case 'SELECT_OPTION': {
      if (action.phase === 'primary') {
        const newAnswers = { ...state.primaryAnswers, [action.questionId]: action.optionId };
        let refineQuestions = state.refineQuestions;

        if (action.questionId === 'app_type') {
          refineQuestions = buildRefineQuestions(action.optionId);
        }

        const { nextStep, done } = advance(state.primaryStep, primaryQuestions.length);

        return {
          ...state,
          primaryAnswers: newAnswers,
          refineQuestions,
          phase: done ? 'secondary' : 'primary',
          primaryStep: done ? state.primaryStep : nextStep,
          secondaryStep: done ? 0 : state.secondaryStep,
        };
      } else {
        const newAnswers = { ...state.secondaryAnswers, [action.questionId]: action.optionId };
        const { nextStep, done } = advance(state.secondaryStep, state.refineQuestions.length);

        return {
          ...state,
          secondaryAnswers: newAnswers,
          phase: done ? 'preview' : 'secondary',
          secondaryStep: done ? state.secondaryStep : nextStep,
        };
      }
    }

    case 'SET_COLORS': {
      const newAnswers = { ...state.primaryAnswers, colors: action.answer };
      const { nextStep, done } = advance(state.primaryStep, primaryQuestions.length);

      return {
        ...state,
        primaryAnswers: newAnswers,
        colorSlots: action.answer.slots,
        phase: done ? 'secondary' : 'primary',
        primaryStep: done ? state.primaryStep : nextStep,
        secondaryStep: done ? 0 : state.secondaryStep,
      };
    }

    case 'SET_FILL_BLANKS': {
      const currentQ = primaryQuestions[state.primaryStep];
      const newAnswers = { ...state.primaryAnswers, [currentQ.id]: action.text };
      const { nextStep, done } = advance(state.primaryStep, primaryQuestions.length);

      return {
        ...state,
        primaryAnswers: newAnswers,
        phase: done ? 'secondary' : 'primary',
        primaryStep: done ? state.primaryStep : nextStep,
        secondaryStep: done ? 0 : state.secondaryStep,
      };
    }

    case 'SET_DESIGN_INSPIRATION': {
      if (action.phase === 'primary') {
        const currentQ = primaryQuestions[state.primaryStep];
        const newAnswers = { ...state.primaryAnswers, [currentQ.id]: action.answer };
        const { nextStep, done } = advance(state.primaryStep, primaryQuestions.length);

        return {
          ...state,
          primaryAnswers: newAnswers,
          phase: done ? 'secondary' : 'primary',
          primaryStep: done ? state.primaryStep : nextStep,
          secondaryStep: done ? 0 : state.secondaryStep,
        };
      }

      const currentQ = state.refineQuestions[state.secondaryStep];
      const newAnswers = { ...state.secondaryAnswers, [currentQ.id]: action.answer };
      const { nextStep, done } = advance(state.secondaryStep, state.refineQuestions.length);

      return {
        ...state,
        secondaryAnswers: newAnswers,
        phase: done ? 'preview' : 'secondary',
        secondaryStep: done ? state.secondaryStep : nextStep,
      };
    }

    case 'SET_TEXT': {
      const newAnswers = { ...state.secondaryAnswers, [action.questionId]: action.text };
      const { nextStep, done } = advance(state.secondaryStep, state.refineQuestions.length);

      return {
        ...state,
        secondaryAnswers: newAnswers,
        phase: done ? 'preview' : 'secondary',
        secondaryStep: done ? state.secondaryStep : nextStep,
      };
    }

    case 'BACK': {
      if (state.phase === 'preview') {
        return { ...state, phase: 'secondary' };
      }

      if (state.phase === 'secondary') {
        if (state.secondaryStep > 0) {
          return { ...state, secondaryStep: state.secondaryStep - 1 };
        }

        return { ...state, phase: 'primary', primaryStep: primaryQuestions.length - 1 };
      }

      if (state.primaryStep > 0) {
        return { ...state, primaryStep: state.primaryStep - 1 };
      }

      return state;
    }

    case 'RESET': {
      return { ...initialState };
    }

    case 'EDIT_PRIMARY': {
      return { ...state, phase: 'primary', primaryStep: action.index };
    }

    case 'EDIT_SECONDARY': {
      return { ...state, phase: 'secondary', secondaryStep: action.index };
    }

    default:
      return state;
  }
}

// ── TextQuestion ──────────────────────────────────────────────

interface TextQuestionProps {
  questionId: string;
  placeholder?: string;
  initialValue?: string;
  onContinue: (text: string) => void;
}

function TextQuestion({ placeholder, initialValue = '', onContinue }: TextQuestionProps) {
  const [value, setValue] = useState(initialValue);

  return (
    <div className="space-y-4">
      <textarea
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder={placeholder ?? 'Type your answer here…'}
        rows={5}
        className="w-full px-4 py-3 rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-bg-depth-2 text-bolt-elements-textPrimary text-sm placeholder:text-bolt-elements-textTertiary focus:outline-none focus:border-accent-500 resize-none leading-relaxed"
      />
      <div className="flex items-center gap-3">
        <button
          onClick={() => onContinue('')}
          className="text-sm text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary underline underline-offset-2 transition-colors"
        >
          Skip
        </button>
        <button
          onClick={() => onContinue(value.trim())}
          className="ml-auto px-5 py-2.5 rounded-xl bg-accent-500 text-white text-sm font-semibold hover:bg-accent-600 transition-colors"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}

// ── QuestionFlow ──────────────────────────────────────────────

export function QuestionFlow() {
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(reducer, initialState);
  const [colorSlots, setColorSlots] = useState<ColorSlot[]>(DEFAULT_COLOR_SLOTS);

  const activePhase = state.phase === 'preview' ? 'secondary' : state.phase;
  const isPreview = state.phase === 'preview';

  const activePrimaryQ: Question = primaryQuestions[state.primaryStep];
  const activeSecondaryQ: Question | undefined =
    state.phase === 'secondary' ? state.refineQuestions[state.secondaryStep] : undefined;

  const canGoBack = isPreview || state.phase === 'secondary' || (state.phase === 'primary' && state.primaryStep > 0);

  function handleReset() {
    dispatch({ type: 'RESET' });
    setColorSlots(DEFAULT_COLOR_SLOTS);
  }

  function renderQuestion() {
    if (isPreview) {
      const primaryPrompt = buildPrimaryPrompt(state.primaryAnswers);
      const refinedPrompt = buildRefinedPrompt(state.primaryAnswers, state.secondaryAnswers);

      return (
        <PromptPreview
          primaryPrompt={primaryPrompt}
          refinedPrompt={refinedPrompt}
          onStartBuilding={() => navigate('/')}
          onReset={handleReset}
        />
      );
    }

    if (state.phase === 'primary') {
      const q = activePrimaryQ;

      if (!q.type || q.type === 'options') {
        return (
          <OptionGrid
            options={q.options ?? []}
            selectedId={state.primaryAnswers[q.id] as string | undefined}
            onSelect={optionId => dispatch({ type: 'SELECT_OPTION', questionId: q.id, optionId, phase: 'primary' })}
          />
        );
      }

      if (q.type === 'color') {
        return (
          <ColorPicker
            slots={colorSlots}
            onSlotsChange={setColorSlots}
            onContinue={(answer: ColorsAnswer) => {
              setColorSlots(answer.slots);
              dispatch({ type: 'SET_COLORS', answer });
            }}
          />
        );
      }

      if (q.type === 'designInspiration') {
        const existing = state.primaryAnswers[q.id] as DesignInspirationAnswer | undefined;
        return (
          <DesignInspiration
            brands={q.brands ?? []}
            maxSelect={q.maxSelect ?? 2}
            initialSelected={existing?.brands ?? []}
            onContinue={answer => dispatch({ type: 'SET_DESIGN_INSPIRATION', answer, phase: 'primary' })}
          />
        );
      }

      if (q.type === 'fillblanks') {
        const appType = (state.primaryAnswers.app_type as string) ?? '';
        const template = q.templates?.[appType];

        return <FillBlanks template={template} onContinue={text => dispatch({ type: 'SET_FILL_BLANKS', text })} />;
      }
    }

    if (state.phase === 'secondary' && activeSecondaryQ) {
      const q = activeSecondaryQ;

      if (!q.type || q.type === 'options') {
        return (
          <OptionGrid
            options={q.options ?? []}
            selectedId={state.secondaryAnswers[q.id] as string | undefined}
            onSelect={optionId => dispatch({ type: 'SELECT_OPTION', questionId: q.id, optionId, phase: 'secondary' })}
          />
        );
      }

      if (q.type === 'designInspiration') {
        const existing = state.secondaryAnswers[q.id] as DesignInspirationAnswer | undefined;
        return (
          <DesignInspiration
            brands={q.brands ?? []}
            maxSelect={q.maxSelect ?? 2}
            initialSelected={existing?.brands ?? []}
            onContinue={answer => dispatch({ type: 'SET_DESIGN_INSPIRATION', answer, phase: 'secondary' })}
          />
        );
      }

      if (q.type === 'text') {
        return (
          <TextQuestion
            key={q.id}
            questionId={q.id}
            placeholder={q.placeholder}
            initialValue={(state.secondaryAnswers[q.id] as string) ?? ''}
            onContinue={text => dispatch({ type: 'SET_TEXT', questionId: q.id, text })}
          />
        );
      }
    }

    return null;
  }

  const currentLabel = state.phase === 'primary' ? activePrimaryQ.label : (activeSecondaryQ?.label ?? '');
  const currentDescription =
    state.phase === 'primary' ? activePrimaryQ.description : (activeSecondaryQ?.description ?? '');

  return (
    <div className="flex flex-col h-full bg-bolt-elements-background-depth-1">
      {!isPreview && (
        <ProgressBar
          answered={
            activePhase === 'primary'
              ? Object.keys(state.primaryAnswers).length
              : Object.keys(state.secondaryAnswers).length
          }
          total={activePhase === 'primary' ? primaryQuestions.length : state.refineQuestions.length}
          phase={activePhase}
        />
      )}

      <div className="flex flex-1 min-h-0">
        <main className="flex-1 overflow-y-auto px-6 py-5">
          {canGoBack && (
            <button
              onClick={() => dispatch({ type: 'BACK' })}
              className="mb-5 flex items-center gap-1.5 text-xs text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M7.5 2L3.5 6L7.5 10"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Back
            </button>
          )}

          {!isPreview && (
            <div className="mb-6">
              <h2 className="text-xl font-bold text-bolt-elements-textPrimary mb-1.5 leading-snug">{currentLabel}</h2>
              <p className="text-sm text-bolt-elements-textSecondary leading-relaxed">{currentDescription}</p>
            </div>
          )}

          {isPreview && (
            <div className="mb-6">
              <h2 className="text-xl font-bold text-bolt-elements-textPrimary mb-1.5">Your prompts are ready</h2>
              <p className="text-sm text-bolt-elements-textSecondary">
                Copy Prompt 1, paste it into any AI, then follow with Prompt 2.
              </p>
            </div>
          )}

          {renderQuestion()}
        </main>

        {!isPreview && (
          <AnswerSidebar
            questions={activePhase === 'primary' ? primaryQuestions : state.refineQuestions}
            answers={activePhase === 'primary' ? state.primaryAnswers : state.secondaryAnswers}
            phase={activePhase}
            onEdit={index => {
              if (activePhase === 'primary') {
                dispatch({ type: 'EDIT_PRIMARY', index });
              } else {
                dispatch({ type: 'EDIT_SECONDARY', index });
              }
            }}
          />
        )}
      </div>
    </div>
  );
}
