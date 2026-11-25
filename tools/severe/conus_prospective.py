#!/usr/bin/env python3
"""Prospective archive and scoring for the CONUS Day 2 wind research forecasts.

Rules: research/severe/conus-v1/prospective/RULES.md (committed before the first record).

  record        (called from the daily feed) write one frozen forecast record for an issue date:
                96-date conus_gbt, 728-date candidate, and v0.7 inside its original footprint, all
                from the same audited HRRR inputs, with every checksum and the generation time.
                An existing record is never overwritten.
  ledger        on-time / late / missed / pending status for every issue date since the start.
  score-prelim  score on-time records against SPC preliminary wind reports (early feedback only).
  score-final   rescore the same frozen records against a pinned NOAA Storm Events file.
Preliminary and final scorecards are kept in separate directories and never mixed.
Research only; never touches the live feed, publisher or registry.
"""
import argparse
import csv
import hashlib
import io
import json
import os
import pickle
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from scipy.special import expit

ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = ROOT / "research/severe/conus-v1/prospective"
START = date(2026, 11, 24)
FULLDEV_MODEL = ROOT / "research/severe/conus-v1/fulldev-frozen/model.pkl"
FULLDEV_MANIFEST = ROOT / "research/severe/conus-v1/fulldev-frozen/manifest.json"
EXTRA = ROOT / "research/severe/conus-v1/extra-samples.npz"
BOX = (-100, -75, 30, 45)  # v0.7 original regional footprint
RADIUS_KM = 40.2336
SPC = "https://www.spc.noaa.gov/climo/reports/{}_rpts_filtered_wind.csv"
DAY, HAZ, PRODUCT = 2, 1, "day2_wind"


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def arr_sha(a):
    return hashlib.sha256(np.ascontiguousarray(a).tobytes()).hexdigest()


def in_box(coords):
    w, e, s, n = BOX
    return (coords[:, 0] >= w) & (coords[:, 0] <= e) & (coords[:, 1] >= s) & (coords[:, 1] <= n)


def load_fulldev():
    raw = FULLDEV_MODEL.read_bytes()
    man = json.loads(FULLDEV_MANIFEST.read_text())
    if hashlib.sha256(raw).hexdigest() != man["sha256"]:
        raise ValueError("728-date model does not match its committed hash")
    return pickle.loads(raw), man["sha256"]


def record(issue_date, x_day2, fitted, model_sha, baseline, baseline_path, window, predictor_sha, audit_sha,
           archive=ARCHIVE, now=None):
    """x_day2: raw predictors on the full grid (samples, features)."""
    import phase2_study as S
    from conus_followup import predict
    now = now or datetime.now(timezone.utc)
    out = archive / "forecasts"
    out.mkdir(parents=True, exist_ok=True)
    meta_path, npz_path = out / f"{issue_date}.json", out / f"{issue_date}.npz"
    if meta_path.exists():
        print(f"prospective record for {issue_date} already exists; not overwritten")
        return json.loads(meta_path.read_text())
    keep, coords = fitted["keep"], fitted["coords"]
    xk = x_day2[keep]
    pr = predict(fitted, baseline, xk[None], DAY, PRODUCT)
    big, big_sha = load_fulldev()
    e, _ = S.engineer(xk, big["names"], big["scales_day2"])
    p728 = expit(big["calibration"][0] + big["calibration"][1] * big["tree"].decision_function(e.astype(np.float64)))
    box = in_box(coords[keep])
    v07 = np.where(box, pr["v07_frozen"][0], np.nan)
    lag_probs, lag_meta = lagged_candidates(issue_date, xk, coords, keep)
    np.savez_compressed(npz_path, sample_index=np.nonzero(keep)[0].astype(np.int32),
                        conus_gbt_96=pr["conus_gbt"][0].astype(np.float32), conus_gbt_728=p728.astype(np.float32),
                        v07_frozen_box=v07.astype(np.float32), **lag_probs)
    cutoff = datetime.fromisoformat(window["valid_start"])
    meta = {"issue_date": issue_date, "issue_cycle": window["model_init_time"], "day": DAY, "hazard": "wind",
            "valid_start": window["valid_start"], "valid_end": window["valid_end"],
            "generated_at": now.isoformat(), "cutoff": cutoff.isoformat(), "on_time": now < cutoff,
            "inputs": {"predictor_sha256": predictor_sha, "raw_audit_sha256": audit_sha},
            "models": {"conus_gbt_96": model_sha, "conus_gbt_728": big_sha, "v07_frozen": sha(baseline_path)},
            "grid": {"samples": int(len(coords)), "coords_sha256": arr_sha(np.asarray(coords, dtype="<f8")),
                     "extra_samples_sha256": sha(EXTRA)},
            "coverage": {"supported_samples": int(keep.sum()), "keep_mask_sha256": arr_sha(keep.astype(np.uint8)),
                         "v07_footprint": {"box": BOX, "samples": int(box.sum())}},
            "probabilities": {"file": npz_path.name, "sha256": sha(npz_path)},
            "rules": "research/severe/conus-v1/prospective/RULES.md",
            "lagged_candidates": lag_meta,
            "generator": {"run_id": os.environ.get("GITHUB_RUN_ID"), "workflow": os.environ.get("GITHUB_WORKFLOW"),
                          "event": os.environ.get("GITHUB_EVENT_NAME"), "triggering_actor": os.environ.get("GITHUB_TRIGGERING_ACTOR"),
                          "sha": os.environ.get("GITHUB_SHA")}}
    meta_path.write_text(json.dumps(meta, indent=1) + "\n")
    print(f"prospective record written for {issue_date} (on_time={meta['on_time']})")
    return meta


LAG_ARMS = {"lag_hrrr": "hrrr", "lag_12z18": "hrrr_12z18", "lag_full": "hrrr_lag"}
BASE_MODELS = ("conus_gbt_96", "conus_gbt_728", "v07_frozen_box")


def lagged_candidates(issue_date, xk, coords, keep):
    """Frozen time-lagged research candidates (hrrr-lag/PROSPECTIVE.md). Never stops the main record: a missing,
    late or failed 06Z/12Z input is logged and the three arrays are written as NaN."""
    nan = {k: np.full(int(keep.sum()), np.nan, dtype=np.float32) for k in LAG_ARMS}
    root = ROOT / "research/severe/conus-v1/hrrr-lag/frozen"
    if not (root / "manifest.json").exists():
        return nan, {"status": "not_frozen"}
    try:
        from conus_hrrr_lag import live_lag, load_frozen_arms, predict_arms
        arms = load_frozen_arms(root)
        shas = {k: arms[v][1] for k, v in LAG_ARMS.items()}
        status, feats, lmeta = live_lag(issue_date, np.asarray(coords, dtype=float))
        meta = {"status": status["status"], "detail": {k: v for k, v in status.items() if k not in ("date", "status")},
                "models": shas, "rules": "research/severe/conus-v1/hrrr-lag/PROSPECTIVE.md"}
        if status["status"] != "ok":
            print(f"lagged candidates not issued for {issue_date}: {status}", flush=True)
            return nan, meta
        meta["input_messages"] = len(lmeta["messages"])
        meta["input_sha256"] = hashlib.sha256(json.dumps(lmeta["messages"], sort_keys=True).encode()).hexdigest()
        probs = predict_arms(arms, xk, feats[keep])
        return {k: probs[v].astype(np.float32) for k, v in LAG_ARMS.items()}, meta
    except Exception as e:  # logged; the existing forecast and archive still complete
        print(f"lagged candidates failed for {issue_date}: {e!r}", flush=True)
        return nan, {"status": "failed", "error": repr(e)[:400]}


def issue_dates(today):
    d = START
    while d <= today:
        yield d
        d += timedelta(days=1)


def ledger(a):
    now = datetime.now(timezone.utc)
    today = a.now or now.date()
    rows = []
    for d in issue_dates(today):
        f = a.archive / "forecasts" / f"{d}.json"
        cutoff = datetime(d.year, d.month, d.day, 12, tzinfo=timezone.utc) + timedelta(hours=24)
        if f.exists():
            m = json.loads(f.read_text())
            lag = (m.get("lagged_candidates") or {}).get("status", "not_in_record")
            rows.append({"issue_date": str(d), "status": "on_time" if m["on_time"] else "late", "generated_at": m["generated_at"],
                         "lagged_candidates": lag, "lagged_detail": (m.get("lagged_candidates") or {}).get("detail")})
        else:
            rows.append({"issue_date": str(d), "status": "missed" if now >= cutoff else "pending", "generated_at": None})
    (a.archive / "ledger.json").write_text(json.dumps(rows, indent=1) + "\n")
    counts = {s: sum(r["status"] == s for r in rows) for s in ("on_time", "late", "missed", "pending")}
    counts["lagged_candidates_ok"] = sum(r.get("lagged_candidates") == "ok" for r in rows)
    print(json.dumps(counts))
    return rows


def spc_reports(valid_start, cache):
    """SPC filtered wind reports for the convective day starting at valid_start (12Z-12Z)."""
    tag = valid_start.strftime("%y%m%d")
    path = cache / f"spc-{tag}-wind.csv"
    if not path.exists():
        try:
            with urllib.request.urlopen(urllib.request.Request(SPC.format(tag), headers={"User-Agent": "forecast-ops-research"}), timeout=60) as r:
                path.write_bytes(r.read())
        except urllib.error.HTTPError as err:
            if err.code == 404:
                return None, None
            raise
        except (urllib.error.URLError, TimeoutError) as err:
            print(f"SPC reports not reachable for {tag}: {err}; will retry next run")
            return None, None
    rows = list(csv.DictReader(io.StringIO(path.read_text(errors="replace"))))
    reps = []
    for r in rows:
        try:
            lat, lon = float(r["Lat"]), float(r["Lon"])
        except (KeyError, ValueError):
            continue
        spd = (r.get("Speed") or "").strip().upper()
        mph = int(spd) if spd.isdigit() else None
        reps.append({"lat": lat, "lon": lon, "mph": mph})
    return reps, sha(path)


def labels_from_points(coords, pts):
    if not pts:
        return np.zeros(len(coords), dtype=np.uint8)
    lat1, lon1 = np.radians(coords[:, 1])[:, None], np.radians(coords[:, 0])[:, None]
    lat2 = np.radians([p["lat"] for p in pts])[None]
    lon2 = np.radians([p["lon"] for p in pts])[None]
    h = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    dist = 2 * 6371.0088 * np.arcsin(np.sqrt(np.clip(h, 0, 1)))
    return (dist <= RADIUS_KM).any(1).astype(np.uint8)


def day_sums(meta, probs, y, keep_idx, region_of):
    """Per-model, per-region [n, events, sum sq err, sum p, report points >= 5%, no-report points >= 5%]."""
    out = {}
    for m in probs:
        p = probs[m].astype(np.float64)
        ok = np.isfinite(p)
        out[m] = {}
        for r in sorted(set(region_of.tolist())):
            k = ok & (region_of == r)
            hi = k & (p >= 0.05)
            out[m][r] = [int(k.sum()), float(y[k].sum()), float(((p[k] - y[k]) ** 2).sum()), float(p[k].sum()),
                         int((hi & (y > 0)).sum()), int((hi & (y == 0)).sum())]
    return out


def _regions(coords, keep):
    from conus_calibration import REGIONS, region_index
    from conus_study import regions
    idx = region_index(None, regions(coords), keep)
    return np.array([REGIONS[i] for i in idx])


def scorecard(dirpath, title):
    days = [json.loads(f.read_text()) for f in sorted(dirpath.glob("20*.json"))]
    days = [d for d in days if d.get("status") == "scored"]
    lines = [f"# {title}", "", f"{len(days)} scored on-time forecasts.", ""]
    if not days:
        (dirpath / "scorecard.md").write_text("\n".join(lines + ["No scored days yet."]) + "\n")
        return
    clim = 0.01084
    for variant in days[0]["variants"]:
        lines += [f"## Labels: {variant}", "", "| Model | Region | n | events | BSS vs 0.01084 | mean p | obs rate |", "|---|---|---|---|---|---|---|"]
        tot = {}
        for d in days:
            for m, regs in d["variants"][variant].items():
                for r, v in regs.items():
                    t = tot.setdefault((m, r), np.zeros(4))
                    t += v[:4]
        for m in BASE_MODELS + tuple(LAG_ARMS):
            agg = np.zeros(4)
            for (mm, r), v in sorted(tot.items()):
                if mm != m or v[0] == 0:
                    continue
                agg += v
                n, sy, sse, sp = v
                ref = sy - 2 * clim * sy + n * clim * clim
                lines.append(f"| {m} | {r} | {int(n)} | {int(sy)} | {1 - sse / ref:.3f} | {sp / n:.4f} | {sy / n:.4f} |")
            n, sy, sse, sp = agg
            if n:
                ref = sy - 2 * clim * sy + n * clim * clim
                lines.append(f"| {m} | **all scored** | {int(n)} | {int(sy)} | **{1 - sse / ref:.3f}** | {sp / n:.4f} | {sy / n:.4f} |")
        lines.append("")
    lines += lagged_section(days)
    lines.append("v07_frozen_box covers only the original regional box. BSS uses a fixed climatology, so regions with no reports score trivially high. Days are few; read as monitoring, not a verdict.")
    (dirpath / "scorecard.md").write_text("\n".join(lines) + "\n")


def lagged_section(days):
    """Paired comparison of the frozen time-lagged candidates (hrrr-lag/PROSPECTIVE.md): only days where all three
    arms were issued on time. National and Florida/Gulf are reported separately."""
    from conus_followup import SAMPLE_KM2
    L = ["## Time-lagged HRRR research candidates (paired dates only)", ""]
    for variant in days[0]["variants"]:
        paired = [d for d in days if all(sum(v[0] for v in d["variants"][variant].get(k, {}).values()) > 0 for k in LAG_ARMS)]
        L += [f"### Labels: {variant}: {len(paired)} paired days", ""]
        if not paired:
            L += ["No paired days yet.", ""]
            continue
        for scope, regs in (("national", None), ("florida_gulf_south", "florida_gulf_south")):
            arr = {k: np.array([[sum(v[i] for r, v in d["variants"][variant][k].items() if regs in (None, r)) for i in range(6)]
                                for d in paired]) for k in LAG_ARMS}
            n = arr["lag_hrrr"][:, 0]
            L += [f"**{scope}** ({int(n.sum()):,} points, {int(arr['lag_hrrr'][:, 1].sum())} report points)", "",
                  "| Arm | Brier | mean p / obs | report pts ≥5% | false-alarm area ≥5%, km² |", "|---|---|---|---|---|"]
            for k in LAG_ARMS:
                a = arr[k]
                obs = a[:, 1].sum()
                L.append(f"| {k} | {a[:, 2].sum() / a[:, 0].sum():.6f} | {(a[:, 3].sum() / obs) if obs else float('nan'):.3f} | "
                         f"{int(a[:, 4].sum())} | {a[:, 5].sum() * SAMPLE_KM2:,.0f} |")
            rng = np.random.default_rng(20261125)
            for m1, m2 in (("lag_full", "lag_hrrr"), ("lag_full", "lag_12z18")):
                d1, d2 = arr[m1][:, 2], arr[m2][:, 2]
                pt = (d1.sum() - d2.sum()) / n.sum()
                bs = [((d1[j].sum() - d2[j].sum()) / n[j].sum()) for j in (rng.integers(0, len(n), len(n)) for _ in range(2000))]
                L.append(f"- Brier {m1} − {m2}: {pt:+.6f} (95% whole-date interval {np.percentile(bs, 2.5):+.6f} to {np.percentile(bs, 97.5):+.6f})")
            L.append("")
    return L


def score_prelim(a):
    from conus_calibration import check_frozen
    fitted, _ = check_frozen(ROOT / "research/severe/conus-v1/frozen/models.pkl", ROOT / "research/severe/conus-v1/frozen/manifest.json")
    coords, keep = fitted["coords"], fitted["keep"]
    reg = _regions(coords, keep)
    out = a.archive / "prelim"
    out.mkdir(parents=True, exist_ok=True)
    cache = a.cache
    cache.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)
    for f in sorted((a.archive / "forecasts").glob("20*.json")):
        meta = json.loads(f.read_text())
        dest = out / f.name
        if dest.exists() and json.loads(dest.read_text()).get("status") == "scored":
            continue
        if not meta["on_time"]:
            dest.write_text(json.dumps({"issue_date": meta["issue_date"], "status": "excluded_late"}, indent=1) + "\n")
            continue
        vs, ve = datetime.fromisoformat(meta["valid_start"]), datetime.fromisoformat(meta["valid_end"])
        if now < ve + timedelta(hours=a.wait_hours):
            continue
        npz = f.with_suffix(".npz")
        if sha(npz) != meta["probabilities"]["sha256"]:
            raise ValueError(f"{npz}: probabilities changed after archiving")
        reps, rsha = spc_reports(vs, cache)
        if reps is None:
            dest.write_text(json.dumps({"issue_date": meta["issue_date"], "status": "reports_unavailable", "checked_at": now.isoformat()}, indent=1) + "\n")
            continue
        with np.load(npz) as z:
            probs = {k: z[k] for k in BASE_MODELS + tuple(LAG_ARMS) if k in z.files}
            idx = z["sample_index"]
        c = np.asarray(coords)[idx]
        variants = {"spc_all_wind": [r for r in reps], "spc_ge58mph": [r for r in reps if r["mph"] is not None and r["mph"] >= 58]}
        res = {"issue_date": meta["issue_date"], "status": "scored", "scored_at": now.isoformat(), "source": SPC.format(vs.strftime("%y%m%d")),
               "source_sha256": rsha, "reports": {k: len(v) for k, v in variants.items()}, "variants": {}}
        for k, pts in variants.items():
            y = labels_from_points(c, pts).astype(np.float64)
            res["variants"][k] = day_sums(meta, probs, y, idx, reg)
        dest.write_text(json.dumps(res, indent=1) + "\n")
        print(f"prelim scored {meta['issue_date']}: {res['reports']}")
    scorecard(out, "Preliminary scorecard (SPC filtered wind reports; early feedback only)")


def score_final(a):
    """Rescore the same frozen records against a pinned NOAA Storm Events file (--source, --source-sha256).
    Only windows that end before the file's coverage date are scored."""
    import gzip
    from conus_calibration import check_frozen
    from labels import label_window, normalize
    if sha(a.source) != a.source_sha256:
        raise ValueError("Storm Events file does not match the pinned SHA-256")
    fitted, _ = check_frozen(ROOT / "research/severe/conus-v1/frozen/models.pkl", ROOT / "research/severe/conus-v1/frozen/manifest.json")
    coords, keep = fitted["coords"], fitted["keep"]
    reg = _regions(coords, keep)
    with gzip.open(a.source, "rt", newline="") as fh:
        events, stats = normalize(csv.DictReader(fh))
    covered = datetime.fromisoformat(a.covered_through)
    out = a.archive / "final"
    out.mkdir(parents=True, exist_ok=True)
    for f in sorted((a.archive / "forecasts").glob("20*.json")):
        meta = json.loads(f.read_text())
        dest = out / f.name
        if dest.exists() or not meta["on_time"]:
            continue
        vs, ve = datetime.fromisoformat(meta["valid_start"]), datetime.fromisoformat(meta["valid_end"])
        if ve > covered:
            continue
        npz = f.with_suffix(".npz")
        if sha(npz) != meta["probabilities"]["sha256"]:
            raise ValueError(f"{npz}: probabilities changed after archiving")
        with np.load(npz) as z:
            probs = {k: z[k] for k in BASE_MODELS + tuple(LAG_ARMS) if k in z.files}
            idx = z["sample_index"]
        labels, counts = label_window(np.asarray(coords)[idx], events, vs, ve)
        y = labels[:, HAZ].astype(np.float64)
        known = labels[:, HAZ] != 255
        for k in probs:
            probs[k] = np.where(known, probs[k], np.nan)
        res = {"issue_date": meta["issue_date"], "status": "scored", "source": a.source.name, "source_sha256": a.source_sha256,
               "variants": {"storm_events_ge50kt": day_sums(meta, probs, np.where(known, y, 0), idx, reg)}}
        dest.write_text(json.dumps(res, indent=1) + "\n")
    scorecard(out, "Final scorecard (NOAA Storm Events, >=50 kt, same rules as training)")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    l = sub.add_parser("ledger")
    l.add_argument("--archive", type=Path, default=ARCHIVE)
    l.add_argument("--now", default=None)
    s = sub.add_parser("score-prelim")
    s.add_argument("--archive", type=Path, default=ARCHIVE)
    s.add_argument("--cache", type=Path, default=Path("tests/out/spc"))
    s.add_argument("--wait-hours", type=float, default=36.0)
    f = sub.add_parser("score-final")
    f.add_argument("--archive", type=Path, default=ARCHIVE)
    f.add_argument("--source", type=Path, required=True)
    f.add_argument("--source-sha256", required=True)
    f.add_argument("--covered-through", required=True, help="ISO time through which the Storm Events file is complete")
    a = p.parse_args()
    if a.cmd == "ledger":
        a.now = date.fromisoformat(a.now) if a.now else None
    {"ledger": ledger, "score-prelim": score_prelim, "score-final": score_final}[a.cmd](a)


if __name__ == "__main__":
    main()
