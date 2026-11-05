#!/usr/bin/env python3
"""Checks selection semantics and a generated, real-data CVG feed."""
import argparse
import datetime as dt
import importlib.util
import json
from pathlib import Path

s = importlib.util.spec_from_file_location("rrfs_point", Path(__file__).with_name("rrfs-point.py"))
m = importlib.util.module_from_spec(s)
s.loader.exec_module(m)

rows = m.inventory("1:0:d=2026110312:APCP:surface:0-6 hour acc fcst:\n2:10:d=2026110312:APCP:surface:5-6 hour acc fcst:\n3:20:d=2026110312:TMP:2 m above ground:6 hour fcst:\n4:30:d=2026110312:GUST:surface:6 hour fcst:\n")
assert m.select(rows, "APCP", "surface", 6, True) == (10, 19), "must select hourly, not cumulative precipitation"
assert m.select(rows, "TMP", "2 m above ground", 6) == (20, 29)
try:
    m.select(rows, "APCP", "surface", 5, True)
    raise AssertionError("wrong valid hour accepted")
except ValueError:
    pass
vis_meta = {"discipline": 0, "parameterCategory": 19, "parameterNumber": 0, "typeOfLevel": "surface", "level": 0, "stepType": "instant", "startStep": 1, "endStep": 1, "stepUnits": 1, "units": "m"}
assert m.validate_visibility(vis_meta, 0, 1) == 0
for bad in [{"units": "ft"}, {"parameterNumber": 1}, {"level": 2}, {"stepType": "avg"}, {"startStep": 0}, {"stepUnits": 0}]:
    try:
        m.validate_visibility({**vis_meta, **bad}, 100, 1)
        raise AssertionError("invalid visibility metadata accepted")
    except ValueError:
        pass
for value in [-1, float("nan"), 999999]:
    try:
        m.validate_visibility(vis_meta, value, 1)
        raise AssertionError("invalid visibility value accepted")
    except ValueError:
        pass
args = argparse.ArgumentParser()
args.add_argument("--feed")
a = args.parse_args()
if a.feed:
    j = json.loads(Path(a.feed).read_text())
    assert j["schema"] == 1 and j["method"] == "rrfs-cvg-native-v1"
    now = dt.datetime.now(dt.timezone.utc)
    assert dt.timedelta(0) <= now - dt.datetime.fromisoformat(j["cycle"].replace("Z", "+00:00")) < dt.timedelta(hours=16)
    assert dt.timedelta(0) <= now - dt.datetime.fromisoformat(j["generatedAt"].replace("Z", "+00:00")) < dt.timedelta(hours=8)
    assert set(j["members"]) == {"deterministic", "member01", "member02", "member03", "member04", "member05"}
    for name, member in j["members"].items():
        h = member["hourly"]
        n = len(h["temperature_2m"])
        assert n >= 2 and all(len(x) == n for x in h.values())
        assert all(x is not None and -90 <= x <= 65 for x in h["temperature_2m"])
        assert h["precipitation"][0] is None and h["snowfall"][0] is None, "analysis has no preceding forecast accumulation"
        assert all(x is not None and 0 <= x <= 500 for x in h["precipitation"][1:])
        assert all(x is None or x >= 0 for x in h["snowfall"][1:])
        if "snowUnavailableHours" in member:
            assert member["snowUnavailableHours"] == [i for i in range(1,n) if h["snowfall"][i] is None]
        if "visibility" in h:
            assert name == "deterministic" and j["units"]["visibility"] == "m"
            assert all(v is None or 0 <= v <= 200000 for v in h["visibility"])
            assert member["visibilityUnavailableHours"] == [i for i, v in enumerate(h["visibility"]) if v is None]
        assert member["grid"]["distance"] < 3
    manifest = json.loads(Path(a.feed).with_name(Path(a.feed).stem + "-manifest.json").read_text())
    assert manifest["cycle"] == j["cycle"] and len(manifest["evidence"]) >= 12
    assert all(len(x["sha256"]) == 64 for x in manifest["evidence"])
print("ok - RRFS interval selection and native feed checks")
