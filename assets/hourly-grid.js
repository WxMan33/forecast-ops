/* Shared hourly grid: presentation only. It draws whatever rows it is given (values, phases, concerns) against an hour
   axis from HourlyModel.axis, with sticky row labels, responsive pages of hours on phones and desktop, a date row, accessible zone labels on repeated
   or changing hours, and one selected hour that callers can set from outside (a time bus) without redrawing.
   It knows nothing about weather, thresholds or how a cell's state was decided: each cell arrives as
     { text, state: "ok" | "missing" | "partial" | "clear" | "flag" | "concern", tier, icon, title, split: {from, to} }
   and is styled by state and tier (tier colours are the site's --monitor / --prepare / --action tokens). The same cell
   vocabulary is meant to be reusable by other threat displays; nothing here reads or implies any other engine. */
(function (root) {
  "use strict";
  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const DAY = (date) => { const d = new Date(Date.parse(date + "T12:00:00Z")); return d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }); };
  const STATE_WORD = { missing: "No guidance", partial: "Partial guidance", clear: "No concern found", flag: "", concern: "", ok: "", past: "" }; // each cell's own explanation says the rest

  function cellHtml(c, ms, sel) {
    const cls = ["hg-c", `hg-s-${c.state || "ok"}`]; if (c.tier) cls.push(`hg-t-${c.tier}`); if (ms === sel) cls.push("hg-sel"); if (c.past) cls.push("hg-past");
    const split = c.split ? ` style="--hg-from:${(c.split.from / 60) * 100}%;--hg-to:${(c.split.to / 60) * 100}%"` : "";
    const title = c.title || [STATE_WORD[c.state] || "", c.why || ""].filter(Boolean).join(" · ");
    return `<td class="${cls.join(" ")}" data-ms="${ms}"${split}${title ? ` title="${esc(title)}"` : ""}>${c.icon ? `<span class="hg-i" aria-hidden="true">${esc(c.icon)}</span>` : ""}${c.wind ? `<span class="hg-v hg-wind" aria-label="${esc(c.text)}"><span class="hg-wd${c.wind.dir ? "" : " hg-wd-none"}" aria-hidden="true">${c.wind.dir ? esc(c.wind.dir) : "&nbsp;"}</span> <span class="hg-ws" aria-hidden="true">${esc(c.wind.spd)}</span></span>` : `<span class="hg-v">${esc(c.text == null ? "" : c.text)}</span>`}${title && (c.state === "missing" || c.state === "concern" || c.state === "flag" || c.state === "partial") ? `<span class="sr-only"> (${esc(title)})</span>` : ""}</td>`;
  }

  /* opts: { axis, rows: [{key, label, sub, kind, cells}], selected, onSelect(ms), caption, now } -> { setSelected(ms) } */
  function render(host, { axis, rows, selected = null, onSelect = null, caption = "", now = null, label = "Hourly forecast" }) {
    if(host._hgDispose)host._hgDispose();
    host.classList.add("hg");
    if (!axis.length) { host.innerHTML = '<p class="hg-empty">No hours in this window.</p>'; return { setSelected() {} }; }
    /* date row: one cell per local day run */
    const days = []; axis.forEach((a) => { if (a.newDay || !days.length) days.push({ date: a.date, n: 1 }); else days[days.length - 1].n++; });
    const head1 = `<tr class="hg-days"><th scope="col" class="hg-lab hg-corner"><span class="sr-only">Local date</span></th>${days.map((d) => `<th scope="colgroup" colspan="${d.n}" class="hg-day">${esc(DAY(d.date))}</th>`).join("")}</tr>`;
    const head2 = `<tr class="hg-hours"><th scope="col" class="hg-lab hg-corner">Local time</th>${axis.map((a) => {
      const cls = ["hg-h"]; if (a.newDay) cls.push("hg-nd"); if (a.ms === selected) cls.push("hg-sel"); if (now != null && a.ms + 3600e3 <= now) cls.push("hg-past");
      return `<th scope="col" class="${cls.join(" ")}" data-ms="${a.ms}"><button type="button" class="hg-hb" data-ms="${a.ms}" aria-pressed="${a.ms === selected}" aria-label="${esc(`${DAY(a.date)} ${a.hourText} ${a.zone}`)}">${esc(a.hourText)}${a.showZone ? ` <span class="sr-only">${esc(a.zone)}</span>` : ""}</button></th>`; }).join("")}</tr>`;
    const body = rows.map((r) => `<tr class="hg-row hg-k-${esc(r.kind || "value")}" data-row="${esc(r.key)}"><th scope="row" class="hg-lab">${esc(r.label)}${r.sub ? `<small>${esc(r.sub)}</small>` : ""}</th>${r.cells.map((c, i) => cellHtml(c, axis[i].ms, selected)).join("")}</tr>`).join("");
    host.innerHTML = `<div class="hg-scroll" tabindex="0" role="region" aria-label="${esc(label)}; use Earlier and Later for more hours"><table class="hg-t">${caption ? `<caption class="sr-only">${esc(caption)}</caption>` : ""}<thead>${head1}${head2}</thead><tbody>${body}</tbody></table></div>`;
    const scroller = host.querySelector(".hg-scroll");
    let pageStart=0,pageSize=1,sel=selected,lastWidth=0;
    const nav=document.createElement('div');nav.className='hg-pager';
    nav.innerHTML='<button type="button" class="btn bx-btn ghost sm" data-hg-prev aria-label="Earlier table hours">← Earlier</button><span class="hg-window" aria-live="polite"></span><button type="button" class="btn bx-btn ghost sm" data-hg-next aria-label="Later table hours">Later →</button>';
    host.prepend(nav);
    let sizedFor='';
    function setVisible(start,end){
      const visible=i=>i>=start&&i<end;
      host.querySelectorAll('.hg-hours th[data-ms]').forEach((th,i)=>{th.hidden=!visible(i)});
      host.querySelectorAll('tr.hg-row').forEach(tr=>Array.from(tr.querySelectorAll('td')).forEach((td,i)=>{td.hidden=!visible(i)}));
      let from=0;host.querySelectorAll('.hg-day').forEach(th=>{const full=days[Array.from(th.parentNode.querySelectorAll('.hg-day')).indexOf(th)].n;const n=Math.max(0,Math.min(from+full,end)-Math.max(from,start));th.hidden=!n;th.colSpan=n||1;from+=full;});
    }
    function showPage(target=null){
      const labWidth=host.clientWidth<=560?92:128;
      pageSize=Math.max(1,Math.min(12,Math.floor((host.clientWidth-labWidth-2)/70)));
      if(target!==null){const i=axis.findIndex(a=>a.ms===target);if(i>=0&&(i<pageStart||i>=pageStart+pageSize))pageStart=Math.floor(i/pageSize)*pageSize;}
      pageStart=Math.max(0,Math.min(pageStart,Math.max(0,axis.length-pageSize)));
      const end=Math.min(axis.length,pageStart+pageSize);
      /* every row keeps its tallest height across all pages of this width, so paging never moves the page below */
      if(sizedFor!==host.clientWidth+':'+pageSize){sizedFor=host.clientWidth+':'+pageSize;const trs=Array.from(host.querySelectorAll('tr'));trs.forEach(tr=>{tr.style.height='';});const tall=trs.map(()=>0);
        for(let s0=0;s0<axis.length;s0+=pageSize){setVisible(s0,Math.min(axis.length,s0+pageSize));trs.forEach((tr,k)=>{tall[k]=Math.max(tall[k],tr.getBoundingClientRect().height);});}
        trs.forEach((tr,k)=>{if(tall[k])tr.style.height=Math.ceil(tall[k])+'px';});}
      setVisible(pageStart,end);
      const a=axis[pageStart],z=axis[end-1];
      nav.querySelector('.hg-window').textContent=`${DAY(a.date)} · ${a.hourText} ${a.zone} – ${z.date!==a.date?DAY(z.date)+' · ':''}${z.hourText} ${z.zone} · ${pageStart+1}–${end} of ${axis.length} hours`;
      nav.querySelector('[data-hg-prev]').disabled=pageStart===0;nav.querySelector('[data-hg-next]').disabled=end===axis.length;
      host.dataset.pageStart=String(pageStart);host.dataset.pageSize=String(pageSize);
    }
    nav.querySelector('[data-hg-prev]').onclick=()=>{pageStart=Math.max(0,pageStart-pageSize);showPage()};
    nav.querySelector('[data-hg-next]').onclick=()=>{pageStart=Math.min(axis.length-pageSize,pageStart+pageSize);showPage()};
    const resize=new ResizeObserver(()=>{if(Math.abs(host.clientWidth-lastWidth)>1){lastWidth=host.clientWidth;showPage(sel)}});resize.observe(host);
    host._hgDispose=()=>resize.disconnect();

    const setSelected = (ms, { scroll = true } = {}) => {
      host.querySelectorAll(".hg-sel").forEach((el) => el.classList.remove("hg-sel"));
      host.querySelectorAll('.hg-hb[aria-pressed="true"]').forEach((b) => b.setAttribute("aria-pressed", "false"));
      if (ms == null) return;
      host.querySelectorAll(`[data-ms="${ms}"]`).forEach((el) => { if (el.tagName !== "BUTTON") el.classList.add("hg-sel"); });
      const b = host.querySelector(`.hg-hb[data-ms="${ms}"]`); if (b) b.setAttribute("aria-pressed", "true");
      sel=ms;if(scroll)showPage(ms);
    };
    host.querySelector("table").addEventListener("click", (e) => {
      const t = e.target.closest("[data-ms]"); if (!t || !onSelect) return;
      const ms = +t.dataset.ms; setSelected(ms, { scroll: false }); onSelect(ms);
    });
    showPage(selected);
    if (selected != null) setSelected(selected);
    return { setSelected };
  }

  /* a legend line in the same vocabulary as the cells */
  function legend(items) {
    return `<div class="hg-legend">${items.map((x) => `<span><i class="hg-sw hg-s-${esc(x.state || "ok")}${x.tier ? ` hg-t-${esc(x.tier)}` : ""}">${x.icon ? esc(x.icon) : ""}</i>${esc(x.text)}</span>`).join("")}</div>`;
  }

  const api = { render, legend, cellHtml };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.HourlyGrid = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
