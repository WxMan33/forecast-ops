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

Archive: one release per month (severe-guidance-YYYY-MM) in the PRIVATE archive repository, one
asset per date and lead (severe-guidance-YYYY-MM-DD-dayN.tar.gz). Publishing is safe to retry: an
identical existing asset is accepted, a different one is a checksum conflict that is reported and
never overwritten, and every upload is verified by downloading it again.

  record   --output DIR --day N --event EVENT --started-at ISO [--run-id ID --run-attempt N --commit SHA]
  bundle   --output DIR --dest FILE
  publish  --bundle FILE --repository OWNER/REPO --date YYYY-MM-DD --day N [--result FILE]
  coverage --records DIR --start YYYY-MM-DD --end YYYY-MM-DD [--day N]
"""
import argparse
import gzip
import hashlib
import io
import json
import os
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


def bundle(output, dest):
    """A byte-reproducible tar.gz of the collection directory (sorted names, zeroed metadata)."""
    output, dest = Path(output), Path(dest)
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
    return {"file": dest.name, "sha256": sha256(dest), "bytes": dest.stat().st_size, "members": len(files)}


def asset_name(date, day):
    Date.fromisoformat(date)
    if day not in (1, 2):
        raise ValueError("Day 1 or Day 2")
    return f"severe-guidance-{date}-day{day}.tar.gz"


def release_tag(date):
    return f"severe-guidance-{date[:7]}"


def gh(*args, capture=True, check=True):
    result = subprocess.run(["gh", *args], capture_output=capture, text=True)
    if check and result.returncode:
        raise RuntimeError(f"gh {' '.join(args[:3])} failed: {result.stderr.strip()}")
    return result


def publish(bundle_path, repository, date, day):
    """Upload once, accept an identical copy, never overwrite a different one, verify by download."""
    bundle_path = Path(bundle_path)
    name, tag = asset_name(date, day), release_tag(date)
    if bundle_path.name != name:
        raise ValueError(f"Bundle must be named {name}")
    local = sha256(bundle_path)
    private = gh("repo", "view", repository, "--json", "isPrivate", "--jq", ".isPrivate", check=False)
    if private.returncode or private.stdout.strip() != "true":
        raise ValueError(f"The guidance archive must be a private, readable repository: {repository}")
    if gh("release", "view", tag, "--repo", repository, check=False).returncode:
        made = gh("release", "create", tag, "--repo", repository, "--title", f"Severe research guidance {date[:7]}",
                  "--notes", "Research-only HRRR/RRFS/NBM predictors, one asset per date and lead. Not a forecast.",
                  check=False)
        if made.returncode and gh("release", "view", tag, "--repo", repository, check=False).returncode:
            raise RuntimeError(f"Could not create release {tag}: {made.stderr.strip()}")  # not a creation race
    result = {"repository": repository, "release": tag, "asset": name, "local_sha256": local}
    with tempfile.TemporaryDirectory() as tmp:
        existing = gh("release", "download", tag, "--repo", repository, "--pattern", name, "--dir", tmp, check=False)
        copy = Path(tmp) / name
        if existing.returncode == 0 and copy.exists():
            remote = sha256(copy)
            if remote == local:
                return {**result, "outcome": "identical_existing", "remote_sha256": remote, "verified": True}
            return {**result, "outcome": "checksum_conflict", "remote_sha256": remote, "verified": False}
        gh("release", "upload", tag, str(bundle_path), "--repo", repository)
        gh("release", "download", tag, "--repo", repository, "--pattern", name, "--dir", tmp, "--clobber")
        remote = sha256(copy)
        if remote != local:
            raise RuntimeError(f"Uploaded {name} reads back as {remote}, expected {local}")
        return {**result, "outcome": "uploaded", "remote_sha256": remote, "verified": True}


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
            out = publish(a.bundle, a.repository, a.date, a.day)
        except (ValueError, RuntimeError) as error:
            out = {"outcome": "error", "error": str(error)}
        if a.result:
            Path(a.result).write_text(json.dumps(out, indent=1) + "\n")
        print(json.dumps(out))
        if out["outcome"] == "checksum_conflict":
            print(f"::error::Archive already holds a different {out['asset']} "
                  f"({out['remote_sha256']} vs {out['local_sha256']}); not overwritten")
            return 3
        if out["outcome"] == "error":
            print(f"::error::Archive publish failed: {out['error']}")
            return 1
        return 0
    print(json.dumps(coverage(a.records, a.start, a.end, (a.day,) if a.day else (1, 2))["summary"], indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
