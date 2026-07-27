/*
 * app/lib/persistence/serverCircuit.ts
 *
 * Day 11 (IMPLEMENTATION-PLAN Step 11.1): localStorage-persisted circuit breaker.
 * Implemented from ARCHITECTURE-v2.md:606-669 (threshold 3, recovery 30s). Persisted so the
 * circuit survives a page refresh — an in-memory circuit would reset to 'closed' on reload and
 * hammer a down server again (ARCHITECTURE-v2.md:603, :981 explicitly rejects in-memory).
 * Pattern source: Martin Fowler, martinfowler.com/bliki/CircuitBreaker.html.
 *
 * Deviations from the verbatim listing, both mandated by the plan or required for this codebase:
 *  - JSON.parse of the saved state is wrapped in try/catch (plan Step 11.1: "corrupt
 *    localStorage JSON → wrap parse in try/catch").
 *  - All localStorage access is guarded so the module is importable during SSR and in the
 *    node test environment (no window/localStorage there).
 *  - `circuitStateStore` nanostore atom mirrors the state so Day 12's UI can subscribe.
 */
import { atom } from 'nanostores';

export type CircuitState = 'closed' | 'open' | 'half-open';

const STORAGE_KEY = 'circuit_state';

/** Mirrors the circuit state for UI subscription (Day 12 reads this). */
export const circuitStateStore = atom<CircuitState>('closed');

function storageAvailable(): boolean {
  return typeof localStorage !== 'undefined';
}

export class ServerCircuit {
  private _failures = 0;
  private _lastCheck = 0;
  private _state: CircuitState = 'closed';

  // eslint-disable-next-line @typescript-eslint/naming-convention
  private readonly FAILURE_THRESHOLD = 3;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  private readonly RECOVERY_TIMEOUT = 30_000; // 30 seconds

  constructor() {
    // Restore from localStorage on page load — survives refresh
    if (storageAvailable()) {
      const saved = localStorage.getItem(STORAGE_KEY);

      if (saved) {
        try {
          const parsed = JSON.parse(saved) as { failures: number; lastCheck: number; state: CircuitState };
          this._failures = parsed.failures ?? 0;
          this._lastCheck = parsed.lastCheck ?? 0;
          this._state = parsed.state === 'open' || parsed.state === 'half-open' ? parsed.state : 'closed';
        } catch {
          // Corrupt JSON — start closed and overwrite on the next persist.
          this._failures = 0;
          this._lastCheck = 0;
          this._state = 'closed';
        }
      }
    }

    circuitStateStore.set(this._state);
  }

  private _persist() {
    if (storageAvailable()) {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          failures: this._failures,
          lastCheck: this._lastCheck,
          state: this._state,
        })
      );
    }

    circuitStateStore.set(this._state);
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this._state === 'open') {
      if (Date.now() - this._lastCheck > this.RECOVERY_TIMEOUT) {
        this._state = 'half-open';
        this._persist();
      } else {
        throw new Error('Circuit open — server unreachable');
      }
    }

    try {
      const result = await fn();
      this._onSuccess();

      return result;
    } catch (err) {
      this._onFailure();
      throw err;
    }
  }

  private _onSuccess() {
    this._failures = 0;
    this._state = 'closed';
    this._persist();
  }

  private _onFailure() {
    this._failures++;
    this._lastCheck = Date.now();

    if (this._failures >= this.FAILURE_THRESHOLD) {
      this._state = 'open';
    }

    this._persist();
  }

  get isOpen() {
    return this._state === 'open';
  }

  get currentState(): CircuitState {
    return this._state;
  }
}

/** App-wide singleton — all server persistence calls share one circuit. */
export const serverCircuit = new ServerCircuit();
