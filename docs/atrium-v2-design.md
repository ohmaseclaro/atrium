# Atrium v0.2 — Cleanup, framework-agnostic core, public-demo hardening

> Status: Draft
> Audience: Atrium maintainers
> Scope: **Package renames (§2) and legacy shims are implemented.** `@atriumjs/core` (Fetch dispatch, memory store, WS/SSE/poll transports) and the **Express** adapter (`atrium()` → `createAtrium`) are implemented; **not yet in this repo:** Fastify/Hono/Next/Nest adapters, `@atriumjs/client` / `@atriumjs/sdk`, `collect`/`replay`, `mountExpress`, full `demoPolicies` (Turnstile/Tor/Redis Lua), `atrium dev` / `atrium new`, worker `/internal/.../automation`. Original v0.1 layout used `@atriumjs/atrium-*` on npm; new names are `@atriumjs/*` per the table below.
> Engine architecture (dial pattern, Playwright, CDP screencast, server-authoritative control, snapshot APIs, mTLS, passkey strategy, Xvfb) is **locked** from v0.1 and not relitigated here.

---

## 1. Goals and non-goals

### Goals

1. **Drop the redundant `atrium-` prefix.** Every public package is renamed from `@atriumjs/atrium-<x>` to `@atriumjs/<x>`.
2. **Framework-agnostic core** built on the Web Fetch API, with first-class adapters for **Express, Fastify, Hono, Next.js (App Router), and NestJS**. Adapters are not afterthoughts; they ship in v0.2 with parity test suites.
3. **Automatic transport negotiation** — every adapter ships with WebSocket primary + SSE/HTTP fallback. The library detects and chooses; consumers do nothing.
4. **Typed SDK** (`@atriumjs/sdk`) for the host-app side and a typed framework-agnostic browser client (`@atriumjs/client`) underneath the React component.
5. **Higher-level helpers** — a `collect()` function that wraps the common "show a login flow, hand off, snapshot cookies" pattern in one call.
6. **Zero-config dev** via `npx atrium dev` — no env vars, no Redis, no Docker, no `pnpm build` required for the first run.
7. **Demo-grade rate limiting** — first-class `demoPolicies()` preset and a hardened public deployment recipe so we can host a live demo without it being abused.

### Non-goals

- No engine changes. The dial pattern, Playwright orchestration, CDP screencast, control-state model, and snapshot/bootstrap surface are locked.
- No Vue/Svelte/Solid bindings in v0.2 (deferred to v0.3 — but the framework-agnostic `@atriumjs/client` package makes them straightforward when we get there).
- No multi-region demo orchestration (single-region public demo is enough for launch).

---

## 2. Package renames (v0.1 → v0.2)

| v0.1 (current)              | v0.2 (new)           | Notes                                                                |
| --------------------------- | -------------------- | -------------------------------------------------------------------- |
| `@atriumjs/atrium-protocol` | `@atriumjs/protocol` | unchanged content; rename only                                       |
| `@atriumjs/atrium-server`   | `@atriumjs/express`  | the existing Express middleware moves here as one adapter among many |
| —                           | `@atriumjs/core`     | new — framework-agnostic Web Fetch core                              |
| —                           | `@atriumjs/fastify`  | new adapter                                                          |
| —                           | `@atriumjs/hono`     | new adapter                                                          |
| —                           | `@atriumjs/next`     | new adapter (Next.js Route Handlers)                                 |
| —                           | `@atriumjs/nestjs`   | new adapter                                                          |
| `@atriumjs/atrium-worker`   | `@atriumjs/worker`   | rename only                                                          |
| `@atriumjs/atrium-react`    | `@atriumjs/react`    | thin wrapper around new client core                                  |
| —                           | `@atriumjs/client`   | new — framework-agnostic browser client                              |
| —                           | `@atriumjs/sdk`      | new — typed host-app HTTP/WS client                                  |
| `@atriumjs/atrium-cli`      | `@atriumjs/cli`      | extended (`atrium dev`, `atrium new`, `atrium doctor`)               |
| `@atriumjs/atrium-demo`     | `@atriumjs/demo`     | unchanged role; uses the new packages                                |

**Deprecation shims.** During the v0.1 → v0.2 transition we shipped one final v0.1.x release per old name that re-exported from the new package and logged a one-time deprecation warning. These shims have been removed from the repo and unpublished from npm; new installs must use the `@atriumjs/*` names above.

---

## 3. Layered package layout

```
                 ┌──────────────────────────────────────────────┐
   host app  →   │  @atriumjs/express  / fastify / hono / next  │  ← adapters
                 │             / nestjs / cloudflare            │     (one per framework)
                 └──────────────────────┬───────────────────────┘
                                        │
                                        ▼
                          ┌────────────────────────────┐
                          │   @atriumjs/core           │  ← Web Fetch handlers,
                          │  (state, transport, relay) │     state machine,
                          └─────┬─────────────┬────────┘     transport abstraction
                                │             │
                       @atriumjs/protocol   @atriumjs/sdk
                       (Zod + types)        (typed client over HTTP/WS)
                                              ▲
                                              │ (used internally by adapters
                                              │  and exposed to consumers)
                                              │
                          ┌───────────────────┴──────────┐
   browser app  →         │       @atriumjs/client       │  ← framework-agnostic
                          │  (transport, rendering, IO)  │
                          └───────────────────┬──────────┘
                                              │
                                       @atriumjs/react   (thin wrapper)
```

Worker is unchanged in role:

```
@atriumjs/worker  ←  Chromium + Playwright + screencast pump
                     (still dialed by adapters; identical wire protocol)
```

Tooling:

```
@atriumjs/cli   ←  `atrium dev`, `atrium new`, `atrium doctor`, `atrium publish`
@atriumjs/demo  ←  bundled demo using all of the above
```

---

## 4. `@atriumjs/core` — framework-agnostic foundation

The core has three responsibilities:

1. **HTTP request handling**: parse, authorize, dispatch, build responses — all expressed against the **Web Fetch API standard** (`Request` → `Response`).
2. **Session state machine**: identical to v0.1 (pending → ready → active → terminated), backed by a pluggable store (in-memory by default, Redis for production).
3. **Transport abstraction**: a single `Relay` interface that the WS, SSE, and polling implementations all satisfy. Adapters wire the right one based on the runtime.

### 4.1 The single entry point

```ts
import { createAtrium } from "@atriumjs/core";

const atrium = createAtrium({
  authorize: async (req: Request) => {
    /* return Principal or throw 401/403 */
  },
  policies: { /* same shape as v0.1 */ },
  worker: {
    dialBase: process.env.ATRIUM_WORKER_DIAL_BASE!,
    sharedSecret: process.env.ATRIUM_WORKER_SECRET!,
  },
  store: redisStore({ url: process.env.REDIS_URL }), // or memoryStore()
  // transports: ["ws", "sse", "poll"]               // optional override; default = all
});

// What the adapters use:
atrium.handleRequest(request: Request): Promise<Response>
atrium.handleUpgrade(request: Request, raw): Promise<UpgradeResult>
atrium.handleSseConnect(request: Request): Promise<Response /* text/event-stream */>
atrium.handlePoll(request: Request): Promise<Response>
```

Every adapter is a few dozen lines of glue. The hard work is in `@atriumjs/core`.

### 4.2 The four core handlers

| Handler            | URL pattern                                                         | Method                  |
| ------------------ | ------------------------------------------------------------------- | ----------------------- |
| `handleRequest`    | `/sessions`, `/sessions/:id`, `/sessions/:id/{cookies,...,control}` | HTTP                    |
| `handleUpgrade`    | `/sessions/:id/stream`                                              | WS upgrade              |
| `handleSseConnect` | `/sessions/:id/stream/sse`                                          | GET (text/event-stream) |
| `handlePoll`       | `/sessions/:id/stream/poll`, `/sessions/:id/stream/input`           | GET / POST long-poll    |

Adapters route incoming requests to these four. The core does not assume anything about the host framework, headers shape, or async cancellation primitive beyond what the Web Fetch API guarantees.

### 4.3 Session store interface

```ts
export interface SessionStore {
  create(s: SessionRecord): Promise<void>;
  get(id: string): Promise<SessionRecord | null>;
  update(id: string, mut: Partial<SessionRecord>): Promise<void>;
  delete(id: string): Promise<void>;
  // Pub/sub for control-state changes
  subscribe(id: string, fn: (e: SessionEvent) => void): () => void;
  publish(id: string, e: SessionEvent): Promise<void>;
}

export const memoryStore = (): SessionStore => /* ... */;
export const redisStore = (cfg: { url: string }): SessionStore => /* ... */;
```

`memoryStore` is the default and supports single-process deployments (incl. `npx atrium dev`). `redisStore` enables horizontal scale.

---

## 5. Adapters

Every adapter implements the same contract: route HTTP/WS/SSE/poll URLs to the right `@atriumjs/core` handler, plus a way to attach the upgrade listener if the framework's WebSocket story is non-default.

All adapters ship with:

- A canonical mount function (e.g., `createAtriumHandler`, `atriumPlugin`, `AtriumModule`).
- WebSocket support where the runtime allows it.
- Automatic SSE + polling fallback registration (because they reuse `@atriumjs/core` they get this for free).
- A `peerDependencies` entry on the framework, never a direct dependency.

### 5.1 `@atriumjs/express`

```ts
import express from "express";
import { createServer } from "node:http";
import { createAtrium } from "@atriumjs/core";
import { mountExpress } from "@atriumjs/express";

const atrium = createAtrium({ authorize, policies, worker });
const app = express();
const server = createServer(app);

mountExpress(app, server, atrium, { path: "/atrium" });

server.listen(3000);
```

Internally `mountExpress` calls `app.use(path, expressAdapter(atrium))` and `server.on("upgrade", ...)`. SSE + polling work as normal Express handlers, so they're just registered routes.

### 5.2 `@atriumjs/fastify`

```ts
import Fastify from "fastify";
import { atriumPlugin } from "@atriumjs/fastify";

const fastify = Fastify();
await fastify.register(atriumPlugin, { atrium, prefix: "/atrium" });
await fastify.listen({ port: 3000 });
```

Uses `@fastify/websocket` peer-dep for the WS upgrade. SSE goes through Fastify's reply stream; polling is an ordinary route.

### 5.3 `@atriumjs/hono`

```ts
import { Hono } from "hono";
import { atriumHono } from "@atriumjs/hono";

const app = new Hono();
app.route("/atrium", atriumHono(atrium));
export default app;
```

Hono speaks Web Fetch natively, so the adapter is mostly a thin pass-through to `atrium.handleRequest`. The WebSocket upgrade requires runtime-specific glue:

- **Bun**: native `Bun.serve` upgrade.
- **Node** (`@hono/node-server`): the adapter exposes `attachUpgrade(server)`.
- **Cloudflare Workers**: the adapter exports a Durable Object class, see §5.6.

### 5.4 `@atriumjs/next`

Next.js App Router has no WebSocket support inside Route Handlers (this is unchanged in 2026). Atrium's Next adapter ships SSE+polling support out of the box and exposes an opt-in WS attach hook for users running Next on a custom Node server.

```ts
// app/api/atrium/[...path]/route.ts
import { createAtriumNextHandler } from "@atriumjs/next";

const atrium = createAtrium({ authorize, policies, worker });

export const { GET, POST, DELETE } = createAtriumNextHandler(atrium);
```

That single file gives the user a complete, working installation **with SSE transport**. The browser client picks SSE automatically because the negotiation endpoint reports `transports: ["sse", "poll"]`.

For users who want WebSockets in Next, the adapter exposes:

```ts
// server.js (custom Node server)
import next from "next";
import { createServer } from "node:http";
import { attachAtriumUpgrade } from "@atriumjs/next/upgrade";

const app = next({ dev: false });
await app.prepare();
const server = createServer(app.getRequestHandler());
attachAtriumUpgrade(server, atrium);
server.listen(3000);
```

The negotiation now reports `transports: ["ws", "sse", "poll"]` and clients prefer WS.

### 5.5 `@atriumjs/nestjs`

NestJS is well-suited to this — it has both `@nestjs/platform-express` (HTTP) and `@nestjs/websockets` (WS). The adapter ships as a module:

```ts
// app.module.ts
import { Module } from "@nestjs/common";
import { AtriumModule } from "@atriumjs/nestjs";

@Module({
  imports: [
    AtriumModule.forRoot({
      authorize: /* ... */,
      policies: /* ... */,
      worker: /* ... */,
      // path defaults to "/atrium"
    }),
  ],
})
export class AppModule {}
```

For async config (DI'd dependencies):

```ts
AtriumModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (cfg: ConfigService) => ({
    authorize: createAuthorizer(cfg),
    policies: cfg.get("atrium.policies"),
    worker: cfg.get("atrium.worker"),
  }),
});
```

Internals:

- An `AtriumController` registers the HTTP routes (delegating to `atrium.handleRequest`).
- An `AtriumGateway` (`@WebSocketGateway`) handles the WS upgrade through the adapter's `WsAdapter` (we ship `AtriumWsAdapter` so users don't have to subclass NestJS's; if they're already using `@nestjs/platform-fastify` or another, the adapter detects and uses the right path).
- An `AtriumSseController` handles the EventSource fallback.
- An `AtriumPollingController` handles long-poll fallback.

The whole module respects NestJS DI throughout — `authorize` can inject a `UsersService`, `policies` can be config-driven, etc.

### 5.6 `@atriumjs/cloudflare` (stretch goal for v0.2.x)

Edge-only deployment using Durable Objects for WS state. Mentioned for completeness; not blocking v0.2 launch.

---

## 6. Transport negotiation and fallback

### 6.1 The three transports

| Transport          | Wire                                         | Latency overhead vs WS   | Notes                                                                                                              |
| ------------------ | -------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| **WebSocket**      | Native bidirectional                         | baseline (~0)            | Default. Used when the runtime supports `upgrade` and the client succeeds.                                         |
| **SSE + HTTP**     | `EventSource` server→client; HTTP POST input | +30–80ms per input event | Used in serverless / edge / Next App Router runtimes. Good for credential entry; acceptable for occasional clicks. |
| **HTTP long-poll** | GET `/poll` (long-held) + POST `/input`      | +100–250ms per cycle     | Last-resort fallback. Works through the worst proxies.                                                             |

Frame stream size: typically 8–25 KB JPEG at 12 fps (~150 KB/s). All three transports handle this comfortably; the difference is **input latency**, not bandwidth.

### 6.2 Server-side negotiation

`POST /sessions` returns:

```json
{
  "sessionId": "01HZ...",
  "viewerToken": "eyJ...",
  "transports": [
    { "kind": "ws", "url": "wss://api.example/atrium/sessions/01HZ.../stream" },
    { "kind": "sse", "framesUrl": ".../stream/sse", "inputUrl": ".../stream/input" },
    { "kind": "poll", "url": ".../stream/poll", "inputUrl": ".../stream/input" }
  ]
}
```

The order is the **server's preference**. The list is determined by the adapter at startup (it knows what the runtime supports) and may be further restricted by `policies.transports`.

### 6.3 Client-side selection

`@atriumjs/client` walks the list in order:

1. Try the first transport. If `connect()` resolves within a 3-second budget, lock it in.
2. On failure (timeout, error, or explicit `unsupported`), fall through to the next.
3. After all transports fail, surface a typed `TransportError` with the chain of failures.

Reconnect logic re-runs the negotiation from scratch (the original transport may now work, or may not). This catches the "user moves from coffee shop wifi to LTE and WS now works" case.

### 6.4 Configuration knobs

- `policies.transports?: ("ws" | "sse" | "poll")[]` — restrict on the server side.
- `RemoteBrowser`'s `prefer?: "ws" | "sse" | "poll"` — let the consumer override the order (mostly for testing).
- `RemoteBrowser`'s `onTransport?: (chosen) => void` — observability hook.

### 6.5 Why not engine.io / socket.io

Tempting because it solves negotiation already, but: pulls a chunky client, mandates Socket.io's protocol on the wire, and locks us into their reconnect model. Our protocol is small enough that hand-rolling the negotiation is ~300 lines and keeps the core dep-free. Decision: **roll our own**.

---

## 7. `@atriumjs/sdk` — typed host-app client

Today consumers hand-write `fetch()` against the HTTP routes. The SDK replaces that with a fully typed surface:

```ts
import { createAtriumClient } from "@atriumjs/sdk";

const atrium = createAtriumClient({
  baseUrl: "/atrium", // relative or absolute
  fetch: globalThis.fetch, // pluggable (e.g., for SSR)
  auth: () => getHostBearerToken(), // called on every request
});

// Sessions
const session = await atrium.sessions.create({ initialUrl: "https://x.com/login" });
const summary = await atrium.sessions.get(session.id);
const snapshot = await atrium.sessions.snapshot(session.id);
await atrium.sessions.applySnapshot(session.id, { storageState });
await atrium.sessions.control(session.id, { grant: "human" });
await atrium.sessions.destroy(session.id);

// Higher-level helpers (see §9)
const result = await atrium.collect({
  /* ... */
});
```

Every method is fully typed via `@atriumjs/protocol` Zod schemas → TS type inference. Error responses are discriminated unions:

```ts
type SessionsCreateError =
  | { code: "rate_limited"; retryAfterSeconds: number }
  | { code: "quota_exceeded"; current: number; max: number }
  | { code: "no_capacity" }
  | { code: "url_not_allowed"; url: string }
  | { code: "unauthorized" };
```

The SDK works in browsers, Node, and edge runtimes. It's used internally by `@atriumjs/react` for the host-side calls so types propagate end to end.

---

## 8. `@atriumjs/client` and `@atriumjs/react`

`@atriumjs/client` is the framework-agnostic browser client. It owns:

- Transport negotiation (see §6).
- Frame decoding (`<img>` ping-pong or `<canvas>` + `createImageBitmap`).
- Input capture and forwarding (mouse / key / wheel / IME / paste).
- Control-state mirroring.
- Resize and viewport sync.
- Reconnect / replay.

It exposes a vanilla TS class:

```ts
import { AtriumClient } from "@atriumjs/client";

const client = new AtriumClient({ wsUrl, viewerToken });
client.attach({
  surface: HTMLCanvasElement,           // where frames render
  capture: HTMLElement,                 // where input events come from
});
client.on("control", (state) => /* ... */);
client.on("transport", (chosen) => /* ... */);
client.on("terminated", (reason) => /* ... */);
client.requestControl();
client.releaseControl();
client.destroy();
```

`@atriumjs/react` becomes a ~150-line wrapper:

```tsx
import { RemoteBrowser } from "@atriumjs/react";

<RemoteBrowser
  session={session} // shape: { id, viewerToken, transports }
  chrome="full" // "none" | "minimal" | "full" | { showToolbar, ... }
  onControlChange={(holder) => {}}
  onTerminated={(reason) => {}}
  prefer="ws" // optional transport override
/>;
```

Vue/Svelte wrappers in v0.3 just wrap the same `AtriumClient`.

---

## 9. High-level helpers

The 80% use case for this library — "show a login page, let the user sign in, give me back cookies" — should be a single call.

### 9.1 `atrium.collect({ ... })` (server-side)

```ts
const result = await atrium.collect({
  loginUrl: "https://x.com/i/flow/login",
  doneWhen: { url: /^https:\/\/x\.com\/home/ }, // or a custom predicate
  ui: {
    // controls the user-facing surface
    mountSelector: "#atrium", // mount inline
    // OR: { popup: true } to open in a separate window
  },
  timeoutMs: 5 * 60_000,
});
// result: {
//   sessionId,
//   storageState: PlaywrightStorageState,
//   cookies: Cookie[],
//   finalUrl: string,
//   durationMs: number,
// }
```

Internally this is: create session → grant human control → wait for `doneWhen` predicate (worker evaluates it on every navigation) → snapshot → release control → destroy. It's a recipe over the existing primitives, not a new engine path.

The matching client-side helper auto-mounts `<RemoteBrowser />` to the configured selector, listens for completion, and resolves.

### 9.2 `atrium.replay({ storageState, run })` (server-side)

```ts
await atrium.replay({
  storageState,
  run: async ({ page }) => {
    // page: Playwright Page
    await page.goto("https://x.com/compose/post");
    await page.fill('[role="textbox"]', "hello");
    await page.click('button:has-text("Post")');
  },
});
```

Wraps: create session with bootstrap → headless run → snapshot fresh state → destroy. No human in the loop, just letting the worker do the automation step. This rounds out the lifecycle: `collect()` to capture, `replay()` to use.

---

## 10. Zero-config dev mode

Goal: a developer who reads about Atrium on Twitter and runs **one command** sees a working demo within 30 seconds.

```bash
npx atrium dev
```

What it does:

1. **Detect Chromium.** If Playwright Chromium is installed locally, use it. Otherwise, prompt and run `npx playwright install chromium` (one-time, ~80MB).
2. **Spawn an embedded worker** in a child process (no Docker, no Xvfb on macOS — Playwright handles `headed: true` natively; on Linux without a display, fall back to `xvfb-run` if available, else headless with stealth).
3. **Start an in-process API + UI** on `127.0.0.1:3333`:
   - `@atriumjs/core` mounted on `/atrium` with `memoryStore()`.
   - Vite-served demo UI at `/`.
   - No env vars required; the dev mode generates a transient shared secret in memory.
4. **Open the browser** to `http://127.0.0.1:3333`.
5. **Print a tip** about the demo flow ("Click Login and post").

No Redis. No Docker. No `pnpm install`. The user's first impression is the working demo, not setup.

`npx atrium dev` accepts flags for everything (`--port`, `--worker-port`, `--no-open`, `--logs verbose`, `--stack ts|js`) and a `--scaffold next` mode that drops a starter `app/api/atrium/[...path]/route.ts` into the current directory if it's an empty Next.js project.

### 10.1 `atrium new <name>`

Scaffolds a fresh repo wired for one of: `next`, `express`, `fastify`, `hono`, `nestjs`. Each template:

- Has the adapter pre-installed and mounted.
- Has `<RemoteBrowser />` rendered on `/`.
- Includes a stub auth function (clearly marked TODO).
- Includes a `docker-compose.yml` for the worker.
- Comes with a one-line `pnpm dev` that runs everything.

This is what "viral developer experience" looks like in 2026: a `pnpm create @atriumjs/app` flow that gets people from zero to a deployed demo on Vercel/Railway/Fly in under 10 minutes.

### 10.2 `atrium doctor`

Already exists; expand it to cover:

- Playwright Chromium presence + version.
- Reachability of `ATRIUM_WORKER_DIAL_BASE`.
- Shared-secret roundtrip.
- WS / SSE / polling reachability from the API node (test each transport explicitly and print which ones work).
- Redis ping (if configured).

---

## 11. Public-demo rate limiting

We're going to host `demo.atrium.dev` (or wherever) for people to click and see the X-login flow without installing anything. This is the highest-leverage growth surface and also the highest-abuse surface. Hardening matters.

### 11.1 Threat model

Adversaries we care about:

- **Botnets** trying to spin up sessions to scrape, mine, or DoS our worker pool.
- **Curious devs** hammering the demo to figure out how to call our internal worker directly.
- **Malicious users** trying to use the demo browser to attack third-party sites (account stuffing on victim accounts).
- **Cost attackers** trying to drive up our compute bill.

Out of scope: targeted attacks by sophisticated adversaries with clean residential proxy pools. We mitigate, we don't prevent.

### 11.2 The `demoPolicies()` preset

A new export from `@atriumjs/core`:

```ts
import { demoPolicies } from "@atriumjs/core/policies";

const atrium = createAtrium({
  authorize: anonymousDemoUser, // assigns a stable id from IP+UA hash
  policies: demoPolicies({
    perIp: {
      maxConcurrent: 1, // one live session per IP at a time
      maxPerHour: 3,
      cooldownSeconds: 90, // gap between sessions
    },
    fleet: {
      maxConcurrent: 50, // hard cap across all viewers
      maxPerHour: 500,
    },
    perSession: {
      sessionTtlMs: 3 * 60_000, // 3 minutes total
      idleTtlMs: 45_000, // 45s without input ends it
      memoryMb: 1024, // tighter than production
    },
    urlAllowlist: ["https://x.com/i/flow/login", "https://x.com/home", "https://x.com/compose/*"],
    captcha: {
      provider: "turnstile", // Cloudflare Turnstile — free
      siteKey: process.env.TURNSTILE_SITE_KEY,
      secret: process.env.TURNSTILE_SECRET,
    },
    abuseSignals: {
      blockTorExitNodes: true,
      blockKnownVpns: false, // too aggressive for a public demo
      blockHeadless: true, // detect headless browsers, refuse
    },
  }),
});
```

Each section translates into specific server-side behavior (described next).

### 11.3 What it actually does

- **Per-IP rate limit**: token bucket in Redis (`rl:ip:<ip>`) with `maxConcurrent`, `maxPerHour`, `cooldownSeconds`. Returns `429 Too Many Requests` with `Retry-After`.
- **Fleet cap**: counter (`rl:fleet:concurrent`) atomically incremented on session create; refused when over `fleet.maxConcurrent`. Returns `503 Service Unavailable` with a small queueing hint.
- **CAPTCHA gate**: `POST /sessions` requires a `cf-turnstile-response` field validated server-side before the session is enqueued. Adds 0–3s of friction for humans, blocks 95%+ of bots.
- **URL allowlist**: enforced both at session creation (initialUrl must match) and on every top-level navigation. Mid-flow redirects outside the allowlist terminate the session.
- **Tighter session TTLs** than production: 3 min wall-clock, 45s idle. Demo users don't need long sessions.
- **Headless-browser detection**: a small JS challenge on the demo page that fails for headless Chromium / Playwright bot harnesses. Not bulletproof but raises the bar.
- **Tor exit-node check**: against a daily-refreshed list (free).
- **Abuse cookie**: when a session is terminated for any rate-limit or abuse reason, set a long-lived signed cookie with the violation. On future requests, treat that cookie as a strong negative signal (longer cooldowns).
- **Logging**: every refused request logged with reason + truncated IP for ops.

### 11.4 Redis-backed implementation

The token-bucket Lua script is shared across nodes, so the public demo can scale horizontally while still enforcing global limits. Pseudocode:

```lua
-- KEYS[1] = bucket key, ARGV[1] = max, ARGV[2] = window seconds, ARGV[3] = now
local count = redis.call("INCR", KEYS[1])
if count == 1 then redis.call("EXPIRE", KEYS[1], ARGV[2]) end
if count > tonumber(ARGV[1]) then return 0 else return 1 end
```

Used for `perIp.maxPerHour`, `fleet.maxPerHour`, etc.

### 11.5 Worker-side hardening for the public demo

Beyond what the library already does:

- **Egress firewall** on the worker container: allow only domains in the URL allowlist (HTTP CONNECT proxying via mitmproxy or just `iptables`). Even a malicious URL injection can't reach the open internet.
- **Block instance-metadata endpoints** (`169.254.169.254`, `fd00:ec2::254`).
- **No mounted volumes**, read-only root filesystem.
- **Aggressive memory cap** (1 GB) and CPU pin (1 core).
- **`--memory-pressure-off=false` + `--js-flags=--max-old-space-size=512`** to fight runaway tabs.

### 11.6 Operational guardrails

- **Daily budget alert**: a Cloudflare Worker (or equivalent) tallies sessions per day; emails ops if over a threshold.
- **Kill switch**: `DEMO_ENABLED=0` env on the API tier instantly returns 503 from `POST /sessions` without dropping live sessions.
- **One-click ban**: an internal admin endpoint `POST /admin/ban-ip` writes a long TTL key that short-circuits everything for an IP.

### 11.7 Recommended demo deployment

For when we go live:

- API: 2× Fly.io shared-cpu-1x instances (≈$3/mo each) behind their L7 LB.
- Worker: 2× Fly.io shared-cpu-2x with 4 GB RAM (≈$10/mo each), capacity 4 sessions each → 8 concurrent.
- Redis: Upstash free tier (≤10K commands/day handles ~500 sessions/day).
- Cloudflare in front: Turnstile widget, basic WAF rules, geo-block known abuse regions if it gets bad.
- Total expected cost at launch: under $30/mo. If usage explodes, scale workers; the API tier rarely needs more.

---

## 12. Migration plan: v0.1 → v0.2

1. **Branch.** `git checkout -b v0.2-refactor`.
2. **Create `@atriumjs/core`.** Move shared HTTP/WS routing logic out of the existing server package; it becomes Web Fetch handlers. The Express adapter is built on top.
3. **Rename packages.** Each `@atriumjs/atrium-X` is renamed to `@atriumjs/X` in `package.json`. Update all internal imports.
4. **Build the typed SDK.** `@atriumjs/sdk` over the new Zod schemas. Replace hand-written fetch in the demo with SDK calls.
5. **Build the framework-agnostic client.** Refactor `@atriumjs/react` → `@atriumjs/client` + thin React wrapper.
6. **Build the four new adapters** (Fastify, Hono, Next, NestJS) with shared adapter test suite.
7. **Implement transport negotiation** in `@atriumjs/core` and `@atriumjs/client`.
8. **Implement `npx atrium dev`** zero-config flow.
9. **Implement `demoPolicies()`** and Redis-backed rate limiting.
10. **Publish v0.2.0.** Simultaneously publish deprecation shims at the old `@atriumjs/atrium-*` names whose only export is a re-export of the new package + a one-time stderr warning.
11. **Update README / docs site** with the new package names everywhere.
12. **Migration guide** for v0.1 users: a single doc with "rename these imports, that's it" + a codemod (`npx atrium migrate v0.2`).

Estimated effort: 3–4 weeks of focused work for one engineer, or 2 weeks for two.

---

## 13. Implementation roadmap

**Sprint 1 (week 1–2): foundation rename + core**

- All packages renamed.
- `@atriumjs/core` extracted with Web Fetch handlers.
- `@atriumjs/express` is the only adapter, parity with v0.1.
- CI green.

**Sprint 2 (week 2–3): adapters + SDK**

- Fastify, Hono, Next, NestJS adapters with shared parity tests.
- `@atriumjs/sdk` published.
- Demo migrated to use the SDK.

**Sprint 3 (week 3–4): transport + client + dev mode**

- SSE + polling transports server-side.
- `@atriumjs/client` framework-agnostic core.
- `@atriumjs/react` thin wrapper.
- Auto-negotiation in client.
- `npx atrium dev` zero-config.

**Sprint 4 (week 4): demo hardening + ship**

- `demoPolicies()` + Redis rate limit.
- Worker egress firewall recipe.
- Public demo deployed at `demo.atrium.dev`.
- v0.2.0 published; v0.1.x shims published.
- Docs site updated.

---

## Appendix A — adapter quick-reference

### Express

```ts
import { mountExpress } from "@atriumjs/express";
mountExpress(app, server, atrium, { path: "/atrium" });
```

### Fastify

```ts
import { atriumPlugin } from "@atriumjs/fastify";
await fastify.register(atriumPlugin, { atrium, prefix: "/atrium" });
```

### Hono

```ts
import { atriumHono } from "@atriumjs/hono";
app.route("/atrium", atriumHono(atrium));
// Node only: attachUpgrade(server, atrium)
```

### Next.js (App Router)

```ts
// app/api/atrium/[...path]/route.ts
import { createAtriumNextHandler } from "@atriumjs/next";
export const { GET, POST, DELETE } = createAtriumNextHandler(atrium);
// SSE/polling work out of the box; for WS, use a custom server.
```

### NestJS

```ts
import { AtriumModule } from "@atriumjs/nestjs";
@Module({ imports: [AtriumModule.forRoot({ ...atriumConfig, path: "/atrium" })] })
export class AppModule {}
```

---

## Appendix B — public demo deployment recipe (concise)

```ts
// apps/demo-api/src/server.ts
import express from "express";
import { createServer } from "node:http";
import { createAtrium, redisStore, demoPolicies } from "@atriumjs/core";
import { mountExpress } from "@atriumjs/express";

const atrium = createAtrium({
  authorize: anonymousDemoUser({ trustProxyHeader: "cf-connecting-ip" }),
  policies: demoPolicies({
    perIp: { maxConcurrent: 1, maxPerHour: 3, cooldownSeconds: 90 },
    fleet: { maxConcurrent: 50, maxPerHour: 500 },
    perSession: { sessionTtlMs: 180_000, idleTtlMs: 45_000, memoryMb: 1024 },
    urlAllowlist: ["https://x.com/i/flow/login", "https://x.com/home", "https://x.com/compose/*"],
    captcha: {
      provider: "turnstile",
      siteKey: process.env.TURNSTILE_SITE_KEY!,
      secret: process.env.TURNSTILE_SECRET!,
    },
    abuseSignals: { blockTorExitNodes: true, blockHeadless: true },
  }),
  worker: {
    dialBase: process.env.ATRIUM_WORKER_DIAL_BASE!,
    sharedSecret: process.env.ATRIUM_WORKER_SECRET!,
  },
  store: redisStore({ url: process.env.REDIS_URL! }),
});

const app = express();
const server = createServer(app);
mountExpress(app, server, atrium, { path: "/atrium" });
server.listen(process.env.PORT || 3000);
```

Pair with a Cloudflare-fronted DNS, Turnstile widget on the demo UI, and a Fly.io worker pool sized for ~50 concurrent sessions.

---
