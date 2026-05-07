# Product specification (Atrium)

## Product objective

Ship Atrium as an MIT-licensed monorepo: remote Chromium sessions with human handoff, API-initiated worker WebSockets (**dial**), **Playwright**-driven browsers with CDP JPEG screencast, Express middleware for session lifecycle, internal worker HTTP for **navigate / cookies / storage_state**, **URL allowlist** enforcement, **viewer reconnect replay** of recent JSON frames, **adaptive JPEG** under WebSocket backpressure, optional **TLS** options on the dial, and a **memory soft-cap** eviction hook on the worker.

## User stories

- As a backend engineer, I can mount Express middleware that creates sessions, relays viewer WebSockets to the worker, enforces **navigate allowlists**, exposes **control** handoff, and returns **cookies** and **storage_state** over authenticated HTTP only.
- As a frontend engineer, I can embed `RemoteBrowser` and rely on the API to **replay** recent `hello` / `control` / `navigate` JSON after reconnects.
- As a platform engineer, I can tune worker **memory soft caps** and observe **JPEG quality** adapt when viewer sockets back up.

## Constraints

- Public MIT source; no committed production secrets.
- Cookies and `storage_state` are **never** returned on the viewer WebSocket; only on host-authenticated HTTP routes.
- Node 20+ and pnpm workspaces are the supported developer toolchain.

## Assumptions

- Host applications supply `authorize(req)` for HTTP routes.
- Workers are reachable from API nodes for dial mode and internal HTTP on the same port as the WS upgrade server.

## Architecture notes

- **API** opens outbound WebSockets to `${workerDialBase}/internal/stream/:sessionId` and copies frames bidirectionally while recording a bounded ring of JSON text frames for reconnect replay.
- **Worker** keeps a `sessions` map of Playwright runtimes; **GET/POST** ` /internal/session/:id/{cookies,storage-state,navigate}` share that runtime.
- **Adaptive JPEG** restarts `Page.startScreencast` when quality or `everyNthFrame` changes; frames are dropped (acked only) when `bufferedAmount` is very high.

## Dependency notes

Express 4, ws 8, Playwright 1.49, Zod 3, React 18, Vitest 3, ESLint 9 flat config, Prettier 3.

## Non-goals

- BullMQ fleet allocator and multi-worker Lua selection (tracked as `progress.pendingWork`).
- Hosted SaaS identity, billing, or managed browser farms inside this repository.

## Test strategy

- `pnpm test` — Vitest projects for `@atrium/protocol`, `@atrium/server`, `@atrium/worker`, `@atrium/react`.
- `pnpm lint` — ESLint on the monorepo, Prettier `--check`, recursive `tsc --noEmit`.

## Rollout

(none for OSS skeleton)

## Rollback

Revert Git tag or redeploy prior worker and API images; session state is ephemeral by default.

## Definition of done

All sprint contract **in-scope** items are implemented or explicitly listed under **pendingWork** with an owner and next step; `pnpm lint`, `pnpm test`, and `pnpm build` succeed on a clean checkout.
