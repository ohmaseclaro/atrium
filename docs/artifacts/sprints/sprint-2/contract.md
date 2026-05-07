# Sprint 2 — contract

## In scope

- Worker internal REST for navigate, cookies, and storage state.
- Shared Playwright runtime per session on the worker.
- Docker worker image (existing `docker/worker/Dockerfile`).

## Out of scope

- BullMQ consumer embedded in `@atriumjs/atrium-server` for this milestone.
- Redis cluster hardening.

## Evidence matrix

| Contract item          | Required evidence                         |
| ---------------------- | ----------------------------------------- |
| Internal worker routes | `curl` with bearer against running worker |

## Evaluator checklist

- [ ] `POST .../navigate` updates the active tab for an existing session.
- [ ] `GET .../cookies` returns a JSON array for an active session.

## Agreement status

approved
