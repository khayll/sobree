export const emptyObjectSchema = {
  type: "object",
  properties: {},
  required: [],
} as const;

export const blockIdSchema = (description = "Id of the block to target.") => ({
  type: "string",
  description,
});

export const textSchema = (description = "Plain text content.") => ({
  type: "string",
  description,
});
