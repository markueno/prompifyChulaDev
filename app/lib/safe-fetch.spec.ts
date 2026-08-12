/*
 * The brand-context extractor fetches a user-supplied URL and now follows that page's
 * stylesheets, so it is a server-side request forgery primitive if unguarded — the fetched
 * content is fed to an LLM and shown back to the user. These pin the blocklist.
 */
import { describe, expect, it } from 'vitest';
import { assertPublicHttpUrl, UnsafeUrlError } from './safe-fetch.server';

describe('assertPublicHttpUrl', () => {
  it.each([
    ['http://169.254.169.254/latest/meta-data/', 'cloud metadata — the one that leaks credentials'],
    ['http://localhost:5432/', 'localhost'],
    ['http://127.0.0.1/', 'loopback'],
    ['http://10.0.0.5/', 'RFC1918 class A'],
    ['http://192.168.1.1/', 'RFC1918 class C'],
    ['http://172.16.0.1/', 'RFC1918 class B lower bound'],
    ['http://172.31.255.254/', 'RFC1918 class B upper bound'],
    ['http://metadata.google.internal/', 'GCP metadata by name'],
    ['http://db.internal/', '.internal'],
    ['http://printer.local/', '.local'],
    ['file:///etc/passwd', 'non-http scheme'],
    ['not a url at all', 'unparseable'],
  ])('blocks %s (%s)', url => {
    expect(() => assertPublicHttpUrl(url)).toThrow(UnsafeUrlError);
  });

  it.each([
    ['https://example.com/'],
    ['http://example.com/page'],
    // 172.32 is outside the private range and must NOT be caught by the class-B check
    ['http://172.32.0.1/'],
    ['https://fonts.googleapis.com/css2?family=Inter'],
  ])('allows %s', url => {
    expect(() => assertPublicHttpUrl(url)).not.toThrow();
  });
});
