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
