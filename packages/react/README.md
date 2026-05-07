# @atrium/react

React **viewer** for Atrium remote browser sessions: WebSocket connection to your API relay, **JPEG frames** on a `<canvas>`, and optional **embedded browser chrome** (tabs, URL bar, navigation).

**Docs hub:** [`docs/README.md`](../../docs/README.md) · **User guide:** [`docs/user-guide.md`](../../docs/user-guide.md)

## Install

```bash
pnpm add @atrium/react @atrium/protocol
```

(`@atrium/protocol` is a peer-style dependency for types; it is already listed as a dependency of this package.)

## Usage

```tsx
import { RemoteBrowser } from "@atrium/react";

<RemoteBrowser
  sessionId={session.sessionId}
  viewerToken={session.viewerToken}
  wsUrl={session.wsUrl}
  interactive
  chrome="full"
  onControlChange={(holder) => console.log(holder)}
  onTerminated={(reason) => console.log(reason)}
/>;
```

### Props

| Prop                    | Type                         | Description                                                                                                                            |
| ----------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **`sessionId`**         | `string`                     | Session id (for your UI / logging).                                                                                                    |
| **`viewerToken`**       | `string`                     | Query param added to `wsUrl` as `token` for the viewer WebSocket.                                                                      |
| **`wsUrl`**             | `string`                     | Absolute `ws:` / `wss:` URL from `POST /sessions`.                                                                                     |
| **`interactive`**       | `boolean`                    | When `true` and control is **`human`**, forwards pointer, wheel, and keyboard events from the canvas.                                  |
| **`chrome`**            | `RemoteBrowserChromeOptions` | Optional UI around the canvas (see below). Default: **`none`**.                                                                        |
| **`showSessionStatus`** | `boolean`                    | Session / control status line. Default: **`true`** if no chrome; **`false`** if any chrome region is on (set explicitly to show both). |
| **`onControlChange`**   | `(holder) => void`           | `agent` \| `human` \| `idle`.                                                                                                          |
| **`onTerminated`**      | `(reason) => void`           | Session ended.                                                                                                                         |
| **`webauthnPrompt`**    | `boolean`                    | Default `true`. When `false`, auto-**dismiss** every passkey request so the site falls back to password / OTP.                         |
| **`onWebAuthnRequest`** | `(req) => void`              | Telemetry / custom-UX hook for passkey requests (`{ id, ceremony, rpId, origin }`).                                                    |
| **`style`**             | `CSSProperties`              | Root wrapper.                                                                                                                          |

### Optional chrome (`chrome` prop)

Presets:

- **`"none"`** — Canvas only (plus default status line unless disabled).
- **`"minimal"`** — Read-only **URL bar** + **back / forward / reload** (no tab strip).
- **`"full"`** — **Tab strip** + toolbar + URL bar (embedded-browser look).

Custom object (mix and match):

```ts
chrome={{
  showTabStrip: true,
  showToolbar: true,
  showUrlBar: true,
}}
```

Omitted flags default to **`false`**. Use the exported helper to match preset logic in your own UI:

```ts
import { resolveRemoteBrowserChrome } from "@atrium/react";

const flags = resolveRemoteBrowserChrome("minimal");
```

### Passkey / WebAuthn modal

When the remote page calls `navigator.credentials.{get,create}` with a `publicKey`, the worker sends a `webauthn_required` event and `<RemoteBrowser />` opens a built-in modal with two actions:

- **Use another method** — sends `webauthn_decision: dismiss`; the page rejects with `NotAllowedError` so the site falls back to password / OTP.
- **Sign in on my browser →** — opens the rpId / origin in a new tab on the **user's** machine and dismisses the remote call. After the user signs in locally, your host applies their cookies / `storageState` via `POST /sessions/:id/session-snapshot`.

Why no "Continue / native passkey" button? Chromium's passkey UI (including the cross-device QR window) is an OS-level dialog rendered outside the page, so the screencast doesn't capture it — letting the page proceed would just hang the remote tab.

Disable the built-in modal with `webauthnPrompt={false}` (auto-dismisses every request — useful when you've wired your own UX via `onWebAuthnRequest`).

### Pointer coordinates

The live JPEG may be **letterboxed** inside the viewer (`object-fit: contain`) while the session keeps a fixed **viewport** aspect ratio from `hello`. Pointer events are mapped through the **visible image** rectangle so clicks line up with Playwright `page.mouse` coordinates.

### Wire messages handled

JSON frames are parsed with **`parseServerMessage`** from **`@atrium/protocol`**. The component updates UI from:

- **`hello`** — viewport, initial control.
- **`control`** — control holder changes.
- **`tabs`** — tab list (`id`, `url`, `title`, `active`); drives the tab strip when enabled.
- **`navigate`**, **`title`** — active page URL / title for the omnibox.

Client messages for chrome actions (when the WebSocket is open):

- **`tab_activate`**, **`tab_close`**, **`back`**, **`forward`**, **`reload`**

### Build

```bash
pnpm --filter @atrium/react run build
```

MIT — see repository [`LICENSE`](../../LICENSE).
