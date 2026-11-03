/* The prospective boundary, in one place. A forecast may be scored against an observation only if
   the observation was MEASURED at least MIN_LEAD_MIN after the LAST source retrieval of the capture.
   Daily/period windows: the whole window must start at least MIN_LEAD_MIN after that retrieval, so
   every measurement inside it is later still. Hourly: the routine report used for a valid hour must
   fall within MATCH_TOLERANCE_MIN before that hour AND satisfy the minimum lead by its own
   measurement time (not the valid hour). */
"use strict";
const MIN_LEAD_MIN = 60;
const MATCH_TOLERANCE_MIN = 15;
const VERSION = `timing-v1 (min lead ${MIN_LEAD_MIN} min after last retrieval; hourly match tolerance ${MATCH_TOLERANCE_MIN} min before the hour)`;
const windowOk = (windowStartMs, retrievedLastMs) => windowStartMs >= retrievedLastMs + MIN_LEAD_MIN * 60e3;
const obsOk = (obsMeasuredMs, retrievedLastMs) => obsMeasuredMs >= retrievedLastMs + MIN_LEAD_MIN * 60e3;
const leadMin = (obsMeasuredMs, retrievedLastMs) => Math.round((obsMeasuredMs - retrievedLastMs) / 60e3 * 10) / 10;
module.exports = { MIN_LEAD_MIN, MATCH_TOLERANCE_MIN, VERSION, windowOk, obsOk, leadMin };
