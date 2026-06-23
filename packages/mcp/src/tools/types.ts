import type { HeadlessSobree } from "@sobree/core";

export interface ToolDefinition<I = unknown, O = unknown> {
  name: string;
  description: string;
  inputSchema: object;
  handler: (sobree: HeadlessSobree, input: I) => Promise<O> | O;
}
