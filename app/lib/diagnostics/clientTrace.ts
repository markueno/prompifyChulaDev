/*
 * Client trace — a small flight recorder for the builder tab.
 *
 * When a generation "gets stuck" the server usually has nothing to say: the reply was sent in
 * full and the tab simply stopped. The only evidence is in the browser, and a frozen or closed tab
 * cannot be inspected after the fact. This module sends a short timeline of what the tab was doing
 * (chat request started/finished, each shell/start/data action, preview ready, main-thread stalls)
 * to POST /api/client-trace, where it lands in the app log next to the server's own lines.
 *
 * It records event names, durations and short labels only — never prompts, file contents, replies
 * or keys.
 */

interface TraceEvent {
  /** ms since epoch */
  t: number;
  type: string;
  detail?: string;
}

const FLUSH_INTERVAL_MS = 5_000;
const BUSY_REPORT_INTERVAL_MS = 30_000;
const STALL_CHECK_INTERVAL_MS = 1_000;
const STALL_THRESHOLD_MS = 3_000;
const MAX_BUFFERED_EVENTS = 200;
const MAX_DETAIL_LENGTH = 300;
const ENDPOINT = '/api/client-trace';

const buffer: TraceEvent[] = [];
const openSpans = new Map<number, { name: string; startedAt: number }>();
let nextSpanId = 1;
let started = false;

function toDetail(detail?: string | Record<string, unknown>): string | undefined {
  if (detail === undefined) {
    return undefined;
  }

  let text: string;

  try {
    text = typeof detail === 'string' ? detail : JSON.stringify(detail);
  } catch {
    text = '[unserializable]';
  }

  return text.replace(/\s+/g, ' ').slice(0, MAX_DETAIL_LENGTH);
}

function flush() {
  if (buffer.length === 0) {
    return;
  }

  const events = buffer.splice(0, buffer.length);

  try {
    // keepalive lets the request outlive the page, so the last events survive a closed tab.
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: window.location.pathname, events }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Diagnostics must never break the app.
  }
}

function start() {
  if (started || typeof window === 'undefined') {
    return;
  }

  started = true;

  setInterval(flush, FLUSH_INTERVAL_MS);

  /*
   * Report work that has been running for a while. A span that starts and never ends is exactly
   * what a hung install or dev-server start looks like, and this is the line that names it.
   */
  setInterval(() => {
    if (openSpans.size === 0) {
      return;
    }

    const now = Date.now();
    const running = Array.from(openSpans.values())
      .map(span => `${span.name} (${Math.round((now - span.startedAt) / 1000)}s)`)
      .join('; ');

    trace('still-running', running);
  }, BUSY_REPORT_INTERVAL_MS);

  /*
   * Main-thread stall detector: a 1s timer that fires seconds late means the page was frozen in
   * between. Background tabs throttle timers, so only count gaps while the tab stayed visible.
   */
  let lastTick = Date.now();
  let wasHidden = document.visibilityState !== 'visible';

  document.addEventListener('visibilitychange', () => {
    wasHidden = true;
    trace('visibility', document.visibilityState);

    if (document.visibilityState === 'hidden') {
      flush();
    }
  });

  setInterval(() => {
    const now = Date.now();
    const lag = now - lastTick - STALL_CHECK_INTERVAL_MS;

    if (lag > STALL_THRESHOLD_MS && !wasHidden) {
      trace('stall', `page frozen for ${Math.round(lag / 100) / 10}s`);
    }

    lastTick = now;
    wasHidden = document.visibilityState !== 'visible';
  }, STALL_CHECK_INTERVAL_MS);

  window.addEventListener('pagehide', () => {
    trace('pagehide');
    flush();
  });

  window.addEventListener('error', event => {
    trace('window-error', event.message);
  });

  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    trace('unhandled-rejection', reason instanceof Error ? reason.message : String(reason));
  });
}

/** Record one event on the tab's timeline. */
export function trace(type: string, detail?: string | Record<string, unknown>) {
  if (typeof window === 'undefined') {
    return;
  }

  start();

  if (buffer.length >= MAX_BUFFERED_EVENTS) {
    buffer.shift();
  }

  buffer.push({ t: Date.now(), type, detail: toDetail(detail) });
}

/**
 * Record the start of a piece of work and return a function that records its end. Work that
 * never ends keeps showing up in the periodic `still-running` report.
 */
export function traceStart(name: string, detail?: string | Record<string, unknown>): (outcome?: string) => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const id = nextSpanId++;
  const startedAt = Date.now();

  openSpans.set(id, { name, startedAt });
  trace(`${name}:start`, detail);

  return (outcome?: string) => {
    if (!openSpans.delete(id)) {
      return;
    }

    trace(`${name}:end`, `${Date.now() - startedAt}ms${outcome ? ` ${outcome}` : ''}`);
  };
}

/** Begin stall detection and periodic flushing without recording an event. */
export function startClientTrace() {
  start();
}
