#!/usr/bin/env python3
"""Run records, deterministic bundles, safe archive publishing and coverage for the research
guidance collector (tools/severe/collect_guidance.py). Research only; never touches the feed.

Two kinds of evidence are kept apart:
  * timing evidence: each needed hour is classed against the production deadline by the later
    S3 LastModified of its GRIB file and index (tools/severe/guidance.py). It does not depend on
    when this job ran.
  * collection evidence: when this job was scheduled, when it actually started and fetched, and
    whether it was a scheduled run at all. Only a scheduled run that started within
    SCHEDULE_TOLERANCE of its slot counts toward measured on-time coverage; delayed, manual and
    backfilled runs keep their data but are excluded, and a date/lead with no eligible record is
    counted as missed. Coverage therefore cannot be raised by re-running old dates.

Archive: one release per month (severe-guidance-YYYY-MM) in the PRIVATE archive repository with
one data asset per date and lead (severe-guidance-YYYY-MM-DD-dayN.tar.gz) and one receipt per
collection attempt (...-dayN.run-RUNID-ATTEMPT.json). Retries are compared by data identity (the
forecast data and S3 timing evidence; data-identity.json), not by bundle bytes, which change with
every attempt's own times: the same data is a duplicate, different data is a conflict that is
recorded in that attempt's receipt and never overwrites the data asset. Every upload is verified
by downloading it again.

  record   --output DIR --day N --event EVENT --started-at ISO [--run-id ID --run-attempt N --commit SHA]
  bundle   --output DIR --dest FILE
  publish  --bundle FILE --record run.json --repository OWNER/REPO --date YYYY-MM-DD --day N [--result FILE]
  coverage --records DIR --start YYYY-MM-DD --end YYYY-MM-DD [--day N]
"""
import argparse
import gzip
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
from datetime import date as Date, datetime, timedelta, timezone
from pathlib import Path

SCHEDULE = {1: (9, 40), 2: (15, 40)}  # UTC, 10 minutes after each production deadline
SCHEDULE_TOLERANCE = timedelta(minutes=60)
SOURCES = ("hrrr", "rrfs", "nbm")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def scheduled_for(date, day):
    hour, minute = SCHEDULE[day]
    return datetime.fromisoformat(date).replace(hour=hour, minute=minute, tzinfo=timezone.utc)


def run_kind(date, day, event, started_at):
    """(kind, coverage_eligible, reason) for one collection run."""
    slot = scheduled_for(date, day)
    started = datetime.fromisoformat(started_at)
    if event == "schedule":
        if slot <= started <= slot + SCHEDULE_TOLERANCE:
            return "scheduled", True, "started within the scheduled slot"
        return "delayed_scheduled", False, f"started {started.isoformat()} outside {slot.isoformat()} + {SCHEDULE_TOLERANCE}"
    return "manual_or_backfill", False, f"{event} run; collected data kept, excluded from on-time coverage"


def source_on_time(entry):
    """True only if the source completed and every needed hour was on time by S3 timestamps."""
    avail = entry.get("availability") or {}
    counts = avail.get("counts") or {}
    total = sum(counts.values()) if counts else 0
    return entry.get("status") == "complete" and total > 0 and counts.get("on_time") == total


def record(output, day, event, started_at, run_id=None, run_attempt=None, commit=None, now=None):
    output = Path(output)
    collection = json.loads((output / "collection.json").read_text())
    guidance_manifest = output / "guidance" / "manifest.json"
    guidance = json.loads(guidance_manifest.read_text())["sources"] if guidance_manifest.exists() else {}
    window = collection["window"]
    date = window["model_init_time"][:10]
    kind, eligible, reason = run_kind(date, day, event, started_at)
    sources = {}
    for name in SOURCES:
        entry = dict(collection.get("sources", {}).get(name, {"status": "not_run"}))
        if name in guidance:
            entry["availability"] = guidance[name].get("availability")
        avail = entry.get("availability") or {}
        sources[name] = {"status": entry.get("status", "not_run"), "error": entry.get("error"),
                         "counts": avail.get("counts"), "listing_observed_at": avail.get("listing_observed_at"),
                         "on_time": source_on_time(entry)}
    run ={"schema_version": 1, "date": date, "day": day, "window": window,
           "timing_evidence": "Later S3 LastModified of GRIB and index per hour vs the production deadline",
           "collection": {"event": event, "run_kind": kind, "coverage_eligible": eligible, "reason": reason,
                          "scheduled_for": scheduled_for(date, day).isoformat(), "started_at": started_at,
                          "collection_started_at": collection.get("started_at"),
                          "collection_completed_at": collection.get("completed_at"),
                          "recorded_at": (now or datetime.now(timezone.utc)).isoformat(),
                          "run_id": run_id, "run_attempt": run_attempt, "commit": commit},
           "collection_status": collection.get("status"),
           "sources": sources,
           "all_sources_on_time": all(s["on_time"] for s in sources.values())}
    (output / "run.json").write_text(json.dumps(run, indent=1) + "\n")
    return run


def array_digests(path):
    """SHA-256 of each array's name, dtype, shape and values. Zip timestamps inside .npz files
    differ from run to run, so file bytes cannot identify the data."""
    import numpy as np
    out = {}
    with np.load(path, allow_pickle=False) as data:
        for name in sorted(data.files):
            a = np.ascontiguousarray(data[name])
            h = hashlib.sha256(f"{name}|{a.dtype.str}|{a.shape}|".encode())
            h.update(a.tobytes())
            out[name] = h.hexdigest()
    return out


def hour_identity(row):
    """Object identity and S3 timing evidence for one forecast hour; no fetch or listing times."""
    def obj(o):
        return None if o is None else {k: o.get(k) for k in ("etag", "size", "last_modified")}
    return {"f": row["forecast_hour"], "key": row["key"], "grib": obj(row.get("grib")),
            "index": obj(row.get("index")), "pair_last_modified": row.get("pair_last_modified"),
            "status": row["status"]}


def data_identity(output):
    """What the collection found, independent of who ran it, when, or how often.

    Included: the window; per source its status, every needed hour's object identity and S3
    timing class, every input message's byte range and SHA-256, and every feature array.
    Excluded: run id/attempt/commit, job and fetch times, listing time, receipts' retrieval times."""
    output = Path(output)
    collection = json.loads((output / "collection.json").read_text())
    guidance_path = output / "guidance" / "manifest.json"
    guidance = json.loads(guidance_path.read_text())["sources"] if guidance_path.exists() else {}
    identity = {"window": collection["window"], "sources": {}}
    hrrr = collection.get("sources", {}).get("hrrr", {})
    hrrr_manifest = output / "hrrr" / "manifest.json"
    identity["sources"]["hrrr"] = {
        "status": hrrr.get("status", "not_run"), "error": hrrr.get("error"),
        "hours": [hour_identity(r) for r in (hrrr.get("availability") or {}).get("hours", [])],
        "messages": sorted(([r["forecast_hour"], r["field"], r["start"], r["end"], r["sha256"]]
                            for r in json.loads(hrrr_manifest.read_text())["source_receipts"])
                           if hrrr_manifest.exists() else [])}
    for name in ("rrfs", "nbm"):
        entry = guidance.get(name, {})
        identity["sources"][name] = {
            "status": entry.get("status", "not_run"), "error": entry.get("error"),
            "cycle": entry.get("cycle"),
            "hours": [hour_identity(r) for r in (entry.get("availability") or {}).get("hours", [])],
            "messages": sorted([m["forecast_hour"], m["field"], m["start"], m["end"], m["sha256"]]
                               for m in entry.get("messages", []))}
    identity["features"] = {str(p.relative_to(output)): array_digests(p) for p in sorted(output.rglob("*.npz"))}
    canonical = json.dumps(identity, sort_keys=True, separators=(",", ":")).encode()
    return {"schema_version": 1, "data_sha256": hashlib.sha256(canonical).hexdigest(), "identity": identity}


def bundle(output, dest):
    """A byte-reproducible tar.gz of the collection directory (sorted names, zeroed metadata)."""
    output, dest = Path(output), Path(dest)
    ident = data_identity(output)
    (output / "data-identity.json").write_text(json.dumps(ident, indent=1, sort_keys=True) + "\n")
    files = sorted(p for p in output.rglob("*") if p.is_file())
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w", format=tarfile.PAX_FORMAT) as tar:
        for path in files:
            info = tarfile.TarInfo(str(path.relative_to(output)))
            info.size, info.mtime, info.mode = path.stat().st_size, 0, 0o644
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            with open(path, "rb") as f:
                tar.addfile(info, f)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "wb") as out, gzip.GzipFile(filename="", mode="wb", fileobj=out, mtime=0) as gz:
        gz.write(raw.getvalue())
    return {"file": dest.name, "sha256": sha256(dest), "bytes": dest.stat().st_size, "members": len(files),
            "data_sha256": ident["data_sha256"]}


def asset_name(date, day):
    Date.fromisoformat(date)
    if day not in (1, 2):
        raise ValueError("Day 1 or Day 2")
    return f"severe-guidance-{date}-day{day}.tar.gz"


def receipt_name(date, day, run_id, attempt):
    if not str(run_id).isdigit() or not str(attempt).isdigit():
        raise ValueError("A numeric run id and attempt are required for an attempt receipt")
    return asset_name(date, day).replace(".tar.gz", f".run-{run_id}-{attempt}.json")


def bundle_data_sha256(path):
    with tarfile.open(path, "r:gz") as tar:
        member = tar.extractfile("data-identity.json")
        if member is None:
            raise ValueError(f"{Path(path).name} has no data-identity.json")
        return json.loads(member.read())["data_sha256"]


def release_tag(date):
    return f"severe-guidance-{date[:7]}"


def gh(*args, capture=True, check=True):
    result = subprocess.run(["gh", *args], capture_output=capture, text=True)
    if check and result.returncode:
        raise RuntimeError(f"gh {' '.join(args[:3])} failed: {result.stderr.strip()}")
    return result


def upload_verified(tag, path, repository, tmp):
    """Upload a new asset and prove it by downloading it again; never replace an existing one."""
    gh("release", "upload", tag, str(path), "--repo", repository)
    back = Path(tmp) / "readback"
    back.mkdir(exist_ok=True)
    gh("release", "download", tag, "--repo", repository, "--pattern", path.name, "--dir", str(back), "--clobber")
    remote = sha256(back / path.name)
    if remote != sha256(path):
        raise RuntimeError(f"Uploaded {path.name} reads back as {remote}, expected {sha256(path)}")
    return remote


def publish(bundle_path, repository, date, day, run_record, receipt_dir=None):
    """Archive one attempt.

    Data: the first complete, verified bundle for a date and lead is the data asset. Later complete
    attempts are
    compared by data identity (forecast data and S3 timing evidence only), not by bundle bytes:
    the same data is accepted as a duplicate, different data is a conflict and never overwrites.
    Incomplete attempts, and complete attempts whose data conflicts with the canonical asset,
    keep their own bundle under an attempt-specific name.
    Attempt: every attempt also stores its own receipt (run record, data identity, outcome), so
    each attempt's timing and collection evidence is kept, including conflicting ones."""
    bundle_path = Path(bundle_path)
    name, tag = asset_name(date, day), release_tag(date)
    if bundle_path.name != name:
        raise ValueError(f"Bundle must be named {name}")
    collection = run_record["collection"]
    receipt_file = receipt_name(date, day, collection["run_id"], collection["run_attempt"])
    complete = (run_record["collection_status"] == "complete"
                and all(run_record["sources"][source]["status"] == "complete" for source in SOURCES))
    target_name = name if complete else Path(receipt_file).with_suffix(".tar.gz").name
    local_data = bundle_data_sha256(bundle_path)
    private = gh("repo", "view", repository, "--json", "isPrivate", "--jq", ".isPrivate", check=False)
    if private.returncode or private.stdout.strip() != "true":
        raise ValueError(f"The guidance archive must be a private, readable repository: {repository}")
    if gh("release", "view", tag, "--repo", repository, check=False).returncode:
        made = gh("release", "create", tag, "--repo", repository, "--title", f"Severe research guidance {date[:7]}",
                  "--notes", "Research-only HRRR/RRFS/NBM predictors, with one canonical asset per date and lead "
                             "and separate receipts and incomplete bundles per attempt.", check=False)
        if made.returncode and gh("release", "view", tag, "--repo", repository, check=False).returncode:
            raise RuntimeError(f"Could not create release {tag}: {made.stderr.strip()}")
    result = {"repository": repository, "release": tag, "asset": target_name, "receipt": receipt_file,
              "local_data_sha256": local_data, "local_bundle_sha256": sha256(bundle_path)}
    with tempfile.TemporaryDirectory() as tmp:
        existing = gh("release", "download", tag, "--repo", repository, "--pattern", target_name, "--dir", tmp,
                      check=False)
        copy = Path(tmp) / target_name
        if existing.returncode == 0 and copy.exists():
            remote_data = bundle_data_sha256(copy)
            result.update(remote_data_sha256=remote_data, remote_bundle_sha256=sha256(copy),
                          outcome="duplicate_data" if remote_data == local_data else "data_conflict")
            if result["outcome"] == "data_conflict":
                # Keep the conflicting bundle too, under this attempt's own name; the canonical
                # asset is never replaced.
                attempt_name = Path(receipt_file).with_suffix(".tar.gz").name
                held = Path(tmp) / "attempt"
                held.mkdir()
                if gh("release", "download", tag, "--repo", repository, "--pattern", attempt_name, "--dir",
                      str(held), check=False).returncode == 0 and (held / attempt_name).exists():
                    if bundle_data_sha256(held / attempt_name) != local_data:
                        raise RuntimeError(f"A different bundle {attempt_name} already exists for this attempt")
                    result["attempt_bundle_sha256"] = sha256(held / attempt_name)
                else:
                    upload = Path(tmp) / attempt_name
                    shutil.copyfile(bundle_path, upload)
                    result["attempt_bundle_sha256"] = upload_verified(tag, upload, repository, tmp)
                result["attempt_bundle"] = attempt_name
        else:
            upload = bundle_path
            if not complete:
                upload = Path(tmp) / target_name
                shutil.copyfile(bundle_path, upload)
            remote = upload_verified(tag, upload, repository, tmp)
            result.update(remote_data_sha256=local_data, remote_bundle_sha256=remote,
                          outcome="uploaded" if complete else "uploaded_incomplete")
        receipt = {"schema_version": 1, "kind": "collection_attempt_receipt", "data_asset": target_name,
                   "outcome": result["outcome"], "data_sha256": local_data,
                   "archived_data_sha256": result["remote_data_sha256"],
                   "attempt_bundle_sha256": result["local_bundle_sha256"], "run": run_record}
        if "attempt_bundle" in result:
            receipt["conflict_bundle"] = result["attempt_bundle"]
        receipt_path = Path(receipt_dir or tmp) / receipt_file
        receipt_path.write_text(json.dumps(receipt, indent=1, sort_keys=True) + "\n")
        prior = Path(tmp) / "prior"
        prior.mkdir()
        if gh("release", "download", tag, "--repo", repository, "--pattern", receipt_file, "--dir", str(prior),
              check=False).returncode == 0 and (prior / receipt_file).exists():
            stored = json.loads((prior / receipt_file).read_text())
            # Re-publishing the same attempt is fine; only its outcome wording can differ.
            if stored.get("run") != run_record or stored.get("data_sha256") != local_data:
                raise RuntimeError(f"A different receipt {receipt_file} already exists for this attempt")
            result["receipt_already_recorded"] = True
        else:
            upload_verified(tag, receipt_path, repository, tmp)
        result["verified"] = True
        return result


def coverage(records, start, end, days=(1, 2)):
    """Measured on-time coverage: every scheduled date and lead is in the denominator."""
    by_slot = {}
    for path in sorted(Path(records).glob("*.json")):
        run = json.loads(path.read_text())
        by_slot.setdefault((run["date"], run["day"]), []).append(run)
    rows, d = [], Date.fromisoformat(start)
    while d <= Date.fromisoformat(end):
        for day in days:
            runs = by_slot.get((d.isoformat(), day), [])
            eligible = [r for r in runs if r["collection"]["coverage_eligible"]]
            if eligible:
                best = eligible[0]
                state = "on_time" if best["all_sources_on_time"] else "late_or_incomplete"
                per_source = {s: best["sources"][s]["on_time"] for s in SOURCES}
            else:
                state = "backfilled_excluded" if runs else "missed"
                per_source = {s: False for s in SOURCES}
            rows.append({"date": d.isoformat(), "day": day, "state": state, "sources_on_time": per_source,
                         "records": len(runs)})
        d += timedelta(days=1)
    summary = {}
    for day in days:
        mine = [r for r in rows if r["day"] == day]
        summary[f"day{day}"] = {"scheduled": len(mine),
                                **{s: sum(r["state"] == s for r in mine)
                                   for s in ("on_time", "late_or_incomplete", "missed", "backfilled_excluded")},
                                "all_sources_on_time_rate": round(sum(r["state"] == "on_time" for r in mine) / len(mine), 4)
                                if mine else None,
                                "per_source_on_time": {s: sum(r["sources_on_time"][s] for r in mine) for s in SOURCES}}
    return {"start": start, "end": end, "rows": rows, "summary": summary}


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="command", required=True)
    r = sub.add_parser("record")
    r.add_argument("--output", required=True)
    r.add_argument("--day", type=int, choices=(1, 2), required=True)
    r.add_argument("--event", required=True)
    r.add_argument("--started-at", required=True)
    r.add_argument("--run-id")
    r.add_argument("--run-attempt")
    r.add_argument("--commit")
    b = sub.add_parser("bundle")
    b.add_argument("--output", required=True)
    b.add_argument("--dest", required=True)
    u = sub.add_parser("publish")
    u.add_argument("--bundle", required=True)
    u.add_argument("--repository", required=True)
    u.add_argument("--date", required=True)
    u.add_argument("--day", type=int, choices=(1, 2), required=True)
    u.add_argument("--record", required=True, help="run.json from the record command")
    u.add_argument("--receipt-dir", help="Also keep the attempt receipt here")
    u.add_argument("--result")
    c = sub.add_parser("coverage")
    c.add_argument("--records", required=True)
    c.add_argument("--start", required=True)
    c.add_argument("--end", required=True)
    c.add_argument("--day", type=int, choices=(1, 2))
    a = p.parse_args(argv)
    if a.command == "record":
        out = record(a.output, a.day, a.event, a.started_at, a.run_id, a.run_attempt, a.commit)
        print(json.dumps({k: out[k] for k in ("date", "day", "collection_status", "all_sources_on_time")} |
                         {"run_kind": out["collection"]["run_kind"], "coverage_eligible": out["collection"]["coverage_eligible"]}))
        return 0
    if a.command == "bundle":
        print(json.dumps(bundle(a.output, a.dest)))
        return 0
    if a.command == "publish":
        try:
            out = publish(a.bundle, a.repository, a.date, a.day, json.loads(Path(a.record).read_text()),
                          a.receipt_dir)
        except (ValueError, RuntimeError) as error:
            out = {"outcome": "error", "error": str(error)}
        if a.result:
            Path(a.result).write_text(json.dumps(out, indent=1) + "\n")
        print(json.dumps(out))
        if out["outcome"] == "data_conflict":
            print(f"::error::Archive already holds different forecast data for {out['asset']} "
                  f"({out['remote_data_sha256']} vs {out['local_data_sha256']}); not overwritten. "
                  f"This attempt's bundle {out.get('attempt_bundle')} and receipt {out['receipt']} record the conflict.")
            return 3
        if out["outcome"] == "error":
            print(f"::error::Archive publish failed: {out['error']}")
            return 1
        return 0
    print(json.dumps(coverage(a.records, a.start, a.end, (a.day,) if a.day else (1, 2))["summary"], indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
