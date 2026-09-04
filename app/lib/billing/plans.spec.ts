import { describe, it, expect } from 'vitest';
import { PAID_PLANS, PLANS, FREE_TIER_ID, TRIAL_PROMPT_LIMIT, getPlan, plansForSegment } from './plans';

/**
 * The plan catalog drives what the pricing page renders.
 *
 * The failure this guards against is silent: the page renders one segment at a time, so a paid
 * plan with no `segment` is not a crash or a type error — it simply never appears on either
 * toggle, and nobody can buy it until someone notices the revenue gap.
 */
describe('plan catalog', () => {
  it('gives every purchasable plan a segment, so none can vanish from the pricing page', () => {
    const orphaned = PAID_PLANS.filter(p => !p.segment).map(p => p.tierId);
    expect(orphaned).toEqual([]);
  });

  it('splits the segments without losing or duplicating a plan', () => {
    const shown = [...plansForSegment('user'), ...plansForSegment('enterprise')].map(p => p.tierId);

    expect(shown.slice().sort()).toEqual(PAID_PLANS.map(p => p.tierId).sort());
    expect(new Set(shown).size).toBe(shown.length);
  });

  it('puts the solo and small-team plans under User', () => {
    expect(plansForSegment('user').map(p => p.tierId)).toEqual(['tier_builder', 'tier_innovator', 'tier_team']);
  });

  it('puts the large plans under Enterprise', () => {
    expect(plansForSegment('enterprise').map(p => p.tierId)).toEqual(['tier_business', 'tier_scale']);
  });

  describe('the free trial', () => {
    it('resolves as a tier, because subscriptions rows carry its id', () => {
      expect(getPlan(FREE_TIER_ID)).toBeDefined();
    });

    it('is never purchasable and never rendered as a card', () => {
      expect(PAID_PLANS.map(p => p.tierId)).not.toContain(FREE_TIER_ID);
      expect(getPlan(FREE_TIER_ID)?.segment).toBeUndefined();
    });

    it('is the only free plan — a second one would render as a card with a $0 Subscribe button', () => {
      expect(PLANS.filter(p => p.priceCents === 0).map(p => p.tierId)).toEqual([FREE_TIER_ID]);
    });

    it('grants a usable number of prompts', () => {
      expect(TRIAL_PROMPT_LIMIT).toBeGreaterThan(0);
    });
  });

  it('prices annual below twelve months, or the "2 months free" copy is a lie', () => {
    for (const plan of PAID_PLANS) {
      expect(plan.priceAnnualCents).toBeLessThan(plan.priceCents * 12);
    }
  });
});
