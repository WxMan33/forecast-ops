#!/usr/bin/env python3
"""Fetch archived research inputs and verify each zip against a committed SHA-256 manifest.

The manifest (research/severe/archives/run-<id>.json) pins every artifact's zip digest, as
GitHub reported it when the artifact was made. Sources, tried in the order given by --source:
  release  the GitHub Release named by the manifest's release_tag (durable, once published)
  actions  the original Actions artifact (works only until it expires)
  dir:PATH a folder of <artifact-name>.zip files, e.g. a restored private backup
A zip is used only if its SHA-256 matches; extraction refuses absolute or escaping paths.
Layout matches actions/download-artifact: with --name, files go straight into --dest; with
--pattern, each artifact goes into --dest/<artifact-name>/.
"""
import argparse
import fnmatch
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def select(manifest, name=None, pattern=None):
    artifacts = manifest["artifacts"]
    chosen = [a for a in artifacts if (a["name"] == name if name else fnmatch.fnmatchcase(a["name"], pattern))]
    if not chosen:
        raise SystemExit(f"No archived artifact matches {name or pattern!r} in run {manifest['source_run_id']}")
    return chosen


def gh(*args, output=None):
    with open(output, "wb") if output else open("/dev/null", "wb") as out:
        result = subprocess.run(["gh", *args], stdout=out, stderr=subprocess.PIPE)
    return result.returncode == 0, result.stderr.decode(errors="replace").strip()


def retrieve(source, artifact, manifest, folder):
    """Return a local zip path for this artifact from one source, or (None, reason)."""
    target = folder / f"{artifact['name']}.zip"
    if source == "release":
        tag = manifest.get("release_tag")
        if not tag:
            return None, "manifest has no release_tag yet"
        ok, error = gh("release", "download", tag, "--repo", manifest["repository"],
                       "--pattern", target.name, "--dir", str(folder), "--clobber")
        return (target, "") if ok and target.exists() else (None, error or "asset missing")
    if source == "actions":
        ok, error = gh("api", f"repos/{manifest['repository']}/actions/artifacts/{artifact['artifact_id']}/zip",
                       output=target)
        return (target, "") if ok else (None, error or "download failed")
    if source.startswith("dir:"):
        path = Path(source[4:]) / target.name
        return (path, "") if path.exists() else (None, f"{path} not found")
    raise SystemExit(f"Unknown source {source!r}")


def extract(archive, destination):
    with zipfile.ZipFile(archive) as z:
        bad = z.testzip()
        if bad:
            raise SystemExit(f"{archive.name}: corrupt member {bad}")
        for member in z.infolist():
            path = PurePosixPath(member.filename)
            if path.is_absolute() or ".." in path.parts or "\\" in member.filename:
                raise SystemExit(f"{archive.name}: unsafe path {member.filename!r}")
        destination.mkdir(parents=True, exist_ok=True)
        z.extractall(destination)


def fetch(manifest_path, dest, sources, name=None, pattern=None, log=print):
    manifest = json.loads(Path(manifest_path).read_text())
    chosen = select(manifest, name, pattern)
    used = {}
    with tempfile.TemporaryDirectory() as temporary:
        folder = Path(temporary)
        for artifact in chosen:
            reasons = []
            for source in sources:
                path, reason = retrieve(source, artifact, manifest, folder)
                if path is None:
                    reasons.append(f"{source}: {reason}")
                    continue
                actual = sha256(path)
                if actual != artifact["zip_sha256"]:
                    reasons.append(f"{source}: SHA-256 {actual} differs from manifest")
                    continue
                extract(path, dest if name else dest / artifact["name"])
                used[artifact["name"]] = source
                break
            else:
                raise SystemExit(f"{artifact['name']}: no source supplied a verified copy ({'; '.join(reasons)})")
    log(json.dumps({"source_run_id": manifest["source_run_id"], "verified": len(used),
                    "by_source": {s: sum(v == s for v in used.values()) for s in set(used.values())}}))
    return used


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manifest", required=True, type=Path)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--name")
    group.add_argument("--pattern")
    parser.add_argument("--dest", required=True, type=Path)
    parser.add_argument("--source", action="append",
                        help="release, actions or dir:PATH; repeat to set a fallback order (default: release, then actions)")
    args = parser.parse_args(argv)
    if not args.manifest.exists():
        raise SystemExit(f"{args.manifest} is not committed yet: run the 'Severe archive inputs' workflow for this "
                         "run and commit the manifest it produces")
    fetch(args.manifest, args.dest, args.source or ["release", "actions"], args.name, args.pattern)


if __name__ == "__main__":
    sys.exit(main())
