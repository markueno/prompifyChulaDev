import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression cover for duplicating a chat.
 *
 * The bug this exists for: `pg` reads a jsonb column into a real JS value, and on the way back in
 * it serializes a plain object as JSON but an ARRAY as a Postgres array literal. Handing the
 * messages array straight from the SELECT to the INSERT therefore failed every time — and because
 * the error was caught and folded into the same null as "no such chat", it surfaced to the user as
 * `Chat not found`, which points at entirely the wrong thing.
 *
 * So there are two things worth holding onto here: messages and metadata go in as strings, and a
 * genuine failure is reported as a failure rather than as a miss.
 */

const state = vi.hoisted(() => ({
  calls: [] as { sql: string; params: any[] }[],
  sourceRows: [] as any[],
  takenUrlIds: [] as string[],
  insertThrows: false,
}));

vi.mock('pg', () => {
  class FakePoolClient {
    async query(sql: string, params: any[] = []) {
      state.calls.push({ sql, params });

      if (/SELECT c\.id, c\.project_id, c\.url_id, c\.description, c\.messages, c\.metadata/i.test(sql)) {
        return { rowCount: state.sourceRows.length, rows: state.sourceRows };
      }

      if (/SELECT 1 FROM chats WHERE url_id/i.test(sql)) {
        const taken = state.takenUrlIds.includes(params[0]);
        return { rowCount: taken ? 1 : 0, rows: taken ? [{ '?column?': 1 }] : [] };
      }

      if (/INSERT INTO chats/i.test(sql)) {
        if (state.insertThrows) {
          throw new Error('invalid input syntax for type json');
        }

        return { rowCount: 1, rows: [] };
      }

      return { rowCount: 1, rows: [] };
    }
    release() {}
  }

  class FakePool {
    on() {}
    async connect() {
      return new FakePoolClient();
    }
    async query(sql: string, params: any[] = []) {
      return new FakePoolClient().query(sql, params);
    }
  }

  return { default: { Pool: FakePool } };
});

import { duplicateChatPostgres } from './database-postgresql';

const chatInsert = () => state.calls.find(c => /INSERT INTO chats/i.test(c.sql));

beforeEach(() => {
  state.calls = [];
  state.takenUrlIds = [];
  state.insertThrows = false;
  state.sourceRows = [
    {
      id: 'chat_1',
      project_id: 'proj_1',
      url_id: 'my-app',
      description: 'My app',
      // As pg hands them back: a parsed array and a parsed object, not strings.
      messages: [{ role: 'user', content: 'hello' }],
      metadata: { gitUrl: 'x' },
    },
  ];
});

describe('duplicateChatPostgres', () => {
  it('sends messages and metadata as JSON strings, not as JS values', async () => {
    await duplicateChatPostgres('chat_1', 'user_1');

    const insert = chatInsert();
    expect(insert).toBeDefined();

    // Positions 5 and 6 are messages and metadata.
    const [, , , , , messages, metadata] = insert!.params;

    expect(typeof messages).toBe('string');
    expect(typeof metadata).toBe('string');
    expect(JSON.parse(messages)).toEqual([{ role: 'user', content: 'hello' }]);
    expect(JSON.parse(metadata)).toEqual({ gitUrl: 'x' });
  });

  it('copies into the same project and gives the copy a free url_id', async () => {
    const result = await duplicateChatPostgres('chat_1', 'user_1');

    expect(result).toEqual({ ok: true, urlId: 'my-app-copy' });
    expect(chatInsert()!.params[2]).toBe('proj_1');
    expect(chatInsert()!.params[4]).toBe('My app (copy)');
  });

  it('steps past url_ids that are already taken', async () => {
    state.takenUrlIds = ['my-app-copy', 'my-app-copy-2'];

    const result = await duplicateChatPostgres('chat_1', 'user_1');

    expect(result).toEqual({ ok: true, urlId: 'my-app-copy-3' });
  });

  it('reports a missing chat as not_found', async () => {
    state.sourceRows = [];

    expect(await duplicateChatPostgres('nope', 'user_1')).toEqual({ ok: false, reason: 'not_found' });
  });

  it('reports a failed insert as an error rather than as a missing chat', async () => {
    state.insertThrows = true;

    expect(await duplicateChatPostgres('chat_1', 'user_1')).toEqual({ ok: false, reason: 'error' });
  });
});
