#!/usr/bin/env node
import { startWorkerServer } from "./index.js";

const port = Number(process.env.ATRIUM_WORKER_PORT ?? "7070");
const sharedSecret = process.env.ATRIUM_WORKER_SECRET ?? "dev-secret-change-me";
const dryRun = process.env.ATRIUM_WORKER_DRY === "1";
/** Headed by default; set `ATRIUM_WORKER_HEADLESS=1` for headless (no X11 / Xvfb). */
const headless = process.env.ATRIUM_WORKER_HEADLESS === "1";

const enableXDemoCompose =
  process.env.ATRIUM_X_DEMO_COMPOSE === "1" || process.env.ATRIUM_X_DEMO_COMPOSE === "true";

// Default transport idle to 3 minutes so a viewer WebSocket drop (tab close,
// network blip) doesn't leave Chromium running indefinitely.  The explicit
// DELETE from the demo client is the primary cleanup path; this is the fallback.
const transportIdleMs = process.env.ATRIUM_TRANSPORT_IDLE_MS
  ? Number(process.env.ATRIUM_TRANSPORT_IDLE_MS)
  : 3 * 60_000;

const server = await startWorkerServer({
  port,
  sharedSecret,
  dryRun,
  headless,
  enableXDemoCompose,
  transportIdleMs,
});
console.log(
  `[atrium-worker] listening on ${port} dryRun=${dryRun} headless=${headless} xDemoCompose=${enableXDemoCompose}`,
);

function shutdown(): void {
  void server.close().then(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
