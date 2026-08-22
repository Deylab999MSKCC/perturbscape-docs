# Outputs

Every module writes to `<output_dir>/<target>/`, where `output_dir` defaults to
`results` and `<target>` is the
[sanitized](getting-started.md#name-sanitization) perturbation name, or the
literal string `pooled` in [pooled mode](configuration.md#analysis-modes).

Because `output_dir` is relative, each module writes its own `results/` tree
inside its own directory:

```
perturbscape/
├── cpca/results/TP53/
│   ├── cpca_projection.csv
│   ├── cpca_eigenvalues.csv
│   └── hotspot_cpca_modules.csv
├── cnmf/results/TP53/
└── de-dgca/results/TP53/
```

Set `output_dir` to an absolute path to consolidate results elsewhere. All
modules would then share one tree, but filenames are prefixed by method so they
do not collide.

## Two kinds of output

**Embedding outputs** are method-specific: projections, eigenvalues,
eigenvectors, loadings. Names differ per module.

**Hotspot outputs** are uniform across the seven Hotspot-enabled modules, always
named `hotspot_<method>_*`. These are the gene programs, and they are what
[disease enrichment](methods/disease-enrichment.md) consumes.

For most downstream work the two files that matter are:

| File | Why |
|---|---|
| `hotspot_<m>_modules.csv` | The gene programs - gene to module assignment |
| `hotspot_<m>_module_scores.csv` | Per-cell activity of each program |

Everything else is either input to those, or diagnostic.

!!! warning "Module `-1` is not a module"
    In `modules.csv`, `-1` means "significant but unassigned to any cluster
    meeting `hotspot_min_gene_threshold`". It is frequently the largest group.
    Filter it out before downstream analysis.

    ```python
    modules = pd.read_csv("hotspot_cpca_modules.csv", index_col=0)
    real = modules[modules["Module"] != -1]
    ```

## Storage

The dominant cost is `hotspot_<m>_local_correlations.csv`, a dense gene by gene
matrix over all genes passing the FDR cutoff. It scales quadratically and is
usually larger than everything else combined. For one perturbation with 5,000
significant genes:

| File | Order of magnitude |
|---|---|
| `local_correlations.csv` | Hundreds of MB |
| `projection.csv` | Single-digit MB |
| `eigenvectors.csv` | Single-digit MB |
| `modules.csv`, `results.csv` | Under 1 MB |

Multiply by perturbations times seven modules. On a genome-scale screen, plan for
the local correlation files specifically, or delete them once modules have been
created - the modules and scores are derived from them and do not need them
retained.

---

## File reference

### Hotspot files

Produced by all modules except [`de-dgca`](modules/de-dgca.md), where `<m>` is
the method tag.

| File | Shape | Contents |
|---|---|---|
| `hotspot_<m>_results.csv` | genes x 4 | Per-gene autocorrelation: `Z`, `Pval`, `FDR`, `C` |
| `hotspot_<m>_local_correlations.csv` | sig x sig | Gene-gene local correlations among FDR-significant genes |
| `hotspot_<m>_modules.csv` | genes x 1 | Module assignment; `-1` = unassigned |
| `hotspot_<m>_module_scores.csv` | cells x modules | Per-cell module scores |
| `hotspot_<m>_metadata.txt` | | Parameters and counts |

Method tags match the module directory name, with one exception:

| Module | Tag | Example |
|---|---|---|
| `pca`, `cpca`, `contrapc`, `kcpca`, `kcontrapc`, `cnmf` | same as module | `hotspot_cpca_modules.csv` |
| `contrastivevi` | **`cvi`** | `hotspot_cvi_modules.csv` |

### Module-specific files

=== "pca"

    | File | Shape | Contents |
    |---|---|---|
    | `pca_projection.csv` | cells x components | Cell coordinates; Hotspot latent space |
    | `pca_loadings.csv` | genes x components | Gene contributions per PC |
    | `pca_variance_ratio.csv` | components | Variance explained per PC |
    | `pca_metadata.txt` | | Run parameters |

=== "cpca / contrapc"

    | File | Contents |
    |---|---|
    | `<m>_projection.csv` | Cell coordinates, columns `alpha_<a>_pc_<i>` |
    | `<m>_eigenvalues.csv` | Eigenvalues per alpha and component |
    | `<m>_eigenvectors.csv` | Gene loadings per alpha and component |
    | `<m>_best_alphas.txt` | The four alpha values selected |
    | `<m>_metadata.txt` | Run parameters |

    For `contrapc`, `best_alphas` always contains `0.0` and `1.0`.

=== "kcpca / kcontrapc"

    | File | Contents |
    |---|---|
    | `<m>_projection.csv` | Cell coordinates, columns `alpha_<a>_pc_<i>` |
    | `<m>_eigenvalues.csv` | Eigenvalues per alpha and component |
    | `<m>_eigenvectors.csv` | Loadings per alpha and component, in the decomposition space |
    | `<m>_best_alphas.txt` | The alpha values selected (20 searched, not 40) |
    | `<m>_metadata.txt` | Run parameters, including `kernel_seed` |

=== "cnmf"

    | File | Shape | Contents |
    |---|---|---|
    | `cnmf_usages.csv` | cells x K | Per-cell program usage; Hotspot latent space |
    | `cnmf_gene_spectra_scores.csv` | K x genes | Z-scored loadings - rank genes *within* a program |
    | `cnmf_gene_spectra_tpm.csv` | K x genes | TPM units - compare a gene *across* programs; Hotspot input |
    | `cnmf_spectra.txt` | K x genes | Raw consensus spectra |
    | `cnmf_metadata.txt` | | Parameters and the K used |

=== "contrastivevi"

    | File | Shape | Contents |
    |---|---|---|
    | `cvi_latent.csv` | cells x `n_salient_latent` | Salient representation, columns `salient_1 ...` |
    | `cvi_genes.csv` | genes | Genes retained by the model |
    | `cvi_metadata.txt` | | Parameters, epochs trained |

=== "de-dgca"

    | File | Contents |
    |---|---|
    | `de_results.csv` | Per-gene differential expression statistics |
    | `de_metadata.txt` | DE parameters |
    | `dgca_avg_dcor.csv` | Per-gene average differential correlation |
    | `dgca_metadata.txt` | DGCA parameters |

    No Hotspot files - this module produces no embedding.

    !!! note "The full pairwise DGCA matrix is not retained"
        Differential correlation is computed over gene pairs, and writing the
        complete pairwise result produced very large files that are not used
        downstream of program creation. Only the per-gene average differential
        correlation, `dgca_avg_dcor.csv`, is saved.

## Column conventions

### Alpha-indexed columns

Contrastive modules run four alpha values and concatenate the results, so columns
encode both:

```
alpha_0.0_pc_1     alpha_0.0_pc_2     ...
alpha_0.271_pc_1   alpha_0.271_pc_2   ...
alpha_1.0_pc_1     alpha_1.0_pc_2     ...
```

Alpha 0 is formatted with one decimal, other values with three. Total columns is
`4 x n_components`, not `n_components`. Splitting by alpha is usually what you
want:

```python
import pandas as pd

proj = pd.read_csv("cpca_projection.csv", index_col=0)
alphas = sorted({c.split("_pc_")[0] for c in proj.columns})

for a in alphas:
    block = proj[[c for c in proj.columns if c.startswith(a + "_pc_")]]
    print(a, block.shape)
```

### Index conventions

| File type | Index |
|---|---|
| Projections, latents, usages, module scores | Cell barcodes |
| Loadings, eigenvectors, Hotspot results, modules | Gene names |
| Gene spectra (`cnmf`) | Program number - K is the row axis |

`cnmf` gene spectra are **transposed** relative to the loadings files of other
modules: programs are rows, genes are columns.

### Metadata files

Every `*_metadata.txt` records the parameters actually used, which may differ
from what you think you configured - module configs override the master. When a
result is surprising, read the metadata before re-reading the config.

## What feeds disease enrichment

[Stage 2](methods/disease-enrichment.md) consumes a single gene-by-program matrix
per method, assembled from the Hotspot modules and, for `de-dgca`, from the DE
and DGCA results. Program columns are named
`<method>_<perturbation>_<suffix>`, where the suffix identifies the program type
(`cnmf`, `hotspot`, `alpha`, `DE`, `DGCA`, `PC`). That naming is what lets the
selection step filter to a single perturbation or exclude pooled runs.
