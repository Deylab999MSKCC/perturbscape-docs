---
title: PerturbScape
hide:
  - navigation
  - toc
---

<div class="ps-hero" markdown>

# PerturbScape { .ps-visually-hidden }

![PerturbScape](assets/logo.png)

<span class="ps-eyebrow">Perturbation to disease mapping</span>

<p class="ps-tagline">
PerturbScape learns the <strong>gene programs</strong> that characterize distinct
perturbation processes in Perturb-seq data, then measures how much of a complex
disease's <strong>heritability</strong> those programs explain.
</p>

<div class="ps-actions" markdown>
[Documentation](docs/index.md){ .md-button .md-button--primary }
[Data Portal](data/index.md){ .md-button }
</div>

</div>

<div class="ps-metrics" markdown>
<div class="ps-metric"><span class="ps-metric-value">7</span><span class="ps-metric-label">Datasets</span></div>
<div class="ps-metric"><span class="ps-metric-value">10,222</span><span class="ps-metric-label">Perturbations</span></div>
<div class="ps-metric"><span class="ps-metric-value">40</span><span class="ps-metric-label">Traits</span></div>
<div class="ps-metric"><span class="ps-metric-value">38,954</span><span class="ps-metric-label">Perturbation-trait pairs</span></div>
<div class="ps-metric"><span class="ps-metric-value">6.9M</span><span class="ps-metric-label">Meta-program gene ranks</span></div>
</div>

## What it does

A Perturb-seq screen tells you what each perturbation does to a cell. It does not
tell you whether that matters for disease. PerturbScape closes that gap in two
stages.

**Program discovery** runs a Snakemake pipeline of eight complementary methods
over the raw data. Contrastive methods isolate variation present in perturbed
cells but absent from controls; Hotspot then converts each embedding into
coherent gene programs.

**Disease enrichment** takes those programs and asks which of them carry genetic
signal for a trait. Programs are scored against GWAS gene-level statistics,
combined into a per-perturbation meta-program, converted into SNP annotations
through variant-to-gene links, and evaluated with stratified LD score regression.

The result is a standardized effect size, tau\*, for every perturbation-trait
pair, together with the genes and pathways driving it.

```mermaid
flowchart TB
    A["Perturb-seq data<br/>perturbed cells + controls"] --> M{"Analysis mode"}
    M -->|singular| S["One contrast per perturbation"]
    M -->|pooled| P["All perturbations vs control"]

    S --> MODS["Eight program modules"]
    P --> MODS

    MODS --> C1["Contrastive embeddings<br/>cpca · contrapc · kcpca · kcontrapc · contrastivevi"]
    MODS --> C2["Non-contrastive baselines<br/>pca · cnmf"]
    MODS --> C3["Canonical contrastiveness<br/>de-dgca"]

    C1 --> HS["Hotspot<br/>local gene programs"]
    C2 --> HS

    HS --> GP["Gene programs"]
    C3 --> GP

    GP --> SEL["Select informative programs<br/>LD-aware regression on GWAS gene scores"]
    SEL --> MP["Meta-program per perturbation"]
    MP --> ANN["Variant-to-gene annotation"]
    ANN --> LD["Stratified LD score regression"]
    LD --> OUT["tau* per perturbation-trait pair"]
```

<div class="ps-routes" markdown>

<div class="ps-route" markdown>
<span class="ps-eyebrow">Documentation</span>
### Run the pipeline
Installation, configuration, and the eight program modules, followed by the full
disease-enrichment methodology with the code used at each step.
[Read the docs](docs/index.md){ .ps-route-go }
</div>

<div class="ps-route" markdown>
<span class="ps-eyebrow">Data Portal</span>
### Explore the results
Filter 38,954 perturbation-trait pairs by dataset, context, and trait. Open any
pair to see its top 100 meta-program genes and enriched pathways.
[Browse the data](data/index.md){ .ps-route-go }
</div>

</div>

## The two stages in more detail

<div class="ps-grid" markdown>

<div class="ps-card" markdown>
<span class="ps-card-index">STAGE 1 / A</span>
### Contrastive embeddings
Four contrastive formulations plus a deep generative model isolate the variance
structure unique to perturbed cells, rather than the variance shared with
controls.
</div>

<div class="ps-card" markdown>
<span class="ps-card-index">STAGE 1 / B</span>
### Local gene programs
Hotspot builds a nearest-neighbour graph in each embedding and finds genes with
significant autocorrelation on it, clustering them into modules.
</div>

<div class="ps-card" markdown>
<span class="ps-card-index">STAGE 1 / C</span>
### Canonical contrastiveness
Differential expression and differential co-expression capture effects the
embeddings miss, including regulatory decoupling that leaves means unchanged.
</div>

<div class="ps-card" markdown>
<span class="ps-card-index">STAGE 2 / A</span>
### Informative program selection
Each program is regressed against GWAS gene-level Z-scores, whitened to account
for LD-induced correlation between neighbouring genes.
</div>

<div class="ps-card" markdown>
<span class="ps-card-index">STAGE 2 / B</span>
### Meta-program construction
Programs surviving selection are combined by leave-one-chromosome-out ridge
regression into a single gene ranking per perturbation and trait.
</div>

<div class="ps-card" markdown>
<span class="ps-card-index">STAGE 2 / C</span>
### Heritability enrichment
Top meta-program genes become SNP annotations through variant-to-gene links, and
S-LDSC returns a standardized tau\* with a jackknife standard error.
</div>

</div>

## Scope

PerturbScape is two connected but separately executed pieces. Program discovery
is a Snakemake workflow designed for a SLURM cluster and is fully contained in
the [pipeline repository](https://github.com/Deylab999MSKCC/perturbscape). Disease
enrichment runs outside Snakemake and depends on large external resources -
GWAS summary statistics, MAGMA gene results, LD reference panels, and
variant-to-gene maps - that are not distributed here. The
[Disease Enrichment](docs/methods/disease-enrichment.md) page documents that
stage step by step, with the code for each, so it can be reproduced against your
own copies of those resources.
