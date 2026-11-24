#!/usr/bin/env python3
"""Day 2 wind larger-training-set development gate (research/severe/conus-v1/fulldev-gate-rule.md).

  fold     one of 6 month-grouped outer folds over every extracted 2022-23 development date. Fits the
           frozen conus_gbt recipe on (a) all other dates and (b) only the original 96 cohort dates
           among them, and scores both on every held-out date. Writes per-date, per-region sums.
  combine  pools the folds and applies the committed pass rule.

Memory: ~728 dates do not fit as float64 rows, so training rows keep every event row and a fixed
20% of no-event rows (weight 5), drawn with a per-date seed. Both arms use the same sample, and
held-out dates are scored on every row. Research only: 2021 and 2025 never load (2022-23 only);
nothing touches the live feed, publisher or registry.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from scipy.optimize import minimize
from scipy.special import expit

import phase2_study as S
from cohort import calendar_cases
from conus_calibration import REGIONS, check_frozen, region_index
from conus_study import regions

DAY, HAZ = 2, 1
NEG_KEEP = 0.2
MIN_DATES = 700


def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def case_files(root, years=("2022", "2023")):
    out = {}
    for meta_path in sorted(Path(root).glob("*/conus-case.json")):
        meta = json.loads(meta_path.read_text())
        case = meta["case"]
        if not case.startswith(years) or case.startswith("2025"):
            raise ValueError(f"{case}: only {years} dates may be loaded here")
        path = meta_path.parent / meta["artifact"]["file"]
        out[case] = (path, meta["artifact"]["sha256"])
    return out


def load_case(path, sha, keep, scales, names_ref, coords_ref):
    if digest(path) != sha:
        raise ValueError(f"{path}: artifact hash mismatch")
    with np.load(path, allow_pickle=False) as d:
        if d["feature_names"].tolist() != names_ref or not np.array_equal(d["coordinates"], coords_ref):
            raise ValueError(f"{path}: grid or predictors differ")
        x = d["features"][DAY - 1][keep]
        y = d["labels"][DAY - 1][keep][:, HAZ]
    e, _ = S.engineer(x, names_ref, scales)
    known = y != 255
    return e[known].astype(np.float32), y[known].astype(np.float64), np.nonzero(known)[0]


def weighted_platt(z, y, w):
    """Monotone 1-D recalibration (slope >= 0), weighted log loss; same role as the frozen step."""
    r = np.average(y, weights=w)
    def f(p):
        t = p[0] + p[1] * z
        loss = np.average(np.logaddexp(0, t) - y * t, weights=w)
        g = w * (expit(t) - y) / w.sum()
        return loss + 5e-5 * p[1] ** 2, np.array([g.sum(), (g * z).sum() + 1e-4 * p[1]])
    res = minimize(f, np.array([np.log(r / (1 - r)), 1.0]), jac=True, method="L-BFGS-B",
                   bounds=[(None, None), (0, None)])
    return res.x


def fit(x, y, w, g):
    from sklearn.ensemble import HistGradientBoostingClassifier
    oof = np.empty(len(y))
    for k in range(3):
        h = g == k
        oof[h] = HistGradientBoostingClassifier(**S.GBT_PARAMS).fit(x[~h], y[~h], sample_weight=w[~h]).decision_function(x[h])
    cal = weighted_platt(oof, y, w)
    return HistGradientBoostingClassifier(**S.GBT_PARAMS).fit(x, y, sample_weight=w), cal


def fold(a):
    fitted, sha = check_frozen(a.models, a.manifest)
    keep, scales = fitted["keep"], fitted["scales"][DAY]
    coords = fitted["coords"]
    files = case_files(a.conus)
    cases = sorted(files)
    if len(cases) < MIN_DATES:
        raise ValueError(f"Expected at least {MIN_DATES} development dates, found {len(cases)}")
    cohort = {c for c in calendar_cases(json.loads(Path(a.cohort).read_text())) if c.startswith(("2022", "2023"))}
    if not cohort <= set(cases) or len(cohort) != 96:
        raise ValueError("All 96 cohort development dates must be present")
    with np.load(files[cases[0]][0], allow_pickle=False) as d:
        names = d["feature_names"].tolist()
    reg = region_index(None, regions(coords), keep)
    test_cases = [c for c in cases if S.fold_of(c) == a.fold]
    train_cases = [c for c in cases if S.fold_of(c) != a.fold]
    xs, ys, ws, gs, arm_b = [], [], [], [], []
    for c in train_cases:
        x, y, _ = load_case(*files[c], keep, scales, names, coords)
        rng = np.random.default_rng(int(c.replace("-", "")))
        m = (y > 0) | (rng.random(len(y)) < NEG_KEEP)
        xs.append(x[m]); ys.append(y[m]); ws.append(np.where(y[m] > 0, 1.0, 1.0 / NEG_KEEP))
        gs.append(np.full(m.sum(), S.fold_of(c) % 3)); arm_b.append(np.full(m.sum(), c in cohort))
    x, y, w, g, b = (np.concatenate(v) for v in (xs, ys, ws, gs, arm_b))
    del xs
    print(f"fold {a.fold}: {len(train_cases)} training dates, {len(y)} sampled rows ({int(y.sum())} events); "
          f"cohort arm {int(b.sum())} rows", flush=True)
    models = {"all": fit(x, y, w, g)}
    print(f"fold {a.fold}: arm all fitted", flush=True)
    models["cohort96"] = fit(x[b], y[b], w[b], g[b])
    print(f"fold {a.fold}: arm cohort96 fitted", flush=True)
    del x
    sums = {k: [] for k in models}
    for c in test_cases:
        xt, yt, pts = load_case(*files[c], keep, scales, names, coords)
        rt = reg[pts]
        for k, (tree, cal) in models.items():
            p = expit(cal[0] + cal[1] * tree.decision_function(xt))
            for r in range(len(REGIONS)):
                m = rt == r
                sums[k].append([c, r, int(m.sum()), float(yt[m].sum()), float(((p[m] - yt[m]) ** 2).sum()), float(p[m].sum())])
    out = {"fold": a.fold, "frozen_models_sha256": sha, "train_dates": len(train_cases),
           "cohort_train_dates": len([c for c in train_cases if c in cohort]), "test_dates": test_cases,
           "sampled_rows": int(len(y)), "neg_keep": NEG_KEEP, "regions": list(REGIONS), "sums": sums}
    a.output.mkdir(parents=True, exist_ok=True)
    (a.output / f"fold-{a.fold}.json").write_text(json.dumps(out) + "\n")


def combine(a):
    parts = [json.loads(f.read_text()) for f in sorted(a.input.glob("fold-*.json"))]
    if sorted(p["fold"] for p in parts) != list(range(S.FOLDS)):
        raise ValueError("Need all 6 folds")
    arms = ("all", "cohort96")
    rows = {k: [] for k in arms}
    for p in parts:
        for k in arms:
            rows[k] += p["sums"][k]
    dates = sorted({r[0] for r in rows["all"]})
    di = {d: i for i, d in enumerate(dates)}
    A = {k: np.zeros((len(dates), len(REGIONS), 4)) for k in arms}  # n, events, sse, sum p
    for k in arms:
        for c, r, n, sy, sse, sp in rows[k]:
            A[k][di[c], r] = (n, sy, sse, sp)
    n_all, y_all = A["all"][..., 0].sum(), A["all"][..., 1].sum()
    clim = y_all / n_all

    def bss(v):
        n, sy, sse = v[..., 0].sum(), v[..., 1].sum(), v[..., 2].sum()
        return 1 - sse / (sy - 2 * clim * sy + n * clim * clim)

    rng = np.random.default_rng(20261124)
    idx = [rng.integers(0, len(dates), len(dates)) for _ in range(2000)]

    def diff_ci(sl):
        da = A["all"][:, sl, 2].reshape(len(dates), -1).sum(1)
        db = A["cohort96"][:, sl, 2].reshape(len(dates), -1).sum(1)
        n = A["all"][:, sl, 0].reshape(len(dates), -1).sum(1)
        point = (da.sum() - db.sum()) / n.sum()
        bs = [(da[i].sum() - db[i].sum()) / n[i].sum() for i in idx]
        return float(point), [float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))]

    res = {"dates": len(dates), "development_climatology": float(clim), "neg_keep": parts[0]["neg_keep"],
           "bss": {k: {"national": float(bss(A[k]))} | {REGIONS[r]: float(bss(A[k][:, r])) for r in range(len(REGIONS))} for k in arms},
           "brier_all_minus_cohort96": {"national": diff_ci(slice(None))} | {REGIONS[r]: diff_ci(slice(r, r + 1)) for r in range(len(REGIONS))}}
    mean_fc = A["all"][..., 3].sum() / n_all
    res["calibration_all"] = {"mean_forecast": float(mean_fc), "observed": float(clim), "ratio": float(mean_fc / clim)}
    c1 = res["brier_all_minus_cohort96"]["national"][1][1] < 0
    c2 = not any(res["brier_all_minus_cohort96"][r][1][0] > 0 for r in REGIONS)
    c3 = abs(mean_fc / clim - 1) <= 0.15
    res["criteria"] = {"1_national_better": bool(c1), "2_no_region_worse": bool(c2), "3_calibrated": bool(c3)}
    res["pass"] = bool(c1 and c2 and c3)
    res["rule"] = "research/severe/conus-v1/fulldev-gate-rule.md"
    res["protected_2025_outcomes_accessed"] = False
    res["verification_2021_loaded"] = False
    a.output.mkdir(parents=True, exist_ok=True)
    (a.output / "gate.json").write_text(json.dumps(res, indent=1) + "\n")
    L = [f"# Larger training set gate: {'PASS' if res['pass'] else 'FAIL'}", "",
         f"{len(dates)} held-out 2022-23 dates (6 month-grouped folds); BSS vs development climatology {clim:.5f}.", "",
         "| Arm | National | " + " | ".join(REGIONS) + " |", "|---|---|" + "---|" * len(REGIONS)]
    for k in arms:
        L.append(f"| {k} | {res['bss'][k]['national']:.3f} | " + " | ".join(f"{res['bss'][k][r]:.3f}" for r in REGIONS) + " |")
    L += ["", "Brier (all − cohort96), 95% whole-date interval:", ""]
    for k, (pt, ci) in res["brier_all_minus_cohort96"].items():
        L.append(f"- {k}: {pt:+.6f} ({ci[0]:+.6f} to {ci[1]:+.6f})")
    L += ["", f"Calibration (all): mean forecast {mean_fc:.5f} vs observed {clim:.5f} (ratio {mean_fc / clim:.3f})", "",
          f"Criteria: {res['criteria']}"]
    (a.output / "gate.md").write_text("\n".join(L) + "\n")
    print("\n".join(L))


def freeze(a):
    """Fit the 728-date candidate once on every development date and write it with its hash.
    Run before any 2021 data exists in the repository or artifacts."""
    import hashlib as H
    import pickle
    fitted, sha = check_frozen(a.models, a.manifest)
    keep, scales, coords = fitted["keep"], fitted["scales"][DAY], fitted["coords"]
    files = case_files(a.conus)
    cases = sorted(files)
    if len(cases) < MIN_DATES:
        raise ValueError(f"Expected at least {MIN_DATES} development dates, found {len(cases)}")
    with np.load(files[cases[0]][0], allow_pickle=False) as d:
        names = d["feature_names"].tolist()
    xs, ys, ws, gs = [], [], [], []
    for c in cases:
        x, y, _ = load_case(*files[c], keep, scales, names, coords)
        rng = np.random.default_rng(int(c.replace("-", "")))
        m = (y > 0) | (rng.random(len(y)) < NEG_KEEP)
        xs.append(x[m]); ys.append(y[m]); ws.append(np.where(y[m] > 0, 1.0, 1.0 / NEG_KEEP)); gs.append(np.full(m.sum(), S.fold_of(c) % 3))
    x, y, w, g = (np.concatenate(v) for v in (xs, ys, ws, gs))
    tree, cal = fit(x, y, w, g)
    obj = {"product": "day2_wind", "arm": "conus_gbt_fulldev", "tree": tree, "calibration": [float(cal[0]), float(cal[1])],
           "names": names, "scales_day2": scales, "keep": keep, "coords": coords, "train_dates": cases,
           "neg_keep": NEG_KEEP, "recipe_from_frozen_sha256": sha, "rule": "research/severe/conus-v1/fulldev-gate-rule.md"}
    a.output.mkdir(parents=True, exist_ok=True)
    raw = pickle.dumps(obj)
    (a.output / "model.pkl").write_bytes(raw)
    man = {"status": "frozen", "sha256": H.sha256(raw).hexdigest(), "train_dates": len(cases), "sampled_rows": int(len(y)),
           "events": int(y.sum()), "calibration": obj["calibration"], "verification_2021_loaded": False,
           "protected_2025_outcomes_accessed": False}
    (a.output / "manifest.json").write_text(json.dumps(man, indent=1) + "\n")
    print(json.dumps(man))


def verify(a):
    """One-time scoring of the frozen 728-date candidate on the sealed 2021 dates, against the frozen
    96-date conus_gbt and (inside the original box) v0.7. Pass rule: verify2021-rule.md."""
    import pickle
    from conus_followup import predict
    fitted, sha96 = check_frozen(a.models, a.manifest)
    raw = a.fulldev_model.read_bytes()
    man = json.loads(a.fulldev_manifest.read_text())
    if hashlib.sha256(raw).hexdigest() != man["sha256"]:
        raise ValueError("728-date model does not match its committed hash")
    big = pickle.loads(raw)
    baseline = json.loads(a.baseline.read_text())
    sealed = sorted(json.loads(a.request.read_text())["cases"])
    files = case_files(a.conus, years=("2021",))
    cases = sorted(files)
    missing = sorted(set(sealed) - set(cases))
    if set(cases) - set(sealed):
        raise ValueError("Only the sealed 2021 list may be scored")
    keep, coords = fitted["keep"], fitted["coords"]
    names = big["names"]
    reg = region_index(None, regions(coords), keep)
    box = REGIONS.index("original_box")
    models = ("fulldev", "conus_gbt_96", "v07_frozen")
    acc = {m: np.zeros((len(cases), len(REGIONS), 4)) for m in models}
    for i, c in enumerate(cases):
        path, sha = files[c]
        if digest(path) != sha:
            raise ValueError(f"{c}: artifact hash mismatch")
        with np.load(path, allow_pickle=False) as d:
            if d["feature_names"].tolist() != names or not np.array_equal(d["coordinates"], coords):
                raise ValueError(f"{c}: grid or predictors differ")
            xr = d["features"][DAY - 1][keep]
            yk = d["labels"][DAY - 1][keep][:, HAZ]
        known = yk != 255
        pr = predict(fitted, baseline, xr[None], DAY, "day2_wind")
        e, _ = S.engineer(xr, names, big["scales_day2"])
        pf = expit(big["calibration"][0] + big["calibration"][1] * big["tree"].decision_function(e.astype(np.float64)))
        P = {"fulldev": pf, "conus_gbt_96": pr["conus_gbt"][0], "v07_frozen": pr["v07_frozen"][0]}
        y = yk.astype(float)
        for m in models:
            p = np.clip(P[m], 1e-6, 1 - 1e-6)
            for r in range(len(REGIONS)):
                k = known & (reg == r)
                acc[m][i, r] = (k.sum(), y[k].sum(), ((p[k] - y[k]) ** 2).sum(), p[k].sum())
    clim = a.climatology

    def bss(v):
        n, sy, sse = v[..., 0].sum(), v[..., 1].sum(), v[..., 2].sum()
        return float(1 - sse / (sy - 2 * clim * sy + n * clim * clim))

    rng = np.random.default_rng(20261124)
    idx = [rng.integers(0, len(cases), len(cases)) for _ in range(5000)]

    def diff(m1, m2, sl):
        a1 = acc[m1][:, sl, 2].reshape(len(cases), -1).sum(1)
        a2 = acc[m2][:, sl, 2].reshape(len(cases), -1).sum(1)
        n = acc[m1][:, sl, 0].reshape(len(cases), -1).sum(1)
        bs = [(a1[j].sum() - a2[j].sum()) / n[j].sum() for j in idx]
        return [float((a1.sum() - a2.sum()) / n.sum()), float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))]

    res = {"dates": cases, "missing": missing, "climatology_reference": clim,
           "bss": {m: {"national": bss(acc[m])} | {REGIONS[r]: bss(acc[m][:, r]) for r in range(len(REGIONS))} for m in models},
           "brier_fulldev_minus_96": {"national": diff("fulldev", "conus_gbt_96", slice(None))}
           | {REGIONS[r]: diff("fulldev", "conus_gbt_96", slice(r, r + 1)) for r in range(len(REGIONS))},
           "brier_fulldev_minus_v07_original_box": diff("fulldev", "v07_frozen", slice(box, box + 1)),
           "event_dates_by_region": {REGIONS[r]: int((acc["fulldev"][:, r, 1] > 0).sum()) for r in range(len(REGIONS))},
           "calibration_fulldev": float(acc["fulldev"][..., 3].sum() / acc["fulldev"][..., 0].sum()),
           "observed_rate": float(acc["fulldev"][..., 1].sum() / acc["fulldev"][..., 0].sum()),
           "fulldev_sha256": man["sha256"], "frozen_96_sha256": sha96, "protected_2025_outcomes_accessed": False}
    c1 = res["brier_fulldev_minus_96"]["national"][2] < 0
    c2 = not any(res["brier_fulldev_minus_96"][r][1] > 0 for r in REGIONS)
    c3 = abs(res["calibration_fulldev"] / res["observed_rate"] - 1) <= 0.25
    c4 = not missing or len(cases) >= 90
    res["criteria"] = {"1_beats_96_nationally": bool(c1), "2_no_region_worse": bool(c2), "3_calibrated_25pct": bool(c3), "4_dates_ge_90": bool(c4)}
    res["pass"] = bool(c1 and c2 and c3 and c4)
    a.output.mkdir(parents=True, exist_ok=True)
    (a.output / "verification.json").write_text(json.dumps(res, indent=1) + "\n")
    L = [f"# 2021 verification of the 728-date Day 2 wind candidate: {'PASS' if res['pass'] else 'FAIL'}", "",
         f"{len(cases)} sealed 2021 dates scored once (missing: {missing or 'none'}); BSS vs the 2022-23 development climatology {clim:.5f}.", "",
         "| Model | National | " + " | ".join(REGIONS) + " |", "|---|---|" + "---|" * len(REGIONS)]
    for m in models:
        L.append(f"| {m} | {res['bss'][m]['national']:.3f} | " + " | ".join(f"{res['bss'][m][r]:.3f}" for r in REGIONS) + " |")
    L += ["", "v07_frozen is a regional model: only its original_box column is a fair comparison.", "",
          "Brier (728-date − 96-date), 95% whole-date interval:", ""]
    L += [f"- {k}: {v[0]:+.6f} ({v[1]:+.6f} to {v[2]:+.6f})" for k, v in res["brier_fulldev_minus_96"].items()]
    v = res["brier_fulldev_minus_v07_original_box"]
    L += ["", f"Original box, 728-date − v0.7: {v[0]:+.6f} ({v[1]:+.6f} to {v[2]:+.6f})",
          f"Event dates by region: {res['event_dates_by_region']}",
          f"Calibration: mean forecast {res['calibration_fulldev']:.5f} vs observed {res['observed_rate']:.5f}", "",
          f"Criteria: {res['criteria']}"]
    (a.output / "verification.md").write_text("\n".join(L) + "\n")
    print("\n".join(L))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fold")
    f.add_argument("--fold", type=int, required=True)
    f.add_argument("--conus", type=Path, required=True)
    f.add_argument("--output", type=Path, required=True)
    f.add_argument("--cohort", type=Path, default=Path("research/severe/cohort-v07.json"))
    f.add_argument("--models", type=Path, default=Path("research/severe/conus-v1/frozen/models.pkl"))
    f.add_argument("--manifest", type=Path, default=Path("research/severe/conus-v1/frozen/manifest.json"))
    c = sub.add_parser("combine")
    c.add_argument("--input", type=Path, required=True)
    c.add_argument("--output", type=Path, required=True)
    z = sub.add_parser("freeze")
    z.add_argument("--conus", type=Path, required=True)
    z.add_argument("--output", type=Path, required=True)
    v = sub.add_parser("verify")
    v.add_argument("--conus", type=Path, required=True)
    v.add_argument("--output", type=Path, required=True)
    v.add_argument("--fulldev-model", type=Path, default=Path("research/severe/conus-v1/fulldev-frozen/model.pkl"))
    v.add_argument("--fulldev-manifest", type=Path, default=Path("research/severe/conus-v1/fulldev-frozen/manifest.json"))
    v.add_argument("--request", type=Path, default=Path("research/severe/conus-v1/twostage-verification-2021.json"))
    v.add_argument("--baseline", type=Path, default=Path("research/severe/baseline-v07/models.json"))
    v.add_argument("--climatology", type=float, default=0.01084)
    for q in (z, v):
        q.add_argument("--models", type=Path, default=Path("research/severe/conus-v1/frozen/models.pkl"))
        q.add_argument("--manifest", type=Path, default=Path("research/severe/conus-v1/frozen/manifest.json"))
    a = p.parse_args()
    {"fold": fold, "combine": combine, "freeze": freeze, "verify": verify}[a.cmd](a)


if __name__ == "__main__":
    main()
