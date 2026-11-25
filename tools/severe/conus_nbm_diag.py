#!/usr/bin/env python3
"""March-April Florida/Gulf diagnostic for the failed HRRR + NBM Day 2 wind candidate.

Development data only. It is not a new candidate and does not revisit the verdict.

  fold     refit held-out fold 2 or 3 exactly as in the NBM gate (run 45544910438). The function is a copy
           of conus_fulldev.nbm_fold with saving added. Every per-date, per-region total must reproduce the
           original fold artifact before anything else is written; on any mismatch it writes mismatch.json
           and exits 1. When totals match, it saves the held-out Florida/Gulf point forecasts of both arms
           for March and April dates, plus the seven NBM inputs at those points.
  combine  split the March-April Florida/Gulf Brier change into no-report and report points (no-report by
           5% crossing class), list the dates, and draw the two requested maps on shared scales.
Input/forecast associations are reported as clues only; attributing the loss to an input needs a
controlled comparison.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from scipy.special import expit

import phase2_study as S
from conus_calibration import REGIONS, check_frozen, region_index
from conus_fulldev import DAY, NEG_KEEP, case_files, fit, load_case, nbm_load
from conus_study import regions

FL = REGIONS.index("florida_gulf_south")
MONTHS = ("-03-", "-04-")
MAP_DATES = ("2022-03-11", "2023-04-29")
NBM_COLS = ("nbm_gust10m_nearby_max_max", "nbm_gust10m_nearby_max_mean", "nbm_tstm_24_36_nearby_max",
            "nbm_tstm_36_48_nearby_max", "nbm_tstm_24_36_nearest", "nbm_tstm_36_48_nearest", "nbm_tstm12_nearby_max_max")


def close(a, b):
    return abs(a - b) <= 1e-7 * max(1.0, abs(a), abs(b))


def fold(a):
    fitted, sha = check_frozen(a.models, a.manifest)
    keep, scales, coords = fitted["keep"], fitted["scales"][DAY], fitted["coords"]
    files = case_files(a.conus)
    cases = sorted(files)
    excluded, nbm = {}, {}
    for c in cases:
        f, why = nbm_load(a.nbm, c, keep)
        if f is None:
            excluded[c] = why
        else:
            nbm[c] = f
    matched = [c for c in cases if c in nbm]
    with np.load(files[cases[0]][0], allow_pickle=False) as d:
        names = d["feature_names"].tolist()
    reg = region_index(None, regions(coords), keep)
    test_cases = [c for c in matched if S.fold_of(c) == a.fold]
    train_cases = [c for c in matched if S.fold_of(c) != a.fold]
    xs, ns, ys, ws, gs = [], [], [], [], []
    for c in train_cases:
        x, y, pts = load_case(*files[c], keep, scales, names, coords)
        rng = np.random.default_rng(int(c.replace("-", "")))
        m = (y > 0) | (rng.random(len(y)) < NEG_KEEP)
        xs.append(x[m]); ns.append(nbm[c][pts][m]); ys.append(y[m])
        ws.append(np.where(y[m] > 0, 1.0, 1.0 / NEG_KEEP)); gs.append(np.full(m.sum(), S.fold_of(c) % 3))
    x, xn, y, w, g = (np.concatenate(v) for v in (xs, ns, ys, ws, gs))
    del xs, ns
    models = {"hrrr": fit(x, y, w, g)}
    print(f"fold {a.fold}: hrrr fitted ({len(y)} rows)", flush=True)
    models["hrrr_nbm"] = fit(np.hstack([x, xn]), y, w, g)
    print(f"fold {a.fold}: hrrr_nbm fitted", flush=True)
    del x, xn
    sums = {k: [] for k in models}
    saved = {"date": [], "sample": [], "y": [], "p_hrrr": [], "p_nbm": [], "nbm": []}
    keep_idx = np.nonzero(keep)[0]
    for c in test_cases:
        xt, yt, pts = load_case(*files[c], keep, scales, names, coords)
        rt = reg[pts]
        inputs = {"hrrr": xt, "hrrr_nbm": np.hstack([xt, nbm[c][pts]])}
        probs = {}
        for k, (tree, cal) in models.items():
            p = expit(cal[0] + cal[1] * tree.decision_function(inputs[k]))
            probs[k] = p
            hi = p >= 0.05
            for r in range(len(REGIONS)):
                m = rt == r
                sums[k].append([c, r, int(m.sum()), float(yt[m].sum()), float(((p[m] - yt[m]) ** 2).sum()), float(p[m].sum()),
                                int((hi[m] & (yt[m] > 0)).sum()), int((hi[m] & (yt[m] == 0)).sum())])
        if any(mo in c for mo in MONTHS):
            m = rt == FL
            saved["date"] += [c] * int(m.sum())
            saved["sample"].append(keep_idx[pts[m]])
            saved["y"].append(yt[m]); saved["p_hrrr"].append(probs["hrrr"][m]); saved["p_nbm"].append(probs["hrrr_nbm"][m])
            saved["nbm"].append(nbm[c][pts][m])
    # reproduction check against the verified original artifact
    orig = json.loads(Path(a.original).read_text())
    problems = []
    if orig["test_dates"] != test_cases or orig["excluded"] != excluded:
        problems.append("date sets differ")
    for k in models:
        if len(orig["sums"][k]) != len(sums[k]):
            problems.append(f"{k}: row count {len(sums[k])} vs {len(orig['sums'][k])}")
            continue
        for new, old in zip(sums[k], orig["sums"][k]):
            if new[:4] != old[:4] or new[6:] != old[6:] or not close(new[4], old[4]) or not close(new[5], old[5]):
                problems.append({"arm": k, "date": new[0], "region": REGIONS[new[1]], "new": new, "original": old})
                if len(problems) > 50:
                    break
    a.output.mkdir(parents=True, exist_ok=True)
    # full totals of this attempt, always written (logging only; nothing above depends on it)
    (a.output / f"sums-fold-{a.fold}.json").write_text(json.dumps({"fold": a.fold, "sums": sums}) + "\n")
    if a.previous:
        prev = json.loads(Path(a.previous).read_text())
        cmp = {"listed_rows": 0, "matches_previous_attempt": 0, "matches_original": 0}
        lookup = {(r[0], r[1]): r for r in sums["hrrr_nbm"]}
        for item in prev:
            if not isinstance(item, dict) or item.get("arm") != "hrrr_nbm":
                continue
            row = lookup[(item["new"][0], item["new"][1])]
            cmp["listed_rows"] += 1
            same = lambda u, v: u[:4] == v[:4] and u[6:] == v[6:] and close(u[4], v[4]) and close(u[5], v[5])
            cmp["matches_previous_attempt"] += same(row, item["new"])
            cmp["matches_original"] += same(row, item["original"])
        (a.output / f"vs-previous-attempt-fold-{a.fold}.json").write_text(json.dumps(cmp, indent=1) + "\n")
        print(f"fold {a.fold}: on the {cmp['listed_rows']} rows listed by the failed attempt, this run matches the failed attempt "
              f"on {cmp['matches_previous_attempt']} and the original on {cmp['matches_original']}", flush=True)
    if problems:
        (a.output / f"mismatch-fold-{a.fold}.json").write_text(json.dumps(problems, indent=1) + "\n")
        print(f"::error::fold {a.fold} does not reproduce the original artifact ({len(problems)} differences); stopping")
        raise SystemExit(1)
    maxrel = max(abs(n[4] - o[4]) / max(1.0, abs(o[4])) for k in models for n, o in zip(sums[k], orig["sums"][k]))
    np.savez_compressed(a.output / f"fl-mar-apr-fold-{a.fold}.npz", date=np.array(saved["date"]),
                        sample=np.concatenate(saved["sample"]), y=np.concatenate(saved["y"]).astype(np.uint8),
                        p_hrrr=np.concatenate(saved["p_hrrr"]).astype(np.float32),
                        p_nbm=np.concatenate(saved["p_nbm"]).astype(np.float32),
                        nbm=np.concatenate(saved["nbm"]).astype(np.float32))
    (a.output / f"reproduction-fold-{a.fold}.json").write_text(json.dumps(
        {"fold": a.fold, "reproduced": True, "rows_checked": sum(len(v) for v in sums.values()),
         "max_relative_brier_difference": maxrel, "test_dates": test_cases, "frozen_models_sha256": sha}, indent=1) + "\n")
    print(f"fold {a.fold}: reproduced all {sum(len(v) for v in sums.values())} per-date, per-region rows (max rel diff {maxrel:.2e})")


def combine(a):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fitted, _ = check_frozen(a.models, a.manifest)
    coords = np.asarray(fitted["coords"])
    orig = [json.loads(f.read_text()) for f in sorted(a.originals.glob("fold-*.json"))]
    fl_n = sum(r[2] for p in orig for r in p["sums"]["hrrr"] if r[1] == FL)
    net = {k: sum(r[4] for p in orig for r in p["sums"][k] if r[1] == FL) for k in ("hrrr", "hrrr_nbm")}
    net_loss = net["hrrr_nbm"] - net["hrrr"]  # summed squared error, all 726 dates, Florida/Gulf
    marapr = {k: sum(r[4] for p in orig for r in p["sums"][k] if r[1] == FL and any(m in r[0] for m in MONTHS)) for k in net}
    parts = [np.load(f) for f in sorted(a.diag.glob("fl-mar-apr-fold-*.npz"))]
    D = {k: np.concatenate([p[k] for p in parts]) for k in ("date", "sample", "y", "p_hrrr", "p_nbm", "nbm")}
    y, ph, pn = D["y"].astype(float), D["p_hrrr"].astype(float), D["p_nbm"].astype(float)
    d = (pn - y) ** 2 - (ph - y) ** 2
    no, yes = y == 0, y == 1
    lo_h, lo_n = ph < 0.05, pn < 0.05
    cls = {"no-report, both below 5%": no & lo_h & lo_n,
           "no-report, NBM pushed above 5%": no & lo_h & ~lo_n,
           "no-report, NBM dropped below 5%": no & ~lo_h & lo_n,
           "no-report, both at or above 5%": no & ~lo_h & ~lo_n,
           "report points, NBM lower": yes & (pn < ph),
           "report points, NBM higher or equal": yes & (pn >= ph)}
    total = d.sum()
    assert abs(total - (marapr["hrrr_nbm"] - marapr["hrrr"])) <= 1e-6 * max(1, abs(total)), "saved points do not sum to the artifact totals"
    rows = []
    for name, m in cls.items():
        rows.append({"class": name, "points": int(m.sum()), "brier_change_sum": float(d[m].sum()),
                     "share_of_mar_apr_change": float(d[m].sum() / total), "share_of_726_date_net_loss": float(d[m].sum() / net_loss),
                     "mean_p_hrrr": float(ph[m].mean()) if m.any() else None, "mean_p_nbm": float(pn[m].mean()) if m.any() else None})
    dates = sorted(set(D["date"].tolist()))
    per_date = []
    for c in dates:
        m = D["date"] == c
        per_date.append({"date": c, "reports": int(y[m].sum()), "brier_change_sum": float(d[m].sum()),
                         "no_report_part": float(d[m & no].sum()), "report_part": float(d[m & yes].sum()),
                         "share_of_726_date_net_loss": float(d[m].sum() / net_loss),
                         "points_ge5_hrrr": int((ph[m] >= 0.05).sum()), "points_ge5_nbm": int((pn[m] >= 0.05).sum()),
                         "report_points_ge5_hrrr": int(((ph >= 0.05) & yes & m).sum()), "report_points_ge5_nbm": int(((pn >= 0.05) & yes & m).sum())})
    per_date.sort(key=lambda r: -r["brier_change_sum"])
    dp = pn - ph
    clues = {}
    for j, col in enumerate(NBM_COLS):
        v = D["nbm"][:, j]
        clues[col] = {"corr_with_dp_no_report_points": float(np.corrcoef(v[no], dp[no])[0, 1]),
                      "mean_where_nbm_raised_no_report": float(v[no & (dp > 0)].mean()),
                      "mean_where_nbm_lowered_no_report": float(v[no & (dp < 0)].mean())}
    res = {"dates": len(dates), "points": int(len(y)), "florida_gulf_samples_all_dates": int(fl_n),
           "net_florida_gulf_loss_726_dates_sum_sq": float(net_loss), "net_florida_gulf_brier_726_dates": float(net_loss / fl_n),
           "mar_apr_change_sum_sq": float(total), "mar_apr_share_of_net_loss": float(total / net_loss),
           "classes": rows, "per_date": per_date, "input_associations_clues_only": clues,
           "note": "Associations between NBM inputs and probability changes are clues, not attribution."}
    a.output.mkdir(parents=True, exist_ok=True)
    (a.output / "diagnostic.json").write_text(json.dumps(res, indent=1) + "\n")
    # maps on shared scales
    pmax = 0.3
    dmax = 0.10
    fig, axes = plt.subplots(2, 3, figsize=(15, 9.5), constrained_layout=True)
    for i, c in enumerate(MAP_DATES):
        m = D["date"] == c
        if not m.any():
            continue
        lon, lat = coords[D["sample"][m], 0], coords[D["sample"][m], 1]
        for j, (title, val, cmap, vmin, vmax) in enumerate((("HRRR only", ph[m], "YlOrRd", 0, pmax), ("HRRR + NBM", pn[m], "YlOrRd", 0, pmax),
                                                            ("HRRR + NBM − HRRR only", dp[m], "RdBu_r", -dmax, dmax))):
            ax = axes[i, j]
            sc = ax.scatter(lon, lat, c=val, s=11, cmap=cmap, vmin=vmin, vmax=vmax, marker="s", linewidths=0)
            if j < 2:
                hi = val >= 0.05
                ax.scatter(lon[hi], lat[hi], s=0.5, c="k", alpha=0.25)
            rep = y[m] == 1
            ax.scatter(lon[rep], lat[rep], s=9, facecolors="none", edgecolors="#0a6", linewidths=0.7, label="report point (within 25 mi)")
            ax.set_title(f"{c}: {title}" + (f" (reports: {int(rep.sum())} points)" if j == 0 else ""), fontsize=10)
            ax.set_aspect(1.15)
            ax.set_xticks([]); ax.set_yticks([])
            if i == 1:
                fig.colorbar(sc, ax=axes[:, j], orientation="horizontal", shrink=0.8,
                             label="probability (shared scale, capped at 30%)" if j < 2 else "difference (shared scale, ±10 points)")
    fig.suptitle("Florida/Gulf/South, Day 2 damaging wind, held-out development forecasts (March–April diagnostic)\n"
                 "Black dots: points at ≥5%. Green rings: report points. Same color scales on both dates.", fontsize=11)
    fig.savefig(a.output / "maps-2022-03-11-and-2023-04-29.png", dpi=110)
    L = ["# March–April Florida/Gulf diagnostic: HRRR + NBM vs HRRR only (Day 2 wind)", "",
         "Development data only; the failed verdict stands. Both folds reproduced the original per-date, per-region totals "
         "(see reproduction-fold-*.json) before any of this was computed.", "",
         f"- Florida/Gulf net loss over all 726 dates (sum of squared-error change): {net_loss:.3f} "
         f"(Brier {net_loss / fl_n:+.6f} per point, as in gate.md).",
         f"- March–April ({len(dates)} held-out dates, {len(y):,} Florida/Gulf points): change {total:.3f}, "
         f"**{total / net_loss:.0%} of the net 726-date loss**.", "",
         "| Point class | Points | Brier change (sum) | Share of Mar–Apr change | Share of 726-date net loss | mean p HRRR | mean p HRRR+NBM |",
         "|---|---|---|---|---|---|---|"]
    for r in rows:
        L.append(f"| {r['class']} | {r['points']:,} | {r['brier_change_sum']:+.3f} | {r['share_of_mar_apr_change']:+.0%} | "
                 f"{r['share_of_726_date_net_loss']:+.0%} | {r['mean_p_hrrr'] if r['mean_p_hrrr'] is None else round(r['mean_p_hrrr'], 4)} | "
                 f"{r['mean_p_nbm'] if r['mean_p_nbm'] is None else round(r['mean_p_nbm'], 4)} |")
    L += ["", "Positive = NBM worse. Shares can exceed ±100% because classes offset each other.", "",
          "## Largest March–April dates", "", "| Date | Report pts | Change | No-report part | Report part | Share of net loss | pts ≥5% HRRR → NBM | report pts ≥5% HRRR → NBM |",
          "|---|---|---|---|---|---|---|---|"]
    for r in per_date[:10]:
        L.append(f"| {r['date']} | {r['reports']} | {r['brier_change_sum']:+.3f} | {r['no_report_part']:+.3f} | {r['report_part']:+.3f} | "
                 f"{r['share_of_726_date_net_loss']:+.0%} | {r['points_ge5_hrrr']} → {r['points_ge5_nbm']} | {r['report_points_ge5_hrrr']} → {r['report_points_ge5_nbm']} |")
    L += ["", "## Input associations (clues only, not attribution)", "",
          "| NBM input | corr with NBM−HRRR change at no-report points | mean where NBM raised | mean where NBM lowered |", "|---|---|---|---|"]
    for k, v in clues.items():
        L.append(f"| {k} | {v['corr_with_dp_no_report_points']:+.2f} | {v['mean_where_nbm_raised_no_report']:.1f} | {v['mean_where_nbm_lowered_no_report']:.1f} |")
    L += ["", "![maps](maps-2022-03-11-and-2023-04-29.png)"]
    (a.output / "diagnostic.md").write_text("\n".join(L) + "\n")
    print("\n".join(L))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fold")
    f.add_argument("--fold", type=int, choices=(2, 3), required=True)
    f.add_argument("--conus", type=Path, required=True)
    f.add_argument("--nbm", type=Path, required=True)
    f.add_argument("--original", type=Path, required=True, help="the verified original fold-N.json")
    f.add_argument("--output", type=Path, required=True)
    f.add_argument("--previous", type=Path, default=None, help="mismatch-fold-N.json of an earlier failed attempt")
    c = sub.add_parser("combine")
    c.add_argument("--diag", type=Path, required=True)
    c.add_argument("--originals", type=Path, required=True)
    c.add_argument("--output", type=Path, required=True)
    for q in (f, c):
        q.add_argument("--models", type=Path, default=Path("research/severe/conus-v1/frozen/models.pkl"))
        q.add_argument("--manifest", type=Path, default=Path("research/severe/conus-v1/frozen/manifest.json"))
    a = p.parse_args()
    {"fold": fold, "combine": combine}[a.cmd](a)


if __name__ == "__main__":
    main()
