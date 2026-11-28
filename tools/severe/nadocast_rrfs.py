#!/usr/bin/env python3
"""NadoCast head-to-head for the retrospective RRFS pilot (Day 2 damaging wind).

Rules: research/severe/conus-v1/rrfs/retro/NADOCAST.md.

  inventory  for every 2024 pilot date: fetch the NadoCast 2022-models absolutely calibrated wind file (12Z, f24-47),
             record HTTP status, SHA-256 and Last-Modified, check it against the earlier benchmark's pin where one exists,
             decode-check it (WINDPROB 24-47 %, 387x226), and write the matched roster with every exclusion and reason.
             No forecast is scored.
  compare    the pinned held-out HRRR-only and HRRR + 12Z RRFS predictions (regenerated and fingerprint-checked by
             conus_rrfs_pilot.py score --save-predictions) against NadoCast on the matched roster.
Research only; 2025 is never requested; nothing touches the live feed, publisher, registry, preview or collectors.
"""
import argparse
import hashlib
import io
import json
from datetime import date, datetime
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
RETRO = ROOT / "research/severe/conus-v1/rrfs/retro"
PRIOR = ROOT / "research/severe/nadocast/wind_score/wind-score-scorecard.json"
FL = "florida_gulf_south"
SAMPLE_KM2 = 225.0
BOOT, SEED = 2000, 20261128
BINS = (0, 0.005, 0.01, 0.02, 0.05, 0.10, 0.15, 0.30, 1.0)
REF_T = 0.05
ARMS = ("hrrr", "hrrr_rrfs", "nadocast")


def nc_name(issue):
    return f"nadocast_2022_models_conus_wind_abs_calib_{issue:%Y%m%d}_t12z_f24-47.grib2"


def block_of(d):
    return "janfeb2024" if d[:7] in ("2024-01", "2024-02") else "may2024" if d[:7] == "2024-05" else None


def inventory(a):
    import nadocast_benchmark as B
    roster = json.loads((RETRO / "roster.json").read_text())["dates"]
    prior = json.loads(PRIOR.read_text())["nadocast_files"]
    rows, ok = [], []
    for d in [x for x in roster if x.startswith("2024")]:
        if d > "2024-12-29":
            raise ValueError("Day 2 window would reach 2025")
        issue = date.fromisoformat(d)
        path, meta = B.fetch_file(issue, nc_name(issue), a.cache)
        rec = {"date": d, "block": block_of(d), "url": meta.get("url"), "http_status": meta.get("status"),
               "sha256": meta.get("sha256"), "last_modified": meta.get("last_modified")}
        pin = prior.get(d, {}).get("nadocast")
        rec["prior_pin"] = {k: pin.get(k) for k in ("status", "sha256", "last_modified")} if pin else None
        reason = None
        if path is None:
            reason = f"no archived NadoCast wind file (HTTP {meta.get('status')})"
        elif not meta.get("last_modified"):
            reason = "no Last-Modified header (issue-time eligibility not verifiable)"
        elif datetime.fromisoformat(meta["last_modified"]) > datetime.fromisoformat(f"{d}T18:00:00+00:00"):
            reason = f"Last-Modified {meta['last_modified']} after the 18Z issue-date cutoff"
        elif pin and pin.get("status") == 200 and pin.get("sha256") != meta["sha256"]:
            reason = "file differs from the earlier benchmark's pinned SHA-256"
        else:
            try:
                B.decode(path, "24-47", short="windprob")
            except Exception as e:
                reason = f"decode check failed: {e!r}"[:200]
        rec["eligible"] = reason is None
        rec["exclusion"] = reason
        rows.append(rec)
        if reason is None:
            ok.append(d)
        print(d, "eligible" if reason is None else reason, flush=True)
    out = {"rules": "research/severe/conus-v1/rrfs/retro/NADOCAST.md", "nadocast_product": "2022 models, absolutely calibrated wind, 12Z f24-47",
           "matched_dates": ok, "matched_by_block": {b: [d for d in ok if block_of(d) == b] for b in ("janfeb2024", "may2024")},
           "excluded": {r["date"]: r["exclusion"] for r in rows if not r["eligible"]}, "files": rows}
    Path(a.output).mkdir(parents=True, exist_ok=True)
    (Path(a.output) / "nadocast-roster.json").write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps({"matched": len(ok), "excluded": len(out["excluded"]), "by_block": {k: len(v) for k, v in out["matched_by_block"].items()}}))


def equal_area_threshold(p, y, ref_count):
    p0 = np.sort(p[y == 0])[::-1]
    if ref_count >= len(p0):
        return -1.0
    return float(p0[ref_count])


def compare(a):
    import nadocast_benchmark as B
    from scipy.spatial import cKDTree
    from conus_calibration import REGIONS, check_frozen, region_index
    from conus_study import regions
    ros = json.loads(Path(a.roster).read_text())
    dates = ros["matched_dates"]
    pins = {r["date"]: r for r in ros["files"]}
    fitted, _ = check_frozen(ROOT / "research/severe/conus-v1/frozen/models.pkl", ROOT / "research/severe/conus-v1/frozen/manifest.json")
    coords = np.asarray(fitted["coords"])
    reg_all = region_index(None, regions(coords), fitted["keep"])
    kidx = np.nonzero(fitted["keep"])[0]
    posk = np.full(int(kidx.max()) + 1, -1)
    posk[kidx] = np.arange(len(kidx))
    z = np.load(a.predictions, allow_pickle=False)
    pdates = z["dates"].tolist()
    off = z["offsets"]
    thr = json.loads(Path(a.thresholds).read_text())
    ours = tuple(k for k in ("hrrr", "hrrr_rrfs", "hrrr_rrfs_smooth") if k in z.files)
    arms = ours + ("nadocast",)
    Y, D, R, Pm, B_ = [], [], [], {k: [] for k in arms}, []
    keep_rows = {}
    nn = km_max = None
    for j, d in enumerate(dates):
        i = pdates.index(d)
        sl = slice(off[i], off[i + 1])
        rows = z["row_index"][sl]
        y = z["labels"][sl]
        issue = date.fromisoformat(d)
        path, meta = B.fetch_file(issue, nc_name(issue), a.cache)
        if path is None or meta.get("sha256") != pins[d]["sha256"]:
            raise ValueError(f"{d}: NadoCast file missing or differs from the committed roster pin")
        g, glat, glon = B.decode(path, "24-47", short="windprob")
        if nn is None:
            tree = cKDTree(B.unit(glon, glat))
            dist, nn_all = tree.query(B.unit(coords[:, 0], coords[:, 1]))
            km = 2 * B.EARTH_KM * np.arcsin(np.minimum(dist / 2, 1))
            km_max = float(km[kidx].max())
            if km_max > B.MAX_KM:
                raise ValueError(f"a supported sample is {km_max:.1f} km from the nearest NadoCast point (> {B.MAX_KM} km)")
            nn, grid_ref = nn_all, (glat, glon)
        elif not (np.array_equal(glat, grid_ref[0]) and np.array_equal(glon, grid_ref[1])):
            raise ValueError(f"{d}: NadoCast grid changed")
        Y.append(y); D.append(np.full(len(y), j)); R.append(reg_all[posk[rows]]); B_.append(np.full(len(y), block_of(d)))
        for k in ours:
            Pm[k].append(z[k][sl])
        Pm["nadocast"].append(g[nn[rows]])
        keep_rows[d] = rows
    y = np.concatenate(Y).astype(float); dd = np.concatenate(D); rr = np.concatenate(R); bb = np.concatenate(B_)
    P = {k: np.concatenate(v).astype(float) for k, v in Pm.items()}
    rng = np.random.default_rng(SEED)
    res = {}
    scopes = {"pooled": ("janfeb2024", "may2024"), "janfeb2024": ("janfeb2024",), "may2024": ("may2024",)}
    for sc, blks in scopes.items():
        for region in ("national", FL):
            s = np.isin(bb, blks) & ((rr == REGIONS.index(FL)) if region == FL else True)
            ys, ds, bs_ = y[s], dd[s], bb[s]
            sel = sorted(set(ds.tolist()))
            nd = len(sel)
            remap = np.full(len(dates), -1); remap[sel] = np.arange(nd)
            di = remap[ds]
            p = {k: P[k][s] for k in arms}
            out = {"dates": nd, "rows": int(len(ys)), "event_rows": int(ys.sum()), "report_days": int(len(np.unique(di[ys == 1]))),
                   "base_rate": float(ys.mean()) if len(ys) else None, "arms": {}}
            if len(ys) == 0 or ys.sum() == 0:
                res.setdefault(sc, {})[region] = out
                continue
            def pdsum(v):
                return np.bincount(di, weights=v, minlength=nd)
            n_d, e_d = pdsum(np.ones(len(ys))), pdsum(ys)
            ref_fa = int(((p["nadocast"] >= REF_T) & (ys == 0)).sum())
            sse, hit_eq, hit_dep = {}, {}, {}
            for k in arms:
                sse[k] = pdsum((p[k] - ys) ** 2)
                t_eq = REF_T if k == "nadocast" else equal_area_threshold(p[k], ys, ref_fa)
                he = (p[k] >= t_eq) if k == "nadocast" else (p[k] > t_eq)
                hit_eq[k] = pdsum((he & (ys == 1)).astype(float))
                fa_eq = int((he & (ys == 0)).sum())
                t_dep = np.full(len(ys), REF_T) if k == "nadocast" else np.array([thr[b][k] for b in bs_])
                hd = p[k] >= t_dep
                hit_dep[k] = pdsum((hd & (ys == 1)).astype(float))
                rel = []
                for lo, hi in zip(BINS[:-1], BINS[1:]):
                    m = (p[k] >= lo) & (p[k] < hi)
                    if m.any():
                        rel.append({"bin": [lo, hi], "rows": int(m.sum()), "mean_forecast": float(p[k][m].mean()), "observed": float(ys[m].mean())})
                out["arms"][k] = {
                    "brier": float(sse[k].sum() / n_d.sum()), "forecast_to_observed_ratio": float(p[k].sum() / ys.sum()), "reliability": rel,
                    "equal_area_vs_nadocast_5pct": {"threshold": float(t_eq), "hit_fraction": float(hit_eq[k].sum() / ys.sum()),
                                                    "false_alarm_points": fa_eq, "reference_false_alarm_points": ref_fa,
                                                    "false_alarm_km2_per_day": fa_eq * SAMPLE_KM2 / nd},
                    "training_set_threshold": {"hit_fraction": float(hit_dep[k].sum() / ys.sum()),
                                               "false_alarm_km2_per_day": float((hd & (ys == 0)).sum() * SAMPLE_KM2 / nd),
                                               "threshold": ("5% (NadoCast reference)" if k == "nadocast" else {b: thr[b][k] for b in blks})}}
            idx = rng.integers(0, nd, size=(BOOT, nd))
            def ci(num_a, num_b, den):
                pt = (num_a.sum() - num_b.sum()) / den.sum()
                bt = (num_a[idx].sum(1) - num_b[idx].sum(1)) / den[idx].sum(1)
                return {"estimate": float(pt), "ci95": [float(np.nanpercentile(bt, 2.5)), float(np.nanpercentile(bt, 97.5))]}
            out["paired"] = {}
            pairs = (("hrrr_rrfs", "nadocast"), ("hrrr", "nadocast"), ("hrrr_rrfs", "hrrr"))
            if "hrrr_rrfs_smooth" in arms:
                pairs = (("hrrr_rrfs_smooth", "hrrr_rrfs"), ("hrrr_rrfs_smooth", "nadocast")) + pairs
            for x_, y_ in pairs:
                out["paired"][f"{x_}_minus_{y_}"] = {"brier": ci(sse[x_], sse[y_], n_d),
                                                     "equal_area_hit_fraction": ci(hit_eq[x_], hit_eq[y_], e_d),
                                                     "training_threshold_hit_fraction": ci(hit_dep[x_], hit_dep[y_], e_d)}
            if "hrrr_rrfs_smooth" in arms:
                # report points recovered / lost by smoothing at the equal-area thresholds, incl. NadoCast-only points
                fe = {k: (p[k] >= REF_T) if k == "nadocast" else (p[k] > out["arms"][k]["equal_area_vs_nadocast_5pct"]["threshold"]) for k in arms}
                yy = ys == 1
                out["smoothing_recovery_equal_area"] = {
                    "recovered": int((yy & fe["hrrr_rrfs_smooth"] & ~fe["hrrr_rrfs"]).sum()),
                    "lost": int((yy & fe["hrrr_rrfs"] & ~fe["hrrr_rrfs_smooth"]).sum()),
                    "nadocast_only_for_blend": int((yy & fe["nadocast"] & ~fe["hrrr_rrfs"]).sum()),
                    "of_which_caught_after_smoothing": int((yy & fe["nadocast"] & ~fe["hrrr_rrfs"] & fe["hrrr_rrfs_smooth"]).sum())}
                if sc == "may2024" and region == "national":
                    may_thr = {k: out["arms"][k]["equal_area_vs_nadocast_5pct"]["threshold"] for k in arms}
            res.setdefault(sc, {})[region] = out
    if "hrrr_rrfs_smooth" in arms and getattr(a, "map_dates", None):
        draw_smooth_maps(Path(a.output), a.map_dates, dates, Y, Pm, keep_rows, coords, may_thr)
    card = {"rules": "research/severe/conus-v1/rrfs/retro/NADOCAST.md", "matched_dates": len(dates), "excluded": ros["excluded"],
            "max_nearest_nadocast_km": km_max, "predictions_fingerprint_check": json.loads(Path(a.fingerprint_check).read_text()),
            "results": res}
    Path(a.output).mkdir(parents=True, exist_ok=True)
    (Path(a.output) / "scorecard.json").write_text(json.dumps(card, indent=1) + "\n")
    (Path(a.output) / "scorecard.md").write_text(render(card) + "\n")
    print(render(card))


NEAR_FRAC = 0.5      # a missed report point with blend p >= 0.5 x threshold counts as "ranked a little too low"
NEAR_KM = 150.0      # a blend-flagged point within this distance of a missed point counts as "displaced"
MAP_TOP = 4


def diagnose(a):
    """May 2024 miss diagnosis at the equal-area thresholds of the committed scorecard (no fitting, no new scores)."""
    import nadocast_benchmark as B
    from scipy.spatial import cKDTree
    from conus_calibration import check_frozen
    ros = json.loads(Path(a.roster).read_text())
    card = json.loads(Path(a.scorecard).read_text())
    tm = {k: v["equal_area_vs_nadocast_5pct"]["threshold"] for k, v in card["results"]["may2024"]["national"]["arms"].items()}
    dates = [d for d in ros["matched_dates"] if block_of(d) == "may2024"]
    pins = {r["date"]: r for r in ros["files"]}
    fitted, _ = check_frozen(ROOT / "research/severe/conus-v1/frozen/models.pkl", ROOT / "research/severe/conus-v1/frozen/manifest.json")
    coords = np.asarray(fitted["coords"])
    z = np.load(a.predictions, allow_pickle=False)
    pdates, off = z["dates"].tolist(), z["offsets"]
    nn, per, maps = None, [], {}
    tot = {"nadocast_only_hits": 0, "blend_only_hits": 0, "both_hits": 0, "both_miss": 0,
           "missed_near_threshold": 0, "missed_displaced": 0, "missed_absent": 0}
    rank_pct = []
    for d in dates:
        i = pdates.index(d)
        sl = slice(off[i], off[i + 1])
        rows, y = z["row_index"][sl], z["labels"][sl].astype(bool)
        issue = date.fromisoformat(d)
        path, meta = B.fetch_file(issue, nc_name(issue), a.cache)
        if path is None or meta.get("sha256") != pins[d]["sha256"]:
            raise ValueError(f"{d}: NadoCast file missing or differs from the committed roster pin")
        g, glat, glon = B.decode(path, "24-47", short="windprob")
        if nn is None:
            nn = cKDTree(B.unit(glon, glat)).query(B.unit(coords[:, 0], coords[:, 1]))[1]
        pn, pb = g[nn[rows]], z["hrrr_rrfs"][sl]
        fn, fb = pn >= tm["nadocast"], pb > tm["hrrr_rrfs"]
        xyz = B.unit(coords[rows, 0], coords[rows, 1])
        miss = y & fn & ~fb
        cls = {"near_threshold": 0, "displaced": 0, "absent": 0}
        if miss.any():
            near = pb[miss] >= NEAR_FRAC * tm["hrrr_rrfs"]
            if fb.any():
                dist = cKDTree(xyz[fb]).query(xyz[miss])[0]
                km = 2 * B.EARTH_KM * np.arcsin(np.minimum(dist / 2, 1))
            else:
                km = np.full(int(miss.sum()), np.inf)
            cls["near_threshold"] = int(near.sum())
            cls["displaced"] = int((~near & (km <= NEAR_KM)).sum())
            cls["absent"] = int((~near & (km > NEAR_KM)).sum())
            order = np.argsort(np.argsort(pb))  # rank of every point that day
            rank_pct += (100 * order[miss] / max(len(pb) - 1, 1)).tolist()
        rec = {"date": d, "report_points": int(y.sum()),
               "hits": {"nadocast": int((y & fn).sum()), "hrrr_rrfs": int((y & fb).sum())},
               "false_alarm_points": {"nadocast": int((~y & fn).sum()), "hrrr_rrfs": int((~y & fb).sum())},
               "nadocast_only_hits": int(miss.sum()), "blend_only_hits": int((y & fb & ~fn).sum()), "missed_by_blend": cls}
        rec["gap_points"] = rec["hits"]["nadocast"] - rec["hits"]["hrrr_rrfs"]
        rec["false_alarm_ratio_blend_to_nadocast"] = (rec["false_alarm_points"]["hrrr_rrfs"] / rec["false_alarm_points"]["nadocast"]
                                                       if rec["false_alarm_points"]["nadocast"] else None)
        per.append(rec)
        maps[d] = (coords[rows], y, pn, pb)
        tot["nadocast_only_hits"] += rec["nadocast_only_hits"]; tot["blend_only_hits"] += rec["blend_only_hits"]
        tot["both_hits"] += int((y & fn & fb).sum()); tot["both_miss"] += int((y & ~fn & ~fb).sum())
        for k, v in cls.items():
            tot[f"missed_{k}"] += v
        print(d, rec["gap_points"], cls, flush=True)
    per.sort(key=lambda r: -r["gap_points"])
    gap = sum(r["gap_points"] for r in per)
    top = [r["date"] for r in per[:MAP_TOP] if r["gap_points"] > 0]
    best = [r["date"] for r in per[::-1][:1] if r["gap_points"] < 0]
    fa_gap = {"dates_blend_flags_more_area": sum(1 for r in per if (r["false_alarm_ratio_blend_to_nadocast"] or 0) > 1),
              "dates_with_nadocast_area": sum(1 for r in per if r["false_alarm_ratio_blend_to_nadocast"] is not None)}
    out = {"rules": "research/severe/conus-v1/rrfs/retro/DIAG-MAY.md", "thresholds_equal_area_may": tm, "dates": len(per),
           "total_gap_points": gap, "totals": tot, "share_of_gap_from_top_dates": {
               f"top_{k}": (sum(r["gap_points"] for r in per[:k]) / gap if gap else None) for k in (1, 3, 5)},
           "missed_point_blend_rank_percentile": {"median": float(np.median(rank_pct)) if rank_pct else None,
                                                   "p10": float(np.percentile(rank_pct, 10)) if rank_pct else None,
                                                   "p90": float(np.percentile(rank_pct, 90)) if rank_pct else None},
           "area_spread": fa_gap, "per_date": per, "mapped": {"largest_gaps": top, "blend_best": best}}
    outd = Path(a.output)
    outd.mkdir(parents=True, exist_ok=True)
    (outd / "may-diagnosis.json").write_text(json.dumps(out, indent=1) + "\n")
    draw_maps(outd, maps, top + best, tm, {r["date"]: r for r in per})
    print(json.dumps({k: out[k] for k in ("total_gap_points", "totals", "share_of_gap_from_top_dates", "missed_point_blend_rank_percentile", "area_spread", "mapped")}, indent=1))


def draw_maps(outd, maps, dates, tm, per):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    for d in dates:
        xy, y, pn, pb = maps[d]
        fig, ax = plt.subplots(1, 3, figsize=(18, 5.2), constrained_layout=True)
        for k, (p, t, name) in enumerate(((pn, tm["nadocast"], "NadoCast"), (pb, tm["hrrr_rrfs"], "HRRR + 12Z RRFS"))):
            sc = ax[k].scatter(xy[:, 0], xy[:, 1], c=p, s=4, cmap="viridis", vmin=0, vmax=0.3)
            f = p >= t if name == "NadoCast" else p > t
            ax[k].scatter(xy[f, 0], xy[f, 1], s=4, facecolors="none", edgecolors="orange", linewidths=0.4)
            ax[k].scatter(xy[y, 0], xy[y, 1], s=3, c="red")
            ax[k].set_title(f"{name}: flagged (orange) at {t:.1%}; reports (red)")
            fig.colorbar(sc, ax=ax[k], shrink=0.7, label="probability")
        r = per[d]
        cls = r["missed_by_blend"]
        ax[2].axis("off")
        ax[2].text(0, 0.95, f"Issue {d} (valid 12Z D+1 to 12Z D+2)\n\nReport points: {r['report_points']}\n"
                   f"Hits: NadoCast {r['hits']['nadocast']}, blend {r['hits']['hrrr_rrfs']} (gap {r['gap_points']:+d})\n"
                   f"False-alarm points: NadoCast {r['false_alarm_points']['nadocast']}, blend {r['false_alarm_points']['hrrr_rrfs']}\n\n"
                   f"Caught by NadoCast only: {r['nadocast_only_hits']}\n"
                   f"   blend ranked a little low (p >= {NEAR_FRAC:.0%} of threshold): {cls['near_threshold']}\n"
                   f"   blend flagged nearby (<= {NEAR_KM:.0f} km): {cls['displaced']}\n"
                   f"   blend flagged nothing nearby: {cls['absent']}\n"
                   f"Caught by blend only: {r['blend_only_hits']}", va="top", family="monospace", fontsize=10)
        for k in (0, 1):
            ax[k].set_xlim(-125, -66); ax[k].set_ylim(24, 50)
        fig.savefig(outd / f"may-map-{d}.png", dpi=90)
        plt.close(fig)


def draw_smooth_maps(outd, map_dates, dates, Y, Pm, keep_rows, coords, thr):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    outd.mkdir(parents=True, exist_ok=True)
    for d in map_dates:
        j = dates.index(d)
        xy, y = coords[keep_rows[d]], Y[j].astype(bool)
        fig, ax = plt.subplots(1, 3, figsize=(19, 5), constrained_layout=True)
        for k, (arm, name) in enumerate((("nadocast", "NadoCast"), ("hrrr_rrfs", "HRRR + 12Z RRFS"), ("hrrr_rrfs_smooth", "HRRR + 12Z RRFS, smoothed"))):
            p, t = Pm[arm][j], thr[arm]
            f = p >= t if arm == "nadocast" else p > t
            sc = ax[k].scatter(xy[:, 0], xy[:, 1], c=p, s=4, cmap="viridis", vmin=0, vmax=0.3)
            ax[k].scatter(xy[f, 0], xy[f, 1], s=4, facecolors="none", edgecolors="orange", linewidths=0.4)
            ax[k].scatter(xy[y, 0], xy[y, 1], s=3, c="red")
            ax[k].set_title(f"{name}: {int((f & y).sum())} of {int(y.sum())} report pts, {int((f & ~y).sum())} false-alarm pts (flag {t:.1%})", fontsize=9)
            ax[k].set_xlim(-125, -66); ax[k].set_ylim(24, 50)
        fig.colorbar(sc, ax=ax, shrink=0.7, label="probability")
        fig.suptitle(f"Issue {d}: May equal-area thresholds; flagged = orange, reports = red")
        fig.savefig(outd / f"smooth-map-{d}.png", dpi=90)
        plt.close(fig)


def render(c):
    L = [f"# NadoCast vs HRRR + 12Z RRFS (retrospective pilot, Day 2 damaging wind)", "",
         f"Matched dates: {c['matched_dates']}; excluded: {len(c['excluded'])}. Rules: `{c['rules']}`.", "",
         "Hit changes are points of report coverage with whole-date 95% intervals. Equal area = each model's held-out threshold set to "
         "NadoCast's 5% false-alarm area in that scope (diagnostic).", "",
         "| Scope | Region | Dates / report days | Hits at NadoCast 5% area: NadoCast / HRRR / HRRR+RRFS | HRRR+RRFS − NadoCast, equal area | "
         "HRRR+RRFS − NadoCast, training-set threshold (FA km²/day: NadoCast 5% → HRRR+RRFS) | Brier HRRR+RRFS − NadoCast |", "|---|---|---|---|---|---|---|"]
    for sc, by in c["results"].items():
        for region, r in by.items():
            if "paired" not in r:
                L.append(f"| {sc} | {region} | {r['dates']} / {r['report_days']} | unscorable (no events) | | | |")
                continue
            A, v = r["arms"], r["paired"]["hrrr_rrfs_minus_nadocast"]
            e, t, b = v["equal_area_hit_fraction"], v["training_threshold_hit_fraction"], v["brier"]
            L.append(f"| {sc} | {region} | {r['dates']} / {r['report_days']} | "
                     f"{100*A['nadocast']['equal_area_vs_nadocast_5pct']['hit_fraction']:.1f}% / {100*A['hrrr']['equal_area_vs_nadocast_5pct']['hit_fraction']:.1f}% / "
                     f"{100*A['hrrr_rrfs']['equal_area_vs_nadocast_5pct']['hit_fraction']:.1f}% | {100*e['estimate']:+.1f} [{100*e['ci95'][0]:+.1f}, {100*e['ci95'][1]:+.1f}] | "
                     f"{100*t['estimate']:+.1f} [{100*t['ci95'][0]:+.1f}, {100*t['ci95'][1]:+.1f}] "
                     f"({A['nadocast']['training_set_threshold']['false_alarm_km2_per_day']:,.0f} → {A['hrrr_rrfs']['training_set_threshold']['false_alarm_km2_per_day']:,.0f}) | "
                     f"{b['estimate']:+.6f} [{b['ci95'][0]:+.6f}, {b['ci95'][1]:+.6f}] |")
    L.append("")
    if any("smoothing_recovery_equal_area" in r for by in c["results"].values() for r in by.values()):
        L += ["## Smoothed minus unsmoothed blend", "", "| Scope | Region | Hits at NadoCast 5% area | Recovered / lost report points | NadoCast-only points now caught | "
              "Hits at training-set threshold (FA km²/day before → after) | Brier |", "|---|---|---|---|---|---|---|"]
        for sc, by in c["results"].items():
            for region, r in by.items():
                if "smoothing_recovery_equal_area" not in r:
                    continue
                v, q, A = r["paired"]["hrrr_rrfs_smooth_minus_hrrr_rrfs"], r["smoothing_recovery_equal_area"], r["arms"]
                e, t, b = v["equal_area_hit_fraction"], v["training_threshold_hit_fraction"], v["brier"]
                L.append(f"| {sc} | {region} | {100*e['estimate']:+.1f} [{100*e['ci95'][0]:+.1f}, {100*e['ci95'][1]:+.1f}] | {q['recovered']} / {q['lost']} | "
                         f"{q['of_which_caught_after_smoothing']} of {q['nadocast_only_for_blend']} | {100*t['estimate']:+.1f} [{100*t['ci95'][0]:+.1f}, {100*t['ci95'][1]:+.1f}] "
                         f"({A['hrrr_rrfs']['training_set_threshold']['false_alarm_km2_per_day']:,.0f} → {A['hrrr_rrfs_smooth']['training_set_threshold']['false_alarm_km2_per_day']:,.0f}) | "
                         f"{b['estimate']:+.6f} [{b['ci95'][0]:+.6f}, {b['ci95'][1]:+.6f}] |")
        L.append("")
    for sc, by in c["results"].items():
        for region, r in by.items():
            if "arms" not in r or not r["arms"]:
                continue
            L.append(f"- {sc} / {region}: Brier " + ", ".join(f"{k} {m['brier']:.5f}" for k, m in r["arms"].items()) +
                     "; forecast/observed " + ", ".join(f"{k} {m['forecast_to_observed_ratio']:.2f}" for k, m in r["arms"].items()))
    return "\n".join(L)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("inventory")
    i.add_argument("--cache", type=Path, required=True)
    i.add_argument("--output", required=True)
    c = sub.add_parser("compare")
    for k in ("--roster", "--predictions", "--thresholds", "--fingerprint-check", "--output"):
        c.add_argument(k, required=True)
    c.add_argument("--map-dates", nargs="*", default=None)
    c.add_argument("--cache", type=Path, required=True)
    g = sub.add_parser("diagnose")
    for k in ("--roster", "--predictions", "--scorecard", "--output"):
        g.add_argument(k, required=True)
    g.add_argument("--cache", type=Path, required=True)
    a = p.parse_args()
    {"inventory": inventory, "compare": compare, "diagnose": diagnose}[a.cmd](a)


if __name__ == "__main__":
    main()
