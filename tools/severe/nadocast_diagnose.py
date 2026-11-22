#!/usr/bin/env python3
"""Diagnose the Day 1 tornado gap between live v0.7 and NadoCast (diagnostic, no training).

Inputs: the Day 1 benchmark's saved per-point predictions (score run 44961880902, artifact
nadocast-score) and the same CONUS extraction artifacts (for v0.7's inputs at each point). All 323
scored 2024 dates are treated as diagnostic. 2021 and 2025 are never loaded.

  1. Fixed thresholds (2%, 5%), matched false-alarm area and matched detection, with paired
     date-bootstrap intervals.
  2. Probability scale: month-held-out isotonic recalibration of both models; how much of the Brier
     gap it closes (ranking is unchanged by recalibration, so matched-area results are scale-free).
  3. Where misses come from, at matched false-alarm area: left out of a flagged corridor (within
     100 km of the model's own flagged area), wrong place (flagged elsewhere), or no signal.
  4. Outbreak days (most report points), December 28, cases where each model did better.
  5. Why: v0.7 logit contributions by input group at missed vs hit report points.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree
from scipy.special import expit

import nadocast_benchmark as B
from conus_followup import SAMPLE_KM2
from conus_study import geography

SEED = 20261123
DRAWS = 2000
NEAR_KM = 100.0
MIN_FLAG = 10  # samples (2,250 km2) of flagged area before a day counts as "flagged somewhere"
GROUPS = ("dewpoint2m", "reflectivity", "sbcape", "sbcin", "shear06", "srh01", "uh25")


def thresholds_for_count(p, n):
    """Strict threshold t so that (p > t).sum() <= n (as close as ties allow)."""
    s = np.sort(p)[::-1]
    if n <= 0:
        return float(s[0])
    if n >= len(s):
        return -1.0
    return float(s[n])


def per_date(mask, d, nd):
    return np.bincount(d[mask], minlength=nd).astype(float)


def boot(stat_a, stat_b, rng, ratio=False):
    """Paired date bootstrap of sum(a)-sum(b) (or sum(a)/sum(b))."""
    k = len(stat_a)
    idx = rng.integers(0, k, size=(DRAWS, k))
    A, Bb = stat_a[idx].sum(1), stat_b[idx].sum(1)
    v = A / np.where(Bb > 0, Bb, np.nan) if ratio else A - Bb
    return [float(np.nanpercentile(v, 2.5)), float(np.nanpercentile(v, 97.5))]


def isotonic_cv(p, y, month):
    from sklearn.isotonic import IsotonicRegression
    out = np.empty_like(p)
    for m in np.unique(month):
        tr, te = month != m, month == m
        iso = IsotonicRegression(y_min=0, y_max=1, out_of_bounds="clip").fit(p[tr], y[tr])
        out[te] = iso.predict(p[te])
    return out


def miss_classes(xyz, y, d, flag, nd):
    """Per missed report point: 'left_out' (<=100 km of own flagged area that day), 'wrong_place'
    (flagged >= MIN_FLAG samples elsewhere), 'no_signal'. Returns per-date counts and per-point labels."""
    lab = np.full(len(y), "", object)
    counts = {k: np.zeros(nd) for k in ("hit", "left_out", "wrong_place", "no_signal")}
    dist_km = np.full(len(y), np.nan)
    for j in range(nd):
        s = np.where(d == j)[0]
        rep = s[y[s] == 1]
        if not len(rep):
            continue
        f = s[flag[s]]
        hit = rep[flag[rep]]
        miss = rep[~flag[rep]]
        lab[hit] = "hit"
        counts["hit"][j] = len(hit)
        if not len(miss):
            continue
        if len(f) < MIN_FLAG:
            lab[miss] = "no_signal"
            counts["no_signal"][j] = len(miss)
            continue
        dist, _ = cKDTree(xyz[f]).query(xyz[miss])
        km = 2 * B.EARTH_KM * np.arcsin(np.minimum(dist / 2, 1))
        dist_km[miss] = km
        near = km <= NEAR_KM
        lab[miss[near]] = "left_out"
        lab[miss[~near]] = "wrong_place"
        counts["left_out"][j] = near.sum()
        counts["wrong_place"][j] = (~near).sum()
    return counts, lab, dist_km


def bearings(xy, src, dst):
    """Bearing (deg from north) from each src point to its dst point."""
    lon1, lat1, lon2, lat2 = map(np.radians, (xy[src, 0], xy[src, 1], xy[dst, 0], xy[dst, 1]))
    x = np.sin(lon2 - lon1) * np.cos(lat2)
    yb = np.cos(lat1) * np.sin(lat2) - np.sin(lat1) * np.cos(lat2) * np.cos(lon2 - lon1)
    return (np.degrees(np.arctan2(x, yb)) + 360) % 360


def run(a):
    arr = np.load(a.arrays, allow_pickle=False)
    y, d, pt = arr["y"], arr["d"], arr["pt"]
    xy, dates = arr["coords"], [str(x) for x in arr["dates"]]
    if any(not x.startswith("2024") for x in dates):
        raise ValueError("2024 diagnostic dates only (2021/2025 sealed)")
    po, pn = arr["p_ours"], arr["p_nadocast"]
    nd = len(dates)
    rng = np.random.default_rng(SEED)
    month = np.array([int(x[5:7]) for x in dates])[d]
    xyz_all = B.unit(xy[:, 0], xy[:, 1])
    xyz = xyz_all[pt]
    res = {"status": "diagnostic (all 323 scored 2024 dates; 2021 and 2025 sealed)", "dates": nd,
           "points": int(len(y)), "report_points": int(y.sum()), "report_days": int(len(np.unique(d[y == 1])))}

    # ---- 1. fixed, matched false-alarm area, matched detection
    comp = {}
    for t in (0.02, 0.05):
        key = f"{t:.0%}"
        fa_n = int(((y == 0) & (pn >= t)).sum())
        hit_n = int(((y == 1) & (pn >= t)).sum())
        t_fa = thresholds_for_count(po[y == 0], fa_n)          # ours, same FA area as NadoCast at t
        t_det = thresholds_for_count(po[y == 1], hit_n)        # ours, same hits as NadoCast at t
        h_n = per_date((y == 1) & (pn >= t), d, nd)
        row = {"nadocast_threshold": t, "nadocast_hits": hit_n,
               "nadocast_false_alarm_km2_per_day": fa_n * SAMPLE_KM2 / nd}
        h_fix = per_date((y == 1) & (po >= t), d, nd)
        f_fix = per_date((y == 0) & (po >= t), d, nd)
        row["fixed"] = {"our_threshold": t, "our_hits": int(h_fix.sum()), "our_false_alarm_km2_per_day": f_fix.sum() * SAMPLE_KM2 / nd,
                        "hits_ours_minus_nadocast": int(h_fix.sum() - hit_n), "hits_diff_95": boot(h_fix, h_n, rng)}
        h_fa = per_date((y == 1) & (po > t_fa), d, nd)
        row["matched_false_alarm_area"] = {"our_threshold": t_fa, "our_hits": int(h_fa.sum()),
                                           "our_false_alarm_km2_per_day": ((y == 0) & (po > t_fa)).sum() * SAMPLE_KM2 / nd,
                                           "hits_ours_minus_nadocast": int(h_fa.sum() - hit_n), "hits_diff_95": boot(h_fa, h_n, rng),
                                           "hit_ratio_ours_over_nadocast": float(h_fa.sum() / hit_n), "hit_ratio_95": boot(h_fa, h_n, rng, True)}
        f_det = per_date((y == 0) & (po > t_det), d, nd)
        f_n = per_date((y == 0) & (pn >= t), d, nd)
        row["matched_detection"] = {"our_threshold": t_det, "our_hits": int(((y == 1) & (po > t_det)).sum()),
                                    "our_false_alarm_km2_per_day": f_det.sum() * SAMPLE_KM2 / nd,
                                    "false_alarm_ratio_ours_over_nadocast": float(f_det.sum() / max(f_n.sum(), 1)),
                                    "false_alarm_ratio_95": boot(f_det, f_n, rng, True)}
        comp[key] = row
    res["comparisons"] = comp

    # ---- 2. probability scale
    ro, rn = isotonic_cv(po, y, month), isotonic_cv(pn, y, month)
    se = {k: np.bincount(d, weights=(p - y) ** 2, minlength=nd) for k, p in
          (("ours", po), ("ours_recal", ro), ("nadocast", pn), ("nadocast_recal", rn))}
    n_by = np.bincount(d, minlength=nd).astype(float)
    bri = {k: float(v.sum() / n_by.sum()) for k, v in se.items()}
    gap = bri["ours"] - bri["nadocast"]
    rel = {}
    for k, p in (("ours", po), ("ours_recal", ro), ("nadocast", pn)):
        rel[k] = []
        for lo, hi in zip(B.BINS, B.BINS[1:]):
            s = (p >= lo) & ((p < hi) if hi < 1 else True)
            if s.any():
                rel[k].append({"bin": [lo, hi], "n": int(s.sum()), "mean": float(p[s].mean()), "observed": float(y[s].mean())})
    res["probability_scale"] = {
        "method": "isotonic recalibration fitted on the other 11 months, applied to the held-out month, for both models",
        "brier": bri,
        "gap_raw": gap, "gap_raw_95": B.boot_diff(se["ours"], se["nadocast"], n_by, rng),
        "gap_after_recalibrating_ours": bri["ours_recal"] - bri["nadocast"],
        "gap_after_recalibrating_ours_95": B.boot_diff(se["ours_recal"], se["nadocast"], n_by, rng),
        "gap_both_recalibrated": bri["ours_recal"] - bri["nadocast_recal"],
        "gap_both_recalibrated_95": B.boot_diff(se["ours_recal"], se["nadocast_recal"], n_by, rng),
        "share_of_raw_gap_closed_by_recalibrating_ours": float((bri["ours"] - bri["ours_recal"]) / gap) if gap else None,
        "recalibrated_thresholds": {f"{t:.0%}": {"ours_recal_hits": int(((y == 1) & (ro >= t)).sum()),
                                                  "ours_recal_false_alarm_km2_per_day": ((y == 0) & (ro >= t)).sum() * SAMPLE_KM2 / nd}
                                    for t in (0.02, 0.05)},
        "reliability": rel}

    # ---- 3. miss classes at matched false-alarm area (NadoCast 5% area)
    t5 = comp["5%"]["matched_false_alarm_area"]["our_threshold"]
    flag_o, flag_n = po > t5, pn >= 0.05
    co, lab_o, dist_o = miss_classes(xyz, y, d, flag_o, nd)
    cn, lab_n, dist_n = miss_classes(xyz, y, d, flag_n, nd)
    tot = y.sum()
    mc = {}
    for k in ("hit", "left_out", "wrong_place", "no_signal"):
        mc[k] = {"ours": int(co[k].sum()), "nadocast": int(cn[k].sum()),
                 "ours_share_of_report_points": float(co[k].sum() / tot), "nadocast_share_of_report_points": float(cn[k].sum() / tot),
                 "ours_minus_nadocast_95": boot(co[k], cn[k], rng)}
    # report days by dominant pattern (days with >= 20 report points)
    day_tab = []
    for j in range(nd):
        r = int(((d == j) & (y == 1)).sum())
        if r < 20:
            continue
        def frac(c):
            return {k: float(c[k][j] / r) for k in c}
        fo, fn = frac(co), frac(cn)
        def kind(f):
            if f["hit"] >= 0.75:
                return "corridor_captured"
            if f["hit"] + f["left_out"] >= 0.5 and f["hit"] > 0:
                return "right_corridor_parts_left_out"
            if f["wrong_place"] >= 0.5:
                return "wrong_place"
            if f["no_signal"] >= 0.5:
                return "no_signal"
            return "mixed"
        s = d == j
        day_tab.append({"date": dates[j], "report_points": r, "ours": kind(fo), "nadocast": kind(fn),
                        "ours_fractions": fo, "nadocast_fractions": fn,
                        "ours_max": float(po[s].max()), "nadocast_max": float(pn[s].max()),
                        "brier_ours_minus_nadocast": float((se["ours"][j] - se["nadocast"][j]) / n_by[j])})
    kinds = ("corridor_captured", "right_corridor_parts_left_out", "wrong_place", "no_signal", "mixed")
    res["misses_at_matched_false_alarm_area"] = {
        "our_threshold": t5, "nadocast_threshold": 0.05, "near_km": NEAR_KM, "min_flagged_samples": MIN_FLAG,
        "report_point_classes": mc,
        "report_days_ge20_points": len(day_tab),
        "day_patterns": {m: {k: sum(1 for t in day_tab if t[m] == k) for k in kinds} for m in ("ours", "nadocast")}}

    # where our left-out misses sit relative to our flagged area
    lo_idx = np.where(lab_o == "left_out")[0]
    if len(lo_idx):
        brg = []
        for j in np.unique(d[lo_idx]):
            s = np.where(d == j)[0]
            f = s[flag_o[s]]
            m = lo_idx[d[lo_idx] == j]
            _, nn = cKDTree(xyz[f]).query(xyz[m])
            brg.append(bearings(xy, pt[f[nn]], pt[m]))
        brg = np.concatenate(brg)
        sect = {"north": ((brg >= 315) | (brg < 45)), "east": (brg >= 45) & (brg < 135),
                "south": (brg >= 135) & (brg < 225), "west": (brg >= 225) & (brg < 315)}
        res["misses_at_matched_false_alarm_area"]["left_out_direction_from_our_flagged_area"] = {k: float(v.mean()) for k, v in sect.items()}

    # ---- 4. outbreaks, Dec 28, cases each way
    day_tab.sort(key=lambda t: -t["report_points"])
    res["outbreaks_top10"] = day_tab[:10]
    res["december_28"] = next((t for t in day_tab if t["date"] == "2024-12-28"), None)
    by = sorted(day_tab, key=lambda t: t["brier_ours_minus_nadocast"])
    res["days_ours_better"] = by[:5]
    res["days_nadocast_better"] = by[-5:][::-1]
    allday = []
    for j in range(nd):
        allday.append(float((se["ours"][j] - se["nadocast"][j]) / n_by[j]))
    allday = np.array(allday)
    res["all_days_brier_better"] = {"ours": int((allday < 0).sum()), "nadocast": int((allday > 0).sum()),
                                    "report_days_ours": int(sum((allday[j] < 0) for j in np.unique(d[y == 1]))),
                                    "report_days_nadocast": int(sum((allday[j] > 0) for j in np.unique(d[y == 1])))}

    # ---- 5. why: v0.7 logit contributions at report points
    if a.conus:
        from nadocast_benchmark import load_box
        cases, X, _, coords, names = load_box(a.conus, set(dates))
        sup, _ = geography(coords)
        fi = np.where(sup)[0]
        if not np.array_equal(coords[fi], xy):
            raise ValueError("Footprint reconstruction differs from the saved benchmark arrays")
        m = json.loads(Path(B.BASELINE).read_text())["products"]["day1_tornado"]
        mu, sd, w = map(np.array, (m["feature_mean"], m["feature_scale"], m["coefficients"]))
        ci = np.array([cases.index(x) for x in dates])
        Xr = X[ci[d], fi[pt]].astype(float)
        contrib = (Xr - mu) / sd * w
        chk = expit(m["calibration_intercept"] + m["calibration_slope"] * (m["intercept"] + contrib.sum(1)))
        gi = {g: [i for i, n in enumerate(names) if g in n] for g in GROUPS}
        sets = {"our_hits": lab_o == "hit", "our_left_out_misses": lab_o == "left_out",
                "our_wrong_place_misses": lab_o == "wrong_place", "our_no_signal_misses": lab_o == "no_signal",
                "missed_by_us_hit_by_nadocast": (y == 1) & ~flag_o & flag_n,
                "our_false_alarms": (y == 0) & flag_o}
        uh = names.index("x_uh25_nearby_max_max")
        why = {"max_abs_recomputed_probability_error": float(np.abs(chk - po).max()), "groups": {}}
        for s, msk in sets.items():
            if not msk.any():
                continue
            why["groups"][s] = {"points": int(msk.sum()),
                                "mean_logit_contribution": {g: float(contrib[msk][:, ix].sum(1).mean()) for g, ix in gi.items()},
                                "median_uh25_nearby_max_m2s2": float(np.median(Xr[msk, uh])),
                                "share_uh25_nearby_max_below_25": float((Xr[msk, uh] < 25).mean()),
                                "median_our_probability": float(np.median(po[msk]))}
        res["why"] = why

    a.output.mkdir(parents=True, exist_ok=True)
    (a.output / "diagnosis.json").write_text(json.dumps(res, indent=1, default=float) + "\n")
    maps(a.output, dates, xy, y, d, pt, po, pn, t5, lab_o, lab_n, res)
    print(json.dumps({k: res[k] for k in ("comparisons",)}, default=float)[:2000])


def maps(out, dates, xy, y, d, pt, po, pn, t5, lab_o, lab_n, res):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.lines import Line2D
    from phase2_maps import CMAP, NORM, draw_states, states
    rings = states()
    picks = [("dec28", "2024-12-28")]
    nb = [t["date"] for t in res["days_nadocast_better"] if t["date"] != "2024-12-28"]
    ob = [t["date"] for t in res["days_ours_better"]]
    if nb:
        picks.append(("nadocast_better", nb[0]))
    if ob:
        picks.append(("ours_better", ob[0]))
    res["map_cases"] = dict(picks)
    colors = {"hit": "#08306b", "left_out": "#e7298a", "wrong_place": "#ff7f00", "no_signal": "#000000"}
    for kind, day in picks:
        if day not in dates:
            continue
        j = dates.index(day)
        s = d == j
        xs = xy[pt[s]]
        fig, axes = plt.subplots(1, 2, figsize=(15, 6))
        for ax, (title, p, flag_t, lab) in zip(axes, (("Ours (v0.7)", po[s], t5, lab_o[s]),
                                                       ("NadoCast (D-1 12Z, abs. calibrated)", pn[s], 0.05, lab_n[s]))):
            ax.scatter(xs[:, 0], xs[:, 1], c=p, cmap=CMAP, norm=NORM, s=5, marker="s", lw=0)
            f = p > flag_t if title.startswith("Ours") else p >= flag_t
            ax.scatter(xs[f, 0], xs[f, 1], s=7, marker="s", facecolors="none", edgecolors="#444444", lw=0.25)
            for k, c in colors.items():
                m = lab == k
                ax.scatter(xs[m, 0], xs[m, 1], s=7, c=c, marker="o", lw=0)
            draw_states(ax, rings)
            ax.set_xlim(-101, -74); ax.set_ylim(29, 46); ax.set_aspect(1 / np.cos(np.radians(37.5)))
            ax.set_xticks([]); ax.set_yticks([])
            r = int((y[s] == 1).sum())
            ax.set_title(f"{title}: max {p.max():.0%}; flagged (outlined) at {'%.1f%%' % (flag_t * 100)}\n"
                         f"hits {int((lab == 'hit').sum())}, left out {int((lab == 'left_out').sum())}, "
                         f"wrong place {int((lab == 'wrong_place').sum())}, no signal {int((lab == 'no_signal').sum())} of {r}",
                         fontsize=9)
        fig.legend(handles=[Line2D([], [], marker="o", ls="", color=c, label=k.replace("_", " ")) for k, c in colors.items()] +
                   [Line2D([], [], marker="s", ls="", mfc="none", mec="#444444", label="flagged area (same false-alarm area)")],
                   loc="lower center", ncol=5, fontsize=8.5, frameon=False)
        fig.suptitle(f"Day 1 tornado, convective day {day} ({kind.replace('_', ' ')}). Both models flagged at the SAME "
                     f"pooled false-alarm area (NadoCast 5% = ours {t5:.1%}). Research diagnostic.", fontsize=10)
        fig.tight_layout(rect=(0, 0.05, 1, 0.94))
        fig.savefig(out / f"diag-{kind}-{day}.png", dpi=110)
        plt.close(fig)
    (out / "diagnosis.json").write_text(json.dumps(res, indent=1, default=float) + "\n")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--arrays", type=Path, required=True, help="score-arrays.npz from the Day 1 score run")
    p.add_argument("--conus", type=Path, help="CONUS extraction <case>/conus-case.json dirs (for the 'why' section)")
    p.add_argument("--output", type=Path, required=True)
    run(p.parse_args())


if __name__ == "__main__":
    main()
