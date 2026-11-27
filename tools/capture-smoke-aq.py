#!/usr/bin/env python3
"""Archived smoke and air-quality fixtures from the official archives, in the shapes the live adapters read.

  hms  YYYYMMDD W S E N OUT.kml      NOAA HMS smoke KML for that UTC day, keeping placemarks that touch the box
                                      (satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/KML/YYYY/MM/)
  ra   YYYYMMDD OUT.dat AREA|ST ...   AirNow reportingarea.dat for that day (files.airnowtech.org/airnow/YYYY/YYYYMMDD/),
                                      rows for the listed reporting areas only (as published, pipe-delimited)
  mon  YYYYMMDDHH W S E N OUT.geojson AirNow HourlyAQObs for that UTC hour, monitors in the box, as GeoJSON with the
                                      field names of EPA's live "Air Now Current Monitor Data Public" layer
                                      (ValidTime = the file's UTC hour, epoch ms)
"""
import csv, io, json, re, sys, urllib.request, datetime
UA = {"User-Agent": "(forecast-ops, github.com/WxMan33/forecast-ops)"}
get = lambda u: urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=120).read().decode("utf-8", "replace")

def hms(day, w, s, e, n, out):
    w, s, e, n = map(float, (w, s, e, n))
    url = f"https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/KML/{day[:4]}/{day[4:6]}/hms_smoke{day}.kml"
    t = get(url); keep = []
    for pm in re.findall(r"<Placemark>.*?</Placemark>", t, re.S):
        xs, ys = [], []
        for c in re.findall(r"<coordinates>(.*?)</coordinates>", pm, re.S):
            for p in c.split():
                x, y = map(float, p.split(",")[:2]); xs.append(x); ys.append(y)
        if xs and max(xs) >= w and min(xs) <= e and max(ys) >= s and min(ys) <= n: keep.append(pm)
    head = t[: t.index("<Placemark>")] if "<Placemark>" in t else t
    open(out, "w").write(head + f"<!-- capture: {url}, placemarks touching box {w},{s},{e},{n} -->\n" + "\n".join(keep) + "\n</Document>\n</kml>\n")
    print("wrote", out, len(keep), "placemarks", file=sys.stderr)

def ra(day, out, *areas):
    url = f"https://files.airnowtech.org/airnow/{day[:4]}/{day}/reportingarea.dat"
    want = {tuple(a.split("|")) for a in areas}
    rows = [l for l in get(url).splitlines() if l.strip() and (lambda c: (c[7], c[8]) in want)(l.split("|"))]
    open(out, "w").write("\n".join(rows) + "\n")
    print("wrote", out, len(rows), "rows from", url, file=sys.stderr)

def mon(hour, w, s, e, n, out):
    w, s, e, n = map(float, (w, s, e, n))
    url = f"https://files.airnowtech.org/airnow/{hour[:4]}/{hour[:8]}/HourlyAQObs_{hour}.dat"
    at = int(datetime.datetime.strptime(hour, "%Y%m%d%H").replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)
    feats = []
    for r in csv.DictReader(io.StringIO(get(url))):
        try: x, y = float(r["Longitude"]), float(r["Latitude"])
        except ValueError: continue
        if not (w <= x <= e and s <= y <= n): continue
        num = lambda k: float(r[k]) if r.get(k) not in (None, "") else None
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [x, y]}, "properties": {
            "AQSID": r["AQSID"], "SiteName": r["SiteName"], "StateName": r["StateName"], "DataSource": r["DataSource"], "ReportingArea_PipeDelimited": r["ReportingArea_PipeDelimited"],
            "ValidTime": at, "GMTOffset": num("GMTOffset"), "Status": r["Status"], "PM25": num("PM25"), "PM25_AQI": num("PM25_AQI"), "PM10_AQI": num("PM10_AQI"), "OZONE_AQI": num("OZONE_AQI")}})
    json.dump({"type": "FeatureCollection", "_capture": {"source": url, "box": [w, s, e, n], "validTime": "file hour, UTC"}, "features": feats}, open(out, "w"), separators=(",", ":"))
    print("wrote", out, len(feats), "monitors", file=sys.stderr)

if __name__ == "__main__":
    {"hms": hms, "ra": ra, "mon": mon}[sys.argv[1]](*sys.argv[2:])
