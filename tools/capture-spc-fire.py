#!/usr/bin/env python3
"""Archived SPC Fire Weather Outlooks as fixtures in SPC's own live GeoJSON shape.

Live SPC publishes products/fire_wx/dayNfw_{windrh,dryt}.lyr.geojson (Days 1-2) and
products/exper/fire_wx/dayNfw_{windrh,dryt}prob.lyr.geojson (Days 3-8). The archive keeps:
  - Days 1-2: products/fire_wx/YYYY/YYMMDD_HHMM_dayNfirewx-shp.zip  (wind/RH layer and a *_dryltg layer)
  - Days 3-8: products/exper/fire_wx/YYYY/YYMMDD_day38pts.txt          (categorical Critical areas, as points)
The shapefile attributes are SPC's (DN, VALID, EXPIRE, ISSUE, LABEL, LABEL2); ISO times are added as live does.
Usage:
  python3 tools/capture-spc-fire.py shp YYMMDD_HHMM_dayNfirewx OUT_PREFIX     -> OUT_PREFIX-windrh.geojson, OUT_PREFIX-dryt.geojson
  python3 tools/capture-spc-fire.py pts YYMMDD OUT.geojson                      -> Days 3-8 categorical Critical areas
Needs pyshp (pip install pyshp)."""
import io, json, re, sys, urllib.request, zipfile, datetime
UA = {"User-Agent": "(forecast-ops, github.com/WxMan33/forecast-ops)"}
get = lambda u: urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60).read()
iso = lambda s: datetime.datetime.strptime(s, "%Y%m%d%H%M").replace(tzinfo=datetime.timezone.utc).isoformat() if s else None

def shp(name, prefix):
    import shapefile
    year = "20" + name[:2]
    url = f"https://www.spc.noaa.gov/products/fire_wx/{year}/{name}-shp.zip"
    zf = zipfile.ZipFile(io.BytesIO(get(url)))
    for base in sorted({n[:-4] for n in zf.namelist() if n.endswith(".shp")}):
        r = shapefile.Reader(shp=io.BytesIO(zf.read(base + ".shp")), dbf=io.BytesIO(zf.read(base + ".dbf")), shx=io.BytesIO(zf.read(base + ".shx")))
        feats = []
        for rec, s in zip(r.records(), r.shapes()):
            p = rec.as_dict()
            for k in ("VALID", "EXPIRE", "ISSUE"): p[k + "_ISO"] = iso(p.get(k))
            g = s.__geo_interface__ if s.points else {"type": "GeometryCollection", "geometries": []}
            feats.append({"type": "Feature", "geometry": g, "properties": p})
        part = "dryt" if base.endswith("_dryltg") else "windrh"
        out = f"{prefix}-{part}.geojson"
        json.dump({"type": "FeatureCollection", "_capture": {"source": url, "layer": base}, "features": feats}, open(out, "w"), separators=(",", ":"))
        print("wrote", out, [f["properties"]["LABEL"] for f in feats], file=sys.stderr)

def pts(day, out):
    year = "20" + day[:2]
    url = f"https://www.spc.noaa.gov/products/exper/fire_wx/{year}/{day}_day38pts.txt"
    t = get(url).decode()
    m = re.search(r"(\d{3,4}) (AM|PM) (\w{3}) \w{3} (\w{3}) (\d{1,2}) (\d{4})", t)
    v = re.search(r"VALID TIME (\d\d)(\d\d)(\d\d)Z", t)
    issued_local = m.group(0) if m else None
    # the issue time in UTC comes from the local stamp (CDT/CST)
    off = {"CDT": 5, "CST": 6}[m.group(3)]
    hhmm = m.group(1).zfill(4); h = int(hhmm[:2]) % 12 + (12 if m.group(2) == "PM" else 0)
    issued = datetime.datetime.strptime(f"{m.group(6)} {m.group(4)} {m.group(5)}", "%Y %b %d").replace(hour=h, minute=int(hhmm[2:]), tzinfo=datetime.timezone.utc) + datetime.timedelta(hours=off)
    start3 = issued.replace(hour=12, minute=0) + datetime.timedelta(days=2)
    if v and int(v.group(1)) != start3.day: raise SystemExit("unexpected Day 3 start " + v.group(0))
    feats = []
    for sect, label in ((r"CRITICAL FIRE WEATHER AREA", "CRIT"), (r"DRY THUNDERSTORM", "SDRT")):
        s = re.search(r"\.\.\. " + sect + r"[^.]*\.\.\.(.*?)(?=\n\.\.\. |\Z)", t, re.S)
        if not s: continue
        for dm in re.finditer(r"\bD(\d)\s+((?:\d{8}\s*)+)", s.group(1)):
            n = int(dm.group(1)); ring = []
            for c in re.findall(r"\d{8}", dm.group(2)):
                lat, lon = int(c[:4]) / 100, int(c[4:]) / 100
                if lon < 50: lon += 100
                ring.append([-lon, lat])
            start = start3 + datetime.timedelta(days=n - 3)
            feats.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]}, "properties": {
                "DAY": n, "LABEL": label, "LABEL2": "Critical fire weather area" if label == "CRIT" else "Critical dry thunderstorm area",
                "VALID_ISO": start.isoformat(), "EXPIRE_ISO": (start + datetime.timedelta(days=1)).isoformat(), "ISSUE_ISO": issued.isoformat()}})
    json.dump({"type": "FeatureCollection", "_capture": {"source": url, "issued_local": issued_local}, "features": feats}, open(out, "w"), separators=(",", ":"))
    print("wrote", out, [(f["properties"]["DAY"], f["properties"]["LABEL"]) for f in feats], file=sys.stderr)

if __name__ == "__main__":
    {"shp": shp, "pts": pts}[sys.argv[1]](*sys.argv[2:])
