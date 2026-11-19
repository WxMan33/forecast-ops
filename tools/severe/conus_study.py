#!/usr/bin/env python3
"""First national test: train and score experimental CONUS HRRR models on the 108 cohort cases.

Research only. Fits on 2022+2023, scores on the 12 2024 dates (exploratory; 2025 sealed).
Models, all scored on the same 2024 dates, points and windows:
  v07_frozen         the production v0.7 coefficients applied everywhere (extrapolates outside the
                     box it was trained in; this is "just extend the map")
  conus_v07_recipe   v0.7's recipe refit on the CONUS grid (train 2022, calibrate 2023)
  conus_logistic     Phase 2 logistic recipe on the CONUS grid (2022+2023, month-grouped CV)
  conus_gbt          Phase 2 boosted-tree recipe on the CONUS grid
Land samples beyond 25 miles of US land (inside the old box) are unavailable and not scored.
Coastal/border-exposed samples (25-mile disk crosses the US outline) are scored separately.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from scipy.special import expit

from display_mask import RADIUS_KM, distances, land, outline_km, segments
from extract import digest
from train_daily import fit_logistic
import phase2_study as S

HAZARDS = ("tornado", "wind", "hail")
BOX = (-100, -75, 30, 45)


def regions(coords):
    lon, lat = coords[:, 0], coords[:, 1]
    box = (lon >= BOX[0]) & (lon <= BOX[1]) & (lat >= BOX[2]) & (lat <= BOX[3])
    out = {"original_box": box,
           "west": ~box & (lon < -104),
           "plains_outside_box": ~box & (lon >= -104) & (lon < -90),
           "florida_gulf_south": ~box & (lon >= -90) & (lat < 30),
           "northeast_outside_box": ~box & (lon >= -90) & (lat >= 30)}
    assert np.array_equal(sum(v.astype(int) for v in out.values()), np.ones(len(coords), int))
    return out


def geography(coords):
    geom = land()
    km = np.array(distances(coords, geom))
    edges = segments(geom)
    to_outline = np.array([outline_km(x, y, edges) for x, y in coords])
    supported = km <= RADIUS_KM
    exposed = supported & (to_outline < RADIUS_KM)
    return supported, exposed


def load(root):
    cases, xs, ys, coords, names, hashes = [], [], [], None, None, {}
    for meta_path in sorted(Path(root).glob("*/conus-case.json")):
        meta = json.loads(meta_path.read_text())
        case = meta["case"]
        if not case.startswith(("2022", "2023", "2024")):
            raise ValueError("2025 is sealed")
        path = meta_path.parent / meta["artifact"]["file"]
        if digest(path) != meta["artifact"]["sha256"]:
            raise ValueError(f"{case}: artifact hash mismatch")
        with np.load(path, allow_pickle=False) as d:
            if coords is None:
                coords, names = d["coordinates"], d["feature_names"].tolist()
            if not np.array_equal(d["coordinates"], coords) or d["feature_names"].tolist() != names:
                raise ValueError(f"{case}: grid or predictors differ")
            xs.append(d["features"])
            ys.append(d["labels"])
        cases.append(case)
        hashes[case] = meta["artifact"]["sha256"]
    return cases, np.stack(xs), np.stack(ys), coords, names, hashes


def v07_recipe(x_train, y_train, x_cal, y_cal):
    z = S.Standard(x_train)
    w = fit_logistic(z(x_train), y_train, penalty=0.001)
    cal = fit_logistic((w[0] + z(x_cal) @ w[1:])[:, None], y_cal, penalty=0.0001, monotone=True)
    return lambda xs: expit(cal[0] + cal[1] * (w[0] + z(xs) @ w[1:]))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--conus", type=Path, required=True, help="Directory of <case>/conus-joined.npz")
    p.add_argument("--baseline", type=Path, default=Path("research/severe/baseline-v07/models.json"))
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--arrays", type=Path, required=True)
    p.add_argument("--skip-gbt", action="store_true")
    a = p.parse_args()
    rng = np.random.default_rng(20261119)
    cases, X, Y, coords, names, hashes = load(a.conus)
    if len(cases) != 108:
        print(f"::warning::{len(cases)} of 108 cases present; scoring what exists")
    supported, exposed = geography(coords)
    reg = regions(coords)
    year = np.array([int(c[:4]) for c in cases])
    fit_idx, tr_idx, cal_idx, dev_idx = (np.where(year <= 2023)[0], np.where(year == 2022)[0],
                                         np.where(year == 2023)[0], np.where(year == 2024)[0])
    fit_cases = [cases[i] for i in fit_idx]
    dev_cases = [cases[i] for i in dev_idx]
    folds_by_date = np.array([S.fold_of(c) for c in fit_cases])
    frozen = json.loads(a.baseline.read_text())
    if frozen["feature_names"] != names:
        raise ValueError("Frozen v0.7 feature order differs")
    a.output.mkdir(parents=True, exist_ok=True)
    a.arrays.mkdir(parents=True, exist_ok=True)
    # Unsupported (offshore beyond 25 mi) samples are excluded from fitting and scoring alike.
    keep = supported
    card, counts, models = {}, {}, {}
    for day in (1, 2):
        e_fit, scales = S.engineer(X[fit_idx, day - 1][:, keep], names)
        e_dev, _ = S.engineer(X[dev_idx, day - 1][:, keep], names, scales)
        for h, hazard in enumerate(HAZARDS):
            product = f"day{day}_{hazard}"
            print("product", product, flush=True)
            yk = Y[:, day - 1][:, keep]
            xr = X[:, day - 1][:, keep]
            x_fit, y_fit, d_fit, _ = S.rows(e_fit, yk[fit_idx], h)
            x_dev, y_dev, d_dev, p_dev = S.rows(e_dev, yk[dev_idx], h)
            xr_tr, yr_tr, _, _ = S.rows(xr[tr_idx], yk[tr_idx], h)
            xr_cal, yr_cal, _, _ = S.rows(xr[cal_idx], yk[cal_idx], h)
            xr_dev, _, _, _ = S.rows(xr[dev_idx], yk[dev_idx], h)
            m = frozen["products"][product]
            zf = (xr_dev - np.array(m["feature_mean"])) / np.array(m["feature_scale"])
            probs = {"v07_frozen": expit(m["calibration_intercept"] + m["calibration_slope"]
                                         * (m["intercept"] + zf @ np.array(m["coefficients"])))}
            probs["conus_v07_recipe"] = v07_recipe(xr_tr, yr_tr, xr_cal, yr_cal)(xr_dev)
            model_lr, predict_lr, _ = S.fit_candidate_logistic(x_fit, y_fit, folds_by_date[d_fit])
            probs["conus_logistic"] = predict_lr(x_dev)
            models[product] = {"conus_logistic": model_lr}
            if not a.skip_gbt:
                model_gbt, predict_gbt = S.fit_candidate_gbt(x_fit, y_fit, folds_by_date[d_fit])
                probs["conus_gbt"] = predict_gbt(x_dev)
                models[product]["conus_gbt"] = model_gbt
            climatology = float(y_fit.mean())
            exp_k = exposed[keep][p_dev]
            reg_k = {r: v[keep][p_dev] for r, v in reg.items()}
            sub = lambda s: S.block(y_dev[s], {k: v[s] for k, v in probs.items()}, d_dev[s], climatology, hazard)
            entry = {"all_supported": sub(np.ones(len(y_dev), bool)),
                     "interior": sub(~exp_k), "coast_border_exposed": sub(exp_k), "regions": {}}
            for r, s in reg_k.items():
                entry["regions"][r] = {"interior": sub(s & ~exp_k), "coast_border_exposed": sub(s & exp_k)}
                for part in entry["regions"][r].values():
                    for mm in part["models"].values():
                        mm.pop("precision_recall"); mm.pop("reliability")
            entry["bootstrap_all_supported"] = S.bootstrap(y_dev, probs, d_dev, climatology, "v07_frozen", rng)
            card[product] = entry
            # event support by region and split, for the "needs more dates" flags
            fit_rows_region = {r: v[keep] for r, v in reg.items()}
            counts[product] = {}
            for r, v in fit_rows_region.items():
                lab_fit = yk[fit_idx][:, v, h]
                lab_dev = yk[dev_idx][:, v, h]
                counts[product][r] = {
                    "train_event_dates": int(((lab_fit == 1).any(axis=1)).sum()),
                    "train_event_points": int((lab_fit == 1).sum()),
                    "verify_event_dates": int(((lab_dev == 1).any(axis=1)).sum()),
                    "verify_event_points": int((lab_dev == 1).sum())}
            for name, pr in probs.items():
                grid = np.full((len(dev_idx), int(keep.sum())), np.nan, np.float32)
                grid[d_dev, p_dev] = pr
                np.save(a.arrays / f"{product}_{name}.npy", grid)
    flags = []
    for product, by_region in counts.items():
        for r, c in by_region.items():
            if c["verify_event_dates"] < 5 or c["train_event_dates"] < 10:
                flags.append({"product": product, "region": r, **c,
                              "reason": "fewer than 5 verification event dates or 10 training event dates"})
    np.save(a.arrays / "coordinates.npy", coords[keep])
    np.save(a.arrays / "labels_dev.npy", Y[dev_idx][:, :, keep])
    np.save(a.arrays / "exposed.npy", exposed[keep])
    (a.arrays / "dev_cases.json").write_text(json.dumps(dev_cases))
    meta = {"status": "research_only_first_national_test", "protected_2025_outcomes_accessed": False,
            "cases": len(cases), "fit_dates": len(fit_cases), "verification_dates": dev_cases,
            "samples": {"conus_grid": int(len(coords)), "supported_scored": int(keep.sum()),
                        "unavailable_offshore": int((~keep).sum()), "coast_border_exposed": int(exposed.sum())},
            "artifact_sha256_by_case": hashes,
            "note": "2024 was used in earlier model selection: exploratory, not a sealed test."}
    (a.output / "scorecard.json").write_text(json.dumps({**meta, "products": card}, indent=1, allow_nan=False) + "\n")
    (a.output / "event-support.json").write_text(json.dumps({**meta, "by_product_region": counts,
                                                             "needs_more_dates": flags}, indent=1) + "\n")
    (a.output / "models.json").write_text(json.dumps({**meta, "feature_names": names, "products": models}, indent=1) + "\n")


if __name__ == "__main__":
    main()
