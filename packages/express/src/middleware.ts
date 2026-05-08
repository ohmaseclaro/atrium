import express, { type Request, type Response, type Router } from "express";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { createAtrium, viewerStreamMatch } from "@atriumjs/core";
import type { AtriumConfig } from "./types.js";

export type AtriumMount = {
  router: Router;
  /**
   * Attach to `httpServer.on("upgrade", ...)` for viewer WebSocket streams.
   * Only paths under the mount prefix with `/sessions/:id/stream` are handled.
   */
  handleViewerUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
};

export { viewerStreamMatch };

function mapToCore(config: AtriumConfig) {
  return {
    authorize: (input: import("@atriumjs/core").AtriumHttpInput) =>
      config.authorize(input.nativeRequest as Request),
    policies: config.policies,
    hooks: config.hooks,
    worker: {
      dialBase: config.workerDialBase,
      sharedSecret: config.workerSharedSecret,
      tls: config.workerTls,
    },
    mountPath: config.mountPath,
    transports: config.transports,
  };
}

export function atrium(config: AtriumConfig): AtriumMount {
  const core = createAtrium(mapToCore(config));
  const router = express.Router();
  router.use(express.json());

  router.use(async (req: Request, res: Response, next) => {
    try {
      const host = req.get("host") ?? "localhost";
      // req.protocol respects X-Forwarded-Proto when the host app uses app.set("trust proxy", …).
      const proto = req.protocol === "https" ? "https" : "http";
      const origin = `${proto}://${host}`;
      const pathname = new URL(req.originalUrl, `${proto}://${host}`).pathname;
      const mount = (config.mountPath ?? "/atrium").replace(/\/$/, "");
      if (!pathname.startsWith(mount)) {
        return next();
      }
      const inner = pathname.slice(mount.length) || "/";
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v != null) headers.set(k, Array.isArray(v) ? v.join(",") : v);
      }
      const input: import("@atriumjs/core").AtriumHttpInput = {
        method: req.method,
        path: inner,
        query: new URL(req.originalUrl, `${proto}://${host}`).searchParams,
        headers,
        jsonBody: async () => req.body,
        nativeRequest: req,
      };
      const webRes = await core.handleHttpInput(input, { origin });
      res.status(webRes.status);
      webRes.headers.forEach((v, k) => {
        const lk = k.toLowerCase();
        if (lk === "content-length" || lk === "transfer-encoding") return;
        res.setHeader(k, v);
      });
      if (webRes.status === 204 || webRes.status === 304) {
        res.end();
        return;
      }
      const buf = Buffer.from(await webRes.arrayBuffer());
      res.end(buf);
    } catch (e) {
      next(e);
    }
  });

  return {
    router,
    handleViewerUpgrade: (req, socket, head) => core.handleNodeViewerUpgrade(req, socket, head),
  };
}
