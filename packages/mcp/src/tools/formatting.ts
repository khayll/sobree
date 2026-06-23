import { formatEditError, lookupRef } from "./internals";
import type { ToolDefinition } from "./types";

export const setParagraphAlignmentTool: ToolDefinition<
  { blockId: string; alignment: "left" | "center" | "right" | "both" | "distribute" },
  { blockId: string }
> = {
  name: "set_paragraph_alignment",
  description:
    "Set the text alignment of a paragraph block. `both` is OOXML's name for full justification.",
  inputSchema: {
    type: "object",
    properties: {
      blockId: { type: "string" },
      alignment: {
        type: "string",
        enum: ["left", "center", "right", "both", "distribute"],
      },
    },
    required: ["blockId", "alignment"],
  },
  handler: (sobree, input) => {
    const ref = lookupRef(sobree, input.blockId, "blockId");
    const result = sobree.applyBlockProperties([ref], {
      alignment: input.alignment,
    });
    if (!result.ok) throw new Error(formatEditError(result.error));
    return { blockId: input.blockId };
  },
};
