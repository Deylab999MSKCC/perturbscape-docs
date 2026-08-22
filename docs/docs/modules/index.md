# Modules

PerturbScape ships eight modules. Each is a self-contained Snakemake workflow
with its own `Snakefile`, `config.yaml`, `environment.yaml`, SLURM `profile/`,
and `scripts/`, sharing settings from the
[master config](../configuration.md).

```
<module>/
├── Snakefile            rules, target resolution, resource wiring
├── config.yaml          module-specific parameters
├── environment.yaml     conda environment
├── profile/             SLURM executor profile
└── scripts/             the implementations
```

## The eight modules

| Module | Method | Contrastive | Hotspot | Determinism |
|---|---|:--:|:--:|---|
| [`pca`](baselines.md#pca) | Principal component analysis | <span class="ps-no">no</span> | <span class="ps-yes">yes</span> | Deterministic |
| [`cpca`](linear-contrastive.md#cpca) | Contrastive PCA, subtractive | <span class="ps-yes">yes</span> | <span class="ps-yes">yes</span> | Deterministic |
| [`contrapc`](linear-contrastive.md#contrapc) | Contrastive PCA, ratio-based | <span class="ps-yes">yes</span> | <span class="ps-yes">yes</span> | Deterministic |
| [`kcpca`](kernel-contrastive.md#kcpca) | Kernel contrastive PCA | <span class="ps-yes">yes</span> | <span class="ps-yes">yes</span> | Seeded |
| [`kcontrapc`](kernel-contrastive.md#kcontrapc) | Kernel contrastive PCA, ratio | <span class="ps-yes">yes</span> | <span class="ps-yes">yes</span> | Seeded |
| [`cnmf`](baselines.md#cnmf) | Consensus non-negative matrix factorization | <span class="ps-no">no</span> | <span class="ps-yes">yes</span> | Stochastic |
| [`contrastivevi`](contrastivevi.md) | Contrastive variational inference | <span class="ps-yes">yes</span> | <span class="ps-yes">yes</span> | Stochastic |
| [`de-dgca`](de-dgca.md) | Differential expression and co-expression | <span class="ps-yes">yes</span> | <span class="ps-no">no</span> | Permutation |

## Choosing modules

<div class="ps-grid" markdown>

<div class="ps-card" markdown>
### Start here
[`pca`](baselines.md#pca) is fastest and lightest, and exercises the full job
hierarchy. Use it to validate your setup before spending real cluster time.
</div>

<div class="ps-card" markdown>
### The workhorses
[`cpca` and `contrapc`](linear-contrastive.md) are the two linear contrastive
formulations. Deterministic, well understood, moderate cost. Most analyses centre
on these.
</div>

<div class="ps-card" markdown>
### Nonlinear structure
[`kcpca` and `kcontrapc`](kernel-contrastive.md) apply the same objectives in a
random Fourier feature space, at roughly twice the memory.
</div>

<div class="ps-card" markdown>
### Alternative views
[`cnmf`](baselines.md#cnmf) gives parts-based non-negative programs.
[`contrastivevi`](contrastivevi.md) gives an explicit salient and background
latent split.
</div>

<div class="ps-card" markdown>
### Canonical comparison
[`de-dgca`](de-dgca.md) computes differential expression and differential
co-expression. No embedding, no Hotspot - a different route to gene programs.
</div>

</div>

!!! tip "Running several is the point"
    The methods disagree, and the disagreement is informative. A gene program
    recovered by cPCA, ContraPC, and cNMF alike is more credible than one that
    appears under a single method and a single alpha. Disease enrichment
    combines all surviving programs across methods into one meta-program, so
    breadth here directly improves stage 2.

## Rule names

Needed for `--forcerun`:

| Module | Main rule | Second rule |
|---|---|---|
| `pca` | `pca_decomposition` | `pca_hotspot` |
| `cpca` | `cpca_decomposition` | `cpca_hotspot` |
| `contrapc` | `contrapc_decomposition` | `contrapc_hotspot` |
| `kcpca` | `kcpca_decomposition` | `kcpca_hotspot` |
| `kcontrapc` | `kcontrapc_decomposition` | `kcontrapc_hotspot` |
| `cnmf` | `cnmf_factorization` | `cnmf_hotspot` |
| `contrastivevi` | `contrastivevi_model` | `contrastivevi_hotspot` |
| `de-dgca` | `de_analysis` | `dgca_analysis` |

## Shared parameters

Available in every contrastive module:

| Parameter | Default | Meaning |
|---|---|---|
| `n_components` | `10` | Components retained per alpha |
| `use_de_genes` | `false` | Restrict to genes with p <= 0.05 before fitting |
| `transform_mode` | `"auto"` | `"auto"` selects four alpha by spectral clustering; `"manual"` uses one |
| `manual_alpha` | `null` | The alpha used when `transform_mode: "manual"` |
| `project_which` | `"target"` | Which cells to project: `target`, `background`, or `both` |

See [Contrastive Embeddings](../methods/embeddings.md) for the mathematics.

### Preprocessing and guards

Applied inside every contrastive module before fitting:

| Step | Behaviour |
|---|---|
| Cell filter | `min_genes=200` |
| Gene filter | `min_cells=10` |
| Non-finite values | Replaced with `0`, with a warning naming the count |
| Minimum group size | **Hard error if target or background has under 25 cells** |
| `use_de_genes: true` | Restricts to genes with p <= 0.05 between target and background |

!!! danger "The 25-cell floor is independent of `min_cells`"
    `min_cells` filters targets at the Snakemake level, before jobs are
    submitted. The 25-cell check happens inside the fit. Setting `min_cells: 0`
    means perturbations with fewer than 25 cells are submitted and then fail at
    runtime.

### Projection scope

`project_which` controls which cells are projected into the learned space:

| Value | Projects | Use when |
|---|---|---|
| `"target"` (default) | Perturbed cells only | Studying structure within perturbed cells |
| `"background"` | Control cells only | Sanity check - should show little structure |
| `"both"` | All cells | Visualizing separation between the two groups |

Hotspot consumes the projection, so this determines which cells the gene programs
are learned from.
