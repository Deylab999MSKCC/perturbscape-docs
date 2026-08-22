#!/usr/bin/env python3
"""
Harmonize PerturbScape processed_data into two Parquet tables for the data portal.

Source files are not tracked in this repository. Point --source at the folder
holding the *_perturbation_trait_{meta_programs,pathways}.txt files and re-run
whenever the upstream results change.

    python scripts/build_data.py --source /path/to/processed_data

Schema differences handled here:
  * the optional leading grouping column is named `data`, `subclass` or `cell`
    depending on the dataset, and is absent entirely for four of them -> unified
    into `context` (falls back to the dataset name when absent)
  * `Ensembl` is present only in HepG2 / Jurkat / K562-GWPS -> dropped
  * trait names differing only by capitalization are merged onto the most
    frequent spelling
"""
import argparse
import collections
import json
import pathlib
import sys

import pyarrow as pa
import pyarrow.csv as pcsv
import pyarrow.parquet as pq

STRATUM_COLUMNS = ("data", "subclass", "cell")
MP_SUFFIX = "_perturbation_trait_meta_programs.txt"
PW_SUFFIX = "_perturbation_trait_pathways.txt"


def read_tsv(path):
    return pcsv.read_csv(path, parse_options=pcsv.ParseOptions(delimiter="\t"))


def context_column(table, columns, dataset):
    """Return the stratum column as strings, or the dataset name when absent."""
    stratum = next((c for c in STRATUM_COLUMNS if c in columns), None)
    if stratum:
        return table[stratum].cast(pa.string())
    return pa.chunked_array([pa.array([dataset] * table.num_rows, pa.string())])


def canonical_trait_map(all_traits):
    """Map every trait spelling onto the most frequent casing of that spelling."""
    by_lower = collections.defaultdict(collections.Counter)
    for trait, count in all_traits.items():
        by_lower[trait.strip().lower()][trait.strip()] += count
    mapping = {}
    for variants in by_lower.values():
        canonical = variants.most_common(1)[0][0]
        for variant in variants:
            mapping[variant] = canonical
    return mapping


def apply_trait_map(table, mapping):
    traits = table["trait"].cast(pa.string()).to_pylist()
    mapped = [mapping.get(t.strip(), t.strip()) if t else t for t in traits]
    idx = table.column_names.index("trait")
    return table.set_column(idx, "trait", pa.array(mapped, pa.string()))


def dictionary_encode(table):
    return pa.table({
        name: (table[name].dictionary_encode()
               if pa.types.is_string(table[name].type) else table[name])
        for name in table.column_names
    })


def collect_trait_counts(source):
    counts = collections.Counter()
    for path in sorted(source.glob(f"*{PW_SUFFIX}")) + sorted(source.glob(f"*{MP_SUFFIX}")):
        table = read_tsv(path)
        for trait in table["trait"].cast(pa.string()).to_pylist():
            if trait:
                counts[trait.strip()] += 1
    return counts


def build_meta_programs(source, trait_map):
    parts = []
    for path in sorted(source.glob(f"*{MP_SUFFIX}")):
        dataset = path.name[: -len(MP_SUFFIX)]
        table = read_tsv(path)
        columns = table.column_names
        parts.append(pa.table({
            "dataset": pa.array([dataset] * table.num_rows, pa.string()),
            "context": context_column(table, columns, dataset),
            "perturbation": table["perturbation"].cast(pa.string()),
            "trait": table["trait"].cast(pa.string()),
            "gene": table["HGNC"].cast(pa.string()),
            "rank": table["rank"].cast(pa.float32()),
        }))
        print(f"  {dataset:<12} {table.num_rows:>9,} rows", file=sys.stderr)
    combined = apply_trait_map(pa.concat_tables(parts), trait_map)
    return combined.sort_by([
        ("dataset", "ascending"), ("trait", "ascending"),
        ("perturbation", "ascending"), ("rank", "ascending"),
    ])


def build_pathways(source, trait_map):
    parts = []
    for path in sorted(source.glob(f"*{PW_SUFFIX}")):
        dataset = path.name[: -len(PW_SUFFIX)]
        table = read_tsv(path)
        columns = table.column_names
        parts.append(pa.table({
            "dataset": pa.array([dataset] * table.num_rows, pa.string()),
            "context": context_column(table, columns, dataset),
            "perturbation": table["perturbation"].cast(pa.string()),
            "trait": table["trait"].cast(pa.string()),
            "tau": table["tau"].cast(pa.float64()),
            "pvalue_tau": table["pvalue_tau"].cast(pa.float64()),
            "pathways": table["pathways"].cast(pa.string()),
            "neglog10p_pathways": table["neglog10p_pathways"].cast(pa.string()),
        }))
        print(f"  {dataset:<12} {table.num_rows:>9,} rows", file=sys.stderr)
    combined = apply_trait_map(pa.concat_tables(parts), trait_map)
    return combined.sort_by([
        ("dataset", "ascending"), ("pvalue_tau", "ascending"),
    ])


def write_manifest(meta, paths, out_dir, sizes):
    def uniq(table, column):
        return sorted({v for v in table[column].cast(pa.string()).to_pylist() if v})

    datasets = {}
    ds_col = paths["dataset"].cast(pa.string()).to_pylist()
    ctx_col = paths["context"].cast(pa.string()).to_pylist()
    tr_col = paths["trait"].cast(pa.string()).to_pylist()
    pt_col = paths["perturbation"].cast(pa.string()).to_pylist()
    grouped = collections.defaultdict(lambda: {"contexts": set(), "traits": set(), "perturbations": set()})
    for d, c, t, p in zip(ds_col, ctx_col, tr_col, pt_col):
        grouped[d]["contexts"].add(c)
        grouped[d]["traits"].add(t)
        grouped[d]["perturbations"].add(p)
    for name, values in grouped.items():
        datasets[name] = {
            "contexts": sorted(values["contexts"]),
            "traits": sorted(values["traits"]),
            "n_perturbations": len(values["perturbations"]),
        }

    manifest = {
        "datasets": datasets,
        "all_traits": uniq(paths, "trait"),
        "totals": {
            "meta_program_rows": meta.num_rows,
            "pathway_rows": paths.num_rows,
            "datasets": len(datasets),
            "traits": len(uniq(paths, "trait")),
            "perturbations": len(uniq(paths, "perturbation")),
        },
        "files": sizes,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=1))
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", required=True, type=pathlib.Path,
                        help="folder containing the processed_data .txt files")
    parser.add_argument("--out", type=pathlib.Path, default=pathlib.Path("docs/data/tables"),
                        help="output folder for the Parquet tables")
    args = parser.parse_args()

    if not args.source.is_dir():
        parser.error(f"source folder not found: {args.source}")
    args.out.mkdir(parents=True, exist_ok=True)

    print("scanning trait names...", file=sys.stderr)
    trait_map = canonical_trait_map(collect_trait_counts(args.source))
    merged = {k: v for k, v in trait_map.items() if k != v}
    if merged:
        print(f"  merging {len(merged)} case-variant trait name(s):", file=sys.stderr)
        for variant, canonical in sorted(merged.items()):
            print(f"    {variant!r} -> {canonical!r}", file=sys.stderr)

    print("building meta_programs...", file=sys.stderr)
    meta = build_meta_programs(args.source, trait_map)
    print("building pathways...", file=sys.stderr)
    paths = build_pathways(args.source, trait_map)

    mp_out = args.out / "meta_programs.parquet"
    pw_out = args.out / "pathways.parquet"
    pq.write_table(dictionary_encode(meta), mp_out,
                   compression="zstd", use_dictionary=True, row_group_size=200_000)
    pq.write_table(dictionary_encode(paths), pw_out,
                   compression="zstd", use_dictionary=True, row_group_size=20_000)

    sizes = {
        "meta_programs.parquet": mp_out.stat().st_size,
        "pathways.parquet": pw_out.stat().st_size,
    }
    manifest = write_manifest(meta, paths, args.out, sizes)

    print("\nwrote:", file=sys.stderr)
    for name, size in sizes.items():
        print(f"  {name:<24} {size/1e6:6.2f} MB", file=sys.stderr)
    print(f"  manifest.json", file=sys.stderr)
    print(f"\n{manifest['totals']['meta_program_rows']:,} meta-program rows | "
          f"{manifest['totals']['pathway_rows']:,} pathway rows | "
          f"{manifest['totals']['datasets']} datasets | "
          f"{manifest['totals']['traits']} traits", file=sys.stderr)


if __name__ == "__main__":
    main()
