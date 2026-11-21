#!/usr/bin/env python3
"""NHC archived advisory GIS as a fixture, in the shape of the live NOAA map service
(tropical/NHC_tropical_weather_summary: Forecast Points 5, Forecast Track 6, Forecast Cone 7, Watch-Warning 8; lowercase
field names as the service uses).

  python3 tools/capture-nhc.py al092026 004 OUT.geojson
  -> https://www.nhc.noaa.gov/gis/forecast/archive/al092026_5day_004.zip (cone pgn, track lin, points pts, ww lines)
Needs pyshp."""
import io, json, sys, urllib.request, zipfile
import shapefile
storm, adv, out = sys.argv[1:4]
url = f"https://www.nhc.noaa.gov/gis/forecast/archive/{storm}_5day_{adv}.zip"
z = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "(forecast-ops, github.com/WxMan33/forecast-ops)"}), timeout=60).read()))
LAYER = {"_5day_pgn": "cone", "_5day_lin": "track", "_5day_pts": "points", "_ww_wwlin": "watchwarning"}
feats = []
for n in sorted(x for x in z.namelist() if x.endswith(".shp")):
    b = n[:-4]; layer = next((v for k, v in LAYER.items() if b.endswith(k)), None)
    if not layer: continue
    r = shapefile.Reader(shp=io.BytesIO(z.read(b + ".shp")), dbf=io.BytesIO(z.read(b + ".dbf")), shx=io.BytesIO(z.read(b + ".shx")))
    names = [f[0].lower() for f in r.fields[1:]]
    for rec, s in zip(r.records(), r.shapes()):
        p = dict(zip(names, list(rec))); p["layer"] = layer; p["idp_source"] = b
        feats.append({"type": "Feature", "geometry": s.__geo_interface__, "properties": p})
json.dump({"type": "FeatureCollection", "_capture": {"source": url}, "features": feats}, open(out, "w"), separators=(",", ":"), default=str)
print("wrote", out, len(feats), "features", file=sys.stderr)
