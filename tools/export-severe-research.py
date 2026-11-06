#!/usr/bin/env python3
"""Publish only dated historical v0.2 research predictions, verified against their artifact hashes."""
import argparse,csv,hashlib,io,json,math
from pathlib import Path
from zipfile import ZipFile
from datetime import datetime
p=argparse.ArgumentParser();p.add_argument('bundle');p.add_argument('--out',default='assets/severe-research');a=p.parse_args()
root=Path(a.out);root.mkdir(parents=True,exist_ok=True)
base='severe-guidance-v02/'
with ZipFile(a.bundle) as z:
 manifest=json.loads(z.read(base+'outputs/calendar-model/model_manifest.json'))
 raw=z.read(base+'outputs/calendar-model/heldout_predictions.csv')
 assert hashlib.sha256(raw).hexdigest()==manifest['predictions_sha256'],'Prediction provenance mismatch'
 scores=json.loads(z.read(base+'outputs/calendar-benchmark/benchmark.json'))
 cfg=manifest['config'];assert cfg['test_years']==[2024] and cfg['window_hours']==4 and cfg['radius_km']==40.2336
 runs={}
 for row in csv.DictReader(io.StringIO(raw.decode())):
  start=datetime.fromisoformat(row['valid_start']);end=datetime.fromisoformat(row['valid_end'])
  assert start.year==2024 and (end-start).total_seconds()==14400
  rid=row['run_id']
  if rid not in runs:runs[rid]={'id':rid,'date':start.date().isoformat(),'model_init_time':row['issue_time'],
    'valid_start':row['valid_start'],'valid_end':row['valid_end'],'coordinates':[],
    'probabilities':{h:[] for h in ['tornado','wind','hail']}}
  r=runs[rid];r['coordinates'].append([round(float(row['longitude']),6),round(float(row['latitude']),6)])
  for h in r['probabilities']:
   value=row.get('p_'+h);value=float(value) if value not in [None,''] else None
   assert value is None or (math.isfinite(value) and 0<=value<=1)
   r['probabilities'][h].append(float(f'{value:.8g}') if value is not None else None)
 def write(name,value):
  data=json.dumps(value,separators=(',',':'),allow_nan=False).encode();(root/name).write_bytes(data)
  return {'file':name,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}
 ordered=sorted(runs.values(),key=lambda r:r['date']);grid=ordered[0]['coordinates']
 assert len(grid)==16413
 grid_spec=write('grid.json',{'coordinates':grid})
 entries=[]
 for r in ordered:
  assert r.pop('coordinates')==grid,'Grid ordering changed'
  spec=write(r['date']+'.json',{'id':r['id'],'valid_start':r['valid_start'],'valid_end':r['valid_end'],'probabilities':r['probabilities']})
  entries.append({k:v for k,v in r.items() if k!='probabilities'}|spec)
 summary={h:{'positive_days':v['positive_event_days'],
    'brier':{k:s['brier_score'] for k,s in v['systems'].items()},
    'paired_ci':{k:c['ci95'] for k,c in v['paired_comparisons'].items()}}
    for h,v in scores['hazards'].items()}
 write('index.json',{'schema_version':1,'status':'historical_replay','model_version':'v0.2',
  'feature_schema':cfg['feature_schema'],'radius_km':cfg['radius_km'],'window_hours':4,
  'domain':{'west':-100,'east':-75,'south':30,'north':45},'sample_spacing_km':15,
  'operational_skill_established':False,'live_feed':False,'training_year':2022,'calibration_year':2023,
  'development_year':2024,'development_cases':12,'total_cases':36,'total_grid_samples':590868,
  'grid':grid_spec,'runs':entries,'validation':summary,
  'provenance':{'source_predictions_sha256':manifest['predictions_sha256'],
    'source_model_sha256':manifest['model_sha256'],'source_dataset_sha256':manifest['dataset_sha256'],
    'source_bundle_sha256':hashlib.file_digest(open(a.bundle,'rb'),'sha256').hexdigest(),
    'source_bundle_name':Path(a.bundle).name,'export_precision':'8 significant digits; coordinates 6 decimal degrees'}})
 print('Exported',len(entries),'historical runs;',sum(f.stat().st_size for f in root.glob('*.json')),'bytes')
