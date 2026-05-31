import type { Change } from 'diff';

export type ActionType = 'file' | 'shell';

export interface BaseAction {
  content: string;
}

export interface FileAction extends BaseAction {
  type: 'file';
  filePath: string;
}

export interface ShellAction extends BaseAction {
  type: 'shell';
}

export interface StartAction extends BaseAction {
  type: 'start';
}

export interface BuildAction extends BaseAction {
  type: 'build';
}

export type BoltAction = FileAction | ShellAction | StartAction | BuildAction;

export type BoltActionData = BoltAction | BaseAction;

export interface ActionAlert {
  type: string;
  title: string;
  description: string;
  content: string;
  source?: 'terminal' | 'preview';
}

export type ErrorSource = 'terminal' | 'runtime' | 'console' | 'network' | 'build' | 'review';
export type ErrorLevel = 'error' | 'warn';
export type ErrorStatus = 'new' | 'fixing' | 'fixed' | 'ignored';

export interface AppError {
  id: string;
  timestamp: number;
  source: ErrorSource;
  level: ErrorLevel;
  message: string;
  stack?: string;
  file?: string;
  line?: number;
  status: ErrorStatus;
  fixAttempts: number;
  fingerprint: string;
}

export interface FileHistory {
  originalContent: string;
  lastModified: number;
  changes: Change[];
  versions: {
    timestamp: number;
    content: string;
  }[];

  // Novo campo para rastrear a origem das mudanças
  changeSource?: 'user' | 'auto-save' | 'external';
}
