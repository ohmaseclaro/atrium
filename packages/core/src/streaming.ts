import { WebSocket, WebSocketServer } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { AtriumHttpInput } from "./http-input.js";
import type { MemorySessionStore } from "./memory-session-store.js";
import type { CreateAtriumConfig } from "./types.js";

const pollQueues = new Map<string, Array<{ bin: boolean; data: Buffer }>>();

function enqueuePoll(sessionId: string, bin: boolean, data: Buffer): void {
  let q = pollQueues.get(sessionId);
  if (!q) {
    q = [];
    pollQueues.set(sessionId, q);
  }
  q.push({ bin, data: Buffer.from(data) });
  if (q.length > 200) q.splice(0, q.length - 200);
}

export function drainPollBatch(
  sessionId: string,
  max = 32,
): Array<{ bin: boolean; b64?: string; text?: string }> {
  const q = pollQueues.get(sessionId);
  if (!q || q.length === 0) return [];
  const batch = q.splice(0, max);
  return batch.map(({ bin, data }) =>
    bin ? { bin: true, b64: data.toString("base64") } : { bin: false, text: data.toString("utf8") },
  );
}

export type StreamCtx = {
  store: MemorySessionStore;
  config: CreateAtriumConfig;
  mount: string;
  workerDialBase: string;
  workerSharedSecret: string;
  workerTls?: { rejectUnauthorized?: boolean };
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

function parseSessionFromInner(inner: string, suffix: string): string | undefined {
  const m = new RegExp(`^/sessions/([^/]+)${suffix}$`).exec(inner);
  return m ? decodeURIComponent(m[1]) : undefined;
}

export async function handleStreamInput(
  innerPath: string,
  ctx: StreamCtx,
  input: AtriumHttpInput,
): Promise<Response> {
  const sessionId = parseSessionFromInner(innerPath, "/stream/input");
  if (!sessionId) {
    return new Response(JSON.stringify({ error: "bad_path" }), { status: 404 });
  }
  const token = input.query.get("token") ?? "";
  const rec = ctx.store.resolveViewerToken(token);
  if (!rec || rec.sessionId !== sessionId) {
    return new Response(JSON.stringify({ error: "invalid_token" }), { status: 403 });
  }
  const raw = await input.jsonBody();
  const buf = Buffer.from(JSON.stringify(raw));
  const dialBase = ctx.workerDialBase.replace(/\/$/, "");
  const wsBase = dialBase.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  const upstreamUrl = `${wsBase}/internal/stream/${sessionId}`;
  const upstream = new WebSocket(upstreamUrl, {
    headers: { Authorization: `Bearer ${ctx.workerSharedSecret}` },
    ...(ctx.workerTls ? { ...ctx.workerTls } : {}),
  });
  await new Promise<void>((resolve, reject) => {
    upstream.once("open", () => resolve());
    upstream.once("error", reject);
  });
  upstream.send(buf, { binary: false });
  upstream.close();
  return new Response(null, { status: 204 });
}

export async function handlePollGet(
  innerPath: string,
  ctx: StreamCtx,
  input: AtriumHttpInput,
): Promise<Response> {
  const sessionId = parseSessionFromInner(innerPath, "/stream/poll");
  if (!sessionId) {
    return new Response(JSON.stringify({ error: "bad_path" }), { status: 404 });
  }
  const token = input.query.get("token") ?? "";
  const rec = ctx.store.resolveViewerToken(token);
  if (!rec || rec.sessionId !== sessionId) {
    return new Response(JSON.stringify({ error: "invalid_token" }), { status: 403 });
  }

  const dialBase = ctx.workerDialBase.replace(/\/$/, "");
  const wsBase = dialBase.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  const upstreamUrl = `${wsBase}/internal/stream/${sessionId}`;
  const upstream = new WebSocket(upstreamUrl, {
    headers: { Authorization: `Bearer ${ctx.workerSharedSecret}` },
    ...(ctx.workerTls ? { ...ctx.workerTls } : {}),
  });

  await new Promise<void>((resolve, reject) => {
    upstream.once("open", () => resolve());
    upstream.once("error", reject);
  });

  for (const line of ctx.store.peekReplay(sessionId)) {
    upstream.send(line, { binary: false });
  }

  const frames = await new Promise<Array<{ bin: boolean; b64?: string; text?: string }>>(
    (resolve, reject) => {
      const t = setTimeout(() => {
        upstream.removeAllListeners();
        upstream.close();
        resolve(drainPollBatch(sessionId));
      }, 25_000);
      upstream.on("message", (data, isBinary) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        if (!isBinary) {
          ctx.store.appendUpstreamJson(sessionId, buf.toString("utf8"));
        }
        enqueuePoll(sessionId, Boolean(isBinary), buf);
        clearTimeout(t);
        upstream.removeAllListeners();
        upstream.close();
        resolve(drainPollBatch(sessionId));
      });
      upstream.on("error", (e) => {
        clearTimeout(t);
        reject(e);
      });
    },
  );

  return new Response(JSON.stringify({ frames }), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function handleSseGet(innerPath: string, ctx: StreamCtx, _input: AtriumHttpInput): Response {
  const sessionId = parseSessionFromInner(innerPath, "/stream/sse");
  if (!sessionId) {
    return new Response(JSON.stringify({ error: "bad_path" }), { status: 404 });
  }
  const token = _input.query.get("token") ?? "";
  const rec = ctx.store.resolveViewerToken(token);
  if (!rec || rec.sessionId !== sessionId) {
    return new Response(JSON.stringify({ error: "invalid_token" }), { status: 403 });
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode("retry: 2000\n\n"));
      const dialBase = ctx.workerDialBase.replace(/\/$/, "");
      const wsBase = dialBase.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
      const upstreamUrl = `${wsBase}/internal/stream/${sessionId}`;
      const upstream = new WebSocket(upstreamUrl, {
        headers: { Authorization: `Bearer ${ctx.workerSharedSecret}` },
        ...(ctx.workerTls ? { ...ctx.workerTls } : {}),
      });
      upstream.on("open", () => {
        for (const line of ctx.store.peekReplay(sessionId)) {
          controller.enqueue(enc.encode(`data: ${line}\n\n`));
        }
        upstream.on("message", (data, isBinary) => {
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
          if (!isBinary) {
            ctx.store.appendUpstreamJson(sessionId, buf.toString("utf8"));
            controller.enqueue(enc.encode(`data: ${buf.toString("utf8")}\n\n`));
          } else {
            controller.enqueue(enc.encode(`event: jpeg\ndata: ${buf.toString("base64")}\n\n`));
          }
        });
        upstream.on("close", () => {
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        });
        upstream.on("error", () => {
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        });
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

export function handleNodeViewerUpgrade(
  mount: string,
  ctx: StreamCtx,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `http://${host}`);
  const match = viewerStreamMatch(mount, url.pathname);
  if (!match) return;
  const wss = new WebSocketServer({ noServer: true });
  wss.handleUpgrade(req, socket, head, (viewer: WebSocket) => {
    const token = url.searchParams.get("token") ?? "";
    const record = ctx.store.resolveViewerToken(token);
    if (!record || record.sessionId !== match.sessionId) {
      viewer.close(4403, "invalid_token");
      return;
    }
    for (const line of ctx.store.peekReplay(match.sessionId)) {
      if (viewer.readyState === WebSocket.OPEN) viewer.send(line);
    }
    const dialBase = ctx.workerDialBase.replace(/\/$/, "");
    const wsBase = dialBase.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
    const upstreamUrl = `${wsBase}/internal/stream/${match.sessionId}`;
    const upstream = new WebSocket(upstreamUrl, {
      headers: { Authorization: `Bearer ${ctx.workerSharedSecret}` },
      ...(ctx.workerTls ? { ...ctx.workerTls } : {}),
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
        ctx.store.appendUpstreamJson(match.sessionId, data.toString());
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
