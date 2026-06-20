---
title: Embeddable DOCX editor
description: Use Sobree when your web app needs Word-compatible .docx import, paginated browser editing, and .docx export without handing users to another office suite.
---

Sobree is an embeddable DOCX editor engine for web apps that need to keep Word-compatible documents inside their own product workflow.

Use it when your product needs to upload a `.docx`, show a paginated editing surface in the browser, let the host app own storage and UI, and export a `.docx` again without making HTML the source document model.

## Good fits

- legaltech products that edit contracts, templates, exhibits, or policy documents;
- HR and recruiting tools that generate and revise offer letters, handbooks, or review forms;
- insurance, government, and internal operations tools that still exchange Word documents;
- document automation systems that need human review before export.

## Why not just use a rich text editor?

HTML-first rich text editors are great when the final document is web content. They are a poor fit when the final artifact is a Word-compatible file with sections, headers, footers, page setup, numbering, tables, and print layout.

Sobree starts from OOXML document structure and a print-view editor surface, so `.docx` is the workflow instead of an export afterthought.

## Integration shape

```ts
import { createSobree } from "@sobree/core";
import { keyboard } from "@sobree/keyboard";
import { blockTools } from "@sobree/block-tools";
import "@sobree/core/tokens.css";

const editor = createSobree("#editor", {
  plugins: [keyboard(), blockTools()],
});

await editor.loadDocx(file);
const output = await editor.toDocx();
```

The editor core stays framework-free. Bring your own shell, persistence, auth, review flow, and product UI.

## Next steps

- Start with the [Quick start](/quick-start/).
- Read the [`createSobree()` API](/api/create-sobree/).
- Try the live editor at [sobree.dev/try](https://sobree.dev/try).
