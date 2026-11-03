#!/usr/bin/env node
/* Asset versioning for the static site.
   GitHub Pages lets browsers reuse assets/ files for about 10 minutes, while each page's HTML is
   re-checked on every visit. Without versions, a returning visitor can get new HTML with old
   JavaScript and CSS (which broke the Almanac after a deployment). This tool:
     1. stamps every local asset reference in the HTML pages with a content hash
        (assets/ops.js -> assets/ops.js?v=1a2b3c4d5e), so a changed file always gets a new URL;
     2. keeps a small inline load guard in each page's <head>. The guard ships with the HTML, so it
        is always current: if a page script fails to download or throws, it shows a visible
        "didn't finish loading" message with a Reload button instead of leaving panels on "Loading".
   Usage:  node tools/stamp-assets.js          update the pages
           node tools/stamp-assets.js --check  exit 1 if any stamp or guard is out of date (CI)
   Stored settings, saved locations and logs live in localStorage and are not touched. */
"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const ROOT = path.resolve(__dirname, "..");
const check = process.argv.includes("--check");

const GUARD = `<!--load-guard--><script>/* Load guard (managed by tools/stamp-assets.js). Shown only if a page script fails to download or throws. */
(function () { var shown = false;
  function show(msg) { if (shown) return; shown = true;
    var go = function () { var b = document.createElement("div"); b.setAttribute("role", "alert"); b.id = "loadGuard";
      b.style.cssText = "position:sticky;top:0;z-index:9999;margin:0;padding:10px 16px;background:#7a1f12;color:#fff;font:600 14px/1.4 system-ui,sans-serif;display:flex;gap:12px;align-items:center;flex-wrap:wrap";
      b.innerHTML = '<span>This page didn\\u2019t finish loading. <span style="font-weight:400"></span></span><button type="button" style="font:inherit;padding:4px 12px;border-radius:6px;border:1px solid #fff;background:#fff;color:#7a1f12;cursor:pointer">Reload</button>';
      b.querySelector("span span").textContent = msg; b.querySelector("button").onclick = function () { location.reload(); };
      document.body.insertBefore(b, document.body.firstChild); };
    if (document.body) go(); else document.addEventListener("DOMContentLoaded", go); }
  window.addEventListener("error", function (e) { var t = e.target;
    if (t && (t.tagName === "SCRIPT" || (t.tagName === "LINK" && t.rel === "stylesheet")) && (t.src || t.href || "").indexOf(location.origin) === 0) show("A site file (" + (t.src || t.href).split("/").pop().split("?")[0] + ") could not be downloaded.");
    else if (e.filename && e.filename.indexOf(location.origin) === 0) show("A script error stopped it (" + e.message + ").");
  }, true);
  window.addEventListener("unhandledrejection", function (e) { var r = e.reason, st = (r && r.stack) || "";
    if (st.indexOf(location.origin) >= 0) show("A script error stopped it (" + (r.message || r) + ").");
  });
})();</script><!--/load-guard-->`;

const hashes = {};
const hashOf = (rel) => {
  if (!(rel in hashes)) {
    const f = path.join(ROOT, rel);
    hashes[rel] = fs.existsSync(f) ? crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 10) : null;
  }
  return hashes[rel];
};

function stamp(html, page) {
  const missing = [];
  let out = html.replace(/\b(href|src)="(assets\/[^"?#]+)(?:\?v=[0-9a-f]*)?"/g, (m, attr, rel) => {
    const h = hashOf(rel);
    if (!h) { missing.push(rel); return m; }
    return `${attr}="${rel}?v=${h}"`;
  });
  if (missing.length) throw new Error(`${page}: references missing files ${missing.join(", ")}`);
  if (/<!--load-guard-->[\s\S]*?<!--\/load-guard-->/.test(out)) out = out.replace(/<!--load-guard-->[\s\S]*?<!--\/load-guard-->/, () => GUARD);
  else {
    const at = out.search(/<link rel="stylesheet" href="assets\//);
    if (at < 0) throw new Error(`${page}: no assets/ stylesheet to place the load guard before`);
    out = out.slice(0, at) + GUARD + "\n" + out.slice(at);
  }
  return out;
}

const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html")).sort();
let stale = [];
for (const page of pages) {
  const f = path.join(ROOT, page), html = fs.readFileSync(f, "utf8"), next = stamp(html, page);
  if (next !== html) { stale.push(page); if (!check) fs.writeFileSync(f, next); }
}
if (check) {
  if (stale.length) { console.error(`not ok - asset stamps or load guard out of date in: ${stale.join(", ")}. Run: node tools/stamp-assets.js`); process.exit(1); }
  console.log(`ok - asset stamps current in ${pages.length} pages`);
} else console.log(stale.length ? `stamped: ${stale.join(", ")}` : "already current");
module.exports = { stamp };
