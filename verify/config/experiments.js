/* Experimental temperature weights. NOTHING here changes a default or a production recipe.
   Protocol (lib/experiments.js):
     1. An experiment waits until its matched training cases cover at least minTrainDates distinct dates.
     2. It is then fitted ONCE on those earlier dates and the fit is written to the data repository
        (experiments/<id>.fit.json) with its fit time, training range and weights. A fit is never redone or edited;
        a changed idea is a new experiment id.
     3. It is evaluated only on cases from captures that started after the fit was recorded and whose valid
        dates are more than embargoDays after the last training date: later, unseen dates.
     4. A promotion needs the rules in lib/learn.js PROMOTION and a recorded decision; this file never promotes.
   A conditional experiment names every required class in `classes`. It is fitted only when EACH of them has
   minTrainDates; a class with no cases at all is 0 dates and keeps the experiment waiting ("insufficient training
   data"). Fallback: wherever no usable fit exists (before fitting, a failed fit, or a case outside the named
   classes, e.g. "unknown"), the experiment's value is the prior recipe's, unchanged.
   `condition` may use only target- or issue-basis context (lib/context.js), never observed classes. */
module.exports = [
  { id: "exp-temp-d1-2-weights-v1", label: "Temperature weights for days 1–2 (one set)", targets: ["tmax_clim", "tmin_clim"], band: "d1-2",
    sources: ["nws", "ecmwf_ens", "gefs", "ecmwf_ifs025", "ecmwf_aifs025_single", "gfs_seamless", "ncep_nbm_conus"], prior: "baseline-v1", condition: null,
    minTrainDates: 60, embargoDays: 3, registered: "2026-11-15" },
  { id: "exp-temp-d1-2-by-forecast-change-v1", label: "Temperature weights for days 1–2, one set per forecast change class (warmup, cooldown, small change)", targets: ["tmax_clim", "tmin_clim"], band: "d1-2",
    sources: ["nws", "ecmwf_ens", "gefs", "ecmwf_ifs025", "ecmwf_aifs025_single", "gfs_seamless", "ncep_nbm_conus"], prior: "baseline-v1", condition: { basis: "issue", dim: "forecastChange" }, classes: ["warmup", "cooldown", "small change"],
    minTrainDates: 60, embargoDays: 3, registered: "2026-11-15" },
  { id: "exp-temp-d5-7-weights-v1", label: "Temperature weights for days 5–7 (one set)", targets: ["tmax_clim", "tmin_clim"], band: "d5-7",
    sources: ["nws", "ecmwf_ens", "gefs", "ecmwf_ifs025", "ecmwf_aifs025_single", "gfs_seamless", "ncep_nbm_conus"], prior: "baseline-v1", condition: null,
    minTrainDates: 60, embargoDays: 3, registered: "2026-11-15" },
];
