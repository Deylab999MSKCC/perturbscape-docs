# Schema and Downloads

The published results are two Parquet tables. Everything the
[explorer](index.md) shows comes from these files, and they can be queried
directly without the browser.

## Bulk downloads

| File | Rows | Size | Contents |
|---|---:|---:|---|
| [`pathways.parquet`](tables/pathways.parquet) | 38,954 | 3.4 MB | One row per perturbation-trait pair: tau\*, p-value, enriched pathways |
| [`meta_programs.parquet`](tables/meta_programs.parquet) | 6,919,954 | 16.6 MB | Top 100 ranked meta-program genes per pair |
| [`manifest.json`](tables/manifest.json) | | small | Dataset, context, and trait inventory |

Together these are the harmonized form of 367 MB of source text, losing nothing
but the redundancy.

## `pathways.parquet`

One row per (dataset, context, perturbation, trait).

| Column | Type | Description |
|---|---|---|
| `dataset` | string | One of the seven [datasets](datasets.md) |
| `context` | string | Subdivision within the dataset; repeats `dataset` when there is none |
| `perturbation` | string | Perturbed gene, or `All` for the [pooled](../docs/configuration.md#analysis-modes) run |
| `trait` | string | GWAS trait |
| `tau` | double | Standardized S-LDSC coefficient, **zeroed unless positive and p <= 0.05** |
| `pvalue_tau` | double | One-sided p-value from the 200-block jackknife |
| `pathways` | string | Semicolon-delimited enriched pathway names, most significant first |
| `neglog10p_pathways` | string | Semicolon-delimited `-log10(p)`, parallel to `pathways` |

`pathways` and `neglog10p_pathways` are parallel lists and must be split
together:

```python
names = row["pathways"].split("; ")
vals  = [float(x) for x in row["neglog10p_pathways"].split("; ")]
ranked = list(zip(names, vals))
```

## `meta_programs.parquet`

One row per (dataset, context, perturbation, trait, gene).

| Column | Type | Description |
|---|---|---|
| `dataset` | string | Matches `pathways.dataset` |
| `context` | string | Matches `pathways.context` |
| `perturbation` | string | Matches `pathways.perturbation` |
| `trait` | string | Matches `pathways.trait` |
| `gene` | string | HGNC symbol |
| `rank` | float | Rank within the meta-program, 1 = highest scoring, maximum 100 |

`rank` is a float rather than an integer because tied scores receive averaged
ranks. Ties are rare - well under 1% of rows.

The first four columns form the join key to `pathways.parquet`.

## Querying directly

=== "Python"

    ```python
    import duckdb

    con = duckdb.connect()
    base = "https://deylab999mskcc.github.io/perturbscape-docs/data/tables"

    # significant pairs for one trait
    con.sql(f"""
        SELECT dataset, perturbation, tau, pvalue_tau
        FROM read_parquet('{base}/pathways.parquet')
        WHERE trait = 'Coronary Artery Disease'
          AND pvalue_tau <= 0.05
          AND lower(perturbation) NOT IN ('all', 'pooled')
        ORDER BY tau DESC
        LIMIT 20
    """).show()

    # the meta-program behind one pair
    con.sql(f"""
        SELECT gene, rank
        FROM read_parquet('{base}/meta_programs.parquet')
        WHERE dataset = 'TeloHAEC'
          AND perturbation = 'TP53'
          AND trait = 'Coronary Artery Disease'
        ORDER BY rank
    """).show()
    ```

=== "Python (pandas)"

    ```python
    import pandas as pd

    pw = pd.read_parquet("pathways.parquet")
    mp = pd.read_parquet("meta_programs.parquet")

    sig = pw[(pw.pvalue_tau <= 0.05) & (~pw.perturbation.str.lower().isin(["all", "pooled"]))]
    top = sig.sort_values("tau", ascending=False).head(20)

    key = ["dataset", "context", "perturbation", "trait"]
    genes = mp.merge(top[key], on=key).sort_values(key + ["rank"])
    ```

=== "R"

    ```r
    library(arrow)
    library(dplyr)

    pw <- read_parquet("pathways.parquet")
    mp <- read_parquet("meta_programs.parquet")

    sig <- pw %>%
      filter(pvalue_tau <= 0.05, !tolower(perturbation) %in% c("all", "pooled")) %>%
      arrange(desc(tau))

    genes <- mp %>%
      semi_join(head(sig, 20), by = c("dataset", "context", "perturbation", "trait"))
    ```

=== "Command line"

    ```bash
    duckdb -c "
      SELECT trait, count(*) AS significant_pairs
      FROM read_parquet('pathways.parquet')
      WHERE pvalue_tau <= 0.05
      GROUP BY trait
      ORDER BY significant_pairs DESC
    "
    ```

!!! tip "Filter before you materialize"
    Both files are dictionary-encoded and sorted, so predicates on `dataset` and
    `trait` skip most row groups. Pushing filters into the query rather than
    loading the whole table and subsetting afterwards is dramatically faster,
    especially over HTTP.

## Harmonization applied

The source files were per-dataset text tables with three schema variants. Two
changes were made when building the Parquet:

**The optional grouping column was unified.** It appears as `data` in Monocytes,
`subclass` in PerturbAI, and `cell` in T2D, and is absent from the other four.
All become `context`; where absent, `context` is set to the dataset name.

**Trait names differing only in capitalization were merged** onto their most
frequent spelling. One merge resulted:
`Mean corpuscular hemoglobin` to `Mean Corpuscular Hemoglobin`. Differently
worded names were left alone - see
[notes on trait naming](datasets.md#notes-on-trait-naming).

The `Ensembl` column present in three source files was dropped, since `gene`
carries the HGNC symbol used throughout.

## Rebuilding

The conversion is a single script in the documentation repository. Point it at
the folder of source `.txt` files:

```bash
python scripts/build_data.py --source /path/to/processed_data
```

It writes both Parquet tables and `manifest.json` into `docs/data/tables/`,
printing every trait-name merge it applies. Re-run it whenever the upstream
results change; the source text files are not tracked in the repository.

## What is not published here

Stage 2 reads several large external resources that are not redistributed:
GWAS summary statistics, MAGMA gene results, LD reference panels, and
variant-to-gene maps. The full-length meta-programs are also not published - only
the top 100 genes per pair are retained, which is what the annotation step uses
in ranked form. See
[Disease Enrichment](../docs/methods/disease-enrichment.md#what-you-need).
