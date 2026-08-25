#!/usr/bin/env python3
"""
Harmonize PerturbScape results into the Parquet tables the data portal reads.

Source files are not tracked in this repository:

    python scripts/build_data.py \
        --source /path/to/processed_data \
        --umaps  /path/to/umaps

Produces three tables in docs/data/tables/ plus a manifest:

  pathways.parquet       one row per dataset/context/perturbation/trait
                         carrying TRS, its p-value, and enriched pathways
  meta_programs.parquet  top 100 ranked meta-program genes per that key
  umap.parquet           precomputed UMAP coordinates per that key

Naming
------
`tau` in the source is published as `trs` (Trait Relevance Score) and
`pvalue_tau` as `pvalue`. The underlying quantity is unchanged: it is the
standardized S-LDSC coefficient, zeroed unless positive and p <= 0.05.

Source quirks handled here
--------------------------
* the optional leading grouping column is named `data`, `subclass` or `cell`
  depending on the dataset, and is absent for four of them -> unified into
  `context`, falling back to the dataset name when absent
* `Ensembl` appears in only three files -> dropped in favour of HGNC
* trait names differing only by capitalization are merged onto the most
  frequent spelling
* UMAP files are named per dataset and, for the monocyte screens, per modality;
  T2D additionally uses a handful of perturbation spellings that differ from
  processed_data and are rewritten onto the processed_data form
* gene symbols are resolved to stable HGNC ids so the portal can deep-link to
  genenames.org. Symbol-based links break for genes HGNC has since renamed
  (NCL is now NUCLEOLIN), so the id is resolved once here instead
"""
import argparse
import collections
import json
import pathlib
import sys
import urllib.request

import pyarrow as pa
import pyarrow.csv as pcsv
import pyarrow.parquet as pq

STRATUM_COLUMNS = ("data", "subclass", "cell")
MP_SUFFIX = "_perturbation_trait_meta_programs.txt"
PW_SUFFIX = "_perturbation_trait_pathways.txt"

# umap filename stem -> (dataset, fixed context or None to read it from the file)
UMAP_SOURCES = {
    "hepg2":     ("HepG2", None),
    "jurkat":    ("Jurkat", None),
    "k562-gwps": ("K562-GWPS", None),
    "telohaec":  ("TeloHAEC", None),
    "perturbai": ("PerturbAI", "column"),
    "t2d-ko":    ("T2D", "column"),
    "yao-kd":    ("Monocytes", "Monocytes KD"),
    "yao-ko":    ("Monocytes", "Monocytes KO"),
}

# T2D perturbation spellings in the umap files -> the processed_data spelling,
# which is what the portal displays and joins on.
PERTURBATION_ALIASES = {
    "T2D": {
        "GATA4het":  "GATA4 HET",
        "GATA6het":  "GATA6 HET",
        "HHEXhet":   "HHEX HET",
        "HNF4Ahet":  "HNF4A HET",
        "QSER1TET1": "QSER1 & TET1",
        "TET1_2_3":  "TET1/2/3",
    },
}


HGNC_URL = ("https://storage.googleapis.com/public-download-files/hgnc/"
            "tsv/tsv/hgnc_complete_set.txt")


def load_hgnc(path):
    """symbol -> numeric HGNC id, covering current, previous and alias symbols.

    A current symbol always wins over a previous or alias hit, so a live gene is
    never shadowed by another gene's history.
    """
    if not path.exists():
        print(f"  downloading HGNC complete set -> {path}", file=sys.stderr)
        path.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(HGNC_URL, path)

    current, historical = {}, {}
    with path.open(encoding="utf-8") as fh:
        header = fh.readline().rstrip("\n").split("\t")
        idx = {name: i for i, name in enumerate(header)}
        need = ("hgnc_id", "symbol", "alias_symbol", "prev_symbol")
        if any(c not in idx for c in need):
            print("  WARNING: unexpected HGNC columns, skipping gene links",
                  file=sys.stderr)
            return {}
        for line in fh:
            f = line.rstrip("\n").split("\t")
            if len(f) <= idx["prev_symbol"]:
                continue
            raw = f[idx["hgnc_id"]]
            if not raw.startswith("HGNC:"):
                continue
            gid = int(raw.split(":", 1)[1])
            sym = f[idx["symbol"]].strip()
            if sym:
                current[sym] = gid
            for col in ("prev_symbol", "alias_symbol"):
                for alt in f[idx[col]].split("|"):
                    alt = alt.strip().strip('"')
                    if alt and alt not in historical:
                        historical[alt] = gid

    merged = dict(historical)
    merged.update(current)      # current symbols take precedence
    print(f"  {len(current):,} current symbols, "
          f"{len(historical):,} previous/alias symbols", file=sys.stderr)
    return merged


def read_tsv(path):
    return pcsv.read_csv(path, parse_options=pcsv.ParseOptions(delimiter="\t"))


def null_if_na(column):
    """The source writes a literal 'NA' where a meta-program enriched nothing.

    Left as text it renders as a pathway called "NA"; as null it is simply
    absent, which is what it means.
    """
    values = column.cast(pa.string()).to_pylist()
    cleaned = [None if v is None or v.strip() in ("NA", "NaN", "") else v
               for v in values]
    return pa.array(cleaned, pa.string())


def context_column(table, dataset):
    """The stratum column as strings, or the dataset name when absent."""
    stratum = next((c for c in STRATUM_COLUMNS if c in table.column_names), None)
    if stratum:
        return table[stratum].cast(pa.string())
    return pa.chunked_array([pa.array([dataset] * table.num_rows, pa.string())])


def canonical_trait_map(counts):
    """Map every trait spelling onto the most frequent casing of that spelling."""
    by_lower = collections.defaultdict(collections.Counter)
    for trait, n in counts.items():
        by_lower[trait.strip().lower()][trait.strip()] += n
    mapping = {}
    for variants in by_lower.values():
        canonical = variants.most_common(1)[0][0]
        for variant in variants:
            mapping[variant] = canonical
    return mapping


def remap(table, column, mapping):
    if not mapping:
        return table
    values = table[column].cast(pa.string()).to_pylist()
    mapped = [mapping.get(v.strip(), v.strip()) if v else v for v in values]
    return table.set_column(table.column_names.index(column), column,
                            pa.array(mapped, pa.string()))


def dictionary_encode(table):
    return pa.table({
        name: (table[name].dictionary_encode()
               if pa.types.is_string(table[name].type) else table[name])
        for name in table.column_names
    })


def collect_trait_counts(paths):
    counts = collections.Counter()
    for path in paths:
        table = read_tsv(path)
        if "trait" not in table.column_names:
            continue
        for trait in table["trait"].cast(pa.string()).to_pylist():
            if trait:
                counts[trait.strip()] += 1
    return counts


def build_meta_programs(source, trait_map):
    parts = []
    for path in sorted(source.glob(f"*{MP_SUFFIX}")):
        dataset = path.name[: -len(MP_SUFFIX)]
        t = read_tsv(path)
        parts.append(pa.table({
            "dataset": pa.array([dataset] * t.num_rows, pa.string()),
            "context": context_column(t, dataset),
            "perturbation": t["perturbation"].cast(pa.string()),
            "trait": t["trait"].cast(pa.string()),
            "gene": t["HGNC"].cast(pa.string()),
            "rank": t["rank"].cast(pa.float32()),
        }))
        print(f"  {dataset:<12} {t.num_rows:>9,} rows", file=sys.stderr)
    combined = remap(pa.concat_tables(parts), "trait", trait_map)
    return combined.sort_by([
        ("dataset", "ascending"), ("trait", "ascending"),
        ("perturbation", "ascending"), ("rank", "ascending"),
    ])


def build_pathways(source, trait_map):
    parts = []
    for path in sorted(source.glob(f"*{PW_SUFFIX}")):
        dataset = path.name[: -len(PW_SUFFIX)]
        t = read_tsv(path)
        parts.append(pa.table({
            "dataset": pa.array([dataset] * t.num_rows, pa.string()),
            "context": context_column(t, dataset),
            "perturbation": t["perturbation"].cast(pa.string()),
            "trait": t["trait"].cast(pa.string()),
            "trs": t["tau"].cast(pa.float64()),
            "pvalue": t["pvalue_tau"].cast(pa.float64()),
            "pathways": null_if_na(t["pathways"]),
            "neglog10p_pathways": null_if_na(t["neglog10p_pathways"]),
        }))
        print(f"  {dataset:<12} {t.num_rows:>9,} rows", file=sys.stderr)
    combined = remap(pa.concat_tables(parts), "trait", trait_map)
    empty = sum(1 for v in combined["pathways"].to_pylist() if v is None)
    print(f"  {empty:,} of {combined.num_rows:,} rows have no enriched pathways "
          f"({empty / max(1, combined.num_rows):.0%})", file=sys.stderr)
    return combined.sort_by([("dataset", "ascending"), ("pvalue", "ascending")])


def build_umaps(umaps, trait_map):
    parts = []
    for path in sorted(umaps.glob("*_umap.txt")):
        stem = path.name[: -len("_umap.txt")]
        if stem not in UMAP_SOURCES:
            print(f"  WARNING: no dataset mapping for {path.name}, skipped",
                  file=sys.stderr)
            continue
        dataset, context_rule = UMAP_SOURCES[stem]
        t = read_tsv(path)

        if context_rule == "column":
            ctx = context_column(t, dataset)
        elif context_rule is None:
            ctx = pa.chunked_array([pa.array([dataset] * t.num_rows, pa.string())])
        else:
            ctx = pa.chunked_array([pa.array([context_rule] * t.num_rows, pa.string())])

        part = pa.table({
            "dataset": pa.array([dataset] * t.num_rows, pa.string()),
            "context": ctx,
            "perturbation": t["perturbation"].cast(pa.string()),
            "trait": t["trait"].cast(pa.string()),
            "umap1": t["UMAP.1"].cast(pa.float32()),
            "umap2": t["UMAP.2"].cast(pa.float32()),
            "trs": t["TRS"].cast(pa.float64()),
        })
        print(f"  {path.name:<22} -> {dataset:<11} {t.num_rows:>7,} rows",
              file=sys.stderr)
        aliases = PERTURBATION_ALIASES.get(dataset)
        if aliases:
            before = set(part["perturbation"].cast(pa.string()).to_pylist())
            part = remap(part, "perturbation", aliases)
            renamed = sorted(before & set(aliases))
            if renamed:
                print(f"      renamed {len(renamed)} perturbation(s): "
                      f"{', '.join(renamed[:6])}", file=sys.stderr)
        parts.append(part)

    combined = remap(pa.concat_tables(parts), "trait", trait_map)
    return combined.sort_by([
        ("dataset", "ascending"), ("context", "ascending"),
        ("trait", "ascending"), ("perturbation", "ascending"),
    ])


def build_genes(meta, hgnc):
    """One row per distinct gene symbol with its HGNC id, for deep-linking.

    Kept out of meta_programs.parquet on purpose: 15k distinct symbols against
    4M rows, so a join table is a fraction of the size of an extra column.
    """
    symbols = sorted({g for g in meta["gene"].cast(pa.string()).to_pylist() if g})
    ids = [hgnc.get(g) for g in symbols] if hgnc else [None] * len(symbols)
    hit = sum(1 for i in ids if i is not None)
    print(f"  {hit:,}/{len(symbols):,} distinct symbols resolved "
          f"({hit / max(1, len(symbols)):.1%})", file=sys.stderr)
    if hit < len(symbols):
        unresolved = [g for g, i in zip(symbols, ids) if i is None]
        print(f"      unresolved: {', '.join(unresolved[:8])}"
              + (" ..." if len(unresolved) > 8 else ""), file=sys.stderr)
    return pa.table({
        "gene": pa.array(symbols, pa.string()),
        "hgnc_id": pa.array(ids, pa.int32()),
    })


def key_set(table, columns):
    cols = [table[c].cast(pa.string()).to_pylist() for c in columns]
    return set(zip(*cols))


def write_manifest(meta, paths, umap, out_dir, sizes):
    ds_col = paths["dataset"].cast(pa.string()).to_pylist()
    ctx_col = paths["context"].cast(pa.string()).to_pylist()
    tr_col = paths["trait"].cast(pa.string()).to_pylist()
    pt_col = paths["perturbation"].cast(pa.string()).to_pylist()

    # which dataset/context/trait combinations actually have umap coordinates
    umap_keys = key_set(umap, ("dataset", "context", "trait"))

    grouped = collections.defaultdict(
        lambda: {"contexts": set(), "traits": set(), "perturbations": set()})
    for d, c, t, p in zip(ds_col, ctx_col, tr_col, pt_col):
        grouped[d]["contexts"].add(c)
        grouped[d]["traits"].add(t)
        grouped[d]["perturbations"].add(p)

    datasets = {}
    for name, v in grouped.items():
        contexts = sorted(v["contexts"])
        umap_traits = sorted({
            t for t in v["traits"]
            if any((name, c, t) in umap_keys for c in contexts)
        })
        datasets[name] = {
            "contexts": contexts,
            "traits": sorted(v["traits"]),
            "umap_traits": umap_traits,
            "n_perturbations": len(v["perturbations"]),
        }

    manifest = {
        "score_name": "TRS",
        "score_long_name": "Trait Relevance Score",
        "datasets": datasets,
        "all_traits": sorted(set(tr_col)),
        "totals": {
            "datasets": len(datasets),
            "traits": len(set(tr_col)),
            "perturbations": len(set(pt_col)),
            "pairs": paths.num_rows,
            "meta_program_rows": meta.num_rows,
            "umap_points": umap.num_rows,
        },
        "files": sizes,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=1))
    return manifest


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", required=True, type=pathlib.Path,
                    help="folder holding the processed_data .txt files")
    ap.add_argument("--umaps", required=True, type=pathlib.Path,
                    help="folder holding the *_umap.txt files")
    ap.add_argument("--out", type=pathlib.Path,
                    default=pathlib.Path("docs/data/tables"))
    ap.add_argument("--hgnc", type=pathlib.Path,
                    default=pathlib.Path(".cache/hgnc_complete_set.txt"),
                    help="HGNC complete set TSV; downloaded here if absent")
    args = ap.parse_args()

    for label, folder in (("source", args.source), ("umaps", args.umaps)):
        if not folder.is_dir():
            ap.error(f"{label} folder not found: {folder}")
    args.out.mkdir(parents=True, exist_ok=True)

    print("scanning trait names...", file=sys.stderr)
    every = (sorted(args.source.glob(f"*{PW_SUFFIX}"))
             + sorted(args.source.glob(f"*{MP_SUFFIX}"))
             + sorted(args.umaps.glob("*_umap.txt")))
    trait_map = canonical_trait_map(collect_trait_counts(every))
    merged = {k: v for k, v in trait_map.items() if k != v}
    if merged:
        print(f"  merging {len(merged)} case-variant trait name(s):", file=sys.stderr)
        for variant, canonical in sorted(merged.items()):
            print(f"    {variant!r} -> {canonical!r}", file=sys.stderr)
    else:
        print("  no case-variant trait names found", file=sys.stderr)

    print("resolving HGNC ids...", file=sys.stderr)
    try:
        hgnc = load_hgnc(args.hgnc)
    except Exception as exc:
        print(f"  WARNING: could not load HGNC ({exc}); gene links will fall "
              f"back to symbol search", file=sys.stderr)
        hgnc = {}

    print("building meta_programs...", file=sys.stderr)
    meta = build_meta_programs(args.source, trait_map)
    print("building pathways...", file=sys.stderr)
    paths = build_pathways(args.source, trait_map)
    print("building umaps...", file=sys.stderr)
    umap = build_umaps(args.umaps, trait_map)
    print("building gene index...", file=sys.stderr)
    genes = build_genes(meta, hgnc)

    outputs = {
        "meta_programs.parquet": (meta, 200_000),
        "pathways.parquet": (paths, 20_000),
        "umap.parquet": (umap, 20_000),
        "genes.parquet": (genes, 20_000),
    }
    sizes = {}
    for name, (table, row_group) in outputs.items():
        target = args.out / name
        pq.write_table(dictionary_encode(table), target,
                       compression="zstd", use_dictionary=True,
                       row_group_size=row_group)
        sizes[name] = target.stat().st_size

    manifest = write_manifest(meta, paths, umap, args.out, sizes)

    # coverage report: how much of the portal actually links up
    pw_keys = key_set(paths, ("dataset", "context", "perturbation", "trait"))
    mp_keys = key_set(meta, ("dataset", "context", "perturbation", "trait"))
    um_keys = key_set(umap, ("dataset", "context", "perturbation", "trait"))

    print("\nwrote:", file=sys.stderr)
    for name, size in sizes.items():
        print(f"  {name:<24} {size/1e6:6.2f} MB", file=sys.stderr)
    print("  manifest.json", file=sys.stderr)

    t = manifest["totals"]
    print(f"\n{t['pairs']:,} pairs | {t['meta_program_rows']:,} gene ranks | "
          f"{t['umap_points']:,} umap points | {t['datasets']} datasets | "
          f"{t['traits']} traits", file=sys.stderr)

    no_genes = pw_keys - mp_keys
    orphan_umap = um_keys - pw_keys
    print(f"\ncoverage:", file=sys.stderr)
    print(f"  pairs without meta-program genes : {len(no_genes):,} / {len(pw_keys):,}",
          file=sys.stderr)
    if no_genes:
        by_ds = collections.Counter(k[0] for k in no_genes)
        for d, n in by_ds.most_common():
            print(f"      {d:<12} {n:,}", file=sys.stderr)
    print(f"  umap points without results      : {len(orphan_umap):,} / {len(um_keys):,}",
          file=sys.stderr)
    if orphan_umap:
        by_ds = collections.Counter(k[0] for k in orphan_umap)
        for d, n in by_ds.most_common():
            print(f"      {d:<12} {n:,}", file=sys.stderr)


if __name__ == "__main__":
    main()
