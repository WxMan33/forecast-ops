#!/usr/bin/env python3
"""Replay export reads the frozen Storm Events file from a pinned cache, with NOAA unavailable.

NOAA replaced StormEvents_details-ftp_v1.0_d2024_c20260728.csv.gz, so its URL returns 404. These
tests stand in for NOAA with a 404 for every request (no network is used) and a stub `gh` for the
private release and the checkpoint artifact."""
import gzip
import hashlib
import io
import json
import os
import shutil
import sys
import tempfile
import textwrap
import unittest
import urllib.error
import zipfile
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools/severe"))
import extract  # noqa: E402
import replay_daily  # noqa: E402
import stage_report_source as S  # noqa: E402

NAME = "StormEvents_details-ftp_v1.0_d2024_c20260728.csv.gz"
URL = "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/" + NAME


def noaa_404(*args, **kwargs):
    raise urllib.error.HTTPError(URL, 404, "Not Found", {}, io.BytesIO(b""))


class PinnedSpec(unittest.TestCase):
    def test_real_pin_is_the_verified_digest(self):
        spec = S.pinned(NAME)
        self.assertEqual(spec["sha256"], "2070b83eccab041b36360ab73645b9a249c3eefc5b92b5b3fc0cbba4d9fcc09c")
        self.assertEqual(spec["receipt"]["sha256"], spec["sha256"])
        self.assertEqual(spec["receipt"]["bytes"], 12693243)
        self.assertEqual(spec["receipt"]["url"], URL)
        with self.assertRaises(ValueError):
            S.pinned("StormEvents_details-ftp_v1.0_d2025_c20260101.csv.gz")

    def test_export_reads_through_the_cache_helper(self):
        text = (ROOT / "tools/severe/replay_daily.py").read_text()
        self.assertIn("report_path = report_source(cache, source)", text)
        self.assertNotIn("client.fetch(", text)


class Staged(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.good = self.tmp / "good" / NAME
        self.good.parent.mkdir()
        self.good.write_bytes(gzip.compress(b"BEGIN_YEARMONTH,EVENT_TYPE\n202405,Thunderstorm Wind\n", mtime=0))
        data = self.good.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        self.spec = {"file": NAME, "sha256": digest,
                     "receipt": {"url": URL, "start": None, "end": None, "sha256": digest, "bytes": len(data),
                                 "etag": None, "retrieved_at": "2026-11-06T19:53:52+00:00"}}
        self.manifest = self.tmp / "manifest.json"
        self.manifest.write_text(json.dumps({"sources": [self.spec]}))
        self.bad = self.tmp / "bad" / NAME
        self.bad.parent.mkdir()
        self.bad.write_bytes(data[:-1] + bytes([data[-1] ^ 1]))  # same size, one bit different
        self.cache = self.tmp / "cache"
        self.env = dict(os.environ)

    def tearDown(self):
        shutil.rmtree(self.tmp)
        os.environ.clear()
        os.environ.update(self.env)

    def stage(self, **kw):
        return S.stage(NAME, self.cache, manifest_path=self.manifest, log=lambda _: None, **kw)

    def test_export_source_works_from_pinned_cache_with_noaa_unavailable(self):
        with mock.patch.object(extract.urllib.request, "urlopen", side_effect=noaa_404) as noaa:
            # Unstaged, the export would go to NOAA and fail exactly as the baseline run did.
            with self.assertRaises(urllib.error.HTTPError):
                replay_daily.report_source(self.cache, self.spec)
            self.stage(file=self.good)
            path = replay_daily.report_source(self.cache, self.spec)
            calls_after_staging = noaa.call_count
        self.assertEqual(calls_after_staging, 1)  # only the unstaged attempt reached "NOAA"
        self.assertEqual(path.read_bytes(), self.good.read_bytes())
        receipt = json.loads((self.cache / f"{NAME}.receipt.json").read_text())
        self.assertEqual(receipt, self.spec["receipt"])

    def test_bad_digest_is_rejected_and_nothing_is_staged(self):
        with self.assertRaisesRegex(ValueError, "differs from the pinned"):
            self.stage(file=self.bad)
        self.assertFalse((self.cache / NAME).exists())

    def test_tampered_cache_is_rejected_by_stage_and_export(self):
        self.stage(file=self.good)
        shutil.copyfile(self.bad, self.cache / NAME)
        with mock.patch.object(extract.urllib.request, "urlopen", side_effect=noaa_404):
            with self.assertRaisesRegex(ValueError, "Cache identity/hash mismatch"):
                replay_daily.report_source(self.cache, self.spec)
        with self.assertRaisesRegex(ValueError, "differs from the pinned"):
            self.stage(file=self.good)

    def stub_gh(self, script):
        bin_dir = self.tmp / "bin"
        bin_dir.mkdir(exist_ok=True)
        (bin_dir / "gh").write_text("#!/usr/bin/env bash\n" + textwrap.dedent(script))
        (bin_dir / "gh").chmod(0o755)
        os.environ["PATH"] = f"{bin_dir}:{self.env['PATH']}"

    def test_private_release_is_preferred_and_public_refused(self):
        self.stub_gh(f"""
            if [ "$1 $2" = "repo view" ]; then echo "${{VIS:-true}}"; exit 0; fi
            if [ "$1 $2" = "release download" ]; then
              [ "$3" = "{S.TAG}" ] || exit 1
              while [ $# -gt 0 ]; do [ "$1" = --dir ] && cp "{self.good}" "$2/"; shift; done; exit 0
            fi
            exit 1
        """)
        self.assertEqual(self.stage(repository="owner/archive", file=self.bad), "private release")
        os.environ["VIS"] = "false"
        shutil.rmtree(self.cache)
        with self.assertRaisesRegex(ValueError, "must be private"):
            self.stage(repository="owner/public-archive")

    def test_bad_release_copy_fails_instead_of_falling_back(self):
        self.stub_gh(f"""
            if [ "$1 $2" = "repo view" ]; then echo true; exit 0; fi
            if [ "$1 $2" = "release download" ]; then
              while [ $# -gt 0 ]; do [ "$1" = --dir ] && cp "{self.bad}" "$2/"; shift; done; exit 0
            fi
            exit 1
        """)
        with self.assertRaisesRegex(ValueError, "differs from the pinned"):
            self.stage(repository="owner/archive", file=self.good)

    def test_checkpoint_artifact_fallback_checks_zip_and_file(self):
        checkpoint = self.tmp / "checkpoint.zip"
        with zipfile.ZipFile(checkpoint, "w") as z:
            z.write(self.good, NAME)
        self.stub_gh(f"""
            if [ "$1 $2" = "release download" ]; then echo "release not found" >&2; exit 1; fi
            if [ "$1 $2" = "repo view" ]; then echo true; exit 0; fi
            case "$*" in *"/actions/artifacts/{S.CHECKPOINT['artifact_id']}/zip"*) cat "{checkpoint}";; *) exit 1;; esac
        """)
        with self.assertRaisesRegex(ValueError, "Checkpoint artifact zip differs"):
            self.stage(repository="owner/archive", actions_repository="owner/repo")
        pinned_zip = {**S.CHECKPOINT, "zip_sha256": hashlib.sha256(checkpoint.read_bytes()).hexdigest()}
        with mock.patch.object(S, "CHECKPOINT", pinned_zip):
            self.assertEqual(self.stage(repository="owner/archive", actions_repository="owner/repo"),
                             "checkpoint artifact")
        self.assertEqual((self.cache / NAME).read_bytes(), self.good.read_bytes())


if __name__ == "__main__":
    unittest.main(verbosity=2)
