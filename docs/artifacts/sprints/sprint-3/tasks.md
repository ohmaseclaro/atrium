# Sprint 3 — tasks

### T1: URL allowlist enforcement on navigate

- **Done when:** `POST /sessions/:id/navigate` rejects URLs outside `policies.urlAllowlist` with HTTP 400 and stable JSON `{ error: "url_not_allowed" }`.
- **Evidence required:** Vitest `url-allowlist.test.ts` and `middleware.test.ts` negative case.
- **Dependencies:** (none)
- **Risk notes:** (none)

### T2: Adaptive screencast under backpressure

- **Done when:** Worker acknowledges frames without sending JPEG when `bufferedAmount` is high and retunes `Page.startScreencast` at a bounded rate when crossing thresholds.
- **Evidence required:** Code review notes pointing at `Page.screencastFrame` handler.
- **Dependencies:** (none)
- **Risk notes:** Frequent `stopScreencast` could hurt FPS — throttled with timestamps.

### T3: Optional TLS and memory soft cap

- **Done when:** `AtriumConfig.workerTls` forwards to upstream `WebSocket`; `WorkerServerOptions.memorySoftCapBytes` enables periodic eviction of the oldest session when heap exceeds cap.
- **Evidence required:** `packages/server/src/types.ts` and worker options documented in README.
- **Dependencies:** (none)
- **Risk notes:** Soft cap is process-level heuristic, not per-session cgroup.
