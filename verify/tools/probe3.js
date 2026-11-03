// Third inventory pass: specific candidate products. Honors robots.txt. Needs internet.
const fs = require("fs"), path = require("path");
const U = require("../lib/util.js");
const OUT = process.argv[2] || "probe3"; fs.mkdirSync(OUT, { recursive: true });
const ITEMS = [
  ["wlwt_indepth.html", "https://www.wlwt.com/article/in-depth-weather-forecast/3853592"],
  ["fox19_extended.jpg", "http://webpubcontent.gray.tv/wxix/Weather/WEB_Extended_Forecast.jpg"],
  ["fox19_extended_https.jpg", "https://webpubcontent.gray.tv/wxix/Weather/WEB_Extended_Forecast.jpg"],
  ["wcpo_weather.html", "https://www.wcpo.com/weather"],
  ["wcpo_7day.jpg", "https://mediaassets.wcpo.com/weatherimages/wsi/A_7DAY.jpg"],
];
const robots = {}, log = [];
async function allowed(u) { const o = new URL(u); if (!(o.origin in robots)) { const r = await U.fetchRaw(o.origin + "/robots.txt", { tries: 1 }); robots[o.origin] = r.status === 200 ? r.text : ""; } return U.robotsAllows(robots[o.origin], o.pathname + o.search); }
(async () => {
  for (const [name, u] of ITEMS) {
    if (!(await allowed(u))) { log.push({ name, u, skipped: "robots" }); continue; }
    const r = await U.fetchRaw(u, { tries: 1 });
    fs.writeFileSync(path.join(OUT, name + (name.endsWith(".html") ? ".gz" : "")), name.endsWith(".html") ? U.gz(r.buf) : r.buf);
    log.push({ name, u, status: r.status, final: r.url, type: r.type, len: r.buf.length, lastModified: r.lastModified, date: r.date });
  }
  // the in-depth article's images
  const art = fs.existsSync(path.join(OUT, "wlwt_indepth.html.gz")) ? U.gunzip(fs.readFileSync(path.join(OUT, "wlwt_indepth.html.gz"))).toString() : "";
  const imgs = [...new Set([...art.matchAll(/https?:\/\/[^"'\s)\\]+?\.(?:png|jpe?g|webp)/gi)].map((m) => m[0]))].filter((x) => !/favicon|touch-icon|branding|logo/i.test(x)).slice(0, 6);
  for (const [i, u] of imgs.entries()) { if (!(await allowed(u))) continue; const r = await U.fetchRaw(u, { tries: 1 }); fs.writeFileSync(path.join(OUT, `wlwt_indepth_img${i}.${/png/.test(r.type) ? "png" : "jpg"}`), r.buf); log.push({ img: u, status: r.status, len: r.buf.length, lastModified: r.lastModified }); }
  fs.writeFileSync(path.join(OUT, "log.json"), JSON.stringify({ at: new Date().toISOString(), log }, null, 1));
  console.log(JSON.stringify(log, null, 1));
})();
