#!/usr/bin/env python3
"""Day 1 tornado corridor experiment v2 (rules: research/severe/corridor/v2/rules.json).

Same arms, features, nesting and pass criteria as v1, on the locked 362-date roster, with beta
calibration for arms b and c. Adds: matched-area results before and after calibration, the original
96-date subset, event dates behind each reliability bin, and rule-chosen gap-fill / front-spread maps.

  gate      nested month-held-out test on the roster (2022-23 only)
  diag2024  all-roster fits of b and c on the 323 NadoCast benchmark days (diagnostic only)
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

import corridor as C
import nadocast_benchmark as B
import nadocast_diagnose as D
import phase2_study as S
from conus_followup import SAMPLE_KM2
from conus_study import BOX, geography
from extract import digest

RULES = Path("research/severe/corridor/v2/rules.json")
ROSTER = Path("research/severe/corridor/v2/roster.json")
SEED = 20261124


def find_case(roots, case):
    for r in roots:
        p = Path(r) / case / "conus-case.json"
        if p.exists():
            return p
    return None


def roster_rows(roots, dates):
    """Memory-light per-date loading from several extraction outputs (hash-checked)."""
    coords = names = nb = tgt = None
    xb, xw, ys, ds, pts, used, missing, hashes = [], [], [], [], [], [], [], {}
    for case in dates:
        if not case.startswith(("2022", "2023")):
            raise ValueError("development roster is 2022-23 only")
        mp = find_case(roots, case)
        if mp is None:
            missing.append(case)
            continue
        meta = json.loads(mp.read_text())
        path = mp.parent / meta["artifact"]["file"]
        if meta["case"] != case or digest(path) != meta["artifact"]["sha256"]:
            raise ValueError(f"{case}: artifact hash mismatch")
        with np.load(path, allow_pickle=False) as z:
            if coords is None:
                coords, names = z["coordinates"], z["feature_names"].tolist()
                sup, _ = geography(coords)
                lon, lat = coords[:, 0], coords[:, 1]
                tgt = np.where(sup & (lon >= BOX[0]) & (lon <= BOX[1]) & (lat >= BOX[2]) & (lat <= BOX[3]))[0]
                nb = C.neighbourhoods(coords, tgt)
            if not np.array_equal(z["coordinates"], coords) or z["feature_names"].tolist() != names:
                raise ValueError(f"{case}: grid or predictors differ")
            x0, lab = z["features"][0], z["labels"][0][tgt, 0]
        k = lab != 255
        j = len(used)
        xb.append(x0[tgt][k].astype(np.float32))
        xw.append(C.wider(x0, names, nb)[k].astype(np.float32))
        ys.append(lab[k].astype(np.float32))
        ds.append(np.full(int(k.sum()), j, np.int32))
        pts.append(np.where(k)[0].astype(np.int32))
        used.append(case)
        hashes[case] = meta["artifact"]["sha256"]
    info = {"targets": int(len(tgt)), "missing": missing, "artifact_sha256_by_case": hashes,
            "neighbourhood_sizes": {f"{int(round(r / 1.609344))}mi": {"min": int(s.min()), "median": float(np.median(s))}
                                    for r, (_, _, s) in zip(C.RADII_KM, nb)}}
    return (used, np.vstack(xb).astype(np.float64), np.vstack(xw).astype(np.float64), np.concatenate(ys).astype(float),
            np.concatenate(ds), np.concatenate(pts), coords[tgt], names, info)


def bin_support(p, y, d):
    out = []
    for lo, hi in C.REL_BINS:
        s = (p >= lo) & (p < hi)
        out.append({"bin": [lo, hi], "points": int(s.sum()), "report_points": int(y[s].sum()),
                    "event_dates": int(len(np.unique(d[s & (y == 1)]))),
                    "mean_forecast": float(p[s].mean()) if s.any() else None, "observed": float(y[s].mean()) if s.any() else None})
    return out


def matched_only(P, y, d, xyz, nd, rng, ref="b"):
    """Matched false-alarm area (ref's 5% area) hits and miss classes, for any set of score arrays."""
    D.DRAWS = 5000
    fa = int(((y == 0) & (P[ref] >= 0.05)).sum())
    out = {"reference_false_alarm_km2_per_day": fa * SAMPLE_KM2 / nd, "by_arm": {}}
    hits = {}
    for k, p in P.items():
        t = D.thresholds_for_count(p[y == 0], fa)
        f = p > t
        cl = D.miss_classes(xyz, y, d, f, nd)[0]
        hits[k] = cl
        out["by_arm"][k] = {"threshold": t, **{c: int(cl[c].sum()) for c in cl}}
    if "b" in hits and "c" in hits:
        out["c_minus_b_hits_95"] = D.boot(hits["c"]["hit"], hits["b"]["hit"], rng)
        out["b_minus_c_left_out_95"] = D.boot(hits["b"]["left_out"], hits["c"]["left_out"], rng)
        out["hit_ratio_c_over_b"] = float(hits["c"]["hit"].sum() / max(hits["b"]["hit"].sum(), 1))
    return out


def gate(a):
    rules = json.loads(RULES.read_text())
    roster = json.loads(ROSTER.read_text())
    dates = [r["date"] for r in roster["dates"]]
    orig = {r["date"] for r in roster["dates"] if r["in_original_96"]}
    cases, xb, xw, y, d, pt, xy, names, info = roster_rows(a.conus, dates)
    if info["missing"]:
        print("::warning::missing roster dates (excluded, listed): " + " ".join(info["missing"]))
    xc = np.hstack([xb, xw])
    fold = np.array([S.fold_of(c) for c in cases])[d]
    nd = len(cases)
    P = {k: np.full(len(y), np.nan) for k in ("a", "b", "c")}
    R = {k: np.full(len(y), np.nan) for k in ("b", "c")}  # before calibration
    thr_live, per_fold = [], []
    for k in range(S.FOLDS):
        te, tr = fold == k, fold != k
        if not te.any():
            continue
        ab = C.Arm("platt").fit(xb[tr], y[tr], fold[tr])
        bb = C.recalibrated(ab, y[tr], cal="beta")
        cc = C.Arm("beta").fit(xc[tr], y[tr], fold[tr])
        P["a"][te], P["b"][te], P["c"][te] = ab.predict(xb[te]), bb.predict(xb[te]), cc.predict(xc[te])
        R["b"][te], R["c"][te] = bb.raw(xb[te]), cc.raw(xc[te])
        fa_in = int(((y[tr] == 0) & (bb.oof_p >= 0.05)).sum())
        thr_live.append({"fold": k, "c_threshold_matching_b_5pct_area_in_training": D.thresholds_for_count(cc.oof_p[y[tr] == 0], fa_in)})
        per_fold.append({"fold": k, "test_dates": int(len(np.unique(d[te]))), "penalty_ab": ab.penalty, "penalty_c": cc.penalty,
                         "beta_b": np.asarray(bb.c).tolist(), "beta_c": np.asarray(cc.c).tolist()})
        print(f"outer fold {k} done", flush=True)
    rng = np.random.default_rng(SEED)
    xyz = B.unit(xy[pt, 0], xy[pt, 1])
    res = {"rules": str(RULES), "roster": str(ROSTER), "dates": nd, "points": int(len(y)), "report_points": int(y.sum()),
           "report_days": int(len(np.unique(d[y == 1]))), "data": info, "per_fold": per_fold,
           "protected_2025_outcomes_accessed": False, "verification_2021_loaded": False}
    res.update(C.compare(P, y, d, xyz, nd, rng))  # the locked criteria (c vs b)
    res["bin_support"] = {k: bin_support(P[k], y, d) for k in P}
    res["matched_area_before_calibration"] = matched_only(R, y, d, xyz, nd, rng)
    res["matched_area_after_calibration"] = matched_only({k: P[k] for k in ("b", "c")}, y, d, xyz, nd, rng)
    # original 96-date subset of the same held-out predictions (not deciding)
    sub_dates = [j for j, c in enumerate(cases) if c in orig]
    s = np.isin(d, sub_dates)
    dd = np.unique(d[s], return_inverse=True)[1]
    sub = C.compare({k: v[s] for k, v in P.items()}, y[s], dd, xyz[s], len(sub_dates), rng)
    res["original_96_subset_not_deciding"] = {"dates": len(sub_dates), "report_points": int(y[s].sum()),
                                              "report_days": int(len(np.unique(d[s & (y == 1)]))),
                                              "criteria_pass": sub["criteria_pass"], "criteria": sub["criteria"],
                                              "arms": {k: {"brier": v["brier"], "roc_auc": v["roc_auc"]} for k, v in sub["arms"].items()}}
    tm = np.empty(len(y))
    for r in thr_live:
        tm[fold == r["fold"]] = r["c_threshold_matching_b_5pct_area_in_training"]
    res["live_threshold_proposals_heldout"] = {
        "calibrated_5pct": {"hits": int(((P["c"] >= 0.05) & (y == 1)).sum()),
                            "false_alarm_km2_per_day": float(((P["c"] >= 0.05) & (y == 0)).sum() * SAMPLE_KM2 / nd)},
        "matched_area_threshold_from_training_folds": {"thresholds_by_fold": [r["c_threshold_matching_b_5pct_area_in_training"] for r in thr_live],
                                                       "hits": int(((P["c"] > tm) & (y == 1)).sum()),
                                                       "false_alarm_km2_per_day": float(((P["c"] > tm) & (y == 0)).sum() * SAMPLE_KM2 / nd)}}
    # all-roster fits (2024 diagnostic; the frozen candidate if c passed)
    allg = np.array([S.fold_of(c) for c in cases])[d]
    fa = C.Arm("platt").fit(xb, y, allg)
    fb = C.recalibrated(fa, y, cal="beta")
    fc = C.Arm("beta").fit(xc, y, allg)
    fits = {"a": fa.to_dict(), "b": fb.to_dict(), "c": fc.to_dict(), "base_features": names, "wider_features": C.wide_names(),
            "fit_dates": cases, "rules_sha256": digest(RULES), "roster_sha256": digest(ROSTER)}
    a.output.mkdir(parents=True, exist_ok=True)
    blob = json.dumps(fits).encode()
    (a.output / "fits-roster.json").write_bytes(blob)
    res["fits_roster_sha256"] = hashlib.sha256(blob).hexdigest()
    res["frozen_candidate"] = bool(res["pass"])
    maps(a.output, cases, xy, y, d, pt, P, res)
    (a.output / "gate-v2.json").write_text(json.dumps(res, indent=1, default=float) + "\n")
    print(json.dumps({"pass": res["pass"], "failed": res["failed"]}))


def maps(out, cases, xy, y, d, pt, P, res):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from phase2_maps import states
    rings = states()
    nd = len(cases)
    xyz = B.unit(xy[pt, 0], xy[pt, 1])
    mb = res["matched_false_alarm_area"]["by_arm"]
    flag = {"b": P["b"] >= 0.05, "c": P["c"] > mb["c"]["threshold"]}
    lab = {k: D.miss_classes(xyz, y, d, flag[k], nd)[1] for k in flag}
    cnt = lambda k, what: np.bincount(d[lab[k] == what], minlength=nd)
    fa = {k: np.bincount(d[(y == 0) & flag[k]], minlength=nd) for k in flag}
    hb, hc = cnt("b", "hit"), cnt("c", "hit")
    gain = cnt("b", "left_out") - cnt("c", "left_out")
    spread = fa["c"] - fa["b"]
    picks = {}
    m = hc > hb
    if m.any():
        picks["fills_gap"] = int(np.where(m)[0][np.argmax(gain[m])])
    m = hc <= hb
    if m.any() and spread[m].max() > 0:
        picks["spreads_along_front"] = int(np.where(m)[0][np.argmax(spread[m])])
    res["map_cases"] = {k: cases[j] for k, j in picks.items()}
    for kind, j in picks.items():
        s = d == j
        fig, axes = plt.subplots(1, 2, figsize=(15, 6))
        for ax, k, t in zip(axes, ("b", "c"), ("Arm b: refit + beta recalibration", "Arm c: + 50/100-mile corridor features")):
            colors = C.flag_panels(ax, xy[pt[s]], P[k][s], flag[k][s], lab[k][s], f"{t} (held-out month)", rings)
        C.save_fig(fig, colors, out / f"corridor-v2-{kind}-{cases[j]}.png",
                   f"Day 1 tornado, development day {cases[j]} ({kind.replace('_', ' ')}), held-out predictions; both arms "
                   "flagged at the same false-alarm area (arm b 5%). Research only.")


def diag2024(a):
    """Reuse v1's diagnostic with the v2 roster fits (beta-calibrated b and c)."""
    C.diag2024(a)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("gate")
    g.add_argument("--conus", type=Path, nargs="+", required=True, help="one or more extraction output roots")
    g.add_argument("--output", type=Path, required=True)
    q = sub.add_parser("diag2024")
    q.add_argument("--conus", type=Path, required=True)
    q.add_argument("--arrays", type=Path, required=True)
    q.add_argument("--fits", type=Path, required=True)
    q.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    {"gate": gate, "diag2024": diag2024}[a.cmd](a)


if __name__ == "__main__":
    main()
