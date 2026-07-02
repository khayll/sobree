import type { RunProperties } from "../../doc/types";
import { NS } from "../shared/namespaces";
import { wFirst } from "../shared/xml";
import { readRunProperties } from "./runProperties";
import { type ImportedItem, type ImportedRun, normaliseRunText, readRun } from "./runs";

/**
 * Complex-field state machine (ECMA-376 §17.16.18). Word writes
 * PAGE / NUMPAGES fields spread across sibling runs:
 *
 *   <w:r><w:fldChar w:fldCharType="begin"/></w:r>
 *   <w:r><w:instrText> PAGE </w:instrText></w:r>
 *   <w:r><w:fldChar w:fldCharType="separate"/></w:r>
 *   <w:r><w:t>1</w:t></w:r>   ← cached display value
 *   <w:r><w:fldChar w:fldCharType="end"/></w:r>
 *
 * but `fldChar` / `instrText` are run CONTENT — siblings of `<w:t>`
 * inside one `<w:r>` — so other producers legally pack an entire
 * field (begin + instrText + separate + end) into a SINGLE run, with
 * literal text on either side of any boundary. The machine therefore
 * consumes run CHILDREN, never whole runs: everything between `begin`
 * and `end` is swallowed, instruction + cached value accumulate, and
 * `end` emits ONE FieldRun. Emitting the cached value as literal text
 * instead would bake "Page 1 of 16" into every page rather than the
 * live per-paper substitution `<span class="sobree-field">` enables.
 */
export class ComplexFieldCollector {
  private state: "before" | "code" | "result" = "before";
  private instr = "";
  private cached = "";
  private resultRuns: ImportedRun[] = [];

  constructor(
    private readonly emit: (item: ImportedItem) => void,
    /** Tags a run with the caller's revision / comment markers. */
    private readonly decorate: (run: ImportedRun) => ImportedRun,
  ) {}

  /**
   * Feed one `<w:r>`. Returns true when the run was consumed by field
   * machinery — it carries fldChar / instrText markers, or falls inside
   * an open field's code / result zone. False means the caller should
   * read it as an ordinary run.
   */
  handleRun(r: Element): boolean {
    if (wFirst(r, "fldChar") ?? wFirst(r, "instrText")) {
      this.consumeMarkedRun(r);
      return true;
    }
    if (this.state === "result") {
      // Accumulate the cached display text (the renderer substitutes
      // PAGE/NUMPAGES live from `field.instruction`) AND keep the
      // fully-read result runs — a HYPERLINK field's flush emits them
      // as the link's children, formatting intact.
      const t = wFirst(r, "t");
      if (t) this.cached += t.textContent ?? "";
      this.resultRuns.push(this.decorate(readRun(r)));
      return true;
    }
    // Inside the instruction zone — instructions can split across runs
    // (Word sometimes adds a stray empty run). Swallow non-instrText
    // runs to keep the field together.
    return this.state === "code";
  }

  /**
   * Walk a marker-carrying run child-by-child. Text fragments route by
   * the state at their position: before `begin` → ordinary run, between
   * `separate` and `end` → cached result, inside the code zone →
   * dropped (instruction text lives in `instrText`, never `<w:t>`).
   */
  private consumeMarkedRun(r: Element): void {
    const rPr = wFirst(r, "rPr");
    const format: RunProperties = (rPr ? readRunProperties(rPr) : undefined) ?? {};
    let text = "";
    const flushText = () => {
      if (text === "") return;
      const run = this.decorate({ text: normaliseRunText(text), format, isHardBreak: false });
      if (this.state === "result") {
        this.cached += text;
        this.resultRuns.push(run);
      } else if (this.state === "before") {
        this.emit({ kind: "run", run });
      }
      text = "";
    };
    for (const el of Array.from(r.children)) {
      if (el.namespaceURI !== NS.w) continue;
      if (el.localName === "fldChar") {
        flushText();
        const type = el.getAttributeNS(NS.w, "fldCharType") ?? el.getAttribute("w:fldCharType");
        if (type === "begin") {
          // Flush any previously-open malformed field first.
          this.flush();
          this.state = "code";
        } else if (type === "separate") {
          this.state = "result";
        } else if (type === "end") {
          this.flush();
        }
      } else if (el.localName === "instrText") {
        if (this.state === "code") this.instr += el.textContent ?? "";
      } else if (el.localName === "t" || el.localName === "delText") {
        text += el.textContent ?? "";
      } else if (el.localName === "tab") {
        text += "\t";
      }
    }
    flushText();
  }

  /**
   * Emit the accumulated field and reset. A HYPERLINK field IS a
   * hyperlink — same semantics as `<w:hyperlink r:id>`, just with the
   * target in the instruction and the link text in the RESULT runs.
   * Normalise it to a hyperlink item so the link renders as an anchor
   * with the result runs' own formatting (their rStyle gives Word's
   * underline / colour). Collapsing it to a FieldRun (the
   * PAGE/NUMPAGES shape) would discard all of that — links would
   * render as unstyled plain text.
   */
  private flush(): void {
    if (this.state === "before") return;
    const instruction = this.instr.trim();
    const href = parseHyperlinkInstruction(instruction);
    if (href !== null && this.resultRuns.length > 0) {
      this.emit({ kind: "hyperlink", href, runs: this.resultRuns });
    } else {
      this.emit({
        kind: "run",
        run: this.decorate({
          text: "",
          format: {},
          isHardBreak: false,
          field: this.cached !== "" ? { instruction, cached: this.cached } : { instruction },
        }),
      });
    }
    this.state = "before";
    this.instr = "";
    this.cached = "";
    this.resultRuns = [];
  }
}

/**
 * Extract the target of a `HYPERLINK` field instruction, or `null` when
 * the instruction is some other field.
 *
 *   HYPERLINK "https://x.y"            → https://x.y
 *   HYPERLINK \l "bookmark"            → #bookmark
 *   HYPERLINK "https://x.y" \l "frag"  → https://x.y#frag
 *
 * Switches like `\o "tooltip"` are ignored. (ECMA-376 §17.16.5.25.)
 */
function parseHyperlinkInstruction(instruction: string): string | null {
  if (!/^\s*HYPERLINK\b/i.test(instruction)) return null;
  const rest = instruction.replace(/^\s*HYPERLINK\b/i, "");
  const anchor = /\\l\s+"([^"]*)"/.exec(rest);
  // The first quoted string NOT belonging to a switch is the target URL.
  const target = /(?:^|[^\\\w])\s*"([^"]*)"/.exec(rest.replace(/\\\w\s+"[^"]*"/g, ""));
  if (target?.[1]) return anchor?.[1] ? `${target[1]}#${anchor[1]}` : target[1];
  if (anchor?.[1]) return `#${anchor[1]}`;
  return null;
}
