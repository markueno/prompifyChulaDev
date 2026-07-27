/*
 * Day 12 — hydration-safe subscription to the circuit breaker state.
 *
 * The circuit restores from localStorage at module init, so on a reload while offline the
 * client store can already be 'open' during the first render — but the server always renders
 * with the enabled/'closed' markup. Deriving the flag in an effect keeps the first client
 * render identical to the SSR output (no hydration mismatch) and flips state right after.
 */
import { useEffect, useState } from 'react';
import { circuitStateStore } from '~/lib/persistence/serverCircuit';

export function useCircuitOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // nanostores' subscribe fires immediately with the current value, then on every change.
    return circuitStateStore.subscribe(state => setOpen(state === 'open'));
  }, []);

  return open;
}
