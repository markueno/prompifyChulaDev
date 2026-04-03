/**
 * Contact fields are treated as plain text only: strip markup delimiters and C0 controls
 * so planted HTML/script cannot become active markup when stored or shown with text APIs.
 * Always use textContent / escaped output in UIs — never innerHTML with user input.
 */
const C0_EXCEPT_NEWLINE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const C0_ALL = /[\u0000-\u001F\u007F]/g;

/** Email field: block obvious scheme / handler abuse (still validate format separately). */
const UNSAFE_EMAILISH =
  /<\s*script|javascript:\s*|data:\s*text\/html|\bon\w+\s*=|<\s*iframe|vbscript:\s*/i;

export function normalizeContactPlainText(input: string, allowNewlines: boolean): string {
  let t = String(input);
  t = t.replace(/[<>]/g, '');
  if (allowNewlines) {
    t = t.replace(C0_EXCEPT_NEWLINE, '');
  } else {
    t = t.replace(C0_ALL, '');
  }
  return t.trim();
}

export function contactEmailLooksUnsafe(email: string): boolean {
  return UNSAFE_EMAILISH.test(email);
}
