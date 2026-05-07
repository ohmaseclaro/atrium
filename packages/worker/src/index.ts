import { createServer } from "node:http";
import type { Browser, Page } from "playwright";
import { chromium } from "playwright";
import { WebSocketServer, WebSocket } from "ws";
import type { ControlState } from "@atrium/protocol";

export type WorkerServerOptions = {
  port: number;
  sharedSecret: string;
  /** Skip Playwright launch; emit a hello and immediate bye for CI or smoke tests. */
  dryRun?: boolean;
};

function parseBearer(auth: string | undefined): string | null {
  if (!auth || !auth.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length).trim() || null;
}

function internalPath(sessionId: string): string {
  return `/internal/stream/${sessionId}`;
}

/**
 * Starts an HTTP server whose WebSocket endpoint accepts **inbound** connections
 * from the API tier (`Authorization: Bearer <sharedSecret>`). Frames and input
 * use the same two-frame JSON + binary pattern described in `@atrium/protocol`.
 *
 * Browser control uses **Playwright**; JPEG screencasts use a CDP session created
 * from the Playwright page (`newCDPSession`), not a hand-rolled raw CDP client.
 */
export async function startWorkerServer(options: WorkerServerOptions): Promise<{
  close: () => Promise<void>;
}> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, role: "atrium-worker" }));
  });
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "internal" || parts[1] !== "stream" || !parts[2]) {
      socket.destroy();
      return;
    }
    const token = parseBearer(req.headers.authorization);
    if (!token || token !== options.sharedSecret) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    const sessionId = parts[2];
    wss.handleUpgrade(req, socket, head, (ws) => {
      void attachSessionPipeline(ws, sessionId, options);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, () => resolve());
  });

  return {
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        wss.close((err) => (err ? reject(err) : resolve()));
      });
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

export { internalPath };

async function attachSessionPipeline(
  ws: WebSocket,
  sessionId: string,
  options: WorkerServerOptions,
): Promise<void> {
  const now = () => Date.now();
  const sendJson = (obj: unknown): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  };

  if (options.dryRun) {
    const control: ControlState = { holder: "agent", since: now() };
    sendJson({
      t: "hello",
      sessionId,
      control,
      viewport: { w: 1280, h: 800 },
    });
    sendJson({ t: "bye", reason: "destroyed" });
    ws.close();
    return;
  }

  let browser: Browser | undefined;
  let page: Page | undefined;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--disable-dev-shm-usage", "--no-sandbox"],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await context.newPage();
    await page.goto("about:blank");

    const control: ControlState = { holder: "agent", since: now() };
    sendJson({
      t: "hello",
      sessionId,
      control,
      viewport: { w: 1280, h: 800 },
    });

    const cdp = await page.context().newCDPSession(page);
    let seq = 0;
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 70,
      maxWidth: 1280,
      maxHeight: 800,
      everyNthFrame: 1,
    });
    cdp.on("Page.screencastFrame", async (payload: { data: string; sessionId: number }) => {
      if (ws.readyState !== WebSocket.OPEN) {
        await cdp.send("Page.screencastFrameAck", { sessionId: payload.sessionId });
        return;
      }
      seq += 1;
      sendJson({
        t: "frame",
        seq,
        ts: now(),
        mime: "image/jpeg",
      });
      ws.send(Buffer.from(payload.data, "base64"));
      await cdp.send("Page.screencastFrameAck", { sessionId: payload.sessionId });
    });

    ws.on("message", async (raw) => {
      if (!page) return;
      const data = raw.toString();
      try {
        const msg = JSON.parse(data) as { t?: string };
        if (msg.t === "ping") {
          sendJson({ t: "control", holder: control.holder, reason: "pong" });
        }
      } catch {
        /* ignore non-json */
      }
    });
  } catch (err) {
    sendJson({
      t: "error",
      code: "worker_start_failed",
      message: err instanceof Error ? err.message : "unknown_error",
    });
    sendJson({ t: "bye", reason: "error" });
    ws.close();
  }

  ws.on("close", async () => {
    try {
      await page?.close();
    } catch {
      /* ignore */
    }
    try {
      await browser?.close();
    } catch {
      /* ignore */
    }
  });
}
