#!/usr/bin/env python3
"""Recalculate selected daily features independently from retained raw fields."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import numpy as np
from extract import decode,digest,validate_time,write_json
from daily import required_fields


def audit(output,cache,destination):
    output,cache=Path(output),Path(cache)
    m=json.loads((output/'manifest.json').read_text());issue=datetime.fromisoformat(m['model_init_time'])
    expected={(h,name) for product in m['products'] for h,fields in required_fields(product).items() for name in fields}
    actual=[(r['forecast_hour'],r['field']) for r in m['source_receipts']]
    if set(actual)!=expected or len(actual)!=len(expected):raise ValueError('Missing or duplicate source messages')
    expected_hours={h for p in m['products'] for h in range(p['first_forecast_hour'],p['last_forecast_hour'])}
    if {r['valid_hour'] for r in m['hour_hashes']}!=expected_hours:raise ValueError('Incomplete hourly feature evidence')
    for receipt in m['source_receipts']:
        field=receipt['field'];hour=receipt['forecast_hour'];path=cache/f'f{hour:02d}'/(field+'.grib2')
        if digest(path)!=receipt['sha256']:raise ValueError('Source hash mismatch')
        validate_time(receipt['metadata'],issue,hour,field)
    w,e,s,n=m['bounds'];first_hour=min(p['first_forecast_hour'] for p in m['products'])
    first=decode(cache/f'f{first_hour:02d}/sbcape.grib2',issue,first_hour,'sbcape',True)
    sample=np.zeros(first['lat'].shape,bool);sample[::m['stride'],::m['stride']]=True
    rows,cols=np.where(sample&(first['lon']>=w)&(first['lon']<=e)&(first['lat']>=s)&(first['lat']<=n))
    points=np.unique(np.linspace(0,len(rows)-1,5,dtype=int));rr,cc=rows[points],cols[points]
    dy,dx=np.mgrid[-13:14,-13:14];disk=(dx*dx+dy*dy)*9<=40.2336**2
    checks=[]
    for product in m['products']:
        path=output/product['file']
        if digest(path)!=product['sha256']:raise ValueError('Predictor artifact hash mismatch')
        data=np.load(path,allow_pickle=False);names=list(data['feature_names']);start=product['first_forecast_hour']
        points=np.unique(np.r_[np.linspace(0,len(rows)-1,5,dtype=int),[np.argmax(data['features'][:,names.index(name)]) for name in ['x_sbcape_max','x_uh25_max','x_uh25_nearby_max_max']]])
        rr,cc=rows[points],cols[points]
        np.testing.assert_array_equal(data['coordinates'],np.column_stack((first['lon'][rows,cols],first['lat'][rows,cols])))
        if data['features'].shape!=(len(rows),34) or not np.isfinite(data['features']).all():raise ValueError('Invalid matrix')
        for field in ['sbcape','uh25']:
            raw,nearby=[],[]
            for valid_hour in range(start,start+24):
                hour=valid_hour+(1 if field=='uh25' else 0)
                a=decode(cache/f'f{hour:02d}'/(field+'.grib2'),issue,hour,field)['values']
                raw.append(a[rr,cc]);nearby.append(np.array([a[r-13:r+14,c-13:c+14][disk].max() for r,c in zip(rr,cc)]))
            for key,stack in [(field,raw),(field+'_nearby_max',nearby)]:
                values=np.array(stack,dtype=np.float64)
                for suffix,expected in [('mean',values.mean(axis=0)),('max',values.max(axis=0))]:
                    name='x_'+key+'_'+suffix;actual=data['features'][points,names.index(name)]
                    np.testing.assert_allclose(actual,expected.astype(np.float32),rtol=1e-6,atol=1e-6)
                    checks.append({'day':product['day'],'feature':name,'sample_indices':points.tolist(),'values':actual.tolist()})
    report={'status':'passed','model_init_time':issue.isoformat(),'source_messages_checked':len(m['source_receipts']),'raw_recalculation':'24-hour CAPE and hourly UH point/native-disk mean and maximum; five distributed centers plus day-specific CAPE/UH maxima','checks':checks,'probabilities_generated':False}
    write_json(destination,report);return report

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',required=True);p.add_argument('--cache',required=True);p.add_argument('--report',required=True);a=p.parse_args()
    result=audit(a.output,a.cache,a.report);print(json.dumps({k:result[k] for k in ['status','source_messages_checked','probabilities_generated']}))
