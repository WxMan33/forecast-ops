#!/usr/bin/env python3
"""Day 1/2 HRRR input contract and bounded current-data inventory.

This is input readiness, not an inference model. It never creates probabilities.
The four-hour research model is deliberately rejected for daily inference.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import urllib.request

UTC = timezone.utc
ROOT = 'https://noaa-hrrr-bdp-pds.s3.amazonaws.com'
SCHEMA = 'hrrr-daily-25mi-v1'
FIELDS = {
    'sbcape': ('CAPE', 'surface'), 'sbcin': ('CIN', 'surface'),
    'srh01': ('HLCY', '1000-0 m above ground'),
    'uh25': ('MXUPHL', '5000-2000 m above ground'),
    'reflectivity': ('REFC', 'entire atmosphere'),
    'dewpoint2m': ('DPT', '2 m above ground'),
    'shear06_u': ('VUCSH', '0-6000 m above ground'),
    'shear06_v': ('VVCSH', '0-6000 m above ground')}


def windows(initialization):
    if initialization.tzinfo is None or initialization.utcoffset() != timedelta(0):
        raise ValueError('UTC initialization required')
    if initialization.hour != 12 or initialization.minute or initialization.second:
        raise ValueError('Daily v1 requires a 12 UTC extended HRRR cycle')
    return [{'day': day, 'model': 'hrrr-v4', 'feature_schema': SCHEMA,
             'model_init_time': initialization.isoformat(), 'radius_km': 40.2336,
             'valid_start': (initialization+timedelta(hours=24*(day-1))).isoformat(),
             'valid_end': (initialization+timedelta(hours=24*day)).isoformat(),
             'window_hours': 24, 'first_forecast_hour': 24*(day-1),
             'last_forecast_hour': 24*day} for day in [1, 2]]


def required_fields(window):
    start, end = window['first_forecast_hour'], window['last_forecast_hour']
    if end-start != 24 or start not in [0, 24] or end > 48:
        raise ValueError('Only complete Day 1 and Day 2 windows are supported')
    hours = {}
    for hour in range(start, end):
        hours.setdefault(hour, {}).update({k:v for k,v in FIELDS.items() if k != 'uh25'})
        hours.setdefault(hour+1, {})['uh25'] = FIELDS['uh25']
    return hours


def require_daily_model(manifest, window):
    cfg = manifest.get('config', {})
    if (manifest.get('feature_schema') != SCHEMA or cfg.get('window_hours') != 24
            or cfg.get('radius_km') != 40.2336 or cfg.get('model_version') != 'hrrr-v4'
            or cfg.get('cycle_hour_utc') != 12
            or cfg.get('first_forecast_hour') != window['first_forecast_hour']
            or set(manifest.get('hazards_fitted', [])) != {'tornado','wind','hail'}):
        raise ValueError('A separately trained/calibrated daily model for this lead is required')
    return True


def select_ranges(index, fields):
    records = []
    for line in index.splitlines():
        p = line.split(':')
        if len(p) >= 6:
            records.append((int(p[1]),p[3],p[4],line))
    if not records or any(a[0]>=b[0] for a,b in zip(records,records[1:])):
        raise ValueError('Invalid GRIB index offsets')
    selected = {}
    for name, target in fields.items():
        matches = [i for i,r in enumerate(records) if r[1:3] == tuple(target)]
        if len(matches)!=1 or matches[0]+1 == len(records):
            raise ValueError('Missing, ambiguous or unbounded field: '+name)
        i=matches[0]
        selected[name]={'start':records[i][0],'end':records[i+1][0]-1,'index_line':records[i][3]}
    return selected


def probe(initialization, output):
    targets=windows(initialization); hours={}
    for window in targets:
        for hour,fields in required_fields(window).items(): hours.setdefault(hour,{}).update(fields)
    def check(item):
        hour,fields=item
        url=f'{ROOT}/hrrr.{initialization:%Y%m%d}/conus/hrrr.t12z.wrfsfcf{hour:02d}.grib2'
        try:
            req=urllib.request.Request(url+'.idx',headers={'User-Agent':'Forecast-Ops-Severe-Daily/0.1'})
            with urllib.request.urlopen(req,timeout=25) as response:
                raw=response.read(200001)
                if len(raw)>200000: raise ValueError('Index exceeds size limit')
            return {'forecast_hour':hour,'status':'available','source_url':url,
                    'retrieved_at':datetime.now(UTC).isoformat(),'index_sha256':hashlib.sha256(raw).hexdigest(),
                    'fields':select_ranges(raw.decode(),fields)}
        except Exception as exc:
            return {'forecast_hour':hour,'status':'unavailable','source_url':url,'error':str(exc)}
    with ThreadPoolExecutor(max_workers=4) as pool: records=list(pool.map(check,sorted(hours.items())))
    for window in targets:
        needed=set(required_fields(window))
        window['inputs_available']=all(r['status']=='available' for r in records if r['forecast_hour'] in needed)
        window['probabilities_available']=False
        window['reason']='Separate 24-hour trained and calibrated model not yet available'
    report={'schema_version':1,'product':'severe-daily-input-readiness','forecast':False,
            'created_at':datetime.now(UTC).isoformat(),'windows':targets,'files':records,
            'day3':{'supported':False,'reason':'Outside 48-hour HRRR horizon; requires a separate longer-range model'},
            'important':'Input inventory only. No daily or significant-severe probabilities have been generated.'}
    output=Path(output);output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(report,indent=2)+'\n')
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--date',help='12 UTC model initialization date (YYYY-MM-DD); latest 12 UTC cycle by default')
    parser.add_argument('--output',default='tests/out/severe-daily-inputs.json')
    args=parser.parse_args();now=datetime.now(UTC)
    issue=datetime.strptime(args.date,'%Y-%m-%d').replace(hour=12,tzinfo=UTC) if args.date else now.replace(hour=12,minute=0,second=0,microsecond=0)
    if not args.date and issue>now:issue-=timedelta(days=1)
    report=probe(issue,args.output)
    print(json.dumps({'model_init_time':issue.isoformat(),'days':[{k:w[k] for k in ['day','valid_start','valid_end','inputs_available','probabilities_available']} for w in report['windows']]}))

if __name__=='__main__':main()
