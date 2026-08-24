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
[Data Portal](data/index.md){ .md-button .md-button--primary }
[Documentation](docs/index.md){ .md-button }
</div>

</div>

<div class="ps-metrics" markdown>
<div class="ps-metric"><span class="ps-metric-value">7</span><span class="ps-metric-label">Datasets</span></div>
<div class="ps-metric"><span class="ps-metric-value">10,223</span><span class="ps-metric-label">Perturbations</span></div>
<div class="ps-metric"><span class="ps-metric-value">39</span><span class="ps-metric-label">Traits</span></div>
<div class="ps-metric"><span class="ps-metric-value">39,142</span><span class="ps-metric-label">Scored pairs</span></div>
</div>

A Perturb-seq screen tells you what each perturbation does to a cell. It does not
tell you whether that matters for disease. PerturbScape closes that gap in two
stages: a Snakemake pipeline of eight complementary methods discovers gene
programs, then a separate enrichment stage scores those programs against GWAS
heritability to produce a **Trait Relevance Score** for every perturbation-trait
pair.

<div class="ps-routes" markdown>

<div class="ps-route" markdown>
<span class="ps-eyebrow">Data Portal</span>
### Explore the results
Interactive UMAPs of 39,142 perturbation-trait pairs, coloured by TRS. Click any
point for its meta-program genes and enriched pathways.
[Browse the data](data/index.md){ .ps-route-go }
</div>

<div class="ps-route" markdown>
<span class="ps-eyebrow">Documentation</span>
### Run the pipeline
Installation, configuration, and the eight program modules, followed by the full
disease-enrichment methodology with the code used at each step.
[Read the docs](docs/index.md){ .ps-route-go }
</div>

</div>
