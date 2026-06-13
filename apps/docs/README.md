# @sobree/docs

The Sobree documentation site — [docs.sobree.dev](https://docs.sobree.dev).
Starlight (Astro), served as a Cloudflare Workers **assets-only** Worker
(no server code; see `wrangler.jsonc`).

## Deployment — automatic, do not deploy manually

**Cloudflare Workers Builds watches `main` on GitHub.** Every push that
touches the docs triggers a build (`pnpm -F @sobree/docs build`) and
deploy (`npx wrangler deploy -c apps/docs/wrangler.jsonc`) on
Cloudflare's infrastructure with its own injected credentials — there is
**no need to run any deployment command locally**. Merging a PR into
`main` is the deployment.

A local `npx wrangler deploy -c apps/docs/wrangler.jsonc` (run from the
repo root, after `pnpm -F @sobree/docs build`) is only a **fallback**;
it requires interactive wrangler OAuth or `CLOUDFLARE_API_TOKEN`.

## Development

```sh
pnpm -F @sobree/docs dev        # local dev server
pnpm -F @sobree/docs build      # astro check + static build into dist/
pnpm -F @sobree/docs preview    # serve the built dist/ locally
```

The docs-coverage ratchet (`pnpm docs:coverage`, run in CI and the PR
gate) fails if a new public export of any published package isn't
mentioned somewhere in the content here.
