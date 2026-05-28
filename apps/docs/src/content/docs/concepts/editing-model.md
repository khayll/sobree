---
title: Editing model
description: How you address content and what mutations return — BlockRef, positions, ranges, selection, and edit results.
---

The [document model](/concepts/document/) describes what a document *is*.
This page describes how you *address* parts of it and what every mutation
hands back. These types are runtime-only — none of them are persisted to
`.docx`. They're JSON-clean, so the same shapes work for in-process
callers, the [MCP server](/api/mcp/), and tests.

All of them are exported from `@sobree/core` and defined in
`packages/core/src/doc/api.ts` (the JSDoc there is the source of truth;
this page is the conceptual overview).

## BlockRef

A stable handle to a block, valid for the lifetime of an `Editor`
instance.

```ts
interface BlockRef {
  id: string;      // allocated by the Editor on first sight ("b1", "b2", …)
  version: number; // bumps on every modification of that block
}
```

`id` identifies the block; `version` is an **optimistic-lock token**.
Pass a `BlockRef` to a mutation and, if the block's live version no
longer matches yours, the mutation fails with an
[`optimistic-lock`](#editerror) error instead of clobbering a concurrent
edit. Versions reset to `0` when the document is reloaded
(`setDocument`, `loadDocx`).

You don't usually build a `BlockRef` by hand — you obtain one from:

- a mutation's [`EditResult.affected`](#editresult),
- the outline (`editor.getOutline()[i].block`), or
- the current [selection](#selection) (`payload.block` / `caret.block`).

## InlinePosition

Addresses a point *inside* a block's content.

```ts
interface InlinePosition {
  block: BlockRef;
  offset: number;
}
```

`offset = 0` is the start of the block's content; `offset = blockLength`
is the end. Non-text inlines (drawings, fields, hyperlinks) count as 1
each. A caret always lives inside a block — "before block N" is
`{ block: N, offset: 0 }`, "after block N" is
`{ block: N, offset: blockLength }`. To insert a **new** block next to an
existing one, use `insertBlockBefore` / `insertBlockAfter` (they take a
`BlockRef`, not a position).

Helper: `inlineAt(block, offset)`.

## Range

An inclusive span between two inline positions.

```ts
interface Range {
  from: InlinePosition;
  to: InlinePosition;
}
```

A single-block range has `from.block.id === to.block.id`. For operations
that span blocks, the `Range` pins only the endpoints — pass
`opts.expect` (a `BlockExpectations` version map) to also lock-check the
blocks in between.

Helpers: `makeRange(from, to)`, `isCollapsedRange(range)`.

## Selection

The editor's current cursor / selection in model terms — `null` when
nothing is selected (e.g. focus is outside the editor).

```ts
type Selection =
  | null
  | { kind: "caret"; at: InlinePosition }
  | { kind: "range"; range: Range };
```

Read or write it via `editor.selection`. Helpers: `caretAt(pos)`,
`isCaret(sel)`.

## EditResult

Every mutating operation returns this envelope — **errors don't throw**,
they come back as data so external callers (LLM agents, automation, MCP)
can branch on them.

```ts
type EditResult<T = void> =
  | { ok: true;  value: T; affected: BlockRef[] }
  | { ok: false; error: EditError };
```

On success, `affected` lists the blocks the operation touched, each with
its *new* version — feed those straight into your next call.

Helpers: `ok(value, affected)`, `fail(error)`.

## EditError

Why a mutation didn't apply. A discriminated union keyed on `code`, so
agents `switch` on it:

```ts
type EditError =
  | { code: "optimistic-lock"; conflicts: Array<{ blockId; expected; actual: number | null }> }
  | { code: "invalid-position"; details: string }
  | { code: "unknown-block"; blockId: string }
  | { code: "range-empty"; details: string }
  | { code: "range-out-of-order"; details: string }
  | { code: "invalid-state"; details: string };
```

For `optimistic-lock`, each conflict reports the `expected` vs `actual`
version; `actual: null` means the block was **deleted** between your read
and write (distinct from a stale version on a still-present block).
