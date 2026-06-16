# @sobree/collab-server

## 0.1.12

### Patch Changes

- 90a257b: Version bump only — released together with `@sobree/core` to keep the
  `@sobree/*` package set on a single version. No functional changes.

## 0.1.11

### Patch Changes

- 926d1a8: Version bump only — released together with `@sobree/core` to keep the
  `@sobree/*` package set on a single version. No functional changes.

## 0.1.10

### Patch Changes

- d321700: Version bump only — released together with `@sobree/core` to keep the
  `@sobree/*` package set on a single version. No functional changes.

## 0.1.9

### Patch Changes

- bbbaef4: Version bump only — released together with `@sobree/core` to keep the
  `@sobree/*` package set on the same version. No functional changes in this
  package.

## 0.1.8

### Patch Changes

- 2ea12e8: Version bump only — released together with `@sobree/core` to keep the
  `@sobree/*` package set on the same version. No functional changes in this
  package.

## 0.1.7

### Patch Changes

- 072d31a: Version bump only — released together with `@sobree/core` to keep the
  `@sobree/*` package set on the same version. No functional changes in this
  package.

## 0.1.6

### Patch Changes

- 35f46ff: Version bump only — released together with `@sobree/core` to keep the
  `@sobree/*` package set on the same version. No functional changes in this
  package.

## 0.1.5

### Patch Changes

- 985e472: Version bump only — released together with `@sobree/core` to keep the
  `@sobree/*` package set on the same version. No functional changes in this
  package.

## 0.1.4

### Patch Changes

- 7bddb71: Version bump only — released together with `@sobree/core` to keep the
  `@sobree/*` package set on the same version. No functional changes in this
  package.

## 0.1.3

### Patch Changes

- 0d62712: Version bump only — released together with `@sobree/core` to keep the
  `@sobree/*` package set on the same version. No functional changes in this
  package.

## 0.1.2

### Patch Changes

- 38cfb11: Version bump only — released together with `@sobree/core` to keep the
  `@sobree/*` package set on the same version. No functional changes in this
  package.

## 0.1.1

### Patch Changes

- Ship dist-only `exports` via `publishConfig.exports`. The `development`
  condition (→ `src`, used for workspace HMR/typecheck) was shipping in
  the published package, where `src` is absent — breaking consumers'
  `vite dev` ("Failed to resolve entry"). The published `exports` is now
  clean dist-only; the source/workspace resolution is unchanged.
