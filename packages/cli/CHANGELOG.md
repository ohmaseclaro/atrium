# @atriumjs/cli

## 0.3.0

### Minor Changes

- 65e83e0: First public minor release of the Atrium remote-browser stack across all six packages. Run `pnpm exec changeset version` to bump every package to **0.3.0** and produce a changelog before tagging.

  ### Security
  - **Tenant-scoped session authorization** — every per-session HTTP route re-checks `Principal.tenantId` against the session's owner before returning state, cookies, control transfer, or termination. Cross-tenant lookups now 403/404.
  - **`publicBaseUrl` defense** — viewer WebSocket URLs and transport offers are derived from a configured `publicBaseUrl` (when present) instead of the request `Host` header. Removes a token-phishing path behind reverse proxies.
  - **Timing-safe credential compare** — `ATRIUM_WORKER_SECRET` and viewer-token comparisons go through `crypto.timingSafeEqual`.
  - **URL allowlist enforced on viewer-driven navigation** — `navigate` messages received over the viewer WebSocket and `POST /sessions/:id/stream/input` are validated against `policies.urlAllowlist` before relaying to the worker. Viewers can no longer bypass the allowlist via the WebSocket.

  ### Server engine (`@atriumjs/core`, `@atriumjs/express`)
  - `AtriumPolicies` enforcement is real: `maxConcurrentSessionsPerTenant` returns `429`; `sessionTtlMs` and `idleTtlMs` are enforced by an in-process janitor on `MemorySessionStore` (`createAtrium()` returns a `dispose()` to stop it cleanly); `defaultViewport` is injected into the worker bootstrap when no viewport is supplied.
  - Default `transports` is `["ws"]` (configurable via `policies.transports`). Multi-transport advertising removed because the worker has a single sink WebSocket per session.
  - SSE upstream WebSocket is closed on viewer disconnect (no more leaked Reader); 10s connect-phase timeout on upstream dials.
  - Express middleware now streams `text/event-stream` responses through `Readable.fromWeb` instead of buffering, so SSE delivers each event in real time.
  - `pollQueues` ownership moved into `MemorySessionStore` so they're cleaned up automatically on session delete.
  - Module-level `WebSocketServer({ noServer: true })` reused across upgrades.
  - New tests: `dispatch.test.ts`, `memory-session-store.test.ts`, `janitor.test.ts`, `streaming.test.ts`, `url-allowlist.test.ts`.

  ### Worker (`@atriumjs/worker`)
  - New WebSocket handlers for `navigate`, `request_control`, `release_control` so the React imperative API works end-to-end.
  - `playwright`, `playwright-extra`, and `puppeteer-extra-plugin-stealth` are now `peerDependencies` (required) so consumers control versions and avoid duplicate Playwright installs.

  ### React UI (`@atriumjs/react`)
  - Automatic reconnect with replay and 20s ping/pong heartbeat; intentional close is per-socket-tagged so a new socket's failure can never be misread as intentional.
  - Imperative handle: `reconnect`, `navigate`, `back`, `forward`, `reload`, `requestControl`, `releaseControl`.
  - IME composition forwarded as `t: "ime"`; `keydown`/`keyup` are gated on `isComposing` so CJK no longer double-fires.
  - Held modifiers flushed on `blur` / `visibilitychange` / `pointercancel` (no more stuck Cmd after Cmd-Tab).
  - Wheel deltas scaled to the remote viewport with `deltaMode` (line / page units) normalized per axis.
  - Right-click `contextmenu` is prevented on the canvas.
  - `cursor`, `favicon`, and `loading` server messages now drive UI: cursor mirrors to `canvas.style.cursor`, favicon renders next to URL bar and active tab, an animated loading bar appears at the top of the stage.
  - Server-authoritative control pill rendered inside the stream (independent of chrome preset) plus a screen-reader live region; both gated on `status === "live"` so pre-`hello` doesn't lie.
  - Tab strip a11y: roving tabindex, manual activation pattern, ArrowLeft/Right/Home/End move focus, Enter/Space activates, Delete closes.
  - Frame decode revokes `URL.createObjectURL` in `finally` and on `onerror`.
  - `onError` prop fires on parse failures, image-decode errors, clipboard failures, and reconnect exhaustion.
  - `sendWs` is fully typed against `ClientMessage`; `useRemoteBrowserSession` tuple memoized.
  - Added `react-dom` peer dependency.

  ### Packaging / CI
  - All six public packages now ship with `publishConfig.provenance: true`, an `./package.json` subpath export for bundlers that need it, and `prepublishOnly` hooks that build before publish.
  - Cross-platform `rimraf` replaces `rm -rf` in build scripts.
  - `npm-publish.yml` uses `changesets/action@v1` on tag push / release publish, with provenance-enabled fallback for manual `workflow_dispatch`.
  - Worker Dockerfile copies `pnpm-lock.yaml` and runs `pnpm install --frozen-lockfile`.
  - `@atriumjs/express` README and `.env.example` cleaned of stale `redis:` references.
