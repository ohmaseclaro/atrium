import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemorySessionStore, type MemorySessionStoreOptions } from "./memory-session-store.js";
import { dispatchAtrium } from "./dispatch.js";
import type { AtriumHttpInput } from "./http-input.js";
import type { AtriumPolicies, CreateAtriumConfig } from "./types.js";

const basePolicies: AtriumPolicies = {
  sessionTtlMs: 60_000,
  idleTtlMs: 60_000,
  maxConcurrentSessionsPerTenant: 5,
  urlAllowlist: ["*"],
  defaultViewport: { w: 1280, h: 800 },
};

function input(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): AtriumHttpInput {
  const h = new Headers(headers);
  return {
    method,
    path,
    query: new URLSearchParams(),
    headers: h,
    jsonBody: async () => body,
  };
}

function makeCtx(
  inp: AtriumHttpInput,
  store: MemorySessionStore,
  config: CreateAtriumConfig,
  transports: Array<"ws" | "sse" | "poll"> = ["ws"],
) {
  return {
    input: inp,
    store,
    config,
    policies: config.policies,
    workerDialBase: config.worker.dialBase,
    workerSharedSecret: config.worker.sharedSecret,
    mount: "/atrium",
    origin: "http://localhost",
    transports,
  };
}

describe("dispatchAtrium", () => {
  let stores: MemorySessionStore[];
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stores = [];
    // Bootstrap forwarding always succeeds in tests — we don't have a real worker.
    fetchSpy = vi.fn(
      async () =>
        new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    for (const s of stores) s.dispose();
    vi.unstubAllGlobals();
  });

  function newStore(opts?: MemorySessionStoreOptions) {
    const s = new MemorySessionStore({ janitorIntervalMs: 0, ...opts });
    stores.push(s);
    return s;
  }

  it("uses publicBaseUrl for wsUrl instead of Host header", async () => {
    const store = newStore();
    const config: CreateAtriumConfig = {
      authorize: async () => ({ tenantId: "t", userId: "u" }),
      policies: basePolicies,
      worker: { dialBase: "ws://127.0.0.1:9", sharedSecret: "s" },
      publicBaseUrl: "https://trusted.example",
    };
    const res = await dispatchAtrium(
      makeCtx(input("POST", "/sessions", {}, { host: "evil.example" }), store, config),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { wsUrl: string };
    expect(body.wsUrl).toContain("trusted.example");
    expect(body.wsUrl).not.toContain("evil.example");
  });

  it("returns 403 when GET session owner does not match", async () => {
    const store = newStore();
    let user = "alice";
    const config: CreateAtriumConfig = {
      authorize: async () => ({ tenantId: "t", userId: user }),
      policies: basePolicies,
      worker: { dialBase: "ws://127.0.0.1:9", sharedSecret: "s" },
    };
    const post = await dispatchAtrium(makeCtx(input("POST", "/sessions", {}), store, config));
    expect(post.status).toBe(201);
    const sid = ((await post.json()) as { sessionId: string }).sessionId;
    user = "bob";
    const get = await dispatchAtrium(makeCtx(input("GET", `/sessions/${sid}`), store, config));
    expect(get.status).toBe(403);
  });

  it("does not expose x-demo route when disabled", async () => {
    const store = newStore();
    const config: CreateAtriumConfig = {
      authorize: async () => ({ tenantId: "t", userId: "u" }),
      policies: basePolicies,
      worker: { dialBase: "ws://127.0.0.1:9", sharedSecret: "s" },
      enableDemoComposeRoutes: false,
    };
    const post = await dispatchAtrium(makeCtx(input("POST", "/sessions", {}), store, config));
    const sid = ((await post.json()) as { sessionId: string }).sessionId;
    const xt = await dispatchAtrium(
      makeCtx(input("POST", `/sessions/${sid}/x-demo/compose-tweet`, { text: "x" }), store, config),
    );
    expect(xt.status).toBe(404);
  });

  // ----- Fix 5: single-transport advertisement -----

  it("advertises only ws by default", async () => {
    const store = newStore();
    const config: CreateAtriumConfig = {
      authorize: async () => ({ tenantId: "t", userId: "u" }),
      policies: basePolicies,
      worker: { dialBase: "ws://127.0.0.1:9", sharedSecret: "s" },
    };
    const res = await dispatchAtrium(
      makeCtx(input("POST", "/sessions", {}), store, config, ["ws"]),
    );
    const body = (await res.json()) as { transports: Array<{ kind: string }> };
    expect(body.transports).toHaveLength(1);
    expect(body.transports[0].kind).toBe("ws");
  });

  it("advertises only sse when policies.transports = ['sse']", async () => {
    const store = newStore();
    const config: CreateAtriumConfig = {
      authorize: async () => ({ tenantId: "t", userId: "u" }),
      policies: { ...basePolicies, transports: ["sse"] },
      worker: { dialBase: "ws://127.0.0.1:9", sharedSecret: "s" },
    };
    const res = await dispatchAtrium(
      makeCtx(input("POST", "/sessions", {}), store, config, ["ws", "sse", "poll"]),
    );
    const body = (await res.json()) as {
      transports: Array<{ kind: string; framesUrl?: string; inputUrl?: string }>;
    };
    expect(body.transports).toHaveLength(1);
    expect(body.transports[0].kind).toBe("sse");
    expect(body.transports[0].framesUrl).toContain("/stream/sse");
    expect(body.transports[0].inputUrl).toContain("/stream/input");
  });

  // ----- Fix 4: maxConcurrentSessionsPerTenant -----

  it("returns 429 with code:max_concurrent when tenant cap reached", async () => {
    const store = newStore();
    const config: CreateAtriumConfig = {
      authorize: async () => ({ tenantId: "t", userId: "u" }),
      policies: { ...basePolicies, maxConcurrentSessionsPerTenant: 2 },
      worker: { dialBase: "ws://127.0.0.1:9", sharedSecret: "s" },
    };
    for (let i = 0; i < 2; i += 1) {
      const r = await dispatchAtrium(makeCtx(input("POST", "/sessions", {}), store, config));
      expect(r.status).toBe(201);
    }
    const denied = await dispatchAtrium(makeCtx(input("POST", "/sessions", {}), store, config));
    expect(denied.status).toBe(429);
    const body = (await denied.json()) as { code: string; current: number; max: number };
    expect(body.code).toBe("max_concurrent");
    expect(body.current).toBe(2);
    expect(body.max).toBe(2);
  });

  // ----- Fix 4: defaultViewport -----

  it("forwards policies.defaultViewport in bootstrap when client sends initialUrl but no viewport", async () => {
    const store = newStore();
    const config: CreateAtriumConfig = {
      authorize: async () => ({ tenantId: "t", userId: "u" }),
      policies: { ...basePolicies, defaultViewport: { w: 1366, h: 768 } },
      worker: { dialBase: "ws://127.0.0.1:9", sharedSecret: "s" },
    };
    const res = await dispatchAtrium(
      makeCtx(
        input("POST", "/sessions", { initialUrl: "https://example.com/start" }),
        store,
        config,
      ),
    );
    expect(res.status).toBe(201);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      viewport?: { w: number; h: number };
      initialUrl?: string;
    };
    expect(body.viewport).toEqual({ w: 1366, h: 768 });
    expect(body.initialUrl).toBe("https://example.com/start");
  });

  it("does not call worker bootstrap on POST /sessions with empty body", async () => {
    const store = newStore();
    const config: CreateAtriumConfig = {
      authorize: async () => ({ tenantId: "t", userId: "u" }),
      policies: basePolicies,
      worker: { dialBase: "ws://127.0.0.1:9", sharedSecret: "s" },
    };
    const res = await dispatchAtrium(makeCtx(input("POST", "/sessions", {}), store, config));
    expect(res.status).toBe(201);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("explicit viewport in body takes priority over defaultViewport", async () => {
    const store = newStore();
    const config: CreateAtriumConfig = {
      authorize: async () => ({ tenantId: "t", userId: "u" }),
      policies: { ...basePolicies, defaultViewport: { w: 1366, h: 768 } },
      worker: { dialBase: "ws://127.0.0.1:9", sharedSecret: "s" },
    };
    await dispatchAtrium(
      makeCtx(input("POST", "/sessions", { viewport: { w: 800, h: 600 } }), store, config),
    );
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { viewport?: { w: number; h: number } };
    expect(body.viewport).toEqual({ w: 800, h: 600 });
  });
});
