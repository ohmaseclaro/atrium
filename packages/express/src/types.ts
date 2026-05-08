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
  /**
   * Ordered viewer transports advertised on `POST /sessions` (highest priority first).
   * The dispatch handler picks the first entry the request can support and returns ONLY
   * that transport in the response — advertising more than one would let a second viewer
   * dial kick the first off the worker's single sink WebSocket. Defaults to `["ws"]`.
   */
  transports?: Array<"ws" | "sse" | "poll">;
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
  /** Host resolves identity for HTTP; WS viewer tokens are verified separately. */
  authorize: (req: Request) => Promise<Principal>;
  policies: AtriumPolicies;
  hooks?: AtriumHooks;
  /**
   * Ordered viewer transports advertised on `POST /sessions` (highest priority first).
   * The dispatch handler picks the first entry the request can support and returns ONLY
   * that transport in the response. Defaults to `["ws"]`.
   */
  transports?: Array<"ws" | "sse" | "poll">;
  /**
   * Public origin for viewer URLs on `POST /sessions` (e.g. `https://api.example.com`).
   * When set, the `Host` header is not used for `wsUrl` / transport URLs (prevents Host forgery).
   */
  publicBaseUrl?: string;
  /** Enables demo-only `POST .../x-demo/compose-tweet`. Off by default. */
  enableDemoComposeRoutes?: boolean;
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
  /** Hard expiry; janitor destroys the session once `Date.now() > expiresAt`. */
  expiresAt: number;
  /** Updated on each replay append + per-session HTTP route call (idle TTL tracking). */
  lastActivityAt: number;
  status: SessionStatus;
  control: { holder: ControlHolder; since: number };
  currentUrl: string;
  /** Recent JSON text frames (`hello`, `control`, `navigate`, `title`, `viewport`, `loading`, `tabs`) for viewer reconnect replay. */
  replayJson: string[];
};
