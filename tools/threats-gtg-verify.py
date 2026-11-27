#!/usr/bin/env python3
"""Check the GTG records the map drew against ECMWF ecCodes (independent of the page's decoder).

For each step saved by tools/threats-gtg-check.js: the record is EDPARM (discipline 0, category 19, number 30) at the height
the page said, from the cycle and forecast hour it said, on the 1799 x 1059 Lambert grid; the value the page read at its sample
cell equals ecCodes' value at that cell, and the cell's latitude and longitude agree.
    pip install eccodes numpy;  python3 tools/threats-gtg-verify.py docs/threats/gtg-check
"""
import json, os, sys
import eccodes, numpy as np

out = sys.argv[1] if len(sys.argv) > 1 else "docs/threats/gtg-check"
data = json.load(open(os.path.join(out, "gtg-check.json")))
fails = 0
for s in data["steps"]:
    if not s.get("file"):
        continue
    rec = open(os.path.join(out, s["file"]), "rb").read()
    h = eccodes.codes_new_from_message(rec)
    g = lambda k: eccodes.codes_get(h, k)
    vals = eccodes.codes_get_values(h)
    bm = eccodes.codes_get_array(h, "bitmap") if g("bitmapPresent") else np.ones(vals.size)
    nx, ny = g("Nx"), g("Ny")
    i, j = s["maxIJ"]
    k = j * nx + i
    lat, lon = eccodes.codes_get_array(h, "latitudes")[k], eccodes.codes_get_array(h, "longitudes")[k]
    lon = (lon + 540) % 360 - 180
    cyc = "%08d%02d" % (g("dataDate"), g("dataTime") // 100)
    rows = [
        ("parameter 0/19/30 (EDPARM)", (g("discipline"), g("parameterCategory"), g("parameterNumber")) == (0, 19, 30)),
        ("height %s m above MSL" % s["level"], g("typeOfLevel") == "heightAboveSea" and g("level") == s["level"]),
        ("cycle %s, forecast hour %s" % (s["cycle"], s["fh"]), cyc == s["cycle"] and int(g("step")) == s["fh"]),
        ("grid 1799 x 1059 Lambert, %d points with values" % int(bm.sum()), (nx, ny) == (1799, 1059) and g("gridType") == "lambert" and int(bm.sum()) == s["points"]),
        ("sample cell (%d, %d) value %.6f" % (i, j, vals[k]), bm[k] == 1 and abs(vals[k] - s["max"]) < 1e-6 and abs(vals[k] - s["readout"]["value"]) < 1e-6),
        ("sample cell at %.4f, %.4f" % (lat, lon), abs(lat - s["maxAt"][1]) < 1e-3 and abs(lon - s["maxAt"][0]) < 1e-3),
        ("field maximum is the sample", abs(np.max(np.where(bm == 1, vals, -1)) - s["max"]) < 1e-6),
    ]
    for name, ok in rows:
        print(("pass " if ok else "FAIL ") + s["tag"] + " " + s["step"] + ": " + name)
        fails += not ok
    eccodes.codes_release(h)
print("ecCodes verification: " + ("all passed" if not fails else "%d failed" % fails))
sys.exit(1 if fails else 0)
