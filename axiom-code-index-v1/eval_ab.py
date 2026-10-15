#!/usr/bin/env python3
"""Paired A/B report, task-cluster bootstrap; stdlib only.

Input CSV (one aggregated locator+parent run per row):
 task_id,scenario,repeat,arm,latency_ms,budget_ms,input_total,output_total,input_cached,success
 A and B must have the same task/scenario/repeat keys. Tokens must already be
 normalized from provider usage; this script deliberately does NOT guess how
 cache tokens or reasoning tokens are included in a provider's input/output.

Failures receive at least budget_ms latency, so fast failures cannot look fast.
Bootstrap is descriptive, especially near 0/100% success; it is not a substitute
for a pre-registered non-inferiority design or adequate independent task counts.
"""
from __future__ import annotations
import argparse, csv, json, math, random, statistics
from collections import defaultdict
from pathlib import Path

NUMERIC = ("latency_ms", "budget_ms", "input_total", "output_total", "input_cached")


def percentile(values: list[float], p: float) -> float:
    values = sorted(values)
    if not values:
        raise ValueError("No values")
    index = (len(values)-1)*p
    low, high = math.floor(index), math.ceil(index)
    return values[low] + (values[high]-values[low])*(index-low)


def load_rows(path: Path) -> list[dict]:
    with path.open(encoding="utf-8", newline="") as handle:
        raw = list(csv.DictReader(handle))
    if not raw:
        raise ValueError("CSV is empty")
    rows, seen = [], set()
    for item in raw:
        for field in ("task_id", "scenario", "repeat", "arm", "success", *NUMERIC):
            if field not in item or item[field] == "":
                raise ValueError(f"Missing value: {field}")
        if item["arm"] not in ("A", "B") or item["success"] not in ("0", "1"):
            raise ValueError("arm must be A/B and success must be 0/1")
        key = (item["task_id"], item["scenario"], item["repeat"], item["arm"])
        if key in seen:
            raise ValueError(f"Duplicate row: {key}")
        seen.add(key)
        row = dict(item)
        for field in NUMERIC:
            row[field] = float(row[field])
            if not math.isfinite(row[field]) or row[field] < 0:
                raise ValueError(f"Invalid numeric value: {field}")
        if row["budget_ms"] <= 0 or row["input_cached"] > row["input_total"]:
            raise ValueError("Invalid budget or cache-subset accounting")
        row["success"] = int(row["success"])
        row["penalized_ms"] = row["latency_ms"] if row["success"] else max(row["latency_ms"], row["budget_ms"])
        row["tokens_total"] = row["input_total"] + row["output_total"]
        rows.append(row)
    a = {(r["task_id"],r["scenario"],r["repeat"]) for r in rows if r["arm"] == "A"}
    b = {(r["task_id"],r["scenario"],r["repeat"]) for r in rows if r["arm"] == "B"}
    if a != b:
        raise ValueError("A/B pairing is incomplete; do not drop missing/failed runs")
    for key in a:
        pair = [r for r in rows if (r["task_id"],r["scenario"],r["repeat"]) == key]
        if pair[0]["budget_ms"] != pair[1]["budget_ms"]:
            raise ValueError("Paired arms must have equal budgets")
    return rows


def analyze(rows: list[dict], iterations: int = 5000, seed: int = 20261014) -> dict:
    grouped = defaultdict(lambda: defaultdict(list))
    for row in rows:
        grouped[row["task_id"]][row["arm"]].append(row)
    metrics = ("penalized_ms", "tokens_total", "success")
    means = [{arm: {m: statistics.mean(r[m] for r in arms[arm]) for m in metrics}
              for arm in ("A", "B")} for _, arms in sorted(grouped.items())]
    if not means:
        raise ValueError("No paired tasks")
    rng = random.Random(seed)
    samples = {m: [] for m in metrics}
    for _ in range(iterations):
        selected = [means[rng.randrange(len(means))] for _ in means]
        for metric in metrics:
            a = statistics.mean(x["A"][metric] for x in selected)
            b = statistics.mean(x["B"][metric] for x in selected)
            samples[metric].append(b-a if metric == "success" else b/a if a else float("nan"))
    report = {"independent_tasks": len(means), "runs_per_arm": len(rows)//2, "arms": {}}
    for arm in ("A", "B"):
        part = [r for r in rows if r["arm"] == arm]
        report["arms"][arm] = {
            "success_rate": statistics.mean(r["success"] for r in part),
            "penalized_latency_p50_ms": percentile([r["penalized_ms"] for r in part], .5),
            "penalized_latency_p95_ms": percentile([r["penalized_ms"] for r in part], .95),
            "mean_tokens_total": statistics.mean(r["tokens_total"] for r in part),
            "sum_input_cached": sum(r["input_cached"] for r in part),
        }
    report["paired_task_means"] = {}
    for metric in metrics:
        a, b = (statistics.mean(x[arm][metric] for x in means) for arm in ("A", "B"))
        finite = [x for x in samples[metric] if math.isfinite(x)]
        report["paired_task_means"][metric] = {
            "effect": (b-a) if metric == "success" else (b/a if a else None),
            "effect_type": "B_minus_A" if metric == "success" else "B_divided_by_A",
            "bootstrap_95_interval": [percentile(finite,.025),percentile(finite,.975)] if finite else None,
        }
    report["warning"] = ("Descriptive task-cluster bootstrap, not an automatic release gate. "
        "Near-perfect success can produce a degenerate bootstrap interval; separately evaluate "
        "rare failures and non-inferiority. Pilot repeats do not increase independent task count.")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--bootstrap", type=int, default=5000)
    parser.add_argument("--seed", type=int, default=20261014)
    args = parser.parse_args()
    if args.bootstrap < 100:
        parser.error("--bootstrap must be >=100")
    try:
        rows = load_rows(args.csv)
        result = {scenario: analyze([r for r in rows if r["scenario"] == scenario], args.bootstrap,args.seed)
                  for scenario in sorted({r["scenario"] for r in rows})}
        text = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False)
        if args.out:
            args.out.write_text(text+"\n",encoding="utf-8")
        else:
            print(text)
    except (ValueError,OSError) as error:
        parser.exit(2, f"error: {error}\n")


if __name__ == "__main__":
    main()
