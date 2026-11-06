#!/usr/bin/env python3
"""Frozen daily reported-event labels. SPC outlooks are never training truth.

0: no qualifying report in the source, 1: qualifying report, 255: unresolved.
Reported tornado endpoint paths are a geometric proxy, not surveyed polygons.
"""
import argparse,csv,gzip,hashlib,json,re
from collections import Counter
from datetime import datetime,timedelta,timezone
from pathlib import Path
import numpy as np
from daily import windows
from extract import Client,digest,write_json

NCEI='https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/'
HAZARDS=['tornado','wind','hail'];KINDS={'Tornado':'tornado','Thunderstorm Wind':'wind','Hail':'hail'}
EARTH=6371.0088;RADIUS=40.2336
EXCLUDED={'ALASKA','HAWAII','PUERTO RICO','GUAM','VIRGIN ISLANDS','AMERICAN SAMOA'}
YEARS={2022:'train',2023:'calibration',2024:'development'}


def utc(text,zone):
    match=re.fullmatch(r'[A-Z]{2,5}([+-]?\d{1,2})',zone)
    if not match or not -12<=int(match[1])<=14:raise ValueError('Unsupported local-standard timezone')
    value=datetime.strptime(text,'%d-%b-%y %H:%M:%S')
    return value.replace(tzinfo=timezone(timedelta(hours=int(match[1])))).astimezone(timezone.utc)


def vector(lon,lat):
    lon,lat=np.radians(lon),np.radians(lat)
    return np.stack([np.cos(lat)*np.cos(lon),np.cos(lat)*np.sin(lon),np.sin(lat)],axis=-1)


def location(row,prefix):
    try:
        lat,lon=float(row[prefix+'_LAT']),float(row[prefix+'_LON'])
        return vector(lon,lat) if 20<lat<55 and -130<lon<-60 else None
    except (ValueError,TypeError,KeyError):return None


def slerp(a,b,t):
    angle=np.arccos(np.clip(a@b,-1,1))
    if angle<1e-12:return a
    return (np.sin((1-t)*angle)*a+np.sin(t*angle)*b)/np.sin(angle)


def segment_distance(sites,a,b):
    endpoint=np.arccos(np.clip(np.maximum(sites@a,sites@b),-1,1))
    normal=np.cross(a,b);length=np.linalg.norm(normal)
    if length<1e-12:return EARTH*endpoint
    normal/=length;projection=sites-np.outer(sites@normal,normal)
    norms=np.linalg.norm(projection,axis=1);q=projection/np.maximum(norms[:,None],1e-15)
    within=(np.cross(a,q)@normal>=-1e-12)&(np.cross(q,b)@normal>=-1e-12)&(norms>1e-12)
    across=np.arcsin(np.clip(np.abs(sites@normal),0,1))
    return EARTH*np.where(within,np.minimum(endpoint,across),endpoint)


def normalize(rows):
    events=[];stats=Counter();seen={}
    for row in rows:
        hazard=KINDS.get(row.get('EVENT_TYPE'))
        if hazard is None or row.get('STATE') in EXCLUDED:continue
        eid=row.get('EVENT_ID')
        if not eid:raise ValueError('Missing event ID')
        signature=json.dumps(row,sort_keys=True)
        if eid in seen:
            if seen[eid]!=signature:raise ValueError('Conflicting duplicate event ID: '+eid)
            stats['duplicate_rows']+=1;continue
        seen[eid]=signature
        start=utc(row['BEGIN_DATE_TIME'],row['CZ_TIMEZONE'])
        end=start;uncertainty=None;point=location(row,'BEGIN');finish=point
        if point is None:uncertainty='unlocated_event'
        if hazard in ['wind','hail']:
            try:mag=float(row.get('MAGNITUDE',''))
            except (ValueError,TypeError):mag=np.nan
            if not np.isfinite(mag) or mag<=0:uncertainty=uncertainty or 'unresolved_magnitude'
            elif mag<(50 if hazard=='wind' else 1):stats['below_'+hazard+'_threshold']+=1;continue
        else:
            end=utc(row['END_DATE_TIME'],row['CZ_TIMEZONE']);finish=location(row,'END')
            if end<start:raise ValueError('Reversed tornado time: '+eid)
            if finish is None:uncertainty='unresolved_tornado_path'
            if point is not None and finish is not None and (np.arccos(np.clip(point@finish,-1,1))*EARTH>1000 or end-start>timedelta(hours=24)):uncertainty='implausible_tornado_path'
        stats[hazard+('_uncertain' if uncertainty else '_accepted')]+=1
        events.append({'id':eid,'hazard':hazard,'start':start,'end':end,'a':point,'b':finish,'uncertainty':uncertainty,'magnitude_type':row.get('MAGNITUDE_TYPE'),'episode_id':row.get('EPISODE_ID')})
    return events,dict(stats)


def label_window(coordinates,events,start,end):
    if start.tzinfo is None or end.tzinfo is None or start.utcoffset()!=timedelta(0) or end.utcoffset()!=timedelta(0) or end-start!=timedelta(hours=24):raise ValueError('Exact UTC daily window required')
    sites=vector(coordinates[:,0],coordinates[:,1]);labels=np.zeros((len(sites),3),dtype=np.uint8);positive=np.zeros_like(labels,bool);uncertain=np.zeros_like(labels,bool);selected=[];regional=Counter()
    for event in events:
        instant=event['start']==event['end']
        if instant and not start<=event['start']<end:continue
        if not instant and (event['start']>=end or event['end']<start):continue
        h=HAZARDS.index(event['hazard']);selected.append(event)
        if event['uncertainty']:
            # Missing track/location has an unbounded footprint; eligibility-only
            # uncertainty with a known point is localized to the 25-mile area.
            mask=np.ones(len(sites),bool) if event['uncertainty']!='unresolved_magnitude' else np.arccos(np.clip(sites@event['a'],-1,1))*EARTH<=RADIUS
            uncertain[:,h]|=mask;continue
        if event['hazard']=='tornado':
            a,b=event['a'],event['b']
            if not instant:
                seconds=(event['end']-event['start']).total_seconds()
                lo=max(0,(start-event['start']).total_seconds()/seconds);hi=min(1,(end-event['start']).total_seconds()/seconds)
                a,b=slerp(a,b,lo),slerp(a,b,hi)
            hit=segment_distance(sites,a,b)<=RADIUS
        else:hit=np.arccos(np.clip(sites@event['a'],-1,1))*EARTH<=RADIUS
        positive[:,h]|=hit
        if hit.any():regional[event['hazard']]+=1
    labels[uncertain]=255;labels[positive]=1
    counts={h:{'positive_samples':int((labels[:,i]==1).sum()),'unknown_samples':int((labels[:,i]==255).sum()),'report_records':sum(e['hazard']==h and e['uncertainty'] is None for e in selected),'regional_report_records':regional[h],'uncertain_records':sum(e['hazard']==h and e['uncertainty'] is not None for e in selected)} for i,h in enumerate(HAZARDS)}
    return labels,counts


def source_year(client,year):
    if year not in YEARS:raise ValueError('Only frozen 2022–2024 development sources are allowed; 2025 outcomes remain protected')
    index=client.fetch(NCEI,'directory.html')
    names=sorted(set(re.findall(rf'StormEvents_details-ftp_v1\.0_d{year}_c\d{{8}}\.csv\.gz',index.read_text())))
    if not names:raise ValueError('Missing annual NCEI archive')
    name=names[-1];path=client.fetch(NCEI+name,name,max_bytes=25000000)
    with gzip.open(path,'rt',newline='') as f:events,stats=normalize(csv.DictReader(f))
    return events,{'file':name,'sha256':digest(path),'receipt':json.loads(path.with_suffix('.gz.receipt.json').read_text()),'normalization':stats}


def build(grid,output,cache):
    output=Path(output)
    if output.exists():raise ValueError('New output directory required')
    coordinates=np.load(grid,allow_pickle=False)['coordinates']
    if coordinates.ndim!=2 or coordinates.shape[1]!=2 or not len(coordinates) or not np.isfinite(coordinates).all() or np.abs(coordinates[:,0]).max()>180 or np.abs(coordinates[:,1]).max()>90 or len(np.unique(coordinates,axis=0))!=len(coordinates):raise ValueError('Invalid sample grid')
    client=Client(cache,100);products=[];matrices=[];sources=[]
    for year,split in YEARS.items():
        events,source=source_year(client,year);sources.append(source)
        for month in range(1,13):
            issue=datetime(year,month,15,12,tzinfo=timezone.utc)
            for w in windows(issue):
                start,end=datetime.fromisoformat(w['valid_start']),datetime.fromisoformat(w['valid_end'])
                if start.year not in YEARS or end>datetime(2025,1,1,tzinfo=timezone.utc):raise ValueError('Protected evaluation outcomes would be accessed')
                labels,counts=label_window(coordinates,events,start,end);matrices.append(labels)
                products.append({'index':len(products),'split':split,'initialization_date':issue.date().isoformat(),'day':w['day'],'valid_start':start.isoformat(),'valid_end':end.isoformat(),'counts':counts})
        print(f'Labeled {year}: 24 fixed daily windows',flush=True)
    output.mkdir(parents=True);path=output/'daily-labels.npz'
    np.savez_compressed(path,coordinates=coordinates,labels=np.stack(matrices),hazards=np.array(HAZARDS))
    manifest={'schema_version':1,'status':'engineering_report_labels_not_a_trained_forecast','target':'at least one qualifying reported event within 25 statute miles during [start,end)','radius_km':RADIUS,'window_hours':24,'cohort':'15th monthly initializations, 2022–2024; frozen calendar pilot, not representative climatology','label_codes':{'0':'no qualifying report in source; not proof of no event','1':'qualifying reported event','255':'unresolved source metadata; exclude from fitting/scoring'},'tornado_geometry':'great-circle segment between reported endpoints, clipped to window; not a surveyed path','products':products,'sources':sources,'artifact':{'file':path.name,'sha256':digest(path)},'grid_sha256':hashlib.sha256(coordinates.astype('<f8').tobytes()).hexdigest(),'report_count_definition':'report_records are time-filtered CONUS records; regional_report_records intersect a sample neighborhood. County-segment records are not independent storms','outlook_inputs':False,'final_2025_outcomes_accessed':False,'daily_model_fitted':False}
    write_json(output/'manifest.json',manifest);return manifest

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--grid',required=True);p.add_argument('--output',required=True);p.add_argument('--cache',required=True);a=p.parse_args();m=build(a.grid,a.output,a.cache);print(json.dumps({'windows':len(m['products']),'status':m['status']}))
