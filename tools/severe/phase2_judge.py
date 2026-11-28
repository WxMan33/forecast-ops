#!/usr/bin/env python3
"""Apply docs/severe-phase2-criteria.md (committed before scores existed) to the Phase 2 scorecard."""
import json
import math
import sys
from pathlib import Path

FIRST = {"tornado": 0.02, "wind": 0.05, "hail": 0.05}
CANDIDATES = ("phase2_logistic", "phase2_gbt")


def high_bins(model, hazard):
    rows = [r for r in model["reliability"] if r["lower"] >= FIRST[hazard] - 1e-12]
    points = sum(r["points"] for r in rows)
    events = sum(r["observed_rate"] * r["points"] for r in rows)
    forecast = sum(r["mean_probability"] * r["points"] for r in rows)
    dates = max((r["dates"] for r in rows), default=0)  # dates with a forecast in a bin (upper bound on event dates)
    return {"points": points, "event_points": round(events), "dates_with_forecast": dates,
            "ratio": (events / forecast) if forecast else None}


def judge(card):
    out = {}
    for cand in CANDIDATES:
        products, cal, reg = {}, {}, {}
        for name, e in card["products"].items():
            hazard = name.split("_")[1]
            a = e["all_samples"]["models"]
            boot = e["bootstrap_all_samples"]["models"][cand]
            lo, hi = boot["brier_minus_reference_95"]
            lower = a[cand]["brier"] < a["v07"]["brier"]
            products[name] = "improves" if hi < 0 else ("clearly_worse" if lo > 0 else
                                                         ("not_distinguishable_lower" if lower else "not_distinguishable_higher"))
            # Rule 2
            c, v = high_bins(a[cand], hazard), high_bins(a["v07"], hazard)
            conclusive = all(x["event_points"] >= 10 and x["dates_with_forecast"] >= 3 and x["ratio"] for x in (c, v))
            if not conclusive:
                cal[name] = {"result": "inconclusive", "candidate": c, "v07": v}
            else:
                ok = 0.5 <= c["ratio"] <= 2 or abs(math.log(c["ratio"])) < abs(math.log(v["ratio"]))
                cal[name] = {"result": "pass" if ok else "fail", "candidate": c, "v07": v}
            # Rule 3
            regions = {r: b for r, b in e["regions"].items() if b["event_dates"] >= 3}
            better = [r for r, b in regions.items()
                      if b["models"][cand]["brier_skill_vs_climatology"] > b["models"]["v07"]["brier_skill_vs_climatology"]]
            if len(regions) < 2:
                reg[name] = {"result": "inconclusive", "conclusive_regions": list(regions)}
            else:
                reg[name] = {"result": "pass" if len(better) >= 2 and len(better) > len(regions) / 2 else "fail",
                             "conclusive_regions": list(regions), "better_than_v07": better}
        n_ok = sum(v in ("improves", "not_distinguishable_lower", "not_distinguishable_higher") for v in products.values())
        n_lower = sum(card["products"][p]["all_samples"]["models"][cand]["brier"]
                      < card["products"][p]["all_samples"]["models"]["v07"]["brier"] for p in products)
        worse = [p for p, v in products.items() if v == "clearly_worse"]
        cal_fail = [p for p, v in cal.items() if v["result"] == "fail"]
        reg_fail = [p for p, v in reg.items() if v["result"] == "fail"]
        cal_inc = sum(v["result"] == "inconclusive" for v in cal.values())
        reg_inc = sum(v["result"] == "inconclusive" for v in reg.values())
        rule4 = n_ok >= 4 and n_lower > 3 and not worse and not cal_fail and not reg_fail
        if cal_inc > 3 or reg_inc > 3:
            verdict = "inconclusive_exploratory"
        else:
            verdict = "deserves_larger_test" if rule4 else "does_not_meet_bar"
        out[cand] = {"rule1": products, "lower_brier_products": n_lower, "clearly_worse": worse,
                     "rule2_calibration": cal, "rule3_regions": reg, "verdict": verdict}
    return out


if __name__ == "__main__":
    study = Path(sys.argv[1] if len(sys.argv) > 1 else "research/severe/phase2")
    result = judge(json.loads((study / "scorecard.json").read_text()))
    (study / "judgement.json").write_text(json.dumps(result, indent=1) + "\n")
    for cand, r in result.items():
        print(f"\n## {cand}: {r['verdict']}  (lower Brier on {r['lower_brier_products']}/6; clearly worse: {r['clearly_worse']})")
        for p in r["rule1"]:
            c = r["rule2_calibration"][p]; g = r["rule3_regions"][p]
            print(f"  {p:13s} brier={r['rule1'][p]:27s} cal={c['result']:12s} "
                  f"(cand {c['candidate']['event_points']}ev/{c['candidate']['dates_with_forecast']}d ratio {c['candidate']['ratio'] and round(c['candidate']['ratio'],2)}; "
                  f"v07 {c['v07']['event_points']}ev ratio {c['v07']['ratio'] and round(c['v07']['ratio'],2)})  "
                  f"regions={g['result']} {g.get('better_than_v07', '')}/{g['conclusive_regions']}")
