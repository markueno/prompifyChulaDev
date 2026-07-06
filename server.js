/*
 * Compiled production server (Day 13 — IMPLEMENTATION-PLAN :840-874).
 *
 * Serves the `remix vite:build` output with plain Node — no express/remix-serve dependency:
 *  - static files from build/client (immutable caching for fingerprinted /assets)
 *  - everything else through the Remix request handler (build/server/index.js)
 *
 * NOTE: the previous version of this file passed @remix-run/node's createRequestHandler —
 * which returns a WEB `(Request) => Promise<Response>` handler — directly to
 * http.createServer's `(req, res)` callback and served no static assets, so every request
 * hung and /assets/* 404'd. The Node<->Web conversion below follows the same approach as
 * @remix-run/dev's node-adapter (fromNodeRequest/toNodeRequest).
 */
import {
  createRequestHandler,
  createReadableStreamFromReadable,
  writeReadableStreamToWritable,
  installGlobals,
} from '@remix-run/node';
import { createServer } from 'node:http';
import { existsSync, statSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

installGlobals();

// Import the built app
const build = await import('./build/server/index.js');

const port = Number(process.env.PORT || 5173);
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(rootDir, 'build', 'client');

const requestHandler = createRequestHandler(build, process.env.NODE_ENV);

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

/** Serve a file from build/client if it exists. Returns true when handled. */
function tryServeStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return false;
  }

  let decoded;

  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }

  // Resolve inside build/client only — reject path traversal.
  const filePath = path.normalize(path.join(clientDir, decoded));

  if (!filePath.startsWith(clientDir)) {
    return false;
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return false;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream');

  // Fingerprinted assets are immutable; everything else gets a short cache.
  res.setHeader(
    'Cache-Control',
    decoded.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600'
  );

  if (req.method === 'HEAD') {
    res.end();
  } else {
    createReadStream(filePath).pipe(res);
  }

  return true;
}

/** Node IncomingMessage -> Web Request (same approach as @remix-run/dev node-adapter). */
function toWebRequest(req, res) {
  const origin = `http://${req.headers.host ?? `localhost:${port}`}`;
  const url = new URL(req.url, origin);

  let controller = new AbortController();

  // Abort loaders/actions only if the connection closes BEFORE the response finished.
  res.on('finish', () => (controller = null));
  res.on('close', () => controller?.abort());

  const headers = new Headers();

  for (const [key, values] of Object.entries(req.headers)) {
    if (values === undefined) {
      continue;
    }

    for (const value of Array.isArray(values) ? values : [values]) {
      headers.append(key, value);
    }
  }

  const init = { method: req.method, headers, signal: controller.signal };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = createReadableStreamFromReadable(req);
    init.duplex = 'half';
  }

  return new Request(url.href, init);
}

/** Web Response -> Node ServerResponse. */
async function sendWebResponse(res, response) {
  res.statusCode = response.status;
  res.statusMessage = response.statusText;

  /*
   * installGlobals()'s Headers has no getSetCookie(), but iterating yields each set-cookie
   * entry individually (verified against @remix-run/node 2.15) — append them one by one so
   * multiple session cookies survive instead of being joined or dropped.
   */
  for (const [key, value] of response.headers) {
    if (key === 'set-cookie') {
      res.appendHeader('set-cookie', value);
    } else {
      res.setHeader(key, value);
    }
  }

  if (response.body) {
    /*
     * NOT Readable.fromWeb: installGlobals() swaps in undici's ReadableStream, which Node's
     * stream adapter rejects ("must be an instance of ReadableStream" — different realm).
     * Remix ships this helper for exactly this conversion (used by @remix-run/express too).
     */
    await writeReadableStreamToWritable(response.body, res);
  } else {
    res.end();
  }
}

const server = createServer(async (req, res) => {
  try {
    /*
     * WebContainer security headers — required on every response for SharedArrayBuffer
     * (crossOriginIsolated). entry.server.tsx sets COEP/COOP on documents too (same values,
     * so the later setHeader is a harmless overwrite, never a duplicate header).
     */
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    const url = new URL(req.url, `http://${req.headers.host ?? `localhost:${port}`}`);

    if (tryServeStatic(req, res, url.pathname)) {
      return;
    }

    const response = await requestHandler(toWebRequest(req, res));
    await sendWebResponse(res, response);
  } catch (error) {
    console.error('Unhandled server error:', error);

    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    }

    res.end('Internal Server Error');
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Prompify server running on port ${port}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV}`);
  console.log(`🔐 Auth disabled: ${process.env.AUTH_DISABLED}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});
