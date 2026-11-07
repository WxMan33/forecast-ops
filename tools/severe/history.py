#!/usr/bin/env python3
"""Collect a frozen historical case, audit its future windows and join report labels."""
import argparse,hashlib,json,math,shutil
from datetime import datetime
from pathlib import Path
import numpy as np
from protocol import future_window,validate,check_grid,SCHEMA,PROTOCOL
from extract import extract,digest,write_json
from audit_extraction import audit


def join_case(case,manifests,labels,output):
    labels=Path(labels);lm=json.loads((labels/'manifest.json').read_text());lp=labels/lm['artifact']['file']
    if digest(lp)!=lm['artifact']['sha256']:raise ValueError('Frozen report-label hash mismatch')
    truth=np.load(lp,allow_pickle=False);features=[];targets=[];windows=[];columns=None;grid=None;geometry=None;identities=None
    for manifest_path in manifests:
        manifest_path=Path(manifest_path);m=json.loads(manifest_path.read_text())
        if m['feature_schema']!=SCHEMA or len(m['products'])!=1:raise ValueError('Not a frozen future-window predictor artifact')
        w=m['products'][0];validate(w)
        expected=future_window(case,w['day'])
        if any(w.get(k)!=v for k,v in expected.items()):raise ValueError('Case timing mismatch')
        audit_path=manifest_path.parent/'raw-audit.json'
        checked=json.loads(audit_path.read_text())
        if checked.get('status')!='passed' or checked.get('model_init_time')!=w['model_init_time'] or checked.get('source_messages_checked')!=192:raise ValueError('Matching raw predictor audit has not passed')
        source=manifest_path.parent/w['file']
        if digest(source)!=w['sha256']:raise ValueError('Predictor artifact hash mismatch')
        data=np.load(source,allow_pickle=False);coords=data['coordinates'];x=data['features'];names=data['feature_names']
        if grid is None:grid=coords;columns=names;geometry=m['native_grid'];identities=m['field_identities']
        if not np.array_equal(coords,grid) or not np.array_equal(names,columns) or m['native_grid']!=geometry or m['field_identities']!=identities:raise ValueError('Grid, column definitions or physical field identities differ between days')
        alignment=check_grid(coords,truth['coordinates'])
        if x.shape!=(len(coords),34) or x.dtype!=np.float32 or not np.isfinite(x).all():raise ValueError('Invalid predictor matrix')
        matches=[p for p in lm['products'] if p['initialization_date']==case and p['day']==w['day'] and p['valid_start']==w['valid_start'] and p['valid_end']==w['valid_end']]
        if len(matches)!=1:raise ValueError('No unique matching report-label window')
        p=matches[0];y=truth['labels'][p['index']]
        if y.shape!=(len(coords),3) or not np.isin(y,[0,1,255]).all():raise ValueError('Invalid report labels')
        features.append(x);targets.append(y);windows.append({**expected,'label_grid_alignment':alignment,'split':p['split'],'predictor_sha256':w['sha256'],'predictor_manifest_sha256':digest(manifest_path),'raw_audit_sha256':digest(audit_path),'label_window_index':p['index']})
    if [w['day'] for w in windows]!=[1,2]:raise ValueError('Both ordered daily windows are required')
    output=Path(output);path=output/'joined.npz'
    np.savez_compressed(path,coordinates=grid,feature_names=columns,features=np.stack(features),labels=np.stack(targets),hazards=truth['hazards'],days=np.array([1,2]))
    result={'schema_version':1,'status':'paired_predictors_and_report_labels_not_a_trained_forecast','case':case,'feature_schema':SCHEMA,'timing_protocol':PROTOCOL,'windows':windows,'label_artifact_sha256':lm['artifact']['sha256'],'grid_sha256':hashlib.sha256(grid.astype('<f8').tobytes()).hexdigest(),'canonical_label_grid_sha256':hashlib.sha256(truth['coordinates'].astype('<f8').tobytes()).hexdigest(),'samples_per_day':len(grid),'features_per_sample':34,'artifact':{'file':path.name,'sha256':digest(path)},'historical_public_availability_verified':False,'release_lag_assumption_hours':3,'operational_forecast_eligible':False,'model_fitted':False,'protected_2025_outcomes_accessed':False}
    write_json(output/'case-manifest.json',result);return result


def run_case(case,cohort,labels,output,cache,purge=False):
    cfg=json.loads(Path(cohort).read_text())
    if case not in cfg['cases'] or datetime.strptime(case,'%Y-%m-%d').year not in [2022,2023,2024]:raise ValueError('Case is not in the frozen development cohort')
    if cfg['protocol']!=PROTOCOL or cfg['feature_schema']!=SCHEMA:raise ValueError('Cohort protocol mismatch')
    output=Path(output)/case;cache=Path(cache)/case;output.mkdir(parents=True,exist_ok=True)
    code_hashes={p.name:digest(p) for p in Path(__file__).parent.glob('*.py')}
    paths=[];spent=0
    expected_coordinates=np.load(Path(labels)/'daily-labels.npz',allow_pickle=False)['coordinates']
    for day in [1,2]:
        w=future_window(case,day);issue=datetime.fromisoformat(w['model_init_time']);dest=output/f'day{day}';raw=cache/f'{issue.hour:02d}z'
        mp=dest/'manifest.json'
        if not mp.exists():
            remaining=cfg['max_download_mb_per_case']-math.ceil(spent/1000000)
            if remaining<=0:raise ValueError('Case download budget exhausted')
            extract(issue,dest,raw,budget_mb=remaining,days=(day,),target_windows=[w],expected_coordinates=expected_coordinates)
        m=json.loads(mp.read_text());spent+=m['downloaded_bytes']
        if any(m['products'][0].get(k)!=v for k,v in w.items()):raise ValueError('Cached product is not the requested future window')
        ap=dest/'raw-audit.json'
        if not ap.exists():audit(dest,raw,ap)
        paths.append(mp)
    result=join_case(case,paths,labels,output);result['extractor_code_sha256']=code_hashes
    write_json(output/'case-manifest.json',result)
    if purge and cache.exists():shutil.rmtree(cache)
    print(json.dumps({'case':case,'status':result['status'],'windows':len(result['windows']),'samples_per_day':result['samples_per_day']}),flush=True)
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--case',required=True);p.add_argument('--cohort',default='research/severe/cohort-v05.json');p.add_argument('--labels',default='research/severe/labels-v04');p.add_argument('--output',required=True);p.add_argument('--cache',required=True);p.add_argument('--purge-cache',action='store_true');a=p.parse_args()
    run_case(a.case,a.cohort,a.labels,a.output,a.cache,a.purge_cache)
