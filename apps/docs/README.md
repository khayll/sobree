# @sobree/docs

The Sobree documentation site — [docs.sobree.dev](https://docs.sobree.dev).
Starlight (Astro), served as a Cloudflare Workers **assets-only** Worker
(no server code; see `wrangler.jsonc`).

## Deployment — automatic, do not deploy manually

**Cloudflare Workers Builds watches `main` on GitHub.** Every push that
touches the docs triggers a build (`pnpm -F "@sobree/docs..." build`)
and deploy (`npx wrangler deploy -c apps/docs/wrangler.jsonc`) on
Cloudflare's infrastructure with its own injected credentials — there is
**no need to run any deployment command locally**. Merging a PR into
`main` is the deployment.

The `...` suffix on the filter is load-bearing: the docs `@import
"@sobree/core/tokens.css"` resolves to `@sobree/core`'s **built**
`dist/tokens.css`, so core must build first. `pnpm -F
"@sobree/docs..." build` builds the dependency closure in order; a plain
`pnpm -F @sobree/docs build` fails on a clean checkout where core hasn't
been built.

A local `npx wrangler deploy -c apps/docs/wrangler.jsonc` (run from the
repo root, after `pnpm -F "@sobree/docs..." build`) is only a
**fallback**; it requires interactive wrangler OAuth or
`CLOUDFLARE_API_TOKEN`.

## Development

```sh
pnpm -F @sobree/docs dev          # local dev server (uses core's source tokens)
pnpm -F "@sobree/docs..." build   # build core first, then astro check + build
pnpm -F @sobree/docs preview      # serve the built dist/ locally
```

The docs-coverage ratchet (`pnpm docs:coverage`, run in CI and the PR
gate) fails if a new public export of any published package isn't
mentioned somewhere in the content here.
