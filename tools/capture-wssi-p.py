#!/usr/bin/env python3
"""Capture WPC's probabilistic Winter Storm Severity Index (WSSI-P, Overall index) for a region, as a compact fixture.

Source: NOAA map service outlooks/wpc_wssi_p (WPC WSSI-P), layers 10 (Winter Weather Area), 1 Minor, 2 Moderate,
3 Major, 4 Extreme. Each feature is one probability band (prob 5..95) for one rolling 24-hour window (validstart/validend).
The features are clipped to the region box and lightly simplified (0.01 degree) so the fixture stays small; the fields
are kept as published. Usage:  python3 tools/capture-wssi-p.py NAME W S E N OUT.json
"""
import json, sys, time, urllib.request, urllib.parse
from shapely.geometry import shape, mapping, box

BASE = "https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/wpc_wssi_p/MapServer/{}/query?"
LEVELS = {10: "WWA", 1: "MINOR", 2: "MODERATE", 3: "MAJOR", 4: "EXTREME"}
name, w, s, e, n, out = sys.argv[1], *map(float, sys.argv[2:6]), sys.argv[6]
clip = box(w, s, e, n)
features, meta = [], {"captured": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "region": name, "box": [w, s, e, n],
                      "source": "NOAA map service outlooks/wpc_wssi_p (WPC probabilistic Winter Storm Severity Index, Overall)"}
for layer, level in LEVELS.items():
    q = {"geometry": f"{w},{s},{e},{n}", "geometryType": "esriGeometryEnvelope", "inSR": 4326, "outSR": 4326, "spatialRel": "esriSpatialRelIntersects",
         "outFields": "prob,impact,component,inittime,fcsthr,validstart,validend,idp_filedate", "returnGeometry": "true", "maxAllowableOffset": 0.005, "f": "geojson"}
    for attempt in range(3):
        try:
            req = urllib.request.Request(BASE.format(layer) + urllib.parse.urlencode(q), headers={"User-Agent": "(forecast-ops, github.com/WxMan33/forecast-ops)"})
            data = json.load(urllib.request.urlopen(req, timeout=180)); break
        except Exception as ex:
            if attempt == 2: raise
            time.sleep(5)
    for f in data.get("features", []):
        g = shape(f["geometry"]).buffer(0).intersection(clip).simplify(0.01, preserve_topology=True)
        if g.is_empty: continue
        p = dict(f["properties"]); p["level"] = level
        features.append({"type": "Feature", "properties": p, "geometry": mapping(g)})
    print(level, len(data.get("features", [])), "features", file=sys.stderr)
json.dump({"type": "FeatureCollection", "_capture": meta, "features": features}, open(out, "w"), separators=(",", ":"))
print("wrote", out, len(features), "features", file=sys.stderr)
