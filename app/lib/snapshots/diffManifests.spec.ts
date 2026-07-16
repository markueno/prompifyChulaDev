import { describe, expect, it } from 'vitest';
import { diffManifests, summarizeChanges } from './diffManifests';

describe('diffManifests', () => {
  it('reports no change when manifests are identical (order-insensitive)', () => {
    const m = { 'src/a.ts': 'aaa', 'src/b.ts': 'bbb' };
    const reordered = { 'src/b.ts': 'bbb', 'src/a.ts': 'aaa' };

    const diff = diffManifests(m, reordered);

    expect(diff.changed).toBe(false);
    expect(diff.added).toEqual([]);
    expect(diff.modified).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.summary).toBe('');
  });

  it('detects added paths', () => {
    const diff = diffManifests({ 'src/a.ts': 'aaa' }, { 'src/a.ts': 'aaa', 'src/b.ts': 'bbb' });

    expect(diff.changed).toBe(true);
    expect(diff.added).toEqual(['src/b.ts']);
    expect(diff.modified).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it('detects modified paths (hash changed)', () => {
    const diff = diffManifests({ 'src/a.ts': 'aaa' }, { 'src/a.ts': 'ccc' });

    expect(diff.changed).toBe(true);
    expect(diff.modified).toEqual(['src/a.ts']);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it('detects removed paths', () => {
    const diff = diffManifests({ 'src/a.ts': 'aaa', 'src/b.ts': 'bbb' }, { 'src/a.ts': 'aaa' });

    expect(diff.changed).toBe(true);
    expect(diff.removed).toEqual(['src/b.ts']);
  });

  it('handles a mixed diff and produces a summary', () => {
    const diff = diffManifests(
      { 'src/App.tsx': 'old', 'src/removed.ts': 'gone', 'src/index.css': 'css1' },
      { 'src/App.tsx': 'new', 'src/index.css': 'css1', 'src/new.ts': 'fresh' },
    );

    expect(diff.changed).toBe(true);
    expect(diff.added).toEqual(['src/new.ts']);
    expect(diff.modified).toEqual(['src/App.tsx']);
    expect(diff.removed).toEqual(['src/removed.ts']);
    expect(diff.summary).toContain('App.tsx');
    expect(diff.summary).toContain('+1');
    expect(diff.summary).toContain('-1');
  });

  it('treats null/undefined manifests as empty', () => {
    expect(diffManifests(null, undefined).changed).toBe(false);
    expect(diffManifests({}, null).changed).toBe(false);
  });

  it('reports change going from empty to populated', () => {
    const diff = diffManifests({}, { 'src/a.ts': 'aaa' });

    expect(diff.changed).toBe(true);
    expect(diff.added).toEqual(['src/a.ts']);
  });

  it('reports change going from populated to empty (all removed)', () => {
    const diff = diffManifests({ 'src/a.ts': 'aaa' }, {});

    expect(diff.changed).toBe(true);
    expect(diff.removed).toEqual(['src/a.ts']);
    expect(diff.summary).toContain('Removed');
  });
});

describe('summarizeChanges', () => {
  it('returns empty string for no changes', () => {
    expect(summarizeChanges([], [], [])).toBe('');
  });

  it('uses basenames and truncates beyond 3 edited files', () => {
    const added = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'];
    const summary = summarizeChanges(added, [], []);

    expect(summary).toContain('a.ts, b.ts, c.ts');
    expect(summary).toContain('+1');
  });
});
