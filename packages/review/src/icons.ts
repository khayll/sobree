/**
 * Minimal inline SVG icons for the review action buttons. 16×16,
 * `currentColor` stroke — they inherit the button's text colour, so
 * theming is just setting `color`.
 */

const SVG = (paths: string): string =>
  `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" ` +
  `stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ` +
  `stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

/** Checkmark — accept. */
export const ICON_ACCEPT = SVG(`<path d="M3 8.5l3.2 3.2L13 5"/>`);

/** Cross — reject. */
export const ICON_REJECT = SVG(`<path d="M4 4l8 8M12 4l-8 8"/>`);

/** Check-in-circle — resolve a comment. */
export const ICON_RESOLVE = SVG(
  `<circle cx="8" cy="8" r="5.5"/><path d="M5.5 8l1.8 1.8L10.8 6"/>`,
);

/** Counter-clockwise arrow — reopen a resolved comment. */
export const ICON_REOPEN = SVG(
  `<path d="M3.5 8a4.5 4.5 0 1 1 1.3 3.2"/><path d="M3.2 5v3h3"/>`,
);
