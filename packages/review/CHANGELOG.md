# @sobree/review

## 0.1.43

### Patch Changes

- 2ee621e: Version bump only — released together with @sobree/core to keep the
  @sobree/\* package set on one patch version.
- Updated dependencies [2ee621e]
  - @sobree/core@0.1.43

## 0.1.42

### Patch Changes

- f6c7902: Version bump only — released together with @sobree/core to keep the
  @sobree/\* package set on one patch version.
- Updated dependencies [f6c7902]
  - @sobree/core@0.1.42

## 0.1.41

### Patch Changes

- 1eba390: Version bump only — released together with @sobree/core to keep the
  @sobree/\* package set on one patch version.
- Updated dependencies [1eba390]
  - @sobree/core@0.1.41

## 0.1.40

### Patch Changes

- 624ab1a: Version bump only — released together with @sobree/core to keep the
  @sobree/\* package set on one patch version.
- Updated dependencies [624ab1a]
  - @sobree/core@0.1.40

## 0.1.39

### Patch Changes

- 0777f99: Version bump only — released together with @sobree/core to keep the
  @sobree/\* package set on one patch version.
- Updated dependencies [0777f99]
  - @sobree/core@0.1.39

## 0.1.38

### Patch Changes

- f956167: Version bump only — released together with @sobree/core to keep the
  @sobree/\* package set on one patch version.
- Updated dependencies [f956167]
  - @sobree/core@0.1.38

## 0.1.37

### Patch Changes

- Updated dependencies [0156e65]
  - @sobree/core@0.1.37

## 0.1.36

### Patch Changes

- fbb57b7: Version bump only — released together with @sobree/core to keep the
  @sobree/\* package set on one patch version.
- Updated dependencies [fbb57b7]
  - @sobree/core@0.1.36

## 0.1.35

### Patch Changes

- fa0e1b7: Version bump only — released together with @sobree/core to keep the
  @sobree/\* package set on one patch version.
- Updated dependencies [fa0e1b7]
  - @sobree/core@0.1.35

## 0.1.34

### Patch Changes

- f176c9d: Version bump only — released together with @sobree/core to keep the
  @sobree/\* package set on one patch version.
- Updated dependencies [f176c9d]
- Updated dependencies [f176c9d]
- Updated dependencies [f176c9d]
  - @sobree/core@0.1.34

## 0.1.33

### Patch Changes

- Updated dependencies [9444c45]
  - @sobree/core@0.1.33

## 0.1.32

### Patch Changes

- Updated dependencies [bef8c9b]
  - @sobree/core@0.1.32

## 0.1.31

### Patch Changes

- Updated dependencies [0648ac9]
  - @sobree/core@0.1.31

## 0.1.30

### Patch Changes

- 7569c8a: Centralize rendered-DOM lookup for plugins behind a typed `editor.renderedDocument` surface.

  Plugins previously hardcoded the renderer's private DOM selectors
  (`data-block-id`, `data-block-revision`, `ins[data-revision-author]`,
  `.sobree-comment-range`, …) to map rendered elements back to document
  concepts. That made the attribute names an undocumented inter-module
  protocol duplicated across `@sobree/block-tools` and `@sobree/review`, so a
  renderer rename silently broke plugins (AGENTS.md Rule 0).

  `@sobree/core` now exposes `editor.renderedDocument` — a typed
  `RenderedDocumentIndex` that answers "given a rendered element, what Sobree
  document concept does it represent?" and the inverse: block lookup
  (`elementForBlock` / `blockRefFromElement`), revision-mark discovery
  (`revisionMarks` / `nearestRevisionMark`), and comment-range discovery
  (`commentRanges` / `nearestCommentRange`). The protocol attribute/class
  names now live in one core module that both the renderer (writer) and the
  lookup (reader) import.

  `block-tools` and `review` were migrated onto this surface; their behaviour
  and the renderer's DOM output are unchanged (existing attributes remain for
  CSS and tooling). Third-party plugins should use `editor.renderedDocument`
  instead of querying renderer attributes directly.

- Updated dependencies [8a9dbf7]
- Updated dependencies [7569c8a]
- Updated dependencies [8a9dbf7]
  - @sobree/core@0.1.30

## 0.1.29

### Patch Changes

- Updated dependencies [9112fa6]
  - @sobree/core@0.1.29

## 0.1.28

### Patch Changes

- Updated dependencies [6036711]
- Updated dependencies [623e1cf]
- Updated dependencies [623e1cf]
  - @sobree/core@0.1.28

## 0.1.27

### Patch Changes

- Updated dependencies [4d2a54f]
  - @sobree/core@0.1.27

## 0.1.26

### Patch Changes

- Updated dependencies [dbe703d]
  - @sobree/core@0.1.26

## 0.1.25

### Patch Changes

- Updated dependencies [031d38a]
- Updated dependencies [031d38a]
  - @sobree/core@0.1.25

## 0.1.24

### Patch Changes

- Updated dependencies [df4e9bb]
  - @sobree/core@0.1.24

## 0.1.23

### Patch Changes

- Updated dependencies [aff3052]
  - @sobree/core@0.1.23

## 0.1.22

### Patch Changes

- Updated dependencies [9de2ef6]
  - @sobree/core@0.1.22

## 0.1.21

### Patch Changes

- Updated dependencies [8c89207]
  - @sobree/core@0.1.21

## 0.1.20

### Patch Changes

- Updated dependencies [c616398]
  - @sobree/core@0.1.20

## 0.1.19

### Patch Changes

- Updated dependencies [f293f79]
- Updated dependencies [b4b5a1f]
- Updated dependencies [2d7f19d]
- Updated dependencies [13498fe]
  - @sobree/core@0.1.19

## 0.1.18

### Patch Changes

- Updated dependencies [a3b107a]
  - @sobree/core@0.1.18

## 0.1.17

### Patch Changes

- Updated dependencies [16a2f20]
  - @sobree/core@0.1.17

## 0.1.16

### Patch Changes

- Updated dependencies [3af7242]
- Updated dependencies [2fd2233]
- Updated dependencies [b11897b]
  - @sobree/core@0.1.16

## 0.1.15

### Patch Changes

- Updated dependencies [26988fb]
  - @sobree/core@0.1.15

## 0.1.14

### Patch Changes

- Updated dependencies [73cdf48]
- Updated dependencies [6392789]
  - @sobree/core@0.1.14

## 0.1.13

### Patch Changes

- 6887618: Version bump only — released together with `@sobree/core` to keep the
  `@sobree/*` package set on a single version. No functional changes.
- Updated dependencies [6887618]
  - @sobree/core@0.1.13

## 0.1.12

### Patch Changes

- 90a257b: Version bump only — released together with `@sobree/core` to keep the
  `@sobree/*` package set on a single version. No functional changes.
- Updated dependencies [90a257b]
  - @sobree/core@0.1.12

## 0.1.11

### Patch Changes

- 926d1a8: Version bump only — released together with `@sobree/core` to keep the
  `@sobree/*` package set on a single version. No functional changes.
- Updated dependencies [926d1a8]
  - @sobree/core@0.1.11

## 0.1.10

### Patch Changes

- d321700: Version bump only — released together with `@sobree/core` to keep the
  `@sobree/*` package set on a single version. No functional changes.
- Updated dependencies [d321700]
  - @sobree/core@0.1.10

## 0.1.9

### Patch Changes

- bbbaef4: Version bump only — released together with `@sobree/core` to keep the
  `@sobree/*` package set on the same version. No functional changes in this
  package.
- Updated dependencies [bbbaef4]
  - @sobree/core@0.1.9

## 0.1.8

### Patch Changes

- 2ea12e8: Version bump only — released together with `@sobree/core` to keep the
  `@sobree/*` package set on the same version. No functional changes in this
  package.
- Updated dependencies [2ea12e8]
  - @sobree/core@0.1.8

## 0.1.7

### Patch Changes

- 072d31a: Version bump only — released together with `@sobree/core` to keep the
  `@sobree/*` package set on the same version. No functional changes in this
  package.
- Updated dependencies [072d31a]
  - @sobree/core@0.1.7

## 0.1.6

### Patch Changes

- 35f46ff: Version bump only — released together with `@sobree/core` to keep the
  `@sobree/*` package set on the same version. No functional changes in this
  package.
- Updated dependencies [35f46ff]
  - @sobree/core@0.1.6

## 0.1.5

### Patch Changes

- 985e472: Version bump only — released together with `@sobree/core` to keep the
  `@sobree/*` package set on the same version. No functional changes in this
  package.
- Updated dependencies [985e472]
  - @sobree/core@0.1.5

## 0.1.4

### Patch Changes

- 7bddb71: Version bump only — released together with `@sobree/core` to keep the
  `@sobree/*` package set on the same version. No functional changes in this
  package.
- Updated dependencies [7bddb71]
  - @sobree/core@0.1.4

## 0.1.3

### Patch Changes

- 0d62712: Version bump only — released together with `@sobree/core` to keep the
  `@sobree/*` package set on the same version. No functional changes in this
  package.
- Updated dependencies [0d62712]
  - @sobree/core@0.1.3

## 0.1.2

### Patch Changes

- 38cfb11: Version bump only — released together with `@sobree/core` to keep the
  `@sobree/*` package set on the same version. No functional changes in this
  package.
- Updated dependencies [38cfb11]
  - @sobree/core@0.1.2

## 0.1.1

### Patch Changes

- Ship dist-only `exports` via `publishConfig.exports`. The `development`
  condition (→ `src`, used for workspace HMR/typecheck) was shipping in
  the published package, where `src` is absent — breaking consumers'
  `vite dev` ("Failed to resolve entry"). The published `exports` is now
  clean dist-only; the source/workspace resolution is unchanged.
- Updated dependencies
  - @sobree/core@0.1.1
