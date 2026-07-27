/*
 * Day 12 (IMPLEMENTATION-PLAN Step 12.1): connection status indicator.
 * Three states per ARCHITECTURE-v2.md:672-680:
 *  - amber  "Working offline — edits save locally"  while the circuit is open
 *  - blue   "Syncing offline changes…"              while the outbox drains
 *  - green  "Back online — changes synced"          briefly after recovery
 * IDE editing, preview, and terminal are browser-only and stay fully enabled — only the chat
 * input is disabled elsewhere (BaseChat) because AI generation requires the server.
 * UX pattern source: web.dev/articles/offline-ux-considerations.
 */
import { useStore } from '@nanostores/react';
import { useEffect, useRef, useState } from 'react';
import { circuitStateStore } from '~/lib/persistence/serverCircuit';
import { drainStatusStore } from '~/lib/persistence/drainQueue';
import { classNames } from '~/utils/classNames';

const RECOVERED_VISIBLE_MS = 6_000;

export function ConnectionStatusBanner() {
  const circuit = useStore(circuitStateStore);
  const drain = useStore(drainStatusStore);
  const [showRecovered, setShowRecovered] = useState(false);
  const wasOffline = useRef(false);

  useEffect(() => {
    if (circuit === 'open') {
      wasOffline.current = true;
      setShowRecovered(false);

      return undefined;
    }

    if (circuit === 'closed' && wasOffline.current) {
      wasOffline.current = false;
      setShowRecovered(true);

      const timer = setTimeout(() => setShowRecovered(false), RECOVERED_VISIBLE_MS);

      return () => clearTimeout(timer);
    }

    return undefined;
  }, [circuit]);

  const offline = circuit === 'open';
  const syncing = !offline && drain === 'draining';

  if (!offline && !syncing && !showRecovered) {
    return null;
  }

  const label = offline
    ? 'Working offline — edits save locally'
    : syncing
      ? 'Syncing offline changes…'
      : 'Back online — changes synced';

  return (
    <div
      role="status"
      title={
        offline
          ? 'The server is unreachable. You can keep editing files — changes are stored locally and sync automatically when the connection returns. Only the AI chat is paused.'
          : undefined
      }
      className={classNames(
        'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap',
        offline
          ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
          : syncing
            ? 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300'
            : 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300'
      )}
    >
      <span
        className={classNames(
          'inline-block h-2 w-2 rounded-full',
          offline ? 'bg-amber-500' : syncing ? 'bg-blue-500 animate-pulse' : 'bg-green-500'
        )}
      />
      {label}
    </div>
  );
}
