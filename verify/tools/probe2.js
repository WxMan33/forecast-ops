// Second inventory pass: saves full public HTML of TV weather pages (gzipped) and candidate forecast
// images for manual inspection, honoring robots.txt for our user agent. Needs internet.
const fs = require("fs"), path = require("path");
const U = require("../lib/util.js");
const OUT = process.argv[2] || "probe2";
fs.mkdirSync(OUT, { recursive: true });
const log = [];
const PAGES = [
  "https://www.wlwt.com/weather", "https://www.wlwt.com/weather/forecast",
  "https://www.wcpo.com/weather", "https://www.wcpo.com/weather/forecast",
  "https://local12.com/weather", "https://local12.com/weather/forecast-discussion",
  "https://www.fox19.com/weather/", "https://www.fox19.com/weather/forecast/", "https://www.fox19.com/page/7-day-forecast",
];
const robots = {};
async function allowed(u) {
  const o = new URL(u); if (!(o.origin in robots)) { const r = await U.fetchRaw(o.origin + "/robots.txt", { tries: 1 }); robots[o.origin] = r.status === 200 ? r.text : ""; }
  return U.robotsAllows(robots[o.origin], o.pathname + o.search);
}
(async () => {
  for (const u of PAGES) {
    if (!(await allowed(u))) { log.push({ u, skipped: "robots" }); continue; }
    const r = await U.fetchRaw(u, { accept: "text/html", tries: 1 });
    const name = u.replace(/^https:\/\/(www\.)?/, "").replace(/[^a-z0-9]+/gi, "_");
    fs.writeFileSync(path.join(OUT, name + ".html.gz"), U.gz(r.buf));
    const imgs = [...new Set([...r.text.matchAll(/https?:\/\/[^"'\s)]+?\.(?:png|jpe?g|webp)(?:\?[^"'\s)]*)?/gi)].map((m) => m[0].replace(/&amp;/g, "&")))];
    log.push({ u, status: r.status, final: r.url, len: r.buf.length, nImgs: imgs.length });
    // candidate forecast graphics: gray resizer images near "Extended Forecast"/"7 Day", ewscloud, hearst weather
    const cands = imgs.filter((x) => /gtv-cdn\.com\/resizer|htv-prod|weathercenter|forecast|7day|7-day|extended/i.test(x) && !/favicon|apple-touch|fallback|logo|icons?\//i.test(x)).slice(0, 8);
    for (const [i, c] of cands.entries()) {
      if (!(await allowed(c))) { log.push({ img: c, skipped: "robots" }); continue; }
      const ir = await U.fetchRaw(c, { tries: 1 });
      const ext = /png/i.test(ir.type) ? "png" : /webp/.test(ir.type) ? "webp" : "jpg";
      fs.writeFileSync(path.join(OUT, `${name}_img${i}.${ext}`), ir.buf);
      log.push({ img: c, status: ir.status, type: ir.type, len: ir.buf.length, lastModified: ir.lastModified });
    }
  }
  fs.writeFileSync(path.join(OUT, "log.json"), JSON.stringify({ at: new Date().toISOString(), log, robots }, null, 1));
  console.log(JSON.stringify(log, null, 1));
})();
