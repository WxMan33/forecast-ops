#!/usr/bin/env python3
"""Stage a pinned NCEI Storm Events file into a replay cache, so export never needs NOAA.

NOAA replaces Storm Events files when it reprocesses a year, and the replaced name returns 404.
The frozen bytes are pinned by name, size and SHA-256 in research/severe/labels-v04/manifest.json.
This copies them into the cache as the file plus the receipt tools/severe/extract.py's Client
expects, after checking them, so Client.fetch returns the staged copy without any request.

Locations, tried in order (the first one that has the file must also verify):
  --repository OWNER/REPO  PRIVATE archive release `severe-replay-sources-v1` (refused if public)
  --actions                frozen-source checkpoint artifact (run 43909210291), until 2027-02-14
  --file PATH              a local copy
The release is read with $ARCHIVE_TOKEN and the artifact with $ACTIONS_TOKEN (else gh's default).
A copy that is present but fails size or SHA-256 is an error, never skipped.
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "research/severe/labels-v04/manifest.json"
TAG = "severe-replay-sources-v1"
CHECKPOINT = {"run": 43909210291, "artifact_id": 14247375303,
              "zip_sha256": "b9210290a69b22f8437216cf690525273008f6dcb7c2966ef672d18ade1e4bf3"}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def pinned(name, manifest_path=MANIFEST):
    sources = json.loads(Path(manifest_path).read_text())["sources"]
    match = [s for s in sources if s["file"] == name]
    if len(match) != 1:
        raise ValueError(f"{name} is not a pinned report source")
    return match[0]


def verify(path, spec):
    size, digest = path.stat().st_size, sha256(path)
    if size != spec["receipt"]["bytes"] or digest != spec["sha256"]:
        raise ValueError(f"{spec['file']}: size {size} / SHA-256 {digest} differs from the pinned "
                         f"{spec['receipt']['bytes']} / {spec['sha256']}")


def gh_env(token):
    return {**os.environ, **({"GH_TOKEN": token} if token else {})}


def from_release(repository, name, folder, token=None):
    view = subprocess.run(["gh", "repo", "view", repository, "--json", "isPrivate", "--jq", ".isPrivate"],
                          capture_output=True, text=True, env=gh_env(token))
    if view.returncode or view.stdout.strip() != "true":
        raise ValueError(f"The replay source archive must be private and readable: {repository}")
    got = subprocess.run(["gh", "release", "download", TAG, "--repo", repository, "--pattern", name,
                          "--dir", str(folder)], capture_output=True, text=True, env=gh_env(token))
    path = folder / name
    return (path, "") if got.returncode == 0 and path.exists() else (None, got.stderr.strip() or "asset missing")


def from_actions(repository, name, folder, token=None):
    archive = folder / "checkpoint.zip"
    with open(archive, "wb") as out:
        got = subprocess.run(["gh", "api", f"repos/{repository}/actions/artifacts/{CHECKPOINT['artifact_id']}/zip"],
                             stdout=out, stderr=subprocess.PIPE, text=True, env=gh_env(token))
    if got.returncode:
        return None, got.stderr.strip() or "download failed"
    if sha256(archive) != CHECKPOINT["zip_sha256"]:
        raise ValueError("Checkpoint artifact zip differs from its recorded digest")
    with zipfile.ZipFile(archive) as z:
        if name not in z.namelist():
            return None, f"{name} not in checkpoint artifact"
        with z.open(name) as src, open(folder / name, "wb") as dst:
            shutil.copyfileobj(src, dst)
    return folder / name, ""


def stage(name, cache, *, repository=None, actions_repository=None, file=None, manifest_path=MANIFEST, log=print,
          tokens=None):
    tokens = tokens or {}
    spec = pinned(name, manifest_path)
    cache = Path(cache)
    target, receipt = cache / name, cache / f"{name}.receipt.json"
    if target.exists():
        verify(target, spec)  # an existing cache entry must already be the pinned bytes
    with tempfile.TemporaryDirectory() as temporary:
        folder, reasons, found = Path(temporary), [], None
        for label, attempt in (("private release", repository and (lambda: from_release(repository, name, folder, tokens.get("archive")))),
                               ("checkpoint artifact", actions_repository and (lambda: from_actions(actions_repository, name, folder, tokens.get("actions")))),
                               ("local file", file and (lambda: (Path(file), "") if Path(file).exists() else (None, "not found")))):
            if not attempt:
                continue
            path, reason = attempt()
            if path is None:
                reasons.append(f"{label}: {reason}")
                continue
            verify(path, spec)
            found = (label, path)
            break
        if not found:
            raise ValueError(f"No location supplied {name}: " + "; ".join(reasons or ["no location given"]))
        cache.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(found[1], target)
    verify(target, spec)
    receipt.write_text(json.dumps(spec["receipt"], indent=2) + "\n")
    if found[0] != "private release":
        log(f"::warning::{name} staged from the {found[0]}; upload it to the private release {TAG}")
    log(json.dumps({"staged": name, "from": found[0], "sha256": spec["sha256"]}))
    return found[0]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--name", default="StormEvents_details-ftp_v1.0_d2024_c20260728.csv.gz")
    parser.add_argument("--cache", required=True, type=Path)
    parser.add_argument("--repository", help="Private archive owner/repo")
    parser.add_argument("--actions", action="store_true", help="Fall back to the checkpoint artifact")
    parser.add_argument("--file", type=Path)
    args = parser.parse_args(argv)
    actions = os.environ.get("GITHUB_REPOSITORY", "WxMan33/forecast-ops") if args.actions else None
    try:
        stage(args.name, args.cache, repository=args.repository, actions_repository=actions, file=args.file,
              tokens={"archive": os.environ.get("ARCHIVE_TOKEN"), "actions": os.environ.get("ACTIONS_TOKEN")})
    except ValueError as error:
        print(f"::error::{error}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
