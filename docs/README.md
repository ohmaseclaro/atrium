# Atrium documentation

Start here, then jump into the topic you need.

| Document                                           | Audience                  | What you get                                                                                                                                                        |
| -------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [**User guide**](./user-guide.md)                  | Anyone shipping a feature | Install, run the demo, embed the API and React viewer, multi-tab behavior, snapshots, security, links to examples.                                                  |
| [**Technical design**](./remote-browser-design.md) | Implementers & reviewers  | Architecture, wire protocol narrative, scaling notes (some sections describe the long-term target; the [user guide](./user-guide.md) reflects what is wired today). |
| [**Sprint artifacts**](./artifacts/README.md)      | PM / eng planning         | `sprint-bundle.json`, spec, progress, per-sprint contracts.                                                                                                         |
| [**Main README**](../README.md)                    | Everyone                  | Monorepo map, env defaults, Docker worker, session snapshots, lint/test commands.                                                                                   |

### Examples (in the repo)

| Path                                                          | Description                                              |
| ------------------------------------------------------------- | -------------------------------------------------------- |
| [`packages/demo`](../packages/demo/README.md)                 | Full-stack Vite + React + server + worker (`pnpm demo`). |
| [`examples/express-host`](../examples/express-host/README.md) | Minimal Express host: API only, no UI bundle.            |

### Published packages (`packages/*`)

Each package has its own README with install and API notes:

- [`@atrium/protocol`](../packages/protocol/README.md) — Zod schemas and TypeScript types for WebSocket messages.
- [`@atrium/server`](../packages/server/README.md) — `atrium()` Express mount, viewer WebSocket upgrade.
- [`@atrium/worker`](../packages/worker/README.md) — Chromium worker process and Docker notes.
- [`@atrium/react`](../packages/react/README.md) — `<RemoteBrowser />` props, optional chrome, multi-tab UI.
- [`@atrium/cli`](../packages/cli/README.md) — Local developer entrypoint (`atrium doctor`).

### Docker

Worker image build and run: [Main README — Docker (worker)](../README.md#docker-worker).
