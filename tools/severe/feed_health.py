#!/usr/bin/env python3
"""Health check for the published daily severe research feed and its publishing runs.

Findings are errors (the job fails) or warnings (reported only):
  * feed      index.json, grid and run files disagree, a run's model is unregistered, or a
              published run is not the lead day it claims to be.
  * freshness Day 1 or Day 2 is missing, or still shows an older initialization after that
              lead day's publication deadline (Day 1 by 12:00 UTC, when its window starts;
              Day 2 by 19:15 UTC, 45 minutes after its last catch-up).
  * runs      the newest completed publishing run failed, was cancelled or timed out
              (an error), or an earlier one did and a later run succeeded (a warning).
  * served    the raw files the viewer downloads differ from git (a warning: the raw CDN can
              lag a few minutes after a push).
"""
import argparse
import hashlib
import json
import sys
import urllib.request
from datetime import datetime, time, timedelta, timezone
from pathlib import Path

DEADLINES = {1: time(12, 0), 2: time(19, 15)}
INIT_HOUR = {1: 6, 2: 12}
BAD_CONCLUSIONS = {"failure", "timed_out", "cancelled", "startup_failure", "action_required"}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def expected_init(day, now):
    """The newest initialization that must be published for this lead day at `now`."""
    date = now.date() if now.timetz().replace(tzinfo=None) >= DEADLINES[day] else now.date() - timedelta(days=1)
    return datetime(date.year, date.month, date.day, INIT_HOUR[day], tzinfo=timezone.utc)


def check_feed(feed, now):
    findings = []
    err = lambda check, message: findings.append({"level": "error", "check": check, "message": message})
    try:
        index = json.loads((feed / "index.json").read_text())
        registry = json.loads((feed / "models.json").read_text())["models"]
    except (OSError, ValueError, KeyError) as error:
        err("feed", f"index.json or models.json unreadable: {error}")
        return findings, {}
    grid = feed / index.get("grid", {}).get("file", "grid.json")
    if not grid.exists() or sha(grid.read_bytes()) != index.get("grid", {}).get("sha256"):
        err("feed", "grid.json is missing or differs from the checksum in index.json")
    runs = {}
    for run in index.get("runs", []):
        path = feed / Path(run.get("file", "")).name
        if not path.exists() or sha(path.read_bytes()) != run.get("sha256"):
            err("feed", f"{run.get('file')} is missing or differs from the checksum in index.json")
            continue
        product = json.loads(path.read_text())
        day = product.get("day")
        if day != run.get("day") or path.name != f"day{day}.json":
            err("feed", f"{path.name} claims Day {day}, index says Day {run.get('day')}")
            continue
        if product.get("model_sha256") not in registry:
            err("feed", f"Day {day} was produced by an unregistered model {product.get('model_sha256')}")
        runs[day] = product
    status = {}
    for day in (1, 2):
        due = expected_init(day, now)
        product = runs.get(day)
        if product is None:
            err("freshness", f"Day {day} is not published")
            status[day] = {"published_init": None, "expected_init": due.isoformat(), "state": "missing"}
            continue
        init = datetime.fromisoformat(product["model_init_time"])
        state = "current" if init >= due else "stale"
        if state == "stale":
            deadline = datetime.combine(due.date(), DEADLINES[day], timezone.utc)
            err("freshness", f"Day {day} still shows the {init:%Y-%m-%d %H}Z run; the {due:%Y-%m-%d %H}Z run "
                             f"was due by {deadline:%Y-%m-%d %H:%M}Z")
        status[day] = {"published_init": product["model_init_time"], "expected_init": due.isoformat(),
                       "prepared_at": product.get("prepared_at"), "valid_end": product.get("valid_end"),
                       "state": state}
    return findings, status


def check_runs(runs, now, lookback_hours=26):
    """`runs` is the GitHub API list of the publishing workflow's runs, newest first or not."""
    findings = []
    since = now - timedelta(hours=lookback_hours)
    completed = sorted((r for r in runs if r.get("status") == "completed"
                        and datetime.fromisoformat(r["created_at"].replace("Z", "+00:00")) >= since),
                       key=lambda r: r["created_at"], reverse=True)
    for position, run in enumerate(completed):
        if run.get("conclusion") not in BAD_CONCLUSIONS:
            continue
        later_success = any(r.get("conclusion") == "success" for r in completed[:position])
        findings.append({
            "level": "warning" if later_success else "error", "check": "runs",
            "message": (f"Publishing run {run.get('id')} ({run.get('event')}, {run['created_at']}) ended "
                        f"{run.get('conclusion')}" + ("; a later run succeeded" if later_success else "")
                        + f": {run.get('html_url', '')}")})
    in_progress = [r for r in runs if r.get("status") != "completed"]
    return findings, {"completed": len(completed), "in_progress": len(in_progress)}


def check_served(feed, raw_base, fetch=None):
    fetch = fetch or (lambda url: urllib.request.urlopen(url, timeout=30).read())
    findings = []
    for name in ("index.json", "day1.json", "day2.json"):
        try:
            served = fetch(f"{raw_base.rstrip('/')}/{name}")
        except Exception as error:  # network errors are reported, never fatal
            findings.append({"level": "warning", "check": "served", "message": f"Could not read served {name}: {error}"})
            continue
        if sha(served) != sha((feed / name).read_bytes()):
            findings.append({"level": "warning", "check": "served",
                             "message": f"Served {name} differs from git (the raw CDN may still be updating)"})
    return findings


def summary(now, status, findings, run_counts):
    lines = [f"## Severe daily feed health, {now:%Y-%m-%d %H:%MZ}", "",
             "| Lead day | Published run | Required run | State |", "|---|---|---|---|"]
    for day in (1, 2):
        s = status.get(day, {})
        lines.append(f"| Day {day} | {s.get('published_init') or 'none'} | {s.get('expected_init', '')} | {s.get('state', 'unknown')} |")
    if run_counts:
        lines += ["", f"Publishing runs in the last 26 h: {run_counts['completed']} completed, "
                      f"{run_counts['in_progress']} still running."]
    lines += ["", "### Findings" if findings else "No problems found."]
    for f in findings:
        lines.append(f"- **{f['level'].upper()}** ({f['check']}): {f['message']}")
    return "\n".join(lines) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--feed", type=Path, default=Path("assets/severe-daily"))
    parser.add_argument("--now", help="ISO time with offset; default is the current UTC time")
    parser.add_argument("--runs", type=Path, help="JSON from the workflow-runs API (object with workflow_runs, or a list)")
    parser.add_argument("--raw-base", help="Base URL of the served feed to compare with git")
    parser.add_argument("--summary", type=Path, help="Append a Markdown report here (e.g. $GITHUB_STEP_SUMMARY)")
    parser.add_argument("--json", type=Path, help="Write the machine-readable result here")
    args = parser.parse_args(argv)
    now = datetime.fromisoformat(args.now) if args.now else datetime.now(timezone.utc)
    if now.tzinfo is None:
        parser.error("--now needs a UTC offset")
    now = now.astimezone(timezone.utc)
    findings, status = check_feed(args.feed, now)
    run_counts = None
    if args.runs:
        data = json.loads(args.runs.read_text())
        run_findings, run_counts = check_runs(data["workflow_runs"] if isinstance(data, dict) else data, now)
        findings += run_findings
    if args.raw_base:
        findings += check_served(args.feed, args.raw_base)
    report = summary(now, status, findings, run_counts)
    print(report)
    for f in findings:
        print(f"::{f['level']} title=Severe feed {f['check']}::{f['message']}")
    if args.summary:
        with open(args.summary, "a") as out:
            out.write(report)
    healthy = not any(f["level"] == "error" for f in findings)
    if args.json:
        args.json.write_text(json.dumps({"checked_at": now.isoformat(), "healthy": healthy,
                                         "days": status, "findings": findings}, indent=2) + "\n")
    return 0 if healthy else 1


if __name__ == "__main__":
    sys.exit(main())
