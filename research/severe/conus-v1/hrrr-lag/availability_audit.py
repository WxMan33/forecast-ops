import json, re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor
B = "https://noaa-hrrr-bdp-pds.s3.amazonaws.com"
NEED = {6: range(30, 49), 12: range(24, 43)}
REC = {"gust": ":GUST:surface:", "refc": ":REFC:entire atmosphere:", "uh25": ":MXUPHL:5000-2000 m above ground:"}
def get(u):
    for i in range(4):
        try:
            with urllib.request.urlopen(u, timeout=60) as r: return r.read().decode()
        except Exception as e: err = e
    raise err
def audit(d, deep):
    ds = d.replace("-", "")
    out = {"date": d}
    for cyc, hrs in NEED.items():
        lst = get(f"{B}/?list-type=2&prefix=hrrr.{ds}/conus/hrrr.t{cyc:02d}z.wrfsfcf&max-keys=1000")
        objs = dict(re.findall(r"<Key>[^<]*wrfsfcf(\d\d)\.grib2(?:\.idx)?</Key><LastModified>([^<]*)</LastModified>", lst))
        keys = set(re.findall(r"<Key>[^<]*wrfsfcf(\d\d\.grib2(?:\.idx)?)</Key>", lst))
        miss = [h for h in hrs if f"{h:02d}.grib2" not in keys or f"{h:02d}.grib2.idx" not in keys]
        lms = re.findall(r"wrfsfcf(\d\d)\.grib2(?:\.idx)?</Key><LastModified>([^<]*)<", lst)
        latest = max((lm for h, lm in lms if int(h) in hrs), default=None)
        out[f"t{cyc:02d}z"] = {"missing_hours": miss, "latest_last_modified": latest}
        if deep and not miss:
            recs = {}
            for h in (hrs[0], hrs[-1]):
                idx = get(f"{B}/hrrr.{ds}/conus/hrrr.t{cyc:02d}z.wrfsfcf{h:02d}.grib2.idx")
                recs[h] = {k: [l.split(":", 3)[3] for l in idx.splitlines() if v in l] for k, v in REC.items()}
            out[f"t{cyc:02d}z"]["records"] = recs
    return out
dates = [l.strip() for l in open(sys.argv[1]) if l.strip()]
deep = set(sys.argv[3].split(",")) if len(sys.argv) > 3 else set()
with ThreadPoolExecutor(16) as ex:
    res = list(ex.map(lambda d: audit(d, d in deep), dates))
json.dump(res, open(sys.argv[2], "w"), indent=0)
print(len(res), "audited")
