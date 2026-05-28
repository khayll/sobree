/**
 * `@sobree/core/fonts` — internal module aggregating everything
 * font-related: AST shape, OOXML import + export, ODTTF codec,
 * licensing check, in-memory `@font-face` registration.
 *
 * Consumers import from this `index.ts`, never reach into individual
 * files. The module is internal to `@sobree/core`; the public surface
 * is re-exported through `packages/core/src/index.ts`.
 */

export type { FontDeclaration, FontEmbedRef } from "./types";

export {
  deobfuscate,
  generateFontKey,
  isUnobfuscated,
  obfuscate,
} from "./odttf";

export { canEmbed, readFsType } from "./fsType";
export type { EmbedMode, FsTypeReport } from "./fsType";

export { mountFontTableFromZip, parseFontTable } from "./parse";

export { emitFontTable, mountFontTableArtifacts } from "./emit";

export {
  embedFontIntoDoc,
  removeFontFromDoc,
} from "./embedAPI";
export type {
  EmbedFontFaces,
  EmbedFontOptions,
  EmbedFontResult,
} from "./embedAPI";

export { fontLivenessPaths } from "./liveness";

export { FontFaceRegistry } from "./fontFaceRegistry";
