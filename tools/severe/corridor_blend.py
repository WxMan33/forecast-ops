#!/usr/bin/env python3
"""Corridor follow-up: v2 no-signal breakdown, then one blended candidate (rules:
research/severe/corridor/blend/rules.json, committed before the blend stage runs).

  regen   re-run the locked v2 nested fit exactly (same code, roster, folds), verify it reproduces the
          committed v2 scorecard and fits, save held-out and inner out-of-fold logits for arms b and c,
          and break down v2's no-signal failure. No blend is fitted here.
  blend   from the saved logits only: per outer fold choose the blend weight on the inner training
          folds, fit beta calibration and a threshold inside the training months, score the held-out
          months against the five locked criteria, and refit the all-roster blend for the 2024 diagnostic.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from scipy.special import expit

import corridor as C
import corridor_v2 as V
import nadocast_benchmark as B
import nadocast_diagnose as D
import phase2_study as S
from conus_followup import SAMPLE_KM2
from extract import digest

V2_GATE = Path("research/severe/corridor/v2/gate/gate-v2.json")
V2_FITS = Path("research/severe/corridor/v2/gate/fits-roster.json")
RULES = Path("research/severe/corridor/blend/rules.json")
WEIGHTS = (0.0, 0.25, 0.5, 0.75, 1.0)
SEED = 20261124


# ---------------------------------------------------------------- shared helpers
def classes(xyz, y, d, flag, nd):
    counts, lab, _ = D.miss_classes(xyz, y, d, flag, nd)
    flagged = np.bincount(d[flag], minlength=nd)
    return counts, lab, flagged


def no_signal_days(counts):
    return int((counts["no_signal"] > 0).sum())


# ---------------------------------------------------------------- regen
def regen(a):
    roster = json.loads(V.ROSTER.read_text())
    dates = [r["date"] for r in roster["dates"]]
    cases, xb, xw, y, d, pt, xy, names, info = V.roster_rows(a.conus, dates)
    xc = np.hstack([xb, xw])
    fold = np.array([S.fold_of(c) for c in cases])[d]
    nd = len(cases)
    n = len(y)
    P = {k: np.full(n, np.nan) for k in ("a", "b", "c")}
    Z = {k: np.full(n, np.nan) for k in ("b", "c")}
    inner = {}
    for k in range(S.FOLDS):
        te, tr = fold == k, fold != k
        if not te.any():
            continue
        ab = C.Arm("platt").fit(xb[tr], y[tr], fold[tr])
        bb = C.recalibrated(ab, y[tr], cal="beta")
        cc = C.Arm("beta").fit(xc[tr], y[tr], fold[tr])
        P["a"][te], P["b"][te], P["c"][te] = ab.predict(xb[te]), bb.predict(xb[te]), cc.predict(xc[te])
        Z["b"][te] = bb.w[0] + bb.z(xb[te]) @ bb.w[1:]
        Z["c"][te] = cc.w[0] + cc.z(xc[te]) @ cc.w[1:]
        inner[f"inner_zb_{k}"] = ab.oof_raw.astype(np.float32)
        inner[f"inner_zc_{k}"] = cc.oof_raw.astype(np.float32)
        print(f"regen fold {k}", flush=True)
    allg = fold
    fa = C.Arm("platt").fit(xb, y, allg)
    fb = C.recalibrated(fa, y, cal="beta")
    fc = C.Arm("beta").fit(xc, y, allg)
    fits = {"a": fa.to_dict(), "b": fb.to_dict(), "c": fc.to_dict(), "base_features": names, "wider_features": C.wide_names(),
            "fit_dates": cases, "rules_sha256": digest(V.RULES), "roster_sha256": digest(V.ROSTER)}
    blob = json.dumps(fits).encode()
    # ---- reproduction check against the committed v2 results
    rng = np.random.default_rng(SEED)
    xyz = B.unit(xy[pt, 0], xy[pt, 1])
    regen_cmp = C.compare(P, y, d, xyz, nd, rng)
    committed = json.loads(V2_GATE.read_text())
    keys = []
    for arm in ("a", "b", "c"):
        for c_ in ("hit", "left_out", "wrong_place", "no_signal"):
            keys.append((arm, c_, regen_cmp["matched_false_alarm_area"]["by_arm"][arm][c_],
                         committed["matched_false_alarm_area"]["by_arm"][arm][c_]))
    brier = [(arm, regen_cmp["arms"][arm]["brier"], committed["arms"][arm]["brier"]) for arm in ("a", "b", "c")]
    repro = {"matched_area_counts_equal": all(x == y_ for *_, x, y_ in keys),
             "brier_max_abs_diff": max(abs(x - y_) for _, x, y_ in brier),
             "fits_sha256_regenerated": hashlib.sha256(blob).hexdigest(), "fits_sha256_committed": digest(V2_FITS)}
    repro["fits_equal"] = repro["fits_sha256_regenerated"] == repro["fits_sha256_committed"]
    repro["reproduces"] = bool(repro["matched_area_counts_equal"] and repro["brier_max_abs_diff"] < 1e-9)
    # ---- no-signal breakdown at the v2 matched area
    t_c = regen_cmp["matched_false_alarm_area"]["by_arm"]["c"]["threshold"]
    flag_b, flag_c = P["b"] >= 0.05, P["c"] > t_c
    cb, _, fb_n = classes(xyz, y, d, flag_b, nd)
    cc_, _, fc_n = classes(xyz, y, d, flag_c, nd)
    rep = np.bincount(d[y == 1], minlength=nd)
    inc = cc_["no_signal"] - cb["no_signal"]
    days = []
    for j in np.where((cc_["no_signal"] > 0) | (cb["no_signal"] > 0))[0]:
        s = d == j
        mx = float(P["c"][s].max())
        mx_rep = float(P["c"][s & (y == 1)].max()) if (s & (y == 1)).any() else None
        if cc_["no_signal"][j] == 0:
            kind = None
        elif fc_n[j] > 0:
            kind = "flagged_1_to_9_samples"       # some area, under the 2,250 km2 minimum
        elif mx >= 0.75 * t_c:
            kind = "narrow_miss"                   # nothing flagged, but max within 25% of the threshold
        else:
            kind = "low_across_board"              # max below 75% of the threshold
        days.append({"date": cases[j], "report_points": int(rep[j]), "no_signal_b": int(cb["no_signal"][j]),
                     "no_signal_c": int(cc_["no_signal"][j]), "increase": int(inc[j]),
                     "flagged_samples_b": int(fb_n[j]), "flagged_samples_c": int(fc_n[j]),
                     "max_p_c": mx, "max_p_c_at_reports": mx_rep, "max_p_c_over_threshold": mx / t_c,
                     "max_p_b": float(P["b"][s].max()), "c_kind": kind})
    days.sort(key=lambda t: -t["increase"])
    total_inc = int(inc.sum())
    top5 = days[:5]
    kinds = ("flagged_1_to_9_samples", "narrow_miss", "low_across_board")
    breakdown = {
        "matched_area_threshold_c": t_c, "threshold_b": 0.05, "min_flagged_samples": D.MIN_FLAG,
        "no_signal_points": {"b": int(cb["no_signal"].sum()), "c": int(cc_["no_signal"].sum()), "increase": total_inc},
        "no_signal_days": {"b": no_signal_days(cb), "c": no_signal_days(cc_),
                           "c_only": int(((cc_["no_signal"] > 0) & (cb["no_signal"] == 0)).sum()),
                           "b_only": int(((cb["no_signal"] > 0) & (cc_["no_signal"] == 0)).sum())},
        "top5_contributors": top5,
        "top5_share_of_increase": float(sum(t["increase"] for t in top5) / total_inc) if total_inc else None,
        "c_no_signal_by_kind": {k: {"days": sum(1 for t in days if t["c_kind"] == k),
                                    "points": sum(t["no_signal_c"] for t in days if t["c_kind"] == k)} for k in kinds},
        "all_days": days}
    a.output.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(a.output / "regen-arrays.npz", y=y.astype(np.float32), d=d, pt=pt, xy=xy, fold=fold, dates=np.array(cases),
                        **{f"p_{k}": v.astype(np.float32) for k, v in P.items()}, zb=Z["b"], zc=Z["c"],
                        all_zb=fa.oof_raw.astype(np.float32), all_zc=fc.oof_raw.astype(np.float32), **inner)
    (a.output / "fits-roster-regen.json").write_bytes(blob)
    out = {"stage": "regen", "reproduction": repro, "no_signal_breakdown": breakdown,
           "protected_2025_outcomes_accessed": False, "verification_2021_loaded": False}
    (a.output / "breakdown.json").write_text(json.dumps(out, indent=1, default=float) + "\n")
    print(json.dumps({"reproduction": repro, "increase": total_inc, "top5_share": breakdown["top5_share_of_increase"],
                      "kinds": breakdown["c_no_signal_by_kind"], "days": breakdown["no_signal_days"]}, default=float))
    if not repro["reproduces"]:
        raise SystemExit("regenerated predictions do not reproduce the committed v2 scorecard")


# ---------------------------------------------------------------- blend
def logit(p):
    p = np.clip(p, 1e-9, 1 - 1e-9)
    return np.log(p / (1 - p))


def beta_apply(c, z):
    return expit(c[0] + C.beta_design(z) @ c[1:])


def crossfit_beta(z, y, g):
    """Beta calibration fitted on the other inner groups, applied to each held group."""
    out = np.empty(len(y))
    for h in np.unique(g):
        m = g == h
        out[m] = beta_apply(C.fit_beta(z[~m], y[~m]), z[m])
    return out


def inner_eval(zb, zc, y, d, g, xyz, nd_dates):
    """Inner training folds only: cross-fitted beta-calibrated probabilities for arms b and c, the
    probability blend (1-w) p_b + w p_c for each weight, cross-fitted beta recalibration of the blend,
    and inner matched-area metrics against arm b's 5% area."""
    qb, qc = crossfit_beta(zb, y, g), crossfit_beta(zc, y, g)
    q = {w: (qb if w == 0 else crossfit_beta(logit((1 - w) * qb + w * qc), y, g)) for w in WEIGHTS}
    fa = int(((y == 0) & (qb >= 0.05)).sum())
    res = {}
    for w, p in q.items():
        f = (p >= 0.05) if w == 0 else (p > D.thresholds_for_count(p[y == 0], fa))
        cl = D.miss_classes(xyz, y, d, f, nd_dates)[0]
        res[w] = {"hits": int(cl["hit"].sum()), "no_signal": int(cl["no_signal"].sum()),
                  "wrong_place": int(cl["wrong_place"].sum()), "left_out": int(cl["left_out"].sum()),
                  "brier": float(np.mean((p - y) ** 2))}
    return res, qb, qc


def select_weight(res):
    """Locked rule: eligible if no_signal, wrong_place <= 1.05x and Brier <= weight 0 (arm b); choose the
    eligible weight with the most matched-area hits (ties: smaller weight); if none, the smallest
    no-signal ratio (ties: more hits)."""
    b = res[0.0]
    elig = [w for w in WEIGHTS if res[w]["no_signal"] <= 1.05 * max(b["no_signal"], 1)
            and res[w]["wrong_place"] <= 1.05 * max(b["wrong_place"], 1) and res[w]["brier"] <= b["brier"]]
    if elig:
        return max(elig, key=lambda w: (res[w]["hits"], -w))
    return min(WEIGHTS, key=lambda w: (res[w]["no_signal"] / max(b["no_signal"], 1), -res[w]["hits"]))


def blend(a):
    rules = json.loads(RULES.read_text())
    arr = np.load(a.arrays, allow_pickle=False)
    y, d, pt, xy, fold = arr["y"].astype(float), arr["d"], arr["pt"], arr["xy"], arr["fold"]
    cases = [str(x) for x in arr["dates"]]
    nd = len(cases)
    P = {k: arr[f"p_{k}"].astype(float) for k in ("a", "b", "c")}
    zb, zc = arr["zb"].astype(float), arr["zc"].astype(float)
    xyz = B.unit(xy[pt, 0], xy[pt, 1])
    pbl = np.full(len(y), np.nan)
    flag_bl = np.zeros(len(y), bool)
    per_fold = []
    for k in range(S.FOLDS):
        te, tr = fold == k, fold != k
        if not te.any():
            continue
        izb, izc = arr[f"inner_zb_{k}"].astype(float), arr[f"inner_zc_{k}"].astype(float)
        ytr, dtr, gtr = y[tr], np.unique(d[tr], return_inverse=True)[1], fold[tr]
        res, qb, qc = inner_eval(izb, izc, ytr, dtr, gtr, xyz[tr], int(dtr.max()) + 1)
        w = select_weight(res)
        if w == 0:   # the blend is arm b itself
            cal, t_k = None, 0.05
            pbl[te] = P["b"][te]
            flag_bl[te] = pbl[te] >= 0.05
        else:
            cal = C.fit_beta(logit((1 - w) * qb + w * qc), ytr)
            pin = beta_apply(cal, logit((1 - w) * qb + w * qc))
            fa_in = int(((ytr == 0) & (qb >= 0.05)).sum())
            t_k = D.thresholds_for_count(pin[ytr == 0], fa_in)
            pbl[te] = beta_apply(cal, logit((1 - w) * P["b"][te] + w * P["c"][te]))
            flag_bl[te] = pbl[te] > t_k
        per_fold.append({"fold": k, "weight": w, "threshold": t_k, "beta": None if cal is None else cal.tolist(),
                         "inner": {str(kk): v for kk, v in res.items()}})
        print(f"blend fold {k}: weight {w}, threshold {t_k:.4f}", flush=True)
    rng = np.random.default_rng(SEED)
    D.DRAWS = 5000
    n_by = np.bincount(d, minlength=nd).astype(float)
    se = {k: np.bincount(d, weights=(p - y) ** 2, minlength=nd) for k, p in {**P, "blend": pbl}.items()}
    flag_b = P["b"] >= 0.05
    t_c = D.thresholds_for_count(P["c"][y == 0], int(((y == 0) & flag_b).sum()))
    flags = {"b": flag_b, "c": P["c"] > t_c, "blend": flag_bl}
    cls = {k: classes(xyz, y, d, f, nd) for k, f in flags.items()}
    fa_area = {k: float(((y == 0) & f).sum() * SAMPLE_KM2 / nd) for k, f in flags.items()}
    area_ok = fa_area["blend"] <= 1.05 * fa_area["b"]
    cb, cbl = cls["b"][0], cls["blend"][0]
    hits_ratio = float(cbl["hit"].sum() / cb["hit"].sum())
    lo_red = float(1 - cbl["left_out"].sum() / cb["left_out"].sum())
    rel = C.reliability(pbl, y)
    crit = {
        "matched_area": {"blend_false_alarm_km2_per_day": fa_area["blend"], "b_false_alarm_km2_per_day": fa_area["b"],
                         "within_5pct": bool(area_ok), "need": "blend area <= 1.05 x arm b area, else criteria 1, 2 and 4 fail"},
        "1_matched_area_hits": {"blend": int(cbl["hit"].sum()), "b": int(cb["hit"].sum()), "ratio": hits_ratio,
                                "blend_minus_b_95": D.boot(cbl["hit"], cb["hit"], rng)},
        "2_left_out": {"blend": int(cbl["left_out"].sum()), "b": int(cb["left_out"].sum()), "reduction": lo_red,
                       "b_minus_blend_95": D.boot(cb["left_out"], cbl["left_out"], rng)},
        "3_brier": {"blend": float(se["blend"].sum() / n_by.sum()), "b": float(se["b"].sum() / n_by.sum()),
                    "blend_minus_b_95": B.boot_diff(se["blend"], se["b"], n_by, rng)},
        "4_no_regression": {k: {"blend": int(cbl[k].sum()), "b": int(cb[k].sum()), "ratio": float(cbl[k].sum() / max(cb[k].sum(), 1))}
                            for k in ("wrong_place", "no_signal")},
        "5_reliability": rel}
    passed = {"1_matched_area_hits": area_ok and hits_ratio >= 1.10 and crit["1_matched_area_hits"]["blend_minus_b_95"][0] > 0,
              "2_left_out": area_ok and lo_red >= 0.25 and crit["2_left_out"]["b_minus_blend_95"][0] > 0,
              "3_brier": crit["3_brier"]["blend_minus_b_95"][1] < 0,
              "4_no_regression": area_ok and all(v["ratio"] <= 1.05 for v in crit["4_no_regression"].values()),
              "5_reliability": all(r["within_30pct"] is not False for r in rel)}
    # comparison with both original arms, per day and per point
    vs = {}
    for k in ("b", "c", "blend"):
        c0 = cls[k][0]
        vs[k] = {"hits": int(c0["hit"].sum()), "left_out": int(c0["left_out"].sum()), "wrong_place": int(c0["wrong_place"].sum()),
                 "no_signal_points": int(c0["no_signal"].sum()), "no_signal_days": no_signal_days(c0),
                 "false_alarm_km2_per_day": fa_area[k], "brier": float(se[k].sum() / n_by.sum()),
                 "bin_support": V.bin_support({"b": P["b"], "c": P["c"], "blend": pbl}[k], y, d)}
    vs["blend_minus_c_brier_95"] = B.boot_diff(se["blend"], se["c"], n_by, rng)
    vs["blend_minus_c_hits_95"] = D.boot(cbl["hit"], cls["c"][0]["hit"], rng)
    exact_t = D.thresholds_for_count(pbl[y == 0], int(((y == 0) & flag_b).sum()))
    ex = classes(xyz, y, d, pbl > exact_t, nd)[0]
    res = {"rules": str(RULES), "dates": nd, "report_points": int(y.sum()), "report_days": int(len(np.unique(d[y == 1]))),
           "per_fold": per_fold, "criteria": crit, "criteria_pass": passed, "pass": all(passed.values()),
           "failed": [k for k, v in passed.items() if not v], "comparison_with_original_arms": vs,
           "secondary_exact_pooled_match": {"threshold": exact_t, **{c_: int(ex[c_].sum()) for c_ in ex}},
           "protected_2025_outcomes_accessed": False, "verification_2021_loaded": False}
    # all-roster blend for the 2024 diagnostic (and freezing if it passed)
    g = fold
    allres, qb_all, qc_all = inner_eval(arr["all_zb"].astype(float), arr["all_zc"].astype(float), y, d, g, xyz, nd)
    w_all = select_weight(allres)
    cal_all = C.fit_beta(logit((1 - w_all) * qb_all + w_all * qc_all), y) if w_all else np.array([0.0, 1.0, 0.0])
    fits = json.loads(Path(a.fits).read_text())
    fits["blend"] = {"weight": w_all, "beta": cal_all.tolist(), "space": "probability blend of calibrated b and c, then beta",
                     "inner": {str(k): v for k, v in allres.items()}}
    a.output.mkdir(parents=True, exist_ok=True)
    blob = json.dumps(fits).encode()
    (a.output / "fits-blend.json").write_bytes(blob)
    res["fits_blend_sha256"] = hashlib.sha256(blob).hexdigest()
    res["frozen_candidate"] = bool(res["pass"])
    maps(a.output, cases, xy, y, d, pt, {**P, "blend": pbl}, flags, cls, a.breakdown, res)
    (a.output / "blend.json").write_text(json.dumps(res, indent=1, default=float) + "\n")
    print(json.dumps({"pass": res["pass"], "failed": res["failed"], "weights": [f["weight"] for f in per_fold]}, default=float))


def maps(out, cases, xy, y, d, pt, P, flags, cls, breakdown_path, res):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from phase2_maps import states
    rings = states()
    bd = json.loads(Path(breakdown_path).read_text())["no_signal_breakdown"]
    picks = {}
    if bd["top5_contributors"]:
        picks["largest_v2_no_signal_increase"] = bd["top5_contributors"][0]["date"]
    picks["v2_gap_filled"] = "2023-03-31"
    res["map_cases"] = picks
    titles = {"b": "Arm b: recalibration only", "c": "Arm c: corridor v2", "blend": "Blend (weight chosen in training folds)"}
    for kind, day in picks.items():
        if day not in cases:
            continue
        j = cases.index(day)
        s = d == j
        fig, axes = plt.subplots(1, 3, figsize=(21, 6))
        for ax, k in zip(axes, ("b", "c", "blend")):
            colors = C.flag_panels(ax, xy[pt[s]], P[k][s], flags[k][s], cls[k][1][s], titles[k] + " (held-out month)", rings)
        C.save_fig(fig, colors, out / f"blend-{kind}-{day}.png",
                   f"Day 1 tornado, development day {day} ({kind.replace('_', ' ')}); held-out predictions on the 362-date roster; "
                   "b at 5%, c and blend at the arm-b false-alarm area. Research only.")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("regen")
    r.add_argument("--conus", type=Path, nargs="+", required=True)
    r.add_argument("--output", type=Path, required=True)
    b = sub.add_parser("blend")
    b.add_argument("--arrays", type=Path, required=True)
    b.add_argument("--breakdown", type=Path, required=True)
    b.add_argument("--fits", type=Path, required=True)
    b.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    {"regen": regen, "blend": blend}[a.cmd](a)


if __name__ == "__main__":
    main()
