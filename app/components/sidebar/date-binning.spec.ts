/*
 * binDates runs during render, and date-fns `format` throws RangeError on an Invalid Date — so a
 * single chat row with a missing or malformed timestamp used to take down the entire page via the
 * route error boundary, not just render badly. This pins the containment.
 */
import { describe, expect, it } from 'vitest';
import { binDates } from './date-binning';
import type { ChatHistoryItem } from '~/lib/persistence';

function chat(id: string, timestamp: unknown): ChatHistoryItem {
  return {
    id,
    urlId: id,
    description: `chat ${id}`,
    messages: [],
    timestamp: timestamp as string,
  };
}

describe('binDates', () => {
  it('does not throw on a missing or malformed timestamp', () => {
    const list = [chat('a', undefined), chat('b', 'not-a-date'), chat('c', new Date().toISOString())];

    expect(() => binDates(list)).not.toThrow();
  });

  it('keeps undated chats in the list rather than dropping them', () => {
    const bins = binDates([chat('a', undefined), chat('b', new Date().toISOString())]);
    const ids = bins.flatMap(b => b.items.map(i => i.id));

    expect(ids).toContain('a');
    expect(ids).toContain('b');
  });

  it('still bins a valid recent timestamp as Today', () => {
    const bins = binDates([chat('a', new Date().toISOString())]);
    expect(bins[0].category).toBe('Today');
  });
});
