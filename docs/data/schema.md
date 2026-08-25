# Schema and Downloads

The published results are four Parquet tables. Everything the
[explorer](index.md) shows comes from these files, and they can be queried
directly without the browser.

## Bulk downloads

| File | Rows | Size | Contents |
|---|---:|---:|---|
| [`pathways.parquet`](tables/pathways.parquet) | 39,142 | 3.5 MB | One row per scored pair: TRS, p-value, enriched pathways |
| [`meta_programs.parquet`](tables/meta_programs.parquet) | 3,971,637 | 9.4 MB | Top 100 ranked meta-program genes per pair |
| [`umap.parquet`](tables/umap.parquet) | 38,791 | 0.7 MB | Precomputed UMAP coordinates per pair |
| [`genes.parquet`](tables/genes.parquet) | 15,066 | 0.1 MB | Gene symbol to HGNC id, for deep-linking |
| [`manifest.json`](tables/manifest.json) | | small | Dataset, context, and trait inventory |

Under 14 MB in total, harmonized from roughly 370 MB of source text.

The explorer's **Download all** button produces the same content as
`pathways.parquet` as a single CSV, if that is easier to work with.

## The join key

`pathways`, `meta_programs` and `umap` share the same four-column key
(`genes` joins on `gene` instead):

```
dataset · context · perturbation · trait
```

`context` subdivides a dataset — knockdown versus knockout for Monocytes,
differentiation stage for T2D, neuronal subclass for PerturbAI. Where a dataset
has no subdivision, `context` repeats the dataset name so the column is never
empty. See [context values](datasets.md#context-values).

## `pathways.parquet`

| Column | Type | Description |
|---|---|---|
| `dataset` | string | One of the seven [datasets](datasets.md) |
| `context` | string | Subdivision within the dataset |
| `perturbation` | string | Perturbed gene, or `All` for the [pooled](../docs/configuration.md#analysis-modes) run |
| `trait` | string | GWAS trait |
| `trs` | double | Trait Relevance Score, **zeroed unless positive and p <= 0.05** |
| `pvalue` | double | One-sided p-value from the 200-block jackknife |
| `pathways` | string | Semicolon-delimited enriched pathway names, most significant first. **Null when the meta-program enriched nothing** |
| `neglog10p_pathways` | string | Semicolon-delimited `-log10(p)`, parallel to `pathways`; null alongside it |

Just under half the rows — 19,082 of 39,142 — have no enriched pathways. The
source writes a literal `NA` there; the build converts it to null, so a check for
absence works normally rather than matching a magic string.

`pathways` and `neglog10p_pathways` are parallel lists and must be split
together, guarding for null first:

```python
if row["pathways"] is None:
    ranked = []                      # meta-program enriched nothing
else:
    names = row["pathways"].split("; ")
    vals  = [float(x) for x in row["neglog10p_pathways"].split("; ")]
    ranked = list(zip(names, vals))
```

!!! note "`trs` was previously published as `tau`"
    The quantity is unchanged — it is the standardized S-LDSC coefficient,
    tau\*, described in
    [Disease Enrichment](../docs/methods/disease-enrichment.md#step-5-trs-and-enrichment).
    Only the column name and the label used across the site changed, to
    **TRS / Trait Relevance Score**. `pvalue_tau` is likewise now `pvalue`.

## `meta_programs.parquet`

| Column | Type | Description |
|---|---|---|
| `dataset`, `context`, `perturbation`, `trait` | string | Join key |
| `gene` | string | HGNC symbol |
| `rank` | float | Rank within the meta-program, 1 = highest scoring, maximum 100 |

`rank` is a float rather than an integer because tied scores receive averaged
ranks. Ties are rare — well under 1% of rows.

## `umap.parquet`

| Column | Type | Description |
|---|---|---|
| `dataset`, `context`, `perturbation`, `trait` | string | Join key |
| `umap1` | float | UMAP dimension 1 |
| `umap2` | float | UMAP dimension 2 |
| `trs` | double | Same value as `pathways.trs`, carried for convenience |

Coordinates are precomputed per dataset and trait, so a UMAP is only meaningful
within one dataset-trait selection. Coordinates from different traits are not
comparable to each other.

Not every trait has coordinates. 709 UMAP points also have no matching row in
`pathways.parquet` — the explorer draws these muted and offers no drill-down.

## `genes.parquet`

| Column | Type | Description |
|---|---|---|
| `gene` | string | HGNC symbol, matching `meta_programs.gene` |
| `hgnc_id` | int32 | Numeric HGNC id, null where the symbol could not be resolved |

Kept separate rather than added as a column on `meta_programs.parquet`: 15,066
distinct symbols against 4M rows, so a join table costs a fraction of the space.

Symbols are resolved against the HGNC complete set, matching current symbols
first and falling back to previous and alias symbols. 15,061 of 15,066 resolve;
the five that do not are readthrough transcripts and `LOC` identifiers that HGNC
does not carry as genes.

!!! note "Why the id rather than the symbol"
    Linking to `#!/symbol/NCL` fails outright, because HGNC has renamed that
    gene to NUCLEOLIN. Resolving to `HGNC:7667` once at build time keeps every
    link working regardless of later nomenclature changes.

## Querying directly

=== "Python"

    ```python
    import duckdb

    con = duckdb.connect()
    base = "https://deylab999mskcc.github.io/perturbscape-docs/data/tables"

    # strongest significant pairs for one trait
    con.sql(f"""
        SELECT dataset, context, perturbation, trs, pvalue
        FROM read_parquet('{base}/pathways.parquet')
        WHERE trait = 'Coronary artery disease'
          AND pvalue <= 0.05
          AND lower(perturbation) NOT IN ('all', 'pooled')
        ORDER BY trs DESC
        LIMIT 20
    """).show()

    # the meta-program behind one pair
    con.sql(f"""
        SELECT gene, rank
        FROM read_parquet('{base}/meta_programs.parquet')
        WHERE dataset = 'TeloHAEC'
          AND perturbation = 'TP53'
          AND trait = 'Coronary artery disease'
        ORDER BY rank
    """).show()

    # UMAP with scores attached, ready to plot
    con.sql(f"""
        SELECT u.perturbation, u.umap1, u.umap2, u.trs, p.pvalue
        FROM read_parquet('{base}/umap.parquet') u
        LEFT JOIN read_parquet('{base}/pathways.parquet') p
          USING (dataset, context, perturbation, trait)
        WHERE u.dataset = 'HepG2' AND u.trait = 'Cholesterol'
    """).show()
    ```

=== "Python (pandas)"

    ```python
    import pandas as pd

    pw = pd.read_parquet("pathways.parquet")
    mp = pd.read_parquet("meta_programs.parquet")

    sig = pw[(pw.pvalue <= 0.05) &
             (~pw.perturbation.str.lower().isin(["all", "pooled"]))]
    top = sig.sort_values("trs", ascending=False).head(20)

    key = ["dataset", "context", "perturbation", "trait"]
    genes = mp.merge(top[key], on=key).sort_values(key + ["rank"])
    ```

=== "R"

    ```r
    library(arrow)
    library(dplyr)

    pw <- read_parquet("pathways.parquet")
    um <- read_parquet("umap.parquet")

    sig <- pw %>%
      filter(pvalue <= 0.05, !tolower(perturbation) %in% c("all", "pooled")) %>%
      arrange(desc(trs))

    plot_df <- um %>%
      filter(dataset == "HepG2", trait == "Cholesterol") %>%
      left_join(pw, by = c("dataset", "context", "perturbation", "trait"))
    ```

=== "Command line"

    ```bash
    duckdb -c "
      SELECT trait, count(*) AS significant_pairs
      FROM read_parquet('pathways.parquet')
      WHERE pvalue <= 0.05
      GROUP BY trait
      ORDER BY significant_pairs DESC
    "
    ```

!!! tip "Filter before you materialize"
    The files are dictionary-encoded and sorted, so predicates on
    `dataset` and `trait` skip most row groups. Pushing filters into the query
    rather than loading the whole table and subsetting afterwards is
    dramatically faster, especially over HTTP.

## Harmonization applied

The source files are per-dataset text tables with three schema variants. Four
changes are made when building the Parquet:

**The optional grouping column is unified.** It appears as `data` in Monocytes,
`subclass` in PerturbAI, and `cell` in T2D, and is absent from the other four.
All become `context`; where absent, `context` is set to the dataset name.

**`tau` and `pvalue_tau` are renamed** to `trs` and `pvalue`, and the literal
`NA` used for "no enriched pathways" becomes a proper null.

**Trait names differing only in capitalization are merged** onto their most
frequent spelling. The current source files are already consistent, so no merges
are applied — the check remains in place to catch regressions.

**UMAP files are mapped onto datasets and contexts.** `yao-kd` and `yao-ko`
become Monocytes KD and KO, `t2d-ko` becomes T2D with its stage read from the
file, and six T2D perturbation spellings that differ between the UMAP and
results files (`GATA4het`, `QSER1TET1`, `TET1_2_3` and so on) are rewritten onto
the results-file spelling.

The `Ensembl` column present in three source files is dropped, since `gene`
carries the HGNC symbol used throughout.

## Rebuilding

```bash
python scripts/build_data.py \
  --source /path/to/processed_data \
  --umaps  /path/to/umaps
```

It writes all four Parquet tables plus `manifest.json` into
`docs/data/tables/`, printing every trait-name merge and perturbation rename it
applies, followed by a coverage report showing how many pairs lack genes and how
many UMAP points lack results. Re-run it whenever the upstream results change;
the source text files are not tracked in the repository.

## What is not published here

Stage 2 reads several large external resources that are not redistributed: GWAS
summary statistics, MAGMA gene results, LD reference panels, and
variant-to-gene maps. The full-length meta-programs are also not published —
only the top 100 genes per pair are retained. See
[Disease Enrichment](../docs/methods/disease-enrichment.md#what-you-need).
