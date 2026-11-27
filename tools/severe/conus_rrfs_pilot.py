#!/usr/bin/env python3
"""Retrospective RRFS development pilot, first comparison (Day 2 damaging wind).

Rules: research/severe/conus-v1/rrfs/retro/RULES.md (committed before any score was computed).

  cache  per roster date: the existing (or newly extracted) HRRR Day 2 case + the retrospective RRFS extract ->
         <cache>/<date>.npz (HRRR raw predictors, RRFS raw predictors per cycle, wind labels, row index) with
         SHA-256 in <cache>/manifest.json. Every dropped date is logged with its reason.
  score  hold out each archive block in turn; fit HRRR-only, RRFS-only and HRRR+RRFS with the fixed regularized
         logistic recipe on the other blocks only; score identical held-out rows; write scorecard.json/.md.
Research only. 2025 is refused; nothing touches the live feed, publisher, registry, preview or collectors.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
BLOCKS = {"jul2023": ("2023-07",), "janfeb2024": ("2024-01", "2024-02"), "may2024": ("2024-05",)}
FIELDS = ("gust", "refc", "uh25", "uh03", "maxuvv", "wind10max", "cape_sfc", "srh01", "shear06")
STATS = ("nbhdmax24", "nbhdmax18", "mean24")
C_REG = 0.1           # inverse L2 strength on standardized predictors (fixed; not tuned)
FA_REF = 0.05         # HRRR-arm probability that defines the reference false-alarm area
BINS = (0, 0.005, 0.01, 0.02, 0.05, 0.10, 0.15, 0.30, 1.0)
BOOT, SEED = 2000, 20261127
FL = "florida_gulf_south"
SAMPLE_KM2 = 225.0


def sha(b):
    return hashlib.sha256(b).hexdigest()


def block_of(date):
    return next((k for k, v in BLOCKS.items() if date.startswith(v)), None)


def rrfs_names(cyc):
    return [f"c{cyc:02d}_{f}_{s}" for f in FIELDS for s in STATS]


# ---------------------------------------------------------------- cache
def cache(a):
    from conus_calibration import check_frozen
    fitted, gsha = check_frozen(ROOT / "research/severe/conus-v1/frozen/models.pkl", ROOT / "research/severe/conus-v1/frozen/manifest.json")
    keep, coords_ref = fitted["keep"], np.asarray(fitted["coords"])
    kidx = np.nonzero(keep)[0]
    roster = json.loads(Path(a.roster).read_text())["dates"]
    hrrr = {}
    for root in a.hrrr:
        for m in sorted(Path(root).glob("*/conus-case.json")):
            c = json.loads(m.read_text())["case"]
            hrrr.setdefault(c, []).append(m.parent)
    out = Path(a.output)
    out.mkdir(parents=True, exist_ok=True)
    rows, names_ref = [], None
    for d in roster:
        if d.startswith("2025") or block_of(d) is None:
            raise ValueError(f"{d}: not a pilot date")
        rec = {"date": d, "block": block_of(d)}
        try:
            if d not in hrrr:
                raise LookupError("no HRRR case")
            src = hrrr[d][0]
            meta = json.loads((src / "conus-case.json").read_text())
            raw = (src / meta["artifact"]["file"]).read_bytes()
            if sha(raw) != meta["artifact"]["sha256"]:
                raise ValueError("HRRR case artifact hash mismatch")
            w2 = next(w for w in meta["windows"] if w["day"] == 2)
            with np.load(io.BytesIO(raw), allow_pickle=False) as z:
                if not np.array_equal(z["coordinates"], coords_ref):
                    raise ValueError("HRRR grid differs")
                names = z["feature_names"].tolist()
                if names_ref is None:
                    names_ref = names
                if names != names_ref:
                    raise ValueError("HRRR predictor names differ")
                xh = z["features"][1][keep].astype(np.float32)
                y = z["labels"][1][keep][:, 1]
            r_arrays, cyc_status = {}, {}
            for cyc in (12, 6):
                mp = Path(a.rrfs) / d / f"rrfs-{cyc:02d}z.json"
                st = json.loads(mp.read_text()) if mp.exists() else {"status": "not_extracted"}
                cyc_status[f"{cyc:02d}z"] = st["status"] if st["status"] == "ok" else f"{st['status']}: {st.get('error', '')[:200]}"
                if st["status"] != "ok":
                    continue
                b = (mp.parent / st["artifact"]["file"]).read_bytes()
                if sha(b) != st["artifact"]["sha256"]:
                    raise ValueError(f"RRFS {cyc:02d}Z artifact hash mismatch")
                if st["valid_window"][0] != w2["valid_start"] or st["valid_window"][1] != w2["valid_end"]:
                    raise ValueError(f"RRFS {cyc:02d}Z valid window {st['valid_window']} != HRRR {w2['valid_start']}..{w2['valid_end']}")
                with np.load(io.BytesIO(b), allow_pickle=False) as z:
                    if not np.array_equal(z["sample_index"], kidx):
                        raise ValueError("RRFS sample rows differ")
                    r_arrays[f"rrfs{cyc:02d}"] = np.stack([z[n] for n in rrfs_names(cyc)], axis=1).astype(np.float32)
            if "rrfs12" not in r_arrays:
                raise LookupError(f"RRFS 12Z not usable ({cyc_status['12z']})")
            buf = io.BytesIO()
            np.savez_compressed(buf, hrrr=xh, labels=y, row_index=kidx.astype(np.int32), **r_arrays)
            data = buf.getvalue()
            (out / f"{d}.npz").write_bytes(data)
            rec |= {"status": "ok", "hrrr_source": str(src), "hrrr_case_sha256": meta["artifact"]["sha256"],
                    "report_source": meta["report_source"]["file"], "valid_window": [w2["valid_start"], w2["valid_end"]],
                    "rrfs": cyc_status, "known_label_rows": int((y != 255).sum()), "event_rows": int((y == 1).sum()),
                    "cache": {"file": f"{d}.npz", "sha256": sha(data), "bytes": len(data)}}
        except Exception as e:
            rec |= {"status": "dropped", "reason": repr(e)[:300]}
        rows.append(rec)
        print(d, rec["status"], rec.get("reason", ""), flush=True)
    man = {"version": "rrfs-retro-pilot-cache-v1", "frozen_grid_from_sha256": gsha, "hrrr_feature_names": names_ref,
           "rrfs_feature_names": {"12z": rrfs_names(12), "06z": rrfs_names(6)}, "rows": "supported CONUS samples (frozen keep mask)",
           "label": "Day 2 damaging wind (>= 50 kt within 25 miles, pinned final Storm Events); 255 = unknown magnitude, excluded",
           "dates": rows, "ok": sum(r["status"] == "ok" for r in rows), "dropped": sum(r["status"] != "ok" for r in rows)}
    (out / "manifest.json").write_text(json.dumps(man, indent=1) + "\n")
    print(json.dumps({k: man[k] for k in ("ok", "dropped")}))


# ---------------------------------------------------------------- score
def load_cache(root, cyc=12, dates=None):
    root = Path(root)
    man = json.loads((root / "manifest.json").read_text())
    use = [r for r in man["dates"] if r["status"] == "ok" and (dates is None or r["date"] in dates)]
    if cyc == 6:
        use = [r for r in use if r["rrfs"]["06z"] == "ok"]
    D = {}
    for r in use:
        b = (root / r["cache"]["file"]).read_bytes()
        if sha(b) != r["cache"]["sha256"]:
            raise ValueError(f"{r['date']}: cache hash mismatch")
        with np.load(io.BytesIO(b), allow_pickle=False) as z:
            y = z["labels"]
            k = y != 255
            D[r["date"]] = (z["hrrr"][k], z[f"rrfs{cyc:02d}"][k], y[k].astype(np.float64), z["row_index"][k])
    return man, D


def asinh_scales(x):
    a = np.abs(x)
    return np.array([np.median(c[c > 0]) if (c > 0).any() else 1.0 for c in a.T])


def design(arm, xh, xr, names, sc):
    import phase2_study as S
    parts = []
    if arm in ("hrrr", "hrrr_rrfs"):
        parts.append(S.engineer(xh, names, sc["hrrr"])[0])
    if arm in ("rrfs", "hrrr_rrfs"):
        parts.append(np.arcsinh(xr / sc["rrfs"]))
    return np.concatenate(parts, axis=1)


def fit_arm(arm, xh, xr, y, names):
    import phase2_study as S
    from sklearn.linear_model import LogisticRegression
    from sklearn.preprocessing import StandardScaler
    sc = {"hrrr": S.engineer(xh, names)[1], "rrfs": asinh_scales(xr)}
    X = design(arm, xh, xr, names, sc)
    st = StandardScaler().fit(X)
    lr = LogisticRegression(C=C_REG, max_iter=5000, tol=1e-7).fit(st.transform(X), y)
    return {"sc": sc, "st": st, "lr": lr}


def predict(model, arm, xh, xr, names):
    X = model["st"].transform(design(arm, xh, xr, names, model["sc"]))
    return model["lr"].predict_proba(X)[:, 1]


def fa_threshold(p, y, frac):
    """Smallest threshold whose no-report exceedance fraction is <= frac."""
    p0 = np.sort(p[y == 0])[::-1]
    k = int(np.floor(frac * len(p0)))
    return float(p0[k]) if k < len(p0) else -1.0


def run_comparison(D, names, arms=("hrrr", "rrfs", "hrrr_rrfs"), log=print):
    from conus_calibration import REGIONS, region_index
    from conus_calibration import check_frozen
    from conus_study import regions
    fitted, _ = check_frozen(ROOT / "research/severe/conus-v1/frozen/models.pkl", ROOT / "research/severe/conus-v1/frozen/manifest.json")
    reg_all = region_index(None, regions(np.asarray(fitted["coords"])), fitted["keep"])
    kidx = np.nonzero(fitted["keep"])[0]
    pos = np.full(int(kidx.max()) + 1, -1)
    pos[kidx] = np.arange(len(kidx))
    dates = sorted(D)
    P = {a: {} for a in arms}
    thr = {}
    folds = {}
    for blk in BLOCKS:
        test = [d for d in dates if block_of(d) == blk]
        train = [d for d in dates if block_of(d) != blk]
        if not test or not train:
            continue
        xh = np.concatenate([D[d][0] for d in train]); xr = np.concatenate([D[d][1] for d in train])
        y = np.concatenate([D[d][2] for d in train])
        thr[blk] = {}
        for arm in arms:
            m = fit_arm(arm, xh, xr, y, names)
            ptr = predict(m, arm, xh, xr, names)
            thr[blk][arm] = ptr
            for d in test:
                P[arm][d] = predict(m, arm, D[d][0], D[d][1], names).astype(np.float64)
            log(f"{blk}: {arm} fitted on {len(train)} dates ({int(y.sum())} event rows), iters {int(m['lr'].n_iter_[0])}")
        # deployable thresholds: each arm matches, on its own training predictions, the training false-alarm
        # fraction of the HRRR arm at FA_REF
        frac = float(((thr[blk]["hrrr"] >= FA_REF) & (y == 0)).sum() / (y == 0).sum())
        thr[blk] = {"train_fa_fraction_ref": frac, "thresholds": {arm: (FA_REF if arm == "hrrr" else fa_threshold(thr[blk][arm], y, frac)) for arm in arms}}
        folds[blk] = {"test_dates": test, "train_dates": len(train), "train_event_rows": int(y.sum()), "train_base_rate": float(y.mean()),
                      **thr[blk]}
        del xh, xr
    return P, folds, reg_all, pos


def summarize(D, P, folds, reg_all, pos, arms, names_regions):
    rng = np.random.default_rng(SEED)
    out = {}
    scopes = {"all_blocks": list(folds)} | {b: [b] for b in folds}
    for scope, blks in scopes.items():
        dates = sorted(d for b in blks for d in folds[b]["test_dates"])
        for region in ("national", FL):
            per = []  # per date: [n, events, sse_a..., sump_a..., hits_a, fa_a, eqhits_a]
            ys, ps, ds = [], {a: [] for a in arms}, []
            for d in dates:
                y = D[d][2]
                rsel = np.ones(len(y), bool) if region == "national" else reg_all[pos[D[d][3]]] == names_regions.index(FL)
                ys.append(y[rsel]); ds.append(np.full(rsel.sum(), len(ds)))
                for a in arms:
                    ps[a].append(P[a][d][rsel])
            y = np.concatenate(ys); dd = np.concatenate(ds)
            p = {a: np.concatenate(ps[a]) for a in arms}
            blk_of_row = np.array([block_of(dates[i]) for i in dd]) if len(dd) else np.array([])
            nd = len(dates)
            res = {"dates": nd, "rows": int(len(y)), "event_rows": int(y.sum()),
                   "report_days": int(len(np.unique(dd[y == 1]))), "base_rate": float(y.mean()) if len(y) else None, "arms": {}}
            if len(y) == 0 or y.sum() == 0:
                out.setdefault(scope, {})[region] = res
                continue
            # per-date sums for bootstrap
            def per_date(v):
                return np.bincount(dd, weights=v, minlength=nd)
            n_d = per_date(np.ones(len(y))); e_d = per_date(y)
            sse = {a: per_date((p[a] - y) ** 2) for a in arms}
            # deployable: training-selected thresholds (per block)
            hits_dep, fa_dep = {}, {}
            for a in arms:
                t = np.array([folds[b]["thresholds"][a] for b in blk_of_row])
                hits_dep[a] = per_date(((p[a] >= t) & (y == 1)).astype(float))
                fa_dep[a] = per_date(((p[a] >= t) & (y == 0)).astype(float))
            # diagnostic: held-out equal false-alarm area to the HRRR arm at FA_REF
            ref_fa = int(((p["hrrr"] >= FA_REF) & (y == 0)).sum())
            hits_eq = {}
            for a in arms:
                p0 = np.sort(p[a][y == 0])[::-1]
                t = float(p0[ref_fa]) if ref_fa < len(p0) else -1.0
                hits_eq[a] = (t, per_date(((p[a] > t) & (y == 1)).astype(float)), int((p0 > t).sum()))
            clim = folds_base(folds, blks)
            for a in arms:
                bs = sse[a].sum() / n_d.sum()
                rel = []
                for lo, hi in zip(BINS[:-1], BINS[1:]):
                    m = (p[a] >= lo) & (p[a] < hi)
                    if m.any():
                        rel.append({"bin": [lo, hi], "rows": int(m.sum()), "mean_forecast": float(p[a][m].mean()), "observed": float(y[m].mean())})
                res["arms"][a] = {
                    "brier": float(bs), "bss_vs_training_climatology": float(1 - bs / np.mean((clim - y) ** 2)),
                    "forecast_to_observed_ratio": float(p[a].sum() / y.sum()), "reliability": rel,
                    "deployable": {"hits": int(hits_dep[a].sum()), "hit_fraction": float(hits_dep[a].sum() / y.sum()),
                                   "false_alarm_points": int(fa_dep[a].sum()),
                                   "false_alarm_km2_per_day": float(fa_dep[a].sum() * SAMPLE_KM2 / nd)},
                    "diagnostic_equal_area": {"threshold": hits_eq[a][0], "hits": int(hits_eq[a][1].sum()),
                                              "hit_fraction": float(hits_eq[a][1].sum() / y.sum()), "false_alarm_points": hits_eq[a][2],
                                              "reference_false_alarm_points": ref_fa}}
            idx = rng.integers(0, nd, size=(BOOT, nd))
            diffs = {}
            for a, b in (("hrrr_rrfs", "hrrr"), ("rrfs", "hrrr"), ("hrrr_rrfs", "rrfs")):
                def ci(num_a, num_b, den):
                    pt = (num_a.sum() - num_b.sum()) / den.sum()
                    bt = (num_a[idx].sum(1) - num_b[idx].sum(1)) / den[idx].sum(1)
                    return {"estimate": float(pt), "ci95": [float(np.percentile(bt, 2.5)), float(np.percentile(bt, 97.5))]}
                diffs[f"{a}_minus_{b}"] = {
                    "brier": ci(sse[a], sse[b], n_d),
                    "deployable_hit_fraction": ci(hits_dep[a], hits_dep[b], e_d),
                    "deployable_false_alarm_km2_per_day": {"estimate": float((fa_dep[a].sum() - fa_dep[b].sum()) * SAMPLE_KM2 / nd)},
                    "diagnostic_equal_area_hit_fraction": ci(hits_eq[a][1], hits_eq[b][1], e_d)}
            res["paired"] = diffs
            out.setdefault(scope, {})[region] = res
    return out


def folds_base(folds, blks):
    return float(np.mean([folds[b]["train_base_rate"] for b in blks]))


def score(a):
    from conus_calibration import REGIONS
    man, D = load_cache(a.cache, cyc=a.cycle, dates=None)
    names = man["hrrr_feature_names"]
    log_lines = []
    def log(s):
        print(s, flush=True); log_lines.append(s)
    arms = ("hrrr", "rrfs", "hrrr_rrfs")
    P, folds, reg_all, pos = run_comparison(D, names, arms, log)
    res = summarize(D, P, folds, reg_all, pos, arms, list(REGIONS))
    dropped = [r for r in man["dates"] if r["status"] != "ok"]
    if a.cycle == 6:
        dropped += [{"date": r["date"], "status": "dropped", "reason": f"06Z {r['rrfs']['06z']}"} for r in man["dates"] if r["status"] == "ok" and r["rrfs"]["06z"] != "ok"]
    out = {"rules": "research/severe/conus-v1/rrfs/retro/RULES.md", "rrfs_cycle": f"{a.cycle:02d}z", "arms": list(arms),
           "recipe": {"model": "sklearn LogisticRegression (L2, lbfgs)", "C": C_REG, "scaling": "asinh(x / training median |x|) per source, then StandardScaler, fit on training blocks only",
                      "hrrr_predictors": "phase2_study.engineer on the cached HRRR raw predictors", "rrfs_predictors": f"{len(rrfs_names(a.cycle))} = 9 fields x (nbhdmax24, nbhdmax18, mean24)"},
           "folds": {b: {k: v for k, v in f.items()} for b, f in folds.items()}, "dropped_dates": dropped,
           "scored_dates": len(D), "results": res, "log": log_lines}
    Path(a.output).mkdir(parents=True, exist_ok=True)
    (Path(a.output) / "scorecard.json").write_text(json.dumps(out, indent=1) + "\n")
    (Path(a.output) / "scorecard.md").write_text(render(out) + "\n")
    print(render(out))


def pct(x):
    return f"{100 * x:.1f}%"


def render(o):
    R = o["results"]
    L = [f"# Retrospective RRFS pilot scorecard ({o['rrfs_cycle']} RRFS, Day 2 damaging wind)", "",
         f"Scored dates: {o['scored_dates']}; dropped: {len(o['dropped_dates'])}. Rules: `{o['rules']}`.", ""]
    for scope in ["all_blocks"] + [b for b in BLOCKS if b in R]:
        for region in ("national", FL):
            r = R[scope][region]
            L.append(f"## {scope} / {region}: {r['dates']} dates, {r['report_days']} report days, {r['event_rows']} event points")
            if "paired" not in r:
                L += ["Unscorable (no events).", ""]
                continue
            L.append("| Arm | Brier | BSS | Fcst/obs | Hits, training-set threshold | False alarm km²/day | Hits, equal area (diagnostic) |")
            L.append("|---|---|---|---|---|---|---|")
            for a, m in r["arms"].items():
                L.append(f"| {a} | {m['brier']:.5f} | {m['bss_vs_training_climatology']:.3f} | {m['forecast_to_observed_ratio']:.2f} | "
                         f"{pct(m['deployable']['hit_fraction'])} | {m['deployable']['false_alarm_km2_per_day']:,.0f} | {pct(m['diagnostic_equal_area']['hit_fraction'])} |")
            L.append("")
            for k, v in r["paired"].items():
                b = v["brier"]; h = v["deployable_hit_fraction"]; e = v["diagnostic_equal_area_hit_fraction"]
                L.append(f"- {k}: Brier {b['estimate']:+.6f} [{b['ci95'][0]:+.6f}, {b['ci95'][1]:+.6f}]; hits (training threshold) "
                         f"{100*h['estimate']:+.1f} pts [{100*h['ci95'][0]:+.1f}, {100*h['ci95'][1]:+.1f}]; equal-area hits {100*e['estimate']:+.1f} pts "
                         f"[{100*e['ci95'][0]:+.1f}, {100*e['ci95'][1]:+.1f}]")
            L.append("")
    return "\n".join(L)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("cache")
    c.add_argument("--roster", required=True)
    c.add_argument("--hrrr", nargs="+", required=True)
    c.add_argument("--rrfs", required=True)
    c.add_argument("--output", required=True)
    s = sub.add_parser("score")
    s.add_argument("--cache", required=True)
    s.add_argument("--cycle", type=int, default=12, choices=[12, 6])
    s.add_argument("--output", required=True)
    a = p.parse_args()
    {"cache": cache, "score": score}[a.cmd](a)


if __name__ == "__main__":
    main()
