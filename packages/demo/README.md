# @ohmaseclaro/atrium-demo

End-to-end demo for the Atrium monorepo. It wires **everything shipped today** together with the **same defaults** as the root [`README.md`](../../README.md):

| Piece              | How the demo uses it                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@ohmaseclaro/atrium-server`   | `atrium()` on `/atrium` with in-memory sessions, `authorize` demo principal, **dial** relay to the worker                                        |
| `@ohmaseclaro/atrium-react`    | `<RemoteBrowser />` after `POST /atrium/sessions` (demo uses **`chrome="full"`** + optional status line; see [React README](../react/README.md)) |
| `@ohmaseclaro/atrium-protocol` | Imported in the client bundle for shared types (wire messages match these shapes)                                                                |
| `@ohmaseclaro/atrium-worker`   | Started alongside the UI by `pnpm dev` (waits for `http://127.0.0.1:7070`)                                                                       |
| `@ohmaseclaro/atrium-cli`      | Mentioned in the footer; run `pnpm --filter @ohmaseclaro/atrium-cli exec atrium doctor` from repo root                                                       |

## Defaults (no `.env` required)

| Variable                  | Default                                                                                                                                                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ATRIUM_WORKER_SECRET`    | `dev-secret-change-me`                                                                                                                                                                                                                  |
| `ATRIUM_WORKER_DIAL_BASE` | `ws://127.0.0.1:7070`                                                                                                                                                                                                                   |
| `PORT` (demo web + API)   | `3333`                                                                                                                                                                                                                                  |
| Worker port               | **`pnpm dev`** picks a **free port** if `ATRIUM_WORKER_PORT` is unset, and sets `ATRIUM_WORKER_DIAL_BASE` to match. Override with `ATRIUM_WORKER_PORT=7070` (and optional `ATRIUM_WORKER_DIAL_BASE`). `dev:web` waits on the same port. |

## Run

From the **repository root**:

```bash
pnpm install
pnpm build
pnpm demo
```

Then open [http://127.0.0.1:3333](http://127.0.0.1:3333), edit the tweet if you want, and click **Login and post**. The demo opens X in a fullscreen remote browser, hands control to you for login, then snapshots the session and posts while you watch.

### X (Twitter) workflow

The demo UI has one primary button: **Login and post**. It bootstraps `https://x.com/i/flow/login`, grants human control automatically, keeps a floating **I'm logged in — post my tweet** button visible, then exports cookies + Playwright `storageState`, returns control to automation, and calls the X compose example endpoint. Reliability depends on X. The worker is **headed by default**; optionally use the system **Chrome** channel:

```bash
ATRIUM_CHROMIUM_CHANNEL=chrome pnpm --filter @ohmaseclaro/atrium-worker start
```

On Linux without a monitor, run the worker with **Xvfb**, e.g. `xvfb-run -a pnpm --filter @ohmaseclaro/atrium-worker start`, or use the repo **Docker** worker image (uses `xvfb-run` in `CMD`).

The worker enables **`playwright-extra` + `puppeteer-extra-plugin-stealth`** and desktop-like viewport / UA / locale / timezone by default (see root **README**; set `ATRIUM_STEALTH=0` to disable the plugin).

Chromium must be installed for the worker once:

```bash
pnpm exec playwright install chromium
```

For a UI-only dev server (you already started the worker yourself):

```bash
pnpm --filter @ohmaseclaro/atrium-demo dev:ui-only
```

## Lint and tests

From the repo root, `pnpm lint` and `pnpm test` cover this package too (ESLint/Prettier for `packages/demo`, Vitest projects under `packages/*`).

## Production build

```bash
pnpm --filter @ohmaseclaro/atrium-demo build
ATRIUM_WORKER_SECRET=… ATRIUM_WORKER_DIAL_BASE=ws://… pnpm --filter @ohmaseclaro/atrium-demo start
```

Serve the worker separately (or point `ATRIUM_WORKER_DIAL_BASE` at your fleet).
