/* Forecast Ops beta analytics collector and private dashboard (Google Apps Script, bound to a private Sheet).
   doPost: accepts anonymous interaction rows from the betas, validates them with BetaReport.validate (allow-list)
           and appends them to the "events" sheet. No request metadata (IP, user agent, referrer) is stored.
   doGet:  returns only {"ok":true}. The collector URL never exposes data.
   Dashboard: open the Sheet → Forecast Ops → Beta usage dashboard. Only people who can open this Sheet see it. */
var SHEET = "events", MAX_ROWS = 50;

function doPost(e) {
  var rows = [];
  try { rows = JSON.parse((e && e.postData && e.postData.contents) || "[]"); } catch (err) { rows = []; }
  if (!Array.isArray(rows)) rows = [];
  var ok = rows.slice(0, MAX_ROWS).map(BetaReport.validate).filter(Boolean);
  if (ok.length) {
    var lock = LockService.getScriptLock(); lock.waitLock(10000);
    try { sheet_().getRange(sheet_().getLastRow() + 1, 1, ok.length, 9).setValues(ok.map(function (r) { return [new Date(), r.t, r.aud, r.int, r.b, r.s, r.n, r.type, JSON.stringify(r.c)]; })); }
    finally { lock.releaseLock(); }
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: true, stored: ok.length })).setMimeType(ContentService.MimeType.JSON);
}
function doGet() { return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON); }

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(SHEET);
  if (!sh) { sh = ss.insertSheet(SHEET); sh.appendRow(["received", "t", "aud", "int", "b", "s", "n", "type", "c"]); sh.setFrozenRows(1); }
  return sh;
}
function rows_() {
  var v = sheet_().getDataRange().getValues(); v.shift();
  return v.map(function (r) { var c = {}; try { c = JSON.parse(r[8] || "{}"); } catch (e) { c = {}; }
    return { v: 1, t: r[1], aud: r[2], int: r[3], b: r[4], s: r[5], n: r[6], type: r[7], c: c }; });
}
function onOpen() { SpreadsheetApp.getUi().createMenu("Forecast Ops").addItem("Beta usage dashboard", "showDashboard").addToUi(); }
function showDashboard() {
  var html = BetaReport.html(BetaReport.build(rows_(), { now: new Date().toISOString() }));
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(1100).setHeight(760), "Forecast Ops beta usage");
}
