import { randomBytes } from "node:crypto";
import type { ControlHolder } from "@atriumjs/protocol";
import type { AtriumPolicies, Principal } from "./types.js";
import type { SessionRecord } from "./types.js";

const VIEWER_TOKEN_TTL_MS = 5 * 60_000;
const REPLAY_CAP = 20;
const DEFAULT_JANITOR_INTERVAL_MS = 30_000;

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

const REPLAY_TYPES = new Set([
  "hello",
  "control",
  "navigate",
  "title",
  "viewport",
  "loading",
  "tabs",
]);

function maybeRecordReplay(record: SessionRecord, jsonText: string): boolean {
  try {
    const head = JSON.parse(jsonText) as { t?: string };
    if (!head.t || !REPLAY_TYPES.has(head.t)) return false;
    record.replayJson.push(jsonText);
    if (record.replayJson.length > REPLAY_CAP) {
      record.replayJson.splice(0, record.replayJson.length - REPLAY_CAP);
    }
    return true;
  } catch {
    return false;
  }
}

export type MemorySessionStoreOptions = {
  /** Enforced TTLs and the default viewport for new sessions. */
  policies?: Pick<AtriumPolicies, "sessionTtlMs" | "idleTtlMs">;
  /** Janitor interval in ms. Defaults to 30s. Set to 0 to disable. */
  janitorIntervalMs?: number;
  /** Override the wall clock (for tests). Defaults to `Date.now`. */
  now?: () => number;
  /**
   * Called when the janitor destroys a session. Hosts can use this to mirror the
   * destroy onto the worker, fire `onSessionTerminated` hooks, etc.
   */
  onSessionExpired?: (sessionId: string, reason: "session_ttl" | "idle_ttl") => void;
};

export class MemorySessionStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly tokens = new Map<string, string>();
  private readonly pollQueues = new Map<string, Array<{ bin: boolean; data: Buffer }>>();
  private readonly policies: { sessionTtlMs: number; idleTtlMs: number };
  private readonly now: () => number;
  private readonly onSessionExpired?: (
    sessionId: string,
    reason: "session_ttl" | "idle_ttl",
  ) => void;
  private janitor: ReturnType<typeof setInterval> | undefined;

  constructor(opts: MemorySessionStoreOptions = {}) {
    this.policies = {
      sessionTtlMs: opts.policies?.sessionTtlMs ?? Number.POSITIVE_INFINITY,
      idleTtlMs: opts.policies?.idleTtlMs ?? Number.POSITIVE_INFINITY,
    };
    this.now = opts.now ?? Date.now;
    this.onSessionExpired = opts.onSessionExpired;
    const intervalMs = opts.janitorIntervalMs ?? DEFAULT_JANITOR_INTERVAL_MS;
    if (intervalMs > 0 && Number.isFinite(intervalMs)) {
      this.janitor = setInterval(() => this.sweep(), intervalMs);
      // Don't keep the event loop alive just for the janitor.
      this.janitor.unref?.();
    }
  }

  /** Stop the janitor. Hosts SHOULD call this on shutdown. */
  dispose(): void {
    if (this.janitor) {
      clearInterval(this.janitor);
      this.janitor = undefined;
    }
  }

  createSession(principal: Principal): SessionRecord {
    const sessionId = randomToken().slice(0, 26);
    const viewerToken = randomToken();
    const now = this.now();
    const expiresAt = Number.isFinite(this.policies.sessionTtlMs)
      ? now + this.policies.sessionTtlMs
      : Number.POSITIVE_INFINITY;
    const record: SessionRecord = {
      sessionId,
      tenantId: principal.tenantId,
      userId: principal.userId,
      viewerToken,
      viewerTokenExpiresAt: now + VIEWER_TOKEN_TTL_MS,
      createdAt: now,
      expiresAt,
      lastActivityAt: now,
      status: "ready",
      control: { holder: "agent", since: now },
      currentUrl: "about:blank",
      replayJson: [],
    };
    this.sessions.set(sessionId, record);
    this.tokens.set(viewerToken, sessionId);
    return record;
  }

  getById(sessionId: string): SessionRecord | undefined {
    return this.sessions.get(sessionId);
  }

  /** Iterate active sessions (for tenant cap counts, janitor sweep, etc.). */
  list(): SessionRecord[] {
    return [...this.sessions.values()];
  }

  countByTenant(tenantId: string): number {
    let n = 0;
    for (const r of this.sessions.values()) if (r.tenantId === tenantId) n += 1;
    return n;
  }

  resolveViewerToken(viewerToken: string): SessionRecord | undefined {
    const sessionId = this.tokens.get(viewerToken);
    if (!sessionId) return undefined;
    const rec = this.sessions.get(sessionId);
    if (!rec) return undefined;
    if (this.now() > rec.viewerTokenExpiresAt) {
      this.tokens.delete(viewerToken);
      return undefined;
    }
    return rec;
  }

  delete(sessionId: string): void {
    const rec = this.sessions.get(sessionId);
    if (rec) this.tokens.delete(rec.viewerToken);
    this.sessions.delete(sessionId);
    // Per Fix 2: poll queues live with the store, so they're cleaned up automatically.
    this.pollQueues.delete(sessionId);
  }

  updateControl(sessionId: string, holder: ControlHolder): SessionRecord | undefined {
    const rec = this.sessions.get(sessionId);
    if (!rec) return undefined;
    const now = this.now();
    rec.control = { holder, since: now };
    rec.status = holder === "idle" ? "active" : "active";
    rec.lastActivityAt = now;
    return rec;
  }

  setCurrentUrl(sessionId: string, url: string): void {
    const rec = this.sessions.get(sessionId);
    if (rec) {
      rec.currentUrl = url;
      rec.lastActivityAt = this.now();
    }
  }

  /** Mark a session as freshly active (called on per-session HTTP routes). */
  touch(sessionId: string): void {
    const rec = this.sessions.get(sessionId);
    if (rec) rec.lastActivityAt = this.now();
  }

  /** Snapshot of recent server→viewer JSON for reconnect (ring buffer, not cleared). */
  peekReplay(sessionId: string): string[] {
    const rec = this.sessions.get(sessionId);
    return rec ? [...rec.replayJson] : [];
  }

  appendUpstreamJson(sessionId: string, jsonText: string): void {
    const rec = this.sessions.get(sessionId);
    if (!rec) return;
    if (maybeRecordReplay(rec, jsonText)) {
      rec.lastActivityAt = this.now();
    }
  }

  // ---------- Poll queue ownership (Fix 2) ----------

  enqueuePoll(sessionId: string, bin: boolean, data: Buffer): void {
    if (!this.sessions.has(sessionId)) return;
    let q = this.pollQueues.get(sessionId);
    if (!q) {
      q = [];
      this.pollQueues.set(sessionId, q);
    }
    q.push({ bin, data: Buffer.from(data) });
    if (q.length > 200) q.splice(0, q.length - 200);
  }

  drainPollBatch(
    sessionId: string,
    max = 32,
  ): Array<{ bin: boolean; b64?: string; text?: string }> {
    const q = this.pollQueues.get(sessionId);
    if (!q || q.length === 0) return [];
    const batch = q.splice(0, max);
    return batch.map(({ bin, data }) =>
      bin
        ? { bin: true, b64: data.toString("base64") }
        : { bin: false, text: data.toString("utf8") },
    );
  }

  /** Test/inspection helper. */
  hasPollQueue(sessionId: string): boolean {
    return this.pollQueues.has(sessionId);
  }

  // ---------- Janitor (Fix 4) ----------

  /** Sweep expired sessions. Public so hosts/tests can trigger a sweep on demand. */
  sweep(): void {
    const now = this.now();
    const idleTtl = this.policies.idleTtlMs;
    for (const rec of [...this.sessions.values()]) {
      if (now > rec.expiresAt) {
        this.delete(rec.sessionId);
        this.onSessionExpired?.(rec.sessionId, "session_ttl");
        continue;
      }
      if (Number.isFinite(idleTtl) && now - rec.lastActivityAt > idleTtl) {
        this.delete(rec.sessionId);
        this.onSessionExpired?.(rec.sessionId, "idle_ttl");
      }
    }
  }
}
