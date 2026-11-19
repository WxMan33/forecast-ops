#!/usr/bin/env python3
"""Day 2 wind regional calibration test (criterion 7 of docs/severe-phase2-criteria.md).

  fit    recompute out-of-fold 2022-23 predictions for the frozen CONUS logistic and trees, prove
         they re-derive each frozen model's calibration, then fit a per-region monotone Platt map
         (p' = expit(c_r + d_r * logit p), d_r >= 0) on them. Only 2022-23 dates are loaded.
  score  apply the frozen models and the committed corrections, unchanged, to the 48 verification
         dates; primary scoring on the original labels, plus a separately reported tropical-event
         sensitivity analysis (HURDAT2 mask, same mask for every model).

Research only. Nothing touches the live feed or publisher. 2025 is refused.
"""
import argparse
import hashlib
import json
import pickle
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from scipy.special import expit, logit

import phase2_study as S
from conus_followup import SAMPLE_KM2, predict
from conus_study import geography, load, regions
from protocol import future_window
from train_daily import fit_logistic

PRODUCT, DAY, HAZ = "day2_wind", 2, 1
CANDIDATES = ("conus_logistic", "conus_gbt")
REGIONS = ("original_box", "west", "plains_outside_box", "florida_gulf_south", "northeast_outside_box")
FL = "florida_gulf_south"
EPS = 1e-6


def check_frozen(models, manifest):
    raw = Path(models).read_bytes()
    man = json.loads(Path(manifest).read_text())
    if man["status"] != "reproduced" or hashlib.sha256(raw).hexdigest() != man["sha256"]:
        raise ValueError("Models file does not match the committed frozen manifest")
    return pickle.loads(raw), man["sha256"]


def region_index(coords_kept, reg_all, keep):
    out = np.full(int(keep.sum()), -1)
    for i, r in enumerate(REGIONS):
        out[reg_all[r][keep]] = i
    assert (out >= 0).all()
    return out


def fit(a):
    fitted, sha = check_frozen(a.models, a.manifest)
    cases, X, Y, coords, names, _ = load(a.conus)
    keep = fitted["keep"]
    if not np.array_equal(coords, fitted["coords"]):
        raise ValueError("Grid differs from the frozen set")
    idx = [i for i, c in enumerate(cases) if c.startswith(("2022", "2023"))]
    if len(idx) != a.expected_fit_dates:
        raise ValueError(f"Expected {a.expected_fit_dates} development dates, found {len(idx)}")
    fit_cases = [cases[i] for i in idx]
    e, _ = S.engineer(X[idx, DAY - 1][:, keep], names, fitted["scales"][DAY])
    x, y, d, p = S.rows(e, Y[idx, DAY - 1][:, keep], HAZ)
    folds = np.array([S.fold_of(c) for c in fit_cases])[d]
    reg_idx = region_index(None, regions(coords), keep)[p]
    frozen = fitted["products"][PRODUCT]
    oof_logit, checks = {}, {}
    lr = frozen["conus_logistic"]
    raw = S.logistic_oof(x, y, folds, lr["penalty"])
    cal = fit_logistic(raw[:, None], y, penalty=0.0001, monotone=True)
    checks["conus_logistic"] = {"rederived": cal.tolist(), "frozen": [lr["calibration_intercept"], lr["calibration_slope"]]}
    oof_logit["conus_logistic"] = lr["calibration_intercept"] + lr["calibration_slope"] * raw
    from sklearn.ensemble import HistGradientBoostingClassifier
    raw = np.empty(len(y))
    for k in range(3):
        held = folds % 3 == k
        raw[held] = HistGradientBoostingClassifier(**S.GBT_PARAMS).fit(x[~held], y[~held]).decision_function(x[held])
    cal = fit_logistic(raw[:, None], y, penalty=0.0001, monotone=True)
    g = frozen["conus_gbt"]["calibration"]
    checks["conus_gbt"] = {"rederived": cal.tolist(), "frozen": list(g)}
    oof_logit["conus_gbt"] = g[0] + g[1] * raw
    worst = max(max(abs(u - v) for u, v in zip(c["rederived"], c["frozen"])) for c in checks.values())
    if worst > 1e-6:
        raise SystemExit(f"Out-of-fold predictions do not re-derive the frozen calibration (worst {worst:.2e})")
    corrections = {}
    for m in CANDIDATES:
        corrections[m] = {}
        for i, r in enumerate(REGIONS):
            s = reg_idx == i
            c, dd = fit_logistic(oof_logit[m][s][:, None], y[s], penalty=0.0001, monotone=True)
            pr = expit(oof_logit[m][s])
            corrections[m][r] = {"intercept": float(c), "slope": float(dd), "rows": int(s.sum()),
                                 "event_points": int(y[s].sum()), "event_dates": int(len(np.unique(d[s][y[s] == 1]))),
                                 "oof_mean_forecast": float(pr.mean()), "observed_rate": float(y[s].mean())}
    out = {"status": "fit_on_out_of_fold_2022_2023_only", "product": PRODUCT, "frozen_models_sha256": sha,
           "fit_dates": fit_cases, "calibration_rederivation": checks, "worst_rederivation_difference": worst,
           "corrections": corrections, "rule": "docs/severe-phase2-criteria.md section 7",
           "protected_2025_outcomes_accessed": False}
    a.output.mkdir(parents=True, exist_ok=True)
    (a.output / "corrections.json").write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps({m: {r: (round(v["intercept"], 3), round(v["slope"], 3), round(v["oof_mean_forecast"], 4),
                              round(v["observed_rate"], 4)) for r, v in c.items()} for m, c in corrections.items()}, indent=1))


def apply(p, corr, reg_idx):
    c = np.array([corr[r]["intercept"] for r in REGIONS])[reg_idx]
    d = np.array([corr[r]["slope"] for r in REGIONS])[reg_idx]
    return expit(c + d * logit(np.clip(p, EPS, 1 - EPS)))


# ---------------------------------------------------------------- tropical mask (sensitivity only)
def parse_hurdat(paths):
    tracks = []
    for path in paths:
        storm = None
        for line in Path(path).read_text().splitlines():
            f = [x.strip() for x in line.split(",")]
            if re.fullmatch(r"(AL|EP|CP)\d{6}", f[0]):
                storm = f[0]
                continue
            if storm is None or len(f) < 6 or not f[0].isdigit():
                continue
            t = datetime.strptime(f[0] + f[1].zfill(4), "%Y%m%d%H%M").replace(tzinfo=timezone.utc)
            lat = float(f[4][:-1]) * (1 if f[4][-1] == "N" else -1)
            lon = float(f[5][:-1]) * (-1 if f[5][-1] == "W" else 1)
            tracks.append((storm, t, f[3], lat, lon))
    return tracks


def track_points(tracks, start, end):
    """Hourly linear interpolation of tropical/subtropical fixes in [start - 6 h, end]."""
    out = []
    by = {}
    for s, t, st, la, lo in tracks:
        by.setdefault(s, []).append((t, st, la, lo))
    for s, fixes in by.items():
        fixes.sort()
        for (t0, s0, a0, o0), (t1, s1, a1, o1) in zip(fixes, fixes[1:]):
            if t1 < start - timedelta(hours=6) or t0 > end:
                continue
            hours = int((t1 - t0).total_seconds() // 3600)
            for h in range(hours + 1):
                t = t0 + timedelta(hours=h)
                st = s0 if h < hours / 2 else s1
                if start - timedelta(hours=6) <= t <= end and st in ("TD", "TS", "HU", "SD", "SS"):
                    w = h / hours if hours else 0
                    out.append((a0 + w * (a1 - a0), o0 + w * (o1 - o0)))
    return np.array(out).reshape(-1, 2)


def tropical_mask(cases, coords, tracks, radius_km=400.0):
    lat, lon = np.radians(coords[:, 1]), np.radians(coords[:, 0])
    masks, info = [], []
    for case in cases:
        w = future_window(case, DAY)
        pts = track_points(tracks, datetime.fromisoformat(w["valid_start"]), datetime.fromisoformat(w["valid_end"]))
        m = np.zeros(len(coords), bool)
        for pla, plo in pts:
            pla, plo = np.radians(pla), np.radians(plo)
            dist = 6371.0 * np.arccos(np.clip(np.sin(lat) * np.sin(pla) + np.cos(lat) * np.cos(pla) * np.cos(lon - plo), -1, 1))
            m |= dist <= radius_km
        masks.append(m)
        if m.any():
            info.append({"case": case, "masked_samples": int(m.sum())})
    return np.stack(masks), info


# ---------------------------------------------------------------- scoring
def boot_ratio(num_by_date, den_by_date, rng, n=5000):
    k = len(num_by_date)
    draws = rng.integers(0, k, size=(n, k))
    num, den = num_by_date[draws].sum(1), den_by_date[draws].sum(1)
    r = np.where(den > 0, num / np.where(den > 0, den, 1), np.nan)
    return [float(np.nanpercentile(r, 2.5)), float(np.nanpercentile(r, 97.5))]


def evaluate(y_grid, preds, reg_idx, cases, climatology, rng):
    """y_grid: (dates, samples) uint8 with 255 unknown; preds: {model: (dates, samples)}."""
    known = y_grid != 255
    d, s = np.nonzero(known)
    y = y_grid[known].astype(float)
    probs = {m: v[known] for m, v in preds.items()}
    out = {"national": S.block(y, probs, d, climatology, "wind"), "regions": {}, "paired": {}, "hits": {}}
    for m in CANDIDATES:
        pair = {"uncalibrated": probs[m], "calibrated": probs[m + "_cal"]}
        out["paired"][m] = {"national": S.bootstrap(y, pair, d, climatology, "uncalibrated", rng)["models"]["calibrated"]}
        for i, r in enumerate(REGIONS):
            sel = reg_idx[s] == i
            if sel.any() and len(np.unique(d[sel])) > 1:
                out["paired"][m][r] = S.bootstrap(y[sel], {k: v[sel] for k, v in pair.items()}, d[sel], climatology,
                                                  "uncalibrated", rng)["models"]["calibrated"]
    for i, r in enumerate(REGIONS):
        sel = reg_idx[s] == i
        b = S.block(y[sel], {k: v[sel] for k, v in probs.items()}, d[sel], climatology, "wind")
        for mm in b["models"].values():
            mm.pop("precision_recall"); mm.pop("reliability")
        out["regions"][r] = b
    # Florida/Gulf calibration ratio and no-report area
    fl = reg_idx == REGIONS.index(FL)
    yfl = np.where(known[:, fl], y_grid[:, fl], 0)
    kfl = known[:, fl]
    no_report = ~(yfl == 1).any(axis=1)
    obs_by_date = yfl.sum(1).astype(float)
    n_by_date = kfl.sum(1).astype(float)
    flr = {"dates": len(cases), "no_report_dates": int(no_report.sum()),
           "observed_rate": float(obs_by_date.sum() / n_by_date.sum()), "models": {}}
    for m, p in preds.items():
        pf = np.where(kfl, p[:, fl], 0)
        fsum = pf.sum(1)
        area = (np.where(kfl, p[:, fl], 0) >= 0.05).sum(1) * SAMPLE_KM2
        flr["models"][m] = {"mean_forecast": float(fsum.sum() / n_by_date.sum()),
                            "ratio_forecast_to_observed": float(fsum.sum() / obs_by_date.sum()) if obs_by_date.sum() else None,
                            "ratio_95": boot_ratio(fsum, obs_by_date, rng) if obs_by_date.sum() else None,
                            "no_report_area_ge5_km2_total": float(area[no_report].sum()),
                            "no_report_area_ge5_km2_mean_per_day": float(area[no_report].mean()) if no_report.any() else 0.0,
                            "_area_by_no_report_day": area[no_report]}
    for m in CANDIDATES:
        a0, a1 = flr["models"][m]["_area_by_no_report_day"], flr["models"][m + "_cal"]["_area_by_no_report_day"]
        flr["models"][m + "_cal"]["area_ratio_vs_uncalibrated"] = float(a1.sum() / a0.sum()) if a0.sum() else None
        flr["models"][m + "_cal"]["area_ratio_95"] = boot_ratio(a1, a0, rng) if a0.sum() else None
    for v in flr["models"].values():
        v.pop("_area_by_no_report_day")
    out["florida_gulf"] = flr
    # hits on days with qualifying reports
    for scope, mask in [("national", np.ones(y_grid.shape[1], bool))] + [(r, reg_idx == i) for i, r in enumerate(REGIONS)]:
        ev = (y_grid[:, mask] == 1)
        report_days = ev.any(axis=1)
        out["hits"][scope] = {"report_days": int(report_days.sum()), "event_points": int(ev[report_days].sum()), "models": {}}
        for m, p in preds.items():
            pm = p[:, mask][report_days]
            e = ev[report_days]
            out["hits"][scope]["models"][m] = {f"ge_{int(t * 100)}pct": int((e & (pm >= t)).sum()) for t in (0.05, 0.15, 0.30)}
    return out


def verdict(primary):
    res = {}
    fl = primary["florida_gulf"]
    for m in CANDIDATES:
        c = fl["models"][m + "_cal"]
        ratio = c["ratio_forecast_to_observed"]
        area = c["area_ratio_vs_uncalibrated"]
        nat_u = primary["national"]["models"][m]["brier"]
        nat_c = primary["national"]["models"][m + "_cal"]["brier"]
        tests = {"florida_ratio_within_factor_2": bool(ratio is not None and 0.5 <= ratio <= 2.0),
                 "florida_no_report_area_ge5_at_least_halved": bool(area is not None and area <= 0.5),
                 "national_brier_no_worse": bool(nat_c <= nat_u)}
        res[m] = {"pass": all(tests.values()), "tests": tests, "florida_ratio": ratio,
                  "florida_ratio_uncalibrated": fl["models"][m]["ratio_forecast_to_observed"],
                  "area_ratio": area, "national_brier": {"uncalibrated": nat_u, "calibrated": nat_c},
                  "national_brier_diff_95": primary["paired"][m]["national"]["brier_minus_reference_95"]}
    return res


def score(a):
    fitted, sha = check_frozen(a.models, a.manifest)
    corr_doc = json.loads(a.corrections.read_text())
    if corr_doc["frozen_models_sha256"] != sha:
        raise ValueError("Corrections were fit for a different frozen model set")
    baseline = json.loads(a.baseline.read_text())
    request = json.loads(a.request.read_text())
    cases, X, Y, coords, names, hashes = load(a.conus)
    if sorted(cases) != sorted(request["cases"]):
        print(f"::warning::missing cases: {sorted(set(request['cases']) - set(cases))}")
    if any(not c.startswith("2024") or int(c[8:]) not in (5, 12, 19, 26) for c in cases):
        raise ValueError("Only the 48 registered 2024 verification dates may be scored")
    if not np.array_equal(coords, fitted["coords"]):
        raise ValueError("Grid differs from the frozen set")
    keep = fitted["keep"]
    reg_idx = region_index(None, regions(coords), keep)
    raw = predict(fitted, baseline, X[:, DAY - 1][:, keep], DAY, PRODUCT)
    preds = dict(raw)
    for m in CANDIDATES:
        preds[m + "_cal"] = apply(raw[m], corr_doc["corrections"][m], reg_idx[None, :].repeat(len(cases), 0))
    y_grid = Y[:, DAY - 1][:, keep][..., HAZ]
    clim = json.loads(a.study_scorecard.read_text())["products"][PRODUCT]["all_supported"]["climatology_rate"]
    rng = np.random.default_rng(20261120)
    primary = evaluate(y_grid, preds, reg_idx, cases, clim, rng)
    tracks = parse_hurdat(a.hurdat) if a.hurdat else []
    tmask, tinfo = tropical_mask(cases, coords[keep], tracks)
    y_masked = np.where(tmask & (y_grid == 0), 255, y_grid).astype(np.uint8)
    sens = evaluate(y_masked, preds, reg_idx, cases, clim, np.random.default_rng(20261120))
    meta = {"status": "research_only_calibration_test", "product": PRODUCT, "dates": cases,
            "frozen_models_sha256": sha, "rule": "docs/severe-phase2-criteria.md section 7",
            "hurdat2_files": {Path(h).name: hashlib.sha256(Path(h).read_bytes()).hexdigest() for h in (a.hurdat or [])},
            "tropical_mask": {"radius_km": 400, "dates_affected": tinfo,
                              "no_report_samples_masked": int((tmask & (y_grid == 0)).sum()),
                              "report_samples_kept_positive": int((tmask & (y_grid == 1)).sum())},
            "protected_2025_outcomes_accessed": False, "artifact_sha256_by_case": hashes}
    result = {**meta, "verdict_primary": verdict(primary), "verdict_tropical_sensitivity": verdict(sens),
              "primary": primary, "tropical_sensitivity": sens}
    a.output.mkdir(parents=True, exist_ok=True)
    (a.output / "scorecard.json").write_text(json.dumps(result, indent=1, allow_nan=False, default=float) + "\n")
    write_report(a.output, result)
    draw(a.output, cases, coords[keep], y_grid, preds, reg_idx)


NAMES = {"v07_frozen": "v0.7 as-is", "conus_v07_recipe": "v0.7 refit", "conus_logistic": "logistic",
         "conus_logistic_cal": "logistic + regional cal", "conus_gbt": "trees", "conus_gbt_cal": "trees + regional cal"}


def f2(x):
    return "n/a" if x is None or (isinstance(x, float) and np.isnan(x)) else f"{x:.2f}"


def write_report(out, r):
    L = ["# Day 2 wind regional calibration test (research only)", "",
         f"48 unused 2024 dates (5th/12th/19th/26th). Frozen models sha256 {r['frozen_models_sha256'][:12]}; corrections fit "
         "only on out-of-fold 2022-23 predictions. Rule: docs/severe-phase2-criteria.md section 7. 2025 sealed.", ""]
    for label, key, vkey in (("Primary (original labels)", "primary", "verdict_primary"),
                             ("Tropical-event sensitivity (no-report samples within 400 km of a HURDAT2 track set to unknown)",
                              "tropical_sensitivity", "verdict_tropical_sensitivity")):
        p, v = r[key], r[vkey]
        fl = p["florida_gulf"]
        L += [f"## {label}", "", "| Candidate | Pass | FL forecast/observed (95%) | FL area >=5% on no-report days: calibrated/uncalibrated (95%) | National Brier uncal -> cal | Paired diff (95%) |",
              "|---|---|---|---|---|---|"]
        for m in CANDIDATES:
            x = v[m]; c = fl["models"][m + "_cal"]
            ci = c["ratio_95"] or [None, None]
            ai = c["area_ratio_95"] or [None, None]
            L.append(f"| {NAMES[m]} | **{'PASS' if x['pass'] else 'FAIL'}** | {f2(x['florida_ratio_uncalibrated'])} -> {f2(x['florida_ratio'])} ({f2(ci[0])}-{f2(ci[1])}) | "
                     f"{f2(x['area_ratio'])} ({f2(ai[0])}-{f2(ai[1])}) | {x['national_brier']['uncalibrated']:.6f} -> {x['national_brier']['calibrated']:.6f} | "
                     f"{x['national_brier_diff_95'][0]:+.1e} to {x['national_brier_diff_95'][1]:+.1e} |")
        L += ["", f"Florida/Gulf: {fl['no_report_dates']} of {fl['dates']} dates without a qualifying wind report; observed rate {fl['observed_rate']:.4f}.", "",
              "| Model | FL mean forecast | FL ratio | FL area >=5% per no-report day (km^2) | National BSS |", "|---|---|---|---|---|"]
        for m, e in fl["models"].items():
            L.append(f"| {NAMES[m]} | {e['mean_forecast']:.4f} | {f2(e['ratio_forecast_to_observed'])} | "
                     f"{e['no_report_area_ge5_km2_mean_per_day']:,.0f} | {p['national']['models'][m]['brier_skill_vs_climatology']:+.3f} |")
        L += ["", "Paired Brier change, calibrated minus uncalibrated (whole-date bootstrap 95%; negative = better):", "",
              "| Scope | Event dates | logistic | trees |", "|---|---|---|---|"]
        for scope in ["national"] + list(REGIONS):
            ed = p["national"]["event_dates"] if scope == "national" else p["regions"][scope]["event_dates"]
            cells = []
            for m in CANDIDATES:
                b = p["paired"][m].get(scope)
                cells.append(f"{b['brier_minus_reference_95'][0]:+.1e} to {b['brier_minus_reference_95'][1]:+.1e}" if b else "-")
            L.append(f"| {scope} | {ed} | " + " | ".join(cells) + " |")
        L += ["", "Hits on report days (event points with forecast at or above the threshold):", "",
              "| Scope | Report days / event points | Model | >=5% | >=15% | >=30% |", "|---|---|---|---|---|---|"]
        for scope in ("national", FL, "original_box", "west"):
            h = p["hits"][scope]
            for m in ("conus_logistic", "conus_logistic_cal", "conus_gbt", "conus_gbt_cal", "conus_v07_recipe"):
                e = h["models"][m]
                L.append(f"| {scope} | {h['report_days']} / {h['event_points']} | {NAMES[m]} | {e['ge_5pct']} | {e['ge_15pct']} | {e['ge_30pct']} |")
        L.append("")
    tm = r["tropical_mask"]
    L += ["## Tropical mask", "", f"HURDAT2 files: {', '.join(f'{k} ({v[:12]})' for k, v in r['hurdat2_files'].items()) or 'none'}. "
          f"No-report samples masked: {tm['no_report_samples_masked']:,}; qualifying reports kept positive inside the mask: {tm['report_samples_kept_positive']:,}. "
          f"Dates affected: {', '.join(x['case'] for x in tm['dates_affected']) or 'none'}."]
    (out / "scorecard.md").write_text("\n".join(L) + "\n")


def draw(out, cases, coords, y_grid, preds, reg_idx):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Patch
    from phase2_maps import CMAP, COLORS, LEVELS, NORM, draw_states, states
    rings = states()
    fl = reg_idx == REGIONS.index(FL)
    no_rep = [i for i in range(len(cases)) if not (y_grid[i, fl] == 1).any()]
    quiet = max(no_rep, key=lambda i: (preds["conus_gbt"][i, fl] >= 0.05).sum()) if no_rep else 0
    rep = [i for i in range(len(cases)) if (y_grid[i, fl] == 1).any()]
    active = max(rep or range(len(cases)), key=lambda i: (y_grid[i] == 1).sum())
    for kind, i in ([("florida-no-report", quiet)] if no_rep else []) + [("report-day", active)]:
        w = future_window(cases[i], DAY)
        fig, axes = plt.subplots(2, 2, figsize=(14, 9.2))
        for r, m in enumerate(CANDIDATES):
            for c, suffix in enumerate(("", "_cal")):
                ax = axes[r, c]
                p = preds[m + suffix][i]
                ax.scatter(coords[:, 0], coords[:, 1], c=p, cmap=CMAP, norm=NORM, s=1.4, marker="s", lw=0)
                hit = y_grid[i] == 1
                ax.scatter(coords[hit, 0], coords[hit, 1], s=1.2, c="#08306b", marker=".", lw=0)
                draw_states(ax, rings)
                ax.set_xlim(-126, -66); ax.set_ylim(24, 50); ax.set_aspect(1 / np.cos(np.radians(37)))
                ax.set_xticks([]); ax.set_yticks([])
                flarea = int((p[fl] >= 0.05).sum() * SAMPLE_KM2)
                ax.set_title(f"{NAMES[m + suffix]}: FL/Gulf area >=5% {flarea:,} km^2; {int(hit.sum())} report points", fontsize=9)
        fig.suptitle(f"Day 2 wind before/after regional calibration ({kind}): 12Z HRRR of {cases[i]}\n"
                     f"valid {w['valid_start'][:16]}Z to {w['valid_end'][:16]}Z. Probability of a qualifying "
                     "thunderstorm-wind report (>= 50 kt) within 25 miles. Dark dots = observed. Research only.", fontsize=10)
        fig.legend(handles=[Patch(color=col, label=f"{lo:.0%}-{hi:.0%}") for col, lo, hi in zip(COLORS, LEVELS, LEVELS[1:])],
                   loc="lower center", ncol=7, fontsize=8, frameon=False)
        fig.tight_layout(rect=(0, 0.03, 1, 0.92))
        fig.savefig(out / f"calibration-{kind}-{cases[i]}-day2-wind.png", dpi=105)
        plt.close(fig)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("fit", "score"):
        s = sub.add_parser(name)
        s.add_argument("--models", type=Path, default=Path("research/severe/conus-v1/frozen/models.pkl"))
        s.add_argument("--manifest", type=Path, default=Path("research/severe/conus-v1/frozen/manifest.json"))
        s.add_argument("--conus", type=Path, required=True)
        s.add_argument("--output", type=Path, required=True)
    sub.choices["fit"].add_argument("--expected-fit-dates", type=int, default=96)
    sc = sub.choices["score"]
    sc.add_argument("--corrections", type=Path, default=Path("research/severe/conus-v1/calibration-fit/corrections.json"))
    sc.add_argument("--request", type=Path, default=Path("research/severe/conus-v1/calibration-cases.json"))
    sc.add_argument("--hurdat", type=Path, nargs="*")
    sc.add_argument("--baseline", type=Path, default=Path("research/severe/baseline-v07/models.json"))
    sc.add_argument("--study-scorecard", type=Path, default=Path("research/severe/conus-v1/study/scorecard.json"))
    a = p.parse_args()
    fit(a) if a.cmd == "fit" else score(a)


if __name__ == "__main__":
    main()
