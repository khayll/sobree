# @sobree/fixtures-gen

Two related toolchains:

1. **Generated fixtures** (`pnpm fixtures:gen`) — small synthetic
   `.docx` files authored with the `docx` npm package, each exercising
   one OOXML feature in isolation. Lives in
   `tests/corpus/generated/<category>/<slug>/source.docx`.
2. **Corpus runner** (`pnpm corpus:*`) — orchestrates LibreOffice
   reference renders, drift comparison, and the CI regression gate
   across every entry under `tests/corpus/`. See
   [tests/corpus/README.md](../../tests/corpus/README.md) for the
   corpus layout and workflow.

Generated fixtures isolate single features so failures point at a
narrow cause; the broader `real-world/` corpus catches interactions
between features that synthetic fixtures miss. **Both feed the same
regression gate** — adding a docx to
`tests/corpus/<origin>/<category>/<slug>/source.docx` plus running
`pnpm corpus:baseline` is the whole flow.

## Usage

From the repo root:

```sh
pnpm install
pnpm fixtures:gen
```

Files land in `tests/corpus/generated/<category>/<slug>/source.docx`,
e.g.:

```
tests/corpus/generated/paragraph/01-hello-world/source.docx
tests/corpus/generated/paragraph/02-heading-and-body/source.docx
tests/corpus/generated/list/04-numbered-list/source.docx
tests/corpus/generated/table/07-table-simple/source.docx
tests/corpus/generated/footer/08-footer-page-numbers/source.docx
tests/corpus/generated/contract/09-contract-style/source.docx
```

Each `<slug>/` carries the companion artifacts (`libreoffice/`,
`sobree/`, `baseline/`) the corpus runner consumes.

## The workflow this enables

Each fixture exercises ONE OOXML feature so unit failures point at a
specific cause.

1. **Generate**: `pnpm fixtures:gen` writes the `.docx` files into
   their slug folders.
2. **Reference render** (automated on `pnpm corpus:baseline`):
   LibreOffice converts the docx to PDF, extracts text-block metrics
   into `libreoffice/metrics.json`, and renders each page to
   `libreoffice/page-N.png`.
3. **Oracle test** (automated, every CI run via `pnpm test`):
   imports each `.docx`, renders via Sobree's pipeline in jsdom, and
   snapshots the rendered DOM to `sobree/snapshot.json`. Failures
   show exactly which paragraph drifted.
4. **Drift baseline** (committed once per fixture via `pnpm
   corpus:baseline`): scoring data (matched-block ratio, mean
   absolute line-height drift, page-count delta) lands in
   `baseline/score.json`. CI's `pnpm corpus:check` compares fresh
   scoring against the committed baseline and fails on regression.

## Adding a new exemplar

In `src/index.ts`, write a new builder function and append to
`FIXTURES` with a `category:` field selecting the corpus folder.
Each fixture should test ONE feature in isolation — keep them small
so a failing test names the failure precisely.

Once added:

```sh
pnpm fixtures:gen          # writes the new .docx into its slug folder
pnpm corpus:baseline       # renders LO + commits baseline
```

Then commit the new `source.docx` + everything under its slug folder.

## Why a separate workspace?

`docx` (and `tsx` for running TS scripts) shouldn't pollute
`@sobree/core`'s devDeps. This tool only runs on demand to refresh
fixtures; the fixtures themselves are committed and read by tests.
