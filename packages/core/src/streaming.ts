import { WebSocket, WebSocketServer } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { AtriumHttpInput } from "./http-input.js";
import type { MemorySessionStore } from "./memory-session-store.js";
import type { CreateAtriumConfig } from "./types.js";
import { urlAllowed } from "./url-allowlist.js";

/**
 * Returns `true` if a viewer→worker JSON message is safe to relay under the
 * configured URL allowlist. Currently only filters `t: "navigate"` because
 * that's the only viewer-driven message that names an arbitrary URL — the
 * other client messages (input, ime, request_control, etc.) target the
 * already-loaded page and inherit its origin's authority.
 */
function viewerMessageAllowed(raw: unknown, allowlist: string[]): boolean {
  if (typeof raw !== "object" || raw == null) return true;
  const msg = raw as { t?: unknown; url?: unknown };
  if (msg.t !== "navigate") return true;
  if (typeof msg.url !== "string") return false;
  return urlAllowed(msg.url, allowlist);
}

/**
 * Module-level WebSocketServer (Fix 3): viewers all share one `noServer` upgrader.
 * `WebSocketServer({ noServer: true })` is intentionally cheap — it doesn't bind
 * a port — but constructing it per-upgrade leaked event listeners on the shared
 * `wss.options` and complicated future shutdown.
 */
const viewerWss = new WebSocketServer({ noServer: true });

/** Connect-phase timeout for upstream WebSocket dials (Fix 6). */
const UPSTREAM_DIAL_TIMEOUT_MS = 10_000;

function dialUpstream(url: string, ctx: StreamCtx): { ws: WebSocket; opened: Promise<void> } {
  const ws = new WebSocket(url, {
    headers: { Authorization: `Bearer ${ctx.workerSharedSecret}` },
    ...(ctx.workerTls ? { ...ctx.workerTls } : {}),
  });
  const opened = new Promise<void>((resolve, reject) => {
    const onOpen = (): void => {
      cleanup();
      resolve();
    };
    const onError = (e: Error): void => {
      cleanup();
      reject(e);
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      ws.removeListener("open", onOpen);
      ws.removeListener("error", onError);
    };
    const timer = setTimeout(() => {
      cleanup();
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
      reject(new Error("upstream_dial_timeout"));
    }, UPSTREAM_DIAL_TIMEOUT_MS);
    ws.once("open", onOpen);
    ws.once("error", onError);
  });
  return { ws, opened };
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
  ctx.store.touch(sessionId);
  const raw = await input.jsonBody();
  // Enforce URL allowlist on viewer-driven `navigate` before any worker round-trip.
  // Without this, a viewer holding a token could navigate the remote page anywhere,
  // bypassing `policies.urlAllowlist` (which is only enforced on the HTTP navigate route).
  if (!viewerMessageAllowed(raw, ctx.config.policies.urlAllowlist)) {
    return new Response(JSON.stringify({ error: "url_not_allowed" }), { status: 403 });
  }
  const buf = Buffer.from(JSON.stringify(raw));
  const dialBase = ctx.workerDialBase.replace(/\/$/, "");
  const wsBase = dialBase.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  const upstreamUrl = `${wsBase}/internal/stream/${sessionId}`;
  const { ws: upstream, opened } = dialUpstream(upstreamUrl, ctx);
  try {
    await opened;
  } catch (e) {
    console.warn("[atrium] stream/input upstream dial error", e);
    return new Response(JSON.stringify({ error: "upstream_unavailable" }), { status: 502 });
  }
  // Swallow post-dial transport errors — `ws` would otherwise throw on unhandled 'error'.
  upstream.on("error", (e) => console.warn("[atrium] stream/input upstream post-dial error", e));
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
  ctx.store.touch(sessionId);

  const dialBase = ctx.workerDialBase.replace(/\/$/, "");
  const wsBase = dialBase.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  const upstreamUrl = `${wsBase}/internal/stream/${sessionId}`;
  const { ws: upstream, opened } = dialUpstream(upstreamUrl, ctx);
  try {
    await opened;
  } catch (e) {
    console.warn("[atrium] poll upstream dial error", e);
    return new Response(JSON.stringify({ error: "upstream_unavailable" }), { status: 502 });
  }

  for (const line of ctx.store.peekReplay(sessionId)) {
    upstream.send(line, { binary: false });
  }

  const frames = await new Promise<Array<{ bin: boolean; b64?: string; text?: string }>>(
    (resolve, reject) => {
      const t = setTimeout(() => {
        upstream.removeAllListeners();
        upstream.close();
        resolve(ctx.store.drainPollBatch(sessionId));
      }, 25_000);
      upstream.on("message", (data, isBinary) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        if (!isBinary) {
          ctx.store.appendUpstreamJson(sessionId, buf.toString("utf8"));
        }
        ctx.store.enqueuePoll(sessionId, Boolean(isBinary), buf);
        clearTimeout(t);
        upstream.removeAllListeners();
        upstream.close();
        resolve(ctx.store.drainPollBatch(sessionId));
      });
      upstream.on("error", (e) => {
        console.warn("[atrium] poll upstream frame error", e);
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
  ctx.store.touch(sessionId);

  const enc = new TextEncoder();
  // Hold the upstream WS in closure so `cancel()` can tear it down (Fix 1).
  let upstream: WebSocket | undefined;
  let cancelled = false;
  let dialTimer: ReturnType<typeof setTimeout> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode("retry: 2000\n\n"));
      const dialBase = ctx.workerDialBase.replace(/\/$/, "");
      const wsBase = dialBase.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
      const upstreamUrl = `${wsBase}/internal/stream/${sessionId}`;
      upstream = new WebSocket(upstreamUrl, {
        headers: { Authorization: `Bearer ${ctx.workerSharedSecret}` },
        ...(ctx.workerTls ? { ...ctx.workerTls } : {}),
      });
      const ws = upstream;
      // Match `dialUpstream`'s connect-phase timeout for parity (Fix 6 also for SSE).
      // Without this, a wedged worker could leave the SSE stream open indefinitely.
      dialTimer = setTimeout(() => {
        try {
          ws.terminate();
        } catch {
          /* ignore */
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }, UPSTREAM_DIAL_TIMEOUT_MS);
      ws.on("open", () => {
        if (dialTimer) {
          clearTimeout(dialTimer);
          dialTimer = undefined;
        }
        if (cancelled) {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          return;
        }
        for (const line of ctx.store.peekReplay(sessionId)) {
          controller.enqueue(enc.encode(`data: ${line}\n\n`));
        }
        ws.on("message", (data, isBinary) => {
          if (cancelled) return;
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
          if (!isBinary) {
            ctx.store.appendUpstreamJson(sessionId, buf.toString("utf8"));
            controller.enqueue(enc.encode(`data: ${buf.toString("utf8")}\n\n`));
          } else {
            controller.enqueue(enc.encode(`event: jpeg\ndata: ${buf.toString("base64")}\n\n`));
          }
        });
        ws.on("close", () => {
          try {
            controller.close();
          } catch (e) {
            console.warn("[atrium] SSE upstream close cleanup", e);
          }
        });
        ws.on("error", (e) => {
          console.warn("[atrium] SSE upstream error", e);
          try {
            controller.close();
          } catch (err) {
            console.warn("[atrium] SSE controller close after error", err);
          }
        });
      });
      ws.on("error", (e) => {
        // Dial-phase failure: close the controller so the viewer disconnects cleanly.
        if (dialTimer) {
          clearTimeout(dialTimer);
          dialTimer = undefined;
        }
        console.warn("[atrium] SSE upstream dial error", e);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      // Viewer disconnected — tear down the upstream WS so the worker stops sending
      // frames and we don't leak a connection per dropped viewer (Fix 1).
      cancelled = true;
      if (dialTimer) {
        clearTimeout(dialTimer);
        dialTimer = undefined;
      }
      if (upstream) {
        try {
          upstream.removeAllListeners();
        } catch {
          /* ignore */
        }
        try {
          if (
            upstream.readyState === WebSocket.OPEN ||
            upstream.readyState === WebSocket.CONNECTING
          ) {
            upstream.close();
          }
        } catch {
          /* ignore */
        }
      }
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
  // Re-use the module-level upgrader (Fix 3) — `noServer: true` means it doesn't
  // bind a socket; only `handleUpgrade()` is used per request.
  viewerWss.handleUpgrade(req, socket, head, (viewer: WebSocket) => {
    const token = url.searchParams.get("token") ?? "";
    const record = ctx.store.resolveViewerToken(token);
    if (!record || record.sessionId !== match.sessionId) {
      viewer.close(4403, "invalid_token");
      return;
    }
    ctx.store.touch(match.sessionId);
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
      } catch (e) {
        console.warn("[atrium] viewer close", e);
      }
      try {
        upstream.close();
      } catch (e) {
        console.warn("[atrium] upstream close", e);
      }
    };
    upstream.on("open", () => {
      viewer.on("message", (data, isBinary) => {
        if (upstream.readyState !== WebSocket.OPEN) return;
        // Filter viewer-driven `navigate` against the URL allowlist before forwarding.
        // Binary messages are screencast frames going the other direction; pass through.
        if (!isBinary) {
          try {
            const parsed: unknown = JSON.parse(data.toString());
            if (!viewerMessageAllowed(parsed, ctx.config.policies.urlAllowlist)) {
              if (viewer.readyState === WebSocket.OPEN) {
                viewer.send(
                  JSON.stringify({ t: "error", code: "url_not_allowed", message: "URL blocked" }),
                );
              }
              return;
            }
          } catch {
            // Non-JSON text — let it through; the worker's parser will reject it cleanly.
          }
        }
        upstream.send(data, { binary: Boolean(isBinary) });
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
