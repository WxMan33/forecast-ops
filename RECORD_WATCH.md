# Daily Blend record watch

An informational heads-up beside the daily low/high, with no change to source data, forecast calculations, blend weights or verification archives.

- Cincinnati threaded city records (`CVGthr`, RCC-ACIS StnData), sampled on each forecast calendar date from 1871 through the previous year. Uses the same source as the Almanac. Includes tied years and reports missing years. At least 30 usable historical observations are required for each extreme.
- Four temperature extremes: hottest high, coldest low, coldest high and warmest low. No precipitation records or inferred ensemble probabilities.
- The displayed rounded blend temperature is compared with the record. Badges appear within 2°F on the approach side, at a potential tie or beyond the record. The 2°F threshold is a display choice, not a calibrated risk probability. Farther beyond a record also triggers a badge.
- Only the selected point within 5 km of CVG with America/New_York time is enabled. Other points get no Cincinnati badge. This is a point guidance comparison, not a station observation or a guaranteed airport forecast.
- Full 24-hour forecast days only. Partial days, DST transition days (23/25 h), past dates and Feb 29 are excluded. Feb 29 needs separate leap-specific sampling, not an adjacent-date substitution.
- Normal daylight-saving dates use a civil calendar day that differs by one hour from the official standard-time climate day. The expanded badge explicitly calls the comparison an approximate heads-up on these dates. No actual-record declaration is made.
- The source is fetched in the browser, limited to three requests at a time with a 15-second timeout each. Successful date-specific results are cached seven days. Failed or insufficient historical records produce a quiet note under the table. No record badge is not an all-clear.
- Details are a click/tap disclosure, with hover text and keyboard support. Button events do not toggle the underlying forecast-day row. Multiple disclosures can remain open.

WPC's NDFD records page (https://www.wpc.ncep.noaa.gov/exper/ndfd/ndfd.html) independently compares NDFD guidance to ThreadEx records. These badges instead compare this site's displayed blend directly to RCC-ACIS records; they do not claim to reproduce WPC's forecast or ingest its graphics.

Validation: `node tests/record-watch.test.js` checks captured official Cincinnati records and all four directions, thresholds, missing inputs, partial days and location gating. Browser QA uses synthetic forecast values with the captured records so potential ties/exceedances can be tested without claiming an actual record threat.
