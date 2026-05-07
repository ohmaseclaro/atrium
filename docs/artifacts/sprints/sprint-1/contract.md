# Sprint 1 — contract

## In scope

- `@atriumjs/atrium-protocol` wire types.
- `@atriumjs/atrium-server` Express router, dial relay, replay buffer, skeleton HTTP table.
- `@atriumjs/atrium-react` viewer component.
- `@atriumjs/atrium-demo` and `examples/express-host`.

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
