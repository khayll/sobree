/**
 * Conversion between Sobree's `InlineRun[]` model and Yjs Y.Text's
 * delta representation.
 *
 * # Why deltas
 *
 * Y.Text exposes its content as a "delta" — an array of insert
 * operations, each with an optional `attributes` map. Plain text:
 *
 *   [{ insert: "Hello, " }, { insert: "world", attributes: { bold: true } }]
 *
 * Embedded non-string content (line breaks, tabs, drawings, fields)
 * becomes an "embed" — an object literal in `insert`:
 *
 *   [{ insert: "Hello" }, { insert: { __sobree: "break", type: "line" } }]
 *
 * # Sobree InlineRun ↔ delta mapping
 *
 * | InlineRun kind  | Delta op                                                            |
 * |-----------------|---------------------------------------------------------------------|
 * | `text`          | `{ insert: text, attributes: <run-property marks> }`                |
 * | `break`         | `{ insert: { __sobree: "break", type } }`                           |
 * | `tab`           | `{ insert: { __sobree: "tab" } }`                                   |
 * | `field`         | `{ insert: { __sobree: "field", instruction, cached? } }`           |
 * | `drawing`       | `{ insert: { __sobree: "drawing", partPath, … } }`                  |
 * | `hyperlink`     | recursively expand children; each char gets a `link: { href }` mark |
 *
 * The `__sobree` discriminator prefix avoids any future collision with
 * Yjs-internal attribute names.
 *
 * # Hyperlinks
 *
 * Sobree's model has hyperlinks as a *container* run with nested
 * children — OOXML's `<w:hyperlink>` element. Y.Text marks are flat
 * (per-char attributes). To round-trip:
 *
 *   - Encode: every char in a hyperlink's children gets a
 *     `link: { href }` attribute. Nested formatting (bold inside link)
 *     stays as separate marks alongside `link`.
 *   - Decode: walk the delta; group consecutive ops with the same
 *     `link.href` into a HyperlinkRun whose children are the inner
 *     runs (with the `link` mark stripped).
 *
 * Nested hyperlinks aren't valid OOXML and aren't supported. The
 * decoder treats them as the outermost link.
 */

import type {
  BreakRun,
  DrawingRun,
  FieldRun,
  HyperlinkRun,
  InlineRun,
  RunProperties,
  TabRun,
  TextRun,
} from "../doc/types";

export interface DeltaOp {
  /** Text content (string) or embed (object literal). Y.Text differentiates by typeof. */
  insert: string | EmbedContent;
  /** Per-op marks — bold, italic, color, link, etc. Undefined when
   *  no marks apply (Yjs preference: omit rather than set empty). */
  attributes?: Record<string, unknown>;
}

/** All non-text run kinds become embed objects in the delta. */
export type EmbedContent =
  | { __sobree: "break"; type: BreakRun["type"] }
  | { __sobree: "tab" }
  | { __sobree: "field"; instruction: string; cached?: string }
  | {
      __sobree: "drawing";
      partPath: string;
      widthEmu: number;
      heightEmu: number;
      placement: DrawingRun["placement"];
      altText?: string;
    };

/** The `link` mark — stamped on every char inside a HyperlinkRun. */
export interface LinkMark {
  href: string;
}

// === runs → delta ===

export function runsToDelta(runs: readonly InlineRun[]): DeltaOp[] {
  const out: DeltaOp[] = [];
  appendRuns(runs, out, undefined);
  return out;
}

function appendRuns(
  runs: readonly InlineRun[],
  out: DeltaOp[],
  parentMarks: Record<string, unknown> | undefined,
): void {
  for (const run of runs) {
    appendRun(run, out, parentMarks);
  }
}

function appendRun(
  run: InlineRun,
  out: DeltaOp[],
  parentMarks: Record<string, unknown> | undefined,
): void {
  if (run.kind === "text") {
    const marks = mergeMarks(parentMarks, runPropsToAttrs(run.properties));
    pushOp(out, run.text, marks);
    return;
  }
  if (run.kind === "break") {
    const marks = mergeMarks(parentMarks, runPropsToAttrs(run.properties));
    pushOp(out, { __sobree: "break", type: run.type }, marks);
    return;
  }
  if (run.kind === "tab") {
    const marks = mergeMarks(parentMarks, runPropsToAttrs(run.properties));
    pushOp(out, { __sobree: "tab" }, marks);
    return;
  }
  if (run.kind === "field") {
    const marks = mergeMarks(parentMarks, runPropsToAttrs(run.properties));
    const embed: EmbedContent = {
      __sobree: "field",
      instruction: run.instruction,
    };
    if (run.cached !== undefined) (embed as { cached?: string }).cached = run.cached;
    pushOp(out, embed, marks);
    return;
  }
  if (run.kind === "drawing") {
    const embed: EmbedContent = {
      __sobree: "drawing",
      partPath: run.partPath,
      widthEmu: run.widthEmu,
      heightEmu: run.heightEmu,
      placement: run.placement,
    };
    if (run.altText) (embed as { altText?: string }).altText = run.altText;
    pushOp(out, embed, parentMarks);
    return;
  }
  if (run.kind === "hyperlink") {
    const linkMark: LinkMark = { href: run.href };
    const childMarks = mergeMarks(parentMarks, {
      ...runPropsToAttrs(run.properties),
      link: linkMark,
    });
    appendRuns(run.children, out, childMarks);
    return;
  }
}

function pushOp(
  out: DeltaOp[],
  insert: string | EmbedContent,
  attributes: Record<string, unknown> | undefined,
): void {
  const op: DeltaOp = { insert };
  if (attributes && Object.keys(attributes).length > 0) {
    op.attributes = attributes;
  }
  out.push(op);
}

function mergeMarks(
  parent: Record<string, unknown> | undefined,
  child: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!parent && !child) return undefined;
  if (!parent) return child;
  if (!child) return parent;
  return { ...parent, ...child };
}

// === delta → runs ===

export function deltaToRuns(delta: readonly DeltaOp[]): InlineRun[] {
  const out: InlineRun[] = [];
  let i = 0;
  while (i < delta.length) {
    const op = delta[i];
    if (!op) {
      i++;
      continue;
    }
    const linkAttr = readLinkMark(op.attributes);

    if (linkAttr) {
      // Group consecutive ops with the same link.
      const linkChildren: InlineRun[] = [];
      let j = i;
      while (j < delta.length) {
        const peek = delta[j];
        if (!peek) break;
        const peekLink = readLinkMark(peek.attributes);
        if (!peekLink || peekLink.href !== linkAttr.href) break;
        const stripped: DeltaOp = { insert: peek.insert };
        const peekAttrs = peek.attributes;
        if (peekAttrs) {
          const cleaned = stripKey(peekAttrs, "link");
          if (Object.keys(cleaned).length > 0) stripped.attributes = cleaned;
        }
        linkChildren.push(...deltaToRuns([stripped]));
        j++;
      }
      const link: HyperlinkRun = {
        kind: "hyperlink",
        href: linkAttr.href,
        children: linkChildren,
      };
      out.push(link);
      i = j;
      continue;
    }

    out.push(opToRun(op));
    i++;
  }
  return out;
}

function opToRun(op: DeltaOp): InlineRun {
  if (typeof op.insert === "string") {
    const properties = attrsToRunProps(op.attributes);
    const text: TextRun = { kind: "text", text: op.insert, properties };
    return text;
  }
  // Defensive: if `insert` is missing or unrecognized, fall back to
  // an empty text run rather than crashing. Forward-compat for
  // future unknown embed kinds.
  const embed = op.insert as EmbedContent | undefined;
  if (!embed || typeof embed !== "object") {
    return { kind: "text", text: "", properties: {} };
  }
  if (embed.__sobree === "break") {
    const props = attrsToRunProps(op.attributes);
    const r: BreakRun = { kind: "break", type: embed.type };
    if (Object.keys(props).length > 0) r.properties = props;
    return r;
  }
  if (embed.__sobree === "tab") {
    const props = attrsToRunProps(op.attributes);
    const r: TabRun = { kind: "tab" };
    if (Object.keys(props).length > 0) r.properties = props;
    return r;
  }
  if (embed.__sobree === "field") {
    const props = attrsToRunProps(op.attributes);
    const r: FieldRun = { kind: "field", instruction: embed.instruction };
    if (embed.cached !== undefined) r.cached = embed.cached;
    if (Object.keys(props).length > 0) r.properties = props;
    return r;
  }
  if (embed.__sobree === "drawing") {
    const r: DrawingRun = {
      kind: "drawing",
      partPath: embed.partPath,
      widthEmu: embed.widthEmu,
      heightEmu: embed.heightEmu,
      placement: embed.placement,
    };
    if (embed.altText) r.altText = embed.altText;
    return r;
  }
  // Unknown embed kind — fall back to empty text run.
  return { kind: "text", text: "", properties: {} };
}

function readLinkMark(attrs: Record<string, unknown> | undefined): LinkMark | null {
  if (!attrs) return null;
  const link = attrs.link;
  if (!link || typeof link !== "object") return null;
  const href = (link as { href?: unknown }).href;
  if (typeof href !== "string") return null;
  return { href };
}

function stripKey(
  obj: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k !== key) out[k] = v;
  }
  return out;
}

// === RunProperties ↔ attributes ===

/**
 * Convert RunProperties to a flat attributes object. Empty / undefined
 * fields are omitted entirely (Yjs convention). Returns `undefined`
 * when no marks apply.
 */
export function runPropsToAttrs(
  props: RunProperties | undefined,
): Record<string, unknown> | undefined {
  if (!props) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(props) as Array<keyof RunProperties>) {
    const v = props[key];
    if (v === undefined) continue;
    out[key as string] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Inverse of `runPropsToAttrs`. Strips the `link` key (it's handled
 * separately as a hyperlink wrapper). Strips any unknown attributes
 * defensively (forward-compat: a future plugin may add marks Sobree
 * doesn't model).
 */
export function attrsToRunProps(
  attrs: Record<string, unknown> | undefined,
): RunProperties {
  if (!attrs) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "link") continue;
    out[k] = v;
  }
  return out as RunProperties;
}

// === structural equality (used by textDiff) ===

/**
 * Deep equality for delta op contents — strings compared as `===`,
 * embeds and attribute objects compared structurally. Used by the
 * Y.Text diff to detect cells that haven't changed.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}
