---
title: Zone editing
description: In-place header / footer template editing.
---

Headers and footers render **substituted** text (`Page 3 of 16`), but
what the user edits is the **template** (`Page {page} of {pages}`).
`enterZoneEdit` makes a rendered zone editable in place: it swaps the
substituted text for its template, and on commit (blur, Enter, Escape,
click outside, or calling the returned function) writes the new
template back to the right slot on the `PageSetup`.

The block-tools plugin uses this for its header/footer gutter toggle —
it's exported for custom shells that build their own zone UI.

```ts
import { enterZoneEdit } from "@sobree/core";

const finish = enterZoneEdit({
  zone,                       // the rendered header/footer element
  kind: "header",             // ZoneKind: "header" | "footer"
  stackRoot,                  // the paper stack root (commit-on-click-outside)
  getSetup: () => sobree.getPageSetup(),
  setSetup: (next) => sobree.setPageSetup(next),
  onExit: () => indicator.reset(),
});
// programmatic exit (e.g. toggling the same control again):
finish();
```

## Types

| type | role |
|---|---|
| `ZoneKind` | `"header" \| "footer"`. |
| `EnterZoneEditOptions` | The wiring above — zone element, kind, stack root, `getSetup`/`setSetup` accessors, `onExit` callback. |

First/last-page-different setups are handled for you: the edit writes
to the template slot (`first` / `last` / `default`) that the clicked
zone actually renders.
