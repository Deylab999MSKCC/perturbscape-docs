---
hide:
  - toc
---

# Data Portal

Every perturbation scored against every trait, across seven Perturb-seq
datasets. Pick a dataset and a trait to see its UMAP, where each point is one
perturbation coloured by its **Trait Relevance Score**. Click a point for the
meta-program genes and enriched pathways behind it.

<div class="ps-metrics" markdown>
<div class="ps-metric"><span class="ps-metric-value">7</span><span class="ps-metric-label">Datasets</span></div>
<div class="ps-metric"><span class="ps-metric-value">10,223</span><span class="ps-metric-label">Perturbations</span></div>
<div class="ps-metric"><span class="ps-metric-value">39</span><span class="ps-metric-label">Traits</span></div>
<div class="ps-metric"><span class="ps-metric-value">39,142</span><span class="ps-metric-label">Pairs</span></div>
<div class="ps-metric"><span class="ps-metric-value">4.0M</span><span class="ps-metric-label">Gene ranks</span></div>
</div>

<div class="ps-explorer" data-base="tables/"></div>

!!! note "Reading the plot"
    Each point is one perturbation, positioned by a precomputed UMAP of its
    meta-program and coloured by **TRS**. Bright cyan is a strong, significant
    score; dim slate means TRS is zero, which is a *thresholded* value rather
    than an estimate — see below. Faint outlined points are perturbations with
    UMAP coordinates but no enrichment results.

    **Scroll** to zoom, **drag** to pan, **hover** for a readout, **click** to
    open the detail panel. **Reset view** returns to the full extent.

## What TRS means

The **Trait Relevance Score** is the standardized stratified LD score regression
coefficient for a perturbation's meta-program annotation: the per-SNP
contribution to heritability of a one standard deviation increase in that
annotation, scaled by the trait's total heritability so that scores are
comparable across annotations and traits. Higher means the genes the
perturbation points to carry more of the trait's genetic signal.

!!! warning "TRS = 0 means 'not significant', not 'no effect'"
    TRS is set to zero unless the estimate is positive **and** its one-sided
    p-value is at most 0.05. Read TRS together with **P**. The p-value tests for
    enrichment only — depletion is not tested.

    A significant TRS says the perturbation's programs share genetic
    architecture with the trait. It is not a causal claim.

Full derivation: [Disease Enrichment](../docs/methods/disease-enrichment.md).

## Using the explorer

<div class="ps-grid" markdown>

<div class="ps-card" markdown>
### Select
Dataset, then context where one applies, then trait. **Monocytes** splits into
knockdown and knockout; **T2D** into six differentiation stages; **PerturbAI**
into four neuronal subclasses. The context selector hides itself for datasets
that have only one.
</div>

<div class="ps-card" markdown>
### Find
Typing in **Find perturbation** dims everything that does not match and rings
what does, so you can locate a gene inside a dense cloud without losing the
surrounding structure.
</div>

<div class="ps-card" markdown>
### Switch views
**Table** shows the same selection as sortable rows with a significant-only
filter. Clicking a row jumps back to the UMAP with that perturbation centred and
selected, so the two views stay tied together.
</div>

<div class="ps-card" markdown>
### Download
**Download view** exports the current dataset, context, and trait including UMAP
coordinates and pathways. **Download all** exports every scored pair across all
seven datasets as a single CSV.
</div>

</div>

## Coverage

The UMAP is available for most, not all, of the published results. Traits
without precomputed coordinates do not appear in the trait selector, but their
results are still included in **Download all** and in the
[bulk Parquet tables](schema.md#bulk-downloads).

| Dataset | Contexts | Traits with UMAP | All traits | Perturbations |
|---|---:|---:|---:|---:|
| HepG2 | 1 | 10 | 10 | 257 |
| Jurkat | 1 | 19 | 23 | 186 |
| K562-GWPS | 1 | 2 | 2 | 7,969 |
| Monocytes | 2 | 23 | 23 | 181 |
| PerturbAI | 4 | 1 | 1 | 1,858 |
| T2D | 6 | 2 | 2 | 35 |
| TeloHAEC | 1 | 3 | 3 | 580 |

Of 39,142 scored pairs, 147 have no meta-program genes recorded and 709 UMAP
points have no enrichment result. Both are surfaced honestly in the interface
rather than hidden.

## Where to go next

<div class="ps-routes" markdown>

<div class="ps-route" markdown>
<span class="ps-eyebrow">Reference</span>
### Datasets
What each of the seven Perturb-seq systems is, which traits were tested against
it, and what the context values mean.
[See the datasets](datasets.md){ .ps-route-go }
</div>

<div class="ps-route" markdown>
<span class="ps-eyebrow">Reference</span>
### Schema and downloads
Column definitions, the bulk Parquet files, and how to query them from Python or
R without the browser.
[See the schema](schema.md){ .ps-route-go }
</div>

</div>

## How this works

The explorer runs entirely in your browser. All three tables are published as
Parquet and queried with DuckDB compiled to WebAssembly, which fetches only the
byte ranges a query touches. That is why a 4M-row gene table can be drilled into
interactively without downloading it — the three files together are under 14 MB,
and a typical drill-down transfers a small fraction of that.

Nothing you select or type is sent anywhere. If the explorer fails to start, its
query engine is loaded from a CDN and needs WebAssembly support; the underlying
tables can always be [downloaded directly](schema.md#bulk-downloads) instead.
