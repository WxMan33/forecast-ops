#!/usr/bin/env python3
"""Feed health rules: deadlines, staleness, feed consistency, failed runs and reporting."""
import hashlib
import json
import shutil
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools/severe"))
import feed_health as H  # noqa: E402

FEED = ROOT / "assets/severe-daily"


def at(text):
    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc)


def run(id, created, conclusion, status="completed"):
    return {"id": id, "created_at": created, "status": status, "conclusion": conclusion,
            "event": "schedule", "html_url": f"https://example.invalid/runs/{id}"}


class Feed(unittest.TestCase):
    def setUp(self):
        self.folder = Path(tempfile.mkdtemp())
        self.feed = self.folder / "feed"
        shutil.copytree(FEED, self.feed)
        index = json.loads((self.feed / "index.json").read_text())
        # Pin the copy to a known pair of runs, whatever the live feed holds today.
        for day, init in ((1, "2026-11-17T06:00:00+00:00"), (2, "2026-11-17T12:00:00+00:00")):
            self.set_init(index, day, init)

    def tearDown(self):
        shutil.rmtree(self.folder)

    def set_init(self, index, day, init):
        path = self.feed / f"day{day}.json"
        product = json.loads(path.read_text())
        product["model_init_time"] = init
        path.write_text(json.dumps(product))
        for r in index["runs"]:
            if r["day"] == day:
                r.update(model_init_time=init, sha256=hashlib.sha256(path.read_bytes()).hexdigest())
        (self.feed / "index.json").write_text(json.dumps(index))

    def errors(self, now):
        findings, status = H.check_feed(self.feed, at(now))
        return [f["message"] for f in findings if f["level"] == "error"], status

    def test_deadlines(self):
        self.assertEqual(H.expected_init(1, at("2026-11-18T11:59:00")), at("2026-11-17T06:00:00"))
        self.assertEqual(H.expected_init(1, at("2026-11-18T12:00:00")), at("2026-11-18T06:00:00"))
        self.assertEqual(H.expected_init(2, at("2026-11-18T19:14:00")), at("2026-11-17T12:00:00"))
        self.assertEqual(H.expected_init(2, at("2026-11-18T19:15:00")), at("2026-11-18T12:00:00"))

    def test_current_feed_is_healthy_before_deadlines(self):
        errors, status = self.errors("2026-11-18T11:00:00")
        self.assertEqual(errors, [])
        self.assertEqual({d: s["state"] for d, s in status.items()}, {1: "current", 2: "current"})

    def test_stale_day1_after_window_starts(self):
        errors, status = self.errors("2026-11-18T12:05:00")
        self.assertEqual(len(errors), 1)
        self.assertIn("Day 1 still shows the 2026-11-17 06Z run; the 2026-11-18 06Z run was due by 2026-11-18 12:00Z", errors[0])
        self.assertEqual(status[2]["state"], "current")

    def test_stale_day2_after_last_catch_up(self):
        errors, _ = self.errors("2026-11-18T19:20:00")
        self.assertEqual(len([e for e in errors if e.startswith("Day 2")]), 1)

    def test_missing_day_file_and_run(self):
        index = json.loads((self.feed / "index.json").read_text())
        index["runs"] = [r for r in index["runs"] if r["day"] == 1]
        (self.feed / "index.json").write_text(json.dumps(index))
        errors, status = self.errors("2026-11-18T11:00:00")
        self.assertEqual(errors, ["Day 2 is not published"])
        self.assertEqual(status[2]["state"], "missing")

    def test_checksum_mismatch_and_unregistered_model(self):
        path = self.feed / "day1.json"
        path.write_text(path.read_text().replace("2026-11-17T06", "2026-11-17T07", 1))
        errors, _ = self.errors("2026-11-18T11:00:00")
        self.assertTrue(any("day1.json is missing or differs" in e for e in errors))
        index = json.loads((self.feed / "index.json").read_text())
        product = json.loads((self.feed / "day2.json").read_text())
        product["model_sha256"] = "0" * 64
        (self.feed / "day2.json").write_text(json.dumps(product))
        self.set_init(index, 2, product["model_init_time"])
        errors, _ = self.errors("2026-11-18T11:00:00")
        self.assertTrue(any("unregistered model" in e for e in errors))

    def test_cli_report_and_exit_code(self):
        runs = self.folder / "runs.json"
        runs.write_text(json.dumps({"workflow_runs": [run(2, "2026-11-18T09:30:05Z", "failure")]}))
        summary, result = self.folder / "summary.md", self.folder / "result.json"
        code = H.main(["--feed", str(self.feed), "--now", "2026-11-18T10:00:00+00:00", "--runs", str(runs),
                       "--summary", str(summary), "--json", str(result)])
        self.assertEqual(code, 1)
        text = summary.read_text()
        self.assertIn("| Day 1 | 2026-11-17T06:00:00+00:00 |", text)
        self.assertIn("**ERROR** (runs): Publishing run 2 (schedule, 2026-11-18T09:30:05Z) ended failure", text)
        self.assertFalse(json.loads(result.read_text())["healthy"])
        self.assertEqual(H.main(["--feed", str(self.feed), "--now", "2026-11-18T10:00:00+00:00"]), 0)


class Runs(unittest.TestCase):
    now = at("2026-11-18T12:00:00")

    def test_newest_failure_is_an_error(self):
        findings, counts = H.check_runs([run(1, "2026-11-18T09:30:00Z", "success"),
                                         run(2, "2026-11-18T10:30:00Z", "timed_out"),
                                         run(3, "2026-11-18T11:45:00Z", None, "in_progress")], self.now)
        self.assertEqual([f["level"] for f in findings], ["error"])
        self.assertEqual(counts, {"completed": 2, "in_progress": 1})

    def test_recovered_failure_is_a_warning_and_old_runs_are_ignored(self):
        findings, _ = H.check_runs([run(1, "2026-11-16T09:30:00Z", "failure"),
                                    run(2, "2026-11-18T09:30:00Z", "cancelled"),
                                    run(3, "2026-11-18T10:30:00Z", "success")], self.now)
        self.assertEqual([(f["level"], "run 2 " in f["message"]) for f in findings], [("warning", True)])
        self.assertIn("a later run succeeded", findings[0]["message"])

    def test_skipped_and_successful_runs_are_quiet(self):
        findings, _ = H.check_runs([run(1, "2026-11-18T09:30:00Z", "success"),
                                    run(2, "2026-11-18T10:30:00Z", "skipped")], self.now)
        self.assertEqual(findings, [])


class Served(unittest.TestCase):
    def test_mismatch_and_unreachable_are_warnings(self):
        def fetch(url):
            if url.endswith("day2.json"):
                raise OSError("blocked")
            return (FEED / url.rsplit("/", 1)[1]).read_bytes() if url.endswith("index.json") else b"{}"
        findings = H.check_served(FEED, "https://raw.example.invalid/feed/", fetch)
        self.assertEqual([f["level"] for f in findings], ["warning", "warning"])
        self.assertIn("Served day1.json differs", findings[0]["message"])
        self.assertIn("Could not read served day2.json", findings[1]["message"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
