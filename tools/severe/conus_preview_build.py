#!/usr/bin/env python3
"""Build the CONUS Severe research preview feed (Day 2 damaging wind only).

Model: the frozen CONUS boosted-tree candidate (research/severe/conus-v1/frozen/models.pkl, manifest
checked), product day2_wind, on its existing CONUS grid (40,311 samples; 38,838 supported = within
25 miles of US land). Outputs static JSON for the browser:

  assets/severe-conus/index.json        cases, provenance, coverage rule, benchmark context, checks
  assets/severe-conus/grid.json         coordinates + supported flags
  assets/severe-conus/<id>.json         probabilities (null = outside coverage) and observed report points

Replays use archived 2024 extraction outputs. A current run (optional) uses a fresh, audited HRRR
extraction with no labels. Research only; 2021 and 2025 are never loaded.
"""
import argparse
import hashlib
import json
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np

import phase2_study as S
from conus_calibration import check_frozen
from conus_followup import SAMPLE_KM2, predict
from conus_study import load, regions
from extract import digest

ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / "research/severe/conus-v1/frozen/models.pkl"
MANIFEST = ROOT / "research/severe/conus-v1/frozen/manifest.json"
BASELINE = ROOT / "research/severe/baseline-v07/models.json"
STUDY = ROOT / "research/severe/conus-v1/study/scorecard.json"
WIND_RULES = ROOT / "research/severe/nadocast/day2-wind-rules.json"
WIND_SCORE = ROOT / "research/severe/nadocast/wind_score/wind-score-scorecard.json"
PRODUCT, DAY, HAZ = "day2_wind", 2, 1
ACTIVE = "2024-05-25"
TOL = 1e-6


def sha(b):
    return hashlib.sha256(b).hexdigest()


def gbt(fitted, baseline, x_day2):
    keep = fitted["keep"]
    p = predict(fitted, baseline, x_day2[None][:, keep], DAY, PRODUCT)["conus_gbt"][0]
    out = np.full(len(keep), np.nan)
    out[keep] = p
    return out


def case_rows(root, wanted):
    """Per-case Day 2 features and wind labels (hash-checked), one date at a time."""
    for c in wanted:
        mp = next((Path(r) / c / "conus-case.json" for r in root if (Path(r) / c / "conus-case.json").exists()), None)
        if mp is None:
            continue
        meta = json.loads(mp.read_text())
        path = mp.parent / meta["artifact"]["file"]
        if digest(path) != meta["artifact"]["sha256"]:
            raise ValueError(f"{c}: artifact hash mismatch")
        with np.load(path, allow_pickle=False) as z:
            yield c, z["coordinates"], z["feature_names"].tolist(), z["features"][1], z["labels"][1][:, HAZ]


def reproduce_study(fitted, baseline, cohort_root):
    """Recompute the archived 12-date 2024 CONUS-study Brier for day2_wind / conus_gbt."""
    cases, X, Y, coords, names, _ = load(cohort_root)
    dev = [i for i, c in enumerate(cases) if c.startswith("2024")]
    keep = fitted["keep"]
    e, _ = S.engineer(X[dev, DAY - 1][:, keep], names, fitted["scales"][DAY])
    _, y, d, p = S.rows(e, Y[dev, DAY - 1][:, keep], HAZ)
    prob = predict(fitted, baseline, X[dev, DAY - 1][:, keep], DAY, PRODUCT)["conus_gbt"][d, p]
    ours = float(np.mean((prob - y) ** 2))
    ref = json.loads(STUDY.read_text())["products"][PRODUCT]["all_supported"]["models"]["conus_gbt"]["brier"]
    return {"archived_source": "research/severe/conus-v1/study/scorecard.json (CONUS study run 44589486745)",
            "cases": [cases[i] for i in dev], "archived_brier": ref, "recomputed_brier": ours,
            "abs_difference": abs(ours - ref), "passes": abs(ours - ref) < 1e-9}


def benchmark_context():
    s = json.loads(WIND_SCORE.read_text())["primary_fresh"]
    out = {"source": "NadoCast Day 2 wind benchmark, score run 45046549803 (213 fresh 2024 days)", "regions": {}}
    pick = lambda m: {"brier": m["brier"], "bss": m["brier_skill_vs_base_rate"], "pod_5pct": m["thresholds"]["5%"]["pod"],
                      "false_alarm_km2_per_day_5pct": m["thresholds"]["5%"]["false_alarm_km2_per_day"],
                      "hits_at_nadocast_5pct_area": m.get("hits_at_nadocast_false_alarm_area", {}).get("5%", {}).get("hits")}
    for name, block in [("conus", s["conus_national_models"])] + list(s["conus_by_region"].items()):
        out["regions"][name] = {"report_points": block["report_points"], "report_days": block["report_days"],
                                "candidate": pick(block["models"]["conus_gbt"]), "nadocast": pick(block["models"]["nadocast"]),
                                "candidate_minus_nadocast_brier_95": block["models"]["conus_gbt"].get("brier_minus_nadocast_95")}
    box = s["regional_box_all_models"]["models"]
    out["regional_box_vs_live_v07"] = {"candidate_minus_live_brier": box["conus_gbt"]["brier_minus_live_v07"],
                                       "candidate_minus_live_brier_95": box["conus_gbt"]["brier_minus_live_v07_95"]}
    return out


def build(a):
    fitted, model_sha = check_frozen(MODELS, MANIFEST)
    baseline = json.loads(BASELINE.read_text())
    out = Path(a.output)
    out.mkdir(parents=True, exist_ok=True)
    coords = fitted["coords"]
    keep = fitted["keep"]
    reg = regions(coords)
    checks = {"reproduction": reproduce_study(fitted, baseline, a.cohort)}
    if not checks["reproduction"]["passes"]:
        raise SystemExit("archived probabilities not reproduced")
    fresh = json.loads(WIND_RULES.read_text())["dates"]["primary_fresh_2024_issue_dates"]
    if any(not d.startswith("2024") for d in fresh):
        raise ValueError("2024 replays only")
    # pass 1: statistics for the locked case-selection rules
    stats = {}
    for c, cc, names, x2, y2 in case_rows(a.conus, fresh):
        if not np.array_equal(cc, coords) or names != fitted["names"]:
            raise ValueError(f"{c}: grid or predictors differ from the frozen model")
        p = gbt(fitted, baseline, x2)
        known = (y2 != 255) & keep
        rep = known & (y2 == 1)
        fl = reg["florida_gulf_south"] & known
        stats[c] = {"report_points": int(rep.sum()), "max": float(np.nanmax(p)),
                    "fl_reports": int((fl & (y2 == 1)).sum()),
                    "fl_area_5pct_no_report": int((fl & (y2 == 0) & (p >= 0.05)).sum()) * SAMPLE_KM2}
    if ACTIVE not in stats:
        raise SystemExit(f"{ACTIVE} missing from the extraction outputs")
    summer = [c for c in stats if c[5:7] in ("05", "06", "07", "08", "09") and c != ACTIVE]
    quiet = min(summer, key=lambda c: (stats[c]["report_points"], stats[c]["max"]))
    weak_pool = [c for c in stats if stats[c]["fl_reports"] == 0 and c not in (ACTIVE, quiet)]
    weak = max(weak_pool, key=lambda c: stats[c]["fl_area_5pct_no_report"])
    picks = [("active", ACTIVE, "Active wind case from the Day 2 benchmark (Ohio Valley to Mid-Atlantic)"),
             ("quiet", quiet, "Quiet case: the warm-season (May-Sep) benchmark day with the fewest wind report points"),
             ("weakness", weak, "Florida/Gulf weakness: the benchmark day with the largest Florida/Gulf area at 5%+ and no Florida/Gulf report")]
    grid = {"coordinates": [[round(float(lo), 5), round(float(la), 5)] for lo, la in coords], "supported": [int(k) for k in keep]}
    gblob = json.dumps(grid, separators=(",", ":")).encode()
    (out / "grid.json").write_bytes(gblob)
    cases = []
    wanted = {c for _, c, _ in picks}
    rows = {c: (x2, y2) for c, cc, names, x2, y2 in case_rows(a.conus, sorted(wanted))}
    for kind, c, why in picks:
        x2, y2 = rows[c]
        p = gbt(fitted, baseline, x2)
        stored = [None if not np.isfinite(v) else round(float(v), 6) for v in p]
        err = float(np.nanmax(np.abs(np.array([np.nan if v is None else v for v in stored], float) - p)))
        if err >= TOL:
            raise SystemExit(f"{c}: published values differ from the model by {err}")
        issue = date.fromisoformat(c)
        from protocol import future_window
        w = future_window(c, DAY)
        reports = [int(i) for i in np.where(keep & (y2 == 1))[0]]
        unknown = [int(i) for i in np.where(keep & (y2 == 255))[0]]
        body = {"id": f"replay-{c}", "kind": "replay", "case_type": kind, "description": why, "issue_date": c,
                "model_init_time": w["model_init_time"], "valid_start": w["valid_start"], "valid_end": w["valid_end"],
                "day": DAY, "hazard": "wind", "probabilities": {"wind": stored},
                "observed": {"definition": "grid samples with a Storm Events Thunderstorm Wind report >= 50 kt within 25 miles during the valid window",
                             "report_sample_indices": reports, "unknown_label_indices": unknown},
                "stats": stats[c], "max_abs_published_minus_model": err}
        blob = json.dumps(body, separators=(",", ":")).encode()
        (out / f"replay-{c}.json").write_bytes(blob)
        cases.append({"id": body["id"], "file": f"replay-{c}.json", "sha256": sha(blob), "kind": "replay", "case_type": kind,
                      "label": {"active": "Active", "quiet": "Quiet", "weakness": "Florida/Gulf weakness"}[kind] + " · " + issue.strftime("%b %-d, %Y"),
                      "description": why, "issue_date": c, "model_init_time": w["model_init_time"],
                      "valid_start": w["valid_start"], "valid_end": w["valid_end"], "report_points": stats[c]["report_points"]})
    current_status = {"status": "not attempted"}
    if a.current_blocker and Path(a.current_blocker).exists():
        current_status = {"status": "unavailable", "blocker": Path(a.current_blocker).read_text()[-1500:]}
    if a.current and Path(a.current).exists():
        current_status = {"status": "available"}
        cur = json.loads(Path(a.current).read_text())
        blob = Path(a.current).read_bytes()
        (out / Path(a.current).name).write_bytes(blob)
        cases.insert(0, {"id": cur["id"], "file": Path(a.current).name, "sha256": sha(blob), "kind": "current",
                         "label": "Current run · " + cur["model_init_time"][:10] + " 12Z", "description": cur["description"],
                         "issue_date": cur["model_init_time"][:10], "model_init_time": cur["model_init_time"],
                         "valid_start": cur["valid_start"], "valid_end": cur["valid_end"], "report_points": None})
    index = {"schema_version": 1, "status": "research_preview", "operational_forecast_eligible": False,
             "product": {"day": DAY, "hazard": "wind", "definition": "Probability of a thunderstorm wind report of at least 50 kt within 25 miles of the sampled grid center during the 24-hour valid window (12Z-12Z)",
                         "cycle": "12Z HRRR, forecast hours 24-48"},
             "available": {"day2": ["wind"]},
             "unavailable_note": "Only Day 2 damaging wind has a national candidate. Day 1 and tornado/hail stay Regional.",
             "model": {"name": "CONUS boosted-tree candidate (frozen research model, not operational)", "file": "research/severe/conus-v1/frozen/models.pkl",
                       "sha256": model_sha, "feature_schema": "hrrr-daily-25mi-v2-future-window", "product": PRODUCT},
             "coverage": {"samples": int(len(coords)), "supported": int(keep.sum()), "outside": int((~keep).sum()),
                          "rule": "Supported = sample within 25 miles of US land (the verified coverage mask). Samples beyond it, and everywhere off the grid, are outside coverage."},
             "grid": {"file": "grid.json", "sha256": sha(gblob)}, "cases": cases, "current_run": current_status,
             "benchmark": benchmark_context(), "checks": checks,
             "built_at": datetime.now(timezone.utc).isoformat(), "protected_2025_outcomes_accessed": False}
    (out / "index.json").write_text(json.dumps(index, indent=1) + "\n")
    print(json.dumps({"cases": [(c.get("case_type", c.get("kind")), c["issue_date"]) for c in cases], "reproduction": checks["reproduction"]}, default=float))


def current(a):
    """Fresh audited extraction of the latest 12Z HRRR Day 2, then the frozen model (no labels)."""
    from audit_extraction import audit
    from extract import extract
    from protocol import future_window
    fitted, model_sha = check_frozen(MODELS, MANIFEST)
    baseline = json.loads(BASELINE.read_text())
    w = future_window(a.issue_date, DAY)
    issue = datetime.fromisoformat(w["model_init_time"])
    dest, raw = Path(a.work) / "day2", Path(a.work) / "raw"
    extra = ROOT / "research/severe/conus-v1/extra-samples.npz"
    extract(issue, dest, raw, budget_mb=4000, days=(DAY,), target_windows=[w], bounds=(-100, -75, 30, 45), extra_samples=extra)
    audit(dest, raw, dest / "raw-audit.json", extra_samples=extra)
    m = json.loads((dest / "manifest.json").read_text())
    with np.load(dest / m["products"][0]["file"], allow_pickle=False) as z:
        x, cc, names = z["features"], z["coordinates"], z["feature_names"].tolist()
    if not np.array_equal(cc, fitted["coords"]) or names != fitted["names"]:
        raise SystemExit("current extraction grid or predictors differ from the frozen model")
    x2 = x[0] if x.ndim == 3 else x
    p = gbt(fitted, baseline, x2)
    body = {"id": "current-" + a.issue_date, "kind": "current",
            "description": "Current research run from today's audited HRRR inputs (no observed reports yet)",
            "model_init_time": w["model_init_time"], "valid_start": w["valid_start"], "valid_end": w["valid_end"],
            "day": DAY, "hazard": "wind", "probabilities": {"wind": [None if not np.isfinite(v) else round(float(v), 6) for v in p]},
            "observed": None, "audit_sha256": digest(dest / "raw-audit.json"), "predictor_sha256": m["products"][0]["sha256"],
            "model_sha256": model_sha, "prepared_at": datetime.now(timezone.utc).isoformat()}
    Path(a.output).write_text(json.dumps(body, separators=(",", ":")))
    print("current run written", w["model_init_time"], w["valid_start"], w["valid_end"])


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("--conus", type=Path, nargs="+", required=True)
    b.add_argument("--cohort", type=Path, required=True)
    b.add_argument("--current", type=Path)
    b.add_argument("--current-blocker", type=Path)
    b.add_argument("--output", type=Path, required=True)
    c = sub.add_parser("current")
    c.add_argument("--issue-date", required=True)
    c.add_argument("--work", type=Path, required=True)
    c.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    {"build": build, "current": current}[a.cmd](a)


if __name__ == "__main__":
    main()
