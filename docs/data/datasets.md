# Datasets

Seven Perturb-seq datasets have been processed through PerturbScape. Each was
scored against the traits most relevant to the cell system it comes from, so the
trait list differs substantially between them.

!!! warning "Source citations pending"
    The descriptions below cover the cell system and what was tested. The
    primary reference for each underlying screen is still to be added.

<div class="ps-ds-grid" markdown>

<div class="ps-ds" markdown>
### HepG2
<p class="ps-ds-sub">Hepatocellular carcinoma line</p>
Liver-derived cells, scored against circulating liver-function and lipid
biomarkers.
<dl><dt>Perturbations</dt><dd>255</dd><dt>Traits</dt><dd>10</dd><dt>Contexts</dt><dd>1</dd></dl>
</div>

<div class="ps-ds" markdown>
### Jurkat
<p class="ps-ds-sub">T lymphocyte leukemia line</p>
T-cell system scored against a broad panel of autoimmune conditions and blood
cell indices.
<dl><dt>Perturbations</dt><dd>184</dd><dt>Traits</dt><dd>19</dd><dt>Contexts</dt><dd>1</dd></dl>
</div>

<div class="ps-ds" markdown>
### K562-GWPS
<p class="ps-ds-sub">Genome-wide Perturb-seq</p>
By far the largest screen here, covering most expressed genes, scored against
erythroid indices.
<dl><dt>Perturbations</dt><dd>7,991</dd><dt>Traits</dt><dd>2</dd><dt>Contexts</dt><dd>1</dd></dl>
</div>

<div class="ps-ds" markdown>
### Monocytes
<p class="ps-ds-sub">Knockdown and knockout</p>
The only dataset with two perturbation modalities, analyzed and plotted
separately.
<dl><dt>Perturbations</dt><dd>193</dd><dt>Traits</dt><dd>23</dd><dt>Contexts</dt><dd>2</dd></dl>
</div>

<div class="ps-ds" markdown>
### PerturbAI
<p class="ps-ds-sub">Brain, four neuronal subclasses</p>
Scored against autism, with results reported separately per neuronal subclass.
<dl><dt>Perturbations</dt><dd>1,855</dd><dt>Traits</dt><dd>1</dd><dt>Contexts</dt><dd>4</dd></dl>
</div>

<div class="ps-ds" markdown>
### T2D
<p class="ps-ds-sub">Pancreatic islet differentiation</p>
Islet-directed differentiation sampled across stages, scored against glycemic
traits.
<dl><dt>Perturbations</dt><dd>33</dd><dt>Traits</dt><dd>2</dd><dt>Contexts</dt><dd>6</dd></dl>
</div>

<div class="ps-ds" markdown>
### TeloHAEC
<p class="ps-ds-sub">Aortic endothelial cells</p>
Telomerase-immortalized endothelium, scored against cardiovascular traits.
<dl><dt>Perturbations</dt><dd>577</dd><dt>Traits</dt><dd>3</dd><dt>Contexts</dt><dd>1</dd></dl>
</div>

</div>

## Traits tested per dataset

The trait panel was chosen to match the tissue, which is why HepG2 carries liver
biomarkers and TeloHAEC carries blood pressure and coronary artery disease.

=== "HepG2"

    Alanine aminotransferase, Alkaline phosphatase, Aspartate aminotransferase,
    Cholesterol, Gamma glutamyltransferase, HDL cholesterol, LDL direct,
    Lipoprotein A, Total bilirubin, Triglycerides

=== "Jurkat"

    All auto-immune, Allergy eczema diagnosed, Alzheimers, Asthma diagnosed,
    Celiac, Crohn's disease, Eosinophil count, Hypothyroidism self rep., IBD,
    Lupus, Lymphocyte count, Monocyte count, Multiple sclerosis, Primary biliary
    cirrhosis, Psoriasis, Rheumatoid arthritis, Type 1 diabetes, Ulcerative
    colitis, White count

=== "K562-GWPS"

    Mean corpuscular hemoglobin, Red blood cell count

=== "Monocytes"

    All auto-immune, Allergy eczema diagnosed, Alzheimers, Asthma diagnosed,
    Celiac, Crohn's disease, Eosinophil count, Hypothyroidism self rep., IBD,
    Lupus, Lymphocyte count, Mean corpuscular hemoglobin, Mean platelet vol.,
    Monocyte count, Multiple sclerosis, Platelet count, Primary biliary
    cirrhosis, Psoriasis, Red blood cell count, Rheumatoid arthritis, Type 1
    diabetes, Ulcerative colitis, White count

=== "PerturbAI"

    Autism

=== "T2D"

    HbA1C, Type 2 diabetes

=== "TeloHAEC"

    Coronary artery disease, Diastolic blood pressure, Systolic blood pressure

## Context values

`context` subdivides a dataset. What it subdivides *by* depends on the dataset,
which is why the column carries a neutral name.

| Dataset | Context values | Meaning |
|---|---|---|
| Monocytes | `Monocytes KD`, `Monocytes KO` | Perturbation modality — knockdown versus knockout |
| PerturbAI | `005_L4-5_IT_CTX_Glut`, `052_Pvalb_Gaba`, `151_TH_Prkcd_Grin2c_Glut`, `155_MB_Glut` | Neuronal subclass |
| T2D | `D3`, `D7`, `D11`, `D18`, `D18 Endo`, `D18 Non-endo` | Differentiation stage, with day 18 additionally split by endocrine status |
| HepG2, Jurkat, K562-GWPS, TeloHAEC | none | No subdivision; `context` repeats the dataset name |

For the four datasets without a subdivision, `context` is set to the dataset
name so the column is never empty. The explorer hides the context selector for
those.

Each context is scored and plotted independently: selecting Monocytes KD gives a
different UMAP from Monocytes KO, and each T2D stage has its own.

## Aggregate runs

Every dataset also carries one or two entries that are **not** perturbations:
`All` and, in all but K562-GWPS and PerturbAI, `Pooled`. They are aggregate
meta-programs summarising a whole screen and are excluded from the perturbation
counts above. See
[All and Pooled are not perturbations](guide.md#all-and-pooled-are-not-perturbations).

## Notes on trait naming

Trait names come from the GWAS panel used for each dataset and are kept as they
appear in the source results. The build script merges names that differ only in
capitalization onto their most frequent spelling; the current source files are
already consistent, so no merges are being applied.

Names are not merged across different wordings. If two panels describe a
closely related quantity differently, both entries stand, because merging them
would misrepresent the source.

## Comparing across datasets

TRS is standardized by total trait heritability, so values are comparable across
annotations and across traits. Comparisons **across datasets** still warrant
care:

- Screens differ enormously in size. K562-GWPS tests 7,991 perturbations against
  2 traits; T2D tests 33 against 2. Multiple-testing burden is not comparable.
- The variant-to-gene links used in
  [annotation](../docs/methods/disease-enrichment.md#step-3-variant-annotation)
  are restricted by tissue, so the SNP universe reachable by a program differs
  between a liver and a brain dataset.
- Trait panels barely overlap, so most cross-dataset comparisons are between
  different traits as well as different cell systems.

UMAP coordinates are computed per dataset and trait. Positions are meaningful
only within a single plot — a point at the same coordinates in two different
UMAPs means nothing.
