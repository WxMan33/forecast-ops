#!/usr/bin/env node
/* One bounded capability check for the optional context variables: one request per deterministic model,
   sequential, single attempt; the first HTTP 429 stops the rest. Prints and writes a JSON capability record.
   Usage: node verify/tools/context-vars-probe.js [out.json] */
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const SRC = require("../lib/sources.js"), CV = require("../lib/context-vars.js"), LOCS = require("../config/locations.js");
(async () => {
  const loc = LOCS.CVG, tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctxprobe-")), at = Date.now();
  const ids = SRC.sourceList().filter((s) => s.kind === "det").map((s) => s.id);
  const r = await CV.collect(loc, tmp, "probe", ids);
  Object.entries(r.sources).forEach(([id, s]) => {
    const f = s.fields || {};
    console.log(`${id.padEnd(22)} ${String(s.status).padEnd(26)} HTTP ${s.httpStatus == null ? "—" : s.httpStatus} ` + CV.VARS.map((v) => `${v}: ${f[v] ? (f[v].present ? `${f[v].nonNull}/${f[v].of} ${f[v].unit || "?"} to ${f[v].lastNonNull ? Math.round((Date.parse(f[v].lastNonNull) - at) / 3600e3) + " h" : "—"}` : "absent") : "—"}`).join(" · ") + (s.error ? ` (${s.error})` : ""));
  });
  const out = process.argv[2]; if (out) fs.writeFileSync(out, JSON.stringify({ at: new Date(at).toISOString(), ...r }, null, 1));
})();
