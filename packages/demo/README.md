# @atrium/demo

End-to-end demo for the Atrium monorepo. It wires **everything shipped today** together with the **same defaults** as the root [`README.md`](../../README.md):

| Piece              | How the demo uses it                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@atrium/server`   | `atrium()` on `/atrium` with in-memory sessions, `authorize` demo principal, **dial** relay to the worker                                        |
| `@atrium/react`    | `<RemoteBrowser />` after `POST /atrium/sessions` (demo uses **`chrome="full"`** + optional status line; see [React README](../react/README.md)) |
| `@atrium/protocol` | Imported in the client bundle for shared types (wire messages match these shapes)                                                                |
| `@atrium/worker`   | Started alongside the UI by `pnpm dev` (waits for `http://127.0.0.1:7070`)                                                                       |
| `@atrium/cli`      | Mentioned in the footer; run `pnpm --filter @atrium/cli exec atrium doctor` from repo root                                                       |

## Defaults (no `.env` required)

| Variable                  | Default                       |
| ------------------------- | ----------------------------- |
| `ATRIUM_WORKER_SECRET`    | `dev-secret-change-me`        |
| `ATRIUM_WORKER_DIAL_BASE` | `ws://127.0.0.1:7070`         |
| `PORT` (demo web + API)   | `3333`                        |
| Worker port               | `7070` (`ATRIUM_WORKER_PORT`) |

## Run

From the **repository root**:

```bash
pnpm install
pnpm build
pnpm demo
```

Then open [http://127.0.0.1:3333](http://127.0.0.1:3333), click **POST /atrium/sessions**, and confirm the canvas shows **example.com** (worker navigates there by default).

### X (Twitter) workflow block

The demo UI includes **Start X login flow** (bootstraps `https://x.com/i/flow/login`), **Grant control** so you can drive the remote canvas (click to focus, then type), **GET session snapshot** to export cookies + Playwright `storageState`, **Return control**, and **POST x-demo compose tweet** to open compose and post via automation. Reliability depends on X. The worker is **headed by default**; optionally use the system **Chrome** channel:

```bash
ATRIUM_CHROMIUM_CHANNEL=chrome pnpm --filter @atrium/worker start
```

On Linux without a monitor, run the worker with **Xvfb**, e.g. `xvfb-run -a pnpm --filter @atrium/worker start`, or use the repo **Docker** worker image (uses `xvfb-run` in `CMD`).

The worker enables **`playwright-extra` + `puppeteer-extra-plugin-stealth`** and desktop-like viewport / UA / locale / timezone by default (see root **README**; set `ATRIUM_STEALTH=0` to disable the plugin).

Chromium must be installed for the worker once:

```bash
pnpm exec playwright install chromium
```

For a UI-only dev server (you already started the worker yourself):

```bash
pnpm --filter @atrium/demo dev:ui-only
```

## Lint and tests

From the repo root, `pnpm lint` and `pnpm test` cover this package too (ESLint/Prettier for `packages/demo`, Vitest projects under `packages/*`).

## Production build

```bash
pnpm --filter @atrium/demo build
ATRIUM_WORKER_SECRET=… ATRIUM_WORKER_DIAL_BASE=ws://… pnpm --filter @atrium/demo start
```

Serve the worker separately (or point `ATRIUM_WORKER_DIAL_BASE` at your fleet).
