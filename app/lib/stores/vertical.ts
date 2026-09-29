import { atom } from 'nanostores';

/**
 * The vertical the user picked in the prompting wizard — 'crm', 'inventory', 'hr', 'appointment',
 * 'knowledge', 'landing' — or null when they typed a free-form description instead.
 *
 * It exists because the wizard's answers were local `useState` and the component unmounts the
 * moment a chat starts, so the only thing that survived was the archetype prose baked into the
 * first message. Nothing downstream could tell which vertical had been chosen, which made a
 * vertical→template mapping impossible however good the notes got.
 *
 * A store rather than more props: the wizard renders inside BaseChat while the decision is needed
 * in Chat.client, and threading a third value up through both would touch a lot of signatures to
 * carry one string.
 */
export const selectedVertical = atom<string | null>(null);

/**
 * Which starter template each vertical should build on.
 *
 * Every one of them is React + Vite + TypeScript, and that is not laziness — the system prompt
 * requires a `vite.config.ts` binding host and port 5173 (prompts.ts), so anything else either has
 * no vite config at all (Next, Astro, Angular) or is the wrong framework for a business app
 * (Slidev, Qwik). Vite + React is the only entry that satisfies the preview loop.
 *
 * The point is therefore not variety, it is DETERMINISM. Template selection otherwise asks an LLM
 * to choose from eleven framework starters using the first 500 characters of the message — which,
 * for a wizard-built prompt, is almost entirely boilerplate before any description begins. A CRM
 * could be handed Slidev on that basis. A known vertical now skips the guess: no LLM round trip,
 * no tokens spent, and no chance of a presentation framework for an inventory system.
 *
 * Free-form prompts still go to the LLM selector, where the message really is the user's own words
 * and the truncation is harmless.
 */
export const VERTICAL_TEMPLATES: Record<string, string> = {
  crm: 'bolt-vite-react',
  inventory: 'bolt-vite-react',
  hr: 'bolt-vite-react',
  appointment: 'bolt-vite-react',
  knowledge: 'bolt-vite-react',
  landing: 'bolt-vite-react',
};

/** The template for a vertical, or null when the vertical is unknown or none was chosen. */
export function templateForVertical(verticalId: string | null): string | null {
  if (!verticalId) {
    return null;
  }

  return VERTICAL_TEMPLATES[verticalId] ?? null;
}
