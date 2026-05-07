# Quick start from npm

Use Atrium when your app needs a real Chromium session that can be streamed into your UI, handed to a human for login/approval, then resumed by your server-side automation.

## 1. Install

For an Express host with a React viewer:

```bash
npm install express @atriumjs/express @atriumjs/react @atriumjs/worker
npm install react react-dom
npx playwright install chromium
```

With pnpm:

```bash
pnpm add express @atriumjs/express @atriumjs/react @atriumjs/worker react react-dom
pnpm exec playwright install chromium
```

`@atriumjs/protocol` is installed automatically by the public packages that need it. Install it directly only if you want to parse or validate wire messages yourself.

## 2. Start the worker

The worker runs Chromium and exposes the internal API that your app server dials.

```bash
export ATRIUM_WORKER_SECRET=replace-me
export ATRIUM_WORKER_PORT=7070
npx atrium-worker
```

With pnpm:

```bash
ATRIUM_WORKER_SECRET=replace-me pnpm exec atrium-worker
```

Headed Chromium is the default. On Linux without a display, run with Xvfb or use the Docker worker described in the root [README](../README.md#docker-worker).

## 3. Mount the server API

```ts
import { createServer } from "node:http";
import express from "express";
import { atrium } from "@atriumjs/express";

const app = express();

const { router, handleViewerUpgrade } = atrium({
  redis: { url: process.env.REDIS_URL ?? "redis://127.0.0.1:6379" },
  authorize: async (req) => {
    // Resolve this from your app's auth/session layer.
    return { tenantId: "demo", userId: "demo-user" };
  },
  policies: {
    sessionTtlMs: 15 * 60_000,
    idleTtlMs: 5 * 60_000,
    maxConcurrentSessionsPerTenant: 5,
    urlAllowlist: ["*"],
    defaultViewport: { w: 1280, h: 800 },
  },
  workerDialBase: process.env.ATRIUM_WORKER_DIAL_BASE ?? "ws://127.0.0.1:7070",
  workerSharedSecret: process.env.ATRIUM_WORKER_SECRET ?? "replace-me",
  mountPath: "/atrium",
});

app.use("/atrium", router);

const server = createServer(app);
server.on("upgrade", (req, socket, head) => {
  if (!req.url?.startsWith("/atrium/sessions/")) return;
  handleViewerUpgrade(req, socket, head);
});

server.listen(3000);
```

## 4. Create a session

From your backend or an authenticated route:

```bash
curl -sS -X POST http://localhost:3000/atrium/sessions \
  -H "Content-Type: application/json" \
  -d '{"initialUrl":"https://example.com/"}' | jq .
```

The response contains:

```json
{
  "sessionId": "...",
  "viewerToken": "...",
  "wsUrl": "ws://localhost:3000/atrium/sessions/.../stream",
  "expiresAt": 1770000000000
}
```

## 5. Render the React viewer

```tsx
import { RemoteBrowser } from "@atriumjs/react";

export function BrowserPane({ session }: { session: SessionPayload }) {
  return (
    <RemoteBrowser
      sessionId={session.sessionId}
      viewerToken={session.viewerToken}
      wsUrl={session.wsUrl}
      chrome="full"
      interactive
    />
  );
}
```

To give the human control:

```bash
curl -sS -X POST http://localhost:3000/atrium/sessions/<id>/control \
  -H "Content-Type: application/json" \
  -d '{"action":"grant","to":"human"}'
```

To return control to automation:

```bash
curl -sS -X POST http://localhost:3000/atrium/sessions/<id>/control \
  -H "Content-Type: application/json" \
  -d '{"action":"release"}'
```

## 6. Export the browser session

After the viewer connects and the user signs in:

```bash
curl -sS http://localhost:3000/atrium/sessions/<id>/session-snapshot | jq .
```

This returns cookies plus Playwright `storageState`, so your app can continue from the same browser session.

## Next steps

- Full integration guide: [User guide](./user-guide.md)
- React viewer props: [`@atriumjs/react`](../packages/react/README.md)
- Server API: [`@atriumjs/express`](../packages/express/README.md)
- Worker runtime: [`@atriumjs/worker`](../packages/worker/README.md)
- Publishing/release checklist: [npm publishing](./npm-publishing.md)
