# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets).
It captures, per change, *which packages* are affected and *how* — so versions
and per-package `CHANGELOG.md` files are generated from a record of intent
rather than hand-maintained.

## When you need a changeset

Add one whenever a change affects a **published** `@sobree/*` package in a way
a consumer would notice — a new/changed/removed API, a behavior change, or a
bug fix. You do **not** need one for changes confined to:

- tests, docs (`apps/docs`), the playground (`apps/playground`)
- fixtures / the corpus (`tools/fixtures-gen`, `tests/`)
- CI, formatting, or other repo-internal tooling

Private packages (`private: true`) are ignored automatically.

> The initial release has no changesets — the first published version is the
> baseline. Capturing starts with the first change that lands *after* it.

## How

```sh
pnpm changeset            # interactively record a change (pick packages + bump type + summary)
```

This writes a small markdown file here. Commit it with your PR. CI flags PRs
that touch `packages/*` without one.

## Releasing

```sh
pnpm version-packages     # consume changesets → bump versions + write CHANGELOGs
pnpm release              # build + publish the bumped packages to npm
```
