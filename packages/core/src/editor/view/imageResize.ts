import "./imageResize.css";

/**
 * Click-to-select-and-drag-the-corner image resizing.
 *
 * Implementation:
 *   - Listen for clicks inside the editor host. If an `<img>` was clicked,
 *     mark it as selected (one image at a time) and show a single
 *     bottom-right corner handle absolutely positioned over its corner.
 *   - The handle is a sibling of the image (not a child — the image is
 *     replaced/edited as content), tracked in a closure so we can move
 *     it as the page scrolls or paginates.
 *   - Dragging the handle updates the image's `width`/`height` styles in
 *     real time, preserving aspect ratio (hold Shift to free).
 *   - On mouseup we dispatch an `input` event on the host so the editor's
 *     existing debounced change pipeline picks up the new dimensions.
 */
export function attachImageResize(host: HTMLElement): () => void {
  let selected: HTMLImageElement | null = null;
  let handle: HTMLDivElement | null = null;

  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (target instanceof HTMLImageElement && host.contains(target)) {
      select(target);
      return;
    }
    // Click anywhere else inside the host (or outside): deselect, unless
    // the click hit the handle itself.
    if (target && handle && handle.contains(target)) return;
    deselect();
  };

  const onScroll = () => positionHandle();
  const onResize = () => positionHandle();

  const select = (img: HTMLImageElement) => {
    if (selected === img) {
      positionHandle();
      return;
    }
    deselect();
    selected = img;
    img.classList.add("is-selected");
    handle = createHandle();
    host.appendChild(handle);
    handle.addEventListener("mousedown", onHandleDown);
    positionHandle();
  };

  const deselect = () => {
    if (selected) selected.classList.remove("is-selected");
    selected = null;
    if (handle) {
      handle.removeEventListener("mousedown", onHandleDown);
      handle.remove();
      handle = null;
    }
  };

  const positionHandle = () => {
    if (!selected || !handle) return;
    const imgRect = selected.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    handle.style.left = `${imgRect.right - hostRect.left + host.scrollLeft - 8}px`;
    handle.style.top = `${imgRect.bottom - hostRect.top + host.scrollTop - 8}px`;
  };

  const onHandleDown = (e: MouseEvent) => {
    if (!selected) return;
    e.preventDefault();
    e.stopPropagation();
    const img = selected;
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = img.getBoundingClientRect().width;
    const startH = img.getBoundingClientRect().height;
    const aspect = startW > 0 && startH > 0 ? startW / startH : 1;

    const onMove = (m: MouseEvent) => {
      let nextW = Math.max(20, startW + (m.clientX - startX));
      let nextH = Math.max(20, startH + (m.clientY - startY));
      if (!m.shiftKey) {
        // Constrain proportionally — pick the dimension whose change is
        // larger and snap the other to keep aspect.
        const dw = Math.abs(nextW - startW);
        const dh = Math.abs(nextH - startH);
        if (dw >= dh) nextH = nextW / aspect;
        else nextW = nextH * aspect;
      }
      img.style.width = `${Math.round(nextW)}px`;
      img.style.height = `${Math.round(nextH)}px`;
      positionHandle();
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      // Drive the editor's change pipeline so the new size lands in the
      // AST on the next serialise.
      host.dispatchEvent(new Event("input", { bubbles: true }));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  host.addEventListener("click", onClick);
  // The host is inside the viewport; listening on `window` covers paper
  // scrolls + viewport pans without coupling to the viewport module.
  window.addEventListener("scroll", onScroll, { capture: true });
  window.addEventListener("resize", onResize);

  return () => {
    deselect();
    host.removeEventListener("click", onClick);
    window.removeEventListener("scroll", onScroll, { capture: true });
    window.removeEventListener("resize", onResize);
  };
}

function createHandle(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "sobree-image-resize-handle";
  el.setAttribute("contenteditable", "false");
  return el;
}
