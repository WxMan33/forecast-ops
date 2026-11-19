#!/usr/bin/env python3
"""Run records, coverage accounting, deterministic bundles and safe archive publishing.

A stub `gh` on PATH stands in for GitHub; it keeps release assets in a local folder."""
import json
import os
import shutil
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools/severe"))
import guidance_archive as A  # noqa: E402


def availability(on_time=25, late=0, missing=0):
    return {"counts": {"on_time": on_time, "late": late, "after_window_start": 0, "missing": missing},
            "listing_observed_at": "2026-11-20T09:41:00+00:00"}


def collection_dir(root, date="2026-11-20", day=1, late_rrfs=0, nbm_status="complete"):
    out = Path(root) / f"c-{date}-{day}"
    (out / "guidance").mkdir(parents=True)
    init = "06" if day == 1 else "12"
    window = {"model_init_time": f"{date}T{init}:00:00+00:00", "day": day}
    (out / "collection.json").write_text(json.dumps({
        "status": "complete", "started_at": f"{date}T09:41:00+00:00", "completed_at": f"{date}T09:45:00+00:00",
        "window": window,
        "sources": {"hrrr": {"status": "complete", "availability": availability()},
                    "rrfs": {"status": "complete"}, "nbm": {"status": nbm_status}}}))
    (out / "guidance" / "manifest.json").write_text(json.dumps({"sources": {
        "rrfs": {"status": "complete", "availability": availability(25 - late_rrfs, late_rrfs)},
        "nbm": {"status": nbm_status, "availability": availability()}}}))
    (out / "guidance" / "rrfs-day1-features.npz").write_bytes(b"features")
    return out


class RunKind(unittest.TestCase):
    def test_classification(self):
        self.assertEqual(A.run_kind("2026-11-20", 1, "schedule", "2026-11-20T09:41:30+00:00")[:2], ("scheduled", True))
        self.assertEqual(A.run_kind("2026-11-20", 2, "schedule", "2026-11-20T16:39:00+00:00")[:2], ("scheduled", True))
        self.assertEqual(A.run_kind("2026-11-20", 1, "schedule", "2026-11-20T11:05:00+00:00")[:2],
                         ("delayed_scheduled", False))
        self.assertEqual(A.run_kind("2026-11-20", 1, "workflow_dispatch", "2026-11-20T09:41:00+00:00")[:2],
                         ("manual_or_backfill", False))
        self.assertEqual(A.run_kind("2026-11-18", 1, "schedule", "2026-11-20T09:41:00+00:00")[:2],
                         ("delayed_scheduled", False))  # a schedule firing for an old date is not on time

    def test_record_separates_timing_and_collection(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = collection_dir(tmp, late_rrfs=1)
            run = A.record(out, 1, "schedule", "2026-11-20T09:41:00+00:00", "123", "1", "abc")
            self.assertEqual(run["collection"]["run_kind"], "scheduled")
            self.assertEqual(run["collection"]["scheduled_for"], "2026-11-20T09:40:00+00:00")
            self.assertEqual(run["collection"]["collection_started_at"], "2026-11-20T09:41:00+00:00")
            self.assertTrue(run["sources"]["hrrr"]["on_time"])
            self.assertFalse(run["sources"]["rrfs"]["on_time"])  # one late hour by S3 timestamp
            self.assertFalse(run["all_sources_on_time"])
            self.assertTrue((out / "run.json").exists())


class Coverage(unittest.TestCase):
    def test_missed_and_backfilled_count_against_coverage(self):
        with tempfile.TemporaryDirectory() as tmp:
            records = Path(tmp) / "records"
            records.mkdir()
            cases = [("2026-11-20", "schedule", "09:41", 0, "complete"),       # on time
                     ("2026-11-21", "schedule", "09:42", 2, "complete"),       # late hours
                     ("2026-11-22", "workflow_dispatch", "09:41", 0, "complete"),  # backfill only
                     # 2026-11-23 never ran: missed
                     ("2026-11-24", "schedule", "12:30", 0, "complete"),       # delayed run: excluded
                     ("2026-11-25", "schedule", "09:41", 0, "failed")]         # NBM failed
            for date, event, start, late, nbm in cases:
                out = collection_dir(tmp, date, 1, late, nbm)
                run = A.record(out, 1, event, f"{date}T{start}:00+00:00")
                (records / f"{date}-day1.json").write_text(json.dumps(run))
            result = A.coverage(records, "2026-11-20", "2026-11-25", (1,))
            states = [r["state"] for r in result["rows"]]
            self.assertEqual(states, ["on_time", "late_or_incomplete", "backfilled_excluded", "missed",
                                      "backfilled_excluded", "late_or_incomplete"])
            s = result["summary"]["day1"]
            self.assertEqual((s["scheduled"], s["on_time"], s["missed"], s["backfilled_excluded"]), (6, 1, 1, 2))
            self.assertAlmostEqual(s["all_sources_on_time_rate"], 1 / 6, places=4)
            self.assertEqual(s["per_source_on_time"], {"hrrr": 3, "rrfs": 2, "nbm": 2})


class Bundle(unittest.TestCase):
    def test_reproducible_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = collection_dir(tmp)
            a = A.bundle(out, Path(tmp) / "a" / "x.tar.gz")
            os.utime(out / "collection.json", (1, 1))  # file times must not matter
            b = A.bundle(out, Path(tmp) / "b" / "x.tar.gz")
            self.assertEqual(a["sha256"], b["sha256"])
            (out / "collection.json").write_text("{}")
            self.assertNotEqual(A.bundle(out, Path(tmp) / "c" / "x.tar.gz")["sha256"], a["sha256"])

    def test_names(self):
        self.assertEqual(A.asset_name("2026-11-20", 2), "severe-guidance-2026-11-20-day2.tar.gz")
        self.assertEqual(A.release_tag("2026-11-20"), "severe-guidance-2026-11")
        with self.assertRaises(ValueError):
            A.asset_name("2026-11-31", 1)


class Publish(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.store = self.tmp / "store"
        self.store.mkdir()
        self.bin = self.tmp / "bin"
        self.bin.mkdir()
        (self.bin / "gh").write_text("#!/usr/bin/env bash\n" + textwrap.dedent(f"""
            store="{self.store}"
            echo "$*" >> "{self.tmp}/calls.log"
            case "$1 $2" in
              "repo view") echo "${{PRIVATE:-true}}"; exit 0;;
              "release view") [ -d "$store/$3" ] && exit 0 || exit 1;;
              "release create") mkdir -p "$store/$3"; exit 0;;
              "release upload")
                [ -e "$store/$3/$(basename "$4")" ] && {{ echo "asset already exists" >&2; exit 1; }}
                cp "$4" "$store/$3/"; [ -n "$CORRUPT" ] && echo x >> "$store/$3/$(basename "$4")"; exit 0;;
              "release download")
                tag=$3; shift 3
                while [ $# -gt 0 ]; do case "$1" in --pattern) p=$2; shift 2;; --dir) d=$2; shift 2;; *) shift;; esac; done
                [ -e "$store/$tag/$p" ] || {{ echo "no assets match" >&2; exit 1; }}
                cp "$store/$tag/$p" "$d/"; exit 0;;
            esac
            exit 1
        """))
        (self.bin / "gh").chmod(0o755)
        self.env = dict(os.environ)
        os.environ["PATH"] = f"{self.bin}:{self.env['PATH']}"
        self.bundle = self.tmp / A.asset_name("2026-11-20", 1)
        self.bundle.write_bytes(b"bundle-v1")

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.env)
        shutil.rmtree(self.tmp)

    def publish(self):
        return A.publish(self.bundle, "owner/archive", "2026-11-20", 1)

    def test_upload_then_retry_is_identical_and_conflict_is_not_overwritten(self):
        first = self.publish()
        self.assertEqual((first["outcome"], first["verified"]), ("uploaded", True))
        self.assertEqual((self.store / "severe-guidance-2026-11" / self.bundle.name).read_bytes(), b"bundle-v1")
        again = self.publish()
        self.assertEqual(again["outcome"], "identical_existing")
        self.bundle.write_bytes(b"bundle-v2")
        conflict = self.publish()
        self.assertEqual((conflict["outcome"], conflict["verified"]), ("checksum_conflict", False))
        self.assertEqual((self.store / "severe-guidance-2026-11" / self.bundle.name).read_bytes(), b"bundle-v1")
        self.assertEqual(sum("release upload" in line for line in (self.tmp / "calls.log").read_text().splitlines()), 1)

    def test_read_back_mismatch_and_public_archive(self):
        os.environ["CORRUPT"] = "1"
        with self.assertRaisesRegex(RuntimeError, "reads back as"):
            self.publish()
        os.environ.pop("CORRUPT")
        os.environ["PRIVATE"] = "false"
        with self.assertRaisesRegex(ValueError, "private"):
            self.publish()

    def test_cli_exit_codes(self):
        self.assertEqual(A.main(["publish", "--bundle", str(self.bundle), "--repository", "owner/archive",
                                 "--date", "2026-11-20", "--day", "1"]), 0)
        self.bundle.write_bytes(b"different")
        result = self.tmp / "result.json"
        self.assertEqual(A.main(["publish", "--bundle", str(self.bundle), "--repository", "owner/archive",
                                 "--date", "2026-11-20", "--day", "1", "--result", str(result)]), 3)
        self.assertEqual(json.loads(result.read_text())["outcome"], "checksum_conflict")


if __name__ == "__main__":
    unittest.main(verbosity=2)
