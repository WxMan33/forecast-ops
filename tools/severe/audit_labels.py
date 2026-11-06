#!/usr/bin/env python3
"""Independent raw-CSV / nearest-neighbor audit of daily wind and hail labels."""
import argparse,csv,gzip,json,re
from datetime import datetime,timedelta,timezone
from pathlib import Path
import numpy as np
from scipy.spatial import cKDTree
from extract import digest,write_json


def xyz(lon,lat):
    lo,la=np.deg2rad(lon),np.deg2rad(lat)
    return np.column_stack([np.cos(la)*np.cos(lo),np.cos(la)*np.sin(lo),np.sin(la)])


def audit(root,source,report):
    root,source=Path(root),Path(source);m=json.loads((root/'manifest.json').read_text())
    if digest(root/m['artifact']['file'])!=m['artifact']['sha256']:raise ValueError('Label artifact hash mismatch')
    data=np.load(root/m['artifact']['file'],allow_pickle=False);sites=xyz(data['coordinates'][:,0],data['coordinates'][:,1]);refs={};checks=[]
    for item in m['sources']:
        path=source/item['file']
        if digest(path)!=item['sha256']:raise ValueError('Source hash mismatch')
        year=int(re.search(r'_d(\d{4})_',item['file'])[1])
        if year not in [2022,2023,2024]:raise ValueError('Protected evaluation source')
        points={'wind':[],'hail':[]}
        with gzip.open(path,'rt',newline='') as f:
            for row in csv.DictReader(f):
                h={'Thunderstorm Wind':'wind','Hail':'hail'}.get(row['EVENT_TYPE'])
                if h is None:continue
                try:
                    lon,lat=float(row['BEGIN_LON']),float(row['BEGIN_LAT']);mag=float(row['MAGNITUDE'])
                    if not(20<lat<55 and -130<lon<-60) or mag<(50 if h=='wind' else 1):continue
                    offset=int(re.search(r'([+-]?\d+)$',row['CZ_TIMEZONE'])[1]);t=datetime.strptime(row['BEGIN_DATE_TIME'],'%d-%b-%y %H:%M:%S').replace(tzinfo=timezone(timedelta(hours=offset))).timestamp()
                    points[h].append([t,lon,lat])
                except (ValueError,TypeError):continue
        refs[year]={h:np.array(points[h],dtype=float).reshape(-1,3) for h in points}
    threshold=2*np.sin(40.2336/(2*6371.0088))
    for product in m['products']:
        start=datetime.fromisoformat(product['valid_start']);end=datetime.fromisoformat(product['valid_end'])
        for h,k in [('wind',1),('hail',2)]:
            points=refs[start.year][h];inside=points[(points[:,0]>=start.timestamp())&(points[:,0]<end.timestamp())]
            expected=np.zeros(len(sites),dtype=np.uint8)
            if len(inside):expected=(cKDTree(xyz(inside[:,1],inside[:,2])).query(sites)[0]<=threshold).astype(np.uint8)
            actual=data['labels'][product['index'],:,k];known=actual!=255
            np.testing.assert_array_equal(actual[known],expected[known])
            checks.append({'window':product['index'],'hazard':h,'known_samples_compared':int(known.sum()),'positive_samples':int((actual==1).sum())})
    result={'status':'passed','method':'independent raw CSV parse, fixed-standard offsets and unit-sphere cKDTree neighbors; wind/hail full grid in all 72 windows','comparisons':len(checks),'known_sample_labels_compared':sum(c['known_samples_compared'] for c in checks),'checks':checks,'tornado_check':'separate dense-track geometry and time-clipping unit tests; reported endpoints remain an imperfect path proxy','source_files':[s['file'] for s in m['sources']],'final_2025_outcomes_accessed':False}
    write_json(report,result);return result

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--labels',required=True);p.add_argument('--source-cache',required=True);p.add_argument('--report',required=True);a=p.parse_args();r=audit(a.labels,a.source_cache,a.report);print(json.dumps({k:r[k] for k in ['status','comparisons','known_sample_labels_compared']}))
