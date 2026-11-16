/* Capture order: core model and NWS retrievals, then TV products, then optional context requests.
   Optional requests run last, so they can never delay a core or TV retrieval; each step's start and end
   are recorded on the capture. Every response keeps its own retrieval time, and issue-time eligibility
   is judged from those times (lib/context-vars.js nights()). */
"use strict";
const VERSION = "capture-order-v1";
async function sequence({ core, tv, optional }, now = Date.now) {
  const t = { version: VERSION };
  t.coreStart = now(); await core(); t.coreEnd = now();
  t.tvStart = now(); try { if (tv) await tv(); } finally { t.tvEnd = now(); }
  t.optionalStart = now(); try { if (optional) await optional(); } catch (e) { t.optionalError = String((e && e.message) || e); } finally { t.optionalEnd = now(); }
  return t;
}
module.exports = { VERSION, sequence };
