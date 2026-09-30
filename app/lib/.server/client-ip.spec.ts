import { describe, it, expect } from 'vitest';
import { getClientIp } from './client-ip';

const withHeaders = (headers: Record<string, string>) => new Request('https://example.com/', { headers });

/**
 * The bug this guards: login read `CF-Connecting-IP` alone, and this deployment is behind nginx
 * rather than Cloudflare, so the header is absent and every caller shared one `'unknown'` bucket.
 * The X-Forwarded-For fallback is what makes rate limiting per-caller at all.
 */
describe('getClientIp', () => {
  it('falls back to X-Forwarded-For, which is what nginx actually sets', () => {
    expect(getClientIp(withHeaders({ 'X-Forwarded-For': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('takes the leftmost X-Forwarded-For entry, the original client', () => {
    // "client, proxy1, proxy2" — everything after the first hop is our own infrastructure.
    expect(getClientIp(withHeaders({ 'X-Forwarded-For': '203.0.113.7, 10.0.0.1, 10.0.0.2' }))).toBe('203.0.113.7');
  });

  it('prefers CF-Connecting-IP when present', () => {
    const request = withHeaders({ 'CF-Connecting-IP': '198.51.100.4', 'X-Forwarded-For': '203.0.113.7' });
    expect(getClientIp(request)).toBe('198.51.100.4');
  });

  it('falls back to X-Real-IP when it is the only one set', () => {
    expect(getClientIp(withHeaders({ 'X-Real-IP': '192.0.2.9' }))).toBe('192.0.2.9');
  });

  it("returns 'unknown' only when no header identifies the caller", () => {
    expect(getClientIp(withHeaders({}))).toBe('unknown');
  });

  it('trims surrounding whitespace so one caller cannot occupy two buckets', () => {
    expect(getClientIp(withHeaders({ 'X-Forwarded-For': '  203.0.113.7  ' }))).toBe('203.0.113.7');
    expect(getClientIp(withHeaders({ 'CF-Connecting-IP': ' 198.51.100.4 ' }))).toBe('198.51.100.4');
  });
});
