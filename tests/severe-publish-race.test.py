#!/usr/bin/env python3
"""Race the production publishing command against an isolated bare Git repository."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools/severe"))
from extract import digest
from product import predict, read_model
from protocol import future_window


def run(cwd, *command):
    return subprocess.check_output(command, cwd=cwd, text=True, stderr=subprocess.STDOUT)


def write(path, value):
    path.write_text(json.dumps(value))


def candidate(checkout, source, day, date, model_path):
    """Fixture with the real model and grid, and a synthetic audited feature bundle."""
    model_sha = digest(checkout / model_path)
    model = read_model(checkout / model_path, model_sha)
    with np.load(checkout / "research/severe/labels-v04/daily-labels.npz", allow_pickle=False) as reference:
        coordinates = reference["coordinates"]
    features = np.zeros((len(coordinates), len(model["feature_names"])))
    names = np.array(model["feature_names"])
    root = source / "predictors"
    root.mkdir(parents=True)
    feature_path = root / "features.npz"
    np.savez_compressed(feature_path, features=features, feature_names=names, coordinates=coordinates)
    predictor_sha = digest(feature_path)
    window = future_window(date, day)
    audit = root / "raw-audit.json"
    write(audit, {"status": "passed", "source_messages_checked": 192,
                  "model_init_time": window["model_init_time"]})
    write(root / "manifest.json", {**model["input_contract"],
                                   "products": [{"file": feature_path.name, "sha256": predictor_sha}]})
    path = source / "candidate.json"
    write(path, {**window, "prepared_at": window["assumed_issuance_time"],
                 "available_before_target_start": True, "model_sha256": model_sha,
                 "raw_audit_sha256": digest(audit), "predictor_sha256": predictor_sha,
                 "probabilities": predict(model, day, features, names), "coordinates": coordinates.tolist()})
    write(source / "attempt.json", {"status": "complete", "candidate_sha256": digest(path)})


class PublisherRace(unittest.TestCase):
    def test_non_fast_forward_reexports_both_days_and_preserves_unrelated_commit(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            seed = root / "seed"
            seed.mkdir()
            for relative in ("tools/severe", "research/severe", "assets/severe-daily", "assets/vendor"):
                shutil.copytree(ROOT / relative, seed / relative, ignore=shutil.ignore_patterns("__pycache__"))
            for relative in ("tests/severe-daily.test.js", "tests/severe-contours.test.js",
                             "assets/severe-daily-core.js", "assets/severe-research-contours.js",
                             "assets/severe-research/grid.json", "assets/severe-research/2024-05-15.json"):
                (seed / relative).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / relative, seed / relative)
            run(seed, "git", "init", "-b", "main")
            run(seed, "git", "add", ".")
            run(seed, "git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test",
                "commit", "-m", "Seed isolated feed")
            remote = root / "remote.git"
            run(root, "git", "clone", "--bare", str(seed), str(remote))
            request = json.loads((seed / "research/severe/daily-request.json").read_text())
            model = request["model"]
            initial = json.loads((seed / "assets/severe-daily/index.json").read_text())
            date = max(run_spec["date"] for run_spec in initial["runs"])
            next_date = (np.datetime64(date) + np.timedelta64(1, "D")).astype(str)
            for day in (1, 2):
                checkout = root / f"day{day}"
                run(root, "git", "clone", str(remote), str(checkout))
                run(checkout, "git", "config", "user.name", "Fixture")
                run(checkout, "git", "config", "user.email", "fixture@example.test")
                candidate(checkout, root / f"candidate{day}", day, next_date, model)

            # Git takes the advertised remote tip before this hook runs. Hold Day 2 there
            # until Day 1 and an unrelated commit have advanced the remote ref.
            hook = root / "day2/.git/hooks/pre-push"
            hook.write_text("""#!/usr/bin/env bash
set -eu
if [[ ! -f ../day2-ready ]]; then
  touch ../day2-ready
  until [[ -f ../let-day2-push ]]; do sleep 0.1; done
fi
""")
            hook.chmod(0o755)

            def publish(day):
                return ["bash", "tools/severe/publish_daily.sh", "main", model, str(root / f"candidate{day}")]

            with (root / "day2.log").open("w+") as log:
                process = subprocess.Popen(publish(2), cwd=root / "day2", stdout=log, stderr=subprocess.STDOUT)
                try:
                    deadline = time.monotonic() + 30
                    while not (root / "day2-ready").exists() and process.poll() is None and time.monotonic() < deadline:
                        time.sleep(0.1)
                    log.seek(0)
                    self.assertTrue((root / "day2-ready").exists(), log.read())
                    day1 = root / "day1"
                    run(day1, *publish(1))
                    day1_bytes = (day1 / "assets/severe-daily/day1.json").read_bytes()
                    (day1 / "unrelated.txt").write_text("Concurrent unrelated change\n")
                    run(day1, "git", "add", "unrelated.txt")
                    run(day1, "git", "commit", "-m", "Concurrent unrelated change")
                    intervening = run(day1, "git", "rev-parse", "HEAD").strip()
                    run(day1, "git", "push", "origin", "main")
                    (root / "let-day2-push").touch()
                    code = process.wait(timeout=45)
                finally:
                    (root / "let-day2-push").touch()
                    if process.poll() is None:
                        process.kill()
                        process.wait()
                log.seek(0)
                output = log.read()
                self.assertEqual(code, 0, output)
                self.assertRegex(output, r"(?i)(remote rejected|non-fast-forward|failed to update ref)")
                self.assertIn("fetching and re-exporting", output)

            final = root / "final"
            run(root, "git", "clone", str(remote), str(final))
            run(final, "git", "merge-base", "--is-ancestor", intervening, "HEAD")
            self.assertEqual((final / "unrelated.txt").read_text(), "Concurrent unrelated change\n")
            self.assertEqual(set(run(final, "git", "diff-tree", "--no-commit-id", "--name-only",
                                     "-r", "HEAD").splitlines()),
                             {"assets/severe-daily/day2.json", "assets/severe-daily/index.json"})
            feed = final / "assets/severe-daily"
            self.assertEqual((feed / "day1.json").read_bytes(), day1_bytes)
            runs = json.loads((feed / "index.json").read_text())["runs"]
            self.assertEqual([(spec["day"], spec["date"]) for spec in runs], [(1, next_date), (2, next_date)])
            run(final, "node", "tests/severe-daily.test.js")
            print("Git rejected Day 2's first push. Its retry retained Day 1 byte-for-byte and preserved the intervening commit.")


if __name__ == "__main__":
    unittest.main()
