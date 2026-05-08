import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { dispatchAtrium } from "./dispatch.js";
import type { AtriumHttpInput } from "./http-input.js";
import { webRequestToAtriumInput } from "./http-input.js";
import { MemorySessionStore } from "./memory-session-store.js";
import {
  handleNodeViewerUpgrade as wireViewerUpgrade,
  handlePollGet,
  handleSseGet,
  handleStreamInput,
  viewerStreamMatch,
  type StreamCtx,
} from "./streaming.js";
import type { CreateAtriumConfig } from "./types.js";
import { workerInternalFetch } from "./worker-client.js";

export { viewerStreamMatch };

export type AtriumCore = ReturnType<typeof createAtrium>;

/**
 * Wire the framework-agnostic Atrium core. Returns an API object with HTTP/WS handlers
 * plus a `dispose()` method that hosts SHOULD call on shutdown to stop the in-process
 * session-TTL janitor (otherwise its `setInterval` keeps the event loop alive longer
 * than necessary).
 */
export function createAtrium(config: CreateAtriumConfig) {
  const mount = (config.mountPath ?? "/atrium").replace(/\/$/, "");
  const transports = config.transports ?? (["ws"] as const);

  const store = new MemorySessionStore({
    policies: {
      sessionTtlMs: config.policies.sessionTtlMs,
      idleTtlMs: config.policies.idleTtlMs,
    },
    onSessionExpired: (sessionId, reason) => {
      // Best-effort: tell the worker to drop pending bootstrap, then fire the host hook.
      void workerInternalFetch(
        config.worker.dialBase,
        config.worker.sharedSecret,
        `/internal/session/${encodeURIComponent(sessionId)}/pending-bootstrap`,
        { method: "DELETE" },
      ).catch(() => undefined);
      void Promise.resolve(config.hooks?.onSessionTerminated?.({ sessionId, reason })).catch(
        () => undefined,
      );
    },
  });

  const streamCtx: StreamCtx = {
    store,
    config,
    mount,
    workerDialBase: config.worker.dialBase,
    workerSharedSecret: config.worker.sharedSecret,
    workerTls: config.worker.tls,
  };

  const api = {
    mountPath: mount,
    transports,
    memoryStore: store,

    /** Stop background workers (janitor) so the host can shut down cleanly. */
    dispose(): void {
      store.dispose();
    },

    async handleHttpInput(input: AtriumHttpInput, meta: { origin: string }): Promise<Response> {
      const p = input.path;
      if (input.method === "GET" && p.endsWith("/stream/sse")) {
        return handleSseGet(p, streamCtx, input);
      }
      if (input.method === "GET" && p.endsWith("/stream/poll")) {
        return handlePollGet(p, streamCtx, input);
      }
      if (input.method === "POST" && p.endsWith("/stream/input")) {
        return handleStreamInput(p, streamCtx, input);
      }
      return dispatchAtrium({
        input,
        store,
        config,
        policies: config.policies,
        workerDialBase: config.worker.dialBase,
        workerSharedSecret: config.worker.sharedSecret,
        workerTls: config.worker.tls,
        mount,
        origin: meta.origin,
        transports: [...transports],
      });
    },

    async handleRequest(req: Request): Promise<Response> {
      const u = new URL(req.url);
      const origin = u.origin;
      if (!u.pathname.startsWith(mount)) {
        return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
      }
      const innerPath = u.pathname.slice(mount.length) || "/";
      const base = await webRequestToAtriumInput(req);
      const input = { ...base, path: innerPath };
      return api.handleHttpInput(input, { origin });
    },

    handleNodeViewerUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
      wireViewerUpgrade(mount, streamCtx, req, socket, head);
    },
  };

  return api;
}

export function createMemoryStore(): MemorySessionStore {
  return new MemorySessionStore();
}
