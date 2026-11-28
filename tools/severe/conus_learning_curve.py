#!/usr/bin/env python3
"""Day 2 wind learning curve for the CONUS boosted-tree recipe (development data only).

Question: does national skill keep rising with more training dates? If it does, the cheapest way to
close the gap to NadoCast is more training data rather than new predictors.

  fold     one of the 6 month-grouped outer folds over the 96 2022-23 development dates. The held-out
           months are scored by trees fit on random subsets of the other 80 dates (20, 40, 60 dates,
           3 seeds each; all 80 once). Writes per-date, per-region sums only.
  combine  pools the folds: BSS by training size (vs the 96-date development climatology), per region,
           and a whole-date bootstrap of the BSS change between sizes.

Same predictors, scaling, rows and tree settings as the frozen conus_gbt (no stage-2, no isotonic step:
the frozen monotone recalibration is refit per size from inner folds, as in the frozen recipe).
Research only: 2021 and 2025 never load (the loader refuses 2025; this script refuses anything but
2022-23); nothing touches the live feed, publisher or registry.
"""
import argparse
import json
from pathlib import Path

import numpy as np

import phase2_study as S
from conus_calibration import REGIONS, check_frozen, region_index
from conus_study import load, regions
from train_daily import fit_logistic

DAY, HAZ = 2, 1
SIZES = (20, 40, 60, 80)
SEEDS = (1, 2, 3)


def fit_predict(x, y, folds, train, test):
    """Frozen conus_gbt recipe on the given training rows: 3 inner folds for the monotone
    recalibration, then a full tree; returns held-out probabilities."""
    from scipy.special import expit
    from sklearn.ensemble import HistGradientBoostingClassifier
    xt, yt, g = x[train], y[train], folds[train] % 3
    oof = np.empty(train.sum())
    for k in np.unique(g):
        h = g == k
        oof[h] = HistGradientBoostingClassifier(**S.GBT_PARAMS).fit(xt[~h], yt[~h]).decision_function(xt[h])
    cal = fit_logistic(oof[:, None], yt, penalty=0.0001, monotone=True)
    tree = HistGradientBoostingClassifier(**S.GBT_PARAMS).fit(xt, yt)
    return expit(cal[0] + cal[1] * tree.decision_function(x[test]))


def fold(a):
    fitted, sha = check_frozen(a.models, a.manifest)
    cases, X, Y, coords, names, _ = load(a.conus)
    if any(not c.startswith(("2022", "2023")) for c in cases) or len(cases) != 96:
        raise ValueError("Exactly the 96 2022-23 development dates are allowed")
    keep = fitted["keep"]
    e, _ = S.engineer(X[:, DAY - 1][:, keep], names, fitted["scales"][DAY])
    x, y, d, p = S.rows(e, Y[:, DAY - 1][:, keep], HAZ)
    del X, e
    folds = np.array([S.fold_of(c) for c in cases])[d]
    reg = region_index(None, regions(coords), keep)[p]
    test = folds == a.fold
    pool = sorted(set(np.unique(d[~test]).tolist()))
    test_dates = np.unique(d[test])
    out = {"fold": a.fold, "frozen_models_sha256": sha, "test_dates": [cases[i] for i in test_dates],
           "pool_dates": len(pool), "regions": list(REGIONS), "configs": []}
    yt, dt, rt = y[test], d[test], reg[test]
    for size in SIZES:
        for seed in (SEEDS if size < len(pool) else (0,)):
            rng = np.random.default_rng(1000 * a.fold + 10 * size + seed)
            chosen = pool if size >= len(pool) else sorted(rng.choice(pool, size, replace=False).tolist())
            train = np.isin(d, chosen) & ~test
            prob = fit_predict(x, y, folds, train, test)
            sums = []
            for di in test_dates:
                m = dt == di
                for r in range(len(REGIONS)):
                    mr = m & (rt == r)
                    sums.append([int(di), r, int(mr.sum()), float(yt[mr].sum()), float(((prob[mr] - yt[mr]) ** 2).sum())])
            out["configs"].append({"size": size, "seed": seed, "train_dates": [cases[i] for i in chosen],
                                   "train_event_rows": int(y[train].sum()), "sums": sums})
            print(f"fold {a.fold}: size {size} seed {seed} done", flush=True)
    out["development_climatology"] = float(y.mean())
    a.output.mkdir(parents=True, exist_ok=True)
    (a.output / f"fold-{a.fold}.json").write_text(json.dumps(out) + "\n")


def bss(rows, clim):
    n, sy, sse = rows[:, 0].sum(), rows[:, 1].sum(), rows[:, 2].sum()
    ref = sy - 2 * clim * sy + n * clim * clim
    return 1 - sse / ref if ref > 0 else float("nan")


def combine(a):
    parts = [json.loads(f.read_text()) for f in sorted(a.input.glob("fold-*.json"))]
    if sorted(p["fold"] for p in parts) != list(range(S.FOLDS)):
        raise ValueError("Need all 6 folds")
    clim = parts[0]["development_climatology"]
    # per size: array (date, region) -> [n, sy, sse] averaged over seeds
    by = {}
    for p in parts:
        for c in p["configs"]:
            by.setdefault(c["size"], {}).setdefault((p["fold"], c["seed"]), c["sums"])
    tables = {}
    for size, runs in by.items():
        acc = {}
        cnt = {}
        for (f, _), sums in runs.items():
            for di, r, n, sy, sse in sums:
                k = (f, di, r)
                v = acc.setdefault(k, np.zeros(3))
                v += (n, sy, sse)
                cnt[k] = cnt.get(k, 0) + 1
        tables[size] = {k: v / cnt[k] for k, v in acc.items()}
    keys = sorted(tables[SIZES[-1]])
    dates = sorted({(f, di) for f, di, _ in keys})
    arr = {s: np.array([[tables[s][(f, di, r)] for r in range(len(REGIONS))] for f, di in dates]) for s in SIZES}
    res = {"development_climatology": clim, "dates": len(dates), "sizes": list(SIZES), "national": {}, "regions": {}}
    for s in SIZES:
        res["national"][s] = bss(arr[s].reshape(-1, 3), clim)
        res["regions"][s] = {REGIONS[r]: bss(arr[s][:, r], clim) for r in range(len(REGIONS))}
    rng = np.random.default_rng(20261124)
    boots = {}
    for lo, hi in ((20, 40), (40, 80), (20, 80)):
        diffs = {"national": []} | {r: [] for r in REGIONS}
        for _ in range(2000):
            i = rng.integers(0, len(dates), len(dates))
            diffs["national"].append(bss(arr[hi][i].reshape(-1, 3), clim) - bss(arr[lo][i].reshape(-1, 3), clim))
            for r, name in enumerate(REGIONS):
                diffs[name].append(bss(arr[hi][i, r], clim) - bss(arr[lo][i, r], clim))
        boots[f"{lo}->{hi}"] = {k: {"point": (res["national"][hi] - res["national"][lo]) if k == "national"
                                    else res["regions"][hi][k] - res["regions"][lo][k],
                                    "ci95": [float(np.nanpercentile(v, 2.5)), float(np.nanpercentile(v, 97.5))]}
                                for k, v in diffs.items()}
    res["bss_change"] = boots
    ln = np.log2(np.array(SIZES, float))
    res["national_bss_per_doubling"] = float(np.polyfit(ln, [res["national"][s] for s in SIZES], 1)[0])
    res["protected_2025_outcomes_accessed"] = False
    res["verification_2021_loaded"] = False
    a.output.mkdir(parents=True, exist_ok=True)
    (a.output / "learning-curve.json").write_text(json.dumps(res, indent=1, default=float) + "\n")
    lines = ["# Day 2 wind learning curve (out-of-fold 2022-23 development dates only)", "",
             f"BSS vs the development climatology ({clim:.5f}); held-out months scored by trees trained on N of the other 80 dates.", "",
             "| Training dates | National | " + " | ".join(REGIONS) + " |", "|---|---|" + "---|" * len(REGIONS)]
    for s in SIZES:
        lines.append(f"| {s} | {res['national'][s]:.3f} | " + " | ".join(f"{res['regions'][s][r]:.3f}" for r in REGIONS) + " |")
    lines += ["", f"National BSS gain per doubling of training dates (log-linear fit): {res['national_bss_per_doubling']:+.3f}", "",
              "| Change | National (95%) | " + " | ".join(REGIONS) + " |", "|---|---|" + "---|" * len(REGIONS)]
    for k, v in boots.items():
        lines.append(f"| {k} | " + " | ".join(f"{v[n]['point']:+.3f} ({v[n]['ci95'][0]:+.3f} to {v[n]['ci95'][1]:+.3f})"
                                              for n in ["national", *REGIONS]) + " |")
    (a.output / "learning-curve.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fold")
    f.add_argument("--fold", type=int, required=True)
    f.add_argument("--conus", type=Path, required=True)
    f.add_argument("--output", type=Path, required=True)
    f.add_argument("--models", type=Path, default=Path("research/severe/conus-v1/frozen/models.pkl"))
    f.add_argument("--manifest", type=Path, default=Path("research/severe/conus-v1/frozen/manifest.json"))
    c = sub.add_parser("combine")
    c.add_argument("--input", type=Path, required=True)
    c.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    {"fold": fold, "combine": combine}[a.cmd](a)


if __name__ == "__main__":
    main()
