#!/usr/bin/env python3
"""NadoCast head-to-head, Day 2 severe wind (rules: research/severe/nadocast/day2-wind-rules.json).

Models: live v0.7 (regional box only), the frozen CONUS v0.7 refit, the frozen logistic and boosted-
tree candidates, and NadoCast (2022 models, absolutely calibrated, 12Z f24-47 of the same issue
date). Reuses the Day 1 benchmark's NadoCast fetch/decode and the existing CONUS extraction
artifacts (Day 2 features and labels). 2024 only; Day 2 windows reaching 2025 are refused.
"""
import argparse
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

import nadocast_benchmark as B
from conus_calibration import check_frozen
from conus_followup import SAMPLE_KM2, predict
from conus_study import regions
from extract import digest

RULES = Path("research/severe/nadocast/day2-wind-rules.json")
SEED = 20261122
THRESHOLDS = (0.05, 0.15)
BINS = (0, 0.005, 0.01, 0.02, 0.05, 0.10, 0.15, 0.30, 0.45, 1.0)
NATIONAL = ("conus_v07_recipe", "conus_logistic", "conus_gbt", "nadocast")
REGIONAL = ("live_v07",) + NATIONAL
NC_VARIANTS = {"nadocast": ("wind", True), "nadocast_spc_calibrated": ("wind", False),
               "nadocast_wind_adj": ("wind_adj", True)}
LABEL = {"live_v07": "Live v0.7 (box only)", "conus_v07_recipe": "CONUS v0.7 refit (frozen)",
         "conus_logistic": "Logistic candidate (frozen)", "conus_gbt": "Boosted-tree candidate (frozen)",
         "nadocast": "NadoCast 2022, abs. calibrated"}


def nc_file(issue, v):
    haz, abs_ = NC_VARIANTS[v]
    return f"nadocast_2022_models_conus_{haz}{'_abs_calib' if abs_ else ''}_{issue:%Y%m%d}_t12z_f24-47.grib2"


def load_case(root, case, coords_ref):
    meta = json.loads((Path(root) / case / "conus-case.json").read_text())
    path = Path(root) / case / meta["artifact"]["file"]
    if meta["case"] != case or digest(path) != meta["artifact"]["sha256"]:
        raise ValueError(f"{case}: artifact hash mismatch")
    with np.load(path, allow_pickle=False) as d:
        if coords_ref is not None and not np.array_equal(d["coordinates"], coords_ref):
            raise ValueError(f"{case}: grid differs")
        return d["coordinates"], d["feature_names"].tolist(), d["features"][1], d["labels"][1][:, 1]


# ---------------------------------------------------------------- metrics
def equal_area_hits(p, y, ref_count):
    """Hits when the model's threshold allows at most ref_count no-report points (strictly above t*)."""
    p0 = np.sort(p[y == 0])[::-1]
    if ref_count <= 0:
        t = float(p0[0]) if len(p0) else 1.0
    elif ref_count >= len(p0):
        t = -1.0
    else:
        t = float(p0[ref_count])
    return {"threshold": t, "hits": int((p[y == 1] > t).sum()), "false_alarm_points": int((p0 > t).sum())}


def score(y, P, d, ndays, rng, ref="nadocast", also_ref=None):
    base = float(y.mean())
    out = {"points": int(len(y)), "report_points": int(y.sum()), "report_days": int(len(np.unique(d[y == 1]))),
           "dates": int(ndays), "base_rate": base, "models": {}}
    if len(y) == 0:
        return out
    from sklearn.metrics import roc_auc_score
    n_by = np.bincount(d, minlength=ndays).astype(float)
    rep_day = np.zeros(ndays, bool)
    rep_day[np.unique(d[y == 1])] = True
    se = {k: np.bincount(d, weights=(p - y) ** 2, minlength=ndays) for k, p in P.items()}
    refb = float(np.mean((base - y) ** 2))
    nc_fa = {t: int(((y == 0) & (P[ref] >= t)).sum()) for t in THRESHOLDS} if ref in P else {}
    for k, p in P.items():
        b = float(np.mean((p - y) ** 2))
        rel = []
        for lo, hi in zip(BINS, BINS[1:]):
            s = (p >= lo) & ((p < hi) if hi < 1 else True)
            rel.append({"bin": [lo, hi], "n": int(s.sum()), "mean_forecast": float(p[s].mean()) if s.any() else None,
                        "observed": float(y[s].mean()) if s.any() else None})
        th = {}
        for t in THRESHOLDS:
            hit, fa = (y == 1) & (p >= t), (y == 0) & (p >= t)
            caught = np.zeros(ndays, bool)
            caught[np.unique(d[hit])] = True
            th[f"{t:.0%}"] = {"hits": int(hit.sum()), "misses": int(((y == 1) & (p < t)).sum()),
                              "pod": float(hit.sum() / max(y.sum(), 1)),
                              "false_alarm_km2_per_day": float(fa.sum() * SAMPLE_KM2 / ndays),
                              "report_days_caught": int((caught & rep_day).sum())}
        m = {"brier": b, "brier_skill_vs_base_rate": float(1 - b / refb) if refb else None,
             "roc_auc": float(roc_auc_score(y, p)) if 0 < y.sum() < len(y) else None,
             "mean_forecast": float(p.mean()), "reliability": rel, "thresholds": th}
        if nc_fa:
            m["hits_at_nadocast_false_alarm_area"] = {
                f"{t:.0%}": {**equal_area_hits(p, y, nc_fa[t]), "nadocast_false_alarm_km2_per_day": nc_fa[t] * SAMPLE_KM2 / ndays}
                for t in THRESHOLDS}
        for r in [ref] + ([also_ref] if also_ref else []):
            if r in P and k != r:
                m[f"brier_minus_{r}"] = b - float(np.mean((P[r] - y) ** 2))
                m[f"brier_minus_{r}_95"] = B.boot_diff(se[k], se[r], n_by, rng)  # paired: same resampled dates
        out["models"][k] = m
    out["observed_rate"] = base
    return out


# ---------------------------------------------------------------- run
def run(a):
    rules = json.loads(RULES.read_text())
    fresh = rules["dates"]["primary_fresh_2024_issue_dates"]
    expl = rules["dates"]["exploratory_previously_inspected_issue_dates"]
    dates = rules["pilot"]["dates"] if a.stage == "pilot" else fresh + expl
    if any(not x.startswith("2024") or x > "2024-12-29" for x in dates):
        raise ValueError("Issue dates must be 2024 with the Day 2 window inside 2024 (2025 sealed)")
    fitted, sha = check_frozen(a.models, a.manifest)
    baseline = json.loads(Path(B.BASELINE).read_text())
    keep = fitted["keep"]
    coords = None
    rows = {k: [] for k in ("y", "d", "pt")}
    P = {k: [] for k in REGIONAL + ("nadocast_spc_calibrated", "nadocast_wind_adj")}
    meta_all, dropped, scored, missing = {}, {}, [], []
    foot = nn = km = None
    for case in dates:
        if not (Path(a.conus) / case / "conus-case.json").exists():
            missing.append(case)
            continue
        c_coords, names, X2, Y2 = load_case(a.conus, case, coords)
        if coords is None:
            coords = c_coords
            if not np.array_equal(coords, fitted["coords"]) or names != fitted["names"]:
                raise ValueError("Grid or predictor names differ from the frozen models")
            reg = regions(coords)
        issue = date.fromisoformat(case)
        cutoff = datetime(issue.year, issue.month, issue.day, 18, tzinfo=timezone.utc)
        vals = {}
        for v in NC_VARIANTS:
            path, meta = B.fetch_file(issue, nc_file(issue, v), a.cache)
            meta_all.setdefault(case, {})[v] = meta
            lm = meta.get("last_modified")
            if path is None or not lm or datetime.fromisoformat(lm) > cutoff:
                meta["excluded"] = "missing" if path is None else f"Last-Modified {lm} after 18Z cutoff"
                continue
            g, glat, glon = B.decode(path, "24-47", short="windprob")
            if nn is None:
                tree = cKDTree(B.unit(glon, glat))
                dist, nn_all = tree.query(B.unit(coords[:, 0], coords[:, 1]))
                km = 2 * B.EARTH_KM * np.arcsin(np.minimum(dist / 2, 1))
                foot = keep & (km <= B.MAX_KM)
                fi = np.where(foot)[0]
                nn = nn_all[fi]
                grid_ref = (glat, glon)
            elif not (np.array_equal(glat, grid_ref[0]) and np.array_equal(glon, grid_ref[1])):
                raise ValueError(f"{case} {v}: NadoCast grid changed")
            vals[v] = g[nn]
        if "nadocast" not in vals:
            dropped[case] = meta_all[case]["nadocast"].get("excluded", "primary missing")
            continue
        j = len(scored)
        scored.append(case)
        lab = Y2[fi]
        known = lab != 255
        preds = predict(fitted, baseline, X2[None][:, keep], 2, "day2_wind")
        pos = np.searchsorted(np.where(keep)[0], fi)  # footprint indices inside the kept set
        rows["y"].append(lab[known].astype(np.float32))
        rows["d"].append(np.full(int(known.sum()), j, np.int32))
        rows["pt"].append(np.where(known)[0].astype(np.int32))
        P["live_v07"].append(preds["v07_frozen"][0][pos][known])
        for k in ("conus_v07_recipe", "conus_logistic", "conus_gbt"):
            P[k].append(preds[k][0][pos][known])
        for v in NC_VARIANTS:
            P[v].append(vals[v][known] if v in vals else np.full(int(known.sum()), np.nan))
        print(case, {v: (m.get("status"), m.get("last_modified")) for v, m in meta_all[case].items()}, flush=True)
    y = np.concatenate(rows["y"]).astype(float)
    d = np.concatenate(rows["d"])
    pt = np.concatenate(rows["pt"])
    P = {k: np.concatenate(v).astype(float) for k, v in P.items()}
    xy = coords[fi]
    reg_pt = {r: m[fi] for r, m in reg.items()}
    rng = np.random.default_rng(SEED)
    fresh_set = set(fresh)

    def block(sel_dates):
        s = np.isin(d, [scored.index(c) for c in sel_dates])
        dd = np.unique(d[s], return_inverse=True)[1]
        nd = len(sel_dates)
        box = s & reg_pt["original_box"][pt]
        db = np.unique(d[box], return_inverse=True)[1]
        out = {"regional_box_all_models": score(y[box], {k: P[k][box] for k in REGIONAL}, db, nd, rng, also_ref="live_v07"),
               "conus_national_models": score(y[s], {k: P[k][s] for k in NATIONAL}, dd, nd, rng), "conus_by_region": {}}
        for r in reg_pt:
            rs = s & reg_pt[r][pt]
            if rs.any():
                out["conus_by_region"][r] = score(y[rs], {k: P[k][rs] for k in NATIONAL},
                                                  np.unique(d[rs], return_inverse=True)[1], nd, rng)
        for v in ("nadocast_spc_calibrated", "nadocast_wind_adj"):
            ok = s & np.isfinite(P[v])
            if ok.any():
                out[f"reported_{v}"] = score(y[ok], {"nadocast": P["nadocast"][ok], v: P[v][ok], "conus_gbt": P["conus_gbt"][ok]},
                                             np.unique(d[ok], return_inverse=True)[1], len(np.unique(d[ok])), rng)
        return out

    sets = {"primary_fresh": [c for c in scored if c in fresh_set],
            "exploratory_previously_inspected": [c for c in scored if c not in fresh_set]}
    n_box_sup = int((keep & reg["original_box"]).sum())
    res = {"rules": str(RULES), "stage": a.stage, "frozen_models_sha256": sha, "requested_dates": len(dates),
           "scored_dates": len(scored), "missing_extraction": missing, "dropped": dropped,
           "footprint": {"conus_supported": int(keep.sum()), "conus_footprint": int(foot.sum()),
                         "conus_kept_fraction": float(foot.sum() / keep.sum()),
                         "box_supported": n_box_sup, "box_footprint": int((foot & reg["original_box"]).sum()),
                         "box_kept_fraction": float((foot & reg["original_box"]).sum() / n_box_sup),
                         "max_nearest_km": float(km[foot].max()), "median_nearest_km": float(np.median(km[foot])),
                         "unknown_label_points_dropped": int(sum(len(fi) for _ in scored) - len(y))},
           "nadocast_files": meta_all, "protected_2025_outcomes_accessed": False, "sealed_2021_accessed": False}
    for k, sel in sets.items():
        if sel:
            res[k] = block(sel)
    fin = all(np.isfinite(P[k]).all() for k in REGIONAL)
    checks = {"files_fetched_and_pinned": all(meta_all[c]["nadocast"].get("sha256") for c in scored) and bool(scored),
              "footprints_ge_95pct": res["footprint"]["conus_kept_fraction"] >= 0.95 and res["footprint"]["box_kept_fraction"] >= 0.95,
              "all_models_finite": bool(fin), "no_missing_extraction": not missing}
    res["checks"] = {**checks, "pass": all(checks.values())}
    a.output.mkdir(parents=True, exist_ok=True)
    if a.stage == "score":
        maps(a.output, scored, sets["primary_fresh"], xy, y, d, pt, P, reg_pt, res)
    (a.output / f"wind-{a.stage}-scorecard.json").write_text(json.dumps(res, indent=1, default=float) + "\n")
    print(json.dumps({"stage": a.stage, "scored": len(scored), "dropped": len(dropped), "checks": res["checks"]}))


def maps(out, scored, fresh_dates, xy, y, d, pt, P, reg_pt, res):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Patch
    from phase2_maps import CMAP, COLORS, LEVELS, NORM, draw_states, states
    rings = states()
    box_pt = reg_pt["original_box"]
    fi = [scored.index(c) for c in fresh_dates]
    rep = {j: int(y[d == j].sum()) for j in fi}
    active = max(fi, key=lambda j: rep[j])

    def nr_area(j):
        s = d == j
        stack = np.vstack([P[k][s] for k in NATIONAL])
        live = np.where(box_pt[pt[s]], P["live_v07"][s], np.nan)
        mean = np.nanmean(np.vstack([stack, live]), axis=0)
        return int(((mean >= 0.05) & (y[s] == 0)).sum())
    quiet = max(fi, key=nr_area)
    res["map_cases"] = {"active": scored[active], "quiet_or_false_alarm": scored[quiet]}
    for kind, j in (("active", active), ("quiet_or_false_alarm", quiet)):
        s = d == j
        xs = xy[pt[s]]
        ev = y[s] == 1
        fig, axes = plt.subplots(2, 3, figsize=(17, 8.6))
        for ax, k in zip(axes.ravel(), REGIONAL + ("reports",)):
            if k == "reports":
                ax.scatter(xs[:, 0], xs[:, 1], c="#f0f0f0", s=1.2, marker="s", lw=0)
                ax.scatter(xs[ev, 0], xs[ev, 1], c="#08306b", s=2, marker="s", lw=0)
                ax.set_title(f"Observed: {int(ev.sum())} points with a >=50 kt wind report within 25 mi", fontsize=8.5)
            else:
                pr = P[k][s]
                show = box_pt[pt[s]] if k == "live_v07" else np.ones(len(pr), bool)
                ax.scatter(xs[show, 0], xs[show, 1], c=pr[show], cmap=CMAP, norm=NORM, s=1.6, marker="s", lw=0)
                h5, h15 = int((ev & show & (pr >= 0.05)).sum()), int((ev & show & (pr >= 0.15)).sum())
                fa5 = int((~ev & show & (pr >= 0.05)).sum() * SAMPLE_KM2)
                ax.set_title(f"{LABEL[k]}: max {pr[show].max():.0%}\nhits >=5% {h5}, >=15% {h15} of {int((ev & show).sum())}; "
                             f"no-report area >=5% {fa5:,} km2", fontsize=8.5)
            draw_states(ax, rings)
            ax.plot([-100, -75, -75, -100, -100], [30, 30, 45, 45, 30], "k:", lw=0.7)
            ax.set_xlim(-126, -66); ax.set_ylim(24, 50); ax.set_aspect(1 / np.cos(np.radians(37)))
            ax.set_xticks([]); ax.set_yticks([])
        iss = date.fromisoformat(scored[j])
        fig.suptitle(f"Day 2 severe wind ({kind.replace('_', ' ')} case): issued from 12Z {iss}, valid convective day "
                     f"{iss + timedelta(days=1)} 12Z-12Z. Dotted = v0.7 regional box. "
                     "Research only; not an official outlook.", fontsize=10)
        fig.legend(handles=[Patch(color=c, label=f"{lo:.0%}-{hi:.0%}") for c, lo, hi in zip(COLORS, LEVELS, LEVELS[1:])],
                   loc="lower center", ncol=7, fontsize=8, frameon=False)
        fig.tight_layout(rect=(0, 0.04, 1, 0.95))
        fig.savefig(out / f"wind-map-{kind}-{scored[j]}.png", dpi=100)
        plt.close(fig)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--stage", choices=("pilot", "score"), required=True)
    p.add_argument("--conus", type=Path, required=True)
    p.add_argument("--cache", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--models", type=Path, default=Path("research/severe/conus-v1/frozen/models.pkl"))
    p.add_argument("--manifest", type=Path, default=Path("research/severe/conus-v1/frozen/manifest.json"))
    run(p.parse_args())


if __name__ == "__main__":
    main()
