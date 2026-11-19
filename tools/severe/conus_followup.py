#!/usr/bin/env python3
"""36-date CONUS follow-up with frozen models (criterion 6 of docs/severe-phase2-criteria.md).

  freeze-verify  prove a pickled model set reproduces a conus_study run's 12-date predictions,
                 then write its SHA-256 manifest (committed before any follow-up scoring)
  score          score the frozen models, unchanged, on the follow-up dates

Research only. Nothing is refit or tuned in `score`. 2025 is refused.
"""
import argparse
import hashlib
import json
import pickle
from pathlib import Path

import numpy as np
from scipy.special import expit

import phase2_study as S
from conus_study import HAZARDS, geography, load, regions
from extract import digest
from protocol import future_window

MODELS = ("v07_frozen", "conus_v07_recipe", "conus_logistic", "conus_gbt")
REF = "conus_v07_recipe"
CANDIDATES = ("conus_logistic", "conus_gbt")
SAMPLE_KM2 = 225.0  # 15 km x 15 km per stride-5 sample
THRESHOLDS = (0.05, 0.15, 0.30)
FA_REGIONS = ("florida_gulf_south", "west", "original_box", "plains_outside_box", "northeast_outside_box")


def predict(fitted, baseline, X, day, product):
    """X: (dates, kept samples, 34) raw predictors. Returns {model: (dates, kept samples)}."""
    names = fitted["names"]
    e, _ = S.engineer(X, names, fitted["scales"][day])
    flat_e = e.reshape(-1, e.shape[-1]).astype(np.float64)
    flat_x = X.reshape(-1, X.shape[-1]).astype(np.float64)
    shape = X.shape[:2]
    out = {}
    m = baseline["products"][product]
    z = (flat_x - np.array(m["feature_mean"])) / np.array(m["feature_scale"])
    out["v07_frozen"] = expit(m["calibration_intercept"] + m["calibration_slope"]
                              * (m["intercept"] + z @ np.array(m["coefficients"])))
    r = fitted["products"][product]["conus_v07_recipe"]
    out["conus_v07_recipe"] = expit(r["cal"][0] + r["cal"][1] * (r["w"][0] + ((flat_x - r["mean"]) / r["scale"]) @ r["w"][1:]))
    lr = fitted["products"][product]["conus_logistic"]
    zl = (flat_e - np.array(lr["feature_mean"])) / np.array(lr["feature_scale"])
    out["conus_logistic"] = expit(lr["calibration_intercept"] + lr["calibration_slope"]
                                  * (lr["intercept"] + zl @ np.array(lr["coefficients"])))
    g = fitted["products"][product].get("conus_gbt")
    if g is not None:
        out["conus_gbt"] = expit(g["calibration"][0] + g["calibration"][1] * g["tree"].decision_function(flat_e))
    return {k: v.reshape(shape) for k, v in out.items()}


def freeze_verify(a):
    fitted = pickle.loads(a.models.read_bytes())
    baseline = json.loads(a.baseline.read_text())
    cases, X, _, coords, names, _ = load(a.conus)
    if not np.array_equal(coords, fitted["coords"]) or names != fitted["names"]:
        raise ValueError("Grid or predictor names differ from the fitted set")
    keep = fitted["keep"]
    dev = [i for i, c in enumerate(cases) if c.startswith("2024")]
    report = {"max_abs_probability_difference": {}}
    worst = 0.0
    for day in (1, 2):
        for hazard in HAZARDS:
            product = f"day{day}_{hazard}"
            preds = predict(fitted, baseline, X[dev, day - 1][:, keep], day, product)
            for model, p in preds.items():
                ref = np.load(a.arrays / f"{product}_{model}.npy")
                known = np.isfinite(ref)
                diff = float(np.max(np.abs(p[known] - ref[known])))
                report["max_abs_probability_difference"][f"{product}/{model}"] = diff
                worst = max(worst, diff)
    report["worst"] = worst
    report["status"] = "reproduced" if worst < 1e-6 else "NOT_reproduced"
    sha = hashlib.sha256(a.models.read_bytes()).hexdigest()
    manifest = {"status": report["status"], "models_file": a.models.name, "sha256": sha, "bytes": a.models.stat().st_size,
                "source_scoring_run": a.source_run, "fit_dates": "96 cohort dates in 2022-2023",
                "models": list(MODELS), "verification": report,
                "rule": "docs/severe-phase2-criteria.md section 6 (frozen before scoring)",
                "protected_2025_outcomes_accessed": False}
    a.output.mkdir(parents=True, exist_ok=True)
    (a.output / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")
    print(json.dumps({k: manifest[k] for k in ("status", "sha256")} | {"worst": worst}))
    if report["status"] != "reproduced":
        raise SystemExit("Frozen models do not reproduce the scored predictions")


def false_alarms(y, probs, region_mask, dates):
    """y, probs[m]: (dates, samples) over supported samples (y 255 = unknown)."""
    out = {}
    lab = np.where(y == 255, 0, y)[:, region_mask]
    known = (y != 255)[:, region_mask]
    no_report = ~(lab == 1).any(axis=1)
    out["dates"] = int(len(dates))
    out["no_report_dates"] = int(no_report.sum())
    out["observed_rate"] = float(lab[known].mean()) if known.any() else None
    out["models"] = {}
    for m, p in probs.items():
        pr = p[:, region_mask]
        entry = {"mean_forecast": float(pr[known].mean())}
        for t in THRESHOLDS:
            area = (pr[no_report] >= t).sum(axis=1) * SAMPLE_KM2 if no_report.any() else np.array([0.0])
            entry[f"no_report_days_area_km2_ge_{int(t * 100)}pct"] = {
                "mean_per_day": float(area.mean()) if no_report.any() else 0.0,
                "total": float(area.sum()) if no_report.any() else 0.0,
                "max_one_day": float(area.max()) if no_report.any() else 0.0}
        out["models"][m] = entry
    return out


def judge(card):
    res = {}
    for cand in CANDIDATES:
        res[cand] = {}
        for product, e in card["products"].items():
            a = e["all_supported"]
            lo, hi = e["bootstrap_vs_reference"]["models"][cand]["brier_minus_reference_95"]
            national = bool(a["models"][cand]["brier"] < a["models"][REF]["brier"] and hi < 0)
            entered = {r: v for r, v in e["regions"].items() if v["interior"]["event_dates"] >= 3}
            better = [r for r, v in entered.items()
                      if v["interior"]["models"][cand]["brier"] < v["interior"]["models"][REF]["brier"]]
            regional = ("inconclusive" if len(entered) < 2 else
                        "holds" if len(better) >= 2 and len(better) > len(entered) / 2 else "does_not_hold")
            res[cand][product] = {"repeats_nationally": national, "brier_minus_reference_95": [lo, hi],
                                  "regional": regional, "entered_regions": sorted(entered),
                                  "better_regions": sorted(better),
                                  "thin_regions": sorted(r for r, v in e["regions"].items()
                                                         if v["verify_event_dates"] < 5 or v["train_event_dates"] < 10)}
    return res


def score(a):
    manifest = json.loads(a.manifest.read_text())
    if manifest["status"] != "reproduced" or hashlib.sha256(a.models.read_bytes()).hexdigest() != manifest["sha256"]:
        raise ValueError("Models file does not match the committed frozen manifest")
    fitted = pickle.loads(a.models.read_bytes())
    baseline = json.loads(a.baseline.read_text())
    request = json.loads(a.request.read_text())
    cases, X, Y, coords, names, hashes = load(a.conus)
    if sorted(cases) != sorted(request["cases"]):
        missing = sorted(set(request["cases"]) - set(cases))
        print(f"::warning::missing follow-up cases: {missing}")
    if any(not c.startswith("2024") for c in cases):
        raise ValueError("Follow-up dates must be 2024 (2025 is sealed)")
    if not np.array_equal(coords, fitted["coords"]) or names != fitted["names"]:
        raise ValueError("Grid or predictor names differ from the frozen set")
    keep = fitted["keep"]
    _, exposed = geography(coords)
    reg = regions(coords)
    support = json.loads(a.training_support.read_text())["by_product_region"]
    rng = np.random.default_rng(20261119)
    card, fa = {}, {}
    maps = {}
    for day in (1, 2):
        Xd = X[:, day - 1][:, keep]
        for h, hazard in enumerate(HAZARDS):
            product = f"day{day}_{hazard}"
            preds = predict(fitted, baseline, Xd, day, product)
            yk = Y[:, day - 1][:, keep][..., h]
            known = yk != 255
            d_idx, p_idx = np.nonzero(known)
            y = yk[known].astype(np.float64)
            probs = {m: v[known] for m, v in preds.items()}
            # same 2022-23 climatology as the 12-date study
            climatology = float(json.loads(a.study_scorecard.read_text())["products"][product]["all_supported"]["climatology_rate"])
            exp_k = exposed[keep][p_idx]
            sub = lambda s: S.block(y[s], {k: v[s] for k, v in probs.items()}, d_idx[s], climatology, hazard)
            entry = {"all_supported": sub(np.ones(len(y), bool)), "interior": sub(~exp_k),
                     "coast_border_exposed": sub(exp_k), "regions": {}}
            entry["bootstrap_vs_reference"] = S.bootstrap(y, probs, d_idx, climatology, REF, rng)
            for r, mask in reg.items():
                rk = mask[keep][p_idx]
                s_int = rk & ~exp_k
                part = {"interior": sub(s_int), "coast_border_exposed": sub(rk & exp_k),
                        "verify_event_dates": int(len(np.unique(d_idx[(y == 1) & rk]))),
                        "train_event_dates": support[product][r]["train_event_dates"]}
                if s_int.any() and len(np.unique(d_idx[s_int])) > 1:
                    part["bootstrap_interior_vs_reference"] = S.bootstrap(
                        y[s_int], {k: v[s_int] for k, v in probs.items()}, d_idx[s_int], climatology, REF, rng)
                for side in ("interior", "coast_border_exposed"):
                    for mm in part[side]["models"].values():
                        mm.pop("precision_recall", None); mm.pop("reliability", None)
                entry["regions"][r] = part
            card[product] = entry
            fa[product] = {r: false_alarms(yk, preds, reg[r][keep], cases) for r in FA_REGIONS}
            maps[product] = preds
            print("scored", product, flush=True)
    meta = {"status": "research_only_frozen_followup", "protected_2025_outcomes_accessed": False,
            "frozen_models_sha256": manifest["sha256"], "dates": cases, "reference": REF,
            "artifact_sha256_by_case": hashes,
            "samples": {"supported": int(keep.sum()), "coast_border_exposed": int(exposed[keep].sum())}}
    a.output.mkdir(parents=True, exist_ok=True)
    (a.output / "scorecard.json").write_text(json.dumps({**meta, "products": card}, indent=1, allow_nan=False) + "\n")
    (a.output / "false-alarms.json").write_text(json.dumps({**meta, "products": fa}, indent=1) + "\n")
    verdict = judge({"products": card})
    (a.output / "judgement.json").write_text(json.dumps(verdict, indent=1) + "\n")
    report(a.output, meta, card, fa, verdict)
    draw_maps(a.output, cases, coords[keep], Y[:, :, keep], maps, reg, keep)


def report(out, meta, card, fa, verdict):
    names = {"v07_frozen": "v0.7 as-is", "conus_v07_recipe": "v0.7 refit", "conus_logistic": "logistic", "conus_gbt": "trees"}
    L = ["# CONUS 36-date follow-up with frozen models (research only)", "",
         f"Dates: {len(meta['dates'])} unused 2024 dates. Frozen models sha256 {meta['frozen_models_sha256'][:12]}. "
         "Reference: v0.7 recipe refit on CONUS. Rule: docs/severe-phase2-criteria.md section 6. 2025 sealed.", "",
         "## Verdict (lead: Day 2 wind and hail)", "",
         "| Product | Candidate | Repeats nationally | Brier diff vs ref (95%) | Regions | Better in / entered | Thin regions |", "|---|---|---|---|---|---|---|"]
    order = ["day2_wind", "day2_hail", "day2_tornado", "day1_wind", "day1_hail", "day1_tornado"]
    for p in order:
        for c in CANDIDATES:
            v = verdict[c][p]
            L.append(f"| {p} | {names[c]} | {'yes' if v['repeats_nationally'] else 'no'} | {v['brier_minus_reference_95'][0]:+.1e} to {v['brier_minus_reference_95'][1]:+.1e} | "
                     f"{v['regional']} | {', '.join(v['better_regions']) or '-'} / {', '.join(v['entered_regions']) or '-'} | {', '.join(v['thin_regions']) or '-'} |")
    L += ["", "## Paired Brier difference vs the v0.7 refit by region (interior samples; negative = candidate better)", "",
          "| Product | Region | Verify / train event dates | logistic (95%) | trees (95%) | BSS ref / logistic / trees |", "|---|---|---|---|---|---|"]
    for p in order:
        for r, part in card[p]["regions"].items():
            b = part.get("bootstrap_interior_vs_reference", {}).get("models", {})
            fmt = lambda c: (f"{b[c]['brier_minus_reference_95'][0]:+.1e}..{b[c]['brier_minus_reference_95'][1]:+.1e}" if c in b else "-")
            ms = part["interior"]["models"]
            bss = " / ".join(f"{ms[m]['brier_skill_vs_climatology']:+.3f}" if ms[m]["brier_skill_vs_climatology"] is not None else "-"
                             for m in (REF, "conus_logistic", "conus_gbt"))
            L.append(f"| {p} | {r} | {part['verify_event_dates']} / {part['train_event_dates']} | {fmt('conus_logistic')} | {fmt('conus_gbt')} | {bss} |")
    L += ["", "## False-alarm size (all supported samples in region)", "",
          "Mean forecast vs observed report rate; land area at or above 5/15/30% on no-report days (mean km^2 per no-report day).", "",
          "| Product | Region | No-report days / dates | Observed rate | Model | Mean forecast | >=5% | >=15% | >=30% |", "|---|---|---|---|---|---|---|---|---|"]
    for p in order:
        for r in ("florida_gulf_south", "west"):
            f = fa[p][r]
            for m in MODELS:
                e = f["models"][m]
                L.append(f"| {p} | {r} | {f['no_report_dates']} / {f['dates']} | {f['observed_rate']:.4f} | {names[m]} | {e['mean_forecast']:.4f} | "
                         + " | ".join(f"{e[f'no_report_days_area_km2_ge_{t}pct']['mean_per_day']:,.0f}" for t in (5, 15, 30)) + " |")
    L += ["", "## All-supported BSS vs 2022-23 climatology", "", "| Product | Event dates / pts | " + " | ".join(names[m] for m in MODELS) + " |",
          "|---|---|" + "---|" * len(MODELS)]
    for p in order:
        a = card[p]["all_supported"]
        L.append(f"| {p} | {a['event_dates']} / {a['event_points']} | " + " | ".join(f"{a['models'][m]['brier_skill_vs_climatology']:+.3f}" for m in MODELS) + " |")
    (out / "scorecard.md").write_text("\n".join(L) + "\n")


def draw_maps(out, cases, coords, Y, maps, reg, keep):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from phase2_maps import CMAP, COLORS, LEVELS, NORM, draw_states, states
    from matplotlib.patches import Patch
    rings = states()
    wind = Y[:, 1, :, 1]
    active = int(np.argmax((wind == 1).sum(axis=1)))
    region = (reg["florida_gulf_south"] | reg["west"])[keep]
    fa_area = [(maps["day2_wind"]["conus_gbt"][i][region] >= 0.15).sum() if not (wind[i][region] == 1).any() else -1
               for i in range(len(cases))]
    quiet = int(np.argmax(fa_area))
    picks = [("active", active, "Most Day 2 wind report points")]
    if max(fa_area) >= 0:
        picks.append(("false-alarm", quiet, "No Day 2 wind report in Florida/Gulf or the West; largest trees area >= 15% there"))
    for kind, i, why in picks:
        w = future_window(cases[i], 2)
        fig, axes = plt.subplots(3, 2, figsize=(14, 12.5))
        for r, m in enumerate((REF, "conus_logistic", "conus_gbt")):
            for c, hz in enumerate(("wind", "hail")):
                ax = axes[r, c]
                p = maps[f"day2_{hz}"][m][i]
                lab = Y[i, 1, :, 1 + c]
                ax.scatter(coords[:, 0], coords[:, 1], c=p, cmap=CMAP, norm=NORM, s=1.4, marker="s", lw=0)
                hit = lab == 1
                ax.scatter(coords[hit, 0], coords[hit, 1], s=1.2, c="#08306b", marker=".", lw=0)
                draw_states(ax, rings)
                ax.plot([-100, -75, -75, -100, -100], [30, 30, 45, 45, 30], "k--", lw=0.7)
                ax.set_xlim(-126, -66); ax.set_ylim(24, 50); ax.set_aspect(1 / np.cos(np.radians(37)))
                ax.set_xticks([]); ax.set_yticks([])
                ax.set_title({REF: "v0.7 refit (reference)", "conus_logistic": "CONUS logistic", "conus_gbt": "CONUS trees"}[m]
                             + f" - Day 2 {hz}; {int(hit.sum())} points within 25 mi of a report", fontsize=9)
        fig.suptitle(f"Frozen-model follow-up, {kind} example ({why})\n12Z HRRR of {cases[i]}, valid {w['valid_start'][:16]}Z to "
                     f"{w['valid_end'][:16]}Z. Probability of a qualifying report within 25 miles (wind >= 50 kt; hail >= 1 in). "
                     "Dark dots = observed. Offshore unavailable. Research only.", fontsize=9.5)
        fig.legend(handles=[Patch(color=col, label=f"{lo:.0%}-{hi:.0%}") for col, lo, hi in zip(COLORS, LEVELS, LEVELS[1:])],
                   loc="lower center", ncol=7, fontsize=8, frameon=False)
        fig.tight_layout(rect=(0, 0.03, 1, 0.94))
        fig.savefig(out / f"followup-{kind}-{cases[i]}-day2.png", dpi=105)
        plt.close(fig)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("freeze-verify")
    f.add_argument("--models", type=Path, required=True); f.add_argument("--conus", type=Path, required=True)
    f.add_argument("--arrays", type=Path, required=True); f.add_argument("--output", type=Path, required=True)
    f.add_argument("--source-run", required=True)
    f.add_argument("--baseline", type=Path, default=Path("research/severe/baseline-v07/models.json"))
    s = sub.add_parser("score")
    s.add_argument("--models", type=Path, required=True); s.add_argument("--manifest", type=Path, required=True)
    s.add_argument("--conus", type=Path, required=True); s.add_argument("--request", type=Path, required=True)
    s.add_argument("--output", type=Path, required=True)
    s.add_argument("--baseline", type=Path, default=Path("research/severe/baseline-v07/models.json"))
    s.add_argument("--training-support", type=Path, default=Path("research/severe/conus-v1/study/event-support.json"))
    s.add_argument("--study-scorecard", type=Path, default=Path("research/severe/conus-v1/study/scorecard.json"))
    a = p.parse_args()
    freeze_verify(a) if a.cmd == "freeze-verify" else score(a)


if __name__ == "__main__":
    main()
