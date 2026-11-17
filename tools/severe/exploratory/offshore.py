"""Exploratory: land/coastal/offshore composition of the daily grid, 2022-2024 report labels and the live feed."""
import json, numpy as np
from shapely.geometry import shape, Point
from shapely.ops import unary_union
from shapely import prepared
from pathlib import Path
R=str(Path(__file__).resolve().parents[3])+'/'
states=unary_union([shape(f['geometry']) for f in json.load(open(R+'assets/severe-research/states.json'))['features']])
land=prepared.prep(states)
lab=np.load(R+'research/severe/labels-v04/daily-labels.npz')
coords=lab['coordinates'];L=lab['labels']  # windows x samples x hazards
m=json.load(open(R+'research/severe/labels-v04/manifest.json'))
years=sorted({p['initialization_date'][:4] for p in m['products']});assert years==['2022','2023','2024'],years
# Distance offshore (km) approximated in a local equirectangular frame around each point.
boundary=states.boundary
onland=np.array([land.contains(Point(x,y)) for x,y in coords])
dist=np.zeros(len(coords))
for i,(x,y) in enumerate(coords):
    if onland[i]:continue
    nearest=boundary.interpolate(boundary.project(Point(x,y)))
    dx=(nearest.x-x)*111.32*np.cos(np.radians(y));dy=(nearest.y-y)*110.57;dist[i]=np.hypot(dx,dy)
cat=np.where(onland,'land',np.where(dist<=40.2336,'coastal water (<=25 mi)','open water (>25 mi)'))
out={'samples':{c:int((cat==c).sum()) for c in np.unique(cat)}}
H=['tornado','wind','hail']
known=L!=255
out['label_rate_2022_2024']={c:{h:float(L[:,cat==c,k][known[:,cat==c,k]].mean()) for k,h in enumerate(H)} for c in np.unique(cat)}
out['label_rate_any_window_positive']={c:{h:float((L[:,cat==c,k]==1).any(axis=0).mean()) for k,h in enumerate(H)} for c in np.unique(cat)}
idx=json.load(open(R+'assets/severe-daily/index.json'))
feed={}
for run in idx['runs']:
    p=json.load(open(R+'assets/severe-daily/'+run['file']))['probabilities']
    for h in H:
        v=np.array(p[h]);i=int(v.argmax())
        feed[f"day{run['day']} {h}"]={'peak':round(float(v[i])*100,3),'peak_category':str(cat[i]),'peak_km_offshore':round(float(dist[i]),0),
          'mean_by_category_pct':{c:round(float(v[cat==c].mean())*100,3) for c in np.unique(cat)}}
out['live_feed_2026_11_16']=feed
print(json.dumps(out,indent=1))

