# Data Portal

Every perturbation-trait pair PerturbScape has scored, across seven Perturb-seq
datasets. Filter by dataset, context, trait, perturbation, or pathway, then open
any row to see the meta-program genes and enriched pathways behind it.

<div class="ps-metrics" markdown>
<div class="ps-metric"><span class="ps-metric-value">7</span><span class="ps-metric-label">Datasets</span></div>
<div class="ps-metric"><span class="ps-metric-value">10,222</span><span class="ps-metric-label">Perturbations</span></div>
<div class="ps-metric"><span class="ps-metric-value">40</span><span class="ps-metric-label">Traits</span></div>
<div class="ps-metric"><span class="ps-metric-value">38,954</span><span class="ps-metric-label">Pairs</span></div>
<div class="ps-metric"><span class="ps-metric-value">6.9M</span><span class="ps-metric-label">Gene ranks</span></div>
</div>

<div class="ps-explorer" data-base="tables/"></div>

!!! note "How to read this table"
    **tau\*** is the standardized S-LDSC coefficient: the per-SNP heritability
    contribution of a one standard deviation increase in the perturbation's
    program annotation, scaled by total trait heritability. Larger is stronger.

    **P** is one-sided, testing for enrichment only. `tau` is set to `0` unless
    the estimate is positive **and** p is at most 0.05, so a zero means "not
    significant", not "no effect". The table filters to significant pairs by
    default.

    **Pooled runs** appear under the perturbation name `All` - every perturbation
    in that dataset combined and contrasted against control as one group. They
    are hidden unless you enable **Include pooled (All)**.

    Full methodology: [Disease Enrichment](../docs/methods/disease-enrichment.md).

## Using the explorer

<div class="ps-grid" markdown>

<div class="ps-card" markdown>
### Filter
Dataset, context, and trait are dependent - narrowing the dataset narrows the
other two to what actually exists for it. The context selector hides itself for
datasets that have only one.
</div>

<div class="ps-card" markdown>
### Search
**Perturbation** matches substrings, so `TP5` finds `TP53`. **Pathway contains**
searches the full enriched-pathway text, which is the fastest way to ask "which
perturbations hit Wnt signalling for any trait".
</div>

<div class="ps-card" markdown>
### Open a row
Clicking a row queries the 6.9M-row meta-program table for that exact pair and
shows its top 100 ranked genes, with the ten highest highlighted, beside the
enriched pathways scaled by significance.
</div>

<div class="ps-card" markdown>
### Download
**Download CSV** exports every row matching the current filters, not just the
visible page. Use it to pull one trait, one dataset, or one perturbation's full
profile into your own analysis.
</div>

</div>

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

The explorer runs entirely in your browser. Both tables are published as Parquet
and queried with DuckDB compiled to WebAssembly, which fetches only the byte
ranges a query touches. That is why a 6.9M-row table can be filtered
interactively without downloading it - the two files together are under 20 MB,
and a typical drill-down transfers a small fraction of that.

Nothing you type is sent anywhere. If the explorer fails to start, the query
engine is loaded from a CDN and needs WebAssembly support; the underlying tables
can always be [downloaded directly](schema.md#bulk-downloads) instead.
