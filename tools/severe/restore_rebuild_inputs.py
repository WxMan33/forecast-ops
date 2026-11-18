#!/usr/bin/env python3
"""Restore pinned severe rebuild inputs from a private release or local ZIP directory."""
import argparse
from contextlib import ExitStack
import hashlib
import json
import re
import subprocess
import tempfile
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
TAG = "severe-rebuild-inputs-v1"
SOURCES = {
    "v05": (42321856909, "severe-history-v05-"),
    "v07": (43901185832, "severe-history-v07-"),
}
LABELS = "43901185832--severe-labels-v07.zip"


def select(source, case):
    if source == "labels":
        return [LABELS]
    run, prefix = SOURCES[source]
    prefix = f"{run}--{prefix}"
    cohort = json.loads((ROOT / f"research/severe/cohort-{source}.json").read_text())
    names = {date: prefix + date + ".zip" for date in cohort["cases"]}
    if case:
        if not re.fullmatch(r"202[234]-\d{2}-\d{2}", case):
            raise ValueError("Case must be a frozen 2022–2024 date")
        if case not in names:
            raise ValueError(f"Case {case} is absent from the frozen {source} cohort")
        return [names[case]]
    return sorted(names.values())


def restore(source, case, output, *, repository=None, artifact_dir=None):
    manifest = json.loads((ROOT / "research/severe/rebuild-archive.json").read_text())
    names = select(source, case)
    if not names or any(name not in manifest for name in names):
        raise ValueError(f"Pinned archive manifest is incomplete for {source}")
    with ExitStack() as cleanup:
        if repository:
            gh = ["gh", "repo", "view", repository, "--json", "isPrivate", "--jq", ".isPrivate"]
            if subprocess.check_output(gh, text=True).strip() != "true":
                raise ValueError("The severe input archive repository must be private")
            artifact_dir = Path(cleanup.enter_context(tempfile.TemporaryDirectory()))
            command = ["gh", "release", "download", TAG, "--repo", repository, "--dir", str(artifact_dir)]
            for name in names:
                command.extend(["--pattern", name])
            subprocess.run(command, check=True)

        # Verify every original before writing any extracted files.
        for name in names:
            path = artifact_dir / name
            spec = manifest[name]
            with path.open("rb") as archive:
                if (path.stat().st_size != spec["bytes"]
                        or hashlib.file_digest(archive, "sha256").hexdigest() != spec["sha256"]):
                    raise ValueError(f"Pinned archive size or SHA-256 differs for {name}")
        for name in names:
            target = output if case or source == "labels" else output / name.split("--", 1)[1][:-4]
            with ZipFile(artifact_dir / name) as archive:
                archive.extractall(target)
    print(f"Restored {len(names)} verified {source} input ZIPs to {output}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", choices=(*SOURCES, "labels"), required=True)
    parser.add_argument("--case")
    parser.add_argument("--output", type=Path, required=True)
    location = parser.add_mutually_exclusive_group(required=True)
    location.add_argument("--repository")
    location.add_argument("--artifact-dir", type=Path)
    args = parser.parse_args()
    if args.case and args.source == "labels":
        parser.error("--case is for v05 or v07 predictors")
    restore(args.source, args.case, args.output, repository=args.repository, artifact_dir=args.artifact_dir)


if __name__ == "__main__":
    main()
