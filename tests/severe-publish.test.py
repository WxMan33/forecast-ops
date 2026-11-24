#!/usr/bin/env python3
"""Simultaneous publishers against an isolated test remote.

Each case seeds a bare repository in a temporary folder with a copy of this checkout, clones
it twice, and runs tools/severe/publish_feed.sh exactly as the workflow does. The candidates
are synthetic but pass every check in the real export: registered model, frozen timing, raw
audit, predictor contract, checksums and reproduced probabilities. Nothing reaches GitHub.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools/severe"))
from product import predict, read_model  # noqa: E402
from protocol import future_window  # noqa: E402

REQUEST = json.loads((ROOT / "research/severe/daily-request.json").read_text())
MODEL = REQUEST["model"]
FEED = "assets/severe-daily"


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def git(cwd, *args, check=True):
    result = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)
    if check and result.returncode:
        raise AssertionError(f"git {' '.join(args)} failed: {result.stderr}")
    return result.stdout.strip()


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=1) + "\n")


def candidate(folder, date, day, seed):
    """A complete checked candidate, shaped exactly like tools/severe/product.py output."""
    model = read_model(ROOT / MODEL, REQUEST["model_sha256"])
    with np.load(ROOT / "research/severe/labels-v04/daily-labels.npz", allow_pickle=False) as labels:
        coordinates = labels["coordinates"]
    fitted = model["products"][f"day{day}_wind"]
    rng = np.random.default_rng(seed)
    features = np.asarray(fitted["feature_mean"]) + rng.normal(size=(len(coordinates), 34)) * fitted["feature_scale"]
    names = np.array(model["feature_names"])
    root = folder / "predictors"
    root.mkdir(parents=True)
    np.savez(root / "features.npz", features=features, feature_names=names, coordinates=coordinates)
    window = future_window(date, day)
    write(root / "manifest.json", {**model["input_contract"],
                                   "products": [{"file": "features.npz", "sha256": sha(root / "features.npz")}]})
    write(root / "raw-audit.json", {"status": "passed", "source_messages_checked": 192,
                                    "model_init_time": window["model_init_time"]})
    prepared = window["assumed_issuance_time"]
    write(folder / "candidate.json", {
        **window, "prepared_at": prepared, "available_before_target_start": True,
        "coordinates": coordinates.tolist(), "model_sha256": REQUEST["model_sha256"],
        "probabilities": predict(model, day, features, names),
        "predictor_sha256": sha(root / "features.npz"), "raw_audit_sha256": sha(root / "raw-audit.json")})
    write(folder / "attempt.json", {"status": "complete", "candidate_sha256": sha(folder / "candidate.json")})
    return folder


class Publishers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.work = Path(tempfile.mkdtemp(prefix="severe-publish-"))
        cls.candidates = {
            (date, day): candidate(cls.work / f"candidate-{date}-day{day}", date, day, seed)
            for seed, (date, day) in enumerate([("2026-11-18", 1), ("2026-11-18", 2), ("2026-11-19", 1)])}

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.work)

    def setUp(self):
        self.case = Path(tempfile.mkdtemp(dir=self.work))
        seed, self.remote = self.case / "seed", self.case / "remote.git"
        # A copy of the current checkout, with its present feed, as the remote's only commit.
        files = git(ROOT, "ls-files", "-co", "--exclude-standard", "-z").split("\0")
        for name in filter(None, files):
            if (ROOT / name).is_file():
                (seed / name).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / name, seed / name)
        git(self.case, "init", "--quiet", "--bare", "-b", "main", str(self.remote))
        git(seed, "init", "--quiet", "-b", "main")
        self.identity(seed)
        git(seed, "add", "-A")
        git(seed, "commit", "--quiet", "-m", "seed")
        git(seed, "push", "--quiet", str(self.remote), "main")
        self.seed_day = {d: json.loads((seed / FEED / f"day{d}.json").read_text()) for d in (1, 2)}
        self.clones = {}
        for name in ("a", "b", "other"):
            git(self.case, "clone", "--quiet", str(self.remote), name)
            self.identity(self.case / name)
            self.clones[name] = self.case / name

    @staticmethod
    def identity(path):
        git(path, "config", "user.name", "test publisher")
        git(path, "config", "user.email", "publisher@example.invalid")

    def publish(self, clone, key, hook=None, attempts=4):
        report = self.case / f"report-{clone}-{key[0]}-{key[1]}.json"
        env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
        env.pop("PUBLISH_BEFORE_PUSH", None)
        if hook:
            env["PUBLISH_BEFORE_PUSH"] = hook
        result = subprocess.run(
            ["bash", "tools/severe/publish_feed.sh", "--source", str(self.candidates[key]), "--model", MODEL,
             "--branch", "main", "--attempts", str(attempts), "--retry-delay", "0", "--report", str(report)],
            cwd=self.clones[clone], env=env, capture_output=True, text=True)
        return result, json.loads(report.read_text())

    def unrelated_commit_hook(self, attempts):
        """Before this publisher pushes, another commit lands on the remote: the push must be rejected."""
        other = self.clones["other"]
        return (f"if [ \"$PUBLISH_ATTEMPT\" -le {attempts} ]; then cd {other} && git pull --quiet --ff-only "
                f"&& echo \"$PUBLISH_ATTEMPT\" >> feeds/unrelated-test-change.txt && git add feeds "
                f"&& git commit --quiet -m unrelated && git push --quiet origin HEAD:main; fi")

    def tip(self, path):
        check = self.case / "check"
        if check.exists():
            shutil.rmtree(check)
        git(self.case, "clone", "--quiet", str(self.remote), "check")
        return check / path

    def assert_published(self, expected):
        """The remote tip has exactly the expected run for each day, and passes the viewer checks."""
        feed = self.tip(FEED)
        index = json.loads((feed / "index.json").read_text())
        self.assertEqual(sorted(r["day"] for r in index["runs"]), [1, 2])
        for run in index["runs"]:
            self.assertEqual(sha(feed / run["file"]), run["sha256"])
            self.assertEqual(json.loads((feed / run["file"]).read_text())["model_init_time"], expected[run["day"]])
        for command in (["node", "tests/severe-daily.test.js"], ["node", "tests/severe-contours.test.js"],
                        ["python3", "tools/severe/model_registry.py", "--check"]):
            subprocess.run(command, cwd=feed.parents[1], check=True, capture_output=True)

    def test_rejected_push_recovers_both_forecasts_and_unrelated_change(self):
        # B (Day 2) and an unrelated commit both land while A (Day 1) is between commit and push.
        b_cmd = (f"bash tools/severe/publish_feed.sh --source {self.candidates[('2026-11-18', 2)]} --model {MODEL} "
                 f"--branch main --retry-delay 0 --report {self.case}/report-b.json")
        hook = (f"if [ \"$PUBLISH_ATTEMPT\" = 1 ]; then (cd {self.clones['b']} && env -u PUBLISH_BEFORE_PUSH {b_cmd}) "
                f"&& ({self.unrelated_commit_hook(1)}); fi")
        result, report = self.publish("a", ("2026-11-18", 1), hook)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual([a["result"] for a in report["attempts"]], ["push_rejected", "pushed"])
        self.assertIn("rejected; retrying", result.stdout)
        b = json.loads((self.case / "report-b.json").read_text())
        self.assertEqual([a["result"] for a in b["attempts"]], ["pushed"])
        self.assert_published({1: "2026-11-18T06:00:00+00:00", 2: "2026-11-18T12:00:00+00:00"})
        self.assertEqual(self.tip("feeds/unrelated-test-change.txt").read_text(), "1\n")
        log = git(self.case / "check", "log", "--format=%s", "main").splitlines()
        self.assertEqual(log[:3], ["data: update audited daily severe research feed", "unrelated",
                                   "data: update audited daily severe research feed"])
        self.assertEqual(log[-1], "seed")
        # Linear history: nothing was force-pushed or merged away.
        self.assertEqual(git(self.case / "check", "rev-list", "--merges", "--count", "main"), "0")

    def test_truly_simultaneous_publishers(self):
        env = {k: v for k, v in os.environ.items() if k != "PUBLISH_BEFORE_PUSH"}
        procs = []
        for clone, key in (("a", ("2026-11-18", 1)), ("b", ("2026-11-18", 2))):
            procs.append(subprocess.Popen(
                ["bash", "tools/severe/publish_feed.sh", "--source", str(self.candidates[key]), "--model", MODEL,
                 "--branch", "main", "--retry-delay", "1", "--report", str(self.case / f"sim-{clone}.json")],
                cwd=self.clones[clone], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True))
        for proc in procs:
            output = proc.communicate(timeout=300)[0]
            self.assertEqual(proc.returncode, 0, output)
        self.assert_published({1: "2026-11-18T06:00:00+00:00", 2: "2026-11-18T12:00:00+00:00"})

    def test_newer_run_published_during_race_is_not_replaced(self):
        # While A holds the 18th, a later run for the 19th is published. A's retry must refuse.
        hook = (f"if [ \"$PUBLISH_ATTEMPT\" = 1 ]; then cd {self.clones['b']} && env -u PUBLISH_BEFORE_PUSH "
                f"bash tools/severe/publish_feed.sh --source {self.candidates[('2026-11-19', 1)]} --model {MODEL} "
                f"--branch main --retry-delay 0; fi")
        result, report = self.publish("a", ("2026-11-18", 1), hook)
        self.assertEqual(result.returncode, 1)
        self.assertEqual([a["result"] for a in report["attempts"]], ["push_rejected", "export_refused"])
        self.assertIn("::error::Export refused", result.stdout)
        self.assert_published({1: "2026-11-19T06:00:00+00:00", 2: self.seed_day[2]["model_init_time"]})

    def test_exhausted_retries_fail_loudly_and_leave_remote_consistent(self):
        result, report = self.publish("a", ("2026-11-18", 1), self.unrelated_commit_hook(3), attempts=3)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(report["outcome"], "failed")
        self.assertEqual([a["result"] for a in report["attempts"]], ["push_rejected"] * 3)
        self.assertIn("::error::Daily severe feed could not be published after 3 attempts", result.stdout)
        self.assert_published({d: self.seed_day[d]["model_init_time"] for d in (1, 2)})
        self.assertEqual(self.tip("feeds/unrelated-test-change.txt").read_text(), "1\n2\n3\n")

    def test_republishing_same_run_is_a_no_op(self):
        self.assertEqual(self.publish("a", ("2026-11-18", 1))[0].returncode, 0)
        result, report = self.publish("b", ("2026-11-18", 1))
        self.assertEqual(result.returncode, 0)
        self.assertEqual(report["outcome"], "already_current")


if __name__ == "__main__":
    unittest.main(verbosity=2)
