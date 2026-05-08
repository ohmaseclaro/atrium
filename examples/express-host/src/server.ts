import express, { type Request } from "express";
import { createServer } from "node:http";
import { atrium } from "@atriumjs/express";

const app = express();
const workerDialBase = process.env.ATRIUM_WORKER_DIAL_BASE ?? "ws://127.0.0.1:7070";
const workerSharedSecret = process.env.ATRIUM_WORKER_SECRET ?? "dev-secret-change-me";

const { router, handleViewerUpgrade } = atrium({
  authorize: async (_req: Request) => ({ tenantId: "demo", userId: "anonymous" }),
  policies: {
    sessionTtlMs: 15 * 60_000,
    idleTtlMs: 5 * 60_000,
    maxConcurrentSessionsPerTenant: 5,
    urlAllowlist: ["*"],
    defaultViewport: { w: 1280, h: 800 },
  },
  workerDialBase,
  workerSharedSecret,
  mountPath: "/atrium",
});

app.use("/atrium", router);

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"/><title>Atrium express host</title></head>
<body>
  <h1>Atrium example host</h1>
  <p>POST <code>/atrium/sessions</code> to create a session, then open the returned <code>wsUrl</code> with the viewer token.</p>
  <pre>curl -s -X POST http://localhost:3000/atrium/sessions -H "content-type: application/json" -d "{}" | jq .</pre>
</body></html>`);
});

const port = Number(process.env.PORT ?? "3000");
const server = createServer(app);

server.on("upgrade", (req, socket, head) => {
  if (!req.url?.startsWith("/atrium/sessions/")) return;
  handleViewerUpgrade(req, socket, head);
});

server.listen(port, () => {
  console.log(`[example-host] http://localhost:${port}`);
});
