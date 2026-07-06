/*
 * Day 11 (IMPLEMENTATION-PLAN Step 11.1 verification + post-condition "unit-test the circuit
 * state machine"): opens after 3 failures, persists across instances (page refresh), half-opens
 * after the 30s recovery timeout, closes on success, and survives corrupt localStorage JSON.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerCircuit, circuitStateStore } from './serverCircuit';

// Minimal localStorage stub for the node test environment.
function installLocalStorageStub() {
  const store = new Map<string, string>();

  (globalThis as any).localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => void store.clear(),
  };

  return store;
}

const failingCall = () => Promise.reject(new Error('server down'));
const succeedingCall = () => Promise.resolve('ok');

async function failTimes(circuit: ServerCircuit, times: number) {
  for (let i = 0; i < times; i++) {
    await expect(circuit.execute(failingCall)).rejects.toThrow();
  }
}

describe('ServerCircuit', () => {
  beforeEach(() => {
    installLocalStorageStub();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).localStorage;
  });

  it('stays closed below the failure threshold', async () => {
    const circuit = new ServerCircuit();

    await failTimes(circuit, 2);

    expect(circuit.isOpen).toBe(false);
    expect(circuit.currentState).toBe('closed');
  });

  it('opens after 3 consecutive failures and rejects immediately while open', async () => {
    const circuit = new ServerCircuit();

    await failTimes(circuit, 3);

    expect(circuit.isOpen).toBe(true);

    // While open (before recovery timeout) the protected function must NOT be called.
    const fn = vi.fn(succeedingCall);
    await expect(circuit.execute(fn)).rejects.toThrow('Circuit open');
    expect(fn).not.toHaveBeenCalled();
  });

  it('persists state across instances (simulated page refresh)', async () => {
    const first = new ServerCircuit();
    await failTimes(first, 3);
    expect(first.isOpen).toBe(true);

    // New instance restores from localStorage — the refresh must not reset the circuit.
    const second = new ServerCircuit();
    expect(second.isOpen).toBe(true);
  });

  it('half-opens after the 30s recovery timeout and closes on success', async () => {
    const circuit = new ServerCircuit();
    await failTimes(circuit, 3);
    expect(circuit.isOpen).toBe(true);

    vi.advanceTimersByTime(30_001);

    // First call after the timeout goes through (half-open probe) and success closes it.
    await expect(circuit.execute(succeedingCall)).resolves.toBe('ok');
    expect(circuit.currentState).toBe('closed');
    expect(circuit.isOpen).toBe(false);
  });

  it('re-opens when the half-open probe fails', async () => {
    const circuit = new ServerCircuit();
    await failTimes(circuit, 3);

    vi.advanceTimersByTime(30_001);

    await expect(circuit.execute(failingCall)).rejects.toThrow('server down');
    expect(circuit.isOpen).toBe(true);
  });

  it('success resets the failure count', async () => {
    const circuit = new ServerCircuit();

    await failTimes(circuit, 2);
    await circuit.execute(succeedingCall);

    // Two more failures alone must not open it (count restarted after the success).
    await failTimes(circuit, 2);
    expect(circuit.isOpen).toBe(false);
  });

  it('starts closed when localStorage JSON is corrupt', () => {
    localStorage.setItem('circuit_state', '{not valid json!!!');

    const circuit = new ServerCircuit();

    expect(circuit.currentState).toBe('closed');
    expect(circuit.isOpen).toBe(false);
  });

  it('mirrors state into circuitStateStore for the UI (Day 12)', async () => {
    const circuit = new ServerCircuit();
    expect(circuitStateStore.get()).toBe('closed');

    await failTimes(circuit, 3);
    expect(circuitStateStore.get()).toBe('open');

    vi.advanceTimersByTime(30_001);
    await circuit.execute(succeedingCall);
    expect(circuitStateStore.get()).toBe('closed');
  });
});
