import type { ControlHolder, SessionStatus } from "@atriumjs/protocol";
import type { AtriumHttpInput } from "./http-input.js";

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

export type WorkerConfig = {
  dialBase: string;
  sharedSecret: string;
  tls?: { rejectUnauthorized?: boolean };
};

export type CreateAtriumConfig = {
  authorize: (input: AtriumHttpInput) => Promise<Principal>;
  policies: AtriumPolicies;
  hooks?: AtriumHooks;
  worker: WorkerConfig;
  mountPath?: string;
  /** Advertised viewer transports on POST /sessions */
  transports?: Array<"ws" | "sse" | "poll">;
  /**
   * Public base URL for viewer WebSocket and transport URLs (e.g. `https://api.example.com`).
   * When set, POST /sessions ignores the incoming `Host` header for URL construction (Host forgery).
   * Should match the URL browsers use to reach this app (including path prefix if the app is not at `/`).
   */
  publicBaseUrl?: string;
  /**
   * When true, registers `POST /sessions/:id/x-demo/compose-tweet` (demo-only; not for production libraries).
   * @default false
   */
  enableDemoComposeRoutes?: boolean;
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
  replayJson: string[];
};

export type TransportOfferWs = { kind: "ws"; url: string };
export type TransportOfferSse = { kind: "sse"; framesUrl: string; inputUrl: string };
export type TransportOfferPoll = { kind: "poll"; url: string; inputUrl: string };
export type TransportOffer = TransportOfferWs | TransportOfferSse | TransportOfferPoll;
