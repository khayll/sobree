---
"@sobree/core": patch
---

Add `editor.styles` — define, update, and remove the named-style
definitions (`SobreeDocument.styles`) content resolves through. Applying a
`styleId` to content already works (`applyBlockProperties` /
`applyRunProperties`); this is the complementary surface for the style
definitions themselves.

```ts
editor.styles.define(namedStyle("Caption", { runDefaults: { italic: true } }))
editor.styles.update("Heading1", { runDefaults: { color: "#1A5276" } })
editor.styles.remove("Caption")
```

Grouped under the `editor.styles` sub-object (mirrors `editor.table` /
`editor.sections`). `update` replaces each present field wholesale and
clears an optional one on explicit `undefined`; required `type` /
`displayName` are never cleared. Mirrored on HeadlessSobree
(`defineStyle` / `updateStyle` / `removeStyle`) with Y.Doc parity. New
`NamedStylePatch` type exported.
