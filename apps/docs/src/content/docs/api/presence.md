---
title: Presence
description: Remote cursors and selection highlights via Yjs awareness.
---

Presence renders **who else is in the document** — remote carets,
selection highlights, and per-user identity — on top of Yjs awareness.
Pass an `Awareness` instance (from `y-protocols/awareness`, surfaced by
`@sobree/collab-providers` handles as `handle.awareness`) plus a user
identity.

```ts
import { attachPresence, attachPresenceOverlay } from "@sobree/core";

const presence = attachPresence(editor, handle.awareness, {
  user: { name: "Alice", color: "#7c5cff" },
});
const overlay = attachPresenceOverlay(editor, handle.awareness, {
  user: { name: "Alice", color: "#7c5cff" },
  container: paperHost, // positioned ancestor of the rendered pages
});
// later
overlay.destroy();
presence.destroy();
```

## Functions

| function | what it does |
|---|---|
| `attachPresence(editor, awareness, opts)` | Publishes the local user's selection into awareness and tracks remote peers. Returns a `PresenceHandle`. |
| `attachPresenceOverlay(editor, awareness, opts)` | Everything `attachPresence` does, plus renders remote carets / selection highlights into `opts.container`. Returns a `PresenceOverlayHandle`. |
| `presenceSelectionFromEditor(editor)` | The editor's current selection in presence form (`PresenceSelection`) — for custom overlays that publish state themselves. |
| `isPresenceState(value)` | Type guard for `PresenceState` — awareness state maps carry arbitrary JSON; filter foreign entries with this. |

## Types

| type | role |
|---|---|
| `AttachPresenceOptions` | `user` identity, `publishOwnSelection?` (default `true`). |
| `AttachPresenceOverlayOptions` | Extends the above with `container` (and optional `blockHost`) the overlay renders into. |
| `PresenceHandle` / `PresenceOverlayHandle` | Live subscription — read peers, `destroy()` to detach. |
| `PresenceUser` | `{ name, color }` identity shown on carets and highlights. |
| `PresenceState` | One peer's awareness entry: `user` + current `PresenceSelection`. |
| `PresenceSelection` | Block-addressed selection (survives peers having different pagination). |
| `AwarenessLike` | The minimal awareness contract presence needs — satisfied by `y-protocols/awareness`. |
| `AwarenessChanges` | `{ added, updated, removed }` client-id sets passed to awareness change handlers. |

See the "Y.Doc + collaboration" section of
[`createSobree()`](/api/create-sobree/) for how the awareness instance
reaches your embed in the first place.
