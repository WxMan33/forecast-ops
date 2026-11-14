/* Readable pages of columns for detailed tables. The first column stays visible; no data is discarded. */
(function(){
'use strict';
const states=new WeakMap();let frame=null;
function enhance(table){
 const wrap=table.parentElement,head=table.tHead;
 if(!head||head.rows.length!==1||!wrap||wrap.classList.contains('strip-scroll'))return;
 const header=head.rows[0],n=header.cells.length;if(n<3||Array.from(header.cells).some(c=>c.colSpan!==1))return;
 let state=states.get(table);
 if(state&&state.header===header){state.draw();return;}
 if(state){state.observer.disconnect();state.nav.remove();}
 const nav=document.createElement('div');nav.className='table-pager';
 nav.innerHTML='<button class="btn ghost sm" type="button" data-table-prev>← Previous columns</button><span aria-live="polite"></span><button class="btn ghost sm" type="button" data-table-next>Next columns →</button>';
 wrap.insertBefore(nav,table);table.classList.add('paged-detail-table');wrap.classList.add('paged-table-wrap');
 wrap.setAttribute('aria-label','Detailed forecast table; use Previous and Next columns to see every field');
 let start=1,lastSignature='',lastFirst=null;
 function draw(){
  if(!table.isConnected)return;
  const width=wrap.clientWidth;if(!width)return;
  const count=Math.min(n-1,Math.max(1,Math.floor((width-Math.min(150,width*.35))/125)));
  start=Math.max(1,Math.min(start,n-count));
  const signature=[width,start,count,table.rows.length].join('|');const first=table.tBodies[0]?.firstElementChild;if(signature===lastSignature&&lastFirst===first)return;lastSignature=signature;lastFirst=first;
  for(const row of table.rows){if(row.cells.length===n){Array.from(row.cells).forEach((c,i)=>{c.hidden=i!==0&&(i<start||i>=start+count)});}else if(row.cells.length===1&&row.cells[0].colSpan>1)row.cells[0].colSpan=count+1;}
  nav.hidden=count===n-1;
  nav.querySelector('span').textContent=`${header.cells[start].textContent.trim()}${count>1?' – '+header.cells[start+count-1].textContent.trim():''} · ${start}–${start+count-1} of ${n-1} columns`;
  nav.querySelector('[data-table-prev]').disabled=start===1;nav.querySelector('[data-table-next]').disabled=start+count>=n;
  table.style.setProperty('--table-label-width',Math.min(150,width*.35)+'px');
 }
 nav.querySelector('[data-table-prev]').onclick=()=>{start=Math.max(1,start-1);lastSignature='';draw()};
 nav.querySelector('[data-table-next]').onclick=()=>{start=Math.min(n-1,start+1);lastSignature='';draw()};
 const observer=new ResizeObserver(draw);observer.observe(wrap);state={header,nav,observer,draw};states.set(table,state);draw();
}
function scan(){frame=null;document.querySelectorAll('.tablewrap > table').forEach(enhance);}
const changes=new MutationObserver(records=>{if(records.every(r=>r.target.closest?.('.table-pager')))return;if(frame===null)frame=requestAnimationFrame(scan)});
changes.observe(document.body,{childList:true,subtree:true});scan();
})();
