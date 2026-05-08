# Atrium documentation

Start here, then jump into the topic you need.

| Document                                           | Audience                  | What you get                                                                                                                                                        |
| -------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [**npm quick start**](./quick-start.md)            | App developers            | Install public packages, start the worker, mount the server API, embed `<RemoteBrowser />`, snapshot a session.                                                     |
| [**User guide**](./user-guide.md)                  | Anyone shipping a feature | Install, run the demo, embed the API and React viewer, multi-tab behavior, snapshots, security, links to examples.                                                  |
| [**Technical design**](./remote-browser-design.md) | Implementers & reviewers  | Architecture, wire protocol narrative, scaling notes (some sections describe the long-term target; the [user guide](./user-guide.md) reflects what is wired today). |
| [**Atrium v0.2 design**](./atrium-v2-design.md)    | Maintainers               | Target architecture: `@atriumjs/core`, adapters, transports, SDK, `atrium dev`, demo hardening. **Renames + shims in repo; rest is planned.**                       |
| [**npm publishing**](./npm-publishing.md)          | Maintainers               | Public package list, prepublish checks, tarball inspection, versioning, and publish order.                                                                          |
| [**Sprint artifacts**](./artifacts/README.md)      | PM / eng planning         | `sprint-bundle.json`, spec, progress, per-sprint contracts.                                                                                                         |
| [**Main README**](../README.md)                    | Everyone                  | Monorepo map, env defaults, Docker worker, session snapshots, lint/test commands.                                                                                   |

### Examples (in the repo)

| Path                                                          | Description                                              |
| ------------------------------------------------------------- | -------------------------------------------------------- |
| [`packages/demo`](../packages/demo/README.md)                 | Full-stack Vite + React + server + worker (`pnpm demo`). |
| [`examples/express-host`](../examples/express-host/README.md) | Minimal Express host: API only, no UI bundle.            |

### Published packages (`packages/*`)

Each package has its own README with install and API notes:

- [`@atriumjs/protocol`](../packages/protocol/README.md) — Zod schemas and TypeScript types for WebSocket messages.
- [`@atriumjs/express`](../packages/express/README.md) — `atrium()` Express mount, viewer WebSocket upgrade.
- [`@atriumjs/worker`](../packages/worker/README.md) — Chromium worker process and Docker notes.
- [`@atriumjs/react`](../packages/react/README.md) — `<RemoteBrowser />` props, optional chrome, multi-tab UI.
- [`@atriumjs/cli`](../packages/cli/README.md) — Local developer entrypoint (`atrium doctor`).

The legacy `@atriumjs/atrium-*` shim packages have been removed (see [npm publishing](./npm-publishing.md)); use the new `@atriumjs/*` names directly.

### Docker

Worker image build and run: [Main README — Docker (worker)](../README.md#docker-worker).
