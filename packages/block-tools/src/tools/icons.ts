/**
 * Inline Lucide SVG icons used by toolbar buttons. All 2px-stroke,
 * 24×24 viewBox, rendered at 16×16 via the wrapper. Icons inherit
 * `currentColor` so button state colours flow through.
 */

const BOLD = `<path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/>`;
const ITALIC = `<line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>`;
const UNDERLINE = `<path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" y1="20" x2="20" y2="20"/>`;
const STRIKE = `<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/>`;
const SUPERSCRIPT = `<path d="m4 19 8-8"/><path d="m12 19-8-8"/><path d="M20 9c0-1.667-.667-2.5-2-2.5-.833 0-1.5.333-2 1 .5-1 1.5-1.5 2.5-1.5 1 0 2.5.5 2.5 2 0 1.667-1.667 2-2.5 3h2.5"/>`;
const SUBSCRIPT = `<path d="m4 5 8 8"/><path d="m12 5-8 8"/><path d="M20 20c0-1.667-.667-2.5-2-2.5-.833 0-1.5.333-2 1 .5-1 1.5-1.5 2.5-1.5 1 0 2.5.5 2.5 2 0 1.667-1.667 2-2.5 3h2.5"/>`;
const TYPE = `<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>`;
const PAINTBRUSH = `<path d="m14.622 17.897-10.68-2.913"/><path d="M18.376 2.622a1 1 0 1 1 3.002 3.002L17.36 9.643a.5.5 0 0 0 0 .707l.944.944a2.41 2.41 0 0 1 0 3.408l-.944.944a.5.5 0 0 1-.707 0L8.354 7.348a.5.5 0 0 1 0-.707l.944-.944a2.41 2.41 0 0 1 3.408 0l.944.944a.5.5 0 0 0 .707 0z"/><path d="M9 8c-1.804 2.71-3.97 3.46-6.583 3.948a.507.507 0 0 0-.302.819l7.32 8.883a1 1 0 0 0 1.185.204C12.735 20.405 16 16.792 16 15"/>`;
const HIGHLIGHTER = `<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>`;
const ERASER = `<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>`;
const CODE = `<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>`;
const ALIGN_LEFT = `<line x1="21" y1="6" x2="3" y2="6"/><line x1="15" y1="12" x2="3" y2="12"/><line x1="17" y1="18" x2="3" y2="18"/>`;
const ALIGN_CENTER = `<line x1="21" y1="6" x2="3" y2="6"/><line x1="17" y1="12" x2="7" y2="12"/><line x1="19" y1="18" x2="5" y2="18"/>`;
const ALIGN_RIGHT = `<line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="12" x2="9" y2="12"/><line x1="21" y1="18" x2="7" y2="18"/>`;
const ALIGN_JUSTIFY = `<line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="12" x2="3" y2="12"/><line x1="21" y1="18" x2="3" y2="18"/>`;
const INDENT_INCREASE = `<polyline points="3 8 7 12 3 16"/><line x1="21" y1="12" x2="11" y2="12"/><line x1="21" y1="6" x2="11" y2="6"/><line x1="21" y1="18" x2="11" y2="18"/>`;
const INDENT_DECREASE = `<polyline points="7 8 3 12 7 16"/><line x1="21" y1="12" x2="11" y2="12"/><line x1="21" y1="6" x2="11" y2="6"/><line x1="21" y1="18" x2="11" y2="18"/>`;
const LIST_BULLET = `<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>`;
const LIST_NUMBERED = `<line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>`;
const TRASH = `<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>`;
const CHEVRON_DOWN_ICON = `<polyline points="6 9 12 15 18 9"/>`;
// Lucide "sliders-horizontal" — reads as "settings / page setup" without
// the over-loaded gear iconography.
const SETTINGS = `<line x1="21" y1="4" x2="14" y2="4"/><line x1="10" y1="4" x2="3" y2="4"/><line x1="21" y1="12" x2="12" y2="12"/><line x1="8" y1="12" x2="3" y2="12"/><line x1="21" y1="20" x2="16" y2="20"/><line x1="12" y1="20" x2="3" y2="20"/><line x1="14" y1="2" x2="14" y2="6"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="16" y1="18" x2="16" y2="22"/>`;
// Page outline with inner margin guides — reads unambiguously as
// "page setup". Outer rectangle = paper edge; inner = type area.
const PAGE_SETUP = `<rect x="4" y="3" width="16" height="18" rx="1"/><rect x="7" y="6" width="10" height="12" rx="0.5" stroke-dasharray="1.5 1.5" opacity="0.7"/>`;
// Horizontal dashed divider with a short solid stroke each side —
// reads as "section break between two regions".
const SECTION_BREAK = `<path d="M3 7h18"/><path d="M3 17h18"/><path d="M3 12h4"/><path d="M11 12h2"/><path d="M17 12h4"/>`;
// Pencil with a small underline-dot "edit-mark" — reads as "track edits".
// The active (pressed) state of the button is what really tells the user
// it's on; the glyph itself is the same in both states.
const TRACK_CHANGES = `<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/><circle cx="5.5" cy="18.5" r="0.5" fill="currentColor"/>`;

export const ICONS: Record<string, string> = {
  bold: BOLD,
  italic: ITALIC,
  underline: UNDERLINE,
  strike: STRIKE,
  superscript: SUPERSCRIPT,
  subscript: SUBSCRIPT,
  type: TYPE,
  paintbrush: PAINTBRUSH,
  highlighter: HIGHLIGHTER,
  eraser: ERASER,
  code: CODE,
  "align-left": ALIGN_LEFT,
  "align-center": ALIGN_CENTER,
  "align-right": ALIGN_RIGHT,
  "align-justify": ALIGN_JUSTIFY,
  "indent-increase": INDENT_INCREASE,
  "indent-decrease": INDENT_DECREASE,
  "list-bullet": LIST_BULLET,
  "list-numbered": LIST_NUMBERED,
  trash: TRASH,
  "chevron-down": CHEVRON_DOWN_ICON,
  settings: SETTINGS,
  "page-setup": PAGE_SETUP,
  "section-break": SECTION_BREAK,
  "track-changes": TRACK_CHANGES,
};

/** Render an inline SVG for a named icon, sized 16×16. */
export function icon(name: keyof typeof ICONS): string {
  const path = ICONS[name] ?? "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}
