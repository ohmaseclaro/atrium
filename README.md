# Atrium

**Atrium** is an open-source toolkit for **remote Chromium sessions** where a host application can **hand control to a human** (OAuth, captchas, MFA), then resume automation and capture cookies or Playwright `storage_state` — without shipping raw CDP plumbing to your UI layer.

This repository is a **pnpm monorepo** (`packages/*`) implementing the architecture described in [`docs/remote-browser-design.md`](docs/remote-browser-design.md).

## Architecture choices (locked for this codebase)

| Topic | Choice | Why |
| --- | --- | --- |
| API ↔ worker transport | **Dial** (API opens WebSocket to worker) | Stateless API tier; any node can serve a session after reading `workerDialBase` from config. |
| Browser automation | **Playwright** | Context isolation, `storage_state`, and a supported path to CDP features (for example `Page.startScreencast` via `newCDPSession`) without maintaining a bespoke CDP client. |
| Frame transport | **CDP screencast JPEG** over WebSocket | Two-frame pattern: JSON metadata, then binary JPEG (see `@atrium/protocol`). |

## Packages

| Package | Role |
| --- | --- |
| [`@atrium/protocol`](packages/protocol) | Shared Zod schemas and TypeScript types for WebSocket messages. |
| [`@atrium/server`](packages/server) | Express router + viewer upgrade handler; **dials** the worker backplane with `Authorization: Bearer …`. |
| [`@atrium/worker`](packages/worker) | Inbound WebSocket server; launches Chromium with **Playwright** and pumps screencast frames. |
| [`@atrium/react`](packages/react) | Minimal `<RemoteBrowser />` viewer (canvas + connection state). |
| [`@atrium/cli`](packages/cli) | Placeholder developer entrypoint (`atrium doctor`). |

## Quick start (local)

1. **Install dependencies**

   ```bash
   pnpm install
   pnpm build
   ```

2. **Run the worker** (Chromium via Playwright)

   ```bash
   export ATRIUM_WORKER_SECRET=dev-secret-change-me
   pnpm --filter @atrium/worker start
   ```

   For CI or laptops without browsers installed:

   ```bash
   ATRIUM_WORKER_DRY=1 pnpm --filter @atrium/worker start
   ```

   For real Chromium, install browsers once:

   ```bash
   pnpm exec playwright install chromium
   ```

3. **Run the example Express host** (separate terminal)

   ```bash
   export ATRIUM_WORKER_SECRET=dev-secret-change-me
   export ATRIUM_WORKER_DIAL_BASE=ws://127.0.0.1:7070
   pnpm --filter @atrium/example-express-host dev
   ```

4. **Create a session**

   ```bash
   curl -s -X POST http://localhost:3000/atrium/sessions \
     -H 'content-type: application/json' \
     -d '{}' | jq .
   ```

   Use the returned `wsUrl` and `viewerToken` (`?token=…`) from a WebSocket client or the React viewer.

## Docker (worker)

From the repository root:

```bash
docker build -f docker/worker/Dockerfile -t atrium-worker:local .
docker run --rm -p 7070:7070 \
  -e ATRIUM_WORKER_SECRET=replace-me \
  atrium-worker:local
```

The image extends [`mcr.microsoft.com/playwright`](https://playwright.dev/docs/docker) so Chromium is available in-container.

## Security notes (public-facing deployments)

- Rotate **`ATRIUM_WORKER_SECRET`** and protect the worker network so only your API can dial `ws://…/internal/stream/:sessionId`.
- **Viewer tokens** are short-lived; treat them like capability URLs.
- Cookies and `storage_state` must stay on **host-authenticated HTTP** endpoints (not yet fully implemented in this skeleton — see the design doc).

## License

MIT — see [`LICENSE`](LICENSE).

## Contributing

Issues and PRs are welcome. Please read [`docs/remote-browser-design.md`](docs/remote-browser-design.md) before proposing protocol or security changes.
