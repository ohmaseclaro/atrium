# Sprint 1 — contract

## In scope

- `@ohmaseclaro/atrium-protocol` wire types.
- `@ohmaseclaro/atrium-server` Express router, dial relay, replay buffer, skeleton HTTP table.
- `@ohmaseclaro/atrium-react` viewer component.
- `@ohmaseclaro/atrium-demo` and `examples/express-host`.

## Out of scope

- BullMQ scheduling.
- Multi-worker allocator.
- mTLS client certificates.

## Evidence matrix

| Contract item | Required evidence                                  |
| ------------- | -------------------------------------------------- |
| Session API   | Vitest middleware suite plus README curl snippets  |
| Dial relay    | Vitest integration test with mock worker WebSocket |

## Evaluator checklist

- [ ] `pnpm test` passes on clean checkout.
- [ ] `pnpm demo` shows frames after session create with local worker.

## Agreement status

approved
