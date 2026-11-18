#!/usr/bin/env python3
"""Archived-input manifests and verified retrieval (no network: local folders stand in)."""
import io
import json
import shutil
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools/severe"))
import archive_manifest as AM  # noqa: E402
import fetch_archive as FA  # noqa: E402


def make_zip(path, files):
    with zipfile.ZipFile(path, "w") as z:
        for name, data in files.items():
            z.writestr(name, data)
    return FA.sha256(path)


class Retrieval(unittest.TestCase):
    def setUp(self):
        self.folder = Path(tempfile.mkdtemp())
        self.good, self.bad = self.folder / "good", self.folder / "bad"
        self.good.mkdir(), self.bad.mkdir()
        artifacts = []
        for i, name in enumerate(["severe-history-v05-2022-01-15", "severe-history-v05-2022-02-15",
                                  "severe-history-v05-summary"]):
            digest = make_zip(self.good / f"{name}.zip", {"case-manifest.json": json.dumps({"case": name})})
            make_zip(self.bad / f"{name}.zip", {"case-manifest.json": "tampered"})
            artifacts.append({"name": name, "artifact_id": i, "size_in_bytes": 1, "zip_sha256": digest})
        self.manifest = self.folder / "manifest.json"
        self.manifest.write_text(json.dumps({"source_run_id": 1, "repository": "o/r", "release_tag": None,
                                             "artifacts": artifacts}))

    def tearDown(self):
        shutil.rmtree(self.folder)

    def fetch(self, sources, **kw):
        return FA.fetch(self.manifest, self.folder / "out", sources, log=lambda _: None, **kw)

    def test_pattern_layout_and_selection(self):
        used = self.fetch([f"dir:{self.good}"], pattern="severe-history-v05-20*")
        self.assertEqual(sorted(used), ["severe-history-v05-2022-01-15", "severe-history-v05-2022-02-15"])
        self.assertTrue((self.folder / "out/severe-history-v05-2022-01-15/case-manifest.json").exists())

    def test_name_layout_matches_download_artifact(self):
        self.fetch([f"dir:{self.good}"], name="severe-history-v05-summary")
        self.assertTrue((self.folder / "out/case-manifest.json").exists())

    def test_tampered_copy_is_refused_and_next_source_used(self):
        with self.assertRaisesRegex(SystemExit, "SHA-256 .* differs from manifest"):
            self.fetch([f"dir:{self.bad}"], name="severe-history-v05-summary")
        used = self.fetch(["release", f"dir:{self.bad}", f"dir:{self.good}"], name="severe-history-v05-summary")
        self.assertEqual(used, {"severe-history-v05-summary": f"dir:{self.good}"})

    def test_missing_everywhere_names_every_reason(self):
        with self.assertRaises(SystemExit) as caught:
            self.fetch(["release", f"dir:{self.folder}/nowhere"], name="severe-history-v05-summary")
        self.assertIn("release: manifest has no release_tag yet", str(caught.exception))
        self.assertIn("nowhere", str(caught.exception))

    def test_no_match_and_unsafe_paths(self):
        with self.assertRaisesRegex(SystemExit, "No archived artifact"):
            self.fetch([f"dir:{self.good}"], pattern="severe-history-v07-*")
        evil = self.folder / "evil.zip"
        make_zip(evil, {"../escape.txt": "x"})
        with self.assertRaisesRegex(SystemExit, "unsafe path"):
            FA.extract(evil, self.folder / "x")
        self.assertFalse((self.folder / "escape.txt").exists())

    def test_cli_refuses_uncommitted_manifest(self):
        with self.assertRaisesRegex(SystemExit, "not committed yet"):
            FA.main(["--manifest", str(self.folder / "run-9.json"), "--name", "x", "--dest", str(self.folder)])


class Manifest(unittest.TestCase):
    def test_build_checks_digests_and_committed_copy(self):
        with tempfile.TemporaryDirectory() as folder:
            zips = Path(folder)
            lines = []
            for i, name in enumerate(["b", "a"]):
                digest = make_zip(zips / f"{name}.zip", {"f": name})
                lines.append(json.dumps({"id": i, "name": name, "size_in_bytes": 9, "digest": f"sha256:{digest}",
                                         "expired": False, "expires_at": f"2026-12-0{7 - i}T00:00:00Z",
                                         "workflow_run": {"head_sha": "abc"}}))
            built = AM.build(5, "o/r", lines, zips)
            self.assertEqual([a["name"] for a in built["artifacts"]], ["a", "b"])
            self.assertEqual(built["actions_expires_at"], "2026-12-06T00:00:00Z")
            AM.compare(built, built)
            changed = json.loads(json.dumps(built))
            changed["artifacts"][0]["zip_sha256"] = "0" * 64
            with self.assertRaisesRegex(SystemExit, "Committed manifest differs"):
                AM.compare(changed, built)
            (zips / "a.zip").write_bytes(b"changed")
            with self.assertRaisesRegex(SystemExit, "do not match the API digests"):
                AM.build(5, "o/r", lines, zips)

    def test_committed_manifest_covers_the_original_cohort(self):
        manifest = json.loads((ROOT / "research/severe/archives/run-42321856909.json").read_text())
        cohort = json.loads((ROOT / "research/severe/cohort-v05.json").read_text())
        names = [a["name"] for a in manifest["artifacts"]]
        self.assertEqual(len(names), 37)
        self.assertEqual(len(set(names)), 37)
        cases = sorted(n.removeprefix("severe-history-v05-") for n in names if n != "severe-history-v05-summary")
        self.assertEqual(len(cases), 36)
        listed = cohort.get("cases") or cohort.get("dates")
        if listed:
            self.assertEqual(cases, sorted(listed))
        self.assertTrue(all(len(a["zip_sha256"]) == 64 for a in manifest["artifacts"]))
        self.assertFalse(any(c.startswith("2025") for c in cases))
        self.assertAlmostEqual(sum(a["size_in_bytes"] for a in manifest["artifacts"]) / 1e6, 204, delta=1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
