# Publishing Atrium to npm

Atrium publishes as a small set of public scoped packages under `@atrium/*`.

## Public packages

| Package            | Purpose                                                           |
| ------------------ | ----------------------------------------------------------------- |
| `@atrium/protocol` | Shared Zod schemas and TypeScript wire types.                     |
| `@atrium/server`   | Express middleware, HTTP session API, and viewer WebSocket relay. |
| `@atrium/react`    | Embeddable React `<RemoteBrowser />` viewer.                      |
| `@atrium/worker`   | Playwright/Chromium worker plus `atrium-worker` binary.           |
| `@atrium/cli`      | Developer CLI entrypoint (`atrium`).                              |

`@atrium/demo` stays private and is not published.

## Before the first publish

1. Make sure the npm organization/scope exists and your npm user has publish rights for `@atrium`.
2. Log in with an account that can publish public scoped packages:

```bash
npm login
npm whoami
```

3. Confirm package names are available:

```bash
npm view @atrium/protocol version
npm view @atrium/server version
npm view @atrium/react version
npm view @atrium/worker version
npm view @atrium/cli version
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
tar -tf .packs/atrium-protocol-*.tgz
```

## Publish order

Publish `@atrium/protocol` first because other packages depend on it. Then publish the packages that consume it.

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
pnpm --filter @atrium/protocol version patch --no-git-tag-version
pnpm --filter @atrium/server version patch --no-git-tag-version
pnpm --filter @atrium/react version patch --no-git-tag-version
pnpm --filter @atrium/worker version patch --no-git-tag-version
pnpm --filter @atrium/cli version patch --no-git-tag-version
```

Commit the version bump, tag the release, then publish.

## Post-publish smoke checks

```bash
npm view @atrium/protocol version
npm view @atrium/server version
npm view @atrium/react version
npm view @atrium/worker version
npm view @atrium/cli version
```

Create a clean scratch app and install the intended production pieces:

```bash
pnpm add express @atrium/server @atrium/react @atrium/worker
pnpm exec playwright install chromium
```

The worker binary should be available as:

```bash
pnpm exec atrium-worker
```
