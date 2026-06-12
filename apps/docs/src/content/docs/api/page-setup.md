---
title: Page setup
description: The PageSetup model — sizes, margins, headers/footers, templates.
---

`PageSetup` is the per-section page model the paper stack renders from:
size, orientation, margins, header/footer **templates**, and vertical
alignment. Read and write it through `Sobree.getPageSetup()` /
`setPageSetup()` (see [Sobree](/api/sobree/)); the pieces below are the
model itself.

```ts
import { DEFAULT_PAGE_SETUP, PAGE_SIZES } from "@sobree/core";
import type { PageSetup } from "@sobree/core";

const setup: PageSetup = {
  ...DEFAULT_PAGE_SETUP,
  size: "Letter",
  orientation: "landscape",
  footer: { ...DEFAULT_PAGE_SETUP.footer, default: "Page {page} of {pages}" },
};
```

## Values

| export | what it is |
|---|---|
| `PAGE_SIZES` | `Record<PageSizeKey, {width, height}>` in **mm** — A3, A4, A5, B5, Letter, Legal, Tabloid. |
| `DEFAULT_PAGE_SETUP` | A4 portrait, 25/20 mm margins, `"Page {page} of {pages}"` footer. |

## Types

| type | role |
|---|---|
| `PageSetup` | `{ size, orientation, margins, header, footer, verticalAlign }`. |
| `PageSizeKey` | The keys of `PAGE_SIZES`. |
| `Orientation` | `"portrait" \| "landscape"`. |
| `Margins` | `{ top, right, bottom, left }` in mm. |
| `PageZoneText` | A header/footer: `default` / `first` / `last` template strings + `differentFirst` / `differentLast` flags. Templates may use `{page}` and `{pages}`. |
| `VerticalAlign` | Section vertical alignment — `"top"` (default), `"center"`, `"bottom"`, `"both"`. |

## Templates ↔ blocks

Header/footer templates are strings with field tokens; the document
model stores zones as blocks with `FieldRun` nodes (so Word's
PAGE/NUMPAGES field codes round-trip).

| function | what it does |
|---|---|
| `templateToBlocks(template)` | `"Page {page} of {pages}"` → `Block[]`, one paragraph per line, tokens as field runs. |
| `blocksToTemplate(blocks)` | The inverse — used on DOCX import. |

For editing zones in place, see [Zone editing](/api/zone-editing/).
