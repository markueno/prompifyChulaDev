import { describe, it, expect } from 'vitest';
import { tokenScopeAllows } from './data-auth';

/**
 * The regression guard for the data-proxy scope leak.
 *
 * A shared deploy embeds a 7-day data token in env-config.js, which is public in the deployed app.
 * The token is scoped to one chat, but that scope was never checked — so anyone given a shared app
 * link could call the data proxy with a different chatId and reach every project its owner could.
 *
 * If someone ever "simplifies" this function back to returning true, these fail.
 */
const chat = { id: 'chat_abc', url_id: 'my-app' };

describe('tokenScopeAllows', () => {
  it('refuses a token minted for a different chat', () => {
    expect(tokenScopeAllows('chat_someone_elses', chat)).toBe(false);
  });

  it('allows a token matching the canonical chat id', () => {
    // What /api/data/token and env-config.js both issue on.
    expect(tokenScopeAllows('chat_abc', chat)).toBe(true);
  });

  it('allows a token matching the url_id', () => {
    /*
     * The URL may legitimately carry either form — getChatById matches on both — and a deploy
     * issued before this was tightened may hold a url_id. Refusing it would break working apps.
     */
    expect(tokenScopeAllows('my-app', chat)).toBe(true);
  });

  it('leaves session auth unscoped', () => {
    // null means a cookie session, whose reach getChatById has already decided.
    expect(tokenScopeAllows(null, chat)).toBe(true);
  });

  it('does not treat a missing url_id as a wildcard', () => {
    /*
     * The dangerous shape: if an absent url_id compared loosely, a token carrying an empty or
     * undefined-ish value would pass against any chat.
     */
    expect(tokenScopeAllows('', { id: 'chat_abc', url_id: null })).toBe(false);
    expect(tokenScopeAllows('anything', { id: 'chat_abc', url_id: null })).toBe(false);
  });
});
