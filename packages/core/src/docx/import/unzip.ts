import { unzipSync } from "fflate";

/**
 * Read a .docx file into a map of part-path → UTF-8 text for the parts we
 * need as strings (all the `*.xml` parts), and bytes for the parts we need
 * as binary (images, fonts). Kept synchronous: fflate is fast enough that a
 * 100-page document unpacks in milliseconds on the main thread.
 */
export interface UnzippedDocx {
  /** `word/document.xml` → text, `word/styles.xml` → text, etc. */
  readonly text: Record<string, string>;
  /** `word/media/image1.png` → bytes. */
  readonly binary: Record<string, Uint8Array>;
}

const TEXT_EXT = new Set(["xml", "rels"]);
const decoder = new TextDecoder("utf-8");

export async function unzipDocx(
  src: File | Blob | ArrayBuffer | Uint8Array,
): Promise<UnzippedDocx> {
  const buffer =
    src instanceof Uint8Array
      ? src
      : src instanceof ArrayBuffer
        ? new Uint8Array(src)
        : new Uint8Array(await src.arrayBuffer());
  const files = unzipSync(buffer);
  const text: Record<string, string> = {};
  const binary: Record<string, Uint8Array> = {};
  for (const [path, bytes] of Object.entries(files)) {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    if (TEXT_EXT.has(ext)) text[path] = decoder.decode(bytes);
    else binary[path] = bytes;
  }
  return { text, binary };
}
