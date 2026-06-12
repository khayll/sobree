# @sobree/keyboard

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
