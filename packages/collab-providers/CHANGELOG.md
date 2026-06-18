# @sobree/collab-providers

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
