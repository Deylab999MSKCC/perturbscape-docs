# perturbscape-docs

Documentation site and data portal for
[PerturbScape](https://github.com/Deylab999MSKCC/perturbscape).

Built with [MkDocs](https://www.mkdocs.org/) and
[Material for MkDocs](https://squidfunk.github.io/mkdocs-material/), published to
GitHub Pages on every push to `main`.

**Live site:** https://deylab999mskcc.github.io/perturbscape-docs/

## Local development

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/mkdocs serve -w overrides
```

Then open <http://127.0.0.1:8000/perturbscape-docs/>. Pass `-w overrides` so
theme-template edits trigger a rebuild; MkDocs only watches `docs/` and
`mkdocs.yml` by default.

To check the site builds exactly as CI does, with warnings as errors:

```bash
.venv/bin/mkdocs build --strict
```

## Layout

```
mkdocs.yml                     site config and navigation
requirements.txt               build dependencies
overrides/main.html            theme override (browser tab title on the home page)
scripts/build_data.py          converts processed_data to the published Parquet
.github/workflows/deploy.yml   build and deploy to GitHub Pages
docs/
├── index.md                   landing page
├── docs/                      Documentation tab
│   ├── getting-started.md     install, input data, quickstart
│   ├── configuration.md       config reference, modes, resources
│   ├── running.md             run_modules.sh, monitoring, troubleshooting
│   ├── outputs.md             output layout and file reference
│   ├── methods/               contrastive embeddings, Hotspot, disease enrichment
│   ├── modules/               the eight pipeline modules, grouped
│   ├── faq.md
│   └── citation.md
├── data/                      Data Portal tab
│   ├── index.md               the explorer
│   ├── datasets.md            the seven datasets
│   ├── schema.md              column definitions and downloads
│   └── tables/                published Parquet + manifest
├── assets/                    logo.png (hero), logo-minimal.png (chrome, favicon)
├── stylesheets/extra.css      design system and component styles
└── javascripts/
    ├── explorer.js            DuckDB-WASM UMAP explorer and table view
    ├── mermaid.js             palette-matched diagram rendering
    └── mathjax.js             MathJax configuration
```

## The published data

Four Parquet tables in `docs/data/tables/`, built from the per-dataset text
files in `processed_data` and the precomputed UMAP coordinates in `umaps`:

| File | Rows | Size |
|---|---:|---:|
| `pathways.parquet` | 39,142 | 3.5 MB |
| `meta_programs.parquet` | 3,971,637 | 9.4 MB |
| `umap.parquet` | 38,791 | 0.7 MB |
| `genes.parquet` | 15,066 | 0.1 MB |

Roughly 370 MB of source text reduced to under 14 MB, which fits comfortably
inside GitHub's limits and is served directly from Pages.

### Rebuilding

The source `.txt` files are **not tracked here**. Point the build script at them:

```bash
.venv/bin/python scripts/build_data.py \
  --source /path/to/processed_data \
  --umaps  /path/to/umaps
```

It harmonizes the three schema variants (the leading grouping column is named
`data`, `subclass`, or `cell` depending on the dataset, and is absent from four
of them) into a single `context` column, renames `tau`/`pvalue_tau` to
`trs`/`pvalue`, merges trait names that differ only in capitalization, maps the
UMAP files onto datasets and contexts, resolves gene symbols to stable HGNC ids,
and writes all four tables plus `manifest.json`. Every merge and rename it
applies is printed, followed by a coverage report.

The HGNC complete set is downloaded once to `.cache/` (gitignored) and reused on
later runs; pass `--hgnc <path>` to point at your own copy.

Re-run it and commit the result whenever the upstream results change.

### How the explorer works

`docs/javascripts/explorer.js` queries the Parquet directly in the browser with
DuckDB-WASM, fetching only the byte ranges a query touches. That is why a
4M-row gene table can be drilled into interactively without downloading it.

Note that this needs HTTP range request support. GitHub Pages provides it; the
MkDocs dev server does **not**, so locally DuckDB falls back to fetching whole
files. The explorer still works, just less efficiently.

## Deployment

`.github/workflows/deploy.yml` builds with `--strict` and deploys to GitHub Pages
on push to `main`.

One-time setup in the repository settings:

1. Make the repository **public** — GitHub Pages on private repos requires
   GitHub Enterprise Cloud.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**

## Outstanding

- [ ] Primary source citation for each of the seven datasets
      (`docs/data/datasets.md` carries a placeholder note)
- [ ] Manuscript reference in `docs/docs/citation.md`
