"""Exploratory baseline, parameters fixed before scoring: report-occurrence climatology from the
2022-2023 15th-of-month windows (both 24-h windows per date), target month +-1, Gaussian
sigma 100 km truncated at 300 km. Scored once on 2024 development windows."""
import json, numpy as np
from scipy.spatial import cKDTree
from pathlib import Path
R=str(Path(__file__).resolve().parents[3])+'/'
lab=np.load(R+'research/severe/labels-v04/daily-labels.npz');L=lab['labels'];xy=lab['coordinates']
m=json.load(open(R+'research/severe/labels-v04/manifest.json'));P=m['products']
assert {p['initialization_date'][:4] for p in P}=={'2022','2023','2024'}
lat=np.radians(xy[:,1]);lon=np.radians(xy[:,0])
v=np.c_[np.cos(lat)*np.cos(lon),np.cos(lat)*np.sin(lon),np.sin(lat)]*6371.0088
tree=cKDTree(v);pairs=tree.sparse_distance_matrix(tree,300,output_type='coo_matrix')
w=np.exp(-0.5*(pairs.data/100)**2)
from scipy.sparse import coo_matrix
W=coo_matrix((w,(pairs.row,pairs.col)),shape=(len(xy),)*2).tocsr()
norm=np.asarray(W.sum(axis=1)).ravel()
H=['tornado','wind','hail']
v07=json.load(open(R+'research/severe/baseline-v07/development-scores.json'))['products']
out={}
for day in (1,2):
  for k,h in enumerate(H):
    rows=[];name=f'day{day}_{h}'
    by={d['case']:d for d in v07[name]['development_by_date']}
    for p in P:
      if p['split']!='development' or p['day']!=day:continue
      month=int(p['initialization_date'][5:7])
      months={(month-2)%12+1,month,month%12+1}
      hist=[q['index'] for q in P if q['split'] in('train','calibration') and int(q['initialization_date'][5:7]) in months]
      y=L[hist,:,k].astype(float);ok=L[hist,:,k]!=255
      rate=(W@(np.where(ok,y,0).sum(0)))/np.maximum(W@ok.sum(0),1e-9)
      target=L[p['index'],:,k];kn=target!=255
      clim=float(np.mean((rate[kn]-target[kn])**2))
      d=by[p['initialization_date']]
      assert d['known_points']==int(kn.sum())
      rows.append((clim,d['brier']['training_climatology'],d['brier']['calibrated']))
    a=np.array(rows)
    out[name]={'mean_date_brier':{'seasonal_spatial':a[:,0].mean(),'constant':a[:,1].mean(),'v07':a[:,2].mean()},
      'skill_v07_vs_constant':1-a[:,2].mean()/a[:,1].mean(),'skill_v07_vs_seasonal_spatial':1-a[:,2].mean()/a[:,0].mean(),
      'skill_seasonal_spatial_vs_constant':1-a[:,0].mean()/a[:,1].mean(),'dates_v07_beats_seasonal':int((a[:,2]<a[:,0]).sum())}
for n,r in out.items():print(n,'v07 vs const %+.3f  v07 vs seasonal %+.3f  seasonal vs const %+.3f  v07 better on %d/12 dates'%(r['skill_v07_vs_constant'],r['skill_v07_vs_seasonal_spatial'],r['skill_seasonal_spatial_vs_constant'],r['dates_v07_beats_seasonal']))

