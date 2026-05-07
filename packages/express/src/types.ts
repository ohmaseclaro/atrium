import type { Request } from "express";
import type { ControlHolder, SessionStatus } from "@atriumjs/protocol";

export type Principal = {
  tenantId: string;
  userId: string;
  scopes?: string[];
};

export type AtriumPolicies = {
  sessionTtlMs: number;
  idleTtlMs: number;
  maxConcurrentSessionsPerTenant: number;
  urlAllowlist: string[];
  defaultViewport: { w: number; h: number };
};

export type AtriumHooks = {
  onSessionCreated?: (summary: {
    sessionId: string;
    tenantId: string;
    userId: string;
  }) => void | Promise<void>;
  onSessionTerminated?: (summary: { sessionId: string; reason: string }) => void | Promise<void>;
  onControlChange?: (summary: { sessionId: string; holder: ControlHolder }) => void | Promise<void>;
};

export type AtriumConfig = {
  redis: { url: string };
  /** Host resolves identity for HTTP; WS viewer tokens are verified separately. */
  authorize: (req: Request) => Promise<Principal>;
  policies: AtriumPolicies;
  hooks?: AtriumHooks;
  /**
   * Base URL for the worker backplane, e.g. ws://127.0.0.1:7070.
   * The API opens outbound WebSockets to `${workerDialBase}/internal/stream/:sessionId` (dial pattern).
   */
  workerDialBase: string;
  /** Shared secret sent as Authorization: Bearer on API→worker WebSockets and internal HTTP. */
  workerSharedSecret: string;
  /** HTTP path prefix where routes mount (no trailing slash). */
  mountPath?: string;
  /** Optional TLS options for the API→worker WebSocket dial (e.g. private CA in staging). */
  workerTls?: { rejectUnauthorized?: boolean };
};

export type SessionRecord = {
  sessionId: string;
  tenantId: string;
  userId: string;
  viewerToken: string;
  viewerTokenExpiresAt: number;
  createdAt: number;
  status: SessionStatus;
  control: { holder: ControlHolder; since: number };
  currentUrl: string;
  /** Recent JSON text frames (`hello`, `control`, `navigate`, `title`, `viewport`, `loading`, `tabs`) for viewer reconnect replay. */
  replayJson: string[];
};
