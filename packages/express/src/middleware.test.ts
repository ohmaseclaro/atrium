import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import express, { type Request } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { atrium, viewerStreamMatch } from "./middleware.js";

describe("viewerStreamMatch", () => {
  it("extracts session id from stream path", () => {
    expect(viewerStreamMatch("/atrium", "/atrium/sessions/abc123/stream")).toEqual({
      sessionId: "abc123",
    });
  });

  it("returns undefined for unrelated paths", () => {
    expect(viewerStreamMatch("/atrium", "/atrium/sessions/abc/stream/extra")).toBeUndefined();
    expect(viewerStreamMatch("/atrium", "/other/sessions/abc/stream")).toBeUndefined();
  });
});

describe("atrium HTTP routes", () => {
  it("creates and fetches sessions", async () => {
    const app = express();
    const { router } = atrium({
      authorize: async (_req: Request) => ({ tenantId: "t", userId: "u" }),
      policies: {
        sessionTtlMs: 60_000,
        idleTtlMs: 60_000,
        maxConcurrentSessionsPerTenant: 5,
        urlAllowlist: ["*"],
        defaultViewport: { w: 1280, h: 800 },
      },
      workerDialBase: "ws://127.0.0.1:9",
      workerSharedSecret: "secret",
      mountPath: "/atrium",
    });
    app.use("/atrium", router);

    const created = await request(app).post("/atrium/sessions").send({}).expect(201);
    expect(created.body.sessionId).toBeTruthy();
    expect(created.body.viewerToken).toBeTruthy();
    expect(created.body.status).toBe("ready");
    expect(created.body.control.holder).toBe("agent");
    expect(created.body.wsUrl).toContain("/atrium/sessions/");
    expect(created.body.wsUrl).toContain("/stream");
    expect(Array.isArray(created.body.transports)).toBe(true);

    await request(app)
      .get(`/atrium/sessions/${created.body.sessionId}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.sessionId).toBe(created.body.sessionId);
        expect(res.body.tenantId).toBeUndefined();
        expect(res.body.userId).toBeUndefined();
      });
  });

  it("uses publicBaseUrl for session URLs instead of Host", async () => {
    const app = express();
    const { router } = atrium({
      authorize: async () => ({ tenantId: "t", userId: "u" }),
      policies: {
        sessionTtlMs: 60_000,
        idleTtlMs: 60_000,
        maxConcurrentSessionsPerTenant: 5,
        urlAllowlist: ["*"],
        defaultViewport: { w: 1280, h: 800 },
      },
      workerDialBase: "ws://127.0.0.1:9",
      workerSharedSecret: "secret",
      mountPath: "/atrium",
      publicBaseUrl: "https://trusted.example",
    });
    app.use("/atrium", router);

    const created = await request(app)
      .post("/atrium/sessions")
      .set("Host", "evil.example")
      .send({})
      .expect(201);
    expect(created.body.wsUrl).toContain("trusted.example");
    expect(created.body.wsUrl).not.toContain("evil.example");
  });

  it("GET session returns 403 for a different user (same tenant)", async () => {
    const app = express();
    const { router } = atrium({
      authorize: async (req) => {
        const u = (req as Request).get("x-test-user");
        return { tenantId: "t", userId: u === "b" ? "intruder" : "owner" };
      },
      policies: {
        sessionTtlMs: 60_000,
        idleTtlMs: 60_000,
        maxConcurrentSessionsPerTenant: 5,
        urlAllowlist: ["*"],
        defaultViewport: { w: 1280, h: 800 },
      },
      workerDialBase: "ws://127.0.0.1:9",
      workerSharedSecret: "secret",
      mountPath: "/atrium",
    });
    app.use("/atrium", router);

    const created = await request(app)
      .post("/atrium/sessions")
      .set("x-test-user", "a")
      .send({})
      .expect(201);
    await request(app)
      .get(`/atrium/sessions/${created.body.sessionId}`)
      .set("x-test-user", "b")
      .expect(403);
  });

  it("returns health and ready payloads", async () => {
    const app = express();
    const { router } = atrium({
      authorize: async () => ({ tenantId: "t", userId: "u" }),
      policies: {
        sessionTtlMs: 60_000,
        idleTtlMs: 60_000,
        maxConcurrentSessionsPerTenant: 5,
        urlAllowlist: ["*"],
        defaultViewport: { w: 1280, h: 800 },
      },
      workerDialBase: "ws://example.invalid",
      workerSharedSecret: "s",
      mountPath: "/atrium",
    });
    app.use("/atrium", router);

    await request(app).get("/atrium/healthz").expect(200).expect({ ok: true });
    await request(app)
      .get("/atrium/readyz")
      .expect(200)
      .expect((res) => {
        expect(res.body.ok).toBe(true);
        expect(res.body.workerDialBase).toBe("ws://example.invalid");
      });
  });
});

describe("atrium control and navigate", () => {
  it("updates control state", async () => {
    const app = express();
    const { router } = atrium({
      authorize: async () => ({ tenantId: "t", userId: "u" }),
      policies: {
        sessionTtlMs: 60_000,
        idleTtlMs: 60_000,
        maxConcurrentSessionsPerTenant: 5,
        urlAllowlist: ["*"],
        defaultViewport: { w: 1280, h: 800 },
      },
      workerDialBase: "ws://127.0.0.1:9",
      workerSharedSecret: "secret",
      mountPath: "/atrium",
    });
    app.use("/atrium", router);
    const created = await request(app).post("/atrium/sessions").send({}).expect(201);
    await request(app)
      .post(`/atrium/sessions/${created.body.sessionId}/control`)
      .send({ action: "grant", to: "human" })
      .expect(200);
    const info = await request(app).get(`/atrium/sessions/${created.body.sessionId}`).expect(200);
    expect(info.body.control.holder).toBe("human");
  });

  it("rejects navigate when URL not allowlisted", async () => {
    const app = express();
    const { router } = atrium({
      authorize: async () => ({ tenantId: "t", userId: "u" }),
      policies: {
        sessionTtlMs: 60_000,
        idleTtlMs: 60_000,
        maxConcurrentSessionsPerTenant: 5,
        urlAllowlist: ["https://example.com/*"],
        defaultViewport: { w: 1280, h: 800 },
      },
      workerDialBase: "ws://127.0.0.1:9",
      workerSharedSecret: "secret",
      mountPath: "/atrium",
    });
    app.use("/atrium", router);
    const created = await request(app).post("/atrium/sessions").send({}).expect(201);
    await request(app)
      .post(`/atrium/sessions/${created.body.sessionId}/navigate`)
      .send({ url: "https://evil.test/" })
      .expect(400);
  });
});

describe("atrium DELETE", () => {
  it("requires authorize and removes the session", async () => {
    const app = express();
    const { router } = atrium({
      authorize: async () => ({ tenantId: "t", userId: "u" }),
      policies: {
        sessionTtlMs: 60_000,
        idleTtlMs: 60_000,
        maxConcurrentSessionsPerTenant: 5,
        urlAllowlist: ["*"],
        defaultViewport: { w: 1280, h: 800 },
      },
      workerDialBase: "ws://127.0.0.1:9",
      workerSharedSecret: "secret",
      mountPath: "/atrium",
    });
    app.use("/atrium", router);

    const created = await request(app).post("/atrium/sessions").send({}).expect(201);
    await request(app).delete(`/atrium/sessions/${created.body.sessionId}`).expect(204);
    await request(app).get(`/atrium/sessions/${created.body.sessionId}`).expect(404);
  });
});

describe("atrium upgrade relay (integration)", () => {
  it("pipes viewer websocket to mock worker", async () => {
    const secret = "relay-test-secret";

    const workerHttp = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    const wss = new WebSocketServer({ noServer: true });
    workerHttp.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const m = /^\/internal\/stream\/([^/]+)$/.exec(url.pathname);
      const auth = req.headers.authorization;
      if (!m || auth !== `Bearer ${secret}`) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      const sessionId = m[1];
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.send(
          JSON.stringify({
            t: "hello",
            sessionId,
            control: { holder: "agent", since: Date.now() },
            viewport: { w: 1280, h: 800 },
          }),
        );
        ws.on("message", (buf) => {
          const j = JSON.parse(buf.toString()) as { t?: string };
          if (j.t === "ping") {
            ws.send(JSON.stringify({ t: "control", holder: "agent", reason: "pong" }));
          }
        });
      });
    });

    await new Promise<void>((resolve, reject) => {
      workerHttp.once("error", reject);
      workerHttp.listen(0, () => resolve());
    });
    const workerPort = (workerHttp.address() as { port: number }).port;

    const expressApp = express();
    const { router, handleViewerUpgrade } = atrium({
      authorize: async () => ({ tenantId: "t", userId: "u" }),
      policies: {
        sessionTtlMs: 60_000,
        idleTtlMs: 60_000,
        maxConcurrentSessionsPerTenant: 5,
        urlAllowlist: ["*"],
        defaultViewport: { w: 1280, h: 800 },
      },
      workerDialBase: `ws://127.0.0.1:${workerPort}`,
      workerSharedSecret: secret,
      mountPath: "/atrium",
    });
    expressApp.use("/atrium", router);

    const httpServer = createServer(expressApp);
    httpServer.on("upgrade", (req, socket, head) => {
      if (!req.url?.startsWith("/atrium/sessions/")) return;
      handleViewerUpgrade(req, socket, head);
    });

    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(0, () => resolve());
    });
    const apiPort = (httpServer.address() as { port: number }).port;

    const createdRes = await fetch(`http://127.0.0.1:${apiPort}/atrium/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(createdRes.status).toBe(201);
    const created = (await createdRes.json()) as { sessionId: string; viewerToken: string };

    const messages: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const viewerUrl = `ws://127.0.0.1:${apiPort}/atrium/sessions/${created.sessionId}/stream?token=${encodeURIComponent(created.viewerToken)}`;
      const v = new WebSocket(viewerUrl);
      v.on("message", (data) => {
        messages.push(data.toString());
        if (messages.length === 1) {
          v.send(JSON.stringify({ t: "ping" }));
        }
        if (messages.length >= 2) {
          v.close();
        }
      });
      v.on("close", () => resolve());
      v.on("error", reject);
      setTimeout(() => reject(new Error("viewer_ws_timeout")), 10_000).unref?.();
    });

    expect(messages[0]).toContain('"t":"hello"');
    expect(messages.some((m) => m.includes('"t":"control"'))).toBe(true);

    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
    await new Promise<void>((resolve, reject) => {
      workerHttp.close((err) => (err ? reject(err) : resolve()));
    });
    await new Promise<void>((resolve, reject) => {
      wss.close((err) => (err ? reject(err) : resolve()));
    });
  });
});

async function readReqBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const ch of req) {
    chunks.push(ch as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function startMockWorkerHttp(
  handler: (req: IncomingMessage, res: ServerResponse, pathname: string, body: string) => void,
): Promise<{ port: number; close: () => Promise<void> }> {
  const srv = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    void readReqBody(req).then((body) => {
      try {
        handler(req, res, url.pathname, body);
      } catch {
        res.writeHead(500);
        res.end();
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(0, () => resolve());
  });
  const port = (srv.address() as { port: number }).port;
  return {
    port,
    close: () =>
      new Promise((resolve, reject) => {
        srv.close((err) => (err ? reject(err) : resolve(undefined)));
      }),
  };
}

describe("atrium session snapshot and bootstrap", () => {
  it("rejects unknown POST /sessions fields", async () => {
    const app = express();
    const { router } = atrium({
      authorize: async () => ({ tenantId: "t", userId: "u" }),
      policies: {
        sessionTtlMs: 60_000,
        idleTtlMs: 60_000,
        maxConcurrentSessionsPerTenant: 5,
        urlAllowlist: ["*"],
        defaultViewport: { w: 1280, h: 800 },
      },
      workerDialBase: "ws://127.0.0.1:9",
      workerSharedSecret: "secret",
      mountPath: "/atrium",
    });
    app.use("/atrium", router);
    await request(app).post("/atrium/sessions").send({ extra: 1 }).expect(400);
  });

  it("proxies bootstrap to the worker after creating a session", async () => {
    let sawBootstrap = false;
    const mock = await startMockWorkerHttp((_req, res, pathname, body) => {
      if (pathname.endsWith("/bootstrap") && _req.method === "POST") {
        sawBootstrap = true;
        expect(JSON.parse(body || "{}")).toMatchObject({ initialUrl: "about:blank" });
        res.writeHead(204);
        res.end();
        return;
      }
      if (pathname.endsWith("/pending-bootstrap") && _req.method === "DELETE") {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const app = express();
    const { router } = atrium({
      authorize: async () => ({ tenantId: "t", userId: "u" }),
      policies: {
        sessionTtlMs: 60_000,
        idleTtlMs: 60_000,
        maxConcurrentSessionsPerTenant: 5,
        urlAllowlist: ["*"],
        defaultViewport: { w: 1280, h: 800 },
      },
      workerDialBase: `ws://127.0.0.1:${mock.port}`,
      workerSharedSecret: "secret",
      mountPath: "/atrium",
    });
    app.use("/atrium", router);

    const created = await request(app)
      .post("/atrium/sessions")
      .send({ initialUrl: "about:blank" })
      .expect(201);
    expect(sawBootstrap).toBe(true);
    expect(created.body.sessionId).toBeTruthy();

    await request(app).delete(`/atrium/sessions/${created.body.sessionId}`).expect(204);
    await mock.close();
  });

  it("GET session-snapshot merges cookies and storage-state from the worker", async () => {
    const mock = await startMockWorkerHttp((_req, res, pathname) => {
      if (pathname.endsWith("/cookies") && _req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify([{ name: "sid", value: "1", domain: ".example.com", path: "/" }]));
        return;
      }
      if (pathname.endsWith("/storage-state") && _req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ cookies: [], origins: [] }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const app = express();
    const { router } = atrium({
      authorize: async () => ({ tenantId: "t", userId: "u" }),
      policies: {
        sessionTtlMs: 60_000,
        idleTtlMs: 60_000,
        maxConcurrentSessionsPerTenant: 5,
        urlAllowlist: ["*"],
        defaultViewport: { w: 1280, h: 800 },
      },
      workerDialBase: `ws://127.0.0.1:${mock.port}`,
      workerSharedSecret: "secret",
      mountPath: "/atrium",
    });
    app.use("/atrium", router);

    const created = await request(app).post("/atrium/sessions").send({}).expect(201);
    const snap = await request(app)
      .get(`/atrium/sessions/${created.body.sessionId}/session-snapshot`)
      .expect(200);
    expect(snap.body).toEqual({
      cookies: [{ name: "sid", value: "1", domain: ".example.com", path: "/" }],
      storageState: { cookies: [], origins: [] },
    });

    await mock.close();
  });

  it("POST session-snapshot forwards apply-session to the worker", async () => {
    let applied = false;
    const mock = await startMockWorkerHttp((_req, res, pathname, body) => {
      if (pathname.endsWith("/apply-session") && _req.method === "POST") {
        applied = true;
        expect(JSON.parse(body)).toEqual({ storageState: { cookies: [], origins: [] } });
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const app = express();
    const { router } = atrium({
      authorize: async () => ({ tenantId: "t", userId: "u" }),
      policies: {
        sessionTtlMs: 60_000,
        idleTtlMs: 60_000,
        maxConcurrentSessionsPerTenant: 5,
        urlAllowlist: ["*"],
        defaultViewport: { w: 1280, h: 800 },
      },
      workerDialBase: `ws://127.0.0.1:${mock.port}`,
      workerSharedSecret: "secret",
      mountPath: "/atrium",
    });
    app.use("/atrium", router);

    const created = await request(app).post("/atrium/sessions").send({}).expect(201);
    await request(app)
      .post(`/atrium/sessions/${created.body.sessionId}/session-snapshot`)
      .send({ storageState: { cookies: [], origins: [] } })
      .expect(204);
    expect(applied).toBe(true);

    await mock.close();
  });

  it("POST x-demo compose-tweet forwards to the worker", async () => {
    let composed = false;
    const mock = await startMockWorkerHttp((_req, res, pathname, body) => {
      if (pathname.endsWith("/x-demo/compose-tweet") && _req.method === "POST") {
        composed = true;
        expect(JSON.parse(body)).toEqual({ text: "hi" });
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const app = express();
    const { router } = atrium({
      authorize: async () => ({ tenantId: "t", userId: "u" }),
      policies: {
        sessionTtlMs: 60_000,
        idleTtlMs: 60_000,
        maxConcurrentSessionsPerTenant: 5,
        urlAllowlist: ["*"],
        defaultViewport: { w: 1280, h: 800 },
      },
      workerDialBase: `ws://127.0.0.1:${mock.port}`,
      workerSharedSecret: "secret",
      mountPath: "/atrium",
      enableDemoComposeRoutes: true,
    });
    app.use("/atrium", router);

    const created = await request(app).post("/atrium/sessions").send({}).expect(201);
    await request(app)
      .post(`/atrium/sessions/${created.body.sessionId}/x-demo/compose-tweet`)
      .send({ text: "hi" })
      .expect(204);
    expect(composed).toBe(true);

    await mock.close();
  });
});
