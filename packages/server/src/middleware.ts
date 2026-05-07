import express, { type Request, type Response, type Router } from "express";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type { AtriumConfig } from "./types.js";
import { MemorySessionStore } from "./session-store.js";

export type AtriumMount = {
  router: Router;
  /**
   * Attach to `httpServer.on("upgrade", ...)` for viewer WebSocket streams.
   * Only paths under the mount prefix with `/sessions/:id/stream` are handled.
   */
  handleViewerUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
};

function viewerStreamMatch(
  mountPath: string,
  pathname: string,
): { sessionId: string } | undefined {
  const prefix = `${mountPath.replace(/\/$/, "")}/sessions/`;
  if (!pathname.startsWith(prefix) || !pathname.endsWith("/stream")) return undefined;
  const mid = pathname.slice(prefix.length, -"/stream".length);
  if (!mid || mid.includes("/")) return undefined;
  return { sessionId: mid };
}

export function atrium(config: AtriumConfig): AtriumMount {
  const mount = (config.mountPath ?? "/atrium").replace(/\/$/, "");
  const store = new MemorySessionStore();
  const router = express.Router();
  router.use(express.json());

  router.post("/sessions", async (req: Request, res: Response) => {
    const principal = await config.authorize(req);
    const record = store.createSession(principal);
    const hostHeader = req.get("host") ?? "localhost";
    const proto = req.protocol === "https" ? "wss" : "ws";
    const wsUrl = `${proto}://${hostHeader}${mount}/sessions/${record.sessionId}/stream`;
    await config.hooks?.onSessionCreated?.({
      sessionId: record.sessionId,
      tenantId: record.tenantId,
      userId: record.userId,
    });
    res.status(201).json({
      sessionId: record.sessionId,
      viewerToken: record.viewerToken,
      wsUrl,
      expiresAt: record.viewerTokenExpiresAt,
    });
  });

  router.get("/sessions/:id", (req: Request, res: Response) => {
    const rec = store.getById(req.params.id);
    if (!rec) {
      res.status(404).json({ error: "session_not_found" });
      return;
    }
    res.json({
      sessionId: rec.sessionId,
      tenantId: rec.tenantId,
      createdAt: rec.createdAt,
    });
  });

  router.delete("/sessions/:id", async (req: Request, res: Response) => {
    await config.authorize(req);
    const rec = store.getById(req.params.id);
    if (!rec) {
      res.status(404).json({ error: "session_not_found" });
      return;
    }
    store.delete(rec.sessionId);
    await config.hooks?.onSessionTerminated?.({
      sessionId: rec.sessionId,
      reason: "destroyed",
    });
    res.status(204).send();
  });

  router.get("/healthz", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  router.get("/readyz", (_req: Request, res: Response) => {
    res.json({ ok: true, workerDialBase: config.workerDialBase });
  });

  function handleViewerUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const host = req.headers.host ?? "localhost";
    const url = new URL(req.url ?? "/", `http://${host}`);
    const match = viewerStreamMatch(mount, url.pathname);
    if (!match) return;
    const wss = new WebSocketServer({ noServer: true });
    wss.handleUpgrade(req, socket, head, (viewer: WebSocket) => {
      const token = url.searchParams.get("token") ?? "";
      const record = store.resolveViewerToken(token);
      if (!record || record.sessionId !== match.sessionId) {
        viewer.close(4403, "invalid_token");
        return;
      }
      const dialBase = config.workerDialBase.replace(/\/$/, "");
      const wsBase = dialBase.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
      const upstreamUrl = `${wsBase}/internal/stream/${match.sessionId}`;
      const upstream = new WebSocket(upstreamUrl, {
        headers: { Authorization: `Bearer ${config.workerSharedSecret}` },
      });
      const closeBoth = (): void => {
        try {
          viewer.close();
        } catch {
          /* ignore */
        }
        try {
          upstream.close();
        } catch {
          /* ignore */
        }
      };
      upstream.on("open", () => {
        viewer.on("message", (data, isBinary) => {
          if (upstream.readyState === WebSocket.OPEN) {
            upstream.send(data, { binary: Boolean(isBinary) });
          }
        });
      });
      upstream.on("message", (data, isBinary) => {
        if (viewer.readyState === WebSocket.OPEN) {
          viewer.send(data, { binary: Boolean(isBinary) });
        }
      });
      const onError = (): void => closeBoth();
      upstream.on("error", onError);
      viewer.on("error", onError);
      upstream.on("close", () => viewer.close());
      viewer.on("close", () => upstream.close());
    });
  }

  return { router, handleViewerUpgrade };
}
