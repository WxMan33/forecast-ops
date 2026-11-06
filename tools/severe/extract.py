#!/usr/bin/env python3
"""Extract complete 24-hour HRRR predictor windows. Never emits probabilities.

Dependencies are pinned in requirements.txt. Outputs are immutable predictor-only
artifacts for daily training and prospective inference, not daily forecasts.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import threading
import time
import urllib.error
import urllib.request
import numpy as np
from daily import FIELDS, ROOT, SCHEMA, required_fields, select_ranges, windows


def digest(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(1048576),b''):h.update(chunk)
    return h.hexdigest()


def write_json(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+'.tmp');tmp.write_text(json.dumps(value,indent=2,allow_nan=False)+'\n');tmp.replace(path)


class Client:
    def __init__(self,root,budget_mb):
        self.root=Path(root);self.limit=budget_mb*1000000;self.used=0;self.lock=threading.Lock()
    def fetch(self,url,name,start=None,end=None,max_bytes=200000):
        path=self.root/name;receipt=path.with_suffix(path.suffix+'.receipt.json')
        identity={'url':url,'start':start,'end':end}
        if path.exists():
            meta=json.loads(receipt.read_text())
            if any(meta.get(k)!=v for k,v in identity.items()) or digest(path)!=meta['sha256']:raise ValueError('Cache identity/hash mismatch: '+str(path))
            return path
        limit=max_bytes if start is None else end-start+1
        if limit>(8000000 if start is not None else 25000000):raise ValueError('Requested response exceeds per-file limit')
        headers={'User-Agent':'Forecast-Ops-Severe-Daily/0.1','Accept-Encoding':'identity'}
        if start is not None:headers['Range']=f'bytes={start}-{end}'
        for attempt in range(3):
            try:
                with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=45) as response:
                    if start is not None and (response.status!=206 or not response.headers.get('Content-Range','').startswith(f'bytes {start}-{end}/')):raise ValueError('Server ignored exact GRIB byte range')
                    data=response.read(limit+1)
                    with self.lock:
                        self.used+=len(data)
                        if self.used>self.limit:raise ValueError('Download budget exhausted')
                    if len(data)>limit or start is not None and len(data)!=limit:raise ValueError('Incorrect response length')
                    etag=response.headers.get('ETag')
                break
            except (urllib.error.URLError,TimeoutError) as error:
                if isinstance(error,urllib.error.HTTPError) and error.code not in [429,500,502,503,504]:raise
                if attempt==2:raise
                time.sleep(2**attempt)
        path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_suffix(path.suffix+'.part');tmp.write_bytes(data);tmp.replace(path)
        write_json(receipt,{**identity,'sha256':digest(path),'bytes':len(data),'etag':etag,'retrieved_at':datetime.now(timezone.utc).isoformat()})
        return path


def validate_time(meta,issue,hour,name):
    if meta['dataDate']!=int(issue.strftime('%Y%m%d')) or meta['dataTime']!=1200 or meta['endStep']!=hour or meta['stepUnits']!=1:raise ValueError('GRIB initialization/lead mismatch')
    if name=='uh25':
        if meta['stepType']!='max' or meta['startStep']!=hour-1:raise ValueError('UH must cover the preceding complete hourly interval')
    elif meta['stepType']!='instant' or meta['startStep']!=hour:raise ValueError('Instantaneous field has unexpected time semantics')


def decode(path,issue,hour,name,coordinates=False):
    import eccodes as ec
    with open(path,'rb') as f:
        gid=ec.codes_grib_new_from_file(f)
        if gid is None:raise ValueError('Empty GRIB message')
        try:
            keys=['dataDate','dataTime','startStep','endStep','stepType','stepUnits','units','discipline','parameterCategory','parameterNumber','typeOfLevel','level']
            meta={k:ec.codes_get(gid,k) for k in keys};validate_time(meta,issue,hour,name)
            shape=(ec.codes_get(gid,'Nj'),ec.codes_get(gid,'Ni'))
            geometry={k:ec.codes_get(gid,k) for k in ['gridType','Ni','Nj','DxInMetres','DyInMetres','latitudeOfFirstGridPointInDegrees','longitudeOfFirstGridPointInDegrees','LaDInDegrees','LoVInDegrees','Latin1InDegrees','Latin2InDegrees','iScansNegatively','jScansPositively']}
            if geometry['gridType']!='lambert' or geometry['DxInMetres']!=3000 or geometry['DyInMetres']!=3000:raise ValueError('Unsupported native HRRR grid')
            values=np.asarray(ec.codes_get_array(gid,'values'),dtype=np.float32).reshape(shape)
            if not np.isfinite(values).all() or np.abs(values).max()>1e10:raise ValueError('Missing/nonfinite GRIB predictor')
            result={'values':values,'metadata':meta,'geometry':geometry}
            if coordinates:
                result['lat']=ec.codes_get_array(gid,'latitudes').reshape(shape)
                result['lon']=(ec.codes_get_array(gid,'longitudes').reshape(shape)+180)%360-180
            second=ec.codes_grib_new_from_file(f)
            if second is not None:
                ec.codes_release(second);raise ValueError('Expected exactly one GRIB message')
            return result
        finally:ec.codes_release(gid)


def disk_max_at_samples(values,rows,cols,radius_km=40.2336,spacing_km=3):
    radius=radius_km/spacing_km;extent=int(np.floor(radius))
    if rows.min()<extent or cols.min()<extent or rows.max()+extent>=values.shape[0] or cols.max()+extent>=values.shape[1]:raise ValueError('Native neighborhood would cross model grid edge')
    out=np.full(len(rows),-np.inf,dtype=np.float32)
    for dy in range(-extent,extent+1):
        half=int(np.floor(np.sqrt(radius**2-dy**2)))
        for dx in range(-half,half+1):np.maximum(out,values[rows+dy,cols+dx],out=out)
    return out


class Aggregate:
    def __init__(self):self.hours=set();self.sums={};self.maxima={}
    def add(self,hour,features):
        if hour in self.hours:raise ValueError('Duplicate valid hour')
        if self.hours and set(features)!=set(self.sums):raise ValueError('Feature schema changed')
        vectors={name:np.asarray(values,dtype=np.float64) for name,values in features.items()}
        if not vectors or any(a.ndim!=1 or not np.isfinite(a).all() for a in vectors.values()):raise ValueError('Invalid hourly predictor vector')
        if len({a.shape for a in vectors.values()})!=1:raise ValueError('Hourly sample vectors differ in size')
        if self.sums and any(a.shape!=self.sums[name].shape for name,a in vectors.items()):raise ValueError('Sample grid changed')
        for name,a in vectors.items():
            if name in self.sums:self.sums[name]+=a;np.maximum(self.maxima[name],a,out=self.maxima[name])
            else:self.sums[name]=a.copy();self.maxima[name]=a.copy()
        self.hours.add(hour)
    def finish(self,start):
        if self.hours!=set(range(start,start+24)):raise ValueError('A complete 24-hour predictor window is required')
        columns=sorted('x_'+n+'_'+stat for n in self.sums for stat in ['max','mean'])
        arrays={'x_'+n+'_max':a for n,a in self.maxima.items()}
        arrays.update({'x_'+n+'_mean':a/24 for n,a in self.sums.items()})
        return columns,np.column_stack([arrays[n] for n in columns]).astype(np.float32)


def extract(issue,output,cache,budget_mb=2000,days=(1,2),stride=5,bounds=(-100,-75,30,45)):
    targets=[w for w in windows(issue) if w['day'] in days]
    if not targets or set(days)-{1,2}:raise ValueError('Choose Day 1 and/or Day 2')
    output=Path(output)
    if output.exists():raise ValueError('Output must be a new directory; use the verified download cache to resume')
    client=Client(cache,budget_mb);aggregates={w['day']:Aggregate() for w in targets};geometry=None;identity={};rows=cols=coords=None;receipts=[];hour_hashes=[]
    required={}
    for window in targets:
        for hour,fields in required_fields(window).items():required.setdefault(hour,{}).update(fields)
    # One decoded native field at a time; retain only the sampled hourly vectors.
    sampled={}
    for hour,fields in sorted(required.items()):
        url=f'{ROOT}/hrrr.{issue:%Y%m%d}/conus/hrrr.t12z.wrfsfcf{hour:02d}.grib2'
        idx=client.fetch(url+'.idx',f'f{hour:02d}.idx');spec=select_ranges(idx.read_text(),fields)
        def get(item):
            name,selection=item;path=client.fetch(url,f'f{hour:02d}/{name}.grib2',selection['start'],selection['end']);return name,path
        with ThreadPoolExecutor(max_workers=4) as pool:files=dict(pool.map(get,spec.items()))
        for name,path in files.items():
            data=decode(path,issue,hour,name,coordinates=geometry is None)
            if geometry is None:
                geometry=data['geometry'];w,e,s,n=bounds
                mask=(data['lon']>=w)&(data['lon']<=e)&(data['lat']>=s)&(data['lat']<=n)
                sample=np.zeros(mask.shape,bool);sample[::stride,::stride]=True;rows,cols=np.where(mask&sample)
                if not len(rows):raise ValueError('No sample centers in domain')
                coords=np.column_stack((data['lon'][rows,cols],data['lat'][rows,cols]))
            if data['geometry']!=geometry:raise ValueError('Native grid definition changed')
            field_id={k:v for k,v in data['metadata'].items() if k not in ['dataDate','dataTime','startStep','endStep','stepType','stepUnits']}
            if name in identity and identity[name]!=field_id:raise ValueError('Parameter identity or units changed')
            identity[name]=field_id
            sampled.setdefault(hour,{})[name]=(data['values'][rows,cols],disk_max_at_samples(data['values'],rows,cols))
            receipts.append({**json.loads(path.with_suffix('.grib2.receipt.json').read_text()),'forecast_hour':hour,'field':name,'metadata':data['metadata']})
        # fH instantaneous predictors plus UH from fH+1 form valid hour [H,H+1).
        previous=hour-1
        if previous in sampled and 'uh25' in sampled[hour]:
            pairs={k:v for k,v in sampled[previous].items() if k!='uh25'}
            if len(pairs)==7:
                pairs['uh25']=sampled[hour]['uh25'];features={}
                for name,(point,nearby) in pairs.items():features[name]=point;features[name+'_nearby_max']=nearby
                features['shear06']=np.hypot(pairs['shear06_u'][0],pairs['shear06_v'][0])
                day=1 if previous<24 else 2
                if day in aggregates:aggregates[day].add(previous,features)
                hour_hashes.append({'valid_hour':previous,'sha256':hashlib.sha256(b''.join(features[k].astype('<f4').tobytes() for k in sorted(features))).hexdigest()})
            del sampled[previous]
        print(f'Extracted f{hour:02d}; {len(rows)} sample centers; {client.used/1e6:.1f} MB downloaded',flush=True)
    # Nothing is written as a complete output until both requested windows pass.
    completed={day:agg.finish(0 if day==1 else 24) for day,agg in aggregates.items()}
    output.mkdir(parents=True)
    products=[]
    for window in targets:
        day=window['day'];columns,matrix=completed[day];path=output/f'day{day}-features.npz'
        np.savez_compressed(path,coordinates=coords,features=matrix,feature_names=np.array(columns))
        products.append({**window,'file':path.name,'sha256':digest(path),'samples':len(coords),'features':columns,'probabilities_available':False})
    manifest={'schema_version':1,'status':'predictors_only_not_a_forecast','feature_schema':SCHEMA,'model_init_time':issue.isoformat(),'completed_at':datetime.now(timezone.utc).isoformat(),'bounds':list(bounds),'stride':stride,'native_grid':geometry,'field_identities':identity,'grid_sha256':hashlib.sha256(coords.astype('<f8').tobytes()).hexdigest(),'products':products,'hour_hashes':hour_hashes,'source_receipts':receipts,'downloaded_bytes':client.used,'neighborhood':'Nominal 3 km native-grid disk; no missing/edge padding','operational_skill_established':False}
    write_json(output/'manifest.json',manifest)
    return manifest


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--date',required=True);p.add_argument('--output',required=True);p.add_argument('--cache',required=True);p.add_argument('--max-download-mb',type=int,default=2000);p.add_argument('--days',type=int,nargs='+',choices=[1,2],default=[1,2]);args=p.parse_args()
    issue=datetime.strptime(args.date,'%Y-%m-%d').replace(hour=12,tzinfo=timezone.utc)
    result=extract(issue,args.output,args.cache,args.max_download_mb,tuple(args.days));print(json.dumps({k:result[k] for k in ['status','model_init_time','downloaded_bytes']}))
if __name__=='__main__':main()
