#!/usr/bin/env python3
"""Pinned rebuild inputs: manifest coverage and verified restore from every location.

A stub `gh` on PATH stands in for GitHub, so no network is used."""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools/severe"))
import restore_rebuild_inputs as R  # noqa: E402

MANIFEST = json.loads((ROOT / "research/severe/rebuild-archive.json").read_text())


class Manifest(unittest.TestCase):
    def test_covers_every_rebuild_input_and_nothing_from_2025(self):
        for source, count in (("v05", 36), ("v07", 108)):
            names = R.select(source, None)
            self.assertEqual(len(names), count)
            self.assertTrue(all(n in MANIFEST for n in names))
        self.assertIn(R.LABELS, MANIFEST)
        self.assertEqual(len(MANIFEST), 36 + 1 + 108 + 1)  # plus the v05 summary
        self.assertFalse(any("2025-" in n for n in MANIFEST))
        for spec in MANIFEST.values():
            self.assertRegex(spec["sha256"], r"^[0-9a-f]{64}$")
            self.assertGreater(spec["bytes"], 0)

    def test_case_selection_is_frozen(self):
        self.assertEqual(R.select("v05", "2022-01-15"), ["42321856909--severe-history-v05-2022-01-15.zip"])
        for bad in ("2025-01-15", "2022-01-16", "../x"):
            with self.assertRaises(ValueError):
                R.select("v05", bad)


class Restore(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.root = self.tmp / "root"
        (self.root / "research/severe").mkdir(parents=True)
        (self.root / "research/severe/cohort-v05.json").write_text(json.dumps({"cases": ["2022-01-15", "2022-02-15"]}))
        self.zips = self.tmp / "zips"
        self.zips.mkdir()
        manifest = {}
        for name in ["42321856909--severe-history-v05-2022-01-15.zip", "42321856909--severe-history-v05-2022-02-15.zip",
                     R.LABELS]:
            with zipfile.ZipFile(self.zips / name, "w") as z:
                z.writestr("case-manifest.json", json.dumps({"artifact": name}))
            data = (self.zips / name).read_bytes()
            manifest[name] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        self.manifest = self.tmp / "manifest.json"
        self.manifest.write_text(json.dumps(manifest))
        self.bin = self.tmp / "bin"
        self.bin.mkdir()
        self.env = dict(os.environ)

    def tearDown(self):
        shutil.rmtree(self.tmp)
        os.environ.clear()
        os.environ.update(self.env)

    def restore(self, source="v05", case=None, **kw):
        out = self.tmp / "out"
        return R.restore(source, case, out, manifest_path=self.manifest, root=self.root, **kw), out

    def stub_gh(self, script):
        (self.bin / "gh").write_text("#!/usr/bin/env bash\n" + textwrap.dedent(script))
        (self.bin / "gh").chmod(0o755)
        os.environ["PATH"] = f"{self.bin}:{self.env['PATH']}"

    def test_local_directory_layouts(self):
        _, out = self.restore(artifact_dir=self.zips)
        self.assertTrue((out / "severe-history-v05-2022-01-15/case-manifest.json").exists())
        self.assertTrue((out / "severe-history-v05-2022-02-15/case-manifest.json").exists())
        shutil.rmtree(out)
        self.restore(case="2022-02-15", artifact_dir=self.zips)
        self.assertTrue((out / "case-manifest.json").exists())
        shutil.rmtree(out)
        self.restore("labels", artifact_dir=self.zips)
        self.assertIn("labels", (out / "case-manifest.json").read_text())

    def test_any_mismatch_stops_before_extraction(self):
        with open(self.zips / "42321856909--severe-history-v05-2022-02-15.zip", "ab") as f:
            f.write(b"x")
        with self.assertRaisesRegex(ValueError, "size or SHA-256 differs.*2022-02-15"):
            self.restore(artifact_dir=self.zips)
        self.assertFalse((self.tmp / "out").exists())
        (self.zips / "42321856909--severe-history-v05-2022-02-15.zip").unlink()
        with self.assertRaisesRegex(ValueError, "missing"):
            self.restore(artifact_dir=self.zips)

    def test_escaping_paths_are_refused(self):
        name = R.LABELS
        with zipfile.ZipFile(self.zips / name, "w") as z:
            z.writestr("../escape.txt", "x")
        data = (self.zips / name).read_bytes()
        manifest = json.loads(self.manifest.read_text())
        manifest[name] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        self.manifest.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "Unsafe path"):
            self.restore("labels", artifact_dir=self.zips)
        self.assertFalse((self.tmp / "escape.txt").exists())

    def test_public_archive_is_refused_before_download(self):
        self.stub_gh(f"""
            if [ "$1 $2" = "repo view" ]; then echo false; exit 0; fi
            echo "downloaded" > {self.tmp}/downloaded; exit 0
        """)
        with self.assertRaisesRegex(ValueError, "must be private"):
            self.restore(repository="owner/public-archive")
        self.assertFalse((self.tmp / "downloaded").exists())

    def test_private_release_is_verified(self):
        self.stub_gh(f"""
            if [ "$1 $2" = "repo view" ]; then echo true; exit 0; fi
            if [ "$1 $2" = "release download" ]; then
              shift 2; while [ $# -gt 0 ]; do case "$1" in
                --dir) dir=$2; shift 2;; --pattern) cp "{self.zips}/$2" "$dir/"; shift 2;; *) shift;; esac; done
              exit 0
            fi
            exit 1
        """)
        names, out = self.restore(repository="owner/private-archive")
        self.assertEqual(len(names), 2)
        self.assertTrue((out / "severe-history-v05-2022-01-15/case-manifest.json").exists())

    def test_actions_fallback_is_verified_and_refuses_expired(self):
        listing = self.tmp / "listing.tsv"
        listing.write_text("severe-history-v05-2022-01-15\t11\tfalse\nsevere-history-v05-2022-02-15\t12\tfalse\n")
        self.stub_gh(f"""
            for a in "$@"; do last=$a; done
            case "$*" in
              *"/runs/42321856909/artifacts"*) cat {listing};;
              *"/artifacts/11/zip"*) cat "{self.zips}/42321856909--severe-history-v05-2022-01-15.zip";;
              *"/artifacts/12/zip"*) cat "{self.zips}/42321856909--severe-history-v05-2022-02-15.zip";;
              *) exit 1;;
            esac
        """)
        names, out = self.restore(actions_repository="owner/repo")
        self.assertEqual(len(names), 2)
        shutil.rmtree(out)
        listing.write_text("severe-history-v05-2022-01-15\t11\ttrue\nsevere-history-v05-2022-02-15\t12\tfalse\n")
        with self.assertRaisesRegex(ValueError, "expired"):
            self.restore(actions_repository="owner/repo")

    def test_wrapper_requires_token_when_archive_configured(self):
        result = subprocess.run(["bash", str(ROOT / "tools/severe/restore_inputs.sh"), "--source", "v05",
                                 "--output", str(self.tmp / "out")],
                                env={**self.env, "ARCHIVE_REPO": "owner/archive", "ARCHIVE_TOKEN": ""},
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("SEVERE_REBUILD_ARCHIVE_TOKEN is empty", result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
