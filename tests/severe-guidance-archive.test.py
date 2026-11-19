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
    add_features(out)
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


def add_features(out, value=1.0):
    import numpy as np
    np.savez_compressed(out / "guidance" / "rrfs-day1-features.npz", features=np.full((3, 2), value, np.float32),
                        feature_names=np.array(["a", "b"]))


class Identity(unittest.TestCase):
    def test_attempt_and_fetch_times_do_not_change_data_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = collection_dir(tmp)
            add_features(out)
            base = A.data_identity(out)["data_sha256"]
            A.record(out, 1, "schedule", "2026-11-20T09:41:00+00:00", "111", "1", "abc")
            first = A.bundle(out, Path(tmp) / "a" / "x.tar.gz")
            A.record(out, 1, "schedule", "2026-11-20T09:55:00+00:00", "111", "2", "abc")  # rerun attempt
            c = json.loads((out / "collection.json").read_text())
            c["started_at"], c["completed_at"] = "2026-11-20T09:56:00+00:00", "2026-11-20T09:59:00+00:00"
            (out / "collection.json").write_text(json.dumps(c))
            m = json.loads((out / "guidance" / "manifest.json").read_text())
            m["sources"]["rrfs"]["availability"]["listing_observed_at"] = "2026-11-20T09:56:30+00:00"
            (out / "guidance" / "manifest.json").write_text(json.dumps(m))
            add_features(out)  # rewritten file, same values
            second = A.bundle(out, Path(tmp) / "b" / "x.tar.gz")
            self.assertNotEqual(first["sha256"], second["sha256"])  # bundle bytes differ ...
            self.assertEqual(first["data_sha256"], second["data_sha256"])  # ... the data does not
            self.assertEqual(first["data_sha256"], base)
            self.assertEqual(A.bundle_data_sha256(Path(tmp) / "b" / "x.tar.gz"), base)

    def test_data_changes_change_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = collection_dir(tmp)
            add_features(out)
            base = A.data_identity(out)["data_sha256"]
            add_features(out, 2.0)
            self.assertNotEqual(A.data_identity(out)["data_sha256"], base)
            add_features(out)
            m = json.loads((out / "guidance" / "manifest.json").read_text())
            m["sources"]["rrfs"]["availability"]["hours"] = [
                {"forecast_hour": 6, "key": "k", "grib": {"etag": "e", "size": 1, "last_modified": "2026-11-20T07:00:00Z"},
                 "index": None, "pair_last_modified": None, "status": "missing"}]
            (out / "guidance" / "manifest.json").write_text(json.dumps(m))
            self.assertNotEqual(A.data_identity(out)["data_sha256"], base)  # timing evidence is data


class Bundle(unittest.TestCase):
    def test_reproducible_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = collection_dir(tmp)
            add_features(out)
            a = A.bundle(out, Path(tmp) / "a" / "x.tar.gz")
            os.utime(out / "collection.json", (1, 1))  # file times must not matter
            b = A.bundle(out, Path(tmp) / "b" / "x.tar.gz")
            self.assertEqual(a["sha256"], b["sha256"])

    def test_names(self):
        self.assertEqual(A.asset_name("2026-11-20", 2), "severe-guidance-2026-11-20-day2.tar.gz")
        self.assertEqual(A.receipt_name("2026-11-20", 2, "4444", "3"), "severe-guidance-2026-11-20-day2.run-4444-3.json")
        self.assertEqual(A.release_tag("2026-11-20"), "severe-guidance-2026-11")
        with self.assertRaises(ValueError):
            A.asset_name("2026-11-31", 1)
        with self.assertRaises(ValueError):
            A.receipt_name("2026-11-20", 1, None, "1")


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
        self.out = collection_dir(self.tmp)
        add_features(self.out)
        self.release = self.store / "severe-guidance-2026-11"

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.env)
        shutil.rmtree(self.tmp)

    def attempt(self, attempt, started="09:41", value=1.0):
        add_features(self.out, value)
        run = A.record(self.out, 1, "schedule", f"2026-11-20T{started}:00+00:00", "5000", str(attempt), "abc")
        path = self.tmp / f"attempt{attempt}" / A.asset_name("2026-11-20", 1)
        A.bundle(self.out, path)
        return A.publish(path, "owner/archive", "2026-11-20", 1, run), path

    def test_rerun_with_same_data_is_a_duplicate_and_each_attempt_keeps_its_receipt(self):
        first, path1 = self.attempt(1)
        self.assertEqual((first["outcome"], first["verified"]), ("uploaded", True))
        second, path2 = self.attempt(2, started="09:58")
        self.assertNotEqual(A.sha256(path1), A.sha256(path2))  # different attempt record and times
        self.assertEqual((second["outcome"], second["verified"]), ("duplicate_data", True))
        self.assertEqual(A.sha256(self.release / A.asset_name("2026-11-20", 1)), A.sha256(path1))  # first kept
        receipts = sorted(p.name for p in self.release.glob("*.json"))
        self.assertEqual(receipts, ["severe-guidance-2026-11-20-day1.run-5000-1.json",
                                    "severe-guidance-2026-11-20-day1.run-5000-2.json"])
        r2 = json.loads((self.release / receipts[1]).read_text())
        self.assertEqual((r2["outcome"], r2["run"]["collection"]["run_attempt"]), ("duplicate_data", "2"))
        self.assertEqual(r2["run"]["collection"]["started_at"], "2026-11-20T09:58:00+00:00")

    def test_partial_attempt_keeps_evidence_and_leaves_canonical_name_for_complete_retry(self):
        collection_path = self.out / "collection.json"
        complete = collection_path.read_text()
        partial = json.loads(complete)
        partial["status"] = "partial"
        partial["sources"]["hrrr"]["status"] = "failed"
        collection_path.write_text(json.dumps(partial))

        first, first_path = self.attempt(1)
        self.assertEqual((first["outcome"], first["verified"]), ("uploaded_incomplete", True))
        canonical = self.release / A.asset_name("2026-11-20", 1)
        self.assertFalse(canonical.exists())
        partial_path = self.release / "severe-guidance-2026-11-20-day1.run-5000-1.tar.gz"
        self.assertEqual(A.sha256(partial_path), A.sha256(first_path))
        receipt = json.loads((self.release / first["receipt"]).read_text())
        self.assertEqual(receipt["data_asset"], partial_path.name)
        self.assertEqual(receipt["run"]["sources"]["hrrr"]["status"], "failed")

        collection_path.write_text(complete)
        second, second_path = self.attempt(2)
        self.assertEqual((second["outcome"], second["verified"]), ("uploaded", True))
        self.assertEqual(A.sha256(canonical), A.sha256(second_path))
        self.assertEqual(A.sha256(partial_path), A.sha256(first_path))
        third, _ = self.attempt(3, started="10:01")
        self.assertEqual((third["outcome"], third["verified"]), ("duplicate_data", True))

    def test_different_data_is_a_conflict_recorded_not_overwritten(self):
        self.attempt(1)
        before = A.sha256(self.release / A.asset_name("2026-11-20", 1))
        conflict, _ = self.attempt(2, value=9.0)
        self.assertEqual(conflict["outcome"], "data_conflict")
        self.assertNotEqual(conflict["local_data_sha256"], conflict["remote_data_sha256"])
        self.assertEqual(A.sha256(self.release / A.asset_name("2026-11-20", 1)), before)
        receipt = json.loads((self.release / "severe-guidance-2026-11-20-day1.run-5000-2.json").read_text())
        self.assertEqual(receipt["outcome"], "data_conflict")
        uploads = [l for l in (self.tmp / "calls.log").read_text().splitlines() if "release upload" in l]
        self.assertEqual(sum(".tar.gz" in l for l in uploads), 1)

    def test_retried_publish_of_the_same_attempt_is_idempotent(self):
        first, path = self.attempt(1)
        run = json.loads((self.out / "run.json").read_text())
        again = A.publish(path, "owner/archive", "2026-11-20", 1, run)
        self.assertEqual((again["outcome"], again.get("receipt_already_recorded")), ("duplicate_data", True))
        run["collection"]["started_at"] = "2026-11-20T23:00:00+00:00"  # a forged or different attempt record
        with self.assertRaisesRegex(RuntimeError, "different receipt"):
            A.publish(path, "owner/archive", "2026-11-20", 1, run)

    def test_read_back_mismatch_and_public_archive(self):
        os.environ["CORRUPT"] = "1"
        with self.assertRaisesRegex(RuntimeError, "reads back as"):
            self.attempt(1)
        os.environ.pop("CORRUPT")
        os.environ["PRIVATE"] = "false"
        with self.assertRaisesRegex(ValueError, "private"):
            self.attempt(2)

    def test_cli_exit_codes(self):
        self.attempt(1)
        add_features(self.out, 5.0)
        A.record(self.out, 1, "schedule", "2026-11-20T09:41:00+00:00", "5000", "7", "abc")
        path = self.tmp / "cli" / A.asset_name("2026-11-20", 1)
        A.bundle(self.out, path)
        result = self.tmp / "result.json"
        code = A.main(["publish", "--bundle", str(path), "--record", str(self.out / "run.json"),
                       "--repository", "owner/archive", "--date", "2026-11-20", "--day", "1", "--result", str(result)])
        self.assertEqual(code, 3)
        self.assertEqual(json.loads(result.read_text())["outcome"], "data_conflict")


if __name__ == "__main__":
    unittest.main(verbosity=2)
