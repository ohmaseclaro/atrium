import { afterEach, describe, expect, it } from "vitest";
import { MemorySessionStore, type MemorySessionStoreOptions } from "./memory-session-store.js";

describe("MemorySessionStore", () => {
  const stores: MemorySessionStore[] = [];
  afterEach(() => {
    while (stores.length) stores.pop()?.dispose();
  });
  function fresh(opts?: MemorySessionStoreOptions): MemorySessionStore {
    const s = new MemorySessionStore({ janitorIntervalMs: 0, ...opts });
    stores.push(s);
    return s;
  }

  it("creates session bound to principal", () => {
    const store = fresh();
    const rec = store.createSession({ tenantId: "t1", userId: "u1" });
    expect(rec.sessionId.length).toBeGreaterThan(0);
    expect(rec.tenantId).toBe("t1");
    expect(rec.userId).toBe("u1");
    expect(store.getById(rec.sessionId)).toBe(rec);
  });

  it("resolves viewer token until expiry window", () => {
    const store = fresh();
    const rec = store.createSession({ tenantId: "t", userId: "u" });
    expect(store.resolveViewerToken(rec.viewerToken)?.sessionId).toBe(rec.sessionId);
  });

  it("appendUpstreamJson records replay for hello", () => {
    const store = fresh();
    const rec = store.createSession({ tenantId: "t", userId: "u" });
    const line = JSON.stringify({ t: "hello", sessionId: rec.sessionId });
    store.appendUpstreamJson(rec.sessionId, line);
    expect(store.peekReplay(rec.sessionId).length).toBe(1);
  });

  it("delete removes session and token", () => {
    const store = fresh();
    const rec = store.createSession({ tenantId: "t", userId: "u" });
    const tok = rec.viewerToken;
    store.delete(rec.sessionId);
    expect(store.getById(rec.sessionId)).toBeUndefined();
    expect(store.resolveViewerToken(tok)).toBeUndefined();
  });

  // ----- Fix 2: poll queues are owned by the store and cleaned up on delete -----

  it("delete also clears the session's poll queue", () => {
    const store = fresh();
    const rec = store.createSession({ tenantId: "t", userId: "u" });
    store.enqueuePoll(rec.sessionId, false, Buffer.from("hi"));
    expect(store.hasPollQueue(rec.sessionId)).toBe(true);
    store.delete(rec.sessionId);
    expect(store.hasPollQueue(rec.sessionId)).toBe(false);
  });

  it("countByTenant counts only matching tenant", () => {
    const store = fresh();
    store.createSession({ tenantId: "a", userId: "u1" });
    store.createSession({ tenantId: "a", userId: "u2" });
    store.createSession({ tenantId: "b", userId: "u1" });
    expect(store.countByTenant("a")).toBe(2);
    expect(store.countByTenant("b")).toBe(1);
    expect(store.countByTenant("c")).toBe(0);
  });

  // ----- Fix 4: lastActivityAt -----

  it("touch() updates lastActivityAt", () => {
    let t = 1_000;
    const store = fresh({ now: () => t });
    const rec = store.createSession({ tenantId: "t", userId: "u" });
    expect(rec.lastActivityAt).toBe(1_000);
    t = 5_000;
    store.touch(rec.sessionId);
    expect(store.getById(rec.sessionId)?.lastActivityAt).toBe(5_000);
  });
});
