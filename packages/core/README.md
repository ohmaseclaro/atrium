# @atriumjs/core

`@atriumjs/core` is the **framework-agnostic foundation** underneath the framework-specific Atrium adapters (`@atriumjs/express`, …): session store, Web Fetch handlers, viewer-stream transports (`ws` / `sse` / `poll`), URL allowlist, and worker-dial helpers.

**Most users should reach for an adapter** — install `@atriumjs/express` and follow its quick-start. `@atriumjs/core` is intended for **adapter authors** who want to wire Atrium into another runtime (Fastify, Hono, Cloudflare Workers, etc.).

**Docs hub:** [`docs/README.md`](../../docs/README.md) · **Architecture:** [`docs/remote-browser-design.md`](../../docs/remote-browser-design.md)

## Install

```bash
npm install @atriumjs/core
```

With pnpm: `pnpm add @atriumjs/core`.

## Usage

`createAtrium()` returns a small object exposing `handleHttpInput`, `handleRequest`, and `handleNodeViewerUpgrade`. Wire those into whichever HTTP framework you target.

```ts
import { createAtrium } from "@atriumjs/core";

const atrium = createAtrium({
  authorize: async (input) => ({ tenantId: "demo", userId: "anonymous" }),
  policies: {
    sessionTtlMs: 15 * 60_000,
    idleTtlMs: 5 * 60_000,
    maxConcurrentSessionsPerTenant: 5,
    urlAllowlist: ["*"],
    defaultViewport: { w: 1280, h: 800 },
  },
  worker: {
    dialBase: process.env.ATRIUM_WORKER_DIAL_BASE!,
    sharedSecret: process.env.ATRIUM_WORKER_SECRET!,
  },
  mountPath: "/atrium",
  // publicBaseUrl: "https://api.example.com", // recommended in production
});

// Web Fetch entry point — works in any runtime that hands you a `Request`:
export default { fetch: (req: Request) => atrium.handleRequest(req) };
```

The session store is in-memory by default (`atrium.memoryStore` exposed for tests). A typed `SessionStore` interface ships in `./session-store-types.ts` for future Redis-backed implementations.

## Subpath exports

- **`@atriumjs/core/policies`** — demo-grade policy preset and rate-limit helpers (`demoPolicies`, `demoRateLimitPreCheck`). Implements per-IP / fleet token buckets in-memory; intended for public demos, not production. Kept on a subpath so the default surface stays small.

## Build

```bash
pnpm --filter @atriumjs/core run build
```

MIT — see repository [`LICENSE`](../../LICENSE).
