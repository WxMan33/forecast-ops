#!/usr/bin/env python3
"""Apply criterion 5 of docs/severe-phase2-criteria.md (committed before CONUS scores existed)."""
import json
import sys
from pathlib import Path

REF = "conus_v07_recipe"


def judge(card):
    out = {}
    for cand in ("conus_logistic", "conus_gbt"):
        out[cand] = {}
        for product, e in card["products"].items():
            if cand not in e["all_supported"]["models"]:
                continue
            regions = {r: v["interior"] for r, v in e["regions"].items() if v["interior"]["event_dates"] >= 3}
            better = [r for r, b in regions.items()
                      if b["models"][cand]["brier_skill_vs_climatology"] > b["models"][REF]["brier_skill_vs_climatology"]]
            lo, hi = e["bootstrap_vs_recipe"]["models"][cand]["brier_minus_reference_95"]
            if len(regions) < 2:
                verdict = "inconclusive"
            else:
                verdict = "holds" if (len(better) >= 2 and len(better) > len(regions) / 2 and lo <= 0) else "does_not_hold"
            out[cand][product] = {"verdict": verdict, "conclusive_regions": sorted(regions),
                                  "better_than_reference": sorted(better),
                                  "brier_minus_reference_95": [lo, hi],
                                  "inconclusive_regions": sorted(set(e["regions"]) - set(regions))}
    return out


if __name__ == "__main__":
    study = Path(sys.argv[1] if len(sys.argv) > 1 else "research/severe/conus-v1/study")
    res = judge(json.loads((study / "scorecard.json").read_text()))
    (study / "judgement.json").write_text(json.dumps(res, indent=1) + "\n")
    for cand, products in res.items():
        print(f"## {cand} vs {REF}")
        for p, v in products.items():
            print(f"  {p:13s} {v['verdict']:14s} better in {v['better_than_reference']} of {v['conclusive_regions']}; "
                  f"Brier diff 95% {v['brier_minus_reference_95'][0]:+.1e}..{v['brier_minus_reference_95'][1]:+.1e}")
