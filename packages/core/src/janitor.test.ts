import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemorySessionStore, type MemorySessionStoreOptions } from "./memory-session-store.js";

/**
 * Janitor tests use vitest's fake timers to drive the in-process `setInterval`,
 * combined with a controllable `now()` so the store's wall-clock matches the
 * timer advances. Vitest's `useFakeTimers` doesn't mock `Date.now` by default.
 */
describe("MemorySessionStore janitor (Fix 4)", () => {
  let stores: MemorySessionStore[];
  let clock: { now: number };

  beforeEach(() => {
    stores = [];
    clock = { now: 0 };
    vi.useFakeTimers();
  });

  afterEach(() => {
    for (const s of stores) s.dispose();
    vi.useRealTimers();
  });

  function fresh(opts?: Omit<MemorySessionStoreOptions, "now">): MemorySessionStore {
    const s = new MemorySessionStore({ ...opts, now: () => clock.now });
    stores.push(s);
    return s;
  }

  function tick(ms: number): void {
    clock.now += ms;
    vi.advanceTimersByTime(ms);
  }

  it("destroys sessions whose sessionTtlMs has elapsed", () => {
    const events: Array<{ sessionId: string; reason: string }> = [];
    const store = fresh({
      policies: { sessionTtlMs: 1_000, idleTtlMs: 10 * 60_000 },
      janitorIntervalMs: 100,
      onSessionExpired: (sessionId, reason) => events.push({ sessionId, reason }),
    });
    const rec = store.createSession({ tenantId: "t", userId: "u" });

    // Janitor sweep at 100ms — too early to expire.
    tick(100);
    expect(store.getById(rec.sessionId)).toBeDefined();

    // Past 1s — sweep at 1100ms should evict.
    tick(1_100);
    expect(store.getById(rec.sessionId)).toBeUndefined();
    expect(events).toEqual([{ sessionId: rec.sessionId, reason: "session_ttl" }]);
  });

  it("destroys sessions that have been idle longer than idleTtlMs", () => {
    const events: Array<{ sessionId: string; reason: string }> = [];
    const store = fresh({
      policies: { sessionTtlMs: 60_000, idleTtlMs: 500 },
      janitorIntervalMs: 100,
      onSessionExpired: (sessionId, reason) => events.push({ sessionId, reason }),
    });
    const rec = store.createSession({ tenantId: "t", userId: "u" });

    // Bumping activity keeps the session alive across the idle window.
    tick(300);
    store.touch(rec.sessionId);
    tick(300);
    expect(store.getById(rec.sessionId)).toBeDefined();

    // Go quiet for >= idleTtlMs and let janitor sweep.
    tick(700);
    expect(store.getById(rec.sessionId)).toBeUndefined();
    expect(events).toEqual([{ sessionId: rec.sessionId, reason: "idle_ttl" }]);
  });

  it("dispose() stops the janitor", () => {
    const store = fresh({
      policies: { sessionTtlMs: 100, idleTtlMs: 60_000 },
      janitorIntervalMs: 50,
    });
    const rec = store.createSession({ tenantId: "t", userId: "u" });
    store.dispose();
    // Past expiry — but janitor is no longer running, so the session stays.
    tick(2_000);
    expect(store.getById(rec.sessionId)).toBeDefined();
    // Manual sweep still works after dispose (safety net).
    store.sweep();
    expect(store.getById(rec.sessionId)).toBeUndefined();
  });
});
