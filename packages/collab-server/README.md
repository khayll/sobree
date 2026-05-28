# @sobree/collab-server

Node-only y-protocol relay + persister for Sobree.

→ Docs: **[docs.sobree.dev/api/collab-server](https://docs.sobree.dev/api/collab-server/)**

One process can host many rooms; each room is one Y.Doc shared by N
peers. The server speaks pure y-protocol — it doesn't instantiate an
Editor and doesn't know about Sobree's AST or DOCX format. This is
the load-bearing simplification that lets one Node process host
thousands of rooms cheaply.

## Install

```sh
pnpm add @sobree/collab-server
```

## Quick start

```ts
import { SobreeCollabServer, filesystemPersistence } from "@sobree/collab-server";

const server = new SobreeCollabServer({
  port: 1234,
  persistence: filesystemPersistence({ dir: "./data" }),
});

await server.listen();
console.log("collab server on ws://localhost:1234/<room-id>");
```

Clients connect via the standard `y-websocket` provider — the server
speaks the same wire format. From a Sobree app:

```ts
import * as Y from "yjs";
import { createSobree } from "@sobree/core";
import { attachWebsocketProvider } from "@sobree/collab-providers";

const ydoc = new Y.Doc();
const collab = await attachWebsocketProvider(ydoc, {
  url: "ws://localhost:1234",
  room: "doc-q2-brief",
  name: "Alice",
  color: "#f59e0b",
});
await collab.synced;
const editor = createSobree("#editor", { ydoc });
```

## Persistence

Two backends ship out of the box:

```ts
import { filesystemPersistence, memoryPersistence } from "@sobree/collab-server";

// One file per room under ./data/<room-path>.ydoc
filesystemPersistence({ dir: "./data" });

// Ephemeral; lost on restart. Useful for tests / dev.
memoryPersistence();
```

For production at scale, write a custom backend against S3 / R2 /
Postgres / Redis — the interface is small:

```ts
interface Persistence {
  load(roomId: string): Promise<Uint8Array | null>;
  save(roomId: string, update: Uint8Array): Promise<void>;
  delete?(roomId: string): Promise<void>;
}
```

Pass any conformant object to `SobreeCollabServer` via `persistence`.

## Auth

Optional `onConnection` hook runs before the peer joins a room.
Three return shapes:

- `true` — accept with full read/write
- `false` — reject (WebSocket closes with code 1008)
- `{ allow: true, write: false }` — accept as read-only

```ts
const server = new SobreeCollabServer({
  port: 1234,
  persistence: filesystemPersistence({ dir: "./data" }),
  onConnection: async ({ req, roomId }) => {
    const token = new URL(req.url ?? "", "http://x").searchParams.get("token");
    const claims = await verifyToken(token, roomId);
    if (!claims) return false;
    return { allow: true, write: claims.role !== "viewer" };
  },
});
```

The hook receives the raw HTTP upgrade request, so headers / cookies /
client IP are all available.

## Read-only peers

Read-only peers can read and publish presence (cursors) but their Y
sync-update messages are dropped server-side. They see other peers'
edits arrive normally.

```ts
onConnection: ({ roomId }) => {
  if (roomId.startsWith("public/")) {
    return { allow: true, write: false };
  }
  return { allow: true, write: true };
}
```

## Leader-election for empty-room seeding

When a peer joins a room, the server sends a **session message**
(message type 2, JSON-encoded) immediately, before any sync state:

```ts
interface SessionPayload {
  isEmpty: boolean;     // true if Y.Doc body was empty at join time
  isWritable: boolean;  // false for read-only peers
  peerCount: number;    // other peers currently in the room
}
```

The client uses `isEmpty` to decide whether to seed `initialDocument`.
Only one peer per fresh room sees `isEmpty: true` — subsequent joiners
adopt the existing state instead. Without this signal, two clients
connecting near-simultaneously to a fresh room would both seed and
create divergent docs.

Custom client wire format:

```
[varuint message-type] [type-specific payload]

type 0 (SYNC)       — y-protocols/sync
type 1 (AWARENESS)  — y-protocols/awareness encoded update
type 2 (SESSION)    — varString JSON-encoded SessionPayload
type 3 (ASSETS)     — reserved for content-hashed parts (not yet implemented)
```

A complete custom client implementation lives in
`src/server.test.ts` (under `connectAndSync`) and
`src/permissions.test.ts` (under `wrapConnection`). Production code
using the standard `y-websocket` provider can extend its
`messageHandlers` array to handle type 2:

```ts
import { WebsocketProvider, messageHandlers } from "y-websocket";
messageHandlers[2] = (encoder, decoder, provider) => {
  const json = decoding.readVarString(decoder);
  const session = JSON.parse(json);
  // Decide whether to seed initialDocument based on session.isEmpty
};
```

## Room routing

By default the room id is the URL pathname (with leading `/` stripped).
Override `resolveRoomId` for sub-app routing or auth-derived keys:

```ts
new SobreeCollabServer({
  port: 1234,
  resolveRoomId: (req) => {
    const u = new URL(req.url ?? "", "http://x");
    return `${u.pathname.split("/")[1]}/${u.searchParams.get("doc")}`;
  },
});
```

## Lifecycle

- Rooms are created on first peer join (with state hydrated from
  persistence if available).
- Y updates from peers are applied to the room's Y.Doc and broadcast
  to other peers in the room.
- Awareness updates flow through unchanged (cursors, presence).
- Persistence writes are debounced (default 2s) to amortize disk I/O.
- When the last peer leaves, the room is kept alive for a grace
  period (default 30s) for reconnects. After that, final state is
  persisted and the room is destroyed.
- Graceful `server.close()` flushes every active room before shutdown.

## What's NOT in here

- **Authentication.** Provide your own via `onConnection`.
- **Authorization beyond room-level read/write.** Field-level ACL
  (e.g. "this user can only edit comments") would require a
  validating relay that parses Y updates. Achievable as a separate
  middleware that intercepts sync-update messages before they reach
  the room.
- **Asset offloading.** Content-hashed binary parts (images, fonts)
  riding a side-channel blob store rather than the Y.Doc is not
  implemented in the server. Today binary parts ride along inside
  Y.Doc updates. (`@sobree/core` ships a content-hashed `BlobStore`,
  but the server has no asset wire channel — message type 3 is
  reserved and unhandled.)
- **MCP integration.** A Y peer that exposes an LLM-friendly RPC face
  lives in the separate `@sobree/mcp` package, not in the relay.

## License

MIT.
