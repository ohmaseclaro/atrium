# Sprint 3 — contract

## In scope

- Navigate allowlist enforcement on the API tier.
- Adaptive JPEG tuning and frame drop under WebSocket backpressure.
- Optional `workerTls` for the API→worker dial.
- Optional worker memory soft-cap eviction.

## Out of scope

- Full per-session cgroup v2 enforcement.
- Packaged SOC2 evidence.

## Evidence matrix

| Contract item | Required evidence                         |
| ------------- | ----------------------------------------- |
| Allowlist     | Automated middleware test for blocked URL |

## Evaluator checklist

- [ ] Disallowed navigate returns HTTP 400.
- [ ] `workerTls` appears on `AtriumConfig` and is passed into the upstream `WebSocket` constructor.

## Agreement status

approved
