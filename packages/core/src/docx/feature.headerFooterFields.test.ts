import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { InlineRun } from "../doc/types";
import { importDocx } from "./import/index";

/**
 * End-to-end lock for complex PAGE / NUMPAGES fields in footer parts.
 *
 * The corpus fixture packs each field's begin + instrText + separate +
 * end into a SINGLE `<w:r>` — legal per ECMA-376 §17.16.18 (they're
 * run content, siblings of `<w:t>`), but a different distribution than
 * Word's one-marker-per-run shape. The importer's field state machine
 * must consume run children, not whole runs; when it probed one marker
 * per run, the footer imported as a single empty-instruction FieldRun
 * and the " of " / NUMPAGES content vanished (rendered "Page " instead
 * of "Page 1 of 2").
 */
describe("footer PAGE/NUMPAGES fields packed into single runs", () => {
  const FIXTURE = join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "tests",
    "corpus",
    "generated",
    "footer",
    "08-footer-page-numbers",
    "source.docx",
  );

  it("imports the footer as text + FieldRun pairs with instructions intact", async () => {
    const { document: doc } = await importDocx(new Uint8Array(readFileSync(FIXTURE)));
    const footer = doc.headerFooterBodies["footer1.xml"];
    expect(footer).toBeDefined();
    const para = footer?.[0];
    if (para?.kind !== "paragraph") throw new Error("footer1.xml[0] is not a paragraph");
    const shape = para.runs.map((r: InlineRun) =>
      r.kind === "field" ? `field:${r.instruction}` : r.kind === "text" ? `text:${r.text}` : r.kind,
    );
    expect(shape).toEqual(["text:Page ", "field:PAGE", "text: of ", "field:NUMPAGES"]);
  });
});
