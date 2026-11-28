#!/usr/bin/env python3
"""Compare reproducibility-check scorecards (research/severe/conus-v1/rrfs/retro/REPRODUCIBILITY.md)."""
import argparse
import json
from pathlib import Path


def flat(res, prefix=""):
    out = {}
    if isinstance(res, dict):
        for k, v in res.items():
            out |= flat(v, f"{prefix}/{k}")
    elif isinstance(res, list):
        for i, v in enumerate(res):
            out |= flat(v, f"{prefix}[{i}]")
    elif isinstance(res, (int, float)):
        out[prefix] = res
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--input", type=Path, required=True)
    p.add_argument("--reference", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    runs = {d.name: json.loads((d / "scorecard.json").read_text()) for d in sorted(a.input.iterdir()) if (d / "scorecard.json").exists()}
    ref = json.loads(a.reference.read_text())

    def compare(x, y):
        fx, fy = flat(x["results"]), flat(y["results"])
        keys = set(fx) & set(fy)
        diffs = [abs(fx[k] - fy[k]) for k in keys if fx[k] != fy[k] and fx[k] == fx[k]]
        nb = x["results"]["all_blocks"]["national"]["arms"]
        nr = y["results"]["all_blocks"]["national"]["arms"]
        br = [abs(fx[k] - fy[k]) / abs(fy[k]) for k in keys if k.endswith("/brier") and fy[k]]
        hk = [abs(fx[k] - fy[k]) for k in keys if k.endswith("/deployable/hits") or k.endswith("/diagnostic_equal_area/hits")]
        return {"results_identical": not diffs, "differing_values": len(diffs),
                "max_relative_brier_difference": max(br, default=0.0), "max_hit_count_difference": max(hk, default=0),
                "national_brier": {arm: [nb[arm]["brier"], nr[arm]["brier"]] for arm in nb if arm in nr},
                "national_hits": {arm: [nb[arm]["deployable"]["hits"], nr[arm]["deployable"]["hits"]] for arm in nb if arm in nr}}

    rep = {"rules": "research/severe/conus-v1/rrfs/retro/REPRODUCIBILITY.md", "jobs": {}, "pairs": {}}
    for name, r in runs.items():
        env = r.get("run_environment", {})
        rep["jobs"][name] = {"cpu_model": env.get("cpu_model"), "cpu_avx512f": env.get("cpu_avx512f"),
                             "numpy_active_avx512": env.get("numpy_active_avx512"), "env": env.get("env"),
                             "threadpools": env.get("threadpools"), "iterations": [l.split("iters ")[-1] for l in r["log"]],
                             "prediction_fingerprints": r["fingerprints"]["predictions"]}
    for x, y in (("pinned-1", "pinned-2"), ("unpinned-1", "unpinned-2")):
        if x in runs and y in runs:
            c = compare(runs[x], runs[y])
            c["prediction_fingerprints_identical"] = runs[x]["fingerprints"]["predictions"] == runs[y]["fingerprints"]["predictions"]
            c["coefficient_fingerprints_identical"] = runs[x]["fingerprints"]["coefficients"] == runs[y]["fingerprints"]["coefficients"]
            c["same_cpu_model"] = rep["jobs"][x]["cpu_model"] == rep["jobs"][y]["cpu_model"]
            c["same_avx512"] = rep["jobs"][x]["cpu_avx512f"] == rep["jobs"][y]["cpu_avx512f"]
            rep["pairs"][f"{x}_vs_{y}"] = c
    for name in runs:
        rep["pairs"][f"{name}_vs_first_scorecard"] = compare(runs[name], ref)
    pp = rep["pairs"].get("pinned-1_vs_pinned-2", {})
    rep["pass"] = bool(pp.get("prediction_fingerprints_identical") and pp.get("coefficient_fingerprints_identical") and pp.get("results_identical"))
    rep["hardware_differed_between_pinned_jobs"] = None if not pp else not (pp["same_cpu_model"] and pp["same_avx512"])
    a.output.mkdir(parents=True, exist_ok=True)
    (a.output / "repro.json").write_text(json.dumps(rep, indent=1) + "\n")
    print(json.dumps({k: rep[k] for k in ("pass", "hardware_differed_between_pinned_jobs")} |
                     {k: {kk: vv for kk, vv in v.items() if kk not in ("national_brier", "national_hits")} for k, v in rep["pairs"].items()}, indent=1))


if __name__ == "__main__":
    main()
