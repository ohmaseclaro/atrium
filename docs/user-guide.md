# Atrium user guide

**Atrium** gives you a **real Chromium session** in your infrastructure, a **viewer** your users can interact with when they need to sign in (OAuth, MFA, captchas), and **HTTP APIs** to move **cookies** and Playwright **`storageState`** back into your automation.

This guide matches the **current** open-source monorepo. For deeper architecture, see [Technical design](./remote-browser-design.md).

---

## 1. Try it in five minutes

From the repository root:

```bash
pnpm install
pnpm build
pnpm exec playwright install chromium   # once per machine
pnpm demo
```

Open **http://127.0.0.1:3333**, create a session, and confirm the remote browser loads (default **example.com**). The demo uses **embedded browser chrome** (`chrome="full"`) so tabs, URL bar, and navigation match a familiar browser window.

Details: [`packages/demo/README.md`](../packages/demo/README.md).

---

## 2. What ships in the monorepo

| NPM package            | Role                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| **`@atrium/server`**   | Express router + viewer WebSocket relay; your API **dials** the worker with a shared secret. |
| **`@atrium/worker`**   | Listens for that dial, runs **Playwright** + Chromium, streams **JPEG screencast** frames.   |
| **`@atrium/protocol`** | Shared **Zod** schemas for JSON wire messages (server ↔ viewer ↔ worker path through relay). |
| **`@atrium/react`**    | **`<RemoteBrowser />`** — canvas viewer, optional chrome, control state.                     |
| **`@atrium/demo`**     | Batteries-included local demo.                                                               |
| **`@atrium/cli`**      | `atrium doctor` and future helpers.                                                          |

Package-specific READMEs: [`docs/README.md`](./README.md).

---

## 3. Embed the API (`@atrium/server`)

1. Install: `pnpm add @atrium/server` (from npm when published, or `workspace:*` inside this repo).
2. Call **`atrium(config)`** with `authorize`, `policies`, **`workerDialBase`**, **`workerSharedSecret`**, and **`redis.url`** (session metadata and relay).
3. Mount **`router`** on your Express app (e.g. `app.use("/atrium", router)`).
4. On your **`http.Server`**, handle **`upgrade`** and delegate matching paths to **`handleViewerUpgrade`**.

Minimal pattern (see [`examples/express-host`](../examples/express-host/README.md)):

```ts
import { createServer } from "node:http";
import express from "express";
import { atrium } from "@atrium/server";

const app = express();
const { router, handleViewerUpgrade } = atrium({
  redis: { url: process.env.REDIS_URL ?? "redis://127.0.0.1:6379" },
  authorize: async (req) => {
    /* resolve tenant/user from your session */
    return { tenantId: "t", userId: "u" };
  },
  policies: {
    sessionTtlMs: 15 * 60_000,
    idleTtlMs: 5 * 60_000,
    maxConcurrentSessionsPerTenant: 5,
    urlAllowlist: ["*"],
    defaultViewport: { w: 1280, h: 800 },
  },
  workerDialBase: process.env.ATRIUM_WORKER_DIAL_BASE!,
  workerSharedSecret: process.env.ATRIUM_WORKER_SECRET!,
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

Full API surface: [`packages/server/README.md`](../packages/server/README.md).

---

## 4. Run the worker

The API opens an **outbound** WebSocket to  
`${ATRIUM_WORKER_DIAL_BASE}/internal/stream/:sessionId`  
with **`Authorization: Bearer`** `ATRIUM_WORKER_SECRET`.

Run locally after `pnpm build`:

```bash
export ATRIUM_WORKER_SECRET=dev-secret-change-me
pnpm --filter @atrium/worker start
```

Headed Chromium needs a display on Linux — use **Xvfb** or the **Docker** image (see root [README](../README.md#docker-worker)).

---

## 5. Embed the React viewer (`@atrium/react`)

After **`POST …/sessions`**, you receive **`sessionId`**, **`viewerToken`**, and **`wsUrl`**. Pass them to **`<RemoteBrowser />`**.

- **`interactive`** — when control is **`human`**, pointer and keyboard events on the canvas are sent to the worker.
- **`chrome`** — optional UI: **`"none"`** (default), **`"minimal"`** (URL bar + back/forward/reload), **`"full"`** (tabs + toolbar + URL bar), or a custom object **`{ showTabStrip?, showToolbar?, showUrlBar? }`**.
- **`showSessionStatus`** — toggles the small debug line (session id, control holder). Hidden by default when any chrome region is enabled unless you set it explicitly.

Full props and wire messages: [`packages/react/README.md`](../packages/react/README.md).

### Multi-tab behavior

Links that open **`target="_blank"`** (or “Open in new tab”) create a **new Playwright page** in the same context. The worker:

- Switches the **screencast** to the new tab (what you see in the viewer).
- Sends **`tabs`** messages so the client can render a tab strip when **`chrome`** includes **`showTabStrip`**.
- Sends **`tab_activate` / `tab_close`** from the client when the user selects or closes a tab (see protocol).

---

## 6. HTTP endpoints (mount prefix)

All routes are under your **`mountPath`** (default **`/atrium`**). Typical set:

| Method         | Path                             | Purpose                                                                                    |
| -------------- | -------------------------------- | ------------------------------------------------------------------------------------------ |
| `POST`         | `/sessions`                      | Create session; optional bootstrap body (`initialUrl`, `storageState`, cookies, viewport). |
| `GET`          | `/sessions/:id`                  | Session metadata.                                                                          |
| `DELETE`       | `/sessions/:id`                  | Destroy session.                                                                           |
| `POST`         | `/sessions/:id/control`          | Grant or release control (`human` / `agent`).                                              |
| `POST`         | `/sessions/:id/navigate`         | Host-driven navigation.                                                                    |
| `GET`          | `/sessions/:id/cookies`          | Export cookies.                                                                            |
| `GET`          | `/sessions/:id/storage-state`    | Playwright `storageState`.                                                                 |
| `GET` / `POST` | `/sessions/:id/session-snapshot` | Combined snapshot; POST applies to live session.                                           |
| `GET`          | `/healthz`, `/readyz`            | Health checks.                                                                             |

Host routes must use **your** authentication (`authorize`); viewer WebSocket uses **`viewerToken`**.

---

## 7. Authentication with certificates, passkeys, and hardware keys

Atrium runs Chromium **on your worker host**, so any credential that lives on the **end user's** machine is not natively available inside the remote browser. This affects three flows in different ways:

### 7a. TLS client certificates (mTLS) — supported

Pass certificates in the **`POST /sessions`** body. They are forwarded once to the worker and used by Playwright's **`BrowserContextOptions.clientCertificates`**, scoped to a specific **`origin`** (so they only apply to the site that asks for them).

**PEM cert + key:**

```json
{
  "initialUrl": "https://app.example.com/login",
  "clientCertificates": [
    {
      "origin": "https://app.example.com",
      "certBase64": "<base64 of cert.pem>",
      "keyBase64": "<base64 of key.pem>"
    }
  ]
}
```

**PFX / PKCS#12 bundle:**

```json
{
  "clientCertificates": [
    {
      "origin": "https://app.example.com",
      "pfxBase64": "<base64 of bundle.pfx>",
      "passphrase": "optional"
    }
  ]
}
```

Notes:

- Certs are kept **in worker memory** for the session and discarded when it ends. They are **never** sent to the viewer browser.
- Make sure the **`POST /sessions`** call is over **HTTPS** (your `authorize` middleware should enforce auth).
- Certificates also persist across **`POST /sessions/:id/session-snapshot`** (the API rebuilds the context with the same client certs).
- Multiple entries are allowed; each is matched by **`origin`**.

### 7b. Passkeys / WebAuthn — workaround

WebAuthn (passkeys, Touch ID, Windows Hello) requires the platform authenticator on the **user's machine**. Today Atrium does **not** relay WebAuthn ceremonies. Two workable paths:

1. **Bring-your-own-session** — let the user sign in **on their own browser**, export cookies / `storageState`, then **`POST /sessions/:id/session-snapshot`** to apply it to the remote session.
2. **Account password / SMS / OTP** — if the site offers a non-passkey factor, the human-in-the-loop flow handles it directly in the canvas.

A first-class WebAuthn relay (CDP `WebAuthn.addVirtualAuthenticator` + viewer-side ceremony) is on the roadmap.

### 7c. Hardware keys (YubiKey U2F/FIDO2) — workaround

Same constraint as passkeys: the key is physically attached to the user's device. Use the **bring-your-own-session** flow above, or fall back to a non-hardware factor.

---

## 8. Session snapshots

Export a **single JSON** blob (`cookies` + `storageState`) for backups or seeding a new session. Examples and curl snippets: [Main README — Session snapshots](../README.md#session-snapshots-cookies--storagestate).

---

## 9. Security checklist (production)

- Rotate **`ATRIUM_WORKER_SECRET`**; only your API should reach the worker dial URL.
- Treat **`viewerToken`** like a **capability URL** — short TTL, HTTPS `wss://` in production.
- Keep cookie / `storageState` endpoints on **host-authenticated** HTTP only.

More: [Main README — Security notes](../README.md#security-notes-public-facing-deployments).

---

## 10. Wire protocol types

Validate or explore message shapes with **`@atrium/protocol`** (`parseServerMessage`, `parseClientMessage`, exported schemas). See [`packages/protocol/README.md`](../packages/protocol/README.md).

---

## 11. Contributing

Issues and PRs welcome. For protocol or security proposals, read [Technical design](./remote-browser-design.md) first.
