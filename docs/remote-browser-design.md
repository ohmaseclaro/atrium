# Remote Browser Library — Technical Design Document

> Status: Draft v0.1
> Audience: Engineers implementing the library
> Scope: Architecture, package APIs, wire protocol, deployment

**Implementation defaults in this repository:** API nodes use the **dial** pattern (open WebSocket to the worker backplane), and workers drive Chromium with **Playwright** (including CDP screencast via `BrowserContext.newCDPSession`), not a hand-maintained raw CDP client.

**Docs:** [Documentation hub](./README.md) · [User guide](./user-guide.md) · [Repository README](../README.md)

---

## 1. Goals and non-goals

### Goals

A drop-in remote-browser primitive that lets a host application show a real Chromium browser (running in a managed VM/container pool) inside a React component, with first-class support for **handing control to a human end-user** for tasks like:

- Entering credentials on third-party sites
- Solving captchas
- Approving OAuth consent screens
- Walking through 2FA flows

After the human finishes, the host application can extract the resulting cookies / `storage_state` and resume automation, or simply persist the authenticated session for later reuse.

The library ships as three independently consumable packages plus a Docker image:

1. A **backend middleware** that mounts onto any Express-compatible HTTP server and exposes session-management endpoints + a WebSocket relay.
2. A **browser worker** distributed as a Docker image, scaled horizontally via BullMQ, with per-session CPU/memory caps.
3. A **React client** that renders the live CDP frame stream with **optional** embedded-browser chrome (tab strip, URL bar, navigation); see [`packages/react/README.md`](../packages/react/README.md).

### Non-goals

- Audio/video streaming (no media playback fidelity required).
- High frame rate (10–15 fps target; we are not building a remote-desktop product).
- Whole-OS remoting (browser-only; no terminal, no native apps).
- Captcha-solving automation (we hand off to humans, we do not solve).
- Built-in user authentication or billing — those belong to the consuming application.

### Design principles

1. **Server-authoritative.** The client is a dumb renderer + input forwarder. Locking, control state, lifecycle, and cookie extraction are all enforced server-side. The client UI reflects state, never determines it.
2. **Bring-your-own auth.** The middleware accepts an `authorize(req)` hook from the host app. We do not ship users, sessions, JWTs, or RBAC.
3. **Stateless API server, stateful workers.** API nodes are horizontally scalable with zero local state. Workers own one or more Chromium processes and report their state through Redis.
4. **Pessimistic resource control.** Every session has a hard CPU limit, a hard memory limit, and an idle TTL. Workers refuse jobs they cannot accommodate.
5. **CDP-only streaming.** No Xvfb, no VNC, no WebRTC. Headful Chromium under a virtual framebuffer when anti-bot evasion is required (toggleable per session), but the frame transport is always CDP screencast over WebSocket.

---

## 2. Naming options

A few candidates with rationale; pick one before publishing the npm scope.

- **Atrium** — an entry hall where visitors authenticate before being admitted further. Clean, memorable, evokes the credential-handoff use case without being on-the-nose. _Recommended._
- **Usher** — guides the user through the auth flow, hands them off, hands back. Strong verb energy.
- **Threshold** — the moment of crossing from "agent" to "human" and back. Slightly abstract.
- **Cabin** — a small private space; nice metaphor for credential entry being shielded.
- **Periscope** — looking into a sealed compartment from outside. Visually descriptive but the analogy breaks if you push it.
- **Foyer** — same family as Atrium but shorter and less elegant.
- **Handoff** — literal but unmemorable as a product name; better as an internal term.

For the rest of this document I will use **Atrium** as the placeholder name. Replace globally before publishing.

Package layout under the chosen scope (`@atriumjs/*` shown):

| Package              | Purpose                                                                     |
| -------------------- | --------------------------------------------------------------------------- |
| `@atriumjs/protocol` | Wire protocol types, shared across all packages                             |
| `@atriumjs/express`  | Express-compatible middleware (the backend entry point)                     |
| `@atriumjs/worker`   | Browser worker process; published as both an npm package and a Docker image |
| `@atriumjs/react`    | React components and hooks (the client entry point)                         |
| `@atriumjs/cli`      | Optional dev tool for running a local stack                                 |
| `@atriumjs/demo`     | Full-stack demo app (Vite + Express) exercising the packages above          |

---

## 3. High-level architecture

```
                                    ┌────────────────────────────┐
   ┌──────────────┐   HTTPS/WSS    │  Host application          │
   │  React client│ ◄────────────► │  ┌──────────────────────┐  │
   │  (Atrium UI) │                │  │ @atriumjs/express (mw)  │  │
   └──────────────┘                │  └──────────┬───────────┘  │
                                   └─────────────┼──────────────┘
                                                 │
                                          BullMQ / Redis
                                                 │
                            ┌────────────────────┼─────────────────────┐
                            │                    │                     │
                       ┌────▼─────┐         ┌────▼─────┐          ┌────▼─────┐
                       │ Worker A │         │ Worker B │   ...    │ Worker N │
                       │ ┌──────┐ │         │ ┌──────┐ │          │ ┌──────┐ │
                       │ │Chrom.│ │         │ │Chrom.│ │          │ │Chrom.│ │
                       │ │ x N  │ │         │ │ x N  │ │          │ │ x N  │ │
                       │ └──────┘ │         │ └──────┘ │          │ └──────┘ │
                       └──────────┘         └──────────┘          └──────────┘
```

### Component responsibilities

**React client (`@atriumjs/react`)**

- Renders frames received over WebSocket onto a `<canvas>`.
- Captures pointer/keyboard/scroll/IME events and forwards them to the server.
- Optionally renders embedded-browser chrome (back/forward/reload, URL bar, tab strip); see shipped [`@atriumjs/react`](../packages/react/README.md).
- Reflects control state; disables input when locked to the agent.

**API server / middleware (`@atriumjs/express`)**

- HTTP endpoints for session lifecycle (create, get, destroy, navigate, extract cookies).
- WebSocket endpoint that proxies the live frame stream and input events between client and worker.
- Enforces auth via host-provided hook.
- Enforces control-state policy (only one writer at a time).
- Enqueues session-create jobs onto BullMQ; reads worker state from Redis.
- Stateless; can run behind any load balancer.

**Worker (`@atriumjs/worker`)**

- BullMQ consumer; pulls session-create jobs.
- Spawns a headful Chromium under Xvfb (or headless with stealth — configurable per job).
- Attaches to the Chromium via CDP, starts `Page.startScreencast`.
- Opens an internal WebSocket back to the API server (or accepts inbound) carrying frames and accepting input events.
- Reports liveness, CPU%, RSS, session count to Redis on a heartbeat.
- Enforces per-session resource caps via cgroups (Docker `--memory`, `--cpus`) at the container level, plus per-Chromium `--memory-pressure-off=false` and `prlimit` for tighter bounds.

**Redis**

- BullMQ queues (`atrium:sessions:create`, `atrium:sessions:destroy`).
- Worker registry (`atrium:workers:<id>` with TTL).
- Session registry (`atrium:sessions:<id>` mapping to worker URL + state).
- Pub/sub channel for control-state changes.

---

## 4. Repository structure

Monorepo (pnpm + Turborepo or Nx; pnpm workspaces is sufficient).

```
atrium/
├── packages/
│   ├── protocol/             # shared TS types, Zod schemas
│   ├── server/               # Express middleware
│   ├── worker/               # browser worker
│   ├── react/                # React UI
│   ├── cli/                  # dev convenience CLI
│   └── demo/                 # full-stack demo (see packages/demo/README.md)
├── docker/
│   └── worker/
│       └── Dockerfile
├── examples/
│   ├── express-host/         # minimal host app using @atriumjs/express only
│   ├── nextjs-app/           # (planned) Next.js + @atriumjs/react demo
│   └── docker-compose.yml    # (planned) local dev: redis + worker + example host
└── docs/
    ├── remote-browser-design.md
    └── artifacts/            # spec, progress, sprint-bundle.json, sprints/sprint-*/
```

---

## 5. Wire protocol (`@atriumjs/protocol`)

All messages JSON over WebSocket. Binary frames carry JPEG image data (avoiding base64 overhead).

### 5.1 Session states

```
       create
          │
          ▼
      pending ────────timeout─────────► failed
          │
   worker_assigned
          │
          ▼
        ready ◄──────── release_control ──────────┐
          │                                        │
   client_connect                                  │
          │                                        │
          ▼                                        │
    active(agent) ◄────── grant_control ──────► active(human)
          │                                        │
       destroy / idle_ttl / disconnect            │
          │                                        │
          ▼                                        │
      terminated ◄────────────────────────────────┘
```

Only `agent` or `human` may hold the input writer slot. Default on create is `agent` (so server-side automation can begin immediately). The `idle` substate (no writer) is used during transitions and during view-only sharing.

### 5.2 HTTP endpoints

| Method   | Path                          | Purpose                                                           |
| -------- | ----------------------------- | ----------------------------------------------------------------- | ---------------------- | ---------- |
| `POST`   | `/sessions`                   | Create a new session (returns `{sessionId, viewerToken, wsUrl}`). |
| `GET`    | `/sessions/:id`               | Inspect state (status, controlHolder, urls visited, idle timer).  |
| `DELETE` | `/sessions/:id`               | Terminate.                                                        |
| `POST`   | `/sessions/:id/navigate`      | Server-side navigation (URL allowlist enforced if configured).    |
| `POST`   | `/sessions/:id/control`       | Body: `{action: "grant"                                           | "release", to: "human" | "agent"}`. |
| `GET`    | `/sessions/:id/cookies`       | Extract cookies (server-only; never exposed to the React client). |
| `GET`    | `/sessions/:id/storage-state` | Full Playwright-format storage state.                             |
| `GET`    | `/healthz`, `/readyz`         | Operational probes.                                               |

### 5.3 WebSocket: `/sessions/:id/stream`

Client connects with `?token=<viewerToken>`. The token is short-lived (5 min default), single-use issuance, scoped to one session.

**Server → client messages**

```ts
type ServerMessage =
  | { t: "hello"; sessionId: string; control: ControlState; viewport: { w: number; h: number } }
  | { t: "frame"; seq: number; ts: number /* ms */; mime: "image/jpeg" } // followed by binary payload
  | { t: "control"; holder: "agent" | "human" | "idle"; reason?: string }
  | { t: "navigate"; url: string } // page-level navigation
  | { t: "title"; title: string }
  | { t: "favicon"; href: string | null }
  | { t: "cursor"; cursor: CSSCursor }
  | { t: "loading"; loading: boolean; progress?: number }
  | { t: "viewport"; w: number; h: number } // resize ack
  | { t: "error"; code: string; message: string }
  | { t: "bye"; reason: "destroyed" | "idle" | "evicted" | "error" };
```

Frames use a **two-frame pattern**: the JSON header arrives, the next binary message is its payload. This keeps JSON parsing cheap and avoids base64.

**Client → server messages**

```ts
type ClientMessage =
  | { t: "input"; kind: "mouse"; event: MouseEvent }
  | { t: "input"; kind: "key"; event: KeyEvent }
  | { t: "input"; kind: "wheel"; deltaX: number; deltaY: number; x: number; y: number }
  | { t: "input"; kind: "touch"; ... }                  // mobile emulation
  | { t: "ime"; text: string; isComposing: boolean }    // IME composition
  | { t: "resize"; w: number; h: number }
  | { t: "navigate"; url: string }                      // user typed a URL in the toolbar
  | { t: "back" } | { t: "forward" } | { t: "reload" }
  | { t: "request_control" }
  | { t: "release_control" }
  | { t: "ping" };
```

### 5.4 Control-state semantics

The server is the single source of truth for `control.holder`. Messages of kind `input` are silently dropped if the sender does not currently hold control.

- **Agent → human handoff** (typical credential entry): host app calls `POST /sessions/:id/control { action: "grant", to: "human" }`. Server publishes `control` message to all viewers; from this point input from the WebSocket viewer is forwarded to CDP. Agent input RPCs (server-side) are rejected.
- **Human → agent handoff** (after submission): client sends `release_control`, OR host app calls the HTTP endpoint. Either way, server flips state and publishes.
- **View-only sharing**: a session may be viewed by multiple WebSocket clients but only one input writer exists. Additional connections receive frames + control messages but their `input` messages are dropped.

### 5.5 Credential safety

When the focused element on the page is `input[type=password]`, the server does not log the raw key payload to access logs, BullMQ job histories, or telemetry. Detection:

- On every focus change, the worker queries `Runtime.evaluate document.activeElement` and reports the element type.
- The API server tags forwarded events with a `sensitive: true` flag while the focused element is a password field.
- Sensitive events are still forwarded to CDP (they have to be — the user is typing into the page) but never serialized to disk or shipped to log aggregators.

---

## 6. Backend middleware: `@atriumjs/express`

### 6.1 Public API

```ts
import express from "express";
import { atrium } from "@atriumjs/express";

const app = express();

app.use(
  "/atrium",
  atrium({
    redis: { url: process.env.REDIS_URL! },
    authorize: async (req) => {
      // Host-app responsibility. Return a tenant/user identifier or throw.
      const user = await myAuthLayer(req);
      return { tenantId: user.orgId, userId: user.id };
    },
    policies: {
      sessionTtlMs: 15 * 60_000,
      idleTtlMs: 5 * 60_000,
      maxConcurrentSessionsPerTenant: 5,
      urlAllowlist: ["*"], // or e.g. ["https://accounts.google.com/*"]
      defaultViewport: { w: 1280, h: 800 },
    },
    hooks: {
      onSessionCreated: async (s) => {
        /* analytics */
      },
      onCredentialsCollected: async (s, cookies) => {
        /* persist */
      },
    },
  }),
);
```

The middleware mounts:

- `POST   /sessions`
- `GET    /sessions/:id`
- `DELETE /sessions/:id`
- `POST   /sessions/:id/navigate`
- `POST   /sessions/:id/control`
- `GET    /sessions/:id/cookies`
- `GET    /sessions/:id/storage-state`
- `WS     /sessions/:id/stream`

The WebSocket handler can be attached either via Express's `upgrade` event or via the host's existing WS server (e.g., `ws`, `uWebSockets.js`). The middleware exports `attachWebSocket(httpServer)` for the second case.

### 6.2 Internal flow on `POST /sessions`

```
1. authorize(req) → { tenantId, userId }
2. Check tenant quota (Redis INCR + GET).
3. Generate sessionId (ULID).
4. Generate single-use viewerToken (32 random bytes, signed JWT, exp 5m).
5. Persist session record in Redis: status=pending, tenantId, userId, createdAt.
6. Enqueue BullMQ job in queue "atrium:sessions:create" with sessionId.
7. Wait (with timeout) for status transition to "ready" via Redis pub/sub.
8. Return { sessionId, viewerToken, wsUrl, expiresAt }.
```

If no worker accepts the job within `acceptTimeoutMs` (default 30s), return 503 and mark the session `failed`. The host app can retry.

### 6.3 WebSocket relay

The middleware does not run Chromium. It relays messages between the React client and the worker that owns the session. Two patterns are viable:

**A. Worker pushes to API (recommended).**
On startup, each worker opens an outbound WebSocket to a known internal API endpoint (`/internal/worker/connect`) authenticated with a shared secret. The API holds an in-memory map `sessionId → workerSocket`. When a client connects to `/sessions/:id/stream`, the API pipes between the two sockets.

Pros: workers can sit behind NAT; API endpoints are public. Cons: session can only be served by API nodes that hold the worker socket — requires sticky routing or a fan-out layer.

**B. API dials worker.**
The session record contains `workerUrl` (host:port). API node opens a WebSocket to the worker on demand.

Pros: any API node can serve any session. Cons: workers must be reachable on the API VPC.

I recommend **B for any non-trivial deployment** — the simplification at the API layer is significant. Workers run on a private network reachable from the API tier. Sticky routing complicates blue/green deploys and fails badly under autoscale events.

### 6.4 Auth model

The middleware itself does no user authentication. The `authorize(req)` hook is called on every HTTP request and on WebSocket upgrade. It returns a `Principal` ({tenantId, userId, scopes}) or throws.

For WebSocket connections, the `viewerToken` is a server-issued JWT that already encodes the principal — `authorize` is bypassed in favor of token verification. This avoids requiring the React client to carry the host app's session cookies into the WS upgrade (often cross-origin).

### 6.5 Stateless guarantees

The API tier holds:

- The worker socket map (pattern A only).
- Active client WS connections.

Both are local; nothing must be replicated across nodes for correctness. Any API node can be killed at any time; clients reconnect and the WS is re-established to the same worker via the session record in Redis.

---

## 7. Browser worker: `@atriumjs/worker`

### 7.1 Process model

One worker container runs:

- A **supervisor** process (Node.js) that consumes BullMQ jobs.
- Up to `WORKER_CAPACITY` concurrent **session subprocesses**, each owning one Chromium instance.
- A small **HTTP/WS server** for inbound API connections (pattern B above).

```
┌────────────────────── Worker container ──────────────────────┐
│                                                              │
│   ┌─────────────┐    ┌─────────────────────────────────┐    │
│   │ Supervisor  │───►│ Session 1: Chromium + CDP +     │    │
│   │ (BullMQ     │    │            screencast pump      │    │
│   │  consumer)  │    └─────────────────────────────────┘    │
│   │             │    ┌─────────────────────────────────┐    │
│   │             │───►│ Session 2: ...                  │    │
│   │             │    └─────────────────────────────────┘    │
│   │             │    ...                                     │
│   └──────┬──────┘                                            │
│          │                                                   │
│   ┌──────▼──────────┐                                       │
│   │ Inbound WS srv  │ ◄─── from API tier (pattern B)        │
│   └─────────────────┘                                        │
└──────────────────────────────────────────────────────────────┘
```

Each session subprocess is its own Node.js process for isolation: a Chromium crash, OOM, or CDP deadlock does not poison the supervisor or sibling sessions. IPC between supervisor and session uses a Unix socket carrying the same protocol used over the network — this lets sessions be "promoted" out-of-process without code changes.

### 7.2 BullMQ job shape

```ts
type CreateSessionJob = {
  sessionId: string;
  tenantId: string;
  userId: string;
  config: {
    viewport: { w: number; h: number };
    initialUrl?: string;
    storageState?: PlaywrightStorageState; // resume an authenticated session
    headful: boolean; // true when anti-bot evasion needed
    proxy?: { server: string; username?: string; password?: string };
    userAgent?: string;
    locale?: string;
    timezone?: string;
  };
  limits: {
    cpuShares: number; // relative CPU weight
    memoryMb: number; // hard RSS cap
    sessionTtlMs: number;
    idleTtlMs: number;
  };
};
```

Worker concurrency is set per-instance via `BullMQ.Worker({ concurrency: WORKER_CAPACITY })`. The worker only accepts jobs it can fit; otherwise it acks-and-fails-fast and BullMQ retries on another worker (see `acceptCheck` below).

### 7.3 Capacity control

Three knobs, evaluated in order on every job:

1. **Hard count cap**: `currentSessions < WORKER_CAPACITY` (env var, default 4).
2. **Memory cap**: `availableRssMb >= job.limits.memoryMb + safetyMarginMb`. We read `/proc/meminfo` and subtract reserved budget for active sessions.
3. **CPU pressure cap**: 1-minute load average / cpu count < `LOAD_THRESHOLD` (default 0.85). Reject if exceeded.

If any check fails, the worker calls `move-to-delayed` on the job with a small backoff so other workers can pick it up. After N rejections across the fleet, the API tier surfaces a `503 No capacity` and the host app can decide whether to wait or fail the user-facing flow.

### 7.4 Per-session resource enforcement

Container-level limits (set on the Docker run / K8s pod):

```dockerfile
# Run-time, not Dockerfile — illustrative
docker run \
  --memory=4g --memory-swap=4g \
  --cpus=2 \
  --pids-limit=512 \
  --shm-size=1g \
  --security-opt seccomp=chrome.json \
  atrium/worker:latest
```

Per-session limits inside the container:

- Each Chromium is launched with `--memory-pressure-off=false` and a `--js-flags='--max-old-space-size=<jobLimit*0.6>'`.
- The session subprocess is launched under `prlimit --as=<jobLimit*1.05MB>` to give the kernel a backstop.
- A watchdog samples each Chromium's RSS every 5s; on three consecutive samples over the cap, the session is killed with reason `oom_evicted` and the WS receives a `bye`.

CPU is governed by Linux's CFS via the container `--cpus`. Per-session CPU shares are set with `cpu.shares` writes via cgroups v2 (`cgcreate atrium/<sessionId>` then move the session pid). For most deployments, container-level limits + count cap is enough; per-session cgroup tuning is opt-in.

### 7.5 Chromium launch

```
Xvfb :99 -screen 0 ${VIEWPORT_W}x${VIEWPORT_H}x24 &
DISPLAY=:99 chromium \
  --remote-debugging-port=0 \                       # ephemeral; we read from stderr
  --remote-debugging-pipe \                          # safer than TCP
  --disable-dev-shm-usage \
  --no-sandbox \                                     # only inside seccomp-confined container
  --disable-gpu \
  --window-size=${VIEWPORT_W},${VIEWPORT_H} \
  --user-data-dir=/tmp/atrium/${SESSION_ID} \
  --proxy-server=${PROXY_SERVER:-} \
  --lang=${LOCALE:-en-US} \
  ${INITIAL_URL:-about:blank}
```

We use `--remote-debugging-pipe` (CDP over stdin/stdout) rather than a TCP port — it removes a network attack surface and avoids port allocation. Playwright is the orchestrator (it speaks pipe CDP natively and gives us context isolation, network interception, and `storage_state` for free).

For fingerprint resistance, default profile uses **headful Chromium under Xvfb** (passes the navigator.webdriver / Notification / chrome.runtime checks that headless-Chrome fails). A `headless: true` mode is available for low-stakes use (lower memory footprint).

### 7.6 Screencast pump

```ts
const cdp = await page.context().newCDPSession(page);
await cdp.send("Page.startScreencast", {
  format: "jpeg",
  quality: 70,
  maxWidth: viewport.w,
  maxHeight: viewport.h,
  everyNthFrame: 1,
});
cdp.on("Page.screencastFrame", async ({ data, sessionId, metadata }) => {
  // Backpressure: drop frames if WS buffer is too full.
  if (ws.bufferedAmount > BACKPRESSURE_BYTES) {
    await cdp.send("Page.screencastFrameAck", { sessionId });
    return;
  }
  ws.send(jsonHeader({ t: "frame", seq: nextSeq(), ts: Date.now(), mime: "image/jpeg" }));
  ws.send(Buffer.from(data, "base64"));
  await cdp.send("Page.screencastFrameAck", { sessionId });
});
```

Quality and `everyNthFrame` are tuned per session (see §9). Default 12 fps, q=70.

### 7.7 Input dispatch

```ts
function onClientInput(msg: ClientMessage) {
  if (!hasWriterLock(msg.from)) return; // server-authoritative
  switch (msg.kind) {
    case "mouse":
      cdp.send("Input.dispatchMouseEvent", normalizeMouse(msg.event));
      break;
    case "key":
      // Sensitive-field handling: do not log msg.event.text if focusedIsPassword.
      cdp.send("Input.dispatchKeyEvent", normalizeKey(msg.event));
      break;
    case "wheel":
      cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", ...msg });
      break;
    case "ime":
      cdp.send("Input.insertText", { text: msg.text });
      break;
  }
}
```

Mouse coordinate normalization handles client-side viewport scaling (canvas may be smaller than CDP viewport). Modifier-key state is tracked server-side to avoid relying on client-reported flags.

### 7.8 Cookie / storage extraction

`GET /sessions/:id/cookies` → API forwards to worker → worker calls `context.cookies()` and returns. Same for `storage-state` → `context.storageState()`.

Critically: cookies are **never** sent over the viewer WebSocket. They are only available via the host-authenticated HTTP endpoint. The React client cannot ask for them.

### 7.9 Health and lifecycle

The supervisor publishes a heartbeat to Redis every 5 seconds:

```
SETEX atrium:workers:<workerId> 15 {
  capacity, inUse, freeMb, loadAvg, version, startedAt
}
```

The API tier's allocator reads this when deciding whether to spread or pack jobs. Workers gracefully drain on `SIGTERM`: stop accepting jobs, finish in-flight sessions up to their idle TTL or 60s, then terminate.

### 7.10 Dockerfile (sketch)

```dockerfile
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y \
    chromium fonts-liberation fonts-noto-color-emoji \
    xvfb dbus dbus-x11 libnss3 libgconf-2-4 \
    procps tini ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV CHROME_PATH=/usr/bin/chromium

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile
COPY dist/ ./dist/
COPY docker/worker/entrypoint.sh /entrypoint.sh

EXPOSE 7070
ENV WORKER_CAPACITY=4 \
    REDIS_URL=redis://redis:6379 \
    NODE_ENV=production
USER 1000:1000
ENTRYPOINT ["/usr/bin/tini","--","/entrypoint.sh"]
```

`entrypoint.sh` starts Xvfb, then `node dist/worker.js`. The image runs as a non-root user; Chromium's setuid sandbox is disabled (we rely on container-level seccomp + user namespace remapping instead).

---

## 8. React client: `@atriumjs/react`

### 8.1 Public API

```tsx
import { RemoteBrowser, useSession } from "@atriumjs/react";

function MyAuthFlow({ session }) {
  return (
    <RemoteBrowser
      sessionId={session.id}
      viewerToken={session.viewerToken}
      wsUrl={session.wsUrl}
      onControlChange={(holder) => console.log("now controlled by", holder)}
      onTerminated={(reason) => console.log("session ended:", reason)}
      onNavigate={(url) => console.log("page navigated to", url)}
      style={{ width: 1280, height: 900 }}
    />
  );
}
```

The component renders the page canvas; optional presets add a toolbar (back/forward/reload), read-only URL bar, and tab strip. A small session status line can be toggled separately (`showSessionStatus`).

### 8.2 Hook for advanced layouts

```tsx
const {
  status, // "connecting" | "ready" | "active" | "terminated"
  controlHolder, // "agent" | "human" | "idle"
  url, // current page URL
  title, // current page title
  loading, // boolean
  requestControl, // () => void
  releaseControl, // () => void
  navigate, // (url: string) => void
  back,
  forward,
  reload,
  canvasRef, // attach to <canvas>
  inputProps, // spread onto a focusable wrapper for input capture
} = useSession({ sessionId, viewerToken, wsUrl });
```

This lets consumers build custom UIs (no toolbar, embedded in a modal, etc.) while still getting wire-protocol handling and frame rendering.

### 8.3 Frame rendering

Two strategies; the library ships with both and chooses based on benchmark:

**Strategy A — `<img>` with object URLs.** Simple and surprisingly fast at 12–15fps. Memory churn from URL revoke is the main risk; we use a 2-frame ping-pong buffer.

**Strategy B — `<canvas>` + `createImageBitmap`.** Better for >20fps and gives us hooks for client-side post-processing (e.g., a "loading" overlay during navigation).

We default to B; on browsers that show jank, fall back to A.

### 8.4 Input capture

Wrapping the canvas in a focusable `<div tabIndex={0} onKeyDown onMouseMove onPointerDown ...>` and translating events to wire format. Key things:

- **Coordinate scaling**: client canvas size may differ from server viewport. All coordinates are scaled at the boundary. Server is the source of truth for viewport size.
- **Pointer capture**: `setPointerCapture` on mousedown so drags work even when the cursor leaves the canvas.
- **Key repeat**: forward `keydown` with auto-repeat suppression on the wire (client-side dedupe for held keys is unreliable; server-side timer is more predictable).
- **IME composition**: bind `compositionstart/update/end` separately and forward the final text via `Input.insertText` rather than synthesizing keydowns.
- **Clipboard paste**: capture `paste` events, send the text via `Input.insertText`. Clipboard read access is gated by browser permissions and is handled gracefully if denied.
- **Focus tracking**: on `blur` the client sends a `release_input_focus` so stuck modifier keys can be cleared server-side.

### 8.5 Optional embedded-browser chrome

The shipped **`@atriumjs/react`** viewer uses a neutral, Chrome-_like_ layout (not a Google trademark) so users feel comfortable typing credentials. **Implemented today:** back / forward / reload, read-only URL bar (`navigate` / `title` messages), tab strip when the worker emits **`tabs`**, optional session status line, and presets **`none` / `minimal` / `full`** plus per-flag overrides (see [`packages/react/README.md`](../packages/react/README.md)).

**Target / incremental polish** (design intent; not all are in the default UI yet):

- Lock / not-secure affordance in the URL bar (derive from URL + wire messages).
- Loading progress from `loading` messages.
- A dedicated **control** pill (“Agent typing…” / “Your turn”) — today, apps can use `onControlChange` + `showSessionStatus` or wrap the canvas.
- When `controlHolder === "agent"`, disable pointer events on the canvas and show an explicit overlay (host-specific copy is recommended).

### 8.6 Reconnect behavior

WebSocket disconnects are common (network blip, API node restart, etc.). The client retries with exponential backoff up to a cap. The session itself survives — on reconnect, the server replays the last `hello + control + viewport + url + title` messages so the UI snaps back to current state. Frames resume on the next `Page.screencastFrame`.

If reconnect fails for >30s, we surface a "Lost connection" banner with a manual retry button. After 2 minutes, we treat the session as terminated.

---

## 9. Resource management and scaling

### 9.1 Capacity model

Each worker advertises:

- `capacity` (concurrent session slots; bounded by `WORKER_CAPACITY` env var).
- `freeMb`, `loadAvg`, `inUse` (live).

The API tier's allocator picks workers in this order:

1. **Best-fit by memory**: smallest free worker that still fits the requested limits. Reduces fragmentation.
2. **Tie-break by load average**: lower wins.
3. **Random shuffle on ties** to spread heat.

This is encoded as a Lua script run against Redis to avoid races between API nodes.

### 9.2 Per-session frame-rate adaptation

Server tracks `ws.bufferedAmount` and downstream RTT. If buffered bytes exceed threshold for 1s:

- Reduce `everyNthFrame` (e.g., 1 → 2 → 3).
- Reduce `quality` (70 → 55 → 40).

Recovery raises both back over 5s. This is the same pattern WebRTC uses for ABR but vastly simpler since we control both ends and the codec is JPEG.

### 9.3 Eviction policy

Sessions are evicted on:

- Idle TTL exceeded (default 5 min with no input from the writer).
- Hard session TTL exceeded (default 15 min total).
- Worker memory pressure (hard cap hit).
- Client disconnect with no reconnect within 60s **and** no agent-side activity.

Eviction sends `bye` to all viewers, fires `onTerminated` hook, then frees the slot.

### 9.4 Scaling

API tier: scale on CPU like any Express app. Stateless.

Worker tier: scale on **average inUse / capacity ratio** across the fleet. Target ~70%. Burst capacity is provided by short-lived spot instances; long-lived sessions are scheduled onto stable nodes via a pool labeling hint passed in the BullMQ job.

Redis: single-master is enough for moderate fleets (<100 workers). Beyond that, BullMQ supports Redis Cluster.

---

## 10. Security model

### 10.1 Threat model

Adversaries we care about:

- **Malicious target site** trying to exfiltrate credentials, escape the browser, or reach the worker host.
- **Compromised host application** (out of scope for this lib but informs the API).
- **Eavesdropping operators** (us; the library should make it hard to accidentally log credentials).

Out of scope: nation-state attackers with kernel exploits; insider threats with worker host access.

### 10.2 Container hardening

- Non-root user inside the container.
- `--no-new-privileges`, `--cap-drop=ALL`, custom seccomp profile (Chrome's published `chrome.json` is a good base).
- Read-only root filesystem; tmpfs for `/tmp` and the user-data-dir.
- No bind mounts from host.
- User namespace remapping (Docker `userns-remap` or rootless mode).
- Egress firewall: workers may reach only the proxy server (if configured) and Redis. No metadata service access (block 169.254.169.254 explicitly).

### 10.3 Credential safety

- **Logs**: API server logs the message `t` and timestamp, not the body, for `input` messages while `sensitive` is set. Workers never persist input events.
- **BullMQ job results**: do not include cookies/storage state in `returnValue`. Workers expose them only via the on-demand HTTP endpoint authenticated by the API.
- **Memory dumps**: in production, disable core dumps (`ulimit -c 0`). Coredumps may contain in-flight password keystrokes.
- **Network capture**: TLS everywhere. Worker ↔ API uses mTLS in cluster deployments.

### 10.4 Token model

- `viewerToken`: short-lived (5m), single-use issuance, scoped to `sessionId + tenantId`. Issued by API, verified by API on WS upgrade. Worker does not see it.
- Worker auth to API uses a long-lived **per-worker mTLS cert** issued at provision time (or an HMAC-signed bearer token in lower-security setups).

### 10.5 URL allowlist

Optional but strongly recommended for production deployments doing credential collection. The host app declares `policies.urlAllowlist`. Server-driven `navigate` is enforced; user-typed URLs in the toolbar are also checked. This is your defense against phishing via a compromised initial URL: even if an attacker convinces the host app to spawn a session pointing at `evil.com`, the user's credentials don't reach `accounts.google.com` — but they don't reach `evil.com` either if the allowlist is set right.

Note: allowlisting cannot prevent an authenticated user from being redirected mid-flow. This is fundamental — the page itself can navigate and we can only block top-level navigations server-side, not arbitrary in-page mutations. Pair allowlisting with timing limits and human review of cookies before they're persisted.

---

## 11. Deployment

### 11.1 Local development

`docker-compose.yml` ships with the repo:

```yaml
services:
  redis:
    image: redis:7-alpine
  worker:
    image: atrium/worker:dev
    depends_on: [redis]
    environment:
      REDIS_URL: redis://redis:6379
      WORKER_CAPACITY: "2"
    deploy:
      resources:
        limits: { cpus: "2", memory: 4g }
  example-host:
    build: ./examples/express-host
    ports: ["3000:3000"]
    depends_on: [redis]
    environment:
      REDIS_URL: redis://redis:6379
```

`pnpm dev` brings everything up. The example host serves the React demo at `localhost:3000` with a "Start session" button.

### 11.2 Production

Recommended footprint for a small team starting out:

- **API**: 2× small nodes (2 vCPU, 4 GB) behind an ALB. Stateless.
- **Workers**: N× medium nodes (8 vCPU, 16 GB). `WORKER_CAPACITY=4` per node → 16 GB / 4 = 4 GB per session. Headroom for spikes.
- **Redis**: managed (Elasticache / Upstash / equivalent). 1 GB is enough until 100+ workers.
- **Object storage** (optional): S3/GCS bucket for `storage_state` snapshots if your host app wants to persist authenticated sessions.

Kubernetes deploys are straightforward — workers as a `Deployment` with HPA on a custom metric (`atrium_inuse_ratio` exported by each worker), API as a `Deployment` with HPA on CPU.

---

## 12. Open decision points

These are deliberately left for the implementation team to decide based on context. Each has a recommended default but warrants discussion before v1.

| #   | Decision                                                                | Recommended default                 | Tradeoff                                                                                                        |
| --- | ----------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | API ↔ Worker pattern (push vs dial)                                     | Dial (B)                            | A is simpler at one node; B scales cleaner.                                                                     |
| 2   | Browser orchestrator (Playwright vs raw CDP)                            | Playwright                          | Playwright adds a dep but gives us context isolation, `storage_state`, network interception. Raw CDP is leaner. |
| 3   | Storage backend beyond Redis                                            | None in v1                          | If we add session history / audit logs, we'll need Postgres. Defer.                                             |
| 4   | Multi-viewer support                                                    | Yes, view-only extras allowed       | Useful for support flows; minor complexity.                                                                     |
| 5   | Mobile emulation                                                        | Out of scope for v1                 | Touch-event mapping is non-trivial; defer.                                                                      |
| 6   | Anti-bot stealth tooling (puppeteer-extra-plugin-stealth-style patches) | Off by default, opt-in flag         | Stealth patches are an arms race; default to clean Chromium.                                                    |
| 7   | Built-in URL allowlist UI in client                                     | No                                  | Allowlisting is a server policy; surfacing in UI muddies the model.                                             |
| 8   | Frame transport upgrade path to WebRTC                                  | Plan v2 hook, not v1 implementation | Future-proofing the protocol so we can swap transports without breaking clients.                                |

---

## 13. Roadmap (suggested)

**v0.1 — Walking skeleton (2–3 weeks)**

- Single worker, no BullMQ (just direct WS).
- One Chromium per worker.
- React client with basic toolbar and canvas rendering.
- Manual handoff via host-side button.

**v0.2 — Scale path (2–3 weeks)**

- BullMQ queue + multi-worker.
- Capacity allocator.
- Reconnect handling.
- `storage_state` resume.
- Docker image published.

**v0.3 — Production-ready (3–4 weeks)**

- Resource caps wired (memory watchdog, CPU shares).
- Credential-safety logging path.
- mTLS API↔worker.
- URL allowlist enforcement.
- Frame-rate adaptation.

**v0.4 — Polish (2 weeks)**

- IME, paste, key repeat edge cases.
- Multi-viewer support.
- Observability (Prometheus metrics, OpenTelemetry traces).
- Docs site, example apps.

**v1.0** — API freeze and a real release.

---

## Appendix A: TypeScript types (excerpt)

```ts
// @atriumjs/protocol

export type ControlState = {
  holder: "agent" | "human" | "idle";
  since: number;
};

export type SessionStatus = "pending" | "ready" | "active" | "terminated" | "failed";

export type SessionSummary = {
  id: string;
  status: SessionStatus;
  control: ControlState;
  url: string;
  title: string;
  viewport: { w: number; h: number };
  createdAt: number;
  expiresAt: number;
  workerId?: string;
};

export type ServerMessage =
  | { t: "hello"; sessionId: string; control: ControlState; viewport: { w: number; h: number } }
  | { t: "frame"; seq: number; ts: number; mime: "image/jpeg" }
  | { t: "control"; holder: "agent" | "human" | "idle"; reason?: string }
  | { t: "navigate"; url: string }
  | { t: "title"; title: string }
  | { t: "favicon"; href: string | null }
  | { t: "cursor"; cursor: string }
  | { t: "loading"; loading: boolean; progress?: number }
  | { t: "viewport"; w: number; h: number }
  | { t: "error"; code: string; message: string }
  | { t: "bye"; reason: "destroyed" | "idle" | "evicted" | "error" };

export type ClientMessage =
  | { t: "input"; kind: "mouse"; event: MouseInputEvent }
  | { t: "input"; kind: "key"; event: KeyInputEvent }
  | { t: "input"; kind: "wheel"; deltaX: number; deltaY: number; x: number; y: number }
  | { t: "ime"; text: string; isComposing: boolean }
  | { t: "resize"; w: number; h: number }
  | { t: "navigate"; url: string }
  | { t: "back" }
  | { t: "forward" }
  | { t: "reload" }
  | { t: "request_control" }
  | { t: "release_control" }
  | { t: "ping" };
```
