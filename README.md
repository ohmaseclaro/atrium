# Atrium

<p align="center">
  <img src="assets/brand/readme-hero.jpg" alt="Atrium — open-source remote browser for OAuth, MFA &amp; captcha handoff" width="100%"/>
</p>

**Atrium** is an open-source toolkit for **remote Chromium sessions** where a host application can **hand control to a human** (OAuth, captchas, MFA), then resume automation and capture cookies or Playwright `storage_state` — without shipping raw CDP plumbing to your UI layer.

This repository is a **pnpm monorepo** (`packages/*`) implementing the architecture described in [`docs/remote-browser-design.md`](docs/remote-browser-design.md).

## Documentation (start here)

| Resource                                              | What it is                                                                                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [**npm quick start**](docs/quick-start.md)            | Install from npm, start the worker, mount the server API, render `<RemoteBrowser />`, snapshot sessions.                             |
| [**User guide**](docs/user-guide.md)                  | **How to ship**: install, demo, embed `@atriumjs/express` + `@atriumjs/react`, multi-tab behavior, HTTP routes, snapshots, security. |
| [**Documentation hub**](docs/README.md)               | Index linking **every package README**, examples, design doc, and sprint artifacts.                                                  |
| [**Technical design**](docs/remote-browser-design.md) | Architecture, wire protocol, deployment narrative.                                                                                   |
| [**npm publishing**](docs/npm-publishing.md)          | Package split, prepublish checks, tarball inspection, and publish order for `@atriumjs/*`.                                           |
| [**Public sites deploy**](deploy/README.md)           | **atriumjs.dev** (static landing) + **demo.atriumjs.dev** (full demo), nginx, systemd, GitHub Actions SSH.                           |
| [**Sprint artifacts**](docs/artifacts/README.md)      | Spec, progress, [`sprint-bundle.json`](docs/artifacts/sprint-bundle.json), per-sprint contracts.                                     |

### For integrators

- **Human-in-the-loop** — transfer control to a real user for OAuth / MFA / captchas, then export **cookies** and Playwright **`storageState`**.
- **Multi-tab** — `target="_blank"` opens a managed tab; the worker emits **`tabs`** over the viewer WebSocket.
- **Optional viewer chrome** — [`@atriumjs/react`](packages/react/README.md) supports presets **`none`**, **`minimal`**, **`full`**, or custom `{ showTabStrip?, showToolbar?, showUrlBar? }` around the live canvas.
- **TLS client certificates (mTLS)** — upload a PEM or PFX bundle on `POST /sessions` (`clientCertificates`) and Chromium presents it to the matching origin.
- **Passkey-aware viewer** — passkeys are **not supported** in remote browsers (WebAuthn is unrelayable by design). The worker disguises Chromium as a device without a platform authenticator so most sites never offer the passkey button; if a site insists, the call rejects with `NotAllowedError` (falls back to password / OTP) and `<RemoteBrowser />` shows a 6s toast. Details: [user guide §7](docs/user-guide.md#7-authentication-with-certificates-passkeys-and-hardware-keys).

## Quick start from npm

Install the core packages into your app:

```bash
npm install express @atriumjs/express @atriumjs/react @atriumjs/worker
npm install react react-dom
npx playwright install chromium
```

Start the Chromium worker:

```bash
ATRIUM_WORKER_SECRET=replace-me npx atrium-worker
```

Then mount `@atriumjs/express` in your Express app and render `@atriumjs/react`'s `<RemoteBrowser />` with the session payload returned by `POST /atrium/sessions`.

Full walkthrough: [npm quick start](docs/quick-start.md).

## Try the full demo locally

The **`@atriumjs/demo`** package runs the worker and a Vite + React UI on **http://127.0.0.1:3333** using the same defaults as production-style configs in code (`ATRIUM_WORKER_SECRET`, `ATRIUM_WORKER_DIAL_BASE`). See [`packages/demo/README.md`](packages/demo/README.md).

```bash
pnpm install
pnpm build
pnpm exec playwright install chromium   # once per machine
pnpm demo
```

Open the app, edit the tweet if you want, then click **Login and post**. The demo opens X in a fullscreen remote browser, hands control to you for login, then resumes automation in the same session.

## Installable packages

The demo is private, but the core pieces publish as public npm packages:

```bash
npm install express @atriumjs/express @atriumjs/react @atriumjs/worker
```

`@atriumjs/protocol` is a shared dependency for schemas and wire types. `@atriumjs/worker` also exposes the `atrium-worker` binary for running the Chromium worker from an installed package.

Release checklist: [`docs/npm-publishing.md`](docs/npm-publishing.md).

## Session snapshots (cookies + `storageState`)

Step-by-step context: [**User guide — Session snapshots**](docs/user-guide.md#8-session-snapshots).

Use a **single JSON blob** to move state between machines or to seed a new session.

**Export** (after the viewer has connected at least once so the worker has an active context):

```bash
curl -sS -H "Authorization: Bearer <host-token>" \
  "https://api.example/atrium/sessions/<id>/session-snapshot" | jq . > snapshot.json
```

The response is `{ "cookies": [...], "storageState": { "cookies": [...], "origins": [...] } }` — the same shape Playwright uses for `storageState`.

**Create a new session from a snapshot** (bootstrap runs on the worker before the first WebSocket connects):

```bash
curl -sS -X POST -H "Authorization: Bearer <host-token>" -H "Content-Type: application/json" \
  "https://api.example/atrium/sessions" \
  -d @- <<'JSON' | jq .
{
  "storageState": { "cookies": [], "origins": [] },
  "initialUrl": "https://example.com/"
}
JSON
```

**Apply** to an already-running session (replaces the browser context; viewer stays connected):

```bash
curl -sS -X POST -H "Authorization: Bearer <host-token>" -H "Content-Type: application/json" \
  "https://api.example/atrium/sessions/<id>/session-snapshot" \
  -d '{"storageState":{"cookies":[],"origins":[]}}'
```

Granular reads remain on `GET .../cookies` and `GET .../storage-state`. Worker dry-run accepts bootstrap as a no-op but cannot apply snapshots to a real browser.

## Lint, format, and tests

Shared **ESLint** (flat config) and **Prettier** live at the repository root and apply to every package and example.

```bash
pnpm lint          # eslint + prettier --check + recursive tsc (typecheck)
pnpm lint:fix      # eslint --fix + prettier --write
pnpm format        # prettier --write .
pnpm test          # vitest (unit + integration, see packages/*/src/*.test.*)
```

Each workspace package also exposes `pnpm run typecheck` (and `lint` aliases it) so `pnpm -r run typecheck` can be run alone if needed.

## Architecture choices (locked for this codebase)

| Topic                  | Choice                                   | Why                                                                                                                                                                             |
| ---------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API ↔ worker transport | **Dial** (API opens WebSocket to worker) | Stateless API tier; any node can serve a session after reading `workerDialBase` from config.                                                                                    |
| Browser automation     | **Playwright**                           | Context isolation, `storage_state`, and a supported path to CDP features (for example `Page.startScreencast` via `newCDPSession`) without maintaining a bespoke raw CDP client. |
| Frame transport        | **CDP screencast JPEG** over WebSocket   | Two-frame pattern: JSON metadata, then binary JPEG (see `@atriumjs/protocol`).                                                                                                  |

## Packages

| Package                                             | Role                                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [`@atriumjs/demo`](packages/demo/README.md)         | **Full-stack demo** — server + React + worker; `pnpm demo`.                              |
| [`@atriumjs/protocol`](packages/protocol/README.md) | Zod + TypeScript for WebSocket and bootstrap payloads.                                   |
| [`@atriumjs/express`](packages/express/README.md)   | Express `atrium()` mount; viewer relay; **dials** worker with `Authorization: Bearer …`. |
| [`@atriumjs/worker`](packages/worker/README.md)     | Chromium + Playwright; screencast JPEG; multi-tab context.                               |
| [`@atriumjs/react`](packages/react/README.md)       | `<RemoteBrowser />` canvas viewer + **optional** embedded chrome.                        |
| [`@atriumjs/cli`](packages/cli/README.md)           | `atrium doctor` CLI.                                                                     |

## Minimal Express-only example

For a smaller host without a bundled UI, see [`examples/express-host/README.md`](examples/express-host/README.md) (also linked from the [user guide](docs/user-guide.md)).

## Defaults (local development)

| Variable                  | Typical value                                                                                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ATRIUM_WORKER_SECRET`    | `dev-secret-change-me`                                                                                                                                                                               |
| `ATRIUM_WORKER_DIAL_BASE` | `ws://127.0.0.1:7070`                                                                                                                                                                                |
| Demo web port             | `3333` (`PORT`)                                                                                                                                                                                      |
| Worker port               | `7070` when run alone (`ATRIUM_WORKER_PORT`); **`pnpm demo`** picks a **free port** if unset and sets `ATRIUM_WORKER_DIAL_BASE` to match (see [`packages/demo/README.md`](packages/demo/README.md)). |

### Worker “stealth” defaults (library-based)

The worker uses **`playwright-extra`** + **`puppeteer-extra-plugin-stealth`** (unless disabled), plus ordinary **`BrowserContext`** hints: desktop **viewport** (default `1366×768`), **user agent**, **locale**, **timezone**, **color scheme**, and **`Accept-Language`**. Chromium launches **headed by default** (not headless), with **`--window-size=…`** aligned to that viewport and common anti-automation flags.

On **Linux servers or CI** without a real display, run the worker under **[Xvfb](https://www.x.org/releases/X11R7.6/doc/man/man1/Xvfb.1.xhtml)** (X Virtual Framebuffer), e.g. `xvfb-run -a node packages/worker/dist/run.js`, or use the **Dockerfile** below (it installs `xvfb` and wraps the process with `xvfb-run`).

| Variable                                  | Purpose                                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `ATRIUM_STEALTH`                          | Set to `0` to use stock Playwright (no stealth plugin).                                         |
| `ATRIUM_VIEWPORT_W` / `ATRIUM_VIEWPORT_H` | Context + initial window size (integers).                                                       |
| `ATRIUM_USER_AGENT`                       | Override default Chrome-on-Windows UA string.                                                   |
| `ATRIUM_LOCALE`                           | BCP-47 locale (default `en-US`).                                                                |
| `ATRIUM_TIMEZONE`                         | IANA zone (default `America/Los_Angeles`).                                                      |
| `ATRIUM_COLOR_SCHEME`                     | `light` (default), `dark`, or `no-preference`.                                                  |
| `ATRIUM_CHROMIUM_CHANNEL`                 | Optional Playwright `channel`: `chrome`, `chrome-beta`, `chrome-dev`, or `msedge` if installed. |
| `ATRIUM_WORKER_HEADLESS`                  | Set to `1` for **headless** Chromium (no X11). Default is **headed** (needs a display or Xvfb). |

Worker dry-run (no Chromium):

```bash
ATRIUM_WORKER_DRY=1 pnpm --filter @atriumjs/worker start
```

## Docker (worker)

From the repository root:

```bash
docker build -f docker/worker/Dockerfile -t atrium-worker:local .
docker run --rm -p 7070:7070 \
  -e ATRIUM_WORKER_SECRET=replace-me \
  atrium-worker:local
```

The image extends [`mcr.microsoft.com/playwright`](https://playwright.dev/docs/docker) so Chromium is available in-container. It installs **Xvfb**; [`docker/worker/entrypoint.sh`](docker/worker/entrypoint.sh) starts **`Xvfb :99`** and sets **`DISPLAY=:99`** before `node`, giving headed Chromium a virtual X11 display (no physical monitor). Use `ATRIUM_WORKER_HEADLESS=1` in the container only if you intentionally want headless mode instead.

## Security notes (public-facing deployments)

- Rotate **`ATRIUM_WORKER_SECRET`** and protect the worker network so only your API can dial `ws://…/internal/stream/:sessionId`.
- **Viewer tokens** are short-lived; treat them like capability URLs.
- Cookies and `storage_state` must stay on **host-authenticated HTTP** endpoints (`/session-snapshot`, `/cookies`, `/storage-state`); never expose worker shared secrets to browsers.

## License

MIT — see [`LICENSE`](LICENSE).

## Contributing

Issues and PRs are welcome. Read the [**user guide**](docs/user-guide.md) for how pieces fit together, and [`docs/remote-browser-design.md`](docs/remote-browser-design.md) before proposing protocol or security changes.
