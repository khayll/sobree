# @sobree/collab-providers

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
