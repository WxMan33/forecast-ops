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
    {"id":"brad-default-2026-11-03-v2","group":"ope","mode":"brads-preferred","label":"Brad default v2 (10 sources, Nov 3)","weights":{"nws":3,"ecmwf_ens":4,"gefs":0.75,"rrfs_ens":1.25,"ecmwf_ifs025":1.25,"ecmwf_aifs025_single":1,"gfs_seamless":0.75,"ncep_nbm_conus":2,"gfs_hrrr":1.5,"ncep_rrfs_conus":1.5},"rules":null,"frozen":"2026-11-03","effectiveFrom":"2026-11-03T18:44:47.823Z","note":"User-selected default from latest screenshot: no extra temperature multiplier; score alongside preserved earlier recipes."},
    /* The website's scoped default (assets/ops-core.js blend.CUSTOM_DEFAULTS, 2026-11-04 v2), frozen here:
       "near" weights for valid hours in the first 48 h after the capture's last retrieval, "far" weights
       after that (the same periodRules calculation as the site, with the reference time pinned to the
       capture so results are reproducible). Scored prospectively alongside Baseline v1 and Default v2. */
    {"id":"brad-scoped-default-2026-11-04-v2","group":"ope","mode":"scoped","label":"Scoped default v2 (short/long range, Nov 4)","weights":{"nws":4,"ecmwf_ens":4,"gefs":1,"rrfs_ens":2,"ecmwf_ifs025":1.25,"ecmwf_aifs025_single":1,"gfs_seamless":0.75,"ncep_nbm_conus":3,"gfs_hrrr":3,"ncep_rrfs_conus":3},"rules":{"periodWeights":{"near":{"nws":4,"ecmwf_ens":3,"gefs":0.75,"rrfs_ens":2,"ecmwf_ifs025":1,"ecmwf_aifs025_single":0.75,"gfs_seamless":0.5,"ncep_nbm_conus":3,"gfs_hrrr":3,"ncep_rrfs_conus":3},"far":{"nws":3,"ecmwf_ens":4,"gefs":1,"rrfs_ens":0.5,"ecmwf_ifs025":1.25,"ecmwf_aifs025_single":1,"gfs_seamless":0.75,"ncep_nbm_conus":2,"ncep_rrfs_conus":0.5}}},"frozen":"2026-11-04","effectiveFrom":"2026-11-04T20:52:34.000Z","note":"Short-range emphasis test: HRRR/RRFS/NBM/NWS up in the first 48 h; weights fixed, verification only."},
    { id: "baseline-v1", group: "ope", mode: "brads-preferred", label: "Baseline v1 (Brad's preferred, frozen 2026-11-03)", ...BASELINE_V1, frozen: "2026-11-03" },
    { id: "equal-raw-v1", group: "benchmark", label: "Equal-weight raw-model consensus", weights: Object.fromEntries(RAW.map((id) => [id, 1])), rules: null, note: "NBM, NWS and ensembles excluded" },
    { id: "ecmwf-ens-only", group: "benchmark", label: "ECMWF ENS alone", weights: { ecmwf_ens: 1 }, rules: null },
    { id: "gefs-only", group: "benchmark", label: "GEFS alone", weights: { gefs: 1 }, rules: null },
    { id: "nbm-only", group: "benchmark", label: "NBM alone", weights: { ncep_nbm_conus: 1 }, rules: null },
    { id: "nws-only", group: "benchmark", label: "NWS alone (through the blend calculation)", weights: { nws: 1 }, rules: null },
  ],
  /* Experimental candidates: none yet. Add with {id, group:"candidate", fitOn:{from,to}, ...}. */
  candidates: [
    {
      "id": "brad-custom-2026-11-03-v1",
      "group": "ope",
      "label": "Brad custom v1 (screenshot 2026-11-03)",
      "weights": {
        "nws": 2.25,
        "ecmwf_ens": 2,
        "gefs": 0.75,
        "ecmwf_ifs025": 1.5,
        "ecmwf_aifs025_single": 1.5,
        "gfs_seamless": 0.75,
        "ncep_nbm_conus": 2,
        "gfs_hrrr": 2
      },
      "rules": null,
      "note": "Exact user-selected custom weights. No preset temperature multiplier. Other sources excluded from this recipe; archived separately for comparison."
    }
  ],
  BASELINE_V1,
  /* Frozen hashes: changing a recipe in place fails the tests. */
  FROZEN: { "brad-scoped-default-2026-11-04-v2": "d97256d5a424", "brad-default-2026-11-03-v2": "cc2949c5658d", "baseline-v1": "968fcc338b9c", "equal-raw-v1": "1862866abde3", "ecmwf-ens-only": "81e5f60cb022", "gefs-only": "8cbe17fdde0a", "nbm-only": "04958566c9fd", "nws-only": "a93c7f217bb9" },
};
