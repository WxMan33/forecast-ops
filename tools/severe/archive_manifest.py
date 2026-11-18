#!/usr/bin/env python3
"""Build and cross-check the SHA-256 manifest of one Actions run's artifacts.

Input: the run's artifact list from the API (one JSON object per line, as written by
`gh api --paginate ... --jq '.artifacts[]'`) and a folder holding every <name>.zip downloaded
from that run. Every zip must match the digest GitHub recorded for it. If a manifest for the
run is already committed, every name, id, size and digest must match it too, so a
hand-transcribed manifest is checked independently before anything relies on it.
"""
import argparse
import json
import sys
from pathlib import Path

from fetch_archive import sha256


def build(run_id, repository, artifact_lines, zips, release_tag=None, notes=None):
    listed = [json.loads(line) for line in artifact_lines if line.strip()]
    if not listed:
        raise SystemExit("The run lists no artifacts")
    if any(a.get("expired") for a in listed):
        raise SystemExit("Some artifacts have already expired: " + ", ".join(a["name"] for a in listed if a["expired"]))
    artifacts, problems = [], []
    for a in sorted(listed, key=lambda a: a["name"]):
        digest = (a.get("digest") or "").removeprefix("sha256:")
        path = zips / f"{a['name']}.zip"
        actual = sha256(path) if path.exists() else None
        if not digest or actual != digest:
            problems.append(f"{a['name']}: API digest {digest or 'missing'}, downloaded {actual or 'missing'}")
        artifacts.append({"name": a["name"], "artifact_id": a["id"], "size_in_bytes": a["size_in_bytes"],
                          "zip_sha256": digest})
    if len({a["name"] for a in artifacts}) != len(artifacts):
        problems.append("Artifact names are not unique")
    if problems:
        raise SystemExit("Downloaded zips do not match the API digests:\n" + "\n".join(problems))
    heads = {a["workflow_run"]["head_sha"] for a in listed}
    return {"schema_version": 1, "source_run_id": int(run_id), "repository": repository,
            "source_head_sha": heads.pop() if len(heads) == 1 else sorted(heads),
            "actions_expires_at": min(a["expires_at"] for a in listed),
            "contents": notes or "", "release_tag": release_tag, "artifacts": artifacts}


def compare(committed, built):
    key = lambda m: [(a["name"], a["artifact_id"], a["size_in_bytes"], a["zip_sha256"]) for a in m["artifacts"]]
    if committed["source_run_id"] != built["source_run_id"] or key(committed) != key(built):
        old, new = set(key(committed)), set(key(built))
        raise SystemExit("Committed manifest differs from the run:\n  only committed: "
                         f"{sorted(old - new)}\n  only in run: {sorted(new - old)}")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--artifacts", required=True, type=Path)
    parser.add_argument("--zips", required=True, type=Path)
    parser.add_argument("--committed", type=Path, help="Existing manifest to check, if any")
    parser.add_argument("--release-tag")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)
    committed = json.loads(args.committed.read_text()) if args.committed and args.committed.exists() else None
    built = build(args.run_id, args.repository, args.artifacts.read_text().splitlines(), args.zips,
                  args.release_tag or (committed or {}).get("release_tag"),
                  (committed or {}).get("contents"))
    if committed:
        compare(committed, built)
        built = {**committed, "release_tag": built["release_tag"]}
    args.output.write_text(json.dumps(built, indent=1) + "\n")
    print(json.dumps({"artifacts": len(built["artifacts"]), "bytes": sum(a["size_in_bytes"] for a in built["artifacts"]),
                      "matched_committed": committed is not None, "release_tag": built["release_tag"]}))


if __name__ == "__main__":
    sys.exit(main())
