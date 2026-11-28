# Day 2 wind learning curve (out-of-fold 2022-23 development dates only)

BSS vs the development climatology (0.01109); held-out months scored by trees trained on N of the other 80 dates.

| Training dates | National | original_box | west | plains_outside_box | florida_gulf_south | northeast_outside_box |
|---|---|---|---|---|---|---|
| 20 | 0.068 | 0.089 | -0.006 | 0.035 | -0.075 | 0.057 |
| 40 | 0.079 | 0.100 | 0.016 | 0.041 | -0.079 | 0.071 |
| 60 | 0.088 | 0.110 | 0.027 | 0.051 | -0.077 | 0.077 |
| 80 | 0.093 | 0.114 | 0.037 | 0.055 | -0.072 | 0.084 |

National BSS gain per doubling of training dates (log-linear fit): +0.013

| Change | National (95%) | original_box | west | plains_outside_box | florida_gulf_south | northeast_outside_box |
|---|---|---|---|---|---|---|
| 20->40 | +0.012 (+0.004 to +0.019) | +0.012 (+0.004 to +0.019) | +0.022 (+0.005 to +0.046) | +0.006 (-0.010 to +0.024) | -0.004 (-0.050 to +0.033) | +0.014 (-0.006 to +0.037) |
| 40->80 | +0.014 (+0.009 to +0.020) | +0.014 (+0.008 to +0.021) | +0.021 (+0.013 to +0.031) | +0.014 (+0.003 to +0.024) | +0.006 (-0.017 to +0.037) | +0.013 (-0.003 to +0.025) |
| 20->80 | +0.026 (+0.018 to +0.034) | +0.025 (+0.016 to +0.035) | +0.043 (+0.024 to +0.069) | +0.020 (+0.000 to +0.042) | +0.003 (-0.038 to +0.045) | +0.027 (+0.007 to +0.047) |
