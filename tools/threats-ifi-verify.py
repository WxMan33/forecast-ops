#!/usr/bin/env python3
"""Check the live IFI record the map drew against ECMWF ecCodes (independent of the page's decoder).

Reads what tools/threats-ifi-check.js --live saved: for each device, the last record the page fetched and the cell it read
(the strongest cell). The record must be the field, height and hour the request named; ecCodes' value and position at that cell
must equal the page's.
    pip install eccodes numpy;  python3 tools/threats-ifi-verify.py docs/threats/ifi-check
"""
import glob, json, os, sys, urllib.parse as up
import eccodes, numpy as np

out = sys.argv[1] if len(sys.argv) > 1 else "docs/threats/ifi-check"
FIELD = {"prob": (19, 233), "sev": (19, 37)}
fails = 0
for pick_file in sorted(glob.glob(os.path.join(out, "*-pick.json"))):
    tag = os.path.basename(pick_file).split("-pick")[0]
    pick = json.load(open(pick_file))
    recs = sorted(glob.glob(os.path.join(out, tag + "-ifi-*.grib2")), key=lambda f: int(f.rsplit("-", 1)[1].split(".")[0]))
    q = dict(up.parse_qsl(up.urlparse(pick["url"]).query))
    h = eccodes.codes_new_from_message(open(recs[-1], "rb").read())
    g = lambda k: eccodes.codes_get(h, k)
    v = eccodes.codes_get_values(h)
    nx = g("Nx"); k = pick["j"] * nx + pick["i"]
    lat = eccodes.codes_get_array(h, "latitudes")[k]; lon = (eccodes.codes_get_array(h, "longitudes")[k] + 540) % 360 - 180
    level_m = eccodes.codes_get_double(h, "scaledValueOfFirstFixedSurface") / 10 ** g("scaleFactorOfFirstFixedSurface")
    rows = [
        ("field %s is GRIB2 0/%d/%d" % ((q["field"],) + FIELD[q["field"]]), (g("discipline"), g("parameterCategory"), g("parameterNumber")) == (0,) + FIELD[q["field"]]),
        ("height %s ft = %.1f m" % (q["ft"], level_m), abs(level_m - int(q["ft"]) * 0.3048) < 0.05),
        ("cycle %s, +%s h" % (q["cycle"], q["fh"]), "%08d%02d" % (g("dataDate"), g("dataTime") // 100) == q["cycle"] and int(g("step")) == int(q["fh"])),
        ("cell (%d, %d) value %.3f" % (pick["i"], pick["j"], v[k]), abs(v[k] - pick["value"]) < 1e-6 and abs(v[k] - pick["at"]["value"]) < 1e-6),
        ("cell at %.4f, %.4f" % (lat, lon), abs(lat - pick["lat"]) < 1e-3 and abs(lon - pick["lon"]) < 1e-3),
    ]
    for name, ok in rows:
        print(("pass " if ok else "FAIL ") + tag + ": " + name); fails += not ok
print("ecCodes verification: " + ("all passed" if not fails else "%d failed" % fails))
sys.exit(1 if fails else 0)
