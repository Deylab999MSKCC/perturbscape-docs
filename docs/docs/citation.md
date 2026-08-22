# Citation

## Citing PerturbScape

!!! note "Citation pending"
    The PerturbScape manuscript is in preparation. This page will carry the full
    reference on publication. In the meantime, cite the software repository:

    ```
    PerturbScape. Dey Lab, Memorial Sloan Kettering Cancer Center.
    https://github.com/Deylab999MSKCC/perturbscape
    ```

## Methods implemented

PerturbScape orchestrates published methods. If you use a specific module,
please cite the method it implements alongside PerturbScape.

### Contrastive PCA

Used by [`cpca`](modules/linear-contrastive.md#cpca) and [`kcpca`](modules/kernel-contrastive.md#kcpca).

> Abid, A., Zhang, M. J., Bagaria, V. K. & Zou, J. Exploring patterns enriched
> in a dataset with contrastive principal component analysis.
> *Nature Communications* **9**, 2134 (2018).

### Hotspot

Used by all seven embedding modules.

> DeTomaso, D. & Yosef, N. Hotspot identifies informative gene modules across
> modalities of single-cell genomics. *Cell Systems* **12**, 446–456 (2021).

### Consensus NMF

Used by [`cnmf`](modules/baselines.md#cnmf).

> Kotliar, D. *et al.* Identifying gene expression programs of cell-type
> identity and cellular activity with single-cell RNA-Seq. *eLife* **8**,
> e43803 (2019).

### ContrastiveVI

Used by [`contrastivevi`](modules/contrastivevi.md).

> Weinberger, E., Lin, C. & Lee, S.-I. Isolating salient variations of interest
> in single-cell data with contrastiveVI. *Nature Methods* **20**, 1336–1345
> (2023).

### DGCA

Used by [`de-dgca`](modules/de-dgca.md).

> McKenzie, A. T., Katsyv, I., Song, W.-M., Wang, M. & Zhang, B. DGCA: A
> comprehensive R package for differential gene correlation analysis.
> *BMC Systems Biology* **10**, 106 (2016).

### Fastfood

Used by the kernel approximation in [`kcpca`](modules/kernel-contrastive.md#kcpca) and
[`kcontrapc`](modules/kernel-contrastive.md#kcontrapc).

> Le, Q., Sarlós, T. & Smola, A. Fastfood — approximating kernel expansions in
> loglinear time. *Proceedings of the 30th International Conference on Machine
> Learning* (2013).

### PoPS

The meta-program construction in
[stage 2](methods/disease-enrichment.md#step-2-build-the-meta-program) follows
the Polygenic Priority Score approach.

> Weeks, E. M. *et al.* Leveraging polygenic enrichments of gene features to
> predict genes underlying complex traits and diseases. *Nature Genetics* **55**,
> 1267-1276 (2023).

### sc-linker

The variant annotation and heritability enrichment steps follow the sc-linker
framework.

> Jagadeesh, K. A. *et al.* Identifying disease-critical cell types and cellular
> processes by integrating single-cell RNA-sequencing and human genetics.
> *Nature Genetics* **54**, 1479-1492 (2022).

### Stratified LD score regression

> Finucane, H. K. *et al.* Partitioning heritability by functional annotation
> using genome-wide association summary statistics. *Nature Genetics* **47**,
> 1228-1235 (2015).

> Gazal, S. *et al.* Linkage disequilibrium-dependent architecture of human
> complex traits shows action of negative selection. *Nature Genetics* **49**,
> 1421-1427 (2017).

### MAGMA

Gene-level association statistics used as the response in program selection and
meta-program construction.

> de Leeuw, C. A., Mooij, J. M., Heskes, T. & Posthuma, D. MAGMA: generalized
> gene-set analysis of GWAS data. *PLoS Computational Biology* **11**, e1004219
> (2015).

### ENCODE E2G

Variant-to-gene links used to convert meta-program genes into SNP annotations.

> ENCODE Project Consortium. Expanded encyclopaedias of DNA elements in the human
> and mouse genomes. *Nature* **583**, 699-710 (2020).

### ConsensusPathDB

Pathway over-representation analysis of meta-program genes, drawing on its
Reactome and WikiPathways collections.

> Kamburov, A. & Herwig, R. ConsensusPathDB 2022: molecular interactions update
> as a resource for network biology. *Nucleic Acids Research* **50**, D587-D595
> (2022).

## Core dependencies

> Mölder, F. *et al.* Sustainable data analysis with Snakemake.
> *F1000Research* **10**, 33 (2021).

> Wolf, F. A., Angerer, P. & Theis, F. J. SCANPY: large-scale single-cell gene
> expression data analysis. *Genome Biology* **19**, 15 (2018).

## Data

Tables published through the [Data Portal](../data/index.md) should be cited
alongside the manuscript. If a Zenodo deposit is created for the full dataset,
its DOI will be listed here.

## Contact

Issues and questions:
[github.com/Deylab999MSKCC/perturbscape/issues](https://github.com/Deylab999MSKCC/perturbscape/issues)
