import { describe, it, expect } from 'vitest';
import { STARTER_TEMPLATES } from '~/utils/constants';
import { VERTICAL_TEMPLATES, templateForVertical } from './vertical';

/**
 * The mapping is referenced by name, and a name that matches no template fails silently —
 * getTemplates returns null and the build quietly starts from blank instead. That is the failure
 * worth a test: it looks like nothing went wrong.
 */
describe('VERTICAL_TEMPLATES', () => {
  it('maps every vertical to a template that actually exists', () => {
    const names = new Set(STARTER_TEMPLATES.map(t => t.name));

    for (const [vertical, template] of Object.entries(VERTICAL_TEMPLATES)) {
      expect(names, `${vertical} maps to "${template}", which is not in STARTER_TEMPLATES`).toContain(template);
    }
  });

  it('covers all six verticals the wizard offers', () => {
    expect(Object.keys(VERTICAL_TEMPLATES).sort()).toEqual([
      'appointment',
      'crm',
      'hr',
      'inventory',
      'knowledge',
      'landing',
    ]);
  });

  it('only maps to templates the system prompt can actually preview', () => {
    /*
     * prompts.ts requires a vite.config.ts binding host and port 5173, so a mapped template has to
     * be a Vite one. This is what stops a well-meaning change pointing a vertical at the Next.js
     * or Astro starter, which would break the preview rather than merely look different.
     */
    for (const [vertical, name] of Object.entries(VERTICAL_TEMPLATES)) {
      const template = STARTER_TEMPLATES.find(t => t.name === name);

      expect(template?.tags, `${vertical} maps to "${name}", which is not tagged vite`).toContain('vite');
    }
  });
});

describe('templateForVertical', () => {
  it('returns the mapped template for a known vertical', () => {
    expect(templateForVertical('crm')).toBe(VERTICAL_TEMPLATES.crm);
  });

  it('returns null when no vertical was chosen, so the LLM selector still runs', () => {
    expect(templateForVertical(null)).toBeNull();
  });

  it('returns null for an unrecognised vertical rather than guessing', () => {
    expect(templateForVertical('accounting')).toBeNull();
    expect(templateForVertical('')).toBeNull();
  });
});
