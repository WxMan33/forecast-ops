#!/usr/bin/env bash
# Run from a dedicated publisher checkout. Candidate files live outside Git.
set -euo pipefail

branch=$1
model=$2
source=$3

# Re-export on the latest tip so either lead can update the shared index.
for attempt in 1 2 3 4; do
  git fetch --quiet origin "refs/heads/$branch"
  git reset --quiet --hard FETCH_HEAD
  python tools/severe/export_daily.py --source "$source" --output assets/severe-daily --model "$model"
  node tests/severe-daily.test.js
  node tests/severe-contours.test.js
  python tools/severe/model_registry.py --check
  git add assets/severe-daily
  if git diff --cached --quiet; then
    echo "Feed already current"
    exit 0
  fi
  git commit --quiet -m "data: update audited daily severe research feed"
  if git push origin "HEAD:refs/heads/$branch"; then
    exit 0
  fi
  if (( attempt < 4 )); then
    echo "Daily severe feed push failed on attempt $attempt; fetching and re-exporting" >&2
    sleep "$((attempt * 10))"
  fi
done
echo "::error::Daily severe feed could not be published after 4 attempts" >&2
exit 1
