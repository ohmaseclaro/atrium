# Progress

## Current sprint

**3** — production readiness (policy, adaptive media, TLS knob, memory hook).

## Completed work

- Sprint 1: protocol Zod types; Express `POST/GET/DELETE /sessions`; viewer dial relay; React `RemoteBrowser`; demo app; example Express host; security notes in README.
- Sprint 1b: `POST /sessions/:id/control`; `POST .../navigate` with allowlist; `GET .../cookies` and `.../storage-state` proxying to worker internal HTTP; session summary includes `status`, `control`, `currentUrl`; **replay ring** on API relay.
- Sprint 2: worker **internal HTTP** on same server as WS; **Playwright session registry** per `sessionId`; destroy on viewer close; Dockerfile remains for worker image.
- Sprint 3: **urlAllowed** helper and tests; **adaptive screencast** (skip + throttled retune); **`workerTls`** on upstream `WebSocket`; **`memorySoftCapBytes`** with periodic eviction of oldest session.

## Pending work

- BullMQ `session-create` queue, worker consumers, and Redis **allocator** script for multi-worker fleets.
- Password-field **credential redaction** in logs (focus detection + tagged sensitive spans).
- **mTLS client certificates** for API→worker dial (beyond `rejectUnauthorized`).

## Decisions

- In-memory session store remains default to keep CI simple; a future milestone may add Redis-backed session persistence without changing public route shapes.

## Risks

- BullMQ rollout increases operational complexity (Redis ACLs, queue monitoring, poison messages).

## Next step

Prototype BullMQ session bootstrap behind `ATRIUM_USE_SESSION_QUEUE=1` with a single-queue happy path and feature-flagged API wait.

## Handoff notes

(none)
