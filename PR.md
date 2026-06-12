# PR.md — checklist before opening (and merging) a PR

Referenced from `AGENTS.md`. Every item below is blocking — a PR that
fails one of these doesn't merge, no matter how green the tests are.

## 1. No real-world corpus content in the PR

The real-world corpus (`tests/corpus/real-world/`, gitignored) contains
documents with personal data. None of it may reach the repository, in
any form:

- **No files** from `tests/corpus/real-world/` committed — staged or
  via a moved/copied path.
- **No personal data** — person names, email addresses, phone numbers,
  or person-derived identifiers — in code, comments, fixture names,
  test strings, commit messages, or the PR title/body. Descriptive
  document slugs that don't identify a person are fine and are the
  established convention.
- **Squash-merge with a curated commit message.** Branch commits never
  reach `main`, so a slip in an intermediate commit message dies with
  the branch — but the squash message and PR text are forever: write
  them clean, and re-read them before merging.

Quick audit before opening:

```sh
git diff main --stat | grep -i "real-world"        # expect: nothing
git log main.. --format="%s%n%b" | less             # read your messages
gh pr view --json title,body                        # read what ships
```

## 2. ik scan must not error

CI runs the inkode quality scan on every PR with `fail-on: new-errors`
(see `.github/workflows/ik.yml`). A red 🔴 finding introduced by the PR
fails the gate.

- Check the sticky **inkode** comment on the PR for "New findings".
- Fix red findings **for real** (Rule 0): restructure the code so the
  finding is gone, don't contort it to game the metric. If the scanner
  is provably miscounting (it has quirks — e.g. it counts `??` chains
  as nesting), prefer the refactor that is *also* the better code; if
  no such refactor exists, raise it instead of shipping noise.
- Yellow/blue findings (hotspots, ai-stack) are informational — use
  judgement, don't chase them.

## 3. The gate

All four green before any PR (details in `AGENTS.md` → Verification):

```sh
pnpm typecheck
pnpm test
pnpm -F @sobree/docs build
pnpm corpus:check
```

Visual changes additionally get a playground spot-check
(`pnpm dev` → localhost:5174) — jsdom doesn't catch layout.
