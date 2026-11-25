#!/usr/bin/env python3
"""Gust-only NBM test for Day 2 damaging wind (research/severe/conus-v1/nbm-gust/RULES.md).

Three arms on the same 726 matched 2022-23 development dates and six held-out month folds:
  hrrr       verified per-date/region totals from NBM gate run 45544910438 (reused, not refit)
  hrrr_nbm   verified totals from the same run (reused, not refit)
  hrrr_gust  NEW: frozen HRRR predictors + the two existing NBM gust columns only
             (nbm_gust10m_nearby_max_max, nbm_gust10m_nearby_max_mean)

  fold     fit only hrrr_gust for one held-out fold with the gate's exact training rows, seeds, tree settings and
           calibration; check that every scored (date, region) row has the same point and report counts as the
           verified artifact; save March-April Florida/Gulf point forecasts for folds 2 and 3.
  combine  apply the original four criteria to hrrr_gust vs hrrr; report everything else as listed in RULES.md.
Development data only; 2021 and 2025 never load; nothing touches the live feed, publisher or registry.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from scipy.special import expit

import phase2_study as S
from conus_calibration import REGIONS, check_frozen, region_index
from conus_fulldev import DAY, NBM_V41, NEG_KEEP, case_files, fit, load_case, nbm_load
from conus_study import regions

GUST_COLS = (0, 1)  # conus_nbm.FEATURES[0:2]
FL = REGIONS.index("florida_gulf_south")
MONTHS = ("-03-", "-04-")
ARMS = ("hrrr", "hrrr_gust", "hrrr_nbm")


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
            nbm[c] = f[:, GUST_COLS]
    matched = [c for c in cases if c in nbm]
    with np.load(files[cases[0]][0], allow_pickle=False) as d:
        names = d["feature_names"].tolist()
    reg = region_index(None, regions(coords), keep)
    test_cases = [c for c in matched if S.fold_of(c) == a.fold]
    train_cases = [c for c in matched if S.fold_of(c) != a.fold]
    orig = json.loads(Path(a.original).read_text())
    if orig["test_dates"] != test_cases or orig["excluded"] != excluded:
        raise SystemExit(f"fold {a.fold}: matched/held-out dates differ from the verified gate artifact")
    xs, ns, ys, ws, gs = [], [], [], [], []
    for c in train_cases:
        x, y, pts = load_case(*files[c], keep, scales, names, coords)
        rng = np.random.default_rng(int(c.replace("-", "")))
        m = (y > 0) | (rng.random(len(y)) < NEG_KEEP)
        xs.append(x[m]); ns.append(nbm[c][pts][m]); ys.append(y[m])
        ws.append(np.where(y[m] > 0, 1.0, 1.0 / NEG_KEEP)); gs.append(np.full(m.sum(), S.fold_of(c) % 3))
    x, xn, y, w, g = (np.concatenate(v) for v in (xs, ns, ys, ws, gs))
    del xs, ns
    print(f"fold {a.fold}: {len(y)} training rows", flush=True)
    tree, cal = fit(np.hstack([x, xn]), y, w, g)
    print(f"fold {a.fold}: hrrr_gust fitted", flush=True)
    del x, xn
    sums, saved = [], {"date": [], "sample": [], "y": [], "p_gust": []}
    keep_idx = np.nonzero(keep)[0]
    for c in test_cases:
        xt, yt, pts = load_case(*files[c], keep, scales, names, coords)
        rt = reg[pts]
        p = expit(cal[0] + cal[1] * tree.decision_function(np.hstack([xt, nbm[c][pts]])))
        hi = p >= 0.05
        for r in range(len(REGIONS)):
            m = rt == r
            sums.append([c, r, int(m.sum()), float(yt[m].sum()), float(((p[m] - yt[m]) ** 2).sum()), float(p[m].sum()),
                         int((hi[m] & (yt[m] > 0)).sum()), int((hi[m] & (yt[m] == 0)).sum())])
        if any(mo in c for mo in MONTHS):
            m = rt == FL
            saved["date"] += [c] * int(m.sum())
            saved["sample"].append(keep_idx[pts[m]]); saved["y"].append(yt[m]); saved["p_gust"].append(p[m])
    # structural check: the same scored rows (point and report counts) as the verified artifact
    bad = [(n[0], n[1]) for n, o in zip(sums, orig["sums"]["hrrr"]) if n[:4] != o[:4]]
    if len(sums) != len(orig["sums"]["hrrr"]) or bad:
        raise SystemExit(f"fold {a.fold}: scored rows differ from the verified artifact: {bad[:10]}")
    a.output.mkdir(parents=True, exist_ok=True)
    (a.output / f"gust-fold-{a.fold}.json").write_text(json.dumps(
        {"fold": a.fold, "frozen_models_sha256": sha, "test_dates": test_cases, "excluded": excluded,
         "train_rows": int(len(y)), "gust_columns": list(GUST_COLS), "sums": sums}) + "\n")
    if saved["date"]:
        np.savez_compressed(a.output / f"gust-fl-mar-apr-fold-{a.fold}.npz", date=np.array(saved["date"]),
                            sample=np.concatenate(saved["sample"]), y=np.concatenate(saved["y"]).astype(np.uint8),
                            p_gust=np.concatenate(saved["p_gust"]).astype(np.float32))
    print(f"fold {a.fold}: done; scored rows match the verified artifact structure", flush=True)


def combine(a):
    from conus_followup import SAMPLE_KM2
    orig = {p["fold"]: p for p in (json.loads(f.read_text()) for f in sorted(a.originals.glob("fold-*.json")))}
    gust = {p["fold"]: p for p in (json.loads(f.read_text()) for f in sorted(a.gust.glob("gust-fold-*.json")))}
    if sorted(orig) != list(range(6)) or sorted(gust) != list(range(6)):
        raise ValueError("Need all 6 verified folds and all 6 gust folds")
    rows = {"hrrr": [], "hrrr_nbm": [], "hrrr_gust": []}
    for k in range(6):
        rows["hrrr"] += orig[k]["sums"]["hrrr"]; rows["hrrr_nbm"] += orig[k]["sums"]["hrrr_nbm"]; rows["hrrr_gust"] += gust[k]["sums"]
    dates = sorted({r[0] for r in rows["hrrr"]})
    di = {d: i for i, d in enumerate(dates)}
    A = {k: np.zeros((len(dates), len(REGIONS), 6)) for k in ARMS}
    for k in ARMS:
        for c, r, n, sy, sse, sp, hit, fa in rows[k]:
            A[k][di[c], r] = (n, sy, sse, sp, hit, fa)
    assert all(np.array_equal(A[k][..., :2], A["hrrr"][..., :2]) for k in ARMS), "arms scored on different rows"
    clim = float(A["hrrr"][..., 1].sum() / A["hrrr"][..., 0].sum())

    def bss(v):
        n, sy, sse = v[..., 0].sum(), v[..., 1].sum(), v[..., 2].sum()
        return float(1 - sse / (sy - 2 * clim * sy + n * clim * clim))

    def diff(m1, m2, sel, sl):
        a1 = A[m1][sel][:, sl, 2].reshape(len(sel), -1).sum(1)
        a2 = A[m2][sel][:, sl, 2].reshape(len(sel), -1).sum(1)
        n = A[m2][sel][:, sl, 0].reshape(len(sel), -1).sum(1)
        r = np.random.default_rng(7)
        bs = []
        for _ in range(2000):
            j = r.integers(0, len(sel), len(sel))
            bs.append((a1[j].sum() - a2[j].sum()) / n[j].sum())
        return [float((a1.sum() - a2.sum()) / n.sum()), float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))]

    alld = np.arange(len(dates))
    noreport = A["hrrr"][..., 1].sum(1) == 0
    res = {"matched_dates": len(dates), "development_climatology": clim,
           "bss": {k: {"national": bss(A[k])} | {REGIONS[r]: bss(A[k][:, r]) for r in range(len(REGIONS))} for k in ARMS},
           "gust_minus_hrrr": {"national": diff("hrrr_gust", "hrrr", alld, slice(None))}
           | {REGIONS[r]: diff("hrrr_gust", "hrrr", alld, slice(r, r + 1)) for r in range(len(REGIONS))},
           "gust_minus_full_nbm": {"national": diff("hrrr_gust", "hrrr_nbm", alld, slice(None)),
                                   "florida_gulf_south": diff("hrrr_gust", "hrrr_nbm", alld, slice(FL, FL + 1))},
           "full_nbm_minus_hrrr_reference": {"national": diff("hrrr_nbm", "hrrr", alld, slice(None)),
                                             "florida_gulf_south": diff("hrrr_nbm", "hrrr", alld, slice(FL, FL + 1))},
           "calibration_ratio": {k: float(A[k][..., 3].sum() / A[k][..., 1].sum()) for k in ARMS},
           "florida_gulf_calibration_ratio": {k: float(A[k][:, FL, 3].sum() / A[k][:, FL, 1].sum()) for k in ARMS},
           "hits_at_5pct": {k: int(A[k][..., 4].sum()) for k in ARMS},
           "florida_gulf_hits_at_5pct": {k: int(A[k][:, FL, 4].sum()) for k in ARMS},
           "false_alarm_area_km2_at_5pct": {k: float(A[k][..., 5].sum() * SAMPLE_KM2) for k in ARMS},
           "florida_gulf_false_alarm_area_km2_at_5pct": {k: float(A[k][:, FL, 5].sum() * SAMPLE_KM2) for k in ARMS},
           "area_at_5pct_on_no_report_dates_km2_per_date": {k: float(A[k][noreport][..., 5].sum() * SAMPLE_KM2 / max(1, noreport.sum())) for k in ARMS}}
    early = np.array([d < NBM_V41 for d in dates])
    res["gust_by_nbm_version"] = {tag: {"dates": int(m.sum()), "national": diff("hrrr_gust", "hrrr", alld[m], slice(None))}
                                  for tag, m in (("v4.0 (before 2023-01-17)", early), ("v4.1 (from 2023-01-17)", ~early))}
    res["hit_retention"] = res["hits_at_5pct"]["hrrr_gust"] / max(1, res["hits_at_5pct"]["hrrr"])
    c1 = res["gust_minus_hrrr"]["national"][2] < 0
    c2 = not any(res["gust_minus_hrrr"][r][1] > 0 for r in REGIONS)
    c3 = abs(res["calibration_ratio"]["hrrr_gust"] - 1) <= 0.15
    c4 = res["hit_retention"] >= 0.95
    res["criteria"] = {"1_national_better": bool(c1), "2_no_region_worse": bool(c2), "3_calibrated_15pct": bool(c3),
                       "4_hit_retention_ge_95pct": bool(c4)}
    res["pass"] = bool(c1 and c2 and c3 and c4)
    # diagnostic subset (March-April, Florida/Gulf, per point)
    D = {k: np.concatenate([np.load(f)[k] for f in sorted(a.diag.glob("fl-mar-apr-fold-*.npz"))]) for k in ("date", "sample", "y", "p_hrrr", "p_nbm")}
    Gp = [np.load(f) for f in sorted(a.gust.glob("gust-fl-mar-apr-fold-*.npz"))]
    G = {k: np.concatenate([p[k] for p in Gp]) for k in ("date", "sample", "y", "p_gust")}
    key = lambda d, s: np.char.add(np.char.add(d.astype(str), "|"), s.astype(str))
    kd, kg = key(D["date"], D["sample"]), key(G["date"], G["sample"])
    order = np.argsort(kg)
    pos = order[np.searchsorted(kg, kd, sorter=order)]
    assert np.array_equal(kg[pos], kd) and np.array_equal(G["y"][pos], D["y"]), "March-April points do not align"
    y, ph, pn, pg = D["y"].astype(float), D["p_hrrr"].astype(float), D["p_nbm"].astype(float), G["p_gust"][pos].astype(float)
    sub = (y == 0) & (ph >= 0.05) & (pn >= 0.05)
    subg = (y == 0) & (ph >= 0.05) & (pg >= 0.05)
    res["mar_apr_diagnostic"] = {
        "subset_as_in_closed_diagnostic": "Florida/Gulf, March-April, no-report points where HRRR-only and full-NBM were both >= 5%",
        "points": int(sub.sum()),
        "brier_change_sum_full_nbm_minus_hrrr": float(((pn - y) ** 2 - (ph - y) ** 2)[sub].sum()),
        "brier_change_sum_gust_minus_hrrr": float(((pg - y) ** 2 - (ph - y) ** 2)[sub].sum()),
        "mean_p": {"hrrr": float(ph[sub].mean()), "hrrr_nbm": float(pn[sub].mean()), "hrrr_gust": float(pg[sub].mean())},
        "gust_defined_subset": {"points": int(subg.sum()), "brier_change_sum_gust_minus_hrrr": float(((pg - y) ** 2 - (ph - y) ** 2)[subg].sum()),
                                "mean_p_hrrr": float(ph[subg].mean()), "mean_p_gust": float(pg[subg].mean())},
        "mar_apr_total_brier_change_sum": {"full_nbm_minus_hrrr": float(((pn - y) ** 2 - (ph - y) ** 2).sum()),
                                           "gust_minus_hrrr": float(((pg - y) ** 2 - (ph - y) ** 2).sum())}}
    res["protected_2025_outcomes_accessed"] = False
    res["verification_2021_loaded"] = False
    a.output.mkdir(parents=True, exist_ok=True)
    (a.output / "gate.json").write_text(json.dumps(res, indent=1) + "\n")
    f = lambda v: f"{v[0]:+.6f} ({v[1]:+.6f} to {v[2]:+.6f})"
    L = [f"# Gust-only NBM test (Day 2 wind): HRRR + NBM gust vs HRRR only: {'PASS' if res['pass'] else 'FAIL'}", "",
         f"{len(dates)} matched held-out 2022-23 dates, 6 month-grouped folds. HRRR-only and full-NBM totals reused from verified run 45544910438. "
         f"BSS vs development climatology {clim:.5f}.", "",
         "| Arm | National | " + " | ".join(REGIONS) + " | mean p / obs | FL/Gulf mean p / obs |", "|---|---|" + "---|" * len(REGIONS) + "---|---|"]
    for k in ARMS:
        L.append(f"| {k} | {res['bss'][k]['national']:.3f} | " + " | ".join(f"{res['bss'][k][r]:.3f}" for r in REGIONS)
                 + f" | {res['calibration_ratio'][k]:.3f} | {res['florida_gulf_calibration_ratio'][k]:.3f} |")
    L += ["", "**Gust-only − HRRR-only** (decides the verdict), Brier difference, 95% whole-date interval:", ""]
    L += [f"- {k}: {f(v)}" for k, v in res["gust_minus_hrrr"].items()]
    L += ["", "**Gust-only − full NBM** (diagnostic):", "", f"- national: {f(res['gust_minus_full_nbm']['national'])}",
          f"- florida_gulf_south: {f(res['gust_minus_full_nbm']['florida_gulf_south'])}",
          "", "Full NBM − HRRR-only (reference, from the verified gate):", "",
          f"- national: {f(res['full_nbm_minus_hrrr_reference']['national'])}",
          f"- florida_gulf_south: {f(res['full_nbm_minus_hrrr_reference']['florida_gulf_south'])}", "",
          "Gust-only − HRRR-only by NBM version period (national):", ""]
    L += [f"- {k} ({v['dates']} dates): {f(v['national'])}" for k, v in res["gust_by_nbm_version"].items()]
    L += ["", "| | HRRR only | HRRR + gust | HRRR + all NBM |", "|---|---|---|---|",
          "| Hits at ≥5% (national) | " + " | ".join(f"{res['hits_at_5pct'][k]:,}" for k in ARMS) + " |",
          "| Hits at ≥5% (FL/Gulf) | " + " | ".join(f"{res['florida_gulf_hits_at_5pct'][k]:,}" for k in ARMS) + " |",
          "| False-alarm area ≥5%, km² (national) | " + " | ".join(f"{res['false_alarm_area_km2_at_5pct'][k]:,.0f}" for k in ARMS) + " |",
          "| False-alarm area ≥5%, km² (FL/Gulf) | " + " | ".join(f"{res['florida_gulf_false_alarm_area_km2_at_5pct'][k]:,.0f}" for k in ARMS) + " |",
          "| Area ≥5% per no-report date, km² | " + " | ".join(f"{res['area_at_5pct_on_no_report_dates_km2_per_date'][k]:,.0f}" for k in ARMS) + " |",
          "", f"Hit retention (gust vs HRRR): {res['hit_retention']:.3f}", "",
          "## March–April Florida/Gulf diagnostic subset (does not decide the verdict)", ""]
    d = res["mar_apr_diagnostic"]
    L += [f"No-report points where HRRR-only and full NBM were both ≥5% ({d['points']:,} points, as in the closed diagnostic):", "",
          f"- Brier change (sum): full NBM {d['brier_change_sum_full_nbm_minus_hrrr']:+.3f}; gust-only {d['brier_change_sum_gust_minus_hrrr']:+.3f}",
          f"- Mean probability: HRRR {d['mean_p']['hrrr']:.4f}; full NBM {d['mean_p']['hrrr_nbm']:.4f}; gust-only {d['mean_p']['hrrr_gust']:.4f}",
          f"- Same subset defined with the gust arm ({d['gust_defined_subset']['points']:,} points): change {d['gust_defined_subset']['brier_change_sum_gust_minus_hrrr']:+.3f}",
          f"- All March–April Florida/Gulf points: full NBM {d['mar_apr_total_brier_change_sum']['full_nbm_minus_hrrr']:+.3f}; "
          f"gust-only {d['mar_apr_total_brier_change_sum']['gust_minus_hrrr']:+.3f}", "", f"Criteria: {res['criteria']}"]
    (a.output / "gate.md").write_text("\n".join(L) + "\n")
    print("\n".join(L))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fold")
    f.add_argument("--fold", type=int, required=True)
    f.add_argument("--conus", type=Path, required=True)
    f.add_argument("--nbm", type=Path, required=True)
    f.add_argument("--original", type=Path, required=True)
    f.add_argument("--output", type=Path, required=True)
    c = sub.add_parser("combine")
    c.add_argument("--originals", type=Path, required=True)
    c.add_argument("--gust", type=Path, required=True)
    c.add_argument("--diag", type=Path, required=True)
    c.add_argument("--output", type=Path, required=True)
    for q in (f, c):
        q.add_argument("--models", type=Path, default=Path("research/severe/conus-v1/frozen/models.pkl"))
        q.add_argument("--manifest", type=Path, default=Path("research/severe/conus-v1/frozen/manifest.json"))
    a = p.parse_args()
    {"fold": fold, "combine": combine}[a.cmd](a)


if __name__ == "__main__":
    main()
