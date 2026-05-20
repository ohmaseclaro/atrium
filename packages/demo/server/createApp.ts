import express, { type Request } from "express";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { atrium } from "@atriumjs/express";

const DEFAULT_WORKER_DIAL = "ws://127.0.0.1:7070";
const DEFAULT_SECRET = "dev-secret-change-me";

export type AtriumDemoApp = {
  app: express.Express;
  handleViewerUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
};

export function createAtriumDemoApp(): AtriumDemoApp {
  const app = express();
  // One hop (nginx / Cloudflare) sets X-Forwarded-Proto — without this, req.protocol
  // stays "http" and session responses use ws:// + http:// (mixed content on https pages).
  app.set("trust proxy", 1);
  const workerDialBase = process.env.ATRIUM_WORKER_DIAL_BASE ?? DEFAULT_WORKER_DIAL;
  const workerSharedSecret = process.env.ATRIUM_WORKER_SECRET ?? DEFAULT_SECRET;

  const { router, handleViewerUpgrade } = atrium({
    // Derive a per-visitor tenant from IP so each visitor has their own session
    // slot budget and one misbehaving client can't exhaust the shared pool.
    authorize: async (req: Request) => {
      const ip =
        (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
        req.ip ??
        "unknown";
      return { tenantId: `demo:${ip}`, userId: "demo-user" };
    },
    ...(process.env.ATRIUM_PUBLIC_BASE_URL?.trim()
      ? { publicBaseUrl: process.env.ATRIUM_PUBLIC_BASE_URL.trim() }
      : {}),
    enableDemoComposeRoutes: true,
    ...(process.env.ATRIUM_WORKER_TLS_INSECURE === "1"
      ? { workerTls: { rejectUnauthorized: false } }
      : {}),
    policies: {
      sessionTtlMs: 15 * 60_000,
      // Aggressively evict idle sessions so stale browsers don't occupy slots.
      // The demo flow frees the session explicitly on success; this is the safety
      // net for abandonment (tab close, navigation away without clicking Close).
      idleTtlMs: 2 * 60_000,
      // Per-IP budget: one user should never need more than 2 concurrent sessions.
      maxConcurrentSessionsPerTenant: 2,
      urlAllowlist: ["*"],
      defaultViewport: { w: 1280, h: 800 },
    },
    workerDialBase,
    workerSharedSecret,
    mountPath: "/atrium",
    hooks: {
      onSessionCreated: ({ sessionId, tenantId }) => {
        console.log(`[atrium-demo] session_created ${sessionId} tenant=${tenantId}`);
      },
      onSessionTerminated: ({ sessionId, reason }) => {
        console.log(`[atrium-demo] session_terminated ${sessionId} reason=${reason}`);
      },
    },
  });

  app.use("/atrium", router);

  return { app, handleViewerUpgrade };
}
