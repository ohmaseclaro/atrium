import type { ControlHolder } from "@atriumjs/protocol";
import { sessionBootstrapBodySchema, sessionSnapshotApplyBodySchema } from "@atriumjs/protocol";
import type { AtriumHttpInput } from "./http-input.js";
import type { MemorySessionStore } from "./memory-session-store.js";
import type {
  CreateAtriumConfig,
  AtriumPolicies,
  Principal,
  SessionRecord,
  TransportOffer,
} from "./types.js";
import { urlAllowed } from "./url-allowlist.js";
import { workerInternalFetch } from "./worker-client.js";

export type DispatchCtx = {
  input: AtriumHttpInput;
  store: MemorySessionStore;
  config: CreateAtriumConfig;
  policies: AtriumPolicies;
  workerDialBase: string;
  workerSharedSecret: string;
  workerTls?: { rejectUnauthorized?: boolean };
  mount: string;
  /** Fallback request origin when `config.publicBaseUrl` is unset (local dev). */
  origin: string;
  transports: Array<"ws" | "sse" | "poll">;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function text(status: number, body = ""): Response {
  // Node's fetch rejects 204/304 with a string body (even "") — body must be null.
  if (status === 204 || status === 304) {
    return new Response(null, { status });
  }
  return new Response(body, { status });
}

function requestOriginFallback(ctx: DispatchCtx): string {
  const o = ctx.origin;
  return o.startsWith("http://") || o.startsWith("https://") ? o : `http://${o}`;
}

/** Host + scheme for viewer URLs; prefers `config.publicBaseUrl` over request `Host` (anti-forgery). */
function viewerPublicOrigin(ctx: DispatchCtx): URL {
  const configured = ctx.config.publicBaseUrl?.trim();
  if (configured) {
    try {
      return new URL(configured);
    } catch {
      /* fall through */
    }
  }
  return new URL(requestOriginFallback(ctx));
}

function buildTransports(
  ctx: DispatchCtx,
  sessionId: string,
  hostHeader: string,
  proto: "http" | "https",
): TransportOffer[] {
  const base = `${proto}://${hostHeader}${ctx.mount}`;
  const wsProto = proto === "https" ? "wss" : "ws";
  // Fix 5: pick exactly ONE transport — the highest-priority entry that the host
  // has configured. The worker has a single `sink.ws`, so advertising more than
  // one would let a second viewer dial kick the first off. `policies.transports`
  // overrides the host-level `config.transports` when set.
  const ordered = ctx.policies.transports?.length ? ctx.policies.transports : ctx.transports;
  const choice = ordered[0] ?? "ws";
  if (choice === "sse") {
    return [
      {
        kind: "sse",
        framesUrl: `${base}/sessions/${sessionId}/stream/sse`,
        inputUrl: `${base}/sessions/${sessionId}/stream/input`,
      },
    ];
  }
  if (choice === "poll") {
    return [
      {
        kind: "poll",
        url: `${base}/sessions/${sessionId}/stream/poll`,
        inputUrl: `${base}/sessions/${sessionId}/stream/input`,
      },
    ];
  }
  return [
    {
      kind: "ws",
      url: `${wsProto}://${hostHeader}${ctx.mount}/sessions/${sessionId}/stream`,
    },
  ];
}

/** Require authenticated principal and that they own this session (tenant + user). */
async function authorizeOwnedSession(
  ctx: DispatchCtx,
  sessionId: string,
): Promise<{ principal: Principal; rec: SessionRecord } | Response> {
  const principal = await ctx.config.authorize(ctx.input);
  const rec = ctx.store.getById(sessionId);
  if (!rec) return json({ error: "session_not_found" }, 404);
  if (rec.tenantId !== principal.tenantId || rec.userId !== principal.userId) {
    return json({ error: "forbidden" }, 403);
  }
  // Fix 4: per-session HTTP routes count as activity for idleTtl tracking.
  ctx.store.touch(sessionId);
  return { principal, rec };
}

export async function dispatchAtrium(ctx: DispatchCtx): Promise<Response> {
  const { input, store, config } = ctx;
  const p = input.path;

  if (input.method === "GET" && p === "/healthz") {
    return json({ ok: true });
  }
  if (input.method === "GET" && p === "/readyz") {
    return json({ ok: true, workerDialBase: ctx.workerDialBase });
  }

  if (input.method === "POST" && p === "/sessions") {
    const principal = await config.authorize(input);

    // Fix 4: enforce maxConcurrentSessionsPerTenant before allocating anything.
    const max = ctx.policies.maxConcurrentSessionsPerTenant;
    if (Number.isFinite(max) && max > 0) {
      const current = store.countByTenant(principal.tenantId);
      if (current >= max) {
        return json({ code: "max_concurrent", current, max }, 429);
      }
    }

    const body = await input.jsonBody();
    const parsed = sessionBootstrapBodySchema.safeParse(body ?? {});
    if (!parsed.success) {
      return json({ error: "invalid_session_body", detail: parsed.error.flatten() }, 400);
    }
    const b = parsed.data;
    const hasStorageState = b.storageState != null && typeof b.storageState === "object";
    // Only call worker bootstrap when the client sent explicit bootstrap fields.
    // Policy `defaultViewport` is merged into the payload when we bootstrap, but must
    // not alone force bootstrap — otherwise POST {} always hits the worker (503 in tests / dev).
    const effectiveViewport = b.viewport ?? ctx.policies.defaultViewport;
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
      if (effectiveViewport !== undefined) payload.viewport = effectiveViewport;
      if (b.clientCertificates !== undefined) payload.clientCertificates = b.clientCertificates;

      const r = await workerInternalFetch(
        ctx.workerDialBase,
        ctx.workerSharedSecret,
        `/internal/session/${encodeURIComponent(record.sessionId)}/bootstrap`,
        { method: "POST", body: payload },
      );
      if (!r.ok) {
        store.delete(record.sessionId);
        const detail = await r.text();
        return json(
          { error: "worker_bootstrap_failed", detail: detail.slice(0, 2000) },
          r.status === 400 ? 400 : r.status === 503 ? 503 : 502,
        );
      }
    }

    const pub = viewerPublicOrigin(ctx);
    const proto = pub.protocol === "https:" ? "https" : "http";
    const hostHeader = pub.host;
    const wsProto = proto === "https" ? "wss" : "ws";
    const wsUrl = `${wsProto}://${hostHeader}${ctx.mount}/sessions/${record.sessionId}/stream`;
    const transports = buildTransports(ctx, record.sessionId, hostHeader, proto);

    await config.hooks?.onSessionCreated?.({
      sessionId: record.sessionId,
      tenantId: record.tenantId,
      userId: record.userId,
    });

    return json(
      {
        sessionId: record.sessionId,
        viewerToken: record.viewerToken,
        wsUrl,
        transports,
        expiresAt: record.viewerTokenExpiresAt,
        status: record.status,
        control: record.control,
      },
      201,
    );
  }

  const mGetSession = /^\/sessions\/([^/]+)$/.exec(p);
  if (input.method === "GET" && mGetSession) {
    const id = decodeURIComponent(mGetSession[1]);
    const auth = await authorizeOwnedSession(ctx, id);
    if (auth instanceof Response) return auth;
    const { rec } = auth;
    return json({
      sessionId: rec.sessionId,
      createdAt: rec.createdAt,
      status: rec.status,
      control: rec.control,
      currentUrl: rec.currentUrl,
    });
  }

  const mDelSession = /^\/sessions\/([^/]+)$/.exec(p);
  if (input.method === "DELETE" && mDelSession) {
    const id = decodeURIComponent(mDelSession[1]);
    const auth = await authorizeOwnedSession(ctx, id);
    if (auth instanceof Response) return auth;
    const { rec } = auth;
    store.delete(rec.sessionId);
    void workerInternalFetch(
      ctx.workerDialBase,
      ctx.workerSharedSecret,
      `/internal/session/${encodeURIComponent(rec.sessionId)}/pending-bootstrap`,
      { method: "DELETE" },
    ).catch(() => undefined);
    await config.hooks?.onSessionTerminated?.({ sessionId: rec.sessionId, reason: "destroyed" });
    return text(204);
  }

  const mControl = /^\/sessions\/([^/]+)\/control$/.exec(p);
  if (input.method === "POST" && mControl) {
    const id = decodeURIComponent(mControl[1]);
    const auth = await authorizeOwnedSession(ctx, id);
    if (auth instanceof Response) return auth;
    const { rec } = auth;
    const body = (await input.jsonBody()) as { action?: string; to?: ControlHolder };
    if (body?.action !== "grant" && body?.action !== "release") {
      return json({ error: "invalid_action" }, 400);
    }
    const next: ControlHolder =
      body.action === "release" ? "agent" : body.to === "human" ? "human" : "agent";
    store.updateControl(rec.sessionId, next);
    void workerInternalFetch(
      ctx.workerDialBase,
      ctx.workerSharedSecret,
      `/internal/session/${encodeURIComponent(rec.sessionId)}/control`,
      { method: "POST", body: { holder: next } },
    ).catch(() => undefined);
    await config.hooks?.onControlChange?.({ sessionId: rec.sessionId, holder: next });
    return json({ control: store.getById(rec.sessionId)?.control });
  }

  const mXt = /^\/sessions\/([^/]+)\/x-demo\/compose-tweet$/.exec(p);
  if (ctx.config.enableDemoComposeRoutes === true && input.method === "POST" && mXt) {
    const id = decodeURIComponent(mXt[1]);
    const auth = await authorizeOwnedSession(ctx, id);
    if (auth instanceof Response) return auth;
    const body = (await input.jsonBody()) as { text?: string };
    const textBody = body?.text;
    if (typeof textBody !== "string" || !textBody.trim()) {
      return json({ error: "missing_text" }, 400);
    }
    const trimmed = textBody.trim();
    if (trimmed.length > 280) return json({ error: "text_too_long" }, 400);
    const r = await workerInternalFetch(
      ctx.workerDialBase,
      ctx.workerSharedSecret,
      `/internal/session/${encodeURIComponent(auth.rec.sessionId)}/x-demo/compose-tweet`,
      { method: "POST", body: { text: trimmed } },
    );
    if (!r.ok) {
      const detail = await r.text();
      return json(
        { error: "worker_x_compose_failed", detail: detail.slice(0, 2000) },
        r.status === 404
          ? 404
          : r.status === 409
            ? 409
            : r.status === 400
              ? 400
              : r.status === 501
                ? 501
                : 502,
      );
    }
    return text(204);
  }

  const mNav = /^\/sessions\/([^/]+)\/navigate$/.exec(p);
  if (input.method === "POST" && mNav) {
    const id = decodeURIComponent(mNav[1]);
    const auth = await authorizeOwnedSession(ctx, id);
    if (auth instanceof Response) return auth;
    const { rec } = auth;
    const body = (await input.jsonBody()) as { url?: string };
    const url = body?.url;
    if (!url || typeof url !== "string") return json({ error: "missing_url" }, 400);
    if (!urlAllowed(url, ctx.policies.urlAllowlist)) {
      return json({ error: "url_not_allowed" }, 400);
    }
    const r = await workerInternalFetch(
      ctx.workerDialBase,
      ctx.workerSharedSecret,
      `/internal/session/${encodeURIComponent(id)}/navigate`,
      { method: "POST", body: { url } },
    );
    if (!r.ok) {
      const t = await r.text();
      return json({ error: "worker_navigate_failed", detail: t }, 502);
    }
    store.setCurrentUrl(rec.sessionId, url);
    return text(204);
  }

  const mCook = /^\/sessions\/([^/]+)\/cookies$/.exec(p);
  if (input.method === "GET" && mCook) {
    const id = decodeURIComponent(mCook[1]);
    const auth = await authorizeOwnedSession(ctx, id);
    if (auth instanceof Response) return auth;
    const r = await workerInternalFetch(
      ctx.workerDialBase,
      ctx.workerSharedSecret,
      `/internal/session/${encodeURIComponent(id)}/cookies`,
    );
    if (!r.ok) {
      return json({ error: "worker_cookies_failed" }, r.status === 404 ? 404 : 502);
    }
    return json(await r.json());
  }

  const mStore = /^\/sessions\/([^/]+)\/storage-state$/.exec(p);
  if (input.method === "GET" && mStore) {
    const id = decodeURIComponent(mStore[1]);
    const auth = await authorizeOwnedSession(ctx, id);
    if (auth instanceof Response) return auth;
    const r = await workerInternalFetch(
      ctx.workerDialBase,
      ctx.workerSharedSecret,
      `/internal/session/${encodeURIComponent(id)}/storage-state`,
    );
    if (!r.ok) {
      return json({ error: "worker_storage_failed" }, r.status === 404 ? 404 : 502);
    }
    return json(await r.json());
  }

  const mSnapGet = /^\/sessions\/([^/]+)\/session-snapshot$/.exec(p);
  if (input.method === "GET" && mSnapGet) {
    const id = decodeURIComponent(mSnapGet[1]);
    const auth = await authorizeOwnedSession(ctx, id);
    if (auth instanceof Response) return auth;
    const base = `/internal/session/${encodeURIComponent(id)}`;
    const [rc, rs] = await Promise.all([
      workerInternalFetch(ctx.workerDialBase, ctx.workerSharedSecret, `${base}/cookies`),
      workerInternalFetch(ctx.workerDialBase, ctx.workerSharedSecret, `${base}/storage-state`),
    ]);
    if (!rc.ok || !rs.ok) {
      const code = rc.status === 404 || rs.status === 404 ? 404 : 502;
      return json({ error: "worker_snapshot_failed" }, code);
    }
    return json({ cookies: await rc.json(), storageState: await rs.json() });
  }

  const mSnapPost = /^\/sessions\/([^/]+)\/session-snapshot$/.exec(p);
  if (input.method === "POST" && mSnapPost) {
    const id = decodeURIComponent(mSnapPost[1]);
    const auth = await authorizeOwnedSession(ctx, id);
    if (auth instanceof Response) return auth;
    const body = await input.jsonBody();
    const parsed = sessionSnapshotApplyBodySchema.safeParse(body ?? {});
    if (!parsed.success) {
      return json({ error: "invalid_snapshot_body", detail: parsed.error.flatten() }, 400);
    }
    const r = await workerInternalFetch(
      ctx.workerDialBase,
      ctx.workerSharedSecret,
      `/internal/session/${encodeURIComponent(id)}/apply-session`,
      { method: "POST", body: parsed.data },
    );
    if (!r.ok) {
      const t = await r.text();
      return json(
        { error: "worker_apply_failed", detail: t.slice(0, 2000) },
        r.status === 404 ? 404 : r.status === 400 ? 400 : 502,
      );
    }
    return text(204);
  }

  return json({ error: "not_found", path: p }, 404);
}
