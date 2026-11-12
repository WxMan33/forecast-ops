/* Shared hourly grid: presentation only. It draws whatever rows it is given (values, phases, concerns) against an hour
   axis from HourlyModel.axis, with sticky row labels, horizontal scrolling on phones, a date row, zone labels on repeated
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
    return `<td class="${cls.join(" ")}" data-ms="${ms}"${split}${title ? ` title="${esc(title)}"` : ""}>${c.icon ? `<span class="hg-i" aria-hidden="true">${esc(c.icon)}</span>` : ""}<span class="hg-v">${esc(c.text == null ? "" : c.text)}</span>${title && (c.state === "missing" || c.state === "concern" || c.state === "flag" || c.state === "partial") ? `<span class="sr-only"> (${esc(title)})</span>` : ""}</td>`;
  }

  /* opts: { axis, rows: [{key, label, sub, kind, cells}], selected, onSelect(ms), caption, now } -> { setSelected(ms) } */
  function render(host, { axis, rows, selected = null, onSelect = null, caption = "", now = null, label = "Hourly forecast" }) {
    host.classList.add("hg");
    if (!axis.length) { host.innerHTML = '<p class="hg-empty">No hours in this window.</p>'; return { setSelected() {} }; }
    /* date row: one cell per local day run */
    const days = []; axis.forEach((a) => { if (a.newDay || !days.length) days.push({ date: a.date, n: 1 }); else days[days.length - 1].n++; });
    const head1 = `<tr class="hg-days"><th scope="col" class="hg-lab hg-corner"><span class="sr-only">Local date</span></th>${days.map((d) => `<th scope="colgroup" colspan="${d.n}" class="hg-day">${esc(DAY(d.date))}</th>`).join("")}</tr>`;
    const head2 = `<tr class="hg-hours"><th scope="col" class="hg-lab hg-corner">Local time</th>${axis.map((a) => {
      const cls = ["hg-h"]; if (a.newDay) cls.push("hg-nd"); if (a.ms === selected) cls.push("hg-sel"); if (now != null && a.ms + 3600e3 <= now) cls.push("hg-past");
      return `<th scope="col" class="${cls.join(" ")}" data-ms="${a.ms}"><button type="button" class="hg-hb" data-ms="${a.ms}" aria-pressed="${a.ms === selected}" aria-label="${esc(`${DAY(a.date)} ${a.hourText} ${a.zone}`)}">${esc(a.hourText)}${a.showZone ? `<small>${esc(a.zone)}</small>` : ""}</button></th>`; }).join("")}</tr>`;
    const body = rows.map((r) => `<tr class="hg-row hg-k-${esc(r.kind || "value")}" data-row="${esc(r.key)}"><th scope="row" class="hg-lab">${esc(r.label)}${r.sub ? `<small>${esc(r.sub)}</small>` : ""}</th>${r.cells.map((c, i) => cellHtml(c, axis[i].ms, selected)).join("")}</tr>`).join("");
    host.innerHTML = `<div class="hg-scroll" tabindex="0" role="region" aria-label="${esc(label)}; scroll sideways for more hours"><table class="hg-t">${caption ? `<caption class="sr-only">${esc(caption)}</caption>` : ""}<thead>${head1}${head2}</thead><tbody>${body}</tbody></table></div>`;
    const scroller = host.querySelector(".hg-scroll");
    const setSelected = (ms, { scroll = true } = {}) => {
      host.querySelectorAll(".hg-sel").forEach((el) => el.classList.remove("hg-sel"));
      host.querySelectorAll('.hg-hb[aria-pressed="true"]').forEach((b) => b.setAttribute("aria-pressed", "false"));
      if (ms == null) return;
      host.querySelectorAll(`[data-ms="${ms}"]`).forEach((el) => { if (el.tagName !== "BUTTON") el.classList.add("hg-sel"); });
      const b = host.querySelector(`.hg-hb[data-ms="${ms}"]`); if (b) b.setAttribute("aria-pressed", "true");
      const th = host.querySelector(`th.hg-h[data-ms="${ms}"]`);
      if (scroll && th && scroller) { const lab = host.querySelector(".hg-corner"), lw = lab ? lab.offsetWidth : 0, l = th.offsetLeft - lw, r = th.offsetLeft + th.offsetWidth;
        if (l < scroller.scrollLeft || r > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = Math.max(0, l - (scroller.clientWidth - lw) / 3); }
    };
    host.querySelector("table").addEventListener("click", (e) => {
      const t = e.target.closest("[data-ms]"); if (!t || !onSelect) return;
      const ms = +t.dataset.ms; setSelected(ms, { scroll: false }); onSelect(ms);
    });
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
