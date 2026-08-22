# Hotspot

Hotspot is not a standalone module — it runs as a second rule inside each of the
seven embedding modules, turning an embedding into gene programs. This page
documents the shared behavior; see
[Gene Programs & Hotspot](../methods/gene-programs.md) for the conceptual
rationale.

## Where it runs

| Module | Rule | Latent space |
|---|---|---|
| [`pca`](baselines.md#pca) | `pca_hotspot` | `pca_projection` |
| [`cpca`](linear-contrastive.md#cpca) | `cpca_hotspot` | `cpca_projection` |
| [`contrapc`](linear-contrastive.md#contrapc) | `contrapc_hotspot` | `contrapc_projection` |
| [`kcpca`](kernel-contrastive.md#kcpca) | `kcpca_hotspot` | `kcpca_projection` |
| [`kcontrapc`](kernel-contrastive.md#kcontrapc) | `kcontrapc_hotspot` | `kcontrapc_projection` |
| [`cnmf`](baselines.md#cnmf) | `cnmf_hotspot` | `cnmf_usages` |
| [`contrastivevi`](contrastivevi.md) | `contrastivevi_hotspot` | `cvi_latent` |
| [`de-dgca`](de-dgca.md) | — | **Does not run Hotspot** |

## Configuration

All Hotspot settings live in the **master** `config.yaml` and apply to every
module — they are not per-module parameters.

```yaml
run_hotspot: true
hotspot_n_neighbors: 20
hotspot_fdr_threshold: 0.05
hotspot_min_gene_threshold: 30

hotspot_resources:
  mem_mb: 64000
  threads: 8
  partition: "cpu"
  time: "04:00:00"
```

| Key | Default | Effect |
|---|---|---|
| `run_hotspot` | `true` | When `false`, Hotspot outputs drop out of the workflow targets |
| `hotspot_n_neighbors` | `20` | KNN graph size — the scale of structure detected |
| `hotspot_fdr_threshold` | `0.05` | Gene significance cutoff, applied twice |
| `hotspot_min_gene_threshold` | `30` | Minimum genes for a cluster to become a module |
| `hotspot_resources.threads` | `8` | Passed to Hotspot as `jobs` |

### Fixed in the implementation

| Setting | Value | Rationale |
|---|---|---|
| `model` | `'danb'` | Depth-adjusted negative binomial — the count-appropriate null |
| `weighted_graph` | `False` | Unweighted edges |
| `approx_neighbors` | `False` | Exact KNN; slower but deterministic |

!!! note "Two different defaults for `n_neighbors`"
    `run_hotspot.py` defaults its own argument to `30`, but the master
    `config.yaml` passes `20` and the config wins. The effective value in a
    normal pipeline run is **20**. The `30` only applies if you invoke the
    script directly.

## Procedure

1. Build a KNN graph on the embedding.
2. Compute per-gene autocorrelation against the DANB null → `Z`, `Pval`, `FDR`.
3. Keep genes with `FDR < hotspot_fdr_threshold`.
4. Compute pairwise local correlations among those genes.
5. Cluster into modules, discarding clusters below `hotspot_min_gene_threshold`.
6. Score every cell against every module.

## Outputs

For module `<m>`, in `results/<target>/`:

| File | Shape | Contents |
|---|---|---|
| `hotspot_<m>_results.csv` | genes | `Z`, `Pval`, `FDR`, `C` per gene |
| `hotspot_<m>_local_correlations.csv` | sig × sig | Gene–gene local correlation |
| `hotspot_<m>_modules.csv` | genes | Module assignment; `-1` = unassigned |
| `hotspot_<m>_module_scores.csv` | cells × modules | Per-cell module scores |
| `hotspot_<m>_metadata.txt` | — | Parameters and counts |

## Two things that surprise people

!!! warning "Module `-1` is not a module"
    Genes that passed the FDR cutoff but did not join a sufficiently large
    cluster are labeled `-1`. This is frequently the **largest** group in
    `modules.csv`. Filter it out before any downstream analysis.

    ```python
    modules = pd.read_csv("hotspot_cpca_modules.csv", index_col=0)
    real = modules[modules["Module"] != -1]
    ```

!!! warning "`local_correlations.csv` is quadratic and often enormous"
    It is a dense matrix over every gene passing the FDR cutoff. At 5,000
    significant genes that is 25M entries — hundreds of megabytes per
    perturbation, as CSV. Across a genome-scale screen it is usually the single
    largest thing the pipeline writes.

    If storage becomes a problem, tighten `hotspot_fdr_threshold`, or delete
    the local correlation files once modules have been created — the modules and
    scores are derived from them and do not need them retained.

## Tuning

| Symptom | Try |
|---|---|
| Too few modules | Lower `hotspot_min_gene_threshold` to 10–15 |
| Too many noise modules | Raise `hotspot_min_gene_threshold`; tighten FDR |
| Modules too coarse / everything in one | Lower `hotspot_n_neighbors` |
| Modules fragmented and unstable | Raise `hotspot_n_neighbors` |
| Almost no significant genes | Too few cells, or the embedding has no structure — check the module's own outputs first |

To retune without recomputing embeddings, force only the Hotspot rule:

```bash
./run_modules.sh --submit --modules cpca --forcerun cpca_hotspot
```

## Comparing across modules

Because every module runs Hotspot with identical parameters on its own
embedding, the resulting programs are directly comparable. A gene module
recovered from `cpca`, `contrapc`, and `cnmf` alike is far more credible than
one appearing under a single method — cross-module agreement is the practical
substitute for a significance test on the programs themselves.
