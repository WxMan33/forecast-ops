#!/usr/bin/env node
/* Yearly archive and recovery for the private data repository.
     node verify/tools/archive.js pack    --year 2026 [--data DIR] [--out DIR]   build tarball + manifest, then verify it
     node verify/tools/archive.js verify  --year 2026 --tar FILE [--data DIR]   re-hash every file in a tarball against its manifest
     node verify/tools/archive.js restore --year 2026 --tar FILE [--data DIR]   extract, re-hash, and check the hashes recorded in captures
     node verify/tools/archive.js prune   --year 2026 [--data DIR]              remove that year's raw files from the working tree,
                                                                                ONLY if a verified manifest exists (git history still holds them)
   The tarball is uploaded as a GitHub release asset by the collector workflow; the manifest is committed
   at archives/<year>/manifest.json, so every evidence path and hash stays resolvable after pruning. */
"use strict";
const fs = require("fs"), path = require("path"), cp = require("child_process");
const U = require("../lib/util.js");
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const cmd = process.argv[2], DATA = path.resolve(arg("data", process.env.VERIFY_DATA || "verify-data")), YEAR = arg("year");
const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])) : []);
/* files of a year: raw/<loc>/<YYYY-MM>/..., obs-raw/<loc>/<YYYY-MM-DD>/... and products, plus TV evidence first seen that year */
function yearFiles(year) {
  const rel = (f) => path.relative(DATA, f).split(path.sep).join("/");
  const raw = walk(path.join(DATA, "raw")).map(rel).filter((p) => p.split("/")[2] && p.split("/")[2].startsWith(year + "-"));
  const obs = walk(path.join(DATA, "obs-raw")).map(rel).filter((p) => p.split("/")[2] && (p.split("/")[2].startsWith(year + "-") || p.split("/")[2] === "products"));
  const tvRecs = U.readJSONLDir(path.join(DATA, "tv")).filter((r) => String(r.captureId || "").startsWith(year + "-"));
  const ev = [...new Set(tvRecs.flatMap((r) => (r.evidence || []).map((e) => e.path)))].filter((p) => fs.existsSync(path.join(DATA, p)));
  return [...new Set([...raw, ...obs, ...ev])].sort();
}
const sha = (p) => U.sha256(fs.readFileSync(p));
function pack() {
  const out = path.resolve(arg("out", path.join(DATA, "..", "archive-out"))); U.mkdirp(out);
  const files = yearFiles(YEAR); if (!files.length) throw new Error("nothing to archive for " + YEAR);
  const listFile = path.join(out, `files-${YEAR}.txt`); fs.writeFileSync(listFile, files.join("\n") + "\n");
  const tar = path.join(out, `forecast-ops-data-${YEAR}.tar`);
  cp.execFileSync("tar", ["-cf", tar, "-C", DATA, "-T", listFile]);
  const manifest = { schema: 1, year: YEAR, createdAt: U.iso(Date.now()), tarball: path.basename(tar), tarballSha256: sha(tar), files: files.map((p) => ({ path: p, sha256: sha(path.join(DATA, p)), bytes: fs.statSync(path.join(DATA, p)).size })),
    note: "Stored-file hashes. Raw *.gz files decompress to the content whose sha256 is recorded in captures/*.jsonl and tv/*.jsonl (checked by 'restore')." };
  U.writeJSON(path.join(DATA, "archives", YEAR, "manifest.json"), manifest);
  const v = verifyTar(tar, manifest); manifest.verifiedAt = U.iso(Date.now()); manifest.verified = v.ok; U.writeJSON(path.join(DATA, "archives", YEAR, "manifest.json"), manifest);
  console.log(`packed ${files.length} files into ${tar} (sha256 ${manifest.tarballSha256.slice(0, 12)}); verification ${v.ok ? "passed" : "FAILED: " + v.bad.slice(0, 5).join(", ")}`);
  if (!v.ok) process.exit(1);
}
function verifyTar(tar, manifest) {
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "arc-"));
  cp.execFileSync("tar", ["-xf", tar, "-C", tmp]);
  const bad = manifest.files.filter((f) => !fs.existsSync(path.join(tmp, f.path)) || sha(path.join(tmp, f.path)) !== f.sha256).map((f) => f.path);
  if (sha(tar) !== manifest.tarballSha256) bad.unshift("tarball hash mismatch");
  fs.rmSync(tmp, { recursive: true, force: true });
  return { ok: !bad.length, bad };
}
function restore() {
  const manifest = U.readJSON(path.join(DATA, "archives", YEAR, "manifest.json")); if (!manifest) throw new Error("no manifest for " + YEAR);
  const tar = path.resolve(arg("tar")); const v = verifyTar(tar, manifest); if (!v.ok) throw new Error("archive does not match its manifest: " + v.bad.slice(0, 5).join(", "));
  cp.execFileSync("tar", ["-xf", tar, "-C", DATA]);
  /* the content hashes recorded at collection time must still match */
  const caps = U.readJSONLDir(path.join(DATA, "captures")).filter((c) => (c.localDate || "").startsWith(YEAR));
  let checked = 0; const bad = [];
  caps.forEach((c) => Object.values(c.sources || {}).forEach((s) => Object.values(s.files || {}).forEach((f) => { if (!f || !f.path) return; const p = path.join(DATA, f.path); if (!fs.existsSync(p)) { bad.push(f.path + " missing"); return; } checked++; if (U.sha256(U.gunzip(fs.readFileSync(p))) !== f.sha256) bad.push(f.path); })));
  console.log(`restored ${manifest.files.length} files; ${checked} recorded content hashes checked; ${bad.length ? "MISMATCH: " + bad.slice(0, 5).join(", ") : "all match"}`);
  if (bad.length) process.exit(1);
}
function prune() {
  const manifest = U.readJSON(path.join(DATA, "archives", YEAR, "manifest.json"));
  if (!manifest || !manifest.verified || !manifest.releaseAsset) throw new Error("refusing to prune: manifest missing, unverified, or release upload not recorded");
  const ev = new Set(U.readJSONLDir(path.join(DATA, "tv")).filter((r) => !String(r.captureId || "").startsWith(YEAR + "-")).flatMap((r) => (r.evidence || []).map((e) => e.path)));
  let n = 0; manifest.files.forEach((f) => { if (f.path.startsWith("evidence/") && ev.has(f.path)) return; const p = path.join(DATA, f.path); if (fs.existsSync(p)) { fs.unlinkSync(p); n++; } });
  console.log(`pruned ${n} files of ${YEAR} from the working tree (still in git history and in release asset ${manifest.releaseAsset})`);
}
if (cmd === "pack") pack(); else if (cmd === "verify") { const m = U.readJSON(path.join(DATA, "archives", YEAR, "manifest.json")); const v = verifyTar(path.resolve(arg("tar")), m); console.log(v.ok ? "ok" : v.bad.join("\n")); process.exit(v.ok ? 0 : 1); }
else if (cmd === "restore") restore(); else if (cmd === "prune") prune(); else { console.log("usage: archive.js pack|verify|restore|prune --year YYYY"); process.exit(2); }
