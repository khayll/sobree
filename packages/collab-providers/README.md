# @sobree/collab-providers

Yjs provider helpers for [`@sobree/core`](https://www.npmjs.com/package/@sobree/core).

→ Docs: **[docs.sobree.dev/api/collab-providers](https://docs.sobree.dev/api/collab-providers/)**

Sobree's editor is backed by a `Y.Doc` (the Yjs CRDT) — see
`editor.ydoc`. This package wraps the canonical Yjs providers in
narrow, normalized factories so attaching persistence /
collaboration is a 5-line job.

## Install

```sh
pnpm add @sobree/core @sobree/collab-providers
```

Then install **only** the underlying provider you actually use — they're
optional peer deps:

```sh
pnpm add y-websocket   # for real-time collaboration
pnpm add y-indexeddb   # for local persistence
pnpm add y-webrtc      # for peer-to-peer ad-hoc collab
```

## Usage

### Real-time collaboration (`y-websocket`)

```ts
import * as Y from "yjs";
import { createSobree } from "@sobree/core";
import { attachWebsocketProvider } from "@sobree/collab-providers";

const ydoc = new Y.Doc();
const handle = await attachWebsocketProvider(ydoc, {
  url: "wss://collab.example.com",
  room: "doc-q2-brief",
  name: "Alice",
  color: "#f59e0b",
});

await handle.synced; // optional — wait for initial state from peers

const editor = createSobree("#editor", { ydoc });
```

### Local persistence (`y-indexeddb`)

```ts
import * as Y from "yjs";
import { createSobree } from "@sobree/core";
import { attachIndexedDBProvider } from "@sobree/collab-providers";

const ydoc = new Y.Doc();
const handle = await attachIndexedDBProvider(ydoc, { dbName: "doc-q2-brief" });
await handle.synced; // load persisted snapshot

const editor = createSobree("#editor", { ydoc });
```

### Peer-to-peer (`y-webrtc`)

```ts
import * as Y from "yjs";
import { attachWebRTCProvider } from "@sobree/collab-providers";

const ydoc = new Y.Doc();
const handle = await attachWebRTCProvider(ydoc, {
  room: "doc-q2-brief",
  password: "shared-secret-please",
});
```

Best for small (≤4 peer) ad-hoc collab where you don't want a relay
server. For more peers / persistence / authoritative state, use
`attachWebsocketProvider` against `@sobree/collab-server`.

### In-memory loopback (tests / demos)

```ts
import { loopback } from "@sobree/collab-providers";
const { a, b, destroy } = loopback();
// a and b are two Y.Docs that auto-sync. Use a as one editor's ydoc,
// b as another's; mutations on either propagate.
```

## CollabHandle

Every factory returns the same shape:

```ts
interface CollabHandle {
  readonly provider: unknown;          // peek for advanced provider-specific methods
  readonly awareness: Awareness | null; // null for y-indexeddb (no presence channel)
  readonly synced: Promise<void>;      // resolves after initial sync
  destroy(): void;                     // disconnect + remove listeners
}
```

## License

MIT.
