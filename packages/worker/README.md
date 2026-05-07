# @atriumjs/worker

**Chromium worker** for Atrium: accepts an inbound WebSocket from the API (**dial** pattern), runs **Playwright** with optional **stealth** plugins, streams **CDP screencast JPEG** frames to the viewer relay, supports **multiple tabs** per browser context, and exposes internal HTTP for bootstrap, cookies, and `storageState`.

**Docs hub:** [`docs/README.md`](../../docs/README.md) · **User guide:** [`docs/user-guide.md`](../../docs/user-guide.md)

## Install & run

From npm:

```bash
npm install @atriumjs/worker
npx playwright install chromium
export ATRIUM_WORKER_SECRET=your-shared-secret
export ATRIUM_WORKER_PORT=7070   # optional
npx atrium-worker
```

With pnpm: `pnpm add @atriumjs/worker`, then `pnpm exec atrium-worker`.

From the monorepo (after `pnpm build`), use `pnpm --filter @atriumjs/worker start`.

Full app walkthrough: [npm quick start](../../docs/quick-start.md).

**Headed** Chromium is the default (better for real sites). On Linux without a display, use **`pnpm run start:xvfb`** or the **Docker** image — [Main README — Docker (worker)](../../README.md#docker-worker).

### Environment variables

Full table: [Main README — Defaults & stealth](../../README.md#defaults-local-development). Highlights:

| Variable                     | Purpose                                     |
| ---------------------------- | ------------------------------------------- |
| **`ATRIUM_WORKER_SECRET`**   | Bearer token for WebSocket + internal HTTP. |
| **`ATRIUM_WORKER_PORT`**     | Listen port (default **7070**).             |
| **`ATRIUM_WORKER_HEADLESS`** | Set **`1`** for headless Chromium.          |
| **`ATRIUM_WORKER_DRY`**      | **`1`** — no browser (CI smoke).            |

## Docker

From the **repository root**:

```bash
docker build -f docker/worker/Dockerfile -t atrium-worker:local .
```

See root [README](../../README.md#docker-worker) for `docker run` example.

## Build

```bash
pnpm --filter @atriumjs/worker run build
```

MIT — see repository [`LICENSE`](../../LICENSE).
