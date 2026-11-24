#!/usr/bin/env bash
# Workflow entry point for restore_rebuild_inputs.py. Arguments are passed through
# (--source, --case, --output). Location:
#   ARCHIVE_REPO set   -> the private archive release, read with ARCHIVE_TOKEN (required)
#   ARCHIVE_REPO unset -> the original Actions run, read with ACTIONS_TOKEN, until it expires
# Either way every ZIP is verified against research/severe/rebuild-archive.json.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
if [[ -n "${ARCHIVE_REPO:-}" ]]; then
  if [[ -z "${ARCHIVE_TOKEN:-}" ]]; then
    echo "::error::SEVERE_REBUILD_ARCHIVE_REPO is set but the secret SEVERE_REBUILD_ARCHIVE_TOKEN is empty"
    exit 1
  fi
  GH_TOKEN=$ARCHIVE_TOKEN exec python3 "$here/restore_rebuild_inputs.py" --repository "$ARCHIVE_REPO" "$@"
fi
echo "::warning::No private rebuild archive is configured; reading the original Actions run, which expires (run 42321856909 on 2026-12-07, run 43901185832 on 2027-02-14)"
GH_TOKEN=${ACTIONS_TOKEN:?ACTIONS_TOKEN is required} exec python3 "$here/restore_rebuild_inputs.py" --actions "$@"
