#!/usr/bin/env python3
"""Restore pinned severe rebuild inputs, verified against research/severe/rebuild-archive.json.

Locations (exactly one):
  --repository OWNER/REPO  the PRIVATE archive's release `severe-rebuild-inputs-v1`; a public
                           repository is refused before anything is downloaded
  --artifact-dir DIR       a folder of the original ZIPs, e.g. the verified private backup
  --actions                the original Actions run (only until its retention ends)
Every selected ZIP must match its pinned size and SHA-256 before anything is extracted, and
extraction refuses absolute or escaping paths. Layout matches actions/download-artifact: a
single --case, or labels, extracts straight into --output; a whole cohort extracts each case
into --output/<artifact-name>/.
"""
import argparse
from contextlib import ExitStack
import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path, PurePosixPath
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "research/severe/rebuild-archive.json"
TAG = "severe-rebuild-inputs-v1"
SOURCES = {
    "v05": (42321856909, "severe-history-v05-"),
    "v07": (43901185832, "severe-history-v07-"),
}
LABELS = "43901185832--severe-labels-v07.zip"


def select(source, case, root=ROOT):
    if source == "labels":
        return [LABELS]
    run, prefix = SOURCES[source]
    prefix = f"{run}--{prefix}"
    cohort = json.loads((root / f"research/severe/cohort-{source}.json").read_text())
    names = {date: prefix + date + ".zip" for date in cohort["cases"]}
    if case:
        if not re.fullmatch(r"202[234]-\d{2}-\d{2}", case):
            raise ValueError("Case must be a frozen 2022–2024 date")
        if case not in names:
            raise ValueError(f"Case {case} is absent from the frozen {source} cohort")
        return [names[case]]
    return sorted(names.values())


def run_and_artifact(name):
    run, artifact = name[:-4].split("--", 1)
    return run, artifact


def download_private(repository, names, folder):
    visibility = subprocess.run(["gh", "repo", "view", repository, "--json", "isPrivate", "--jq", ".isPrivate"],
                                capture_output=True, text=True)
    if visibility.returncode or visibility.stdout.strip() != "true":
        raise ValueError(f"The severe input archive repository must be private and readable: {repository}"
                         + (f" ({visibility.stderr.strip()})" if visibility.returncode else ""))
    command = ["gh", "release", "download", TAG, "--repo", repository, "--dir", str(folder)]
    for name in names:
        command.extend(["--pattern", name])
    subprocess.run(command, check=True)


def download_actions(repository, names, folder):
    """Original artifact ZIPs from their Actions runs, by API id (no extraction by gh)."""
    ids = {}
    for run in sorted({run_and_artifact(n)[0] for n in names}):
        listing = subprocess.run(
            ["gh", "api", "--paginate", f"repos/{repository}/actions/runs/{run}/artifacts?per_page=100",
             "--jq", ".artifacts[] | [.name, .id, .expired] | @tsv"],
            capture_output=True, text=True, check=True).stdout
        for line in filter(None, listing.splitlines()):
            artifact, identifier, expired = line.split("\t")
            ids[f"{run}--{artifact}.zip"] = (identifier, expired == "true")
    for name in names:
        if name not in ids:
            raise ValueError(f"{name} is not listed by its Actions run")
        identifier, expired = ids[name]
        if expired:
            raise ValueError(f"{name} has expired from Actions storage; configure the private archive")
        with open(folder / name, "wb") as out:
            subprocess.run(["gh", "api", f"repos/{repository}/actions/artifacts/{identifier}/zip"],
                           stdout=out, check=True)


def safe_extract(path, target):
    with ZipFile(path) as archive:
        for member in archive.infolist():
            parts = PurePosixPath(member.filename)
            if parts.is_absolute() or ".." in parts.parts or "\\" in member.filename:
                raise ValueError(f"Unsafe path {member.filename!r} in {path.name}")
        archive.extractall(target)


def restore(source, case, output, *, repository=None, artifact_dir=None, actions_repository=None,
            manifest_path=MANIFEST, root=ROOT):
    manifest = json.loads(Path(manifest_path).read_text())
    names = select(source, case, root)
    if not names or any(name not in manifest for name in names):
        raise ValueError(f"Pinned archive manifest is incomplete for {source}")
    with ExitStack() as cleanup:
        if repository or actions_repository:
            artifact_dir = Path(cleanup.enter_context(tempfile.TemporaryDirectory()))
            if repository:
                download_private(repository, names, artifact_dir)
            else:
                download_actions(actions_repository, names, artifact_dir)
        artifact_dir = Path(artifact_dir)
        # Verify every original before writing any extracted files.
        for name in names:
            path = artifact_dir / name
            spec = manifest[name]
            if not path.exists():
                raise ValueError(f"Pinned archive ZIP is missing: {name}")
            with path.open("rb") as archive:
                if (path.stat().st_size != spec["bytes"]
                        or hashlib.file_digest(archive, "sha256").hexdigest() != spec["sha256"]):
                    raise ValueError(f"Pinned archive size or SHA-256 differs for {name}")
        for name in names:
            target = output if case or source == "labels" else output / run_and_artifact(name)[1]
            safe_extract(artifact_dir / name, target)
    print(f"Restored {len(names)} verified {source} input ZIPs to {output}")
    return names


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", choices=(*SOURCES, "labels"), required=True)
    parser.add_argument("--case")
    parser.add_argument("--output", type=Path, required=True)
    location = parser.add_mutually_exclusive_group(required=True)
    location.add_argument("--repository")
    location.add_argument("--artifact-dir", type=Path)
    location.add_argument("--actions", action="store_true",
                          help="Original Actions runs of $GITHUB_REPOSITORY (until retention ends)")
    args = parser.parse_args(argv)
    if args.case and args.source == "labels":
        parser.error("--case is for v05 or v07 predictors")
    actions = os.environ.get("GITHUB_REPOSITORY", "WxMan33/forecast-ops") if args.actions else None
    restore(args.source, args.case, args.output, repository=args.repository,
            artifact_dir=args.artifact_dir, actions_repository=actions)


if __name__ == "__main__":
    main()
