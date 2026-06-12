# RELEASE.md — checklist for releasing @sobree/*

Referenced from `AGENTS.md`. The release flow is Changesets-based; the
checklist items are blocking.

## Flow

1. Branch `chore/release-patch-<version>`, add changesets:
   - one for `@sobree/core` (or whichever package carries the change)
     describing the user-visible change,
   - one coordinated bump for the remaining `@sobree/*` packages
     ("Version bump only — released together…") so the package set
     stays on the same version.
2. PR → merge. The changesets bot opens a **Version Packages** PR.
3. Merge Version Packages → CI publishes to npm via OIDC.
4. Verify: `npm view @sobree/core version` shows the new version.

## Checklist

### 1. No real-world corpus content in the release

Everything in `PR.md` §1 applies, plus release-specific surfaces:

- **Changeset texts and CHANGELOGs** are published to npm and GitHub —
  no personal data, no person-derived fixture identifiers.
- **Published tarball contents** come from each package's `files`
  field — corpus data must not be reachable from any published path.
- Audit before merging the release PR:

```sh
grep -ri "real-world" .changeset/ packages/*/CHANGELOG.md | grep -v node_modules   # expect: nothing personal
git log <last-release-tag>..HEAD --format="%s" | less                              # titles ship in CHANGELOGs
```

### 2. Webpage is updated

The live demo (sobree.dev/try) pins published versions — it does not
float. After npm shows the new version:

1. In `sobree-website`: bump every `@sobree/*` range in `package.json`,
   `pnpm install && pnpm build`, verify the new-version marker is in
   the built bundle.
2. PR → merge. **Merging deploys** (Cloudflare Workers Builds watches
   `main`); HTML carries a 5-minute TTL, so the live site follows
   within minutes. Verify on the live URL (`/try/` — note the
   trailing slash; `/try` is a 307).

### 3. Documentation is updated

- `pnpm -F @sobree/docs build` is green (part of the PR gate, but
  re-confirm on the release commit).
- Anything the release changes in the public surface has its docs
  updated per the `AGENTS.md` "Update checklist" (API pages, concepts,
  README) — releasing undocumented surface is releasing debt.
- Docs claims must match tested reality (e.g. export is a tested
  semantic fixpoint, not "byte-stable") — never let marketing language
  outrun the test suite.
