import { describe, it, expect } from 'vitest';
import {
  ASSIGNABLE_PROJECT_ROLES,
  canBuildInProject,
  canManageProjectMembers,
  canSeeProjectInternals,
  isAssignableProjectRole,
  isProjectOwner,
  normalizeProjectRole,
} from './project-roles';

describe('normalizeProjectRole', () => {
  it("reads the legacy 'member' as editor", () => {
    /*
     * Every project invitation sent before roles existed granted 'member', and told the recipient
     * they were getting the chat history, code and preview. Reading it as anything weaker would
     * take away access people already have.
     */
    expect(normalizeProjectRole('member')).toBe('editor');
    expect(canSeeProjectInternals('member')).toBe(true);
    expect(canBuildInProject('member')).toBe(true);
  });

  it('passes the four real roles through', () => {
    for (const role of ['owner', 'admin', 'editor', 'viewer'] as const) {
      expect(normalizeProjectRole(role)).toBe(role);
    }
  });

  it('rejects anything else rather than guessing', () => {
    expect(normalizeProjectRole('superuser')).toBeNull();
    expect(normalizeProjectRole('')).toBeNull();
    expect(normalizeProjectRole(null)).toBeNull();
    expect(normalizeProjectRole(undefined)).toBeNull();
  });
});

describe('what each role may do', () => {
  it('lets a viewer see the running app and nothing else', () => {
    expect(canSeeProjectInternals('viewer')).toBe(false);
    expect(canBuildInProject('viewer')).toBe(false);
    expect(canManageProjectMembers('viewer')).toBe(false);
  });

  it('lets an editor build and read, but not manage people', () => {
    expect(canBuildInProject('editor')).toBe(true);
    expect(canSeeProjectInternals('editor')).toBe(true);
    expect(canManageProjectMembers('editor')).toBe(false);
  });

  it('lets an admin manage people as well', () => {
    expect(canManageProjectMembers('admin')).toBe(true);
    expect(canBuildInProject('admin')).toBe(true);
  });

  it('grants nothing at all to an unknown or absent role', () => {
    for (const role of [null, undefined, '', 'nonsense']) {
      expect(canBuildInProject(role)).toBe(false);
      expect(canSeeProjectInternals(role)).toBe(false);
      expect(canManageProjectMembers(role)).toBe(false);
      expect(isProjectOwner(role)).toBe(false);
    }
  });
});

describe('assignable roles', () => {
  it('never offers owner, which would be a transfer rather than a grant', () => {
    expect(ASSIGNABLE_PROJECT_ROLES).not.toContain('owner');
    expect(isAssignableProjectRole('owner')).toBe(false);
  });

  it('accepts exactly admin, editor and viewer', () => {
    expect(ASSIGNABLE_PROJECT_ROLES).toEqual(['admin', 'editor', 'viewer']);
    expect(isAssignableProjectRole('editor')).toBe(true);

    // 'member' is readable for existing rows but must not be assignable to anyone new.
    expect(isAssignableProjectRole('member')).toBe(false);
  });
});
