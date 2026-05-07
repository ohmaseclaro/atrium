import { randomBytes } from "node:crypto";
import type { ControlHolder } from "@atriumjs/protocol";
import type { Principal } from "./types.js";
import type { SessionRecord } from "./types.js";

const VIEWER_TOKEN_TTL_MS = 5 * 60_000;
const REPLAY_CAP = 20;

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

function maybeRecordReplay(record: SessionRecord, jsonText: string): void {
  try {
    const head = JSON.parse(jsonText) as { t?: string };
    if (!head.t || !REPLAY_TYPES.has(head.t)) return;
    record.replayJson.push(jsonText);
    if (record.replayJson.length > REPLAY_CAP) {
      record.replayJson.splice(0, record.replayJson.length - REPLAY_CAP);
    }
  } catch {
    /* ignore */
  }
}

export class MemorySessionStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly tokens = new Map<string, string>();

  createSession(principal: Principal): SessionRecord {
    const sessionId = randomToken().slice(0, 26);
    const viewerToken = randomToken();
    const now = Date.now();
    const record: SessionRecord = {
      sessionId,
      tenantId: principal.tenantId,
      userId: principal.userId,
      viewerToken,
      viewerTokenExpiresAt: now + VIEWER_TOKEN_TTL_MS,
      createdAt: now,
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

  resolveViewerToken(viewerToken: string): SessionRecord | undefined {
    const sessionId = this.tokens.get(viewerToken);
    if (!sessionId) return undefined;
    const rec = this.sessions.get(sessionId);
    if (!rec) return undefined;
    if (Date.now() > rec.viewerTokenExpiresAt) {
      this.tokens.delete(viewerToken);
      return undefined;
    }
    return rec;
  }

  delete(sessionId: string): void {
    const rec = this.sessions.get(sessionId);
    if (rec) this.tokens.delete(rec.viewerToken);
    this.sessions.delete(sessionId);
  }

  updateControl(sessionId: string, holder: ControlHolder): SessionRecord | undefined {
    const rec = this.sessions.get(sessionId);
    if (!rec) return undefined;
    const now = Date.now();
    rec.control = { holder, since: now };
    rec.status = holder === "idle" ? "active" : "active";
    return rec;
  }

  setCurrentUrl(sessionId: string, url: string): void {
    const rec = this.sessions.get(sessionId);
    if (rec) rec.currentUrl = url;
  }

  /** Snapshot of recent server→viewer JSON for reconnect (ring buffer, not cleared). */
  peekReplay(sessionId: string): string[] {
    const rec = this.sessions.get(sessionId);
    return rec ? [...rec.replayJson] : [];
  }

  appendUpstreamJson(sessionId: string, jsonText: string): void {
    const rec = this.sessions.get(sessionId);
    if (!rec) return;
    maybeRecordReplay(rec, jsonText);
  }
}
