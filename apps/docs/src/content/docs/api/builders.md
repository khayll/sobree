---
title: Document builders
description: Constructors for SobreeDocument nodes — paragraph, heading, runs.
---

Pure helpers that build AST nodes with sensible defaults. Use these
rather than constructing literals — they apply defaults consistently
and absorb schema migrations when fields are added.

## Top-level

```ts
import { emptyDocument, defaultSection, appendBlock } from "@sobree/core";

emptyDocument();              // SobreeDocument with one empty paragraph
defaultSection();             // SectionProperties — A4 portrait, 1" margins
appendBlock(doc, block);      // mutates doc.body, returns doc
```

## Blocks

```ts
import { paragraph, heading } from "@sobree/core";

paragraph(runs?, properties?);
// → { kind: "paragraph", properties, runs }

heading(level, runs?, extraProperties?);
// → paragraph with styleId: "Heading{level}"
//   level is clamped to 1..6
```

## Inline runs

```ts
import { text, emphasis, strong, softBreak, pageBreak } from "@sobree/core";

text("hello");                                     // TextRun
text("hello", { bold: true, color: "#c96f22" });   // with run properties

emphasis("hello");                                 // text + italic
strong("hello");                                   // text + bold

softBreak();                                       // BreakRun, type: "line" — Shift-Enter equivalent
pageBreak();                                       // BreakRun, type: "page" — explicit page break
```

## Section structure

Sections live in `doc.sections`, delimited by `SectionBreak` blocks in
the body. The first section starts at `body[0]`; each `SectionBreak`
ends one and starts the next.

```ts
import { defaultSection, appendBlock, paragraph, text } from "@sobree/core";

const doc = emptyDocument();
doc.body = [];
doc.sections = [
  { ...defaultSection(), titlePage: true, vAlign: "center", type: "nextPage" },
  { ...defaultSection() },
];
appendBlock(doc, paragraph([text("Title")]));
appendBlock(doc, { kind: "section_break", toSectionIndex: 1 });
appendBlock(doc, paragraph([text("Chapter 1")]));
```

## Header / footer bodies

Stored at the document level, keyed by the part id. Section properties
reference them by id:

```ts
import { templateToBlocks } from "@sobree/core";

doc.headerFooterBodies = {
  "header1.xml": templateToBlocks("Document title"),
  "footer1.xml": templateToBlocks("Page {page} of {pages}"),
};
doc.sections[0].headerRefs = [{ type: "default", partId: "header1.xml" }];
doc.sections[0].footerRefs = [{ type: "default", partId: "footer1.xml" }];
```

`templateToBlocks` understands `{page}` / `{pages}` field tokens and
emits `FieldRun` nodes that round-trip to `<w:fldSimple>` in the
exported `.docx`.
