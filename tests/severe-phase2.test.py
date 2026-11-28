#!/usr/bin/env python3
"""Offline checks for the Phase 2 study helpers: month-grouped folds, sealed 2025, scoring
arithmetic and the reconstructed HRRR grid. No network, no archive."""
import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools/severe"))
import hrrr_grid  # noqa: E402
import phase2_study as S  # noqa: E402


class Folds(unittest.TestCase):
    def test_month_dates_share_a_fold_and_every_fold_spans_seasons(self):
        for month in range(1, 13):
            folds = {S.fold_of(f"2022-{month:02d}-{d:02d}") for d in (1, 8, 15, 22)}
            self.assertEqual(len(folds), 1)
        seasons = {k: set() for k in range(S.FOLDS)}
        for y in (2022, 2023):
            for m in range(1, 13):
                seasons[S.fold_of(f"{y}-{m:02d}-15")].add((m % 12) // 3)
        self.assertTrue(all(len(v) >= 2 for v in seasons.values()))

    def test_2025_is_refused(self):
        x, y = np.zeros((2, 1, 34)), np.zeros((2, 1, 3))
        with self.assertRaisesRegex(ValueError, "sealed"):
            S.stack([("2025-05-15", x, y)])


class Scores(unittest.TestCase):
    def test_contingency_and_average_precision(self):
        y = np.array([1, 0, 1, 0, 0], float)
        p = np.array([0.5, 0.4, 0.01, 0.0, 0.2])
        c = S.contingency(y, p, 0.1)
        self.assertEqual((c["hits"], c["misses"], c["false_alarms"], c["correct_negatives"]), (1, 1, 2, 1))
        self.assertAlmostEqual(c["csi"], 0.25)
        self.assertAlmostEqual(S.average_precision(y, p), (1 + 2 / 4) / 2)  # second event ranks 4th

    def test_bootstrap_is_paired_by_date(self):
        rng = np.random.default_rng(0)
        y = np.array([1, 0, 0, 0], float)
        dates = np.array([0, 0, 1, 1])
        better = np.array([0.9, 0.1, 0.0, 0.0])
        worse = np.array([0.1, 0.9, 0.5, 0.5])
        out = S.bootstrap(y, {"v07": worse, "cand": better}, dates, 0.25, "v07", rng)
        self.assertEqual(out["models"]["cand"]["share_of_resamples_better_than_reference"], 1.0)
        self.assertEqual(out["models"]["cand"]["dates_better_than_reference"], 2)


class Grid(unittest.TestCase):
    def test_reconstructed_hrrr_grid_contains_every_production_sample(self):
        lon, lat = hrrr_grid.lonlat(5)
        box = (lon >= -100) & (lon <= -75) & (lat >= 30) & (lat <= 45)
        coords = np.load(ROOT / "research/severe/labels-v04/daily-labels.npz")["coordinates"]
        self.assertEqual(int(box.sum()), len(coords))
        pts = np.c_[lon[box], lat[box]]
        order = np.lexsort((pts[:, 0], pts[:, 1]))
        ref = coords[np.lexsort((coords[:, 0], coords[:, 1]))]
        self.assertLess(np.abs(pts[order] - ref).max(), 1e-6)


if __name__ == "__main__":
    unittest.main(verbosity=2)
