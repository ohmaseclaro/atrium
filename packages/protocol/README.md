# @atrium/protocol

Shared **Zod** schemas and **TypeScript** types for Atrium **WebSocket JSON** messages (viewer ↔ API relay ↔ worker) and a few **HTTP request bodies** (session bootstrap).

**Docs hub:** [`docs/README.md`](../../docs/README.md) · **User guide:** [`docs/user-guide.md`](../../docs/user-guide.md)

## Install

```bash
pnpm add @atrium/protocol
```

## Usage

```ts
import { parseServerMessage, parseClientMessage, serverMessageSchema } from "@atrium/protocol";

const msg = parseServerMessage(JSON.parse(text));
if (msg.t === "tabs") {
  console.log(msg.tabs);
}
```

Main exports:

- **`serverMessageSchema`**, **`ServerMessage`** — `hello`, `frame`, `control`, `navigate`, `title`, **`tabs`**, `bye`, …
- **`clientMessageSchema`**, **`ClientMessage`** — `input`, `ping`, **`tab_activate`**, **`tab_close`**, `reload`, `back`, `forward`, …
- **`parseServerMessage`**, **`parseClientMessage`**
- **`sessionBootstrapBodySchema`**, **`sessionSnapshotApplyBodySchema`**, …

Source of truth: [`src/index.ts`](./src/index.ts).

## Build

```bash
pnpm --filter @atrium/protocol run build
```

MIT — see repository [`LICENSE`](../../LICENSE).
