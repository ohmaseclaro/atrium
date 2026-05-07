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

export { viewerStreamMatch };

export type AtriumCore = ReturnType<typeof createAtrium>;

export function createAtrium(config: CreateAtriumConfig) {
  const store = new MemorySessionStore();
  const mount = (config.mountPath ?? "/atrium").replace(/\/$/, "");
  const transports = config.transports ?? (["ws", "sse", "poll"] as const);

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
