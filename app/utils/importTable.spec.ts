import { describe, it, expect } from 'vitest';
import { sanitizeIdentifier, uniqueColumnNames, inferColumnType, buildImportPayload } from './importTable';

describe('sanitizeIdentifier', () => {
  it('lowercases and replaces spaces/hyphens', () => {
    expect(sanitizeIdentifier('First Name')).toBe('first_name');
    expect(sanitizeIdentifier('User-Email')).toBe('user_email');
  });

  it('strips non-alphanumeric except underscore', () => {
    expect(sanitizeIdentifier('a$b%c')).toBe('abc');
    expect(sanitizeIdentifier('col!@#')).toBe('col');
  });

  it('prefixes col_ when starting with a non-letter', () => {
    expect(sanitizeIdentifier('1st')).toBe('col_1st');
    expect(sanitizeIdentifier('_foo')).toBe('col__foo');
  });

  it('falls back to col_N for empty/all-stripped', () => {
    expect(sanitizeIdentifier('')).toBe('col_1');
    expect(sanitizeIdentifier('!!!')).toBe('col_1');
    expect(sanitizeIdentifier('', 5)).toBe('col_5');
  });

  it('truncates to 63 chars and trims trailing underscores', () => {
    const long = 'a'.repeat(100);

    expect(sanitizeIdentifier(long).length).toBeLessThanOrEqual(63);
    expect(sanitizeIdentifier('a'.repeat(100)).endsWith('_')).toBe(false);
  });

  it('rejects injection attempts', () => {
    expect(sanitizeIdentifier('users; DROP TABLE x;')).toBe('users_drop_table_x');
    expect(sanitizeIdentifier("a');--")).toBe('a');
  });
});

describe('uniqueColumnNames', () => {
  it('passes through unique names', () => {
    expect(uniqueColumnNames(['name', 'email', 'phone'])).toEqual(['name', 'email', 'phone']);
  });

  it('suffixed duplicates', () => {
    expect(uniqueColumnNames(['name', 'name', 'name'])).toEqual(['name', 'name_2', 'name_3']);
  });

  it('renames reserved names', () => {
    expect(uniqueColumnNames(['id', 'created_at', 'name'])).toEqual(['id_2', 'created_at_2', 'name']);
  });

  it('handles reserved collision with a real duplicate', () => {
    expect(uniqueColumnNames(['id', 'id'])).toEqual(['id_2', 'id_3']);
  });
});

describe('inferColumnType', () => {
  it('integer when all samples are integers', () => {
    expect(inferColumnType(['1', '42', '-7'])).toBe('integer');
  });

  it('numeric when decimals present', () => {
    expect(inferColumnType(['1', '2.5', '-3.14'])).toBe('numeric');
  });

  it('boolean for true/false', () => {
    expect(inferColumnType(['true', 'false', 'true'])).toBe('boolean');
  });

  it('timestamptz for ISO dates', () => {
    expect(inferColumnType(['2024-01-01', '2024-01-02T10:00:00Z'])).toBe('timestamptz');
  });

  it('text fallback for mixed', () => {
    expect(inferColumnType(['alice', 'bob'])).toBe('text');
  });

  it('text for all-empty', () => {
    expect(inferColumnType([null, '', null])).toBe('text');
  });

  it('samples at most 500 values', () => {
    const big = Array(1000).fill('1');
    expect(inferColumnType(big)).toBe('integer');
  });

  it('rejects exponent forms as integer', () => {
    expect(inferColumnType(['1e10'])).toBe('text');
  });
});

describe('buildImportPayload', () => {
  it('produces aligned columns and rows', () => {
    const result = buildImportPayload(
      ['Name', 'Age', 'Active'],
      [
        { Name: 'Alice', Age: '30', Active: 'true' },
        { Name: 'Bob', Age: '25', Active: 'false' },
      ],
      'users'
    );

    expect(result.tableName).toBe('users');
    expect(result.columns).toEqual([
      { name: 'name', type: 'text' },
      { name: 'age', type: 'integer' },
      { name: 'active', type: 'boolean' },
    ]);
    expect(result.rows).toEqual([
      ['Alice', 30, true],
      ['Bob', 25, false],
    ]);
  });

  it('sanitizes the table name from filename when not provided', () => {
    const result = buildImportPayload(['col1'], [{ col1: 'x' }]);

    expect(result.tableName).toBe('col1');
  });

  it('nulls empty cells, keeps raw string when type inference is weak', () => {
    const result = buildImportPayload(['Val'], [{ Val: '' }, { Val: 'hello' }]);

    expect(result.rows).toEqual([[null], ['hello']]);
  });
});
