export type QuestionType = 'options' | 'color' | 'fillblanks' | 'designInspiration' | 'text';

export interface PromptData {
  [key: string]: string;
}

export interface Option {
  id: string;
  label: string;
  description: string;
  prompt?: PromptData;
}

export interface BlankDefinition {
  id: string;
  options: string[];
}

export interface FillBlanksTemplate {
  parts: string[];
  blanks: BlankDefinition[];
}

export interface Brand {
  id: string;
  label: string;
  tagline: string;
}

export interface Question {
  id: string;
  label: string;
  description: string;
  type?: QuestionType;
  options?: Option[];
  templates?: Record<string, FillBlanksTemplate>;
  brands?: Brand[];
  maxSelect?: number;
  placeholder?: string;
}

export interface ColorSlot {
  role: string;
  hex: string | null;
}

export interface ColorsAnswer {
  noPreference: boolean;
  slots: ColorSlot[];
}

export interface DesignInspirationAnswer {
  brands: string[];
  content: Record<string, string>;
}

export type AnswerValue = string | ColorsAnswer | DesignInspirationAnswer;

export interface Answers {
  [questionId: string]: AnswerValue;
}

export type FlowPhase = 'primary' | 'secondary' | 'preview';

export interface FlowState {
  phase: FlowPhase;
  primaryStep: number;
  secondaryStep: number;
  primaryAnswers: Answers;
  secondaryAnswers: Answers;
  colorSlots: ColorSlot[];
  refineQuestions: Question[];
}

export type FlowAction =
  | { type: 'SELECT_OPTION'; questionId: string; optionId: string; phase: FlowPhase }
  | { type: 'SET_COLORS'; answer: ColorsAnswer }
  | { type: 'SET_FILL_BLANKS'; text: string }
  | { type: 'SET_DESIGN_INSPIRATION'; answer: DesignInspirationAnswer }
  | { type: 'SET_TEXT'; questionId: string; text: string }
  | { type: 'BACK' }
  | { type: 'RESET' }
  | { type: 'EDIT_PRIMARY'; index: number }
  | { type: 'EDIT_SECONDARY'; index: number };
