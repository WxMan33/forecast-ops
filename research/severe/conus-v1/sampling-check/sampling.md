# Sampling check: Day 2 wind, held-out 2022-23 months

728 held-out dates (6 month-grouped folds); BSS vs development climatology 0.01084. Reading: **sampling_helps**.

| Arm | National | original_box | west | plains_outside_box | florida_gulf_south | northeast_outside_box | mean p / obs |
|---|---|---|---|---|---|---|---|
| cohort96_all_rows | 0.096 | 0.114 | 0.034 | 0.060 | -0.045 | 0.119 | 1.047 |
| cohort96_sampled | 0.098 | 0.114 | 0.036 | 0.066 | -0.039 | 0.124 | 1.029 |
| all728_sampled | 0.115 | 0.133 | 0.049 | 0.078 | -0.007 | 0.127 | 0.999 |

**cohort96_sampled - cohort96_all_rows** (sampling effect at 96 dates), Brier difference, 95% whole-date interval:

- national: -0.000017 (-0.000030 to -0.000005)
- original_box: -0.000006 (-0.000034 to +0.000019)
- west: -0.000005 (-0.000010 to -0.000000)
- plains_outside_box: -0.000057 (-0.000092 to -0.000024)
- florida_gulf_south: -0.000040 (-0.000074 to -0.000003)
- northeast_outside_box: -0.000044 (-0.000093 to -0.000004)

**all728_sampled - cohort96_sampled** (data effect with sampling held fixed (the development gate)), Brier difference, 95% whole-date interval:

- national: -0.000180 (-0.000236 to -0.000128)
- original_box: -0.000370 (-0.000509 to -0.000241)
- west: -0.000037 (-0.000048 to -0.000026)
- plains_outside_box: -0.000111 (-0.000176 to -0.000050)
- florida_gulf_south: -0.000227 (-0.000342 to -0.000122)
- northeast_outside_box: -0.000018 (-0.000095 to +0.000061)

**all728_sampled - cohort96_all_rows** (the comparison 2021 actually made), Brier difference, 95% whole-date interval:

- national: -0.000197 (-0.000255 to -0.000145)
- original_box: -0.000376 (-0.000520 to -0.000247)
- west: -0.000042 (-0.000054 to -0.000032)
- plains_outside_box: -0.000168 (-0.000240 to -0.000105)
- florida_gulf_south: -0.000267 (-0.000379 to -0.000158)
- northeast_outside_box: -0.000062 (-0.000159 to +0.000029)
