import { describe, expect, it, afterEach } from "vitest";
import { WebSocket } from "ws";
import { internalPath, startWorkerServer } from "./index.js";

describe("internalPath", () => {
  it("builds worker backplane path", () => {
    expect(internalPath("sid-1")).toBe("/internal/stream/sid-1");
  });
});

describe("startWorkerServer (integration, dry)", () => {
  const instances: { close: () => Promise<void> }[] = [];

  afterEach(async () => {
    while (instances.length > 0) {
      const s = instances.pop();
      if (s) await s.close();
    }
  });

  it("returns assigned port when listening on 0", async () => {
    const srv = await startWorkerServer({
      port: 0,
      sharedSecret: "dry-secret",
      dryRun: true,
    });
    instances.push(srv);
    expect(srv.port).toBeGreaterThan(0);
  });

  it("emits hello over inbound websocket before closing", async () => {
    const secret = "ws-int-secret";
    const srv = await startWorkerServer({ port: 0, sharedSecret: secret, dryRun: true });
    instances.push(srv);

    const messages: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${srv.port}${internalPath("demo-session")}`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      ws.on("message", (data) => {
        messages.push(data.toString());
      });
      ws.on("close", () => resolve());
      ws.on("error", reject);
      setTimeout(() => reject(new Error("worker_ws_timeout")), 10_000).unref?.();
    });

    expect(messages.some((m) => m.includes('"t":"hello"'))).toBe(true);
  });
});
