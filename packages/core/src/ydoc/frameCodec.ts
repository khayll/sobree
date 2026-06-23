/**
 * Recursive AnchoredFrame ↔ Y.Map codec — the floating-layer analogue of
 * `./blockCodec.ts`. Anchored frames (the textbox "pills", brochure panels,
 * grouped drawings) previously rode in `meta` as one JSON blob, so a
 * concurrent edit to ANY frame clobbered the whole layer. Here each frame is
 * its own Y.Map, and a textbox frame's editable `body` reuses the block
 * codec's content arrays — so concurrent edits to DIFFERENT frames merge,
 * and text inside a frame merges char-level like body paragraphs.
 *
 * Per-content storage on a frameMap:
 *   - `_ast`     — the AnchoredFrame MINUS its editable parts (geometry,
 *                  position, fill/border, content discriminator)
 *   - textbox    → `body`     Y.Array<blockMap>      (the editable body)
 *   - group      → `children` Y.Array<frameMap>      (recurse)
 *   - picture / shape → no child arrays (the `_ast` is the whole frame)
 *
 * Two-phase build (skeleton → integrate → populate) mirrors blockCodec, so a
 * textbox body's Y.Texts are integrated before their deltas apply.
 */

import * as Y from "yjs";
import type { AnchoredFrame } from "../doc/types";
import { buildContent, populateContent, projectContent, updateContent } from "./blockCodec";
import { Y_BLOCK_AST_KEY, Y_FRAME_BODY_KEY, Y_FRAME_CHILDREN_KEY } from "./schema";

type YMap = Y.Map<unknown>;
type YArr = Y.Array<YMap>;

type FrameShape = "textbox" | "group" | "leaf";

function currentFrameShape(m: YMap): FrameShape {
  if (m.get(Y_FRAME_BODY_KEY) instanceof Y.Array) return "textbox";
  if (m.get(Y_FRAME_CHILDREN_KEY) instanceof Y.Array) return "group";
  return "leaf";
}

function targetFrameShape(frame: AnchoredFrame): FrameShape {
  if (frame.content.kind === "textbox") return "textbox";
  if (frame.content.kind === "group") return "group";
  return "leaf";
}

/** The frame with its editable nested parts emptied — everything else
 *  (geometry, anchor, fill/border, discriminator) survives as JSON. */
function frameScaffold(frame: AnchoredFrame): AnchoredFrame {
  const c = frame.content;
  if (c.kind === "textbox") return { ...frame, content: { ...c, body: [] } };
  if (c.kind === "group") return { ...frame, content: { ...c, children: [] } };
  return frame;
}

function setIfChanged(m: YMap, key: string, value: string): void {
  if (m.get(key) !== value) m.set(key, value);
}

// === build (skeleton) ===

export function buildFrameSkeleton(frame: AnchoredFrame): YMap {
  const m = new Y.Map<unknown>();
  setFrameSkeletonKeys(m, frame);
  return m;
}

function setFrameSkeletonKeys(m: YMap, frame: AnchoredFrame): void {
  m.set(Y_BLOCK_AST_KEY, JSON.stringify(frameScaffold(frame)));
  if (frame.content.kind === "textbox") {
    m.set(Y_FRAME_BODY_KEY, buildContent(frame.content.body));
  } else if (frame.content.kind === "group") {
    m.set(Y_FRAME_CHILDREN_KEY, buildFrames(frame.content.children));
  }
}

export function buildFrames(frames: readonly AnchoredFrame[]): YArr {
  const arr = new Y.Array<YMap>();
  arr.push(frames.map(buildFrameSkeleton));
  return arr;
}

// === populate (text deltas; map must be integrated) ===

export function populateFrame(m: YMap, frame: AnchoredFrame): void {
  if (frame.content.kind === "textbox") {
    populateContent(m.get(Y_FRAME_BODY_KEY) as YArr, frame.content.body);
  } else if (frame.content.kind === "group") {
    populateFrames(m.get(Y_FRAME_CHILDREN_KEY) as YArr, frame.content.children);
  }
}

export function populateFrames(arr: YArr, frames: readonly AnchoredFrame[]): void {
  for (let i = 0; i < frames.length; i++) populateFrame(arr.get(i), frames[i]!);
}

// === project (Y → AST) ===

export function projectFrame(m: YMap): AnchoredFrame | null {
  const ast = m.get(Y_BLOCK_AST_KEY);
  if (typeof ast !== "string") return null;
  let frame: AnchoredFrame;
  try {
    frame = JSON.parse(ast) as AnchoredFrame;
  } catch {
    return null;
  }
  if (frame.content.kind === "textbox") {
    frame.content.body = projectContent(m.get(Y_FRAME_BODY_KEY) as YArr);
  } else if (frame.content.kind === "group") {
    frame.content.children = projectFrames(m.get(Y_FRAME_CHILDREN_KEY) as YArr);
  }
  return frame;
}

export function projectFrames(arr: YArr): AnchoredFrame[] {
  return arr.map(projectFrame).filter((f): f is AnchoredFrame => f !== null);
}

// === update (diff into existing integrated map) ===

export function updateFrame(m: YMap, frame: AnchoredFrame): void {
  if (currentFrameShape(m) !== targetFrameShape(frame)) {
    for (const key of [...m.keys()]) m.delete(key);
    setFrameSkeletonKeys(m, frame);
    populateFrame(m, frame);
    return;
  }
  setIfChanged(m, Y_BLOCK_AST_KEY, JSON.stringify(frameScaffold(frame)));
  if (frame.content.kind === "textbox") {
    updateContent(m.get(Y_FRAME_BODY_KEY) as YArr, frame.content.body);
  } else if (frame.content.kind === "group") {
    updateFrames(m.get(Y_FRAME_CHILDREN_KEY) as YArr, frame.content.children);
  }
}

/** Diff a frame list into an integrated `Y.Array<frameMap>` (positional). */
export function updateFrames(arr: YArr, frames: readonly AnchoredFrame[]): void {
  for (let i = 0; i < frames.length; i++) {
    if (i < arr.length) {
      updateFrame(arr.get(i), frames[i]!);
    } else {
      const skel = buildFrameSkeleton(frames[i]!);
      arr.insert(i, [skel]);
      populateFrame(skel, frames[i]!);
    }
  }
  while (arr.length > frames.length) arr.delete(arr.length - 1, 1);
}
