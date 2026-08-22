# Linear Contrastive Modules

<span class="ps-pill">cpca</span> <span class="ps-pill">contrapc</span>

Two formulations of the same idea: find directions with high variance in
perturbed cells and low variance in controls. They differ only in how the two
covariance matrices are combined - `cpca` subtracts, `contrapc` whitens.

Both are implemented in a shared `contrastive.py`; the modules differ in which
class they instantiate and therefore in a single method, `_contrast()`.

| | `cpca` | `contrapc` |
|---|---|---|
| Class | `CPCA` | `ContraNorm` |
| Objective | Subtractive | Ratio / whitening |
| Alpha range | Unbounded, log grid | Bounded `[0, 1]`, linear grid |
| Grid size | 40 | 40 |
| Endpoints forced into result | none | `0.0` and `1.0` |
| Extra parameter | `max_log_alpha` | `gamma` |
| Suggested `mem_mb` | 128,000 | 128,000 |

---

## cpca

Contrastive PCA with the **subtractive** objective.

\[
\Sigma(\alpha) = C_t - \alpha\, C_b
\]

where \(C_t\) and \(C_b\) are the target and background covariance matrices. The
embedding is the top `n_components` eigenvectors of \(\Sigma(\alpha)\). At
\(\alpha = 0\) this is plain PCA on the target; as \(\alpha\) grows, directions
carrying background variance are penalized more heavily.

### Choosing alpha

With `transform_mode: "auto"` the pipeline evaluates

\[
\alpha \in \{0\} \cup \mathrm{logspace}(-1,\ A,\ 40)
\]

where \(A\) is `max_log_alpha`, then spectral-clusters the resulting subspaces
into four groups and returns one exemplar per group. The cluster containing
\(\alpha = 0\) is skipped, so plain PCA is never returned as one of the four.

### Parameters

```yaml
# cpca/config.yaml
use_de_genes: false
max_log_alpha: 3
transform_mode: "auto"
manual_alpha: null
n_components: 10
project_which: "target"
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `max_log_alpha` | float | `3` | Upper bound of the log alpha grid; `3` means alpha up to 1000 |
| `n_components` | int | `10` | Components retained per alpha |
| `use_de_genes` | bool | `false` | Restrict to differential genes first |
| `transform_mode` | str | `"auto"` | `"auto"` or `"manual"` |
| `manual_alpha` | float | `null` | Required when `transform_mode: "manual"` |
| `project_which` | str | `"target"` | `"target"`, `"background"`, or `"both"` |

!!! tip "Tuning `max_log_alpha`"
    If all four selected alpha cluster near the top of the range, the useful
    contrast lies beyond it - raise `max_log_alpha`. If they cluster near the
    bottom, lower it for finer resolution where it matters. Inspect
    `cpca_best_alphas.txt` to see what was chosen.

### Outputs

| File | Contents |
|---|---|
| `cpca_projection.csv` | Cell coordinates, columns `alpha_<a>_pc_<i>` |
| `cpca_eigenvalues.csv` | Eigenvalues per alpha and component |
| `cpca_eigenvectors.csv` | Gene loadings per alpha and component |
| `cpca_best_alphas.txt` | The four alpha values selected |
| `cpca_metadata.txt` | Run parameters |
| `hotspot_cpca_*` | See [Hotspot](hotspot.md) |

### Cost

Forty eigendecompositions of a gene by gene covariance matrix, plus the spectral
clustering. Memory is driven by the number of genes surviving filtering, not the
number of cells. Setting `use_de_genes: true` shrinks the gene space
substantially and is the most effective lever if the module will not fit.

---

## contrapc

Contrastive PCA with the **ratio** objective. Rather than subtracting background
variance, it whitens by it.

With the regularized background eigendecomposition
\(C_b + \gamma I = V \Lambda V^\top\),

\[
\Sigma(\alpha) = V \Lambda^{-\alpha} V^\top C_t
\]

This interpolates between two interpretable endpoints:

| alpha | Meaning |
|---|---|
| `0` | Plain PCA on target cells, no background correction |
| `1` | Full background whitening, \(C_b^{-1} C_t\) |

Because the interpolation is bounded, alpha is comparable across datasets -
unlike cPCA's unbounded alpha, whose useful range depends on the relative scale
of the two covariance matrices.

### The role of gamma

```yaml
gamma: 0.001
```

\(\gamma\) is a ridge term added to \(C_b\) before inversion. Background
covariance matrices in single-cell data are routinely rank-deficient - fewer
control cells than genes guarantees it - so without \(\gamma\) the inverse does
not exist.

!!! warning "gamma is load-bearing, not cosmetic"
    Too small and the inversion amplifies noise in the smallest background
    eigenvalues, producing unstable components. Too large and it swamps the real
    background structure, collapsing the method toward plain PCA. If high-alpha
    components look like noise, raise `gamma` before concluding the method has
    failed.

### Choosing alpha

The grid is linear and closed:

\[
\alpha \in \mathrm{linspace}(0,\ 1,\ 40)
\]

Spectral clustering selects exemplars, but unlike cPCA the endpoints are
**forced into the result**. The final set is `[0, exemplar_1, exemplar_2, 1]`, so
every ContraPC run returns both the uncorrected view and the fully whitened view
plus two intermediate regimes. Two of the four alpha are always identical, which
makes outputs directly comparable across perturbations.

### Parameters

```yaml
# contrapc/config.yaml
use_de_genes: false
gamma: 0.001
transform_mode: "auto"
manual_alpha: null
n_components: 10
project_which: "target"
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `gamma` | float | `0.001` | Ridge regularization on \(C_b\) |
| `n_components` | int | `10` | Components retained per alpha |
| `use_de_genes` | bool | `false` | Restrict to differential genes first |
| `transform_mode` | str | `"auto"` | `"auto"` or `"manual"` |
| `manual_alpha` | float | `null` | Must lie in `[0, 1]` |
| `project_which` | str | `"target"` | `"target"`, `"background"`, or `"both"` |

There is no `max_log_alpha` - the alpha range is fixed by construction.

### Outputs

| File | Contents |
|---|---|
| `contrapc_projection.csv` | Cell coordinates, columns `alpha_<a>_pc_<i>` |
| `contrapc_eigenvalues.csv` | Eigenvalues per alpha and component |
| `contrapc_eigenvectors.csv` | Gene loadings per alpha and component |
| `contrapc_best_alphas.txt` | The four alpha, always including `0.0` and `1.0` |
| `contrapc_metadata.txt` | Run parameters |
| `hotspot_contrapc_*` | See [Hotspot](hotspot.md) |

### Cost

Slightly heavier than `cpca`: one additional eigendecomposition of
\(C_b + \gamma I\), cached and reused across alpha.

---

## Which to use

Run both. They fail differently, and disagreement between them is diagnostic
rather than a nuisance:

- cPCA's alpha is unbounded and dataset-dependent, so its useful range needs
  tuning, but it makes no assumption about the conditioning of \(C_b\).
- ContraPC's alpha is bounded and comparable, but it needs \(C_b\) to be
  well-conditioned and pays for the eigendecomposition.

Both feed [disease enrichment](../methods/disease-enrichment.md) independently,
where program selection decides which of their components actually carry genetic
signal.

## See also

- [Kernel Contrastive](kernel-contrastive.md) - the same objectives, nonlinear
- [Non-Contrastive Baselines](baselines.md) - the alpha = 0 reference
- [Contrastive Embeddings](../methods/embeddings.md) - full mathematical treatment
