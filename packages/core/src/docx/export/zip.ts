import { zipSync } from "fflate";

/** Map of part-path → contents (string parts auto-encoded to UTF-8). */
export type DocxParts = Record<string, string | Uint8Array>;

const encoder = new TextEncoder();
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface DocxPackage {
  blob: Blob;
  bytes: Uint8Array;
}

/**
 * Build a `.docx` package from a parts map. fflate's `zipSync` is plenty
 * fast for the sizes we care about. We return both a Blob (for downloads)
 * and the raw bytes (for node/jsdom environments where Blob.arrayBuffer()
 * isn't implemented).
 */
export function packageDocx(parts: DocxParts): DocxPackage {
  const files: Record<string, Uint8Array> = {};
  for (const [path, value] of Object.entries(parts)) {
    files[path] = typeof value === "string" ? encoder.encode(value) : value;
  }
  const bytes = zipSync(files);
  const blob = new Blob([new Uint8Array(bytes)], { type: DOCX_MIME });
  return { blob, bytes };
}
