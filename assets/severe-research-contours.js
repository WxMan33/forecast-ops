/* Display interpolation only. Native archived probabilities remain the source of point readouts. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory;
  else root.SevereResearchContours=factory(root.d3);
})(typeof globalThis!=='undefined'?globalThis:this,function(d3){
  'use strict';
  const BANDS=[
    [.001,'#f1f1f1','0.1%'],[.01,'#d5d5d5','1%'],[.02,'#35852a','2%'],
    [.03,'#7bcb62','3%'],[.05,'#865035','5%'],[.10,'#f4d052','10%'],
    [.15,'#ed3026','15%'],[.30,'#e332ef','30%'],[.45,'#853adb','45%'],[.60,'#244f83','60%+']
  ];
  const valid=p=>typeof p==='number'&&Number.isFinite(p)&&p>=0&&p<=1;
  function color(p){let c=null;for(const [threshold,value] of BANDS)if(valid(p)&&p>=threshold)c=value;return c;}
  function blend(color,background,alpha){const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));const a=rgb(color),b=rgb(background);return 'rgb('+a.map((v,i)=>Math.round(v*alpha+b[i]*(1-alpha))).join(',')+')';}
  function distance(a,b){const rad=Math.PI/180,dy=(a[1]-b[1])*rad,dx=(a[0]-b[0])*rad;
    const q=Math.sin(dy/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(dx/2)**2;
    return 12742.0176*Math.asin(Math.sqrt(Math.min(1,q)));}

  // A fixed geographic display mesh. Weights are reused for every case and hazard.
  // Reject long triangles: no interpolation across gaps or outside the sampled footprint.
  function mesh(coordinates,{west=-100,east=-75,south=30,north=45,step=.06,maxEdgeKm=25}={}){
    const nx=Math.ceil((east-west)/step)+1,ny=Math.ceil((north-south)/step)+1;
    const indices=new Int32Array(nx*ny*3).fill(-1),weights=new Float64Array(nx*ny*3);
    const triangulation=d3.Delaunay.from(coordinates,p=>p[0]*Math.cos(38*Math.PI/180),p=>p[1]);
    const triangles=triangulation.triangles;
    for(let t=0;t<triangles.length;t+=3){
      const ids=[triangles[t],triangles[t+1],triangles[t+2]], [a,b,c]=ids.map(i=>coordinates[i]);
      if(distance(a,b)>maxEdgeKm||distance(a,c)>maxEdgeKm||distance(b,c)>maxEdgeKm)continue;
      const denominator=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
      if(Math.abs(denominator)<1e-12)continue;
      const x0=Math.max(0,Math.ceil((Math.min(a[0],b[0],c[0])-west)/step));
      const x1=Math.min(nx-1,Math.floor((Math.max(a[0],b[0],c[0])-west)/step));
      const y0=Math.max(0,Math.ceil((north-Math.max(a[1],b[1],c[1]))/step));
      const y1=Math.min(ny-1,Math.floor((north-Math.min(a[1],b[1],c[1]))/step));
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
        const lon=west+x*step,lat=north-y*step;
        const u=((b[1]-c[1])*(lon-c[0])+(c[0]-b[0])*(lat-c[1]))/denominator;
        const v=((c[1]-a[1])*(lon-c[0])+(a[0]-c[0])*(lat-c[1]))/denominator,w=1-u-v;
        if(Math.min(u,v,w)<-1e-9)continue;
        const k=3*(y*nx+x);indices.set(ids,k);weights.set([Math.max(0,u),Math.max(0,v),Math.max(0,w)],k);
      }
    }
    return{coordinates,indices,weights,nx,ny,west,east,south,north,step};
  }
  function raster(m,values){
    if(values.length!==m.coordinates.length)throw Error('Contour grid length mismatch');
    const result=new Float64Array(m.nx*m.ny).fill(NaN);
    for(let k=0;k<result.length;k++){
      const q=k*3,a=m.indices[q],b=m.indices[q+1],c=m.indices[q+2];
      if(a<0||!valid(values[a])||!valid(values[b])||!valid(values[c]))continue;
      const sum=m.weights[q]+m.weights[q+1]+m.weights[q+2];
      result[k]=(values[a]*m.weights[q]+values[b]*m.weights[q+1]+values[c]*m.weights[q+2])/sum;
    }
    return result;
  }
  function contours(m,values){
    const field=raster(m,values);
    const polygons=d3.contours().size([m.nx,m.ny]).smooth(true).thresholds(BANDS.map(b=>b[0]))(field);
    return{type:'FeatureCollection',features:polygons.filter(g=>g.coordinates.length).map(g=>({
      type:'Feature',properties:{threshold:g.value,color:color(g.value)},
      geometry:{type:'MultiPolygon',coordinates:g.coordinates.map(polygon=>polygon.map(ring=>ring.map(([x,y])=>[
        Math.max(m.west,Math.min(m.east,m.west+(x-.5)*m.step)),
        Math.max(m.south,Math.min(m.north,m.north-(y-.5)*m.step))
      ])))}
    }))};
  }
  return{BANDS,color,blend,mesh,raster,contours};
});
