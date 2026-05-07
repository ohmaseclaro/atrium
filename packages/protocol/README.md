# @ohmaseclaro/atrium-protocol

Shared **Zod** schemas and **TypeScript** types for Atrium **WebSocket JSON** messages (viewer ↔ API relay ↔ worker) and a few **HTTP request bodies** (session bootstrap).

**Docs hub:** [`docs/README.md`](../../docs/README.md) · **User guide:** [`docs/user-guide.md`](../../docs/user-guide.md)

## Install

```bash
npm install @ohmaseclaro/atrium-protocol
```

With pnpm: `pnpm add @ohmaseclaro/atrium-protocol`.

Most applications do not need to install this directly; `@ohmaseclaro/atrium-server`, `@ohmaseclaro/atrium-react`, and `@ohmaseclaro/atrium-worker` depend on it automatically. Install it directly when you want to validate wire messages or bootstrap payloads yourself.

## Usage

```ts
import { parseServerMessage, parseClientMessage, serverMessageSchema } from "@ohmaseclaro/atrium-protocol";

const msg = parseServerMessage(JSON.parse(text));
if (msg.t === "tabs") {
  console.log(msg.tabs);
}
```

Main exports:

- **`serverMessageSchema`**, **`ServerMessage`** — `hello`, `frame`, `control`, `navigate`, `title`, **`tabs`**, **`webauthn_required`**, `bye`, …
- **`clientMessageSchema`**, **`ClientMessage`** — `input`, `ping`, **`tab_activate`**, **`tab_close`**, **`webauthn_decision`**, `reload`, `back`, `forward`, …
- **`parseServerMessage`**, **`parseClientMessage`**
- **`sessionBootstrapBodySchema`**, **`sessionSnapshotApplyBodySchema`**, **`clientCertificateSchema`** (TLS mTLS bootstrap), …

Source of truth: [`src/index.ts`](./src/index.ts).

## Build

```bash
pnpm --filter @ohmaseclaro/atrium-protocol run build
```

MIT — see repository [`LICENSE`](../../LICENSE).
