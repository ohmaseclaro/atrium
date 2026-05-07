# @atriumjs/atrium-server

Express **middleware** for Atrium: **session HTTP API**, **viewer WebSocket relay** (your API **dials** the worker), in-memory session records, and replay of recent JSON control messages for reconnects.

**Docs hub:** [`docs/README.md`](../../docs/README.md) · **User guide:** [`docs/user-guide.md`](../../docs/user-guide.md)

## Install

```bash
npm install express @atriumjs/atrium-server
```

`express` is a peer dependency because Atrium mounts into your existing Express app.

With pnpm: `pnpm add express @atriumjs/atrium-server`.

Full app walkthrough: [npm quick start](../../docs/quick-start.md).

## API

```ts
import { atrium } from "@atriumjs/atrium-server";

const { router, handleViewerUpgrade } = atrium({
  redis: { url: process.env.REDIS_URL! },
  authorize: async (req) => ({ tenantId: "…", userId: "…" }),
  policies: {
    sessionTtlMs: 15 * 60_000,
    idleTtlMs: 5 * 60_000,
    maxConcurrentSessionsPerTenant: 5,
    urlAllowlist: ["*"],
    defaultViewport: { w: 1280, h: 800 },
  },
  workerDialBase: process.env.ATRIUM_WORKER_DIAL_BASE!,
  workerSharedSecret: process.env.ATRIUM_WORKER_SECRET!,
  mountPath: "/atrium", // optional
});
```

- Mount **`router`** on your app at **`mountPath`**.
- On **`server.on("upgrade", …)`**, call **`handleViewerUpgrade`** for paths under **`/sessions/*/stream`**.

Exported helpers: **`viewerStreamMatch`**, **`urlAllowed`**, **`workerHttpBaseFromDial`**, **`workerInternalFetch`**, types **`AtriumConfig`**, **`AtriumMount`**, **`SessionRecord`**, etc. See [`src/index.ts`](./src/index.ts).

## HTTP routes

Summarized in [User guide — HTTP endpoints](../../docs/user-guide.md#6-http-endpoints-mount-prefix).

## Example

[`examples/express-host`](../../examples/express-host/README.md) — minimal host with an `authorize` stub and worker dial settings.

## Build

```bash
pnpm --filter @atriumjs/atrium-server run build
```

MIT — see repository [`LICENSE`](../../LICENSE).
