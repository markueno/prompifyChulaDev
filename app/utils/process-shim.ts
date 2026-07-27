/*
 * Minimal browser `process` shim. vite.config.ts sets `globals: { process: false }` on
 * vite-plugin-node-polyfills because its process polyfill snapshots process.env at BUILD
 * time, which broke every SSR route reading env vars once .env left the Docker build
 * context. That also removed `process` from the client bundle — but path-browserify
 * (utils/path.ts) calls process.cwd() at runtime, so WebContainer file actions crashed
 * with "process is not defined". This shim restores only what browser code needs, at
 * runtime, without touching the real Node process on the server.
 */
const g = globalThis as any;

if (typeof g.process === 'undefined') {
  g.process = {
    env: {},
    cwd: () => '/',
    platform: 'browser',
    versions: {},
    nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) => queueMicrotask(() => fn(...args)),
  };
}

export {};
