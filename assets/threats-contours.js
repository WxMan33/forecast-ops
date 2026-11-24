/* Display contouring only. Native archived probabilities remain the source of point readouts.

   Bands are computed exactly on a triangle mesh whose vertices ARE the original samples:
   inside each triangle the field is the linear blend of its three samples, with no raster
   resampling and no smoothing. Consequences that the tests rely on:
     - every sample lies inside the band of its own value (edge samples included);
     - the drawn field never exceeds the largest neighboring sample, so no new maxima appear;
     - triangles with an unavailable vertex or an edge longer than maxEdgeKm are left empty,
       so gaps and the area outside the sampled footprint are never bridged. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory;
  else root.SevereResearchContours=factory(root.d3);
})(typeof globalThis!=='undefined'?globalThis:this,function(d3){
  'use strict';
  // The two lowest bands were near-white and gray. On the light basemap the 0.1% band had a
  // contrast ratio of 1.00 (invisible); these cool grays stay distinct on both basemaps.
  const BANDS=[
    [.001,'#cfd8de','0.1%'],[.01,'#a3adb5','1%'],[.02,'#35852a','2%'],
    [.03,'#7bcb62','3%'],[.05,'#865035','5%'],[.10,'#f4d052','10%'],
    [.15,'#ed3026','15%'],[.30,'#e332ef','30%'],[.45,'#853adb','45%'],[.60,'#244f83','60%+']
  ];
  const valid=p=>typeof p==='number'&&Number.isFinite(p)&&p>=0&&p<=1;
  function band(p){let b=-1;if(valid(p))for(let i=0;i<BANDS.length;i++)if(p>=BANDS[i][0])b=i;return b;}
  function color(p){const b=band(p);return b<0?null:BANDS[b][1];}
  function blend(color,background,alpha){const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));const a=rgb(color),b=rgb(background);return 'rgb('+a.map((v,i)=>Math.round(v*alpha+b[i]*(1-alpha))).join(',')+')';}
  function distance(a,b){const rad=Math.PI/180,dy=(a[1]-b[1])*rad,dx=(a[0]-b[0])*rad;
    const q=Math.sin(dy/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(dx/2)**2;
    return 12742.0176*Math.asin(Math.sqrt(Math.min(1,q)));}

  // A fixed display mesh, reused for every case and hazard of one sample grid.
  // Long triangles are rejected: no interpolation across gaps or outside the sampled footprint.
  function mesh(coordinates,{maxEdgeKm=25}={}){
    const triangulation=d3.Delaunay.from(coordinates,p=>p[0]*Math.cos(38*Math.PI/180),p=>p[1]);
    const all=triangulation.triangles,kept=[];
    for(let t=0;t<all.length;t+=3){
      const i=all[t],j=all[t+1],k=all[t+2],a=coordinates[i],b=coordinates[j],c=coordinates[k];
      if(distance(a,b)>maxEdgeKm||distance(a,c)>maxEdgeKm||distance(b,c)>maxEdgeKm)continue;
      if(Math.abs((b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]))<1e-12)continue;
      kept.push(i,j,k);
    }
    return{coordinates,triangles:Int32Array.from(kept)};
  }
  function check(m,values){if(!values||values.length!==m.coordinates.length)throw Error('Contour grid length mismatch');}
  const lerp=(p,q,s)=>[p[0]+(q[0]-p[0])*s,p[1]+(q[1]-p[1])*s];
  function ccw(ring){let area=0;for(let i=0;i<ring.length;i++){const p=ring[i],q=ring[(i+1)%ring.length];area+=p[0]*q[1]-q[0]*p[1];}return area;}

  // Region of one triangle where the linear field is >= threshold (a convex polygon or nothing).
  function clip(points,values,threshold){
    const out=[];
    for(let e=0;e<3;e++){
      const p=points[e],q=points[(e+1)%3],fp=values[e],fq=values[(e+1)%3];
      if(fp>=threshold)out.push(p);
      if((fp>=threshold)!==(fq>=threshold))out.push(lerp(p,q,(threshold-fp)/(fq-fp)));
    }
    return out;
  }

  // Nested "at least threshold" regions, drawn lowest first, so each sample's own band is on top
  // at its location. Rings are counterclockwise (RFC 7946); vector tiling regroups multipolygon
  // rings by winding, so a mixed winding would turn some pieces into holes.
  function contours(m,values){
    check(m,values);
    const parts=BANDS.map(()=>[]),T=m.triangles,C=m.coordinates;
    for(let t=0;t<T.length;t+=3){
      const ids=[T[t],T[t+1],T[t+2]],f=ids.map(i=>values[i]);
      if(!f.every(valid))continue;
      const hi=Math.max(...f);if(hi<BANDS[0][0])continue;
      const points=ids.map(i=>C[i]);
      for(let b=0;b<BANDS.length&&BANDS[b][0]<=hi;b++){
        const ring=clip(points,f,BANDS[b][0]);
        if(ring.length<3)continue;
        const area=ccw(ring);if(Math.abs(area)<1e-14)continue;
        if(area<0)ring.reverse();
        ring.push(ring[0]);parts[b].push([ring]);
      }
    }
    return{type:'FeatureCollection',features:parts.map((polygons,b)=>({type:'Feature',
      properties:{threshold:BANDS[b][0],color:BANDS[b][1]},
      geometry:{type:'MultiPolygon',coordinates:polygons}})).filter(f=>f.geometry.coordinates.length)};
  }

  // Band boundaries as continuous lines (for outlines and labels). Each crossing point lies on a
  // mesh edge shared by at most two triangles, so segments chain through those edge keys.
  function isolines(m,values){
    check(m,values);
    const T=m.triangles,C=m.coordinates,features=[];
    for(const [threshold] of BANDS){
      const segments=[],byEdge=new Map(),key=(i,j)=>i<j?i+','+j:j+','+i;
      for(let t=0;t<T.length;t+=3){
        const ids=[T[t],T[t+1],T[t+2]],f=ids.map(i=>values[i]);
        if(!f.every(valid))continue;
        const ends=[];
        for(let e=0;e<3;e++){const a=e,b=(e+1)%3;if((f[a]>=threshold)!==(f[b]>=threshold))ends.push({key:key(ids[a],ids[b]),point:lerp(C[ids[a]],C[ids[b]],(threshold-f[a])/(f[b]-f[a]))});}
        if(ends.length!==2)continue;
        const s=segments.length;segments.push(ends);
        for(const end of ends){if(!byEdge.has(end.key))byEdge.set(end.key,[]);byEdge.get(end.key).push(s);}
      }
      const used=new Uint8Array(segments.length);
      const next=(edge,from)=>(byEdge.get(edge)||[]).find(s=>s!==from&&!used[s]);
      for(let s=0;s<segments.length;s++){
        if(used[s])continue;used[s]=1;
        const line=[segments[s][0].point,segments[s][1].point];
        for(const [side,edgeIndex] of [[1,1],[0,0]]){
          let edge=segments[s][edgeIndex].key,from=s,n;
          while((n=next(edge,from))!==undefined){
            used[n]=1;const [a,b]=segments[n],far=a.key===edge?b:a;
            if(side)line.push(far.point);else line.unshift(far.point);
            edge=far.key;from=n;
          }
        }
        features.push({type:'Feature',properties:{threshold},geometry:{type:'LineString',coordinates:line}});
      }
    }
    return{type:'FeatureCollection',features};
  }
  return{BANDS,valid,band,color,blend,mesh,contours,isolines};
});
