#!/usr/bin/env bash
# Publish one checked daily candidate onto the newest tip of a branch.
#
# index.json is one compact line, so two publishers' edits always conflict in a rebase.
# Instead, every attempt starts from the newest branch tip and exports again: the other
# lead day's published file is then the current one, unrelated commits are kept, and
# nothing is overwritten blindly. A rejected push simply starts the next attempt.
#
# Required: --source DIR --model FILE --branch NAME
# Optional: --remote NAME (default origin), --attempts N (default 4),
#           --retry-delay SECONDS (multiplied by the attempt number, default 10),
#           --report FILE (JSON record of every attempt, written even on failure).
# Test hook: PUBLISH_BEFORE_PUSH, a command run after the commit and before each push,
# with PUBLISH_ATTEMPT set. The workflow never sets it; tests use it to force a race.
set -euo pipefail

remote=origin attempts=4 delay=10 report="" source="" model="" branch=""
while [ $# -gt 0 ]; do
  case "$1" in
    --source) source=$2; shift 2 ;;
    --model) model=$2; shift 2 ;;
    --branch) branch=$2; shift 2 ;;
    --remote) remote=$2; shift 2 ;;
    --attempts) attempts=$2; shift 2 ;;
    --retry-delay) delay=$2; shift 2 ;;
    --report) report=$2; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$source" ] && [ -n "$model" ] && [ -n "$branch" ] || { echo "--source, --model and --branch are required" >&2; exit 2; }
here=$(cd "$(dirname "$0")" && pwd)
source=$(cd "$source" && pwd)
log=()

write_report() {
  [ -n "$report" ] || return 0
  python3 - "$report" "$1" "${2:-}" "${log[@]}" <<'PY'
import json, sys
path, outcome, commit, *attempts = sys.argv[1:]
json.dump({"outcome": outcome, "commit": commit or None,
           "attempts": [dict(zip(("attempt", "result", "base"), a.split("|"))) for a in attempts]},
          open(path, "w"), indent=2)
PY
}

fail() { echo "::error::$1"; write_report failed; exit 1; }

for attempt in $(seq 1 "$attempts"); do
  git fetch --quiet "$remote" "$branch" || fail "Could not fetch $remote/$branch"
  git reset --quiet --hard FETCH_HEAD
  base=$(git rev-parse --short HEAD)
  # Export refuses an unregistered model and an older run replacing a newer one; either is a
  # real failure on this tip, so it is reported rather than retried.
  if ! python3 "$here/export_daily.py" --source "$source" --output assets/severe-daily --model "$model"; then
    log+=("$attempt|export_refused|$base"); fail "Export refused on $remote/$branch at $base"
  fi
  # The exact checks the viewer relies on, run on the feed about to be published.
  node tests/severe-daily.test.js || { log+=("$attempt|feed_check_failed|$base"); fail "Feed check failed at $base"; }
  node tests/severe-contours.test.js || { log+=("$attempt|contour_check_failed|$base"); fail "Contour check failed at $base"; }
  python3 "$here/model_registry.py" --check || { log+=("$attempt|registry_check_failed|$base"); fail "Registry check failed at $base"; }
  git add assets/severe-daily
  if git diff --cached --quiet; then
    log+=("$attempt|already_current|$base"); echo "Feed already current"; write_report already_current "$base"; exit 0
  fi
  git commit --quiet -m "data: update audited daily severe research feed"
  if [ -n "${PUBLISH_BEFORE_PUSH:-}" ]; then PUBLISH_ATTEMPT=$attempt bash -c "$PUBLISH_BEFORE_PUSH"; fi
  if git push --quiet "$remote" "HEAD:$branch"; then
    log+=("$attempt|pushed|$base"); write_report published "$(git rev-parse --short HEAD)"; exit 0
  fi
  log+=("$attempt|push_rejected|$base")
  echo "::warning::Push attempt $attempt was rejected; retrying from the newest tip"
  [ "$attempt" -lt "$attempts" ] && sleep $((attempt * delay))
done
fail "Daily severe feed could not be published after $attempts attempts"
