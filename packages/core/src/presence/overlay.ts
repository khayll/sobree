/**
 * Default DOM overlay for remote peer cursors + selection ranges.
 *
 * Each peer gets one `<div class="sobree-caret">` (a thin vertical
 * bar with the peer's name label) and zero-or-more
 * `<div class="sobree-range">` boxes (one per rendered line inside
 * the selection). Positioned absolute inside a container that
 * `position: relative`'s the editor host. Re-rendered on every
 * presence / editor change.
 *
 * This is best-effort — in jsdom (test env) `getBoundingClientRect`
 * returns zeros, so the overlay is "drawn" but invisible. Visual
 * verification belongs in the playground / browser tests.
 */

import type { Editor } from "../editor";
import type { AwarenessLike } from "./awareness";
import { attachPresence, type PresenceHandle, type AttachPresenceOptions } from "./attach";
import type { PresenceState } from "./state";

export interface AttachPresenceOverlayOptions extends AttachPresenceOptions {
  /**
   * Element to render the overlay into. Should be an ancestor of the
   * paper stack and `position: relative` (or `position: absolute`).
   * The factory adds `position: relative` if `static`. Most embedders
   * pass `createSobree(...).viewport.slot`.
   */
  container: HTMLElement;
  /**
   * Element whose `data-block-id` lookup resolves to block DOM
   * elements. Default: `container`. Pass a different host if your
   * paper stack is layered separately.
   */
  blockHost?: HTMLElement;
}

export interface PresenceOverlayHandle {
  /** Underlying presence handle — read peers, push manual updates. */
  readonly presence: PresenceHandle;
  /** Force re-render (e.g. after a layout-affecting change the
   *  overlay didn't observe directly). */
  refresh(): void;
  /** Tear down DOM + listeners. */
  destroy(): void;
}

const OVERLAY_CLASS = "sobree-presence-overlay";

export function attachPresenceOverlay(
  editor: Editor,
  awareness: AwarenessLike,
  opts: AttachPresenceOverlayOptions,
): PresenceOverlayHandle {
  const container = opts.container;
  const blockHost = opts.blockHost ?? container;

  // Ensure container can position absolute children.
  const cs = getComputedStyle(container);
  if (cs.position === "static") container.style.position = "relative";

  // Mount overlay root.
  const overlay = document.createElement("div");
  overlay.className = OVERLAY_CLASS;
  overlay.style.cssText =
    "position:absolute; inset:0; pointer-events:none; z-index:2;";
  container.appendChild(overlay);

  let lastPeers: Map<number, PresenceState> = new Map();

  const render = (peers: Map<number, PresenceState>): void => {
    lastPeers = peers;
    overlay.replaceChildren();
    for (const [clientId, state] of peers) {
      // Skip the local peer's own caret — they see their real one.
      if (clientId === awareness.clientID) continue;
      if (!state.selection) continue;
      const blockEl = blockHost.querySelector<HTMLElement>(
        `[data-block-id="${cssEscape(state.selection.blockId)}"]`,
      );
      if (!blockEl) continue;
      const rect = blockEl.getBoundingClientRect();
      const cRect = container.getBoundingClientRect();
      // Crude positioning: top-left of the focus block, color band on
      // the left edge. A future iteration will resolve `anchor`/`focus`
      // offsets to character rects via `Range.getClientRects()`.
      const caret = document.createElement("div");
      caret.className = "sobree-caret";
      caret.style.cssText =
        `position:absolute; top:${rect.top - cRect.top}px; left:${rect.left - cRect.left - 2}px; ` +
        `width:2px; height:${rect.height}px; background:${state.user.color}; opacity:0.85;`;
      const label = document.createElement("span");
      label.className = "sobree-caret-label";
      label.textContent = state.user.name;
      label.style.cssText =
        `position:absolute; top:-1.4em; left:0; padding:0 4px; ` +
        `background:${state.user.color}; color:#fff; font:11px/1.4 system-ui, sans-serif; ` +
        `border-radius:3px 3px 3px 0; white-space:nowrap;`;
      caret.appendChild(label);
      overlay.appendChild(caret);
    }
  };

  const presence = attachPresence(editor, awareness, {
    ...opts,
    onChange(peers) {
      render(peers);
      if (opts.onChange) opts.onChange(peers);
    },
  });

  // Re-render when the document changes — blocks may have moved /
  // resized; cached rects are stale.
  const detachChange = editor.on("change", () => render(lastPeers));

  return {
    presence,
    refresh(): void {
      render(lastPeers);
    },
    destroy(): void {
      detachChange();
      presence.destroy();
      overlay.remove();
    },
  };
}

// CSS.escape isn't in jsdom by default; fall back to a manual quote.
function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(s);
  }
  return s.replace(/(["\\])/g, "\\$1");
}
