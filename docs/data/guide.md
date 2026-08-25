# How to Read the Portal

What the [Data Portal](index.md) shows, what the numbers mean, and where the
edges of the data are.

<div class="ps-metrics" markdown>
<div class="ps-metric"><span class="ps-metric-value">7</span><span class="ps-metric-label">Datasets</span></div>
<div class="ps-metric"><span class="ps-metric-value">10,257</span><span class="ps-metric-label">Perturbations</span></div>
<div class="ps-metric"><span class="ps-metric-value">39</span><span class="ps-metric-label">Traits</span></div>
<div class="ps-metric"><span class="ps-metric-value">38,791</span><span class="ps-metric-label">Pairs</span></div>
<div class="ps-metric"><span class="ps-metric-value">3.9M</span><span class="ps-metric-label">Gene ranks</span></div>
</div>

## What TRS means

The **Trait Relevance Score** is the standardized stratified LD score regression
coefficient for a perturbation's meta-program annotation: the per-SNP
contribution to heritability of a one standard deviation increase in that
annotation, scaled by the trait's total heritability so that scores are
comparable across annotations and traits.

Higher means the genes the perturbation points to carry more of the trait's
genetic signal.

!!! warning "TRS = 0 means 'not significant', not 'no effect'"
    TRS is set to zero unless the estimate is positive **and** its one-sided
    p-value is at most 0.05, so a zero is a thresholded value rather than an
    estimate. Read TRS together with **P**.

    The p-value tests for enrichment only — depletion is not tested. A
    significant TRS says the perturbation's programs share genetic architecture
    with the trait. It is not a causal claim.

Full derivation:
[Disease Enrichment](../docs/methods/disease-enrichment.md).

## Reading the plot

Colour and size both carry the score, on one continuous scale running from zero
to the strongest perturbation in the current view — the legend shows that
maximum.

Because TRS is already thresholded upstream, the bottom of the scale *is* "not
significant": a point sits there exactly when its estimate was not positive and
significant. Anything above the floor is a scored, significant perturbation, and
is drawn slightly larger as well as brighter.

UMAP coordinates are computed **per dataset and trait**. Positions are
meaningful only within a single plot — a point at the same coordinates in two
different UMAPs means nothing, and distances are not comparable between plots.

## Using the explorer

<div class="ps-grid" markdown>

<div class="ps-card" markdown>
### Select
Dataset, then context where one applies, then trait. Both the plot and the
table follow the selection. **Monocytes** splits into knockdown and knockout,
**T2D** into six differentiation stages, **PerturbAI** into four neuronal
subclasses. The context selector hides itself for datasets that have only one.
</div>

<div class="ps-card" markdown>
### Find
**Find perturbation** suggests matches as you type, ranked by TRS, with the
score shown beside each name. Pick one to select it and centre it on the plot.
Arrow keys and Enter work; Escape closes the list.
</div>

<div class="ps-card" markdown>
### Navigate
Scroll to zoom, drag to pan, hover for a readout. **Reset view** returns to the
full extent. Clicking a point fills the detail panel without moving the plot.
</div>

<div class="ps-card" markdown>
### Table
The table below the plot lists the same selection as sortable rows, with a
significant-only filter. Plot and table are linked: selecting in either fills
the same detail panel, and **Centre on plot** moves the UMAP to the selected
perturbation.
</div>

<div class="ps-card" markdown>
### Download
**Download view** exports the current dataset, context, and trait including UMAP
coordinates and pathways. **Download all** exports every scored pair across all
seven datasets as one CSV.
</div>

<div class="ps-card" markdown>
### Genes
The detail panel shows the ten highest-ranked meta-program genes; **show all
100** expands the rest. Every gene links to its HGNC symbol report in a new tab,
resolved by stable HGNC id so renamed genes still land on the right page.
</div>

<div class="ps-card" markdown>
### Go deeper
The [bulk Parquet tables](schema.md#bulk-downloads) hold everything the portal
reads, and can be queried directly from Python or R without the browser.
</div>

</div>

## Coverage

The published tables are defined by the UMAP coordinates: every scored pair has
a position, a TRS, a p-value and a ranked gene list, and every plotted point has
all of them. There are 38,791 pairs in each of the three tables, with nothing in
one that is missing from another.

| Dataset | Contexts | Traits | Perturbations |
|---|---:|---:|---:|
| HepG2 | 1 | 10 | 257 |
| Jurkat | 1 | 19 | 186 |
| K562-GWPS | 1 | 2 | 7,992 |
| Monocytes | 2 | 23 | 195 |
| PerturbAI | 4 | 1 | 1,856 |
| T2D | 6 | 2 | 35 |
| TeloHAEC | 1 | 3 | 579 |

One gap is real and expected: **19,296 of 38,791 pairs — almost exactly half —
have no enriched pathways.** They have a TRS and a p-value, but the meta-program
did not reach significance for any pathway. The detail panel says so and the
table's pathway column shows a dash.

Pairs the enrichment step did not actually produce a result for are excluded
rather than published. They were identifiable by a placeholder p-value of
exactly 0.5 with a TRS of 0, and they never had UMAP coordinates. The `Control`
baseline is excluded on the same grounds — it is an internal check with no
perturbation position.

See [Datasets](datasets.md) for what each system is and what the context values
mean.

## How this works

The explorer runs entirely in your browser. The tables are published as
Parquet and queried with DuckDB compiled to WebAssembly, which fetches only the
byte ranges a query touches. That is why a 4M-row gene table can be drilled into
interactively without downloading it — the files together are under 14 MB,
and a typical drill-down transfers a small fraction of that.

Nothing you select or type is sent anywhere. If the explorer fails to start, its
query engine is loaded from a CDN and needs WebAssembly support; the underlying
tables can always be [downloaded directly](schema.md#bulk-downloads) instead.
