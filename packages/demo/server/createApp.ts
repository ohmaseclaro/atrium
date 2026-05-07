import express, { type Request } from "express";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { atrium } from "@atrium/server";

const DEFAULT_WORKER_DIAL = "ws://127.0.0.1:7070";
const DEFAULT_SECRET = "dev-secret-change-me";

export type AtriumDemoApp = {
  app: express.Express;
  handleViewerUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
};

export function createAtriumDemoApp(): AtriumDemoApp {
  const app = express();
  const workerDialBase = process.env.ATRIUM_WORKER_DIAL_BASE ?? DEFAULT_WORKER_DIAL;
  const workerSharedSecret = process.env.ATRIUM_WORKER_SECRET ?? DEFAULT_SECRET;

  const { router, handleViewerUpgrade } = atrium({
    redis: { url: process.env.REDIS_URL ?? "redis://127.0.0.1:6379" },
    authorize: async (_req: Request) => ({ tenantId: "demo", userId: "demo-user" }),
    ...(process.env.ATRIUM_WORKER_TLS_INSECURE === "1"
      ? { workerTls: { rejectUnauthorized: false } }
      : {}),
    policies: {
      sessionTtlMs: 15 * 60_000,
      idleTtlMs: 5 * 60_000,
      maxConcurrentSessionsPerTenant: 5,
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
