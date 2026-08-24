# FAQ

## Choosing methods

??? question "Which module should I run first?"
    [`pca`](modules/baselines.md#pca). It is the fastest and lightest, and exercises
    the same job hierarchy, Hotspot step, and output layout as everything else —
    so it validates your configuration cheaply. Then add
    [`cpca`](modules/linear-contrastive.md#cpca) and [`contrapc`](modules/linear-contrastive.md#contrapc).

??? question "What is the difference between `cpca` and `contrapc`?"
    The objective. `cpca` **subtracts** background covariance
    (\(C_t - \alpha C_b\)) with an unbounded α; `contrapc` **whitens** by it
    (\(C_b^{-\alpha} C_t\)) with α bounded in \([0, 1]\).

    Practically: `contrapc`'s α is comparable across datasets and it always
    returns α = 0 and α = 1, so results line up across perturbations. `cpca`'s α
    range depends on the relative scale of the two covariances and may need
    `max_log_alpha` tuning. See
    [Contrastive Embeddings](methods/embeddings.md).

??? question "Do I need the kernel modules?"
    Only if you suspect nonlinear structure. They cost roughly twice the memory
    and introduce seed dependence. Run the linear modules first; reach for
    [`kcpca`](modules/kernel-contrastive.md#kcpca) when the linear embeddings look
    uninformative despite adequate cell numbers.

??? question "Should I run all eight modules?"
    Running several is the point — the methods disagree, and a gene program
    recovered by three independent methods is far more credible than one seen
    under a single method and a single α. But start with two or three and expand
    once you know the per-job cost on your data.

## Configuration

??? question "What should `min_cells` be?"
    At least **25**, and realistically **50**. Contrastive modules hard-fail
    below 25 cells in either group, so anything lower submits jobs guaranteed to
    fail. The shipped default of `0` exists for flexibility, not as a
    recommendation.

??? question "How do I override a setting for just one module?"
    Set it in that module's `config.yaml`. Module values override the master.
    For nested blocks like `resources:`, the merge is shallow — specify only the
    keys you want to change and the rest are inherited. See
    [Configuration](configuration.md#the-nested-dict-subtlety).

??? question "`singular` or `pooled`?"
    `singular` for per-perturbation gene programs, which is what
    perturbation-level disease scoring requires. `pooled` for the shared
    perturbation response, and as a fast way to get a first result from a large
    screen. They answer different questions — see
    [Analysis Modes](configuration.md#analysis-modes).

??? question "How many components should I keep?"
    The default of 10 is reasonable. For [`pca`](modules/baselines.md#pca), check
    `pca_variance_ratio.csv` — if the last components carry negligible variance,
    10 is enough. Remember contrastive modules produce `4 × n_components`
    columns, one block per selected α.

## Running

??? question "`run_modules.sh --mem` doesn't fix my out-of-memory errors"
    Correct — it sizes the **wrapper** job, which just runs Snakemake. Analysis
    job memory comes from `resources.mem_mb` in the module's `config.yaml`. See
    [the two levels](configuration.md#resources-and-slurm).

??? question "How do I rerun only Hotspot after changing its parameters?"
    ```bash
    ./run_modules.sh --submit --modules cpca --forcerun cpca_hotspot
    ```
    Forcing the decomposition rule would recompute the embedding too, which is
    much more expensive and unnecessary.

??? question "Can I run this without SLURM?"
    Not as shipped. `run_modules.sh` wraps `sbatch`, and each module carries a
    SLURM profile. You could invoke Snakemake directly with a different executor
    plugin, but the default resource requests — 128 GB, 256 GB for kernel
    modules — make anything but a cluster impractical for real data.

??? question "A few perturbations failed. How do I retry just those?"
    Resubmit. Snakemake reruns anything with missing outputs and skips completed
    targets:
    ```bash
    ./run_modules.sh --submit --modules cpca
    ```

## Results

??? question "What is module `-1` in the Hotspot output?"
    Genes that passed the FDR cutoff but did not join a cluster meeting
    `hotspot_min_gene_threshold`. It means "unassigned", not "module number
    minus one", and it is often the largest group. Filter it out.

??? question "Why does my projection have 40 columns when `n_components: 10`?"
    Contrastive modules run four α values and concatenate. Columns are named
    `alpha_<a>_pc_<i>`, so you get `4 × n_components`. See
    [Column conventions](outputs.md#alpha-indexed-columns).

??? question "Which cNMF spectra file should I use?"
    `gene_spectra_scores` is Z-scored — use it to rank genes **within** a
    program. `gene_spectra_tpm` is in expression units — use it to compare a
    gene **across** programs. Using the Z-scored file for cross-program
    comparison is a common error.

??? question "My results changed between two identical runs"
    [`pca`](modules/baselines.md#pca), [`cpca`](modules/linear-contrastive.md#cpca), and
    [`contrapc`](modules/linear-contrastive.md#contrapc) are deterministic. The kernel modules
    depend on `kernel_seed`. [`cnmf`](modules/baselines.md#cnmf) aggregates random
    restarts and [`contrastivevi`](modules/contrastivevi.md) trains a neural
    model without an exposed seed — both vary between runs.

??? question "`local_correlations.csv` is enormous"
    Expected — it is quadratic in the number of FDR-significant genes. Tighten
    `hotspot_fdr_threshold`, or delete these files once modules exist; the
    modules and scores are derived from them and do not need them retained.

??? question "Where is the disease enrichment code?"
    The eight Snakemake modules cover stage 1 only. Stage 2 - program selection,
    meta-program construction, variant annotation, S-LDSC, and TRS - runs
    separately and is documented step by step, with the code for each step, on
    [Disease Enrichment](methods/disease-enrichment.md). The scripts are
    adaptations of the published PoPS and sc-linker implementations and are not
    redistributed here, and the resources they read - GWAS summary statistics,
    MAGMA results, LD panels, variant-to-gene maps - are far too large to ship.

## Data

??? question "Can I download the published tables?"
    Yes — every table in the [Data Portal](../data/index.md) has a download
    button, and the download respects your active search filter.

## Disease enrichment

??? question "What does TRS actually measure?"
    The per-SNP contribution to heritability of a one standard deviation increase
    in the program annotation, standardized by total trait heritability so it is
    comparable across annotations and traits. See
    [Step 5](methods/disease-enrichment.md#step-5-trs-and-enrichment).

??? question "Why are so many TRS values exactly zero?"
    They are thresholded, not estimated as zero. The published `trs` column is
    set to `0` unless the jackknife mean is positive **and** the one-sided
    p-value is at most 0.05. Always read `trs` alongside `pvalue`.

??? question "Is a significant TRS evidence that the perturbation causes the trait?"
    No. The annotation is built from correlational variant-to-gene links and a
    gene ranking derived from GWAS signal, so a significant result says the
    perturbation's programs share genetic architecture with the trait. It is not
    a causal claim.

??? question "Why is the p-value one-sided?"
    The test asks only whether the annotation is *enriched* for heritability.
    Depletion is not tested, so the p-value should not be interpreted as a
    two-sided test of any effect.

??? question "What is the `All` perturbation in the published data?"
    The [pooled](configuration.md#analysis-modes) run for that dataset and trait -
    every perturbation combined and contrasted against control as one group. The
    [Data Portal](../data/index.md) hides these by default; enable
    **Include pooled (All)** to see them.
