/**
 * Guarded outbound fetch for user-supplied URLs.
 *
 * The brand-context extractor fetches whatever URL a user types, and now follows that page's
 * stylesheets too. Without a guard that is a server-side request forgery primitive: the response
 * is handed to an LLM and shown back to the user, so pointing it at 169.254.169.254 would read
 * the cloud metadata service — which on this host can hand out instance credentials. The
 * content-type check alone is not enough, because metadata endpoints serve text/plain.
 *
 * Mirrors the blocklist already used by api.git-proxy.$.ts.
 *
 * Limitation worth knowing: these are hostname/literal-IP checks, so they do not defeat DNS
 * rebinding (a public name resolving to a private address). Closing that needs resolution-time
 * IP inspection, which Node's fetch does not expose.
 */
const BLOCKED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', 'metadata.google.internal']);

const BLOCKED_PREFIXES = [
  '127.', // loopback
  '10.', // RFC1918
  '192.168.', // RFC1918
  '169.254.', // link-local — AWS/Huawei/GCP metadata
  '::1',
  'fc00:', // unique local
  'fd00:',
];

/** 172.16.0.0 – 172.31.255.255 */
function isRfc1918ClassB(hostname: string): boolean {
  const match = hostname.match(/^172\.(\d{1,3})\./);

  if (!match) {
    return false;
  }

  const second = Number(match[1]);

  return second >= 16 && second <= 31;
}

export class UnsafeUrlError extends Error {}

/** Throws UnsafeUrlError unless the URL is a public http(s) address. */
export function assertPublicHttpUrl(raw: string): URL {
  let parsed: URL;

  try {
    parsed = new URL(raw);
  } catch {
    throw new UnsafeUrlError('Invalid URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new UnsafeUrlError('Only http and https URLs are supported');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    BLOCKED_PREFIXES.some(prefix => hostname.startsWith(prefix)) ||
    isRfc1918ClassB(hostname)
  ) {
    throw new UnsafeUrlError('That address is not reachable');
  }

  return parsed;
}

interface FetchTextOptions {
  maxBytes: number;
  timeoutMs?: number;
  /** When set, the response content-type must include one of these. */
  contentTypes?: string[];
}

/**
 * Fetch text from a vetted public URL, bounded in both time and size so one hostile or merely
 * enormous response cannot stall the request or exhaust memory.
 */
export async function fetchTextLimited(rawUrl: string, opts: FetchTextOptions): Promise<string> {
  const url = assertPublicHttpUrl(rawUrl);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; AlimaBot/1.0)',
      Accept: opts.contentTypes?.join(',') ?? '*/*',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15000),
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  /*
   * A redirect can land somewhere the original check passed over — re-verify the final URL,
   * otherwise an open redirect on a public host walks straight into the internal network.
   */
  if (response.url) {
    assertPublicHttpUrl(response.url);
  }

  const contentType = response.headers.get('content-type') || '';

  if (opts.contentTypes && !opts.contentTypes.some(t => contentType.includes(t))) {
    throw new Error(`Unexpected content type: ${contentType || 'unknown'}`);
  }

  return readCapped(response, opts.maxBytes);
}

/**
 * Read a response body as text, stopping at `maxBytes`.
 *
 * Truncating rather than rejecting is deliberate. fetchTextLimited used to throw 'Response too
 * large' when content-length exceeded the cap, which dropped the whole stylesheet — and a
 * production CSS bundle routinely exceeds any sane cap, so the one sheet actually holding the
 * palette was the one most likely to be discarded. The tokens we want (`:root`, `@font-face`) sit
 * near the top of a bundle, so a bounded prefix is worth far more than nothing.
 *
 * Reading through the stream means an over-large body stops costing bandwidth and memory at the
 * cap, instead of being buffered in full and then sliced.
 */
export async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    return (await response.text()).slice(0, maxBytes);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let read = 0;

  try {
    while (read < maxBytes) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (value) {
        read += value.byteLength;
        chunks.push(decoder.decode(value, { stream: true }));
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return chunks.join('').slice(0, maxBytes);
}
