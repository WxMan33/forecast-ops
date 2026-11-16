#!/usr/bin/env python3
"""Regression checks for protected dates, model contracts and expiry."""
import copy
import hashlib
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools/severe"))
from cohort import calendar_cases
from product import freshness, predict, read_model

ROOT = Path(__file__).resolve().parents[1]


class ProductTests(unittest.TestCase):
    def setUp(self):
        self.config = json.loads((ROOT / "research/severe/cohort-v07.json").read_text())
        self.model = json.loads((ROOT / "research/severe/baseline-v06/models.json").read_text())

    def test_expanded_calendar_and_fixed_evaluation(self):
        cases = calendar_cases(self.config)
        self.assertEqual(len(cases), 108)
        self.assertEqual(sum(c.startswith("2022") for c in cases), 48)
        self.assertEqual(sum(c.startswith("2023") for c in cases), 48)
        self.assertEqual([c for c in cases if c.startswith("2024")],
                         [f"2024-{m:02d}-15" for m in range(1, 13)])

    def test_calendar_changes_and_protected_dates_rejected(self):
        for date in ("2025-01-01", "2022-01-02"):
            changed = copy.deepcopy(self.config)
            changed["cases"].append(date)
            with self.assertRaises(ValueError):
                calendar_cases(changed)

    def test_model_hash_schema_and_scales(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.json"
            for change in ("valid", "schema", "scale"):
                model = copy.deepcopy(self.model)
                if change == "schema":
                    model["feature_schema"] = "four-hour"
                if change == "scale":
                    model["products"]["day1_wind"]["feature_scale"][0] = 0
                path.write_text(json.dumps(model))
                sha = hashlib.sha256(path.read_bytes()).hexdigest()
                with self.assertRaises(ValueError):
                    read_model(path, "0" * 64)
                if change == "valid":
                    self.assertEqual(read_model(path, sha)["feature_schema"], model["feature_schema"])
                else:
                    with self.assertRaises(ValueError):
                        read_model(path, sha)

    def test_feature_identity_missing_values_and_probability_bounds(self):
        names = np.array(self.model["feature_names"])
        features = np.zeros((2, 34))
        result = predict(self.model, 2, features, names)
        self.assertEqual(set(result), {"tornado", "wind", "hail"})
        self.assertTrue(all(0 <= p <= 1 for values in result.values() for p in values))
        with self.assertRaises(ValueError):
            predict(self.model, 2, features, names[::-1])
        features[0, 0] = np.nan
        with self.assertRaises(ValueError):
            predict(self.model, 2, features, names)

    def test_freshness_uses_actual_publication_and_expires_at_boundary(self):
        product = {"valid_start": "2026-11-17T12:00:00+00:00",
                   "valid_end": "2026-11-18T12:00:00+00:00",
                   "prepared_at": "2026-11-16T16:00:00+00:00"}
        utc = timezone.utc
        for now, expected in (
            (datetime(2026, 11, 16, 15, tzinfo=utc), "unavailable"),
            (datetime(2026, 11, 17, 11, tzinfo=utc), "upcoming"),
            (datetime(2026, 11, 17, 12, tzinfo=utc), "valid"),
            (datetime(2026, 11, 18, 12, tzinfo=utc), "expired"),
        ):
            self.assertEqual(freshness(product, now), expected)


if __name__ == "__main__":
    unittest.main()
