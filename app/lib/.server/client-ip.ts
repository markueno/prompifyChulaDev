/**
 * The caller's IP address, for rate limiting.
 *
 * This deployment sits behind nginx, which sets `X-Real-IP` and `X-Forwarded-For`. It is not
 * behind Cloudflare, so `CF-Connecting-IP` is normally absent — it stays first only because a
 * future move behind Cloudflare would make it the trustworthy one, and because the endpoints
 * already written against it keep working unchanged.
 *
 * Login previously read `CF-Connecting-IP` *alone*, so every request keyed as `'unknown'`: one
 * shared bucket that five failures anywhere could exhaust, locking out every user at once, while
 * an attacker sending their own forged header got a private bucket per value and so an unlimited
 * number of attempts. Register, forgot-password and contact already had the fallback; login did
 * not, which is exactly the endpoint where it mattered.
 *
 * Every one of these headers is client-supplied and therefore forgeable. That is tolerable for
 * rate limiting — the worst case is an attacker spreading their own attempts across buckets, which
 * is what an attacker with many IPs could do anyway — but it is why this value must never be used
 * for authorization, allowlisting, or audit attribution.
 */
export function getClientIp(request: Request): string {
  const cloudflare = request.headers.get('CF-Connecting-IP');

  if (cloudflare) {
    return cloudflare.trim();
  }

  /*
   * X-Forwarded-For is a chain, "client, proxy1, proxy2". The leftmost entry is the original
   * client; the rest are the hops. Anything after the first is our own infrastructure.
   */
  const forwarded = request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim();

  if (forwarded) {
    return forwarded;
  }

  const real = request.headers.get('X-Real-IP')?.trim();

  return real || 'unknown';
}
