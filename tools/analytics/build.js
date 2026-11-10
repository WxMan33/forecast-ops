#!/usr/bin/env node
/* Copies report.js into the Apps Script project as Report.gs (Apps Script has no modules). --check: CI. */
"use strict";
const fs = require("fs"), path = require("path"), src = fs.readFileSync(path.join(__dirname, "report.js"), "utf8"), dst = path.join(__dirname, "apps-script", "Report.gs");
const out = "/* Generated from tools/analytics/report.js by tools/analytics/build.js. Do not edit here. */\n" + src;
if (process.argv.includes("--check")) { if (!fs.existsSync(dst) || fs.readFileSync(dst, "utf8") !== out) { console.error("Report.gs is out of date: run node tools/analytics/build.js"); process.exit(1); } console.log("ok - Report.gs matches report.js"); }
else { fs.writeFileSync(dst, out); console.log("wrote", dst); }
