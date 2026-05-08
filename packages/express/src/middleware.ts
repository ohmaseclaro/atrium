import express, { type Request, type Response, type Router } from "express";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
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
    publicBaseUrl: config.publicBaseUrl,
    enableDemoComposeRoutes: config.enableDemoComposeRoutes,
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
      const pb = config.publicBaseUrl?.trim();
      const origin =
        pb && (pb.startsWith("http://") || pb.startsWith("https://"))
          ? pb.replace(/\/$/, "")
          : pb
            ? `${proto}://${pb.replace(/\/$/, "")}`
            : `${proto}://${host}`;
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
      // Stream the body when the response is event-stream-y (SSE), so viewers receive
      // each `data:` chunk immediately instead of waiting for the upstream WS to close.
      // Buffering via `arrayBuffer()` defeats SSE end-to-end.
      const ctype = (webRes.headers.get("content-type") ?? "").toLowerCase();
      const isStreaming = ctype.includes("text/event-stream") || ctype.includes("application/x-ndjson");
      if (isStreaming && webRes.body) {
        // Disable any compression / buffering middleware downstream and flush headers
        // immediately so the first bytes hit the wire.
        res.setHeader("X-Accel-Buffering", "no");
        if (typeof (res as unknown as { flushHeaders?: () => void }).flushHeaders === "function") {
          (res as unknown as { flushHeaders: () => void }).flushHeaders();
        }
        const nodeStream = Readable.fromWeb(
          webRes.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>,
        );
        nodeStream.on("error", (err) => {
          // Make sure a torn upstream doesn't leave the viewer hung.
          try {
            res.end();
          } catch {
            /* already ended */
          }
          // eslint-disable-next-line no-console
          console.warn("[atrium] SSE stream relay error", err);
        });
        // Tear down the upstream when the viewer hangs up so we don't leak a Reader.
        res.on("close", () => {
          nodeStream.destroy();
        });
        nodeStream.pipe(res);
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
