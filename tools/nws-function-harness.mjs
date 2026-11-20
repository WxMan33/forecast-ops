#!/usr/bin/env node
/* Local stand-in for Cloudflare Pages: serves the site's static files and routes /api/nws/* to the same handler
   the Pages Function exports (functions/api/nws/[[path]].js). Every request the function sends upstream is logged
   with its headers, so the upstream identity is visible in the test evidence.
     node tools/nws-function-harness.mjs [port] [--upstream URL]
   Test controls (harness only): POST /__harness/clock?t=<ms|off>   GET /__harness/log */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fn = await import(pathToFileURL(path.join(ROOT, "functions/api/nws/[[path]].js")).href);
const port = +process.argv[2] || 8822, ui = process.argv.indexOf("--upstream"), upstream = ui > 0 ? process.argv[ui + 1] : undefined;
let clock = null; const log = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {   // record what the function actually sends upstream
  const h = new Headers(init.headers || {}); const entry = { at: new Date().toISOString(), url: String(input), userAgent: h.get("user-agent"), accept: h.get("accept") };
  try { const r = await realFetch(input, init); entry.status = r.status; return r; } catch (e) { entry.error = e.message; throw e; } finally { log.push(entry); if (log.length > 500) log.shift(); }
};
const env = { __harness: true, UPSTREAM: upstream, TIMEOUT_MS: +(process.env.NWS_TIMEOUT_MS || 15000), NOW: () => (clock == null ? Date.now() : clock) };
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".geojson": "application/geo+json", ".svg": "image/svg+xml", ".png": "image/png", ".pbf": "application/x-protobuf", ".txt": "text/plain; charset=utf-8" };
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:" + port);
  if (url.pathname === "/__harness/clock") { const t = url.searchParams.get("t"); clock = t === "off" ? null : +t; res.end(JSON.stringify({ clock })); return; }
  if (url.pathname === "/__harness/log") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(log)); return; }
  if (url.pathname.startsWith("/api/nws/")) {
    const r = await fn.handle(new Request(url, { method: req.method, headers: req.headers }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  const file = path.join(ROOT, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" }); fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log("harness on http://localhost:" + port + (upstream ? " (upstream " + upstream + ")" : " (upstream api.weather.gov)")));
