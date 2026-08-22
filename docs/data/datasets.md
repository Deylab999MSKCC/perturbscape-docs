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
<dl><dt>Perturbations</dt><dd>257</dd><dt>Traits</dt><dd>10</dd><dt>Contexts</dt><dd>1</dd></dl>
</div>

<div class="ps-ds" markdown>
### Jurkat
<p class="ps-ds-sub">T lymphocyte leukemia line</p>
T-cell system scored against a broad panel of autoimmune conditions and blood
cell indices.
<dl><dt>Perturbations</dt><dd>186</dd><dt>Traits</dt><dd>23</dd><dt>Contexts</dt><dd>1</dd></dl>
</div>

<div class="ps-ds" markdown>
### K562-GWPS
<p class="ps-ds-sub">Genome-wide Perturb-seq</p>
By far the largest screen here, covering most expressed genes, scored against
erythroid indices.
<dl><dt>Perturbations</dt><dd>7,969</dd><dt>Traits</dt><dd>2</dd><dt>Contexts</dt><dd>1</dd></dl>
</div>

<div class="ps-ds" markdown>
### Monocytes
<p class="ps-ds-sub">Primary monocytes, KD and KO</p>
The only dataset with two perturbation modalities, analyzed separately.
<dl><dt>Perturbations</dt><dd>181</dd><dt>Traits</dt><dd>23</dd><dt>Contexts</dt><dd>2</dd></dl>
</div>

<div class="ps-ds" markdown>
### PerturbAI
<p class="ps-ds-sub">Brain, four neuronal subclasses</p>
Scored against autism, with results reported separately per neuronal subclass.
<dl><dt>Perturbations</dt><dd>1,858</dd><dt>Traits</dt><dd>1</dd><dt>Contexts</dt><dd>4</dd></dl>
</div>

<div class="ps-ds" markdown>
### T2D
<p class="ps-ds-sub">Pancreatic islet, D18</p>
Islet-derived cells split by endocrine status, scored against glycemic traits.
<dl><dt>Perturbations</dt><dd>32</dd><dt>Traits</dt><dd>2</dd><dt>Contexts</dt><dd>3</dd></dl>
</div>

<div class="ps-ds" markdown>
### TeloHAEC
<p class="ps-ds-sub">Aortic endothelial cells</p>
Telomerase-immortalized endothelium, scored against cardiovascular traits.
<dl><dt>Perturbations</dt><dd>580</dd><dt>Traits</dt><dd>3</dd><dt>Contexts</dt><dd>1</dd></dl>
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
    Lupus, Lymphocyte count, Mean Corpuscular Hemoglobin, Mean platelet vol.,
    Monocyte count, Multiple sclerosis, Platelet count, Primary biliary
    cirrhosis, Psoriasis, Red count, Rheumatoid arthritis, Type 1 diabetes,
    Ulcerative colitis, White count

=== "K562-GWPS"

    Mean Corpuscular Hemoglobin, Red Blood Cell Count

=== "Monocytes"

    All auto-immune, Allergy eczema diagnosed, Alzheimers, Asthma diagnosed,
    Celiac, Crohn's disease, Eosinophil count, Hypothyroidism self rep., IBD,
    Lupus, Lymphocyte count, Mean Corpuscular Hemoglobin, Mean platelet vol.,
    Monocyte count, Multiple sclerosis, Platelet count, Primary biliary
    cirrhosis, Psoriasis, Red count, Rheumatoid arthritis, Type 1 diabetes,
    Ulcerative colitis, White count

=== "PerturbAI"

    Autism

=== "T2D"

    HbA1C, Type 2 diabetes

=== "TeloHAEC"

    Coronary Artery Disease, Diastolic Blood Pressure, Systolic Blood Pressure

## Context values

`context` subdivides a dataset. What it subdivides *by* depends on the dataset,
which is why the column carries a neutral name.

| Dataset | Context values | Meaning |
|---|---|---|
| Monocytes | `Monocytes KD`, `Monocytes KO` | Perturbation modality - knockdown versus knockout |
| PerturbAI | `005_L4-5_IT_CTX_Glut`, `052_Pvalb_Gaba`, `151_TH_Prkcd_Grin2c_Glut`, `155_MB_Glut` | Neuronal subclass |
| T2D | `D18`, `D18 Endo`, `D18 Non-endo` | Cell state - all cells, endocrine, non-endocrine |
| HepG2, Jurkat, K562-GWPS, TeloHAEC | none | No subdivision; context repeats the dataset name |

For the four datasets without a subdivision, `context` is set to the dataset name
so that the column is never empty. The explorer displays a dash and hides the
context filter for those.

## Notes on trait naming

Trait names come from the GWAS panel used for each dataset and were kept as they
appear in the source results, with one exception: names differing only in
capitalization were merged onto their most frequent spelling, so *Mean
corpuscular hemoglobin* and *Mean Corpuscular Hemoglobin* are one trait.

Differently worded names were **not** merged. `Red count` (Jurkat, Monocytes) and
`Red Blood Cell Count` (K562-GWPS) remain separate entries even though they
measure closely related quantities, because they come from different GWAS panels
and merging them would misrepresent the source. Filter for both if you want the
combined view.

## Comparing across datasets

tau\* is standardized by total trait heritability, so values are comparable
across annotations and across traits. Comparisons **across datasets** still
warrant care:

- Screens differ enormously in size. K562-GWPS tests 7,969 perturbations against
  2 traits; T2D tests 32 against 2. Multiple-testing burden is not comparable.
- The variant-to-gene links used in
  [annotation](../docs/methods/disease-enrichment.md#step-3-variant-annotation)
  are restricted by tissue, so the SNP universe reachable by a program differs
  between a liver and a brain dataset.
- Trait panels barely overlap, so most cross-dataset comparisons are between
  different traits as well as different cell systems.
