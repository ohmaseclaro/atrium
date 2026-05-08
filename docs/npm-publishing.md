# Publishing Atrium to npm

Atrium publishes as a small set of public scoped packages under `@atriumjs/*` (for example `@atriumjs/protocol`, `@atriumjs/express`).

## Public packages

| Package              | Purpose                                                          |
| -------------------- | ---------------------------------------------------------------- |
| `@atriumjs/protocol` | Shared Zod schemas and TypeScript wire types.                    |
| `@atriumjs/core`     | Web Fetch session API, transports (WS/SSE/poll), and relay glue. |
| `@atriumjs/express`  | Express middleware built on `@atriumjs/core`.                    |
| `@atriumjs/react`    | Embeddable React `<RemoteBrowser />` viewer.                     |
| `@atriumjs/worker`   | Playwright/Chromium worker plus `atrium-worker` binary.          |
| `@atriumjs/cli`      | Developer CLI entrypoint (`atrium`).                             |

`@atriumjs/demo` stays private and is not published.

> **Removed:** the legacy `@atriumjs/atrium-*` shims (cli, protocol, react, server, worker) used during the v0.1 → v0.2 transition have been deleted from the repo and unpublished from npm. Install the new names above directly.

## Before the first publish

1. Log in as an npm user or organization that owns the **`@atriumjs`** scope. Scoped packages under `@atriumjs/...` publish with `--access public` on first publish.
2. Log in with an account that can publish public scoped packages:

```bash
npm login
npm whoami
```

3. Confirm package names are available:

```bash
npm view @atriumjs/protocol version
npm view @atriumjs/core version
npm view @atriumjs/express version
npm view @atriumjs/react version
npm view @atriumjs/worker version
npm view @atriumjs/cli version
```

If npm returns `404`, the package name is still unpublished.

## Release checklist

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm publish:check
```

`publish:check` builds every workspace, runs tests, and creates local tarballs in `.packs/` for the npm-facing packages.

Inspect a tarball if needed:

```bash
tar -tf .packs/atriumjs-protocol-*.tgz
```

## Publish order

Publish `@atriumjs/protocol` first because other packages depend on it. Publish `@atriumjs/core` next (Express depends on it). Then publish the rest.

```bash
pnpm --dir packages/protocol publish --access public
pnpm --dir packages/core publish --access public
pnpm --dir packages/express publish --access public
pnpm --dir packages/react publish --access public
pnpm --dir packages/worker publish --access public
pnpm --dir packages/cli publish --access public
```

For a future all-at-once release, `pnpm -r publish --access public` is acceptable once the package order is known to work in CI.

## CI: token and GitHub Actions

**Do not commit tokens.** Never put an npm token in the repo, in `.npmrc` checked into git, or in client-side env files.

1. **Create a token on npm** (logged in as an account or org bot with publish rights to **`@atriumjs`**):
   - Prefer **Granular Access Token**: npm → Access Tokens → Generate New Token → type **Granular** → select the six public `@atriumjs/*` packages (or the whole `@atriumjs` scope if you accept broader blast radius) → enable **Read and write** for those packages → under **Packages and scopes**, ensure **Publish** is allowed.
   - Legacy **Automation** tokens still work for non-interactive publish; rotate them periodically.

2. **Store it only as a GitHub secret**: repository **Settings → Secrets and variables → Actions → New repository secret**. Name: **`NPM_TOKEN`**. Paste the token once; GitHub encrypts it and only injects it into workflows you configure.

3. **Run the publish workflow**: **Actions → “Publish to npm” → Run workflow** (manual `workflow_dispatch`). The workflow is `.github/workflows/npm-publish.yml`; it runs `pnpm publish:check` then publishes each public package in order using `NODE_AUTH_TOKEN` (set from `secrets.NPM_TOKEN`).

4. **Optional hardening**: restrict the token’s packages on npm; use **environment** secrets with required reviewers for production releases; enable **branch protection** on `main` so only reviewed merges trigger automation if you later add `push`/`release` triggers.

## Versioning

For now, keep versions aligned across the public packages. A simple release should bump all six public packages to the same version before publishing.

```bash
pnpm --filter @atriumjs/protocol version patch --no-git-tag-version
pnpm --filter @atriumjs/core version patch --no-git-tag-version
pnpm --filter @atriumjs/express version patch --no-git-tag-version
pnpm --filter @atriumjs/react version patch --no-git-tag-version
pnpm --filter @atriumjs/worker version patch --no-git-tag-version
pnpm --filter @atriumjs/cli version patch --no-git-tag-version
```

Commit the version bump, tag the release, then publish.

## Post-publish smoke checks

```bash
npm view @atriumjs/protocol version
npm view @atriumjs/core version
npm view @atriumjs/express version
npm view @atriumjs/react version
npm view @atriumjs/worker version
npm view @atriumjs/cli version
```

Create a clean scratch app and install the intended production pieces:

```bash
pnpm add express @atriumjs/express @atriumjs/react @atriumjs/worker
pnpm exec playwright install chromium
```

The worker binary should be available as:

```bash
pnpm exec atrium-worker
```

## GitHub repository URL

`package.json` **repository**, **bugs**, and **homepage** fields assume **`https://github.com/ohmaseclaro/atrium`**. After the repo exists under that URL, point your local clone at it:

```bash
git remote set-url origin https://github.com/ohmaseclaro/atrium.git
```

To **rename** a repo you keep under the same owner: GitHub **Settings → General → Repository name**, or `gh repo rename <new-name> --repo <owner>/<current>`.

To **move** to the `atriumjs` organization, use **Settings → Danger zone → Transfer ownership** (issues, PRs, and stars move with the repo). Prefer transfer over delete-and-recreate unless you intentionally want a clean slate.
