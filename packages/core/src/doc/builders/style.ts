/**
 * Style builder — a `NamedStyle` definition for `SobreeDocument.styles`.
 */

import type { NamedStyle } from "../types";

/** Everything on {@link NamedStyle} except `id` (the positional argument);
 *  `type` defaults to `"paragraph"` and `displayName` to the id. */
export type NamedStyleOptions = Partial<Omit<NamedStyle, "id">>;

/** A named style. `id` is required; `type` defaults to `"paragraph"` and
 *  `displayName` to `id` when not given. */
export function namedStyle(id: string, options: NamedStyleOptions = {}): NamedStyle {
  return {
    id,
    type: options.type ?? "paragraph",
    displayName: options.displayName ?? id,
    ...(options.basedOn !== undefined ? { basedOn: options.basedOn } : {}),
    ...(options.nextStyleId !== undefined ? { nextStyleId: options.nextStyleId } : {}),
    ...(options.runDefaults !== undefined ? { runDefaults: options.runDefaults } : {}),
    ...(options.paragraphDefaults !== undefined
      ? { paragraphDefaults: options.paragraphDefaults }
      : {}),
    ...(options.tableDefaults !== undefined ? { tableDefaults: options.tableDefaults } : {}),
    ...(options.tableStyle !== undefined ? { tableStyle: options.tableStyle } : {}),
  };
}
