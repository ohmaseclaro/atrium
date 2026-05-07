# Publishing Atrium to npm

Atrium publishes as a small set of public scoped packages under `@ohmaseclaro/atrium-*`.

## Public packages

| Package            | Purpose                                                           |
| ------------------ | ----------------------------------------------------------------- |
| `@ohmaseclaro/atrium-protocol` | Shared Zod schemas and TypeScript wire types.                     |
| `@ohmaseclaro/atrium-server`   | Express middleware, HTTP session API, and viewer WebSocket relay. |
| `@ohmaseclaro/atrium-react`    | Embeddable React `<RemoteBrowser />` viewer.                      |
| `@ohmaseclaro/atrium-worker`   | Playwright/Chromium worker plus `atrium-worker` binary.           |
| `@ohmaseclaro/atrium-cli`      | Developer CLI entrypoint (`atrium`).                              |

`@ohmaseclaro/atrium-demo` stays private and is not published.

## Before the first publish

1. Log in as the npm user that owns the **`@ohmaseclaro`** scope (your npm username). Scoped packages under `@ohmaseclaro/...` publish with `--access public` on first publish.
2. Log in with an account that can publish public scoped packages:

```bash
npm login
npm whoami
```

3. Confirm package names are available:

```bash
npm view @ohmaseclaro/atrium-protocol version
npm view @ohmaseclaro/atrium-server version
npm view @ohmaseclaro/atrium-react version
npm view @ohmaseclaro/atrium-worker version
npm view @ohmaseclaro/atrium-cli version
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
tar -tf .packs/ohmaseclaro-atrium-protocol-*.tgz
```

## Publish order

Publish `@ohmaseclaro/atrium-protocol` first because other packages depend on it. Then publish the packages that consume it.

```bash
pnpm --dir packages/protocol publish --access public
pnpm --dir packages/server publish --access public
pnpm --dir packages/react publish --access public
pnpm --dir packages/worker publish --access public
pnpm --dir packages/cli publish --access public
```

For a future all-at-once release, `pnpm -r publish --access public` is acceptable once the package order is known to work in CI.

## Versioning

For now, keep versions aligned across the public packages. A simple release should bump all five public packages to the same version before publishing.

```bash
pnpm --filter @ohmaseclaro/atrium-protocol version patch --no-git-tag-version
pnpm --filter @ohmaseclaro/atrium-server version patch --no-git-tag-version
pnpm --filter @ohmaseclaro/atrium-react version patch --no-git-tag-version
pnpm --filter @ohmaseclaro/atrium-worker version patch --no-git-tag-version
pnpm --filter @ohmaseclaro/atrium-cli version patch --no-git-tag-version
```

Commit the version bump, tag the release, then publish.

## Post-publish smoke checks

```bash
npm view @ohmaseclaro/atrium-protocol version
npm view @ohmaseclaro/atrium-server version
npm view @ohmaseclaro/atrium-react version
npm view @ohmaseclaro/atrium-worker version
npm view @ohmaseclaro/atrium-cli version
```

Create a clean scratch app and install the intended production pieces:

```bash
pnpm add express @ohmaseclaro/atrium-server @ohmaseclaro/atrium-react @ohmaseclaro/atrium-worker
pnpm exec playwright install chromium
```

The worker binary should be available as:

```bash
pnpm exec atrium-worker
```
