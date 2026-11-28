import json, re, sys, urllib.request, datetime as dt
from concurrent.futures import ThreadPoolExecutor
B = "https://noaa-nbm-grib2-pds.s3.amazonaws.com"
GUST_H = list(range(24, 37)) + [39, 42, 45]
NEED_H = sorted(set(GUST_H) | {36, 48})
def get(u):
    for i in range(4):
        try:
            with urllib.request.urlopen(u, timeout=60) as r: return r.read().decode()
        except Exception as e:
            err = e
    raise err
def audit(d):
    ds = d.replace("-", "")
    lst = get(f"{B}/?list-type=2&prefix=blend.{ds}/12/core/&max-keys=1000")
    objs = {}
    for k, lm, sz in re.findall(r"<Key>([^<]*)</Key><LastModified>([^<]*)</LastModified>.*?<Size>(\d+)</Size>", lst):
        m = re.search(r"core\.f(\d{3})\.co\.grib2(\.idx)?$", k)
        if m: objs[(int(m.group(1)), bool(m.group(2)))] = lm
    missing = [h for h in NEED_H if (h, False) not in objs or (h, True) not in objs]
    out = {"date": d, "missing_hours": missing}
    if (36, True) in objs and (48, True) in objs:
        i36 = get(f"{B}/blend.{ds}/12/core/blend.t12z.core.f036.co.grib2.idx")
        i48 = get(f"{B}/blend.{ds}/12/core/blend.t12z.core.f048.co.grib2.idx")
        out["idx_records_f036"] = i36.count("\n")
        out["tstm_24_36"] = ":TSTM:surface:24-36 hour acc fcst:probability forecast" in i36
        out["tstm_36_48"] = ":TSTM:surface:36-48 hour acc fcst:probability forecast" in i48
        out["gust_f036"] = ":GUST:10 m above ground:36 hour fcst::" in i36 or ":GUST:10 m above ground:36 hour fcst:\n" in i36
    lm = [objs[(h, x)] for h in NEED_H for x in (False, True) if (h, x) in objs]
    out["latest_last_modified"] = max(lm) if lm else None
    return out
dates = [l.strip() for l in open(sys.argv[1]) if l.strip()]
with ThreadPoolExecutor(16) as ex:
    res = list(ex.map(audit, dates))
json.dump(res, open(sys.argv[2], "w"), indent=0)
print(len(res), "dates audited")
