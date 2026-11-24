#!/usr/bin/env python3
"""Independent check of the daily display mask (samples more than 25 miles from US land).

The generator measures point-to-edge distance in a flat frame around each sample. This test
uses a different method: great-circle distance to the original state rings densified to
<= 0.5 km spacing, via a 3-D k-d tree. Distance to a union of polygons equals the minimum over
its parts, so no union or linear referencing is involved.

  pip install numpy==2.3.5 scipy==1.17.0 shapely==2.2.0
"""
import json
import subprocess
import sys
import unittest
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree
from shapely import prepared
from shapely.geometry import Point, shape

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools/severe"))
import display_mask  # noqa: E402

EARTH, RADIUS, STEP = 6371.0088, 40.2336, 0.5


def unit(lon, lat):
    lon, lat = np.radians(lon), np.radians(lat)
    return np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], axis=-1)


def rings(features):
    for feature in features:
        geometry = feature["geometry"]
        polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
        for polygon in polygons:
            yield from polygon


def densified(features):
    points = []
    for ring in rings(features):
        xy = np.asarray(ring, dtype=float)
        a, b = unit(*xy[:-1].T), unit(*xy[1:].T)
        km = EARTH * np.arccos(np.clip((a * b).sum(1), -1, 1))
        for p, q, d in zip(a, b, km):
            n = max(1, int(np.ceil(d / STEP)))
            t = np.linspace(0, 1, n, endpoint=False)[:, None]
            v = p * (1 - t) + q * t
            points.append(v / np.linalg.norm(v, axis=1, keepdims=True))
    return np.vstack(points)


class DisplayMaskTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        features = json.loads(display_mask.STATES.read_text())["features"]
        cls.grid = np.asarray(json.loads(display_mask.GRID.read_text())["coordinates"])
        states = [prepared.prep(shape(f["geometry"])) for f in features]
        cls.inside = np.array([any(s.contains(Point(x, y)) for s in states) for x, y in cls.grid])
        chord, _ = cKDTree(densified(features)).query(unit(*cls.grid.T))
        cls.independent = np.where(cls.inside, 0.0, 2 * EARTH * np.arcsin(np.clip(chord / 2, 0, 1)))
        cls.generated = np.asarray(display_mask.distances(cls.grid.tolist()))
        cls.mask = set(json.loads(display_mask.OUTPUT.read_text())["hidden"])

    def test_distances_agree_with_great_circle_method(self):
        near = self.independent <= 100  # the generator searches 120 km and reports farther as infinite
        # Densified vertices overestimate by at most half a step; the flat frame errs slightly.
        difference = self.generated[near] - self.independent[near]
        self.assertLess(np.abs(difference).max(), 0.6, f"max disagreement {np.abs(difference).max():.3f} km")
        far = ~near
        self.assertTrue((self.generated[far] > RADIUS).all())

    def test_committed_mask_matches_independent_distances(self):
        expected = {int(i) for i in np.flatnonzero(self.independent > RADIUS)}
        ambiguous = {int(i) for i in np.flatnonzero(np.abs(self.independent - RADIUS) < 0.6)}
        self.assertEqual(self.mask - ambiguous, expected - ambiguous)
        self.assertFalse(self.mask & {int(i) for i in np.flatnonzero(self.inside)}, "land samples are never hidden")
        self.assertTrue(all(self.independent[i] > RADIUS - 0.6 for i in self.mask), "no hidden sample within 25 miles")

    def test_lake_erie_regression(self):
        # Linear referencing on the multi-part outline placed this sample about 613 km away.
        self.assertAlmostEqual(self.independent[13362], 7.6, delta=0.6)
        self.assertNotIn(13362, self.mask)

    def test_committed_mask_is_current(self):
        result = subprocess.run([sys.executable, str(ROOT / "tools/severe/display_mask.py"), "--check"],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
