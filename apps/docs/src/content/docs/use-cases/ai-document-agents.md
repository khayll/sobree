---
title: AI document agents
description: Use Sobree with HeadlessSobree, Y.Doc, and MCP when an AI agent needs to inspect or edit Word-compatible documents through the same model as the browser editor.
---

Sobree gives AI document agents the same document model that powers the browser editor.

Use it when an LLM, automation worker, or MCP client needs to inspect, transform, or collaborate on a Word-compatible document without scraping rendered HTML or inventing a separate representation.

## Why agents need a document model

A `.docx` workflow is not just text. Real documents carry sections, headers, footers, page setup, numbering, tables, styles, comments, and binary parts. If an agent edits a lossy projection, the human editor and exported document can drift apart.

Sobree keeps the browser editor, headless automation, and collaboration wire on the same model: OOXML-shaped document state backed by Y.Doc.

## Common patterns

- **Review assistant:** load a document, flag risky clauses, then let a human accept or rewrite changes in the browser.
- **Template filler:** insert generated text into known placeholders while preserving the surrounding document structure.
- **Policy updater:** apply bulk edits across a document set, then export `.docx` files for manual review.
- **Collaborative agent:** attach an MCP client or headless worker to the same Y.Doc room as a human editor.

## Integration shape

- Use [HeadlessSobree](/api/headless/) for no-DOM automation.
- Use [`@sobree/mcp`](/api/mcp/) when an MCP client should read or edit a document.
- Use the [Y.Doc wire API](/api/ydoc/) when browser, worker, and collaboration peers need the same live state.

The goal is simple: one document model, many surfaces. The browser, the worker, and the agent should not disagree about what the document is.
