import { describe, expect, it } from "vitest";
import { MemorySessionStore } from "./session-store.js";

describe("MemorySessionStore", () => {
  it("creates sessions with resolvable viewer tokens", () => {
    const store = new MemorySessionStore();
    const principal = { tenantId: "t1", userId: "u1" };
    const rec = store.createSession(principal);
    expect(rec.sessionId).toBeTruthy();
    expect(rec.viewerToken).toBeTruthy();
    const resolved = store.resolveViewerToken(rec.viewerToken);
    expect(resolved?.sessionId).toBe(rec.sessionId);
  });

  it("returns undefined for unknown tokens", () => {
    const store = new MemorySessionStore();
    expect(store.resolveViewerToken("missing")).toBeUndefined();
  });

  it("removes sessions on delete", () => {
    const store = new MemorySessionStore();
    const rec = store.createSession({ tenantId: "t", userId: "u" });
    store.delete(rec.sessionId);
    expect(store.getById(rec.sessionId)).toBeUndefined();
    expect(store.resolveViewerToken(rec.viewerToken)).toBeUndefined();
  });
});
