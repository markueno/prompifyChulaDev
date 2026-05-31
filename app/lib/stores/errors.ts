import { atom } from 'nanostores';
import type { AppError, ErrorLevel, ErrorSource } from '~/types/actions';

const MAX_ERRORS = 20;

// Patterns that likely indicate sensitive data — redact before storing
const SENSITIVE_PATTERN = /\b(sk-[A-Za-z0-9]{20,}|Bearer\s+\S+|password\s*[=:]\s*\S+|token\s*[=:]\s*\S+)/gi;

export function sanitizeErrorText(raw: string): string {
  return raw.replace(SENSITIVE_PATTERN, '[REDACTED]').slice(0, 2048);
}

function makeFingerprint(source: string, message: string, file?: string, line?: number): string {
  return `${source}|${file ?? ''}|${line ?? ''}|${message.slice(0, 120)}`;
}

export function parseFileAndLine(stack?: string): { file?: string; line?: number } {
  if (!stack) {
    return {};
  }

  const match = stack.match(/([^\s(]+\.(?:tsx?|jsx?)):(\d+)/);

  if (!match) {
    return {};
  }

  return { file: match[1], line: parseInt(match[2], 10) };
}

export const errorsStore = atom<AppError[]>([]);

export function addError(opts: {
  source: ErrorSource;
  level: ErrorLevel;
  message: string;
  stack?: string;
  file?: string;
  line?: number;
}): void {
  const message = sanitizeErrorText(opts.message);
  const fp = makeFingerprint(opts.source, message, opts.file, opts.line);
  const current = errorsStore.get();

  // Skip if an active (unfixed) entry with the same fingerprint already exists
  const alreadyTracked = current.some(
    (e) => e.fingerprint === fp && e.status !== 'fixed' && e.status !== 'ignored',
  );

  if (alreadyTracked) {
    return;
  }

  const entry: AppError = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
    source: opts.source,
    level: opts.level,
    message,
    stack: opts.stack ? sanitizeErrorText(opts.stack) : undefined,
    file: opts.file,
    line: opts.line,
    status: 'new',
    fixAttempts: 0,
    fingerprint: fp,
  };

  // Rolling window — drop the oldest entry if at cap
  const base = current.length >= MAX_ERRORS ? current.slice(-(MAX_ERRORS - 1)) : [...current];
  errorsStore.set([...base, entry]);
}

export function updateErrorStatus(id: string, status: AppError['status']): void {
  errorsStore.set(errorsStore.get().map((e) => (e.id === id ? { ...e, status } : e)));
}

export function incrementFixAttempts(id: string): void {
  errorsStore.set(errorsStore.get().map((e) => (e.id === id ? { ...e, fixAttempts: e.fixAttempts + 1 } : e)));
}

export function clearFixed(): void {
  errorsStore.set(errorsStore.get().filter((e) => e.status !== 'fixed'));
}

export function clearAll(): void {
  errorsStore.set([]);
}

export function getActiveErrors(): AppError[] {
  return errorsStore.get().filter((e) => e.status === 'new' || e.status === 'fixing');
}
