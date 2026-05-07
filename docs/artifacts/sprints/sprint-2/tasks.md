# Sprint 2 — tasks

### T1: Worker internal HTTP for navigate, cookies, storage-state

- **Done when:** Same HTTP server as WS upgrade serves `GET/POST` internal routes authenticated with bearer secret and backed by the active Playwright `BrowserContext`.
- **Evidence required:** Live worker smoke: `curl` internal routes after session stream starts (documented in README).
- **Dependencies:** (none)
- **Risk notes:** Session must exist before cookies calls — document 404 behaviour.

### T2: Session registry with destroy on viewer close

- **Done when:** `sessions` map owns one runtime per `sessionId`; viewer socket `close` destroys Playwright resources so the next stream attach recreates cleanly.
- **Evidence required:** Code review of `packages/worker/src/index.ts`.
- **Dependencies:** T1
- **Risk notes:** (none)

### T3: Document BullMQ plus allocator follow-up

- **Done when:** `docs/artifacts/progress.md` lists BullMQ allocator as explicit pending work with next engineering step.
- **Evidence required:** This file and `progress.md` cross-link.
- **Dependencies:** (none)
- **Risk notes:** (none)
