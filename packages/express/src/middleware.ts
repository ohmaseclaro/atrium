import express, { type Request, type Response, type Router } from "express";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { ControlHolder } from "@atriumjs/protocol";
import { sessionBootstrapBodySchema, sessionSnapshotApplyBodySchema } from "@atriumjs/protocol";
import { WebSocket, WebSocketServer } from "ws";
import type { AtriumConfig } from "./types.js";
import { MemorySessionStore } from "./session-store.js";
import { urlAllowed } from "./url-allowlist.js";
import { workerInternalFetch } from "./worker-client.js";

export type AtriumMount = {
  router: Router;
  /**
   * Attach to `httpServer.on("upgrade", ...)` for viewer WebSocket streams.
   * Only paths under the mount prefix with `/sessions/:id/stream` are handled.
   */
  handleViewerUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
};

export function viewerStreamMatch(
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
    const parsed = sessionBootstrapBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_session_body", detail: parsed.error.flatten() });
      return;
    }
    const b = parsed.data;
    const hasStorageState = b.storageState != null && typeof b.storageState === "object";
    const hasBootstrap =
      hasStorageState ||
      (b.cookies?.length ?? 0) > 0 ||
      (b.initialUrl !== undefined && b.initialUrl.length > 0) ||
      b.viewport !== undefined ||
      (b.clientCertificates?.length ?? 0) > 0;

    const record = store.createSession(principal);

    if (hasBootstrap) {
      const payload: Record<string, unknown> = {};
      if (hasStorageState) payload.storageState = b.storageState;
      if (b.cookies !== undefined) payload.cookies = b.cookies;
      if (b.initialUrl !== undefined) payload.initialUrl = b.initialUrl;
      if (b.viewport !== undefined) payload.viewport = b.viewport;
      if (b.clientCertificates !== undefined) payload.clientCertificates = b.clientCertificates;

      const r = await workerInternalFetch(
        config.workerDialBase,
        config.workerSharedSecret,
        `/internal/session/${encodeURIComponent(record.sessionId)}/bootstrap`,
        { method: "POST", body: payload },
      );
      if (!r.ok) {
        store.delete(record.sessionId);
        const detail = await r.text();
        res
          .status(r.status === 400 ? 400 : 502)
          .json({ error: "worker_bootstrap_failed", detail: detail.slice(0, 2000) });
        return;
      }
    }

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
      status: record.status,
      control: record.control,
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
      userId: rec.userId,
      createdAt: rec.createdAt,
      status: rec.status,
      control: rec.control,
      currentUrl: rec.currentUrl,
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
    void workerInternalFetch(
      config.workerDialBase,
      config.workerSharedSecret,
      `/internal/session/${encodeURIComponent(rec.sessionId)}/pending-bootstrap`,
      { method: "DELETE" },
    ).catch(() => undefined);
    await config.hooks?.onSessionTerminated?.({
      sessionId: rec.sessionId,
      reason: "destroyed",
    });
    res.status(204).send();
  });

  router.post("/sessions/:id/control", async (req: Request, res: Response) => {
    await config.authorize(req);
    const rec = store.getById(req.params.id);
    if (!rec) {
      res.status(404).json({ error: "session_not_found" });
      return;
    }
    const body = req.body as { action?: string; to?: ControlHolder };
    if (body?.action !== "grant" && body?.action !== "release") {
      res.status(400).json({ error: "invalid_action" });
      return;
    }
    const next: ControlHolder =
      body.action === "release" ? "agent" : body.to === "human" ? "human" : "agent";
    store.updateControl(rec.sessionId, next);
    void workerInternalFetch(
      config.workerDialBase,
      config.workerSharedSecret,
      `/internal/session/${encodeURIComponent(rec.sessionId)}/control`,
      { method: "POST", body: { holder: next } },
    ).catch(() => undefined);
    await config.hooks?.onControlChange?.({ sessionId: rec.sessionId, holder: next });
    res.status(200).json({ control: store.getById(rec.sessionId)?.control });
  });

  router.post("/sessions/:id/x-demo/compose-tweet", async (req: Request, res: Response) => {
    await config.authorize(req);
    const rec = store.getById(req.params.id);
    if (!rec) {
      res.status(404).json({ error: "session_not_found" });
      return;
    }
    const text = (req.body as { text?: string })?.text;
    if (typeof text !== "string" || !text.trim()) {
      res.status(400).json({ error: "missing_text" });
      return;
    }
    const trimmed = text.trim();
    if (trimmed.length > 280) {
      res.status(400).json({ error: "text_too_long" });
      return;
    }
    const r = await workerInternalFetch(
      config.workerDialBase,
      config.workerSharedSecret,
      `/internal/session/${encodeURIComponent(req.params.id)}/x-demo/compose-tweet`,
      { method: "POST", body: { text: trimmed } },
    );
    if (!r.ok) {
      const detail = await r.text();
      res
        .status(
          r.status === 404
            ? 404
            : r.status === 409
              ? 409
              : r.status === 400
                ? 400
                : r.status === 501
                  ? 501
                  : 502,
        )
        .json({ error: "worker_x_compose_failed", detail: detail.slice(0, 2000) });
      return;
    }
    res.status(204).send();
  });

  router.post("/sessions/:id/navigate", async (req: Request, res: Response) => {
    await config.authorize(req);
    const rec = store.getById(req.params.id);
    if (!rec) {
      res.status(404).json({ error: "session_not_found" });
      return;
    }
    const url = (req.body as { url?: string })?.url;
    if (!url || typeof url !== "string") {
      res.status(400).json({ error: "missing_url" });
      return;
    }
    if (!urlAllowed(url, config.policies.urlAllowlist)) {
      res.status(400).json({ error: "url_not_allowed" });
      return;
    }
    const r = await workerInternalFetch(
      config.workerDialBase,
      config.workerSharedSecret,
      `/internal/session/${encodeURIComponent(req.params.id)}/navigate`,
      { method: "POST", body: { url } },
    );
    if (!r.ok) {
      const t = await r.text();
      res.status(502).json({ error: "worker_navigate_failed", detail: t });
      return;
    }
    store.setCurrentUrl(rec.sessionId, url);
    res.status(204).send();
  });

  router.get("/sessions/:id/cookies", async (req: Request, res: Response) => {
    await config.authorize(req);
    const rec = store.getById(req.params.id);
    if (!rec) {
      res.status(404).json({ error: "session_not_found" });
      return;
    }
    const r = await workerInternalFetch(
      config.workerDialBase,
      config.workerSharedSecret,
      `/internal/session/${encodeURIComponent(req.params.id)}/cookies`,
    );
    if (!r.ok) {
      res.status(r.status === 404 ? 404 : 502).json({ error: "worker_cookies_failed" });
      return;
    }
    const data = (await r.json()) as unknown;
    res.json(data);
  });

  router.get("/sessions/:id/storage-state", async (req: Request, res: Response) => {
    await config.authorize(req);
    const rec = store.getById(req.params.id);
    if (!rec) {
      res.status(404).json({ error: "session_not_found" });
      return;
    }
    const r = await workerInternalFetch(
      config.workerDialBase,
      config.workerSharedSecret,
      `/internal/session/${encodeURIComponent(req.params.id)}/storage-state`,
    );
    if (!r.ok) {
      res.status(r.status === 404 ? 404 : 502).json({ error: "worker_storage_failed" });
      return;
    }
    const data = (await r.json()) as unknown;
    res.json(data);
  });

  router.get("/sessions/:id/session-snapshot", async (req: Request, res: Response) => {
    await config.authorize(req);
    const rec = store.getById(req.params.id);
    if (!rec) {
      res.status(404).json({ error: "session_not_found" });
      return;
    }
    const base = `/internal/session/${encodeURIComponent(req.params.id)}`;
    const [rc, rs] = await Promise.all([
      workerInternalFetch(config.workerDialBase, config.workerSharedSecret, `${base}/cookies`),
      workerInternalFetch(
        config.workerDialBase,
        config.workerSharedSecret,
        `${base}/storage-state`,
      ),
    ]);
    if (!rc.ok || !rs.ok) {
      const code = rc.status === 404 || rs.status === 404 ? 404 : 502;
      res.status(code).json({ error: "worker_snapshot_failed" });
      return;
    }
    const cookies = (await rc.json()) as unknown;
    const storageState = (await rs.json()) as unknown;
    res.json({ cookies, storageState });
  });

  router.post("/sessions/:id/session-snapshot", async (req: Request, res: Response) => {
    await config.authorize(req);
    const rec = store.getById(req.params.id);
    if (!rec) {
      res.status(404).json({ error: "session_not_found" });
      return;
    }
    const parsed = sessionSnapshotApplyBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_snapshot_body", detail: parsed.error.flatten() });
      return;
    }
    const r = await workerInternalFetch(
      config.workerDialBase,
      config.workerSharedSecret,
      `/internal/session/${encodeURIComponent(req.params.id)}/apply-session`,
      { method: "POST", body: parsed.data },
    );
    if (!r.ok) {
      const t = await r.text();
      res
        .status(r.status === 404 ? 404 : r.status === 400 ? 400 : 502)
        .json({ error: "worker_apply_failed", detail: t.slice(0, 2000) });
      return;
    }
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
      for (const line of store.peekReplay(match.sessionId)) {
        if (viewer.readyState === WebSocket.OPEN) viewer.send(line);
      }
      const dialBase = config.workerDialBase.replace(/\/$/, "");
      const wsBase = dialBase.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
      const upstreamUrl = `${wsBase}/internal/stream/${match.sessionId}`;
      const upstream = new WebSocket(upstreamUrl, {
        headers: { Authorization: `Bearer ${config.workerSharedSecret}` },
        ...(config.workerTls ? { ...config.workerTls } : {}),
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
        if (!isBinary) {
          store.appendUpstreamJson(match.sessionId, data.toString());
        }
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
