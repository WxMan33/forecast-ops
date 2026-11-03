/* Shared helpers for the verification service (Node 20+, no dependencies). */
"use strict";
const crypto = require("crypto");
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");
const Core = require("../../assets/ops-core.js");

const UA = "forecast-ops-verify/1 (+https://github.com/WxMan33/forecast-ops)";
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const gz = (buf) => zlib.gzipSync(buf, { level: 9 });
const gunzip = (buf) => zlib.gunzipSync(buf);
const iso = (ms) => new Date(ms).toISOString();

/* Fetch with timeout and a few retries on network errors / 5xx. Never throws: returns
   {ok, status, url, type, buf, text, error, attempts, retrievedAt, ms}. */
async function fetchRaw(url, { accept = "*/*", headers = {}, method = "GET", body = null, timeoutMs = 45000, tries = 3 } = {}) {
  let last = null;
  for (let a = 1; a <= tries; a++) {
    const t0 = Date.now();
    try {
      const r = await fetch(url, { method, body, redirect: "follow", headers: { "User-Agent": UA, Accept: accept, ...headers }, signal: AbortSignal.timeout(timeoutMs) });
      const buf = Buffer.from(await r.arrayBuffer());
      last = { ok: r.ok, status: r.status, url: r.url, type: r.headers.get("content-type") || "", lastModified: r.headers.get("last-modified"), date: r.headers.get("date"),
        buf, text: null, attempts: a, retrievedAt: iso(Date.now()), ms: Date.now() - t0 };
      if (r.status < 500 && r.status !== 429) break;
    } catch (e) {
      last = { ok: false, status: 0, url, error: String((e && e.message) || e), attempts: a, retrievedAt: iso(Date.now()), ms: Date.now() - t0, buf: Buffer.alloc(0) };
    }
    if (a < tries) await new Promise((res) => setTimeout(res, 2000 * a));
  }
  last.text = last.buf.toString("utf8");
  return last;
}
const parseJSON = (t) => { try { return JSON.parse(t); } catch (e) { return null; } };

/* robots.txt check for a path (User-agent * and our agent). Conservative: any matching Disallow blocks. */
function robotsAllows(robotsText, pathname) {
  if (!robotsText) return true;
  const groups = []; let cur = null;
  robotsText.split(/\r?\n/).forEach((line) => {
    const l = line.replace(/#.*/, "").trim(); if (!l) return;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(l); if (!m) return;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") { if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); }
    else if (cur && (k === "disallow" || k === "allow")) cur.rules.push({ allow: k === "allow", p: v });
  });
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && "forecast-ops-verify".startsWith(a)));
  const use = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  let best = null;
  use.forEach((g) => g.rules.forEach((r) => {
    if (!r.p) return; // empty Disallow allows everything
    const re = new RegExp("^" + r.p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (re.test(pathname) && (!best || r.p.length > best.p.length || (r.p.length === best.p.length && r.allow))) best = r;
  }));
  return !best || best.allow;
}

/* ---------- files ---------- */
function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
function appendJSONL(file, recs) { if (!recs.length) return; mkdirp(path.dirname(file)); fs.appendFileSync(file, recs.map((r) => JSON.stringify(r)).join("\n") + "\n"); }
function readJSONL(file) { if (!fs.existsSync(file)) return []; return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); }
/* All .jsonl files under dir (recursive), in path order. */
function readJSONLDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((e) => (e.isDirectory() ? readJSONLDir(path.join(dir, e.name)) : e.name.endsWith(".jsonl") ? readJSONL(path.join(dir, e.name)) : []));
}
function writeJSON(file, obj) { mkdirp(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(obj, null, 1) + "\n"); }
function readJSON(file, dflt = null) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return dflt; } }
/* Save raw evidence gzipped, content-addressed by hash inside its folder; returns {path, sha256, bytes}. */
function saveRaw(root, rel, buf) {
  const h = sha256(buf), full = path.join(root, rel + ".gz");
  mkdirp(path.dirname(full));
  if (!fs.existsSync(full)) fs.writeFileSync(full, gz(buf));
  return { path: rel + ".gz", sha256: h, bytes: buf.length };
}
function loadRaw(root, rel) { return gunzip(fs.readFileSync(path.join(root, rel))); }
/* Stable hash of a configuration object (sorted keys). */
function stableStringify(o) { return o === null || typeof o !== "object" ? JSON.stringify(o) : Array.isArray(o) ? `[${o.map(stableStringify).join(",")}]` : `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`; }
const configHash = (o) => sha256(Buffer.from(stableStringify(o))).slice(0, 12);

/* ---------- time ---------- */
const T = Core.time;
const localParts = (ms, tz) => { const s = T.toLocal(ms, tz); return { date: s.slice(0, 10), hm: s.slice(11, 16), s }; };
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400e3).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400e3);

module.exports = { Core, UA, sha256, gz, gunzip, iso, fetchRaw, parseJSON, robotsAllows, mkdirp, appendJSONL, readJSONL, readJSONLDir, writeJSON, readJSON, saveRaw, loadRaw, stableStringify, configHash, localParts, addDays, dayDiff };
