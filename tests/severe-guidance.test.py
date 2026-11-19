#!/usr/bin/env python3
"""Offline checks for tools/severe/guidance.py: index selection, windows, arrival classes,
missing-input reporting, field identities and the NBM neighborhood mapping. No network."""
import json
import sys
import unittest
from tempfile import TemporaryDirectory
from unittest.mock import patch
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools/severe"))
import guidance as G  # noqa: E402
from protocol import future_window  # noqa: E402

INDEX = """1:0:d=2026111806:REFC:entire atmosphere (considered as a single layer):12 hour fcst:
2:100:d=2026111806:GUST:10 m above ground:12 hour fcst:
3:250:d=2026111806:GUST:10 m above ground:12 hour fcst:ens std dev
4:400:d=2026111806:TSTM:surface:6-12 hour acc fcst:probability forecast
5:700:d=2026111806:TSTM:surface:0-12 hour acc fcst:probability forecast
"""


class FakeListing:
    """Stands in for the S3 ListObjectsV2 response."""
    def __init__(self, keys):
        self.body = "".join(f"<Contents><Key>{k}</Key><LastModified>{t}</LastModified><ETag>&quot;e&quot;</ETag>"
                            f"<Size>{s}</Size></Contents>" for k, t, s in keys)

    def __call__(self, url, timeout=None):
        body = f"<ListBucketResult>{self.body}</ListBucketResult>".encode()
        return type("R", (), {"read": lambda self: body})()


class Index(unittest.TestCase):
    def test_exact_selection_and_bounded_ranges(self):
        records = G.parse_index(INDEX)
        gust = G.select(records, {"var": "GUST", "level": "10 m above ground", "period": "12 hour fcst", "extra": ""}, 900)
        self.assertEqual((gust["start"], gust["end"]), (100, 249))
        last = G.select(records, {"var": "TSTM", "period": "0-12 hour acc fcst"}, 900)
        self.assertEqual((last["start"], last["end"]), (700, 899))
        with self.assertRaisesRegex(ValueError, "Ambiguous"):
            G.select(records, {"var": "GUST"}, 900)  # the ensemble std dev must not be picked up by accident
        with self.assertRaisesRegex(ValueError, "Missing"):
            G.select(records, {"var": "MXUPHL"}, 900)
        with self.assertRaises(ValueError):
            G.parse_index("1:50:d:A:b:c:\n2:10:d:B:b:c:\n")


class Windows(unittest.TestCase):
    def test_day1_rrfs_needs_192_messages_like_the_hrrr_audit(self):
        w = future_window("2026-11-18", 1)
        need = G.rrfs_requirements(w["first_forecast_hour"], w["last_forecast_hour"], 0)
        self.assertEqual(sorted(need)[0], 6)
        self.assertEqual(sorted(need)[-1], 30)
        self.assertEqual(sum(len(v) for v in need.values()), 192)
        self.assertEqual(need[30], {"uh25"})
        self.assertNotIn("uh25", need[6])

    def test_older_cycle_offsets_and_ineligible_cycles(self):
        w = future_window("2026-11-18", 2)
        cycle, offset = G.cycle_for("rrfs", w, 6)
        self.assertEqual((cycle.hour, offset), (6, 6))
        self.assertEqual(G.nbm_periods(24, 48, offset), [(30, 42), (42, 54)])
        with self.assertRaisesRegex(ValueError, "later than"):
            G.cycle_for("rrfs", future_window("2026-11-18", 1), 12)
        with self.assertRaisesRegex(ValueError, "long-enough"):
            G.cycle_for("rrfs", w, 9)  # 03/09/15/21Z RRFS stop at f018

    def test_protected_year_refused(self):
        with self.assertRaisesRegex(ValueError, "protected"):
            G.run("2025-05-15", 1, ["rrfs"], "/nonexistent", "/nonexistent")


class Arrival(unittest.TestCase):
    def test_deadlines_and_classes(self):
        w = future_window("2026-11-18", 1)
        limits = G.deadlines(w)
        self.assertEqual(limits, {"scheduled_run": "2026-11-18T09:30:00+00:00",
                                  "window_start": "2026-11-18T12:00:00+00:00"})
        self.assertEqual(G.deadlines(future_window("2026-11-18", 2))["scheduled_run"], "2026-11-18T15:30:00+00:00")
        self.assertEqual(G.classify({"last_modified": "2026-11-18T07:51:09Z"}, limits), "on_time")
        self.assertEqual(G.classify({"last_modified": "2026-11-18T10:00:00Z"}, limits), "late")
        self.assertEqual(G.classify({"last_modified": "2026-11-18T12:00:01Z"}, limits), "after_window_start")
        self.assertEqual(G.classify(None, limits), "missing")

    def test_index_arriving_after_grib_delays_pair(self):
        w = future_window("2026-11-18", 1)
        cycle = datetime(2026, 11, 18, 6, tzinfo=timezone.utc)
        key = "rrfs.20261118/06/rrfs.t06z.2dfld.3km.f006.conus.grib2"
        listing = FakeListing([(key, "2026-11-18T08:00:00Z", 1000),
                               (key + ".idx", "2026-11-18T10:20:00Z", 10)])
        result = G.availability("rrfs", w, cycle, [6], opener=listing)
        self.assertEqual(result["hours"][0]["pair_last_modified"], "2026-11-18T10:20:00Z")
        self.assertEqual(result["hours"][0]["status"], "late")
        self.assertFalse(result["complete_on_time"])

    def test_listing_failure_preserves_other_source_and_manifest(self):
        nbm_list = {"hours": [], "counts": {"missing": 0}}
        nbm_result = {"status": "complete", "messages": []}
        with TemporaryDirectory() as t, \
                patch.object(G, "availability", side_effect=[TimeoutError("RRFS listing timed out"), nbm_list]), \
                patch.object(G, "ingest_nbm", return_value=(nbm_result, None)) as ingest:
            output = Path(t) / "outputs"
            G.run("2026-11-18", 1, ["rrfs", "nbm"], output, Path(t) / "cache")
            ingest.assert_called_once()
            manifest = json.loads((output / "manifest.json").read_text())
        self.assertEqual(manifest["sources"]["rrfs"]["failure_stage"], "listing")
        self.assertEqual(manifest["sources"]["nbm"]["status"], "complete")

    def test_missing_and_late_hours_are_reported_not_filled(self):
        w = future_window("2026-11-18", 1)
        cycle = datetime(2026, 11, 18, 6, tzinfo=timezone.utc)
        keys = []
        for f in range(6, 31):
            if f == 17:
                continue  # one hour never arrived
            key = f"rrfs.20261118/06/rrfs.t06z.2dfld.3km.f{f:03d}.conus.grib2"
            when = "2026-11-18T10:05:00.000Z" if f == 30 else "2026-11-18T07:40:00.000Z"
            keys += [(key, when, 1000), (key + ".idx", when, 10)]
        avail = G.availability("rrfs", w, cycle, list(range(6, 31)), opener=FakeListing(keys))
        self.assertEqual(avail["counts"], {"on_time": 23, "late": 1, "after_window_start": 0, "missing": 1})
        self.assertFalse(avail["complete_on_time"])
        result, data = G.ingest_rrfs(w, cycle, 0, avail, client=None, expected_coordinates=None, budget_note="")
        self.assertEqual((result["status"], result["missing_forecast_hours"], data), ("incomplete", [17], None))


class Identity(unittest.TestCase):
    def test_rrfs_identities_match_v07_except_the_flagged_fields(self):
        contract = G.CONTRACT["field_identities"]
        for name, spec in G.RRFS_FIELDS.items():
            d, c, n, lev_type, lev, units = spec["id"]
            hrrr = contract[name]
            same = (hrrr["discipline"], hrrr["parameterCategory"], hrrr["parameterNumber"], hrrr["typeOfLevel"],
                    hrrr["level"], hrrr["units"]) == (d, c, n, lev_type, lev, units)
            self.assertEqual(same, name != "reflectivity", name)
        self.assertFalse(G.RRFS_FIELDS["uh25"]["comparable"])
        meta = {"discipline": 0, "parameterCategory": 16, "parameterNumber": 196, "typeOfLevel": "atmosphere",
                "level": 0, "units": "dB"}
        with self.assertRaisesRegex(ValueError, "differs from verified"):
            G.check_identity("reflectivity", meta)


class Neighborhood(unittest.TestCase):
    def test_radius_and_nearest(self):
        lat, lon = np.meshgrid(np.arange(36.0, 40.01, 0.05), np.arange(-90.0, -85.99, 0.05), indexing="ij")
        samples = np.array([[-88.0, 38.0]])
        hood = G.neighborhoods(lat, lon, samples)
        values = np.zeros(lat.shape, np.float32)
        values[np.unravel_index(hood["nearest"][0], lat.shape)] = 1
        # 0.30 degrees of latitude (33 km) north is inside 40.2 km; 0.40 (44 km) is outside.
        inside = np.argmin(np.abs(lat[:, 0] - 38.30)), np.argmin(np.abs(lon[0] + 88.0))
        outside = np.argmin(np.abs(lat[:, 0] - 38.40)), inside[1]
        values[outside] = 9
        self.assertEqual(float(G.neighborhood_max(values, hood)[0]), 1.0)
        values[inside] = 5
        self.assertEqual(float(G.neighborhood_max(values, hood)[0]), 5.0)
        values[inside] = np.nan
        with self.assertRaisesRegex(ValueError, "Missing NBM values"):
            G.neighborhood_max(values, hood)


class RealCaseRecord(unittest.TestCase):
    """The committed availability table for the real case is consistent with the code."""
    def test_table(self):
        table = json.loads((ROOT / "research/severe/guidance-phase1/availability-20261118.json").read_text())
        self.assertEqual(table["window"]["valid_start"], "2026-11-18T12:00:00+00:00")
        for source in ("rrfs", "nbm"):
            entry = table["sources"][source]
            self.assertEqual(entry["status"], "complete")
            self.assertEqual(entry["counts"]["missing"], 0)
            self.assertTrue(all(len(m["sha256"]) == 64 for m in entry["messages"]))
        self.assertEqual(len(table["sources"]["rrfs"]["messages"]), 192)


if __name__ == "__main__":
    unittest.main(verbosity=2)
