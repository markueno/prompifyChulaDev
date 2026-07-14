import { describe, expect, it } from 'vitest';
import { formatDefaultValue } from './sqlDefaultValue';

describe('formatDefaultValue (H-3 — user-supplied DDL defaults)', () => {
  it('accepts allowlisted function defaults for their type only', () => {
    expect(formatDefaultValue('timestamptz', 'now()')).toBe('now()');
    expect(formatDefaultValue('timestamptz', 'NOW()')).toBe('now()');
    expect(formatDefaultValue('uuid', 'gen_random_uuid()')).toBe('gen_random_uuid()');
    expect(formatDefaultValue('text', 'now()')).toBe("'now()'"); // literal, not a function
    expect(formatDefaultValue('integer', 'gen_random_uuid()')).toBeNull();
  });

  it('validates numeric-ish types strictly', () => {
    expect(formatDefaultValue('integer', '42')).toBe('42');
    expect(formatDefaultValue('integer', '-7')).toBe('-7');
    expect(formatDefaultValue('integer', '1; DROP TABLE users')).toBeNull();
    expect(formatDefaultValue('numeric', '3.14')).toBe('3.14');
    expect(formatDefaultValue('numeric', '1e10')).toBeNull();
    expect(formatDefaultValue('boolean', 'TRUE')).toBe('true');
    expect(formatDefaultValue('boolean', '1=1')).toBeNull();
  });

  it('quotes and escapes text literals', () => {
    expect(formatDefaultValue('text', 'hello')).toBe("'hello'");
    expect(formatDefaultValue('text', "O'Brien")).toBe("'O''Brien'");
    expect(formatDefaultValue('text', "'); DROP TABLE users; --")).toBe("'''); DROP TABLE users; --'");
    expect(formatDefaultValue('text', 'a\x00b')).toBeNull();
  });

  it('validates uuid, jsonb and timestamptz literals', () => {
    expect(formatDefaultValue('uuid', '123E4567-E89B-12D3-A456-426614174000')).toBe(
      "'123e4567-e89b-12d3-a456-426614174000'",
    );
    expect(formatDefaultValue('uuid', 'not-a-uuid')).toBeNull();
    expect(formatDefaultValue('jsonb', '{"a": 1}')).toBe('\'{"a": 1}\'::jsonb');
    expect(formatDefaultValue('jsonb', '{oops')).toBeNull();
    expect(formatDefaultValue('timestamptz', '2026-01-01T00:00:00Z')).toBe("'2026-01-01T00:00:00Z'");
    expect(formatDefaultValue('timestamptz', 'yesterday(); DROP SCHEMA public')).toBeNull();
  });

  it('rejects unknown types', () => {
    expect(formatDefaultValue('bytea', 'x')).toBeNull();
  });
});
