# Probability models, SPC data and contour rendering

## How a contour is produced

1. Forecast fields describe instability, inhibition, moisture, shear, low-level helicity, updraft rotation and storm coverage. The implemented extractor currently uses HRRR only, with native-grid neighborhood and temporal summaries.
2. Historical NCEI storm records define whether a qualifying tornado, wind or hail report occurred within 25 statute miles during the target window. Records are the outcome labels, not predictor fields.
3. A statistical model learns the relation between those fields and reported events; a separate chronological sample calibrates its probabilities. Day 1 and Day 2 need their own daily target/lead training. The existing fitted v0.2 model supports only one four-hour configuration.
4. The trained model would produce a probability at each sampled location for a stated valid window. No live daily probabilities exist yet.
5. The viewer linearly interpolates neighboring sample probabilities on a display mesh, extracts the threshold boundaries and fills the bands. Color and interpolation do not create additional forecast information. Point inspection always uses an original sample. Contours, Dots and Both share the same underlying values.

The current public maps remain archived four-hour research outputs. The daily predictor and label builds do not silently replace them with current forecasts.

## Source roles

| Source | Current use | Intended role |
| --- | --- | --- |
| HRRR | Archive research model and completed daily predictor extractor | Initial trainable benchmark, with corrected availability/issuance timing before prospective daily scoring |
| RRFS / REFS | Candidate; no severe-hazard model is trained for it | Convection-resolving fields and ensemble spread/agreement; separate version-aware training and calibration, then test whether combining it with HRRR helps |
| NBM thunder/environmental fields | Not in the severe model | Potential timing/context predictor or comparator after checking the field's provenance, availability and matching target |
| NBM severe probabilities | Not in the severe model | Identify as SPC-derived where applicable; do not treat as an independent ensemble vote or independent benchmark |
| NCEI Storm Data | Four-hour research labels and newly built daily labels | Historical reported-event target; retain source revisions and limitations |
| SPC preliminary storm reports / LSRs | Not ingested by this build | More timely prospective verification, explicitly preliminary; reconcile with later Storm Data and deduplicate, rather than adding the two report counts together |
| SPC official outlook probabilities | Not predictor inputs | Matched-valid-window comparator and separately identified map overlay; any later SPC-assisted model must be identified as such and evaluated separately |
| SPC mesoanalysis / watches / discussions | Not predictor inputs | Current-environment checks/context first; any future predictive use requires an archived, issue-time-available product and leakage checks |

No fixed manual HRRR/RRFS/NBM weights are assigned. Models and their forecast errors are correlated. Any combination needs out-of-sample, episode-blocked evaluation and calibration by hazard and lead time. A raw fraction of ensemble members exceeding an UH threshold is not automatically a calibrated tornado probability.

## What Nadocast used

The published Nadocast methodology describes HREF and SREF for its 2021 models; older 2020-model intraday updates additionally incorporated HRRR and RAP. It used extensive neighborhood/temporal feature engineering, gradient-boosted trees, lead-specific models and calibration. Its documented severe and significant-severe targets came from NOAA Storm Data. This build does not inherit its trained weights, significant-severe outputs or verified skill.

## RRFS and Day 3

NOAA announced operational RRFS implementation on November 3, 2026. Its November 5 release explicitly documents 84-hour RRFS forecasts versus HRRR's 48 hours. RRFS therefore provides a technically plausible Day 3 input source, subject to checking actual cycle/field availability. Its short operational history and evolving versions require an explicit retrospective/transfer-validation strategy plus prospective capture. Existing HRRR training cannot simply be applied to RRFS fields.

## NBM provenance

NWS's April 2026 NBM webinar notes distinguish probabilistic thunder products from severe-weather products that repackage SPC guidance. Thunder probability may be useful information, but it has a different event definition from tornado/wind/hail occurrence within 25 miles. Including an SPC-derived NBM field while claiming an independent comparison against SPC would obscure the product's provenance.

## Primary references checked November 6, 2026

- [Nadocast source and methodology](https://github.com/brianhempel/nadocast)
- [NOAA RRFS implementation announcement, updated November 5, 2026](https://www.noaa.gov/news-release/noaa-weather-modeling-hits-key-milestone-with-rapid-refresh-forecast-system-debut)
- [NWS NBM 5.0 webinar notes, April 15, 2026](https://www.weather.gov/media/wrn/calendar/NBM5.0Q_A-Webinar-Notes.pdf)
- [NCEI Storm Data bulk CSV field definitions](https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/Storm-Data-Bulk-csv-Format.pdf)
- [NWS explanation of preliminary Local Storm Reports](https://www.weather.gov/bgm/helpLocalStormReports)
