# @atrium/cli

Lightweight **CLI** entrypoint for the Atrium monorepo (`atrium` on your `PATH` when linked or run via `pnpm exec`).

**Docs hub:** [`docs/README.md`](../../docs/README.md)

## Commands

- **`atrium doctor`** — sanity checks for local development (expand as the repo grows).

## Install & run

From npm:

```bash
npm install --save-dev @atrium/cli
npx atrium doctor
```

With pnpm: `pnpm add -D @atrium/cli`, then `pnpm exec atrium doctor`.

From the monorepo root:

```bash
pnpm --filter @atrium/cli exec atrium doctor
```

## Build

```bash
pnpm --filter @atrium/cli run build
```

MIT — see repository [`LICENSE`](../../LICENSE).
