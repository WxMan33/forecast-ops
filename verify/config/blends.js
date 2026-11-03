/* Blend recipes archived at every capture. Baseline v1 is a FROZEN copy of the "Your preferred
   weighting" preset as it stood on 2026-11-03 (assets/ops-core.js blend.PREFERRED); later edits to the
   site's preset do not change it. A new recipe gets a new id; existing ids are never edited
   (verify/tests checks the hashes). Candidates are run in parallel and never become defaults on their own. */
const BASELINE_V1 = {
  weights: { nws: 3, ecmwf_ens: 2, gefs: 1, ecmwf_ifs025: 1, ncep_nbm_conus: 1, gfs_seamless: 0.5, ecmwf_aifs025_single: 0.5, gfs_hrrr: 0.5, ncep_nam_conus: 0.25, icon_seamless: 0.5, gem_seamless: 0.5, ukmo_seamless: 0.5 },
  rules: { byVar: { temperature_2m: { ecmwf_ens: 2 } } },
};
const RAW = ["ecmwf_ifs025", "ecmwf_aifs025_single", "gfs_seamless", "gfs_hrrr", "ncep_nam_conus", "icon_seamless", "gem_seamless", "ukmo_seamless"];
module.exports = {
  recipes: [
    { id: "baseline-v1", group: "ope", mode: "brads-preferred", label: "Baseline v1 (Brad's preferred, frozen 2026-11-03)", ...BASELINE_V1, frozen: "2026-11-03" },
    { id: "equal-raw-v1", group: "benchmark", label: "Equal-weight raw-model consensus", weights: Object.fromEntries(RAW.map((id) => [id, 1])), rules: null, note: "NBM, NWS and ensembles excluded" },
    { id: "ecmwf-ens-only", group: "benchmark", label: "ECMWF ENS alone", weights: { ecmwf_ens: 1 }, rules: null },
    { id: "gefs-only", group: "benchmark", label: "GEFS alone", weights: { gefs: 1 }, rules: null },
    { id: "nbm-only", group: "benchmark", label: "NBM alone", weights: { ncep_nbm_conus: 1 }, rules: null },
    { id: "nws-only", group: "benchmark", label: "NWS alone (through the blend calculation)", weights: { nws: 1 }, rules: null },
  ],
  /* Experimental candidates: none yet. Add with {id, group:"candidate", fitOn:{from,to}, ...}. */
  candidates: [],
  BASELINE_V1,
  /* Frozen hashes: changing a recipe in place fails the tests. */
  FROZEN: { "baseline-v1": "968fcc338b9c", "equal-raw-v1": "1862866abde3", "ecmwf-ens-only": "81e5f60cb022", "gefs-only": "8cbe17fdde0a", "nbm-only": "04958566c9fd", "nws-only": "a93c7f217bb9" },
};
