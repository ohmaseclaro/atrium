# @atrium/example-express-host

Minimal **Express** server that mounts **`@atrium/server`** only (no bundled React UI). Defaults match the root [`README.md`](../../README.md).

**Read next:** [npm quick start](../../docs/quick-start.md) · [User guide — Embed the API](../../docs/user-guide.md#3-embed-the-api-atriumserver) · [Documentation hub](../../docs/README.md)

## When to use this

- You already have a frontend (or server-driven UI) and only need the **REST + WebSocket upgrade** surface.
- You want the smallest runnable host to **`curl`** against while a worker runs separately.

For the **full interactive demo** (Vite + React + optional browser chrome + multi-tab), use [`@atrium/demo`](../../packages/demo/README.md) instead:

```bash
pnpm demo
```

## Prerequisites

- **Worker** listening on `ATRIUM_WORKER_DIAL_BASE` with matching `ATRIUM_WORKER_SECRET`.

## Run this example

```bash
# Terminal A — worker
export ATRIUM_WORKER_SECRET=dev-secret-change-me
pnpm --filter @atrium/worker start

# Terminal B — API host
export ATRIUM_WORKER_SECRET=dev-secret-change-me
export ATRIUM_WORKER_DIAL_BASE=ws://127.0.0.1:7070
pnpm --filter @atrium/example-express-host dev
```

Then:

```bash
curl -sS -X POST http://localhost:3000/atrium/sessions \
  -H "Content-Type: application/json" \
  -d '{}' | jq .
```

Use the returned **`wsUrl`** and **`viewerToken`** with any WebSocket client or embed [`@atrium/react`](../../packages/react/README.md).

## WebSocket upgrade

This example wires **`server.on("upgrade", …)`** → **`handleViewerUpgrade`** so viewer streams on `/atrium/sessions/:id/stream` work. Copy this pattern into your own `createServer` setup.

## Lint

From the repo root: `pnpm lint` (includes this package via workspace).
