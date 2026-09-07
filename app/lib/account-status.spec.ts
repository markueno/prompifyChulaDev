import { describe, it, expect } from 'vitest';
import {
  ACCOUNT_STATUSES,
  SUPPORT_EMAIL,
  canPrompt,
  canResetPassword,
  capabilitiesFor,
  parseAccountStatus,
  statusLabel,
  statusNotice,
} from './account-status';

/**
 * The capability matrix is enforced in four unrelated places — the chat gate, the password-reset
 * route, the admin console and the app layout. A rule that disagrees with itself between two of
 * them is a security bug rather than a cosmetic one, so the matrix itself is pinned here.
 */
describe('account status', () => {
  describe('what each status may do', () => {
    it('lets an active account do everything', () => {
      expect(capabilitiesFor('active')).toMatchObject({
        canSignIn: true,
        canPrompt: true,
        canResetPassword: true,
      });
    });

    it('stops an inactive account prompting, but leaves password recovery alone', () => {
      expect(canPrompt('inactive')).toBe(false);
      expect(canResetPassword('inactive')).toBe(true);
    });

    it('stops a suspended account prompting AND recovering its password', () => {
      expect(canPrompt('suspended')).toBe(false);
      expect(canResetPassword('suspended')).toBe(false);
    });

    /*
     * Deliberate: someone locked out cannot read the notice explaining why, and their own work is
     * not what is being withheld. The restriction is on prompting, not on the door.
     */
    it('lets every status sign in', () => {
      for (const status of ACCOUNT_STATUSES) {
        expect(capabilitiesFor(status).canSignIn).toBe(true);
      }
    });

    it('only active may prompt', () => {
      expect(ACCOUNT_STATUSES.filter(canPrompt)).toEqual(['active']);
    });
  });

  describe('parsing', () => {
    it('accepts the known statuses', () => {
      for (const status of ACCOUNT_STATUSES) {
        expect(parseAccountStatus(status)).toBe(status);
      }
    });

    /*
     * Fails OPEN on purpose. This parses values coming out of the database; a typo or a status
     * added by a future migration must not silently lock every account out of the product.
     */
    it('falls back to active for anything unrecognised', () => {
      for (const bad of ['deleted', 'ACTIVE', '', null, undefined, 7, {}]) {
        expect(parseAccountStatus(bad)).toBe('active');
      }
    });
  });

  describe('the notice', () => {
    it('says nothing to an active account', () => {
      expect(statusNotice('active')).toBeNull();
    });

    it('tells a restricted account who to contact', () => {
      for (const status of ['inactive', 'suspended'] as const) {
        const notice = statusNotice(status);
        expect(notice).not.toBeNull();
        expect(notice!.body).toContain(SUPPORT_EMAIL);
      }
    });

    /*
     * "Temporarily" is doing real work: a restriction that reads as permanent is one the customer
     * responds to by leaving rather than by getting in touch.
     */
    it('frames both restrictions as temporary', () => {
      for (const status of ['inactive', 'suspended'] as const) {
        expect(statusNotice(status)!.title.toLowerCase()).toContain('temporarily');
      }
    });

    it('reassures a suspended customer their subscription is intact', () => {
      expect(statusNotice('suspended')!.body.toLowerCase()).toContain('subscription');
    });
  });

  it('gives every status a human label for the admin console', () => {
    for (const status of ACCOUNT_STATUSES) {
      expect(statusLabel(status).length).toBeGreaterThan(0);
    }
  });
});
