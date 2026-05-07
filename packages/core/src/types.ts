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

/** @deprecated Use `worker` on CreateAtriumConfig; kept for express adapter mapping */
export type LegacyAtriumConfigShape = {
  redis?: { url: string };
  authorize: (input: AtriumHttpInput) => Promise<Principal>;
  policies: AtriumPolicies;
  hooks?: AtriumHooks;
  workerDialBase: string;
  workerSharedSecret: string;
  mountPath?: string;
  workerTls?: { rejectUnauthorized?: boolean };
};

export type CreateAtriumConfig = {
  authorize: (input: AtriumHttpInput) => Promise<Principal>;
  policies: AtriumPolicies;
  hooks?: AtriumHooks;
  worker: WorkerConfig;
  mountPath?: string;
  /** Advertised viewer transports on POST /sessions */
  transports?: Array<"ws" | "sse" | "poll">;
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
  replayJson: string[];
};

export type TransportOfferWs = { kind: "ws"; url: string };
export type TransportOfferSse = { kind: "sse"; framesUrl: string; inputUrl: string };
export type TransportOfferPoll = { kind: "poll"; url: string; inputUrl: string };
export type TransportOffer = TransportOfferWs | TransportOfferSse | TransportOfferPoll;
