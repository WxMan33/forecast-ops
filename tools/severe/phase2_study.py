#!/usr/bin/env python3
"""Phase 2 HRRR research study (research only; never touches the live feed or publisher).

1. Audits the pinned v0.7 cohort: dates, splits, per-hazard event counts, quiet/active balance.
2. Reproduces the v0.7 baseline exactly with train_daily.fit_product and checks it against the
   committed research/severe/baseline-v07 scores and coefficients.
3. Trains experimental models on 2022+2023 only (2024 is never used for fitting, tuning or
   calibration; 2025 is sealed and never loaded):
     - phase2-logistic: asinh-transformed predictors plus three physical interaction terms, L2
       penalty chosen by month-grouped cross-validation, monotone Platt calibration fitted on the
       out-of-fold predictions. Everything is inside the training years.
     - phase2-gbt: a small fixed gradient-boosted tree model, calibrated the same way.
4. Scores v0.7, both candidates and training climatology on the SAME 2024 development dates,
   points and windows: event counts, Brier, skill vs climatology, log loss, precision-recall,
   reliability, contingency tables at practical thresholds, by lead, hazard and region, with
   paired date-bootstrap intervals.
5. Writes the arrays the map script needs (active and quiet verification days).
"""
import argparse
import json
from datetime import datetime
from pathlib import Path

import numpy as np
from scipy.special import expit

from train_daily import digest, fit_logistic, fit_product, load_cohort

HAZARDS = ("tornado", "wind", "hail")
PENALTIES = (1e-4, 1e-3, 1e-2, 1e-1)
FOLDS = 6
THRESHOLDS = {"tornado": (0.02, 0.05, 0.10), "wind": (0.05, 0.15, 0.30), "hail": (0.05, 0.15, 0.30)}
EDGES = (0, 0.001, 0.01, 0.02, 0.05, 0.10, 0.15, 0.30, 1.000001)
REGIONS = {  # quadrants of the regional grid (lon split 87.5W, lat split 37.5N); land samples only
    "southwest": lambda lon, lat: (lon < -87.5) & (lat < 37.5),
    "northwest": lambda lon, lat: (lon < -87.5) & (lat >= 37.5),
    "southeast": lambda lon, lat: (lon >= -87.5) & (lat < 37.5),
    "northeast": lambda lon, lat: (lon >= -87.5) & (lat >= 37.5),
}
INTERACTIONS = (  # physically motivated products, each built from the 25-mile neighborhood maxima
    ("cape_shear", "x_sbcape_nearby_max_max", "x_shear06_max", True),
    ("srh_shear", "x_srh01_nearby_max_max", "x_shear06_max", False),
    ("uh_shear", "x_uh25_nearby_max_max", "x_shear06_max", False),
)
BOOTSTRAP = 5000


def fold_of(case):
    """Month-grouped folds: every date of a calendar month lands in the same fold, so a multi-day
    outbreak never straddles training and scoring; months are dealt round-robin so every fold
    spans all seasons."""
    date = datetime.strptime(case, "%Y-%m-%d")
    return ((date.year - 2022) * 12 + date.month - 1) % FOLDS


def stack(group):
    cases = [case for case, _, _ in group]
    if any(not c.startswith(("2022", "2023", "2024")) for c in cases):
        raise ValueError("Only 2022-2024 development dates may be loaded; 2025 is sealed")
    return cases, np.stack([x for _, x, _ in group]), np.stack([y for _, _, y in group])


def engineer(x, names, scales=None):
    """asinh(x / s) per column (s = training median |x|), plus interaction columns."""
    index = {n: i for i, n in enumerate(names)}
    extra = []
    for _, a, b, root in INTERACTIONS:
        left = np.maximum(x[..., index[a]], 0)
        extra.append((np.sqrt(left) if root else left) * np.abs(x[..., index[b]]))
    full = np.concatenate([x, np.stack(extra, axis=-1)], axis=-1)
    if scales is None:
        flat = np.abs(full.reshape(-1, full.shape[-1]))
        scales = np.array([np.median(c[c > 0]) if (c > 0).any() else 1.0 for c in flat.T])
    return np.arcsinh(full / scales), scales


def rows(x, y, hazard):
    """Flatten (dates, points, ...) to known rows, keeping each row's date and point index."""
    labels = y[..., hazard]
    known = labels != 255
    date_index, point_index = np.nonzero(known)
    return x[known].astype(np.float64), labels[known].astype(np.float64), date_index, point_index


class Standard:
    def __init__(self, x):
        self.mean, self.scale = x.mean(axis=0), x.std(axis=0)
        self.scale[self.scale == 0] = 1

    def __call__(self, x):
        return (x - self.mean) / self.scale


def logistic_oof(x, y, folds, penalty):
    out = np.empty(len(y))
    for k in range(FOLDS):
        held = folds == k
        z = Standard(x[~held])
        w = fit_logistic(z(x[~held]), y[~held], penalty)
        out[held] = w[0] + z(x[held]) @ w[1:]
    return out


def mean_log_loss(y, logits):
    return float(np.mean(np.logaddexp(0, logits) - y * logits))


def fit_candidate_logistic(x, y, folds):
    search = {}
    for penalty in PENALTIES:
        oof = logistic_oof(x, y, folds, penalty)
        search[penalty] = (mean_log_loss(y, oof), oof)
    penalty = min(search, key=lambda p: search[p][0])
    oof = search[penalty][1]
    calibration = fit_logistic(oof[:, None], y, penalty=0.0001, monotone=True)
    z = Standard(x)
    w = fit_logistic(z(x), y, penalty)
    model = {"penalty": penalty, "feature_mean": z.mean.tolist(), "feature_scale": z.scale.tolist(),
             "intercept": float(w[0]), "coefficients": w[1:].tolist(),
             "calibration_intercept": float(calibration[0]), "calibration_slope": float(calibration[1]),
             "cv_log_loss_by_penalty": {str(p): v[0] for p, v in search.items()}}

    def predict(xs):
        return expit(calibration[0] + calibration[1] * (w[0] + z(xs) @ w[1:]))
    return model, predict, oof


GBT_PARAMS = {"learning_rate": 0.05, "max_iter": 200, "max_leaf_nodes": 15, "min_samples_leaf": 2000,
              "l2_regularization": 1.0, "early_stopping": False, "random_state": 20260119}


def fit_candidate_gbt(x, y, folds):
    from sklearn.ensemble import HistGradientBoostingClassifier
    oof = np.empty(len(y))
    for k in range(3):  # three month-grouped folds for the calibration predictions
        held = folds % 3 == k
        tree = HistGradientBoostingClassifier(**GBT_PARAMS).fit(x[~held], y[~held])
        oof[held] = tree.decision_function(x[held])
    calibration = fit_logistic(oof[:, None], y, penalty=0.0001, monotone=True)
    tree = HistGradientBoostingClassifier(**GBT_PARAMS).fit(x, y)
    model = {"params": GBT_PARAMS, "calibration_intercept": float(calibration[0]),
             "calibration_slope": float(calibration[1]), "trees": int(tree.n_iter_)}

    def predict(xs):
        return expit(calibration[0] + calibration[1] * tree.decision_function(xs))
    predict.frozen = {"tree": tree, "calibration": calibration.tolist()}  # for freezing; no numeric effect
    return model, predict


def contingency(y, p, threshold):
    yes, event = p >= threshold, y == 1
    hits, misses = int((yes & event).sum()), int((~yes & event).sum())
    false_alarms = int((yes & ~event).sum())
    return {"threshold": threshold, "hits": hits, "misses": misses, "false_alarms": false_alarms,
            "correct_negatives": int((~yes & ~event).sum()),
            "pod": hits / (hits + misses) if hits + misses else None,
            "false_alarm_ratio": false_alarms / (hits + false_alarms) if hits + false_alarms else None,
            "csi": hits / (hits + misses + false_alarms) if hits + misses + false_alarms else None,
            "frequency_bias": (hits + false_alarms) / (hits + misses) if hits + misses else None}


def average_precision(y, p):
    order = np.argsort(-p, kind="stable")
    ys = y[order]
    if ys.sum() == 0:
        return None
    tp = np.cumsum(ys)
    precision = tp / np.arange(1, len(ys) + 1)
    return float((precision * ys).sum() / ys.sum())


def pr_curve(y, p, points=(0.005, 0.01, 0.02, 0.05, 0.10, 0.15, 0.20, 0.30, 0.45)):
    out = []
    for t in points:
        yes = p >= t
        tp = float((yes & (y == 1)).sum())
        out.append({"threshold": t, "precision": tp / yes.sum() if yes.any() else None,
                    "recall": tp / y.sum() if y.sum() else None})
    return out


def reliability(y, p, dates):
    out = []
    for lower, upper in zip(EDGES, EDGES[1:]):
        s = (p >= lower) & (p < upper)
        if s.any():
            out.append({"lower": lower, "upper": min(upper, 1), "points": int(s.sum()),
                        "dates": len(np.unique(dates[s])), "mean_probability": float(p[s].mean()),
                        "observed_rate": float(y[s].mean())})
    return out


def block(y, probabilities, dates, climatology, hazard):
    """Scores for one product on one subset; every model sees exactly the same rows."""
    clim = np.full(len(y), climatology)
    ref = float(np.mean((clim - y) ** 2))
    out = {"points": int(len(y)), "event_points": int(y.sum()),
           "event_dates": int(len(np.unique(dates[y == 1]))), "dates": int(len(np.unique(dates))),
           "climatology_rate": climatology, "climatology_brier": ref, "models": {}}
    for name, p in probabilities.items():
        brier = float(np.mean((p - y) ** 2))
        q = np.clip(p, 1e-9, 1 - 1e-9)
        out["models"][name] = {
            "brier": brier, "brier_skill_vs_climatology": 1 - brier / ref if ref else None,
            "log_loss": float(-np.mean(y * np.log(q) + (1 - y) * np.log(1 - q))),
            "mean_probability": float(p.mean()), "average_precision": average_precision(y, p),
            "precision_recall": pr_curve(y, p), "reliability": reliability(y, p, dates),
            "contingency": [contingency(y, p, t) for t in THRESHOLDS[hazard]],
        }
    return out


def bootstrap(y, probabilities, dates, climatology, reference, rng):
    """Paired resampling of whole dates (keeps each day's spatial correlation together)."""
    ids = np.unique(dates)
    n = np.array([(dates == d).sum() for d in ids], float)
    sse = {m: np.array([np.sum((p[dates == d] - y[dates == d]) ** 2) for d in ids])
           for m, p in probabilities.items()}
    clim = np.array([np.sum((climatology - y[dates == d]) ** 2) for d in ids])
    draws = rng.integers(0, len(ids), size=(BOOTSTRAP, len(ids)))
    total = n[draws].sum(axis=1)
    ref_b = clim[draws].sum(axis=1) / total
    out = {"dates": int(len(ids)), "resamples": BOOTSTRAP, "models": {}}
    base = sse[reference][draws].sum(axis=1) / total
    for m in probabilities:
        b = sse[m][draws].sum(axis=1) / total
        skill = 1 - b / np.where(ref_b > 0, ref_b, np.nan)
        entry = {"bss_95": [float(np.nanpercentile(skill, 2.5)), float(np.nanpercentile(skill, 97.5))]}
        if m != reference:
            diff = b - base
            entry.update({"brier_minus_reference_95": [float(np.percentile(diff, 2.5)),
                                                       float(np.percentile(diff, 97.5))],
                          "share_of_resamples_better_than_reference": float(np.mean(diff < 0)),
                          "dates_better_than_reference": int(np.sum(sse[m] < sse[reference])),
                          "dates_worse_than_reference": int(np.sum(sse[m] > sse[reference]))})
        out["models"][m] = entry
    return out


def audit(cases_by_split, y_by_split, land):
    out = {"splits": {}, "sealed": {"year": 2025, "loaded": False}}
    for split, cases in cases_by_split.items():
        y = y_by_split[split]
        per_case = []
        for i, case in enumerate(cases):
            entry = {"case": case, "fold": fold_of(case) if split != "development" else None}
            for day in (1, 2):
                for h, hazard in enumerate(HAZARDS):
                    lab = y[i, day - 1, :, h]
                    entry[f"day{day}_{hazard}"] = {"event_points": int((lab == 1).sum()),
                                                   "event_points_land": int(((lab == 1) & land).sum()),
                                                   "unknown_points": int((lab == 255).sum())}
            entry["any_event_day1"] = any(entry[f"day1_{h}"]["event_points"] for h in HAZARDS)
            per_case.append(entry)
        summary = {}
        for day in (1, 2):
            for hazard in HAZARDS:
                key = f"day{day}_{hazard}"
                pts = [c[key]["event_points"] for c in per_case]
                summary[key] = {"event_points": int(sum(pts)), "event_dates": int(sum(p > 0 for p in pts)),
                                "dates": len(pts), "max_event_points_one_date": int(max(pts)),
                                "unknown_points": int(sum(c[key]["unknown_points"] for c in per_case))}
        months = sorted({c[:7] for c in cases})
        out["splits"][split] = {"dates": len(cases), "first": cases[0], "last": cases[-1],
                                "months": len(months), "summary": summary,
                                "quiet_dates_day1": int(sum(not c["any_event_day1"] for c in per_case)),
                                "cases": per_case}
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history", type=Path, required=True)
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--cohort", type=Path, default=Path("research/severe/cohort-v07.json"))
    parser.add_argument("--baseline", type=Path, default=Path("research/severe/baseline-v07"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--arrays", type=Path, required=True, help="Directory for map arrays (not committed)")
    parser.add_argument("--skip-gbt", action="store_true")
    args = parser.parse_args()
    rng = np.random.default_rng(20261119)
    groups, names, sources, label_hash = load_cohort(args.history, args.cohort, args.labels)
    label_manifest = json.loads((args.labels / "manifest.json").read_text())
    with np.load(args.labels / label_manifest["artifact"]["file"], allow_pickle=False) as truth:
        coordinates = truth["coordinates"]
    grid = np.array(json.loads(Path("assets/severe-daily/grid.json").read_text())["coordinates"])
    if grid.shape != coordinates.shape or np.abs(grid - coordinates).max() > 1e-9:
        raise ValueError("Viewer grid and label grid differ")
    hidden = json.loads(Path("assets/severe-daily/display-mask.json").read_text())["hidden"]
    land = np.ones(len(coordinates), bool)
    land[hidden] = False
    lon, lat = coordinates[:, 0], coordinates[:, 1]
    region_of = {name: rule(lon, lat) & land for name, rule in REGIONS.items()}

    split = {s: stack(groups[s]) for s in ("train", "calibration", "development")}
    cases = {s: v[0] for s, v in split.items()}
    args.output.mkdir(parents=True, exist_ok=True)
    args.arrays.mkdir(parents=True, exist_ok=True)
    meta = {"protected_2025_outcomes_accessed": False, "status": "research_only_not_operational",
            "cohort_sha256": digest(args.cohort), "frozen_labels_sha256": label_hash,
            "development_dates_previously_used_for_selection": True,
            "note": ("2024 development dates were already used to compare v0.6/v0.7/v0.8, so these "
                     "scores are exploratory, not a sealed test. 2025 remains sealed.")}
    (args.output / "audit.json").write_text(json.dumps(
        {**meta, **audit(cases, {s: v[2] for s, v in split.items()}, land),
         "joined_artifact_sha256_by_case": sources}, indent=1) + "\n")

    committed = json.loads((args.baseline / "development-scores.json").read_text())["products"]
    committed_models = json.loads((args.baseline / "models.json").read_text())["products"]
    reproduction, models, scorecard, cv = {}, {}, {}, {}
    dev_cases, x_dev_all, y_dev_all = split["development"]
    fit_cases = cases["train"] + cases["calibration"]
    x_fit_all = np.concatenate([split["train"][1], split["calibration"][1]])
    y_fit_all = np.concatenate([split["train"][2], split["calibration"][2]])
    fold_by_date = np.array([fold_of(c) for c in fit_cases])
    for day in (1, 2):
        e_fit, scales = engineer(x_fit_all[:, day - 1], names)
        e_dev, _ = engineer(x_dev_all[:, day - 1], names, scales)
        for h, hazard in enumerate(HAZARDS):
            product = f"day{day}_{hazard}"
            print("product", product, flush=True)
            # --- v0.7 exact reproduction -------------------------------------------------------
            model07, result07 = fit_product(groups, day, h)
            reproduction[product] = {
                "committed_calibrated_brier": committed[product]["calibrated"]["brier"],
                "reproduced_calibrated_brier": result07["calibrated"]["brier"],
                "abs_difference": abs(committed[product]["calibrated"]["brier"] - result07["calibrated"]["brier"]),
                "max_abs_coefficient_difference": float(np.max(np.abs(
                    np.array(committed_models[product]["coefficients"]) - np.array(model07["coefficients"])))),
            }
            # --- rows ---------------------------------------------------------------------------
            x_raw_dev, y_dev, d_dev, p_dev = rows(x_dev_all[:, day - 1], y_dev_all[:, day - 1], h)
            x_dev, _, _, _ = rows(e_dev, y_dev_all[:, day - 1], h)
            x_fit, y_fit, d_fit, _ = rows(e_fit, y_fit_all[:, day - 1], h)
            x_raw_fit, _, _, _ = rows(x_fit_all[:, day - 1], y_fit_all[:, day - 1], h)
            folds = fold_by_date[d_fit]
            m07 = committed_models[product]
            z07 = (x_raw_dev - np.array(m07["feature_mean"])) / np.array(m07["feature_scale"])
            p07 = expit(m07["calibration_intercept"] + m07["calibration_slope"]
                        * (m07["intercept"] + z07 @ np.array(m07["coefficients"])))
            # --- candidates (2022+2023 only) ------------------------------------------------------
            model_lr, predict_lr, oof_lr = fit_candidate_logistic(x_fit, y_fit, folds)
            p_lr = predict_lr(x_dev)
            probabilities = {"v07": p07, "phase2_logistic": p_lr}
            models[product] = {"phase2_logistic": model_lr}
            if not args.skip_gbt:
                model_gbt, predict_gbt = fit_candidate_gbt(x_fit, y_fit, folds)
                probabilities["phase2_gbt"] = predict_gbt(x_dev)
                models[product]["phase2_gbt"] = model_gbt
            # Recipe check on 96 cross-validated dates: v0.7's predictors and penalty versus the
            # candidate's, same folds (uncalibrated out-of-fold log loss / Brier; exploratory).
            oof07 = logistic_oof(x_raw_fit, y_fit, folds, 0.001)
            cv[product] = {"dates": len(fit_cases), "event_points": int(y_fit.sum()),
                           "event_dates": int(len(np.unique(d_fit[y_fit == 1]))),
                           "v07_recipe": {"log_loss": mean_log_loss(y_fit, oof07),
                                          "brier": float(np.mean((expit(oof07) - y_fit) ** 2))},
                           "phase2_logistic_recipe": {"log_loss": mean_log_loss(y_fit, oof_lr),
                                                      "brier": float(np.mean((expit(oof_lr) - y_fit) ** 2))},
                           "climatology_brier": float(np.mean((y_fit.mean() - y_fit) ** 2))}
            climatology = float(y_fit.mean())  # 2022+2023 rate: one common reference for every model
            land_rows = land[p_dev]
            entry = {"all_samples": block(y_dev, probabilities, d_dev, climatology, hazard),
                     "land": block(y_dev[land_rows], {k: v[land_rows] for k, v in probabilities.items()},
                                   d_dev[land_rows], climatology, hazard),
                     "regions": {}}
            for region, inside in region_of.items():
                r = inside[p_dev]
                entry["regions"][region] = block(y_dev[r], {k: v[r] for k, v in probabilities.items()},
                                                 d_dev[r], climatology, hazard)
                for m in entry["regions"][region]["models"].values():  # keep regional tables compact
                    m.pop("precision_recall"); m.pop("reliability")
            entry["bootstrap_all_samples"] = bootstrap(y_dev, probabilities, d_dev, climatology, "v07", rng)
            entry["development_by_date"] = [
                {"case": dev_cases[i], "event_points": int(y_dev[d_dev == i].sum()),
                 "brier": {k: float(np.mean((v[d_dev == i] - y_dev[d_dev == i]) ** 2))
                           for k, v in probabilities.items()}}
                for i in np.unique(d_dev)]
            scorecard[product] = entry
            # full-grid arrays for maps (unknown points left as NaN)
            for name, p in probabilities.items():
                grid_p = np.full((len(dev_cases), len(coordinates)), np.nan, np.float32)
                grid_p[d_dev, p_dev] = p
                np.save(args.arrays / f"{product}_{name}.npy", grid_p)
    np.save(args.arrays / "labels_dev.npy", y_dev_all)
    np.save(args.arrays / "coordinates.npy", coordinates)
    (args.arrays / "dev_cases.json").write_text(json.dumps(dev_cases))
    (args.output / "baseline-reproduction.json").write_text(json.dumps(
        {**meta, "products": reproduction,
         "reproduced": all(v["abs_difference"] < 1e-9 for v in reproduction.values())}, indent=1) + "\n")
    (args.output / "candidate-models.json").write_text(json.dumps(
        {**meta, "trained_on": "2022 and 2023 calendar dates (96)", "feature_names": names,
         "interactions": [i[0] for i in INTERACTIONS], "fold_rule": "calendar month round-robin, 6 folds",
         "products": models}, indent=1) + "\n")
    (args.output / "cross-validation.json").write_text(json.dumps({**meta, "products": cv}, indent=1) + "\n")
    (args.output / "scorecard.json").write_text(json.dumps(
        {**meta, "verification_dates": dev_cases, "climatology": "2022+2023 event rate per product",
         "products": scorecard}, indent=1, allow_nan=False) + "\n")


if __name__ == "__main__":
    main()
