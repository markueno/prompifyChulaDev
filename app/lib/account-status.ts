/**
 * Account status and what each one is allowed to do.
 *
 * The rules live here rather than being spelled out at each call site, because they are enforced
 * in four unrelated places — login, the chat gate, the password-reset route and the app UI — and
 * a permission that disagrees with itself between two of them is a security bug, not a cosmetic
 * one. Adding a status means adding one row to CAPABILITIES and nothing else.
 *
 * Safe to import on the client: no secrets, no database access.
 */

export type AccountStatus = 'active' | 'inactive' | 'suspended';

export const ACCOUNT_STATUSES: AccountStatus[] = ['active', 'inactive', 'suspended'];

interface StatusCapabilities {
  /** May sign in at all. All three currently may — the restrictions bite after sign-in. */
  canSignIn: boolean;
  /** May send a prompt to the builder. */
  canPrompt: boolean;
  /** May request a password-reset email. */
  canResetPassword: boolean;
  /** Shown in the admin console and on the blocked notice. */
  label: string;
}

/*
 * A deliberate ladder rather than a binary: `inactive` is the reversible warning and keeps the
 * account able to recover its own password, `suspended` is the harder stop and does not.
 *
 * Neither blocks sign-in. Locking someone out of their own work is a heavier punishment than
 * intended, and someone who cannot get in cannot read the notice explaining why.
 */
const CAPABILITIES: Record<AccountStatus, StatusCapabilities> = {
  active: {
    canSignIn: true,
    canPrompt: true,
    canResetPassword: true,
    label: 'Active',
  },
  inactive: {
    canSignIn: true,
    canPrompt: false,
    canResetPassword: true,
    label: 'Inactive',
  },
  suspended: {
    canSignIn: true,
    canPrompt: false,
    canResetPassword: false,
    label: 'Suspended',
  },
};

/** Unknown values resolve to `active`: a typo in the database must not lock people out. */
export function parseAccountStatus(value: unknown): AccountStatus {
  return ACCOUNT_STATUSES.includes(value as AccountStatus) ? (value as AccountStatus) : 'active';
}

export function capabilitiesFor(status: AccountStatus): StatusCapabilities {
  return CAPABILITIES[status];
}

export function canPrompt(status: AccountStatus): boolean {
  return CAPABILITIES[status].canPrompt;
}

export function canResetPassword(status: AccountStatus): boolean {
  return CAPABILITIES[status].canResetPassword;
}

export function statusLabel(status: AccountStatus): string {
  return CAPABILITIES[status].label;
}

/** Where a restricted account is told to go. Kept here so every surface quotes the same address. */
export const SUPPORT_EMAIL = 'mark@prompify.com';

/**
 * The notice a restricted account sees. Deliberately says "temporarily" and names a person —
 * a dead end with no way out is what turns a billing or moderation action into a lost customer.
 */
export function statusNotice(status: AccountStatus): { title: string; body: string } | null {
  if (status === 'active') {
    return null;
  }

  if (status === 'inactive') {
    return {
      title: 'Your account is temporarily inactive',
      body: `You can still sign in and see everything you've built, but new prompts are paused for now. Get in touch at ${SUPPORT_EMAIL} and we'll sort it out.`,
    };
  }

  return {
    title: 'Your account is temporarily suspended',
    body: `You can still sign in and see everything you've built, but new prompts are paused. Your subscription and your projects are untouched. Please contact ${SUPPORT_EMAIL} to get this lifted.`,
  };
}
