/**
 * Tiny Markdown → SobreeDocument parser.
 *
 * **Scope: seed content for hello-world demos.** This is *not* a real
 * Markdown processor — it doesn't round-trip, doesn't handle every
 * CommonMark edge case, and never will. The point is so people can
 * skip the AST builders for example content:
 *
 * ```ts
 * createSobree("#editor", { content: "# Title\n\nFirst paragraph." });
 * ```
 *
 * Supported:
 *   - ATX headings (`#` … `######`)
 *   - Paragraphs (blank-line separated)
 *   - Bold (`**...**`), italic (`*...*` or `_..._`), inline code (`` `...` ``)
 *   - Hyperlinks `[text](url)`
 *   - Hard line break — two trailing spaces
 *   - Bulleted lists (`- ` / `* `) — single level
 *   - Numbered lists (`1. `) — single level
 *
 * Not supported (use the AST builders instead):
 *   - Tables, blockquotes, code fences, images, HTML, nested lists,
 *     reference-style links, footnotes, autolinks.
 */

import { appendBlock, emptyDocument, heading, paragraph, text } from "../doc/builders";
import type {
  HyperlinkRun,
  InlineRun,
  NumberingDefinition,
  Paragraph,
  RunProperties,
  SobreeDocument,
  TextRun,
} from "../doc/types";

/**
 * Parse a Markdown string into a `SobreeDocument`. Always returns a
 * valid document; unsupported syntax falls through as plain text.
 */
export function parseMarkdown(md: string): SobreeDocument {
  const doc = emptyDocument();
  // emptyDocument() seeds an empty paragraph; drop it so the first
  // converted block is the document's first block.
  doc.body = [];
  // Override the default styles with markdown-friendly typography:
  // 1.15× line + 8pt space-after on Normal so blank-line paragraphs
  // visually separate, and modest before/after on headings so they
  // breathe in body flow. Default builders are intentionally bare
  // (Word-hardcoded-default tight) so docx round-trip stays
  // byte-faithful — markdown content has different expectations and
  // overrides per-style here, on the document itself.
  applyMarkdownStyleOverrides(doc);

  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const ctx: ParseContext = { doc, listState: null };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";

    // Blank line — close any open list and skip.
    if (line.trim() === "") {
      ctx.listState = null;
      i++;
      continue;
    }

    // Heading?
    const headingMatch = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (headingMatch) {
      ctx.listState = null;
      const level = headingMatch[1]!.length;
      const content = headingMatch[2]!;
      appendBlock(doc, heading(level, parseInline(content)));
      i++;
      continue;
    }

    // List item?
    const ul = /^(\s*)([-*])\s+(.+)$/.exec(line);
    const ol = /^(\s*)(\d+)\.\s+(.+)$/.exec(line);
    if (ul || ol) {
      const ordered = ol !== null;
      const content = (ol ?? ul)![3]!;
      const para = listItemParagraph(ctx, ordered, parseInline(content));
      appendBlock(doc, para);
      i++;
      continue;
    }

    // Paragraph — gather subsequent non-blank, non-special lines.
    ctx.listState = null;
    const buf: string[] = [line];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j] ?? "";
      if (next.trim() === "") break;
      if (/^#{1,6}\s+/.test(next)) break;
      if (/^\s*[-*]\s+/.test(next)) break;
      if (/^\s*\d+\.\s+/.test(next)) break;
      buf.push(next);
      j++;
    }
    // No explicit spacing — the Normal style's `paragraphDefaults`
    // (set by `defaultStyles()` in builders.ts) provide 8pt space-after
    // and 1.15× line height through the cascade. Empty `properties: {}`
    // means "use Normal" — exactly how a bare Word paragraph behaves.
    appendBlock(doc, paragraph(parseInlineWithBreaks(buf)));
    i = j;
  }

  // Always end with at least one paragraph so the editor has a caret target.
  if (doc.body.length === 0) doc.body.push(paragraph());

  return doc;
}

interface ParseContext {
  doc: SobreeDocument;
  /** Open list, or null between lists. Carries the allocated numId. */
  listState: { numId: number; ordered: boolean } | null;
}

function listItemParagraph(ctx: ParseContext, ordered: boolean, runs: InlineRun[]): Paragraph {
  // Reuse the open list if the new item matches its kind, otherwise
  // open a fresh one with a freshly-allocated numId.
  if (!ctx.listState || ctx.listState.ordered !== ordered) {
    const numId = allocateNumId(ctx.doc);
    ctx.doc.numbering.push(definitionFor(numId, ordered));
    ctx.listState = { numId, ordered };
  }
  return paragraph(runs, {
    numbering: { numId: ctx.listState.numId, level: 0 },
  });
}

function allocateNumId(doc: SobreeDocument): number {
  if (doc.numbering.length === 0) return 1;
  const max = doc.numbering.reduce((n, def) => Math.max(n, def.numId), 0);
  return max + 1;
}

function definitionFor(numId: number, ordered: boolean): NumberingDefinition {
  return {
    numId,
    abstractFormat: {
      levels: [
        ordered
          ? {
              level: 0,
              format: "decimal",
              text: "%1.",
            }
          : {
              level: 0,
              format: "bullet",
              text: "•",
            },
      ],
    },
  };
}

// === inline parser ===

/**
 * Parse a single line of inline markdown into runs. Handles bold,
 * italic, inline code, and links — with a tiny tokenise / span-match
 * approach. Anything that doesn't match falls through as plain text.
 */
function parseInline(line: string, base: RunProperties = {}): InlineRun[] {
  const out: InlineRun[] = [];
  let i = 0;
  let plain = "";

  const flushPlain = () => {
    if (plain) {
      out.push(text(plain, base));
      plain = "";
    }
  };

  while (i < line.length) {
    const rest = line.slice(i);

    // Link: [text](href)
    const link = /^\[([^\]]+)\]\(([^)]+)\)/.exec(rest);
    if (link) {
      flushPlain();
      const linkRun: HyperlinkRun = {
        kind: "hyperlink",
        href: link[2]!,
        children: parseInline(link[1]!, base),
      };
      out.push(linkRun);
      i += link[0].length;
      continue;
    }

    // Bold (**...**)
    if (rest.startsWith("**")) {
      const close = rest.indexOf("**", 2);
      if (close > 0) {
        flushPlain();
        const inner = rest.slice(2, close);
        out.push(...parseInline(inner, { ...base, bold: true }));
        i += close + 2;
        continue;
      }
    }

    // Italic (*...* or _..._)
    const italicChar = rest[0];
    if (italicChar === "*" || italicChar === "_") {
      const close = rest.indexOf(italicChar, 1);
      // Avoid empty italics and accidental list-marker matches handled at block level.
      if (close > 1 && rest[close - 1] !== " ") {
        flushPlain();
        const inner = rest.slice(1, close);
        out.push(...parseInline(inner, { ...base, italic: true }));
        i += close + 1;
        continue;
      }
    }

    // Inline code (`...`)
    if (rest[0] === "`") {
      const close = rest.indexOf("`", 1);
      if (close > 0) {
        flushPlain();
        const inner = rest.slice(1, close);
        const codeRun: TextRun = {
          kind: "text",
          text: inner,
          properties: { ...base, fontFamily: "Menlo, Consolas, monospace" },
        };
        out.push(codeRun);
        i += close + 1;
        continue;
      }
    }

    // Escape: `\*`, `\_`, etc. — keep the next char literal.
    if (rest[0] === "\\" && rest.length > 1) {
      plain += rest[1];
      i += 2;
      continue;
    }

    plain += rest[0];
    i++;
  }
  flushPlain();
  return out;
}

/**
 * Parse a multi-line paragraph body. Trailing two-space sequences
 * become hard breaks; otherwise lines are joined with a space.
 */
function parseInlineWithBreaks(lines: string[]): InlineRun[] {
  const out: InlineRun[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const hardBreak = / {2}$/.test(raw);
    const cleaned = raw.replace(/\s+$/, "");
    out.push(...parseInline(cleaned));
    if (i < lines.length - 1) {
      if (hardBreak) {
        out.push({ kind: "break", type: "line" });
      } else {
        out.push(text(" "));
      }
    }
  }
  return out;
}

/**
 * Tweak the document's named-style defaults for markdown content:
 * loosens Normal (1.15 line + 8pt after) and gives headings explicit
 * before/after spacing.
 *
 * Mutates `doc.styles` in place. Called once per `parseMarkdown` so
 * every paragraph's style cascade picks up the markdown-flavoured
 * spacing without needing inline `properties.spacing` per block.
 */
function applyMarkdownStyleOverrides(doc: SobreeDocument): void {
  for (const style of doc.styles) {
    if (style.id === "Normal") {
      style.paragraphDefaults = {
        ...style.paragraphDefaults,
        spacing: {
          ...(style.paragraphDefaults?.spacing ?? {}),
          line: 276,
          lineRule: "auto",
          afterTwips: 160,
        },
      };
    } else if (/^Heading[1-6]$/.test(style.id)) {
      // Heading1 gets the most before-space; lower levels scale down.
      const level = Number.parseInt(style.id.slice(7), 10);
      const before = Math.max(120, 320 - (level - 1) * 40);
      style.paragraphDefaults = {
        ...style.paragraphDefaults,
        spacing: {
          ...(style.paragraphDefaults?.spacing ?? {}),
          line: 276,
          lineRule: "auto",
          beforeTwips: before,
          afterTwips: 80,
        },
      };
    }
  }
}
