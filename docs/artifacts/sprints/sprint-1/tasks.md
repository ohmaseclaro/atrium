# Sprint 1 — tasks

### T1: Protocol schemas for wire messages

- **Done when:** Zod schemas cover server and client envelopes used by the skeleton and `pnpm build` for `@atriumjs/atrium-protocol` is clean.
- **Evidence required:** Vitest `packages/protocol/src/index.test.ts` green.
- **Dependencies:** (none)
- **Risk notes:** (none)

### T2: Express routes for session lifecycle

- **Done when:** `POST/GET/DELETE /sessions`, `POST .../control`, `POST .../navigate`, `GET .../cookies`, `GET .../storage-state`, and health probes exist with `authorize` enforced on mutating HTTP routes.
- **Evidence required:** Vitest `middleware.test.ts` and `url-allowlist.test.ts`.
- **Dependencies:** T1
- **Risk notes:** (none)

### T3: Viewer WebSocket relay with replay buffer

- **Done when:** API dials the worker stream socket, copies JSON and binary frames, and appends allowlisted JSON types into a bounded per-session replay ring; new viewer connections receive `peekReplay` before piping.
- **Evidence required:** Vitest relay integration test with mock worker.
- **Dependencies:** T2
- **Risk notes:** (none)
