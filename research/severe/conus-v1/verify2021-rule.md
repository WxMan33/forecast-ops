# One-time 2021 verification of the 728-date Day 2 wind candidate (committed 2026-11-24, before any 2021 data was fetched)

Why it is allowed: the 728-date candidate passed the development gate
(research/severe/conus-v1/fulldev-gate/gate.md, run 45481811593). The owner approved spending 2021 on Nov 24.

Order (each step committed before the next starts):
1. Freeze: fit the candidate once on all 728 development dates and commit `fulldev-frozen/model.pkl` and its
   SHA-256 (`fulldev-frozen/manifest.json`). It is never refit after 2021 is loaded.
2. Pin the 2021 NCEI Storm Events file by name, size and SHA-256 (`verify2021/report-source.json`).
3. Extract the 96 sealed dates in `twostage-verification-2021.json` with the unchanged CONUS extractor.
4. Score once with `conus_fulldev.py verify`. No re-run with changed settings.

Compared on the same dates, points and windows:
- 728-date candidate (`fulldev`) vs the frozen 96-date `conus_gbt` (models.pkl sha `a9ff6aa7…`), nationally and by region;
- inside the original regional box only, vs frozen live v0.7.
BSS uses the fixed 2022-23 development climatology (0.01084). Whole-date bootstrap, 5,000 draws.

Pass (all must hold):
1. National Brier of the 728-date candidate lower than the 96-date model, 95% interval excluding zero.
2. No region significantly worse than the 96-date model (no 95% interval entirely above zero).
3. Mean forecast within 25% of the observed 2021 rate (a looser bound than development, since 2021's report climatology may differ).
4. At least 90 of the 96 dates scored (HRRR gaps are listed, not replaced).

Whether it passes or fails, 2021 is spent and is not reused to choose between candidates. v0.7 stays live.
Any move toward production is a separate decision. 2025 stays sealed.
