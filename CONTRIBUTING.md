# Contributing to Atrium

Thanks for considering a contribution! Atrium is a small open-source toolkit for **remote Chromium sessions with human-in-the-loop control transfer**, and the codebase is intentionally narrow — your patches go a long way.

This guide covers the day-to-day flow. The deeper context lives in [`docs/remote-browser-design.md`](docs/remote-browser-design.md) (architecture + wire protocol) and [`docs/atrium-v2-design.md`](docs/atrium-v2-design.md) (roadmap).

## Ways to contribute

- **Found a bug?** Open an issue with a minimal reproduction (template: _Bug report_). If you can attach a small repo or a `curl` sequence that triggers it, even better.
- **Want a feature?** Open an issue first (template: _Feature request_). For anything that touches the wire protocol or security model, link to the relevant section of `docs/remote-browser-design.md` and propose the change there before writing code.
- **"How do I…?"** — please use [GitHub Discussions](https://github.com/ohmaseclaro/atrium/discussions) rather than issues. Issues are reserved for bugs and confirmed feature work.
- **Security issue?** See [`SECURITY.md`](SECURITY.md). Do not open a public issue.

## Local setup

Atrium is a **pnpm monorepo** (`packages/*`).

```bash
git clone https://github.com/ohmaseclaro/atrium.git
cd atrium
pnpm install
pnpm exec playwright install chromium   # one-time, for the worker
```

Dev loop:

```bash
pnpm build               # build every workspace package
pnpm demo                # full-stack demo at http://127.0.0.1:3333
pnpm test                # vitest across all packages
pnpm lint                # eslint + prettier --check + recursive tsc
pnpm lint:fix            # auto-fix what we can
pnpm format              # prettier --write .
```

For per-package work, use the workspace filter:

```bash
pnpm --filter @atriumjs/express test
pnpm --filter @atriumjs/react build
```

### Running just the worker

```bash
ATRIUM_WORKER_SECRET=dev-secret-change-me pnpm --filter @atriumjs/worker start
```

If you don't have a graphical display (Linux server, CI), set `ATRIUM_WORKER_HEADLESS=1` or wrap with `xvfb-run` — see the worker README and the root README's _Worker "stealth" defaults_ section.

## Pull request flow

1. **Branch off `main`** with a descriptive name. Convention: `<type>/<short-summary>` — `feat/snapshot-restore`, `fix/clipboard-modifier-flush`, `docs/quick-start-typo`.
2. **Keep PRs focused.** One concern per PR. If you find a tangential bug while doing the main work, open a separate PR for it; reviewers will thank you.
3. **Tests are part of the PR.** New code should land with vitest coverage; bug fixes should land with a regression test that fails on `main`.
4. **`pnpm lint` must pass locally** before you push. CI runs the same checks.
5. **Write the PR description for a reviewer who has not been in your head.** Cover: what changed, why, how to verify, anything risky. If the change touches the wire protocol or security model, link to the relevant docs section.
6. **One reviewer approval is required** before merge. The maintainer will request changes if anything needs to shift.

## Commit style

We use **conventional-commit prefixes** (feel free to scope by package):

- `feat(react): show passkey toast for 6s` — new behavior
- `fix(express): trust proxy for wss URLs behind nginx` — bug fix
- `docs(deploy): origin TLS for Cloudflare Full` — docs only
- `chore(ci): bump pnpm to v9` — non-functional plumbing
- `refactor(core)`, `perf(worker)`, `test(protocol)`, `style(landing)` — as needed

Title under ~70 chars. Body wrapped at ~80 if you need one. Mention any issue/PR numbers (`Closes #42`).

## Coding conventions

- **TypeScript** everywhere. No `any` unless there's a comment explaining why.
- **Zod schemas** are the source of truth for wire types — see [`packages/protocol/`](packages/protocol/). Don't hand-roll types that should derive from a schema.
- **Don't introduce raw CDP plumbing** outside the worker. The whole point of the architecture is that hosts speak Atrium's stable HTTP/WS surface, not Chrome DevTools internals.
- **Don't expose worker secrets to browsers.** Cookies and `storageState` only flow over host-authenticated HTTP endpoints.
- **No `console.log` left in shipped code.** Use the package's existing logger (or pass one in) so consumers can route logs.
- **Comments**: explain _why_, not _what_. Skip them when good naming already covers the what. Definitely skip them for "added for issue #X" — that belongs in the PR description.

## Reviewing your own PR before requesting review

Run this checklist locally:

- [ ] `pnpm lint` clean (eslint + prettier + recursive `tsc --noEmit`)
- [ ] `pnpm test` green
- [ ] `pnpm build` succeeds in every workspace
- [ ] Manual smoke test of the demo if you touched anything in the runtime path: `pnpm demo` → click _Login and post_ end-to-end, watch the control pill flip both directions
- [ ] `git diff main...HEAD` reads cleanly — no commented-out code, no dev `console.log`, no orphaned files
- [ ] PR title is conventional-commit format
- [ ] PR description has a _Test plan_ checklist

## Releasing (maintainers only)

See [`docs/npm-publishing.md`](docs/npm-publishing.md) for the full release process — package order, prepublish checks, tarball inspection, and tag conventions.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you agree to abide by its terms.

## Questions?

If anything in this doc is unclear, that's a doc bug — please open an issue or PR.
