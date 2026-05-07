import { randomBytes } from "node:crypto";
import type { Principal } from "./types.js";
import type { SessionRecord } from "./types.js";

const VIEWER_TOKEN_TTL_MS = 5 * 60_000;

function randomToken(): string {
  return randomBytes(32).toString("base64url");
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
}
