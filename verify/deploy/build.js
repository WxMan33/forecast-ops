#!/usr/bin/env node
/* Assemble the private data repository's contents into OUT:
     collector/  vendored code (verify/** and assets/ops-{core,data}.js) + COLLECTOR_VERSION.json
     .github/workflows/collector.yml
     README.md   (retention, backup, recovery, how to read)
     [pilot data from --pilot DIR, kept as-is: manual captures stay labelled manual]
   node verify/deploy/build.js --out DIR [--pilot DIR] [--source-commit SHA] */
"use strict";
const fs = require("fs"), path = require("path");
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = path.resolve(__dirname, "..", ".."), OUT = path.resolve(arg("out"));
const copy = (src, dst) => { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.cpSync(src, dst, { recursive: true }); };
copy(path.join(ROOT, "verify"), path.join(OUT, "collector", "verify"));
fs.rmSync(path.join(OUT, "collector", "verify", "deploy"), { recursive: true, force: true });
copy(path.join(ROOT, "assets", "ops-core.js"), path.join(OUT, "collector", "assets", "ops-core.js"));
copy(path.join(ROOT, "assets", "ops-data.js"), path.join(OUT, "collector", "assets", "ops-data.js"));
fs.writeFileSync(path.join(OUT, "collector", "COLLECTOR_VERSION.json"), JSON.stringify({ builtAt: new Date().toISOString(), sourceRepo: "WxMan33/forecast-ops", sourceCommit: arg("source-commit", null), note: "vendored copy; every capture also records this repository's commit (GITHUB_SHA)" }, null, 1) + "\n");
copy(path.join(__dirname, "collector.yml"), path.join(OUT, ".github", "workflows", "collector.yml"));
copy(path.join(__dirname, "DATA_README.md"), path.join(OUT, "README.md"));
if (arg("pilot")) for (const d of fs.readdirSync(arg("pilot"))) copy(path.join(arg("pilot"), d), path.join(OUT, d));
console.log("built", OUT);

